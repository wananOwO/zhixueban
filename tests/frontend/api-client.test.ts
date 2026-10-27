// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, newKey } from '@/lib/api/client';

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('前端请求层', () => {
  it('成功信封返回 data', async () => {
    vi.stubGlobal('fetch', reply(200, { contractVersion: 1, requestId: 'r', data: { a: 1 } }));
    await expect(api('/textbooks')).resolves.toEqual({ a: 1 });
  });
  it('错误信封抛出带状态与错误码的 ApiError', async () => {
    vi.stubGlobal('fetch', reply(409, { contractVersion: 1, requestId: 'r', error: { code: 'VERSION_CONFLICT', message: '内容已发生变化', retryable: false } }));
    const error = await api('/drafts/d', { method: 'PATCH', body: {} }).catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', message: '内容已发生变化', retryable: false });
  });
  it('401 派发一次 vl:unauthorized', async () => {
    vi.stubGlobal('fetch', reply(401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }));
    const listener = vi.fn();
    window.addEventListener('vl:unauthorized', listener);
    await api('/courses').catch(() => undefined);
    window.removeEventListener('vl:unauthorized', listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('网络异常转为可重试的 NETWORK 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await api('/courses').catch(e => e);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK', retryable: true });
  });
  it('幂等键写入请求头；FormData 不设置 Content-Type', async () => {
    const fetch = reply(201, { data: {} });
    vi.stubGlobal('fetch', fetch);
    const key = newKey();
    await api('/textbooks', { method: 'POST', body: new FormData(), key });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe(key);
    expect(headers.has('content-type')).toBe(false);
    await api('/drafts', { method: 'POST', body: { a: 1 } });
    const json = new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers);
    expect(json.get('content-type')).toBe('application/json');
  });
});
