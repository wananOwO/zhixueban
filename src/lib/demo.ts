export const DEMO_READ_ONLY_MSG =
  '当前为在线演示模式，配置为只读。如需完整功能，请按 README 本地部署。';

/** 公网演示模式（设计 §5.6.2）：配置类写入一律拒绝 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export class DemoReadOnlyError extends Error {
  constructor() {
    super(DEMO_READ_ONLY_MSG);
    this.name = 'DemoReadOnlyError';
  }
}

export function assertDemoWritable(): void {
  if (isDemoMode()) throw new DemoReadOnlyError();
}
