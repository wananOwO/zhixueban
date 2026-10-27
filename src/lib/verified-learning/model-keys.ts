import { z } from 'zod';
import { LearningError } from './contracts';

/**
 * 线上模式的模型配置只存在两处（规格 4.2 方案 1）：
 * 1. 用户浏览器 localStorage；需要模型的请求通过 X-VL-Model 请求头带来。
 * 2. 本进程内存：生成任务运行期间按任务登记，任务结束即删除；进程重启即消失。
 * 绝不写入数据库、任务输入、Agent 会话、日志或错误信息。
 */
export interface ModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

const MAX_HEADER = 8192;
const schema = z.strictObject({
  provider: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().trim().max(2000).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }),
  apiKey: z.string().trim().min(1).max(4096),
  model: z.string().trim().min(1).max(300),
});

function invalid(): never {
  throw new LearningError('INVALID_INPUT', '模型配置格式不合法，请在设置中重新填写');
}

export function encodeModelHeader(config: ModelConfig): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}

export function parseModelHeader(value: string | null): ModelConfig | null {
  if (value === null || value === '') return null;
  if (value.length > MAX_HEADER || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { invalid(); }
  const result = schema.safeParse(parsed);
  if (!result.success) invalid();
  return result.data;
}

const keys = new Map<string, ModelConfig>();
const slot = (scope: string, jobId: string) => `${scope}\u0000${jobId}`;

export function rememberJobKey(scope: string, jobId: string, config: ModelConfig): void {
  keys.set(slot(scope, jobId), config);
}
export function jobKey(scope: string, jobId: string): ModelConfig | undefined {
  return keys.get(slot(scope, jobId));
}
export function forgetJobKey(scope: string, jobId: string): void {
  keys.delete(slot(scope, jobId));
}

/** 当前进程内所有在用的 Key：供错误遮蔽使用（单次请求里的 Key 也会临时登记） */
const transient = new Set<string>();
export function allSecrets(): string[] {
  return [...new Set([...[...keys.values()].map(c => c.apiKey), ...transient])];
}
/** 在一次请求内临时登记 Key 以便遮蔽，结束后移除 */
export async function withTransientSecret<T>(secret: string, run: () => Promise<T>): Promise<T> {
  transient.add(secret);
  try { return await run(); } finally { transient.delete(secret); }
}
