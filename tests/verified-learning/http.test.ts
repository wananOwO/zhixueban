import { describe, expect, it } from 'vitest';
import { LearningError } from '@/lib/verified-learning/contracts';
import { AppError } from '@/lib/verified-learning/errors';
import { fail, ok, readJson } from '@/lib/verified-learning/http';

function bodyRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3101', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

describe('增强 HTTP 边界', () => {
  it('读取JSON保留值并限制真实UTF8字节数', async () => {
    expect(await readJson(bodyRequest('{"目标":"算法"}'), 128)).toEqual({ 目标: '算法' });
    await expect(readJson(bodyRequest('{"目标":"算法"}', { 'content-length': '1' }), 8))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('遇到流超限立即取消，不继续消耗无限正文', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(20)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('http://127.0.0.1:3101', {
      method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' },
    } as RequestInit);
    await expect(readJson(request, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('拒绝空正文、错误格式、非JSON类型和非法上限', async () => {
    for (const input of ['', '{', 'not json']) {
      await expect(readJson(bodyRequest(input), 128)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(readJson(bodyRequest('{}', { 'content-type': 'text/plain' }), 128)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readJson(bodyRequest('{}'), -1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('成功信封固定版本与requestId且禁止缓存', async () => {
    const response = ok({ id: 'book-a' }, 'request-a', 202);
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ contractVersion: 1, requestId: 'request-a', data: { id: 'book-a' } });
  });

  it.each([
    ['INVALID_INPUT', 400], ['NOT_FOUND', 404], ['VERSION_CONFLICT', 409],
    ['VALIDATION_FAILED', 422], ['ACTIVITY_IN_PROGRESS', 409],
  ] as const)('领域错误 %s 映射为 %d', async (code, status) => {
    const response = fail(new LearningError(code, '后台原始信息 PRIVATE_SENTINEL'), 'request-a');
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain('PRIVATE_SENTINEL');
  });

  it.each([
    ['DISABLED', 503], ['NOT_INITIALIZED', 503], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403],
    ['PAYLOAD_TOO_LARGE', 413], ['LIMIT_EXCEEDED', 429], ['IN_PROGRESS', 409],
    ['PROVIDER_ERROR', 502], ['JUDGE_UNAVAILABLE', 502], ['INTERNAL_ERROR', 500],
  ] as const)('应用错误 %s 映射为 %d 且原始详情不泄漏', async (code, status) => {
    const response = fail(new AppError(code, 'C:\\private\\SECRET_SENTINEL'), 'request-a');
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ contractVersion: 1, requestId: 'request-a', error: { code, retryable: expect.any(Boolean) } });
    expect(JSON.stringify(body)).not.toContain('SECRET_SENTINEL');
  });

  it('未知异常不返回堆栈/路径/密钥，也不相信伪造code对象', async () => {
    for (const error of [new Error('SECRET_SENTINEL'), { code: 'NOT_FOUND', message: 'SECRET_SENTINEL' }]) {
      const response = fail(error, 'request-a');
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('SECRET_SENTINEL');
    }
  });
});
