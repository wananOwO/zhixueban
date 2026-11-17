/**
 * 浏览器端 API 请求封装。
 * 信封：成功 {contractVersion, requestId, data}；失败 {error: {code, message, retryable}}。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export const API_BASE = '/api/verified-learning/v1';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface ApiInit {
  method?: Method;
  body?: unknown;
  /** 幂等键：写操作重试时复用同一个值 */
  key?: string;
  /** 线上模式：附加浏览器保存的模型配置（X-VL-Model；若存在 Embedding 配置也一并附带以支持混合检索） */
  modelHeader?: boolean;
  /** 线上模式：附加浏览器保存的 Embedding 配置（X-VL-Embedding） */
  embeddingHeader?: boolean;
  /** 线上模式：附加浏览器保存的视觉配置（X-VL-Vision） */
  visionHeader?: boolean;
  signal?: AbortSignal;
}

/** 由模型 Key 存储注册，避免请求层直接依赖存储实现 */
let modelHeaderProvider: (() => string | null) | null = null;
let embeddingHeaderProvider: (() => string | null) | null = null;
let visionHeaderProvider: (() => string | null) | null = null;

export function registerModelHeader(provider: (() => string | null) | null) {
  modelHeaderProvider = provider;
}

export function registerEmbeddingHeader(provider: (() => string | null) | null) {
  embeddingHeaderProvider = provider;
}

export function registerVisionHeader(provider: (() => string | null) | null) {
  visionHeaderProvider = provider;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { method = 'GET', body, key, modelHeader, embeddingHeader, visionHeader, signal } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  if (modelHeader) {
    const value = modelHeaderProvider?.();
    if (value) headers['X-VL-Model'] = value;
    const embValue = embeddingHeaderProvider?.();
    if (embValue) headers['X-VL-Embedding'] = embValue;
  }
  if (embeddingHeader) {
    const embValue = embeddingHeaderProvider?.();
    if (embValue) headers['X-VL-Embedding'] = embValue;
  }
  if (visionHeader) {
    const visValue = visionHeaderProvider?.();
    if (visValue) headers['X-VL-Vision'] = visValue;
  }
  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      credentials: 'same-origin',
      headers,
      signal,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK', '网络连接失败，请确认服务仍在运行', true);
  }
  const envelope = (await response.json().catch(() => null)) as
    | { data?: unknown; error?: { code?: string; message?: string; retryable?: boolean } }
    | null;
  if (!response.ok) {
    const error = envelope?.error ?? {};
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('vl:unauthorized'));
    throw new ApiError(response.status, error.code ?? 'UNKNOWN', error.message ?? `请求失败（${response.status}）`, error.retryable ?? response.status >= 500);
  }
  return envelope?.data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}

/** 按错误码给出下一步提示（不重复服务端消息） */
export function errorHint(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  if (error.code === 'NETWORK') return '请确认本地服务仍在运行后重试。';
  if (error.code === 'MODEL_KEY_REQUIRED') return '请在设置中填写模型 Key 后继续。';
  switch (error.status) {
    case 401: return '登录已失效，请重新登录。';
    case 409: return '内容已在别处更新，请刷新后再试；你的输入仍保留在本页。';
    case 413: return '文件超过大小上限。';
    case 422: return '内容未通过校验，请按提示修改。';
    case 429: return '使用次数已达上限，请稍后再试。';
    case 502: case 503: return '模型或判题服务暂时不可用，可稍后重试。';
    default: return '';
  }
}
