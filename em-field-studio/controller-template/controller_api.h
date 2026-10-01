/*
 * controller_api.h — 车载控制器 WASM ABI v1（宿主 = 电磁场建模仿真工具）
 *
 * 规约：specs/features/13-wasm-controller/（techstack 硬性约束 6：ABI 稳定，
 * 任何变更必须升 CTRL_ABI_VERSION 并同步本模板与自检 fixture）。
 *
 * ABI 风格 = 宿主导入函数（syscall 式），不传内存结构体。
 * 全部导入函数 module = "env"，参数与返回值均为 float32（read_adc 的 ch 为 int32）。
 * 单位约定（SI）：电压 V（Vpp）、角速度 rad/s、加速度 m/s^2、速度 m/s、时间 ms；
 * 唯一例外：set_motor_pwm 为归一化指令 -1..1（负值 = 倒车语义；循迹场景宿主侧限幅到
 * [0, v_max]，见规约式 (13.1)）。
 *
 * 任务入口（本文件下方注释的函数需由 controller.c 实现并导出）：
 *   ctrl_init()       载入/复位时由宿主调用一次（可选，缺失则跳过并提示）；
 *   ctrl_task_1ms()   1ms 周期任务（建议：传感器采集缓存）；
 *   ctrl_task_2ms()   2ms 周期任务（建议：控制律 + set_motor_pwm）。
 * 宿主逐个探测入口，缺哪个跳过哪个；两个任务入口全缺将被拒绝加载。
 *
 * 不支持：malloc / printf / 文件 IO / 线程 / 异常（freestanding -nostdlib 编译模型，
 * 需要缓冲请用静态数组）。libm 的 float 函数未解析符号由宿主兜底（见下方声明）。
 */

#ifndef CONTROLLER_API_H
#define CONTROLLER_API_H

/* ABI 版本号（与宿主 controllerAbi.ts 的 CTRL_ABI_VERSION 一致） */
#define CTRL_ABI_VERSION 1

/* ---------------- 宿主导入（env）：传感器 / 执行器 / 时间 ---------------- */

/* 第 ch 路电感电压（V，Vpp）；ch 0–3 = 电感布局数组顺序（默认布局 L1=0/R1=1/L2=2/R2=3），越界返回 0 */
__attribute__((import_module("env"))) float read_adc(int ch);
/* IMU z 轴角速度（rad/s），运动学真值合成（本期无噪声） */
__attribute__((import_module("env"))) float read_gyro_z(void);
/* 车体坐标系纵向 / 横向（向心）加速度（m/s^2），运动学真值合成 */
__attribute__((import_module("env"))) float read_accel_x(void);
__attribute__((import_module("env"))) float read_accel_y(void);
/* 编码器车速（m/s），由实际轮速合成 */
__attribute__((import_module("env"))) float read_encoder_speed(void);
/* 仿真时间（ms） */
__attribute__((import_module("env"))) float get_time_ms(void);
/* 左右电机归一化指令 -1..1（唯一非 SI 例外；映射 = 规约式 (13.1)） */
__attribute__((import_module("env"))) void set_motor_pwm(float left, float right);

/* ---------------- math 兜底导入（freestanding 时 libm 未解析符号由宿主提供） ---------------- */

__attribute__((import_module("env"))) float sinf(float x);
__attribute__((import_module("env"))) float cosf(float x);
__attribute__((import_module("env"))) float tanf(float x);
__attribute__((import_module("env"))) float asinf(float x);
__attribute__((import_module("env"))) float acosf(float x);
__attribute__((import_module("env"))) float atanf(float x);
__attribute__((import_module("env"))) float atan2f(float y, float x);
__attribute__((import_module("env"))) float sqrtf(float x);
__attribute__((import_module("env"))) float fabsf(float x);
__attribute__((import_module("env"))) float powf(float x, float y);
__attribute__((import_module("env"))) float expf(float x);
__attribute__((import_module("env"))) float logf(float x);
__attribute__((import_module("env"))) float floorf(float x);
__attribute__((import_module("env"))) float ceilf(float x);
__attribute__((import_module("env"))) float fmodf(float x, float y);

#endif /* CONTROLLER_API_H */
