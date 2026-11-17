import { describe, expect, it, vi } from 'vitest';
// 只校验公网地址时不会真的解析域名：统一返回公网 IP
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));
import { createEmbeddingPort } from '@/lib/verified-learning/retrieval/embedding';

const config = { baseUrl: 'https://api.example.com/v1', model: 'embed-mini', apiKey: 'sk-test-secret' };

describe('Embedding 调用层', () => {
  it('一次请求批量取得向量并返回维度', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
      expect(String(input)).toBe('https://api.example.com/v1/embeddings');
      const sent = JSON.parse(String(init?.body));
      expect(sent.model).toBe('embed-mini');
      expect(sent.input).toEqual(['甲', '乙']);
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }] }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const port = createEmbeddingPort(config);
    expect(await port.embed(['甲', '乙'])).toEqual([[1, 0], [0, 1]]);
    vi.unstubAllGlobals();
  });

  it('供应商报错时抛出错误且不泄露 Key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad key ${config.apiKey}` } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const port = createEmbeddingPort(config);
    await expect(port.embed(['甲'])).rejects.toThrow();
    try { await port.embed(['甲']); } catch (error) { expect(String(error)).not.toContain(config.apiKey); }
    vi.unstubAllGlobals();
  });

  it('空文本列表不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await createEmbeddingPort(config).embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('publicOnly 时拒绝内网地址，不发出请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const port = createEmbeddingPort({ ...config, baseUrl: 'http://169.254.169.254/v1' }, { publicOnly: true });
    await expect(port.embed(['甲'])).rejects.toThrow(/公网/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('按返回项的 index 对齐顺序，并在单请求超时时中止且遮蔽 Key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }],
    }), { headers: { 'content-type': 'application/json' } })));
    const port = createEmbeddingPort(config);
    expect(await port.embed(['甲', '乙'])).toEqual([[1, 0], [0, 1]]);

    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(`request aborted for ${config.apiKey}`)));
    })));
    const fastTimeout = createEmbeddingPort(config, { timeoutMs: 20 });
    await expect(fastTimeout.embed(['甲'])).rejects.toSatisfy((err: unknown) => !String(err).includes(config.apiKey));
    vi.unstubAllGlobals();
  });
});
