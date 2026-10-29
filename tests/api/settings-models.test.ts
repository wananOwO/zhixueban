import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from '@/app/api/settings/models/route';
import { resetDbForTest } from '@/lib/db';
import { getConfig, setConfig } from '@/lib/llm/config';

const fetchMock = vi.fn();
function request(body: unknown, origin?: string) {
  return POST(new Request('http://localhost/api/settings/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }));
}
const list = { target: 'llm', action: 'list', settings: {} };

describe('模型列表与连接测试（仅模拟外部网络）', () => {
  beforeEach(() => {
    resetDbForTest();
    vi.stubEnv('DB_PATH', ':memory:');
    vi.stubEnv('DEMO_MODE', '');
    for (const key of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER',
      'EMBEDDING_API_KEY', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL']) vi.stubEnv(key, '');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setConfig('llm_api_key', 'stored-secret-key');
    setConfig('llm_base_url', 'https://model.test/v1');
  });

  afterEach(() => {
    resetDbForTest();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('使用已保存密钥拉取列表，去重排序，不返回密钥', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'z' }, { id: 'a' }, { id: 'z' }] })));
    const res = await request(list);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.models).toEqual(['a', 'z']);
    expect(JSON.stringify(body)).not.toContain('stored-secret-key');
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://model.test/v1/models');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer stored-secret-key');
    expect(options.redirect).toBe('error');
  });

  test('未保存的新地址和新密钥可直接测试，且不修改配置', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'new-model' }] })));
    const res = await request({ ...list, settings: { llm_base_url: 'https://new.test/v1/', llm_api_key: 'new-secret' } });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://new.test/v1/models');
    expect(getConfig('llm_base_url')).toBe('https://model.test/v1');
    expect(getConfig('llm_api_key')).toBe('stored-secret-key');
  });

  test('新域名不得借用已保存密钥', async () => {
    expect((await request({ ...list, settings: { llm_base_url: 'https://new.test/v1' } })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Anthropic 使用原生认证并读完分页', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'first' }], has_more: true, last_id: 'first' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'second' }], has_more: false })));
    const res = await request({ ...list, settings: {
      llm_provider: 'anthropic', llm_base_url: 'https://claude.test/v1', llm_api_key: 'claude-secret',
    } });
    expect((await res.json()).models).toEqual(['first', 'second']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/v1/models');
    expect(new Headers(options.headers).get('x-api-key')).toBe('claude-secret');
    expect(new Headers(options.headers).get('anthropic-version')).toBe('2023-06-01');
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('after_id')).toBe('first');
  });

  test('对话测试真正走所选模型的推理接口', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'audit', object: 'chat.completion', created: 1, model: 'selected-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })));
    const res = await request({ action: 'test', target: 'llm', settings: { llm_model: 'selected-model' } });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://model.test/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('selected-model');
  });

  test('Anthropic 推理使用用户填写的 Base URL', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'audit', type: 'message', role: 'assistant', model: 'selected-claude',
      content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })));
    const res = await request({ action: 'test', target: 'llm', settings: {
      llm_provider: 'anthropic', llm_base_url: 'https://claude.test/v1',
      llm_api_key: 'claude-key', llm_model: 'selected-claude',
    } });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://claude.test/v1/messages');
  });

  test('检索模型独立验证 embeddings，报告向量维度', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      object: 'list', model: 'embedding-model', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })));
    const res = await request({ action: 'test', target: 'embedding', settings: {
      embedding_base_url: 'https://embedding.test/v1', embedding_api_key: 'embedding-key', embedding_model: 'embedding-model',
    } });
    expect(res.status).toBe(200);
    expect((await res.json()).dimensions).toBe(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://embedding.test/v1/embeddings');
  });

  test.each([401, 403, 404, 429, 500])('上游 %i 返回可读提示，不透出上游密钥或响应体', async (status) => {
    fetchMock.mockResolvedValue(new Response('stored-secret-key raw upstream details', { status }));
    const res = await request(list);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/密钥|Key|接口|频率|服务/);
    expect(JSON.stringify(body)).not.toContain('stored-secret-key');
    expect(JSON.stringify(body)).not.toContain('raw upstream');
  });

  test('超时给出重试提示', async () => {
    fetchMock.mockRejectedValue(new DOMException('private upstream address', 'TimeoutError'));
    const res = await request(list);
    expect(res.status).toBe(504);
    expect((await res.json()).error).toContain('超时');
  });

  test('列表格式不符时不假装成功', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'wrong shape' })));
    expect((await request(list)).status).toBe(502);
  });

  test('循环分页会终止并提示手动填写', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      data: [{ id: 'same' }], has_more: true, last_id: 'same',
    })));
    const res = await request({ ...list, settings: {
      llm_provider: 'anthropic', llm_base_url: 'https://claude.test/v1', llm_api_key: 'new-key',
    } });
    expect(res.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('空模型名和非法请求在发起网络请求前被拦截', async () => {
    expect((await request({ action: 'test', target: 'llm', settings: { llm_model: '' } })).status).toBe(400);
    expect((await request({ ...list, settings: { llm_base_url: 'file:///a' } })).status).toBe(400);
    expect((await request({ ...list, target: 'unknown' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('演示模式和跨来源请求都不调用外部模型', async () => {
    expect((await request(list, 'https://other.test')).status).toBe(403);
    vi.stubEnv('DEMO_MODE', 'true');
    expect((await request(list)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
