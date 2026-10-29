import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
import { assertPublicModelAddress } from '@/lib/verified-learning/model-keys';
import { publicOnlyFetch } from '@/lib/verified-learning/agent/web';

/**
 * 线上模式的模型地址来自评委浏览器：服务器会用它发请求，必须只允许公网地址（防 SSRF）。
 * 阿里云等云服务器的元数据地址（100.100.100.200、169.254.169.254）尤其要拒绝。
 */
const config = (baseUrl: string) => ({ provider: 'openai-compatible' as const, baseUrl, apiKey: 'sk-x', model: 'm' });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('线上模式模型地址只允许公网', () => {
  it.each([
    'http://127.0.0.1:11434/v1',
    'http://localhost/v1',
    'http://10.0.0.5/v1',
    'http://169.254.169.254/latest',
    'http://100.100.100.200/latest',
    'http://[::1]/v1',
    'https://8.8.8.8:8443/v1',
  ])('拒绝 %s', async url => {
    await expect(assertPublicModelAddress(config(url))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('域名解析到内网地址时拒绝', async () => {
    mocks.lookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }]);
    await expect(assertPublicModelAddress(config('https://llm.attacker.example/v1'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('域名无法解析时单独提示检查地址', async () => {
    mocks.lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    await expect(assertPublicModelAddress(config('https://no-such-host.example/v1'))).rejects.toThrow(/无法解析/);
  });

  it('公网地址通过', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(assertPublicModelAddress(config('https://api.deepseek.com/v1'))).resolves.toBeUndefined();
  });
});

describe('访问模型供应商的 fetch', () => {
  it('内网地址不发请求', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await expect(publicOnlyFetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('公网地址照常请求，且不跟随重定向（防止被跳转到内网）', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await publicOnlyFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(fetch).toHaveBeenCalledWith('https://api.deepseek.com/v1/chat/completions', expect.objectContaining({ method: 'POST', redirect: 'error' }));
  });
});
