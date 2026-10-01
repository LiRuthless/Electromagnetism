/*
 * controller.c — PD 循迹示例（车载控制器 WASM ABI v1，见 controller_api.h）
 *
 * 与仿真器内置默认公式（数学模型.md 式 (8.1)，A=B=C=1）同构：
 *   Err = P_GAIN * ((L1-R1) + (L2-R2)) / ((L1+R1) + |L2-R2|)
 *   u = Kp*Err + Kd*dErr/dt；差速分配内轮:外轮 = w:1，限幅 [0, v_max]
 * P_GAIN 取负 = 默认 4 电感布局在直道上的负反馈标定符号
 * （与 scripts/selfcheck-tracking.ts [4] 的 P=-1 结论一致）；
 * 用作自检 fixture（scripts/fixtures/pd_controller.wasm）的对照基准：
 * 同参数下轨迹应与内置 FormulaController 在 float32 容差内一致。
 *
 * 任务划分（对应实车现状）：1ms = 传感器采集缓存；2ms = 控制律 + 电机输出。
 */

#include "controller_api.h"

/* ABI 版本声明（宿主校验，不匹配拒绝加载）；用函数而非全局变量——
   wasm 导出数据符号得到的是其内存地址而非数值 */
__attribute__((export_name("CTRL_ABI_VERSION"))) int ctrl_abi_version(void) {
  return CTRL_ABI_VERSION;
}

/* 整车/控制参数（与仿真器默认值对齐：Kp=0.5 Kd=0.05 v_base=1.0 v_max=2.0 w=1.5） */
#define KP 0.5f
#define KD 0.05f
#define P_GAIN (-1.0f) /* 默认布局负反馈标定符号（selfcheck-tracking [4]） */
#define V_BASE 1.0f /* m/s */
#define V_MAX 2.0f  /* m/s */
#define W_DIFF 1.5f /* 内轮变化量 : 外轮变化量 = w : 1 */

static float adc_cache[4]; /* 4 电感布局：0=L1 1=R1 2=L2 3=R2 */
static float prev_err;
static float prev_t_ms;
static int first_step;

__attribute__((export_name("ctrl_init"))) void ctrl_init(void) {
  int i;
  for (i = 0; i < 4; i++) adc_cache[i] = 0.0f;
  prev_err = 0.0f;
  prev_t_ms = 0.0f;
  first_step = 1;
}

/* 1ms 任务：传感器采集缓存 */
__attribute__((export_name("ctrl_task_1ms"))) void ctrl_task_1ms(void) {
  int ch;
  for (ch = 0; ch < 4; ch++) adc_cache[ch] = read_adc(ch);
}

static float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* 2ms 任务：差比和误差 → PD → 差速轮速 → set_motor_pwm（归一化 = 轮速 / v_max） */
__attribute__((export_name("ctrl_task_2ms"))) void ctrl_task_2ms(void) {
  float l1 = adc_cache[0], r1 = adc_cache[1], l2 = adc_cache[2], r2 = adc_cache[3];
  float num = (l1 - r1) + (l2 - r2);
  float den = (l1 + r1) + fabsf(l2 - r2);
  float err;
  float t_ms = get_time_ms();
  float err_rate, u, dv_out, dv_in, vl, vr;

  if (den == 0.0f) {
    err = prev_err; /* 分母为零回退上一步误差（与宿主公式求值约定一致） */
  } else {
    err = P_GAIN * num / den;
  }

  if (first_step) {
    err_rate = 0.0f;
    first_step = 0;
  } else {
    float dt_s = (t_ms - prev_t_ms) / 1000.0f;
    err_rate = dt_s > 0.0f ? (err - prev_err) / dt_s : 0.0f;
  }
  prev_err = err;
  prev_t_ms = t_ms;

  u = KP * err + KD * err_rate;

  /* 式 (8.3)–(8.5)：保持平均速度 ≈ v_base；u>0 右转（左外右内），限幅 [0, v_max] */
  dv_out = 2.0f * fabsf(u) / (1.0f + W_DIFF);
  dv_in = 2.0f * fabsf(u) * W_DIFF / (1.0f + W_DIFF);
  if (u >= 0.0f) {
    vl = V_BASE + dv_out;
    vr = V_BASE - dv_in;
  } else {
    vl = V_BASE - dv_in;
    vr = V_BASE + dv_out;
  }
  vl = clampf(vl, 0.0f, V_MAX);
  vr = clampf(vr, 0.0f, V_MAX);

  set_motor_pwm(vl / V_MAX, vr / V_MAX);
}
