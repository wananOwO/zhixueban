import { APICallError } from 'ai';
import { getConfig } from '../llm/config';
import { allSecrets } from './model-keys';

/** 只携带供应商响应，不包含请求正文、请求头、堆栈或服务端路径。 */
export class ProviderResponseError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

export function redact(message: string): string {
  // 线上模式的 Key 只在内存里，同样要从任何对外文本中遮蔽
  for (const secret of [getConfig('llm_api_key'), process.env.LLM_API_KEY, process.env.VERIFIED_LEARNING_ACCESS_TOKEN, process.env.VL_ACCESS_CODE, ...allSecrets()]) {
    if (secret) {
      message = message.split(secret).join('[已隐藏]');
      message = message.split(JSON.stringify(secret).slice(1, -1)).join('[已隐藏]');
    }
  }
  return message.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/("(?:api[_-]?key|x-api-key|authorization|access_token)"\s*:\s*")[^"]*(")/gi, '$1[已隐藏]$2');
}

export function providerResponseError(error: unknown): ProviderResponseError | null {
  let current = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (APICallError.isInstance(current)) {
      const message = `供应商返回${current.statusCode ? ` HTTP ${current.statusCode}` : '错误'}\n${current.responseBody || current.message}`;
      return new ProviderResponseError(redact(message), current.isRetryable);
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

/** 任务失败时写入的错误码：缺少模型 Key 单独标记，前端据此提示「填写 Key 后继续」 */
export function jobErrorCode(error: unknown, fallback: string): string {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ((current as Error & { code?: unknown }).code === 'MODEL_KEY_REQUIRED') return 'MODEL_KEY_REQUIRED';
    current = current.cause;
  }
  return fallback;
}

/** 非 HTTP 异常也必须留下可诊断原因；只提取消息和错误码，不序列化整个异常。 */
export function generationError(error: unknown): ProviderResponseError {
  if (error instanceof ProviderResponseError) return error;
  const apiError = providerResponseError(error);
  if (apiError) return apiError;
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as Error & { code?: unknown }).code;
    details.push(`${current.name}${typeof code === 'string' ? ` (${code})` : ''}: ${current.message}`);
    current = current.cause;
  }
  const name = error instanceof Error ? error.name : '';
  const category = name === 'TimeoutError' ? '模型请求超时' : name === 'AbortError' ? '模型请求被中止'
    : /NoObjectGenerated|JSONParse|TypeValidation/.test(name) ? '模型输出解析或校验失败' : '生成执行失败';
  return new ProviderResponseError(redact(`${category}\n${details.join('\n原因：') || '未提供错误详情'}`), true);
}
