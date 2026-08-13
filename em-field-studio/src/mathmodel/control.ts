/**
 * 循迹闭环控制内核（数学模型.md §8.2 / §8.3）：
 * 误差公式（差比和差加权，可编辑文本表达式）+ PD 控制 + 两轮差速轮速分配。
 *
 * 误差公式：
 *   默认 C4 式  Err = [A·(L−R) + B·(LM−RM)] / [A·(L+R) + C·|LM−RM|] · P
 *   表达式在界面上以文本编辑，可用变量 = 各电感名（读数 Vpp）+ 系数 A/B/C/P；
 *   支持 + - * / 、括号、一元负号、abs(...) 与 |...| 绝对值。
 *   表达式非法时编译抛中文错误，调用方提示并回退默认公式。
 *
 * PD 与轮速分配：
 *   u = Kp·Err + Kd·dErr/dt
 *   转弯时内轮变化量 : 外轮变化量 = w : 1（默认 w = 1.5），保持平均速度 ≈ v_base：
 *     Δv_外 = 2u/(1+w)，Δv_内 = 2u·w/(1+w)
 *     右转（u>0）：v_L(外) = v_base + Δv_外，v_R(内) = v_base − Δv_内；左转反之。
 *   轮速限幅 [0, v_max]。
 *
 * 电机一阶滞后（2026-08-12 新增，数学模型.md §8.4）：
 *   电机/驱动惯性使实际轮速不能瞬时跟随指令：τ_m·dv/dt + v = v_cmd。
 *   每轮一个滞后状态，双轮共用时间常数 τ_m（默认 30 ms，0 = 无滞后）；
 *   滞后为线性环节，故平均速度与差速各自以同一 τ_m 跟随其指令值。
 */

// ---------------- 可调参数 ----------------

export interface TrackingParams {
  /** 循迹闭环仿真开关 */
  enabled: boolean;
  /** 误差公式文本（可用变量：各电感名 + A/B/C/P） */
  formula: string;
  /** 分子横向差权重 */
  A: number;
  /** 分子前瞻差权重 */
  B: number;
  /** 分母前瞻差权重 */
  C: number;
  /** 比例系数（输出量级） */
  P: number;
  /** PD 比例系数 */
  kp: number;
  /** PD 微分系数（作用于相邻控制步误差差分 / dt） */
  kd: number;
  /** 基础速度（m/s） */
  vBase: number;
  /** 轮速上限（m/s），限幅 [0, vMax] */
  vMax: number;
  /** 差速权重 w：内轮变化量 : 外轮变化量 = w : 1 */
  w: number;
  /** 轮距 W（m） */
  wheelBase: number;
  /** 控制/积分步长（ms） */
  dtMs: number;
  /** 电机一阶滞后时间常数 τ_m（ms，默认 30；0 = 无滞后，轮速瞬时跟随指令） */
  motorTauMs: number;
  /** 初始横向偏差扰动（mm，>0 右偏） */
  initEMm: number;
  /** 初始航向角扰动（度，>0 右偏） */
  initPsiDeg: number;
  /** 失控判停：|Err| 持续超过该阈值的步数上限 */
  errLimit: number;
  errLimitSteps: number;
}

/** 默认误差公式（C4 变体，2026-08-03 随默认 4 电感布局联动）：主电感对 L1/R1 + 宽对辅助 L2/R2 */
export const DEFAULT_FORMULA = '(A*(L1-R1)+B*(L2-R2))/(A*(L1+R1)+C*abs(L2-R2))*P';

export const DEFAULT_TRACKING: TrackingParams = {
  enabled: false,
  formula: DEFAULT_FORMULA,
  A: 1,
  B: 1,
  C: 1,
  P: 1,
  kp: 0.5,
  kd: 0.05,
  vBase: 1.0,
  vMax: 2.0,
  w: 1.5,
  wheelBase: 0.135,
  dtMs: 5,
  motorTauMs: 30,
  initEMm: 0,
  initPsiDeg: 0,
  errLimit: 2,
  errLimitSteps: 200,
};

// ---------------- 误差公式解析（递归下降，无 eval） ----------------

type Token =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      // 数字字面量：整数/小数/科学计数法（如 1e-6、2.5E3）
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`非法数字（位置 ${i}）`);
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new Error(`非法数字"${m[0]}"`);
      toks.push({ t: 'num', v });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_一-龥]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_一-龥]/.test(src[j])) j++;
      toks.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/()|,'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`无法识别的字符"${c}"`);
  }
  return toks;
}

type AstNode =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: AstNode }
  | { k: 'abs'; a: AstNode }
  | { k: 'bin'; op: string; l: AstNode; r: AstNode };

class Parser {
  private pos = 0;
  private toks: Token[];
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expectOp(v: string) {
    if (!this.eatOp(v)) throw new Error(`缺少"${v}"`);
  }

  parse(): AstNode {
    const n = this.parseAdd();
    if (this.pos < this.toks.length) throw new Error('表达式末尾有多余内容');
    return n;
  }

