import { LearningError } from './contracts';
import { AppError } from './errors';

const errors = {
  INVALID_INPUT: [400, '请求内容不合法', false],
  NOT_FOUND: [404, '内容不存在或不可访问', false],
  VERSION_CONFLICT: [409, '内容已发生变化，请重新读取', false],
  VALIDATION_FAILED: [422, '内容未通过校验', false],
  ACTIVITY_IN_PROGRESS: [409, '请先完成或放弃当前活动', false],
  DISABLED: [503, '本机学习入口尚未启用', false],
  NOT_INITIALIZED: [503, '学习数据库尚未初始化', false],
  UNAUTHENTICATED: [401, '请先登录本机学习入口', false],
  FORBIDDEN: [403, '不允许此访问方式', false],
  PAYLOAD_TOO_LARGE: [413, '请求内容超出大小限制', false],
  LIMIT_EXCEEDED: [429, '请求次数或使用额度超限', false],
  IN_PROGRESS: [409, '操作正在进行，请稍后读取结果', true],
  PROVIDER_ERROR: [502, '模型服务暂时不可用', true],
  JUDGE_UNAVAILABLE: [502, '判题服务暂时不可用', true],
  MODEL_KEY_REQUIRED: [400, '需要模型 Key：请在设置中填写后重试', false],
  INTERNAL_ERROR: [500, '操作失败，请稍后重试', false],
} as const;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export function ok<T>(data: T, requestId: string, status = 200): Response {
  return Response.json({ contractVersion: 1, requestId, data }, { status, headers });
}

export function fail(error: unknown, requestId: string): Response {
  const code = error instanceof LearningError || error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const known = Object.hasOwn(errors, code) ? code : 'INTERNAL_ERROR';
  const [status, message, retryable] = errors[known];
  return Response.json({ contractVersion: 1, requestId, error: { code: known, message, retryable } }, { status, headers });
}

export async function readJson(request: Request, maxBytes = 128 * 1024): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !request.body) {
    throw new LearningError('INVALID_INPUT', '需要合法的JSON正文');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('PAYLOAD_TOO_LARGE', '正文超过大小限制');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch {
    throw new LearningError('INVALID_INPUT', 'JSON正文不合法');
  }
}
