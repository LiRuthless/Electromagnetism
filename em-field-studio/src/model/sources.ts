/**
 * 电感采集数据源抽象接口。
 *
 * 当前可用：SimulationSource（从磁场模型实时计算）。
 * 预留接口：SerialSource（串口实车 ADC）、FileSource（导入标定 Excel/CSV）。
 *
 * ============================ 接入说明 ============================
 *
 * 【SerialSource —— 串口实车 ADC】
 *   浏览器端使用 Web Serial API（Chrome / Edge 支持）：
 *     1. connect():  const port = await navigator.serial.requestPort();
 *                    await port.open({ baudRate: 115200 });
 *     2. read():     从 ReadableStream 按行解析，约定帧格式 CSV：
 *                    "L1,R1,L2,R2,M1,F1,F2\n"（ADC 原始计数，顺序与布局表一致）
 *     3. disconnect(): await port.close();
 *   注意：Web Serial 需要 HTTPS 或 localhost 环境；单位换算（ADC -> 电压）
 *   在 read() 内完成，保持与仿真读数同一量纲约定。
 *
 * 【FileSource —— 标定 Excel / CSV 导入】
 *   已实现：见 SensorPanel"实测数据标定"区与 src/model/measured.ts——
 *   导入实测 CSV（e vs 各通道 U）后自动完成方案A 拟合 / 方案B 物理公式+偏差校正建模，
 *   由数据源 measured-fit / measured-phys 直接在 Home 中求值，不走 SensorDataSource 接口。
 *   =================================================================
 */
import type { SensorReading } from './sensor';

export type SourceKind = 'simulation' | 'serial' | 'file' | 'measured-fit' | 'measured-phys';

export interface SensorDataSource {
  readonly kind: SourceKind;
  readonly name: string;
  /** 建立连接（stub 实现应抛出带说明的错误） */
  connect(): Promise<void>;
  /** 读取一组电感读数 */
  read(): Promise<SensorReading[]>;
  disconnect(): Promise<void>;
}

/** 仿真数据源：从磁场模型实时计算（可用） */
export class SimulationSource implements SensorDataSource {
  readonly kind = 'simulation' as const;
  readonly name = '仿真模型';
  private computeFn: () => SensorReading[];

  constructor(computeFn: () => SensorReading[]) {
    this.computeFn = computeFn;
  }

  setCompute(fn: () => SensorReading[]) {
    this.computeFn = fn;
  }

  async connect() {}
  async read(): Promise<SensorReading[]> {
    return this.computeFn();
  }
  async disconnect() {}
}

const STUB_MSG = '预留接口，待接入';

/** 串口实车 ADC（stub，预留）——接入说明见文件头注释 */
export class SerialSource implements SensorDataSource {
  readonly kind = 'serial' as const;
  readonly name = '串口实车 ADC（预留）';
  async connect(): Promise<void> {
    throw new Error(`${STUB_MSG}：将在此实现 Web Serial 连接（见 sources.ts 头注释）`);
  }
  async read(): Promise<SensorReading[]> {
    throw new Error(STUB_MSG);
  }
  async disconnect(): Promise<void> {}
}

/** 标定 Excel / CSV 导入（已实现：见 SensorPanel"实测数据标定"区与 src/model/measured.ts） */
export class FileSource implements SensorDataSource {
  readonly kind = 'file' as const;
  readonly name = '标定文件导入（已实现）';
  async connect(): Promise<void> {
    throw new Error('实测文件导入已实现：请使用右侧"实测数据标定"区导入 CSV（见 src/model/measured.ts）');
  }
  async read(): Promise<SensorReading[]> {
    throw new Error('实测模型由 Home 直接求值（measured-fit / measured-phys 数据源），不走 SensorDataSource 接口');
  }
  async disconnect(): Promise<void> {}
}

/** 实测模型数据源说明：两种实测模型由 Home 直接求值，不走 SensorDataSource 接口 */
const MEASURED_MSG = '实测模型（方案A 拟合 / 方案B 物理公式+偏差校正）由 Home 直接求值，见 src/model/measured.ts';

export function createSource(
  kind: SourceKind,
  simCompute: () => SensorReading[],
): SensorDataSource {
  switch (kind) {
    case 'simulation':
      return new SimulationSource(simCompute);
    case 'serial':
      return new SerialSource();
    case 'file':
      return new FileSource();
    case 'measured-fit':
    case 'measured-phys':
      throw new Error(MEASURED_MSG);
  }
}