  private parseAdd(): AstNode {
    let l = this.parseMul();
    for (;;) {
      if (this.eatOp('+')) l = { k: 'bin', op: '+', l, r: this.parseMul() };
      else if (this.eatOp('-')) l = { k: 'bin', op: '-', l, r: this.parseMul() };
      else return l;
    }
  }
  private parseMul(): AstNode {
    let l = this.parseUnary();
    for (;;) {
      if (this.eatOp('*')) l = { k: 'bin', op: '*', l, r: this.parseUnary() };
      else if (this.eatOp('/')) l = { k: 'bin', op: '/', l, r: this.parseUnary() };
      else return l;
    }
  }
  private parseUnary(): AstNode {
    if (this.eatOp('-')) return { k: 'neg', a: this.parseUnary() };
    if (this.eatOp('+')) return this.parseUnary();
    return this.parseAtom();
  }
  private parseAtom(): AstNode {
    const t = this.peek();
    if (!t) throw new Error('表达式意外结束');
    if (t.t === 'num') {
      this.pos++;
      return { k: 'num', v: t.v };
    }
    if (t.t === 'ident') {
      this.pos++;
      if (t.v === 'abs') {
        this.expectOp('(');
        const a = this.parseAdd();
        this.expectOp(')');
        return { k: 'abs', a };
      }
      return { k: 'var', name: t.v };
    }
    if (this.eatOp('(')) {
      const n = this.parseAdd();
      this.expectOp(')');
      return n;
    }
    if (this.eatOp('|')) {
      const n = this.parseAdd();
      this.expectOp('|');
      return { k: 'abs', a: n };
    }
    throw new Error(`意外的符号"${t.t === 'op' ? t.v : ''}"`);
  }
}

function evalAst(n: AstNode, vars: Record<string, number>): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var': {
      const v = vars[n.name];
      if (v === undefined) throw new Error(`未知变量"${n.name}"`);
      return v;
    }
    case 'neg':
      return -evalAst(n.a, vars);
    case 'abs':
      return Math.abs(evalAst(n.a, vars));
    case 'bin': {
      const l = evalAst(n.l, vars);
      const r = evalAst(n.r, vars);
      switch (n.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        default:
          return l / r;
      }
    }
  }
}

/** 编译后的误差公式 */
export interface CompiledFormula {
  /** 表达式中出现的变量名（电感名 + A/B/C/P） */
  variables: string[];
  eval(vars: Record<string, number>): number;
}

function collectVars(n: AstNode, out: Set<string>) {
  if (n.k === 'var') out.add(n.name);
  else if (n.k === 'neg' || n.k === 'abs') collectVars(n.a, out);
  else if (n.k === 'bin') {
    collectVars(n.l, out);
    collectVars(n.r, out);
  }
}

/**
 * 编译误差表达式。语法非法抛中文错误（调用方提示并回退默认公式）；
 * 变量在求值时按名称查表，未知变量求值时抛错。
 */
export function compileFormula(src: string): CompiledFormula {
  const trimmed = src.trim();
  if (!trimmed) throw new Error('公式为空');
  const ast = new Parser(tokenize(trimmed)).parse();
  const vars = new Set<string>();
  collectVars(ast, vars);
  return {
    variables: [...vars],
    eval: (v) => evalAst(ast, v),
  };
}

// ---------------- PD 控制与轮速分配（数学模型.md §8.3） ----------------

/** PD 输出：u = Kp·Err + Kd·dErr/dt */
export function pdOutput(err: number, errRate: number, p: TrackingParams): number {
  return p.kp * err + p.kd * errRate;
}

/**
 * 由 PD 输出 u 分配两轮轮速（保持平均速度 ≈ v_base）：
 * 内轮变化量 : 外轮变化量 = w : 1 —— Δv_外 = 2u/(1+w)，Δv_内 = 2u·w/(1+w)；
 * 右转（u>0）：左轮为外轮加速、右轮为内轮减速；左转反之。
 * 限幅 [0, vMax]。
 */
export function wheelSpeeds(u: number, p: TrackingParams): { vL: number; vR: number } {
  const a = Math.abs(u);
  const dvOut = (2 * a) / (1 + p.w);
  const dvIn = (2 * a * p.w) / (1 + p.w);
  let vL: number;
  let vR: number;
  if (u >= 0) {
    // 右转：左外右内
    vL = p.vBase + dvOut;
    vR = p.vBase - dvIn;
  } else {
    // 左转：右外左内
    vR = p.vBase + dvOut;
    vL = p.vBase - dvIn;
  }
  const clamp = (v: number) => Math.min(p.vMax, Math.max(0, v));
  return { vL: clamp(vL), vR: clamp(vR) };
}

// ---------------- 电机一阶滞后（数学模型.md §8.4） ----------------

/**
 * 电机一阶滞后的单步精确更新：τ·dv/dt + v = v_cmd 在指令 v_cmd 于步内恒定时有闭式解
 *   v(t+dt) = v_cmd + (v(t) − v_cmd)·exp(−dt/τ)
 * 对任意 dt/τ 稳定（无 Euler 刚性限制）；tauS ≤ 0 时退化为瞬时跟随（v = v_cmd）。
 */
export function motorLag(vAct: number, vCmd: number, tauS: number, dt: number): number {
  if (tauS <= 0) return vCmd;
  return vCmd + (vAct - vCmd) * Math.exp(-dt / tauS);
}
