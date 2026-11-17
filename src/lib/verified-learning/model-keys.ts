import { z } from 'zod';
import { assertPublicUrl } from './agent/web';
import { LearningError } from './contracts';

/**
 * 线上模式的模型配置只存在两处（规格 4.2 方案 1 & 优化设计 5.4 / 6.4）：
 * 1. 用户浏览器 localStorage；需要模型的请求通过 X-VL-Model / X-VL-Embedding / X-VL-Vision 请求头带来。
 * 2. 本进程内存：后台任务运行期间按 (scope, jobId) 登记，任务结束即删除；进程重启即消失。
 * 绝不写入数据库、任务输入、Agent 会话、日志或错误信息。
 */
export interface ModelConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface EmbeddingHeaderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const MAX_HEADER = 8192;

const safeHttpUrl = z.string().trim().max(2000).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
});

const modelSchema = z.strictObject({
  provider: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: safeHttpUrl,
  apiKey: z.string().trim().min(1).max(4096),
  model: z.string().trim().min(1).max(300),
});

const embeddingSchema = z.strictObject({
  baseUrl: safeHttpUrl,
  model: z.string().trim().min(1).max(300),
  apiKey: z.string().trim().min(1).max(4096),
});

function invalid(label: string): never {
  throw new LearningError('INVALID_INPUT', `${label}配置格式不合法，请在设置中重新填写`);
}

export function encodeModelHeader(config: ModelConfig): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}

export function parseModelHeader(value: string | null): ModelConfig | null {
  if (value === null || value === '') return null;
  if (value.length > MAX_HEADER || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('模型');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { invalid('模型'); }
  const result = modelSchema.safeParse(parsed);
  if (!result.success) invalid('模型');
  return result.data;
}

export function encodeEmbeddingHeader(config: EmbeddingHeaderConfig): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}

export function parseEmbeddingHeader(value: string | null): EmbeddingHeaderConfig | null {
  if (value === null || value === '') return null;
  if (value.length > MAX_HEADER || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('Embedding ');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { invalid('Embedding '); }
  const result = embeddingSchema.safeParse(parsed);
  if (!result.success) invalid('Embedding ');
  return result.data;
}

async function assertPublicServiceUrl(baseUrl: string, label: string): Promise<void> {
  try {
    await assertPublicUrl(baseUrl);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new LearningError('INVALID_INPUT', `${label}地址的域名无法解析，请在设置中检查地址`);
    }
    throw new LearningError('INVALID_INPUT', `线上站只能连接公网${label}服务（HTTPS 默认端口），不支持本机、内网或带端口的地址`);
  }
}

export async function assertPublicModelAddress(config: ModelConfig): Promise<void> {
  return assertPublicServiceUrl(config.baseUrl, '模型');
}

export async function assertPublicEmbeddingAddress(config: EmbeddingHeaderConfig): Promise<void> {
  return assertPublicServiceUrl(config.baseUrl, 'Embedding ');
}

const keys = new Map<string, ModelConfig>();
const indexKeys = new Map<string, EmbeddingHeaderConfig>();
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

export function rememberIndexKey(scope: string, jobId: string, config: EmbeddingHeaderConfig): void {
  indexKeys.set(slot(scope, jobId), config);
}
export function indexKey(scope: string, jobId: string): EmbeddingHeaderConfig | undefined {
  return indexKeys.get(slot(scope, jobId));
}
export function forgetIndexKey(scope: string, jobId: string): void {
  indexKeys.delete(slot(scope, jobId));
}

/** 当前进程内所有在用的 Key：供错误遮蔽使用（单次请求里的聊天/Embedding/视觉 Key 也会临时登记） */
const transient = new Set<string>();
export function allSecrets(): string[] {
  return [
    ...new Set([
      ...[...keys.values()].map(c => c.apiKey),
      ...[...indexKeys.values()].map(c => c.apiKey),
      ...transient,
    ]),
  ];
}

/** 在一次请求内临时登记 Key 以便遮蔽，结束后立即移除 */
export async function withTransientSecret<T>(secret: string, run: () => Promise<T>): Promise<T> {
  if (!secret) return run();
  transient.add(secret);
  try {
    return await run();
  } finally {
    transient.delete(secret);
  }
}
