import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, POST, PATCH } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { getModel, getEmbeddingModel } from '@/lib/llm/provider';
import { getConfig } from '@/lib/llm/config';
import { testDirectory } from './db-fixtures';

const context = (name = 'settings') => ({ params: Promise.resolve({ path: [name] }) });
function request(method: string, body?: unknown, cookie?: string, origin = 'http://127.0.0.1:3101') {
  return new Request('http://127.0.0.1:3101/api/verified-learning/v1/settings', {
    method, headers: { host: '127.0.0.1:3101', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
let cookie: string;
beforeEach(async () => {
  const root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_LOCAL_AUTH', '1');
  vi.stubEnv('LLM_MODEL', 'environment-model');
  vi.stubEnv('LLM_PROVIDER', 'openai-compatible');
  vi.stubEnv('LLM_API_KEY', 'environment-secret');
  const token = randomBytes(32).toString('base64url');
  vi.stubEnv('VL_LOCAL_PASSWORD', token);
  await initializeVerifiedLearning('data/app.db', true, root);
  const response = await POST(request('POST', { token }), context('access'));
  cookie = response.headers.get('set-cookie')!;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('本机供应商设置', () => {
  it('模型列表受鉴权保护，错误提示明确且不泄露上游正文', async () => {
    const ctx = { params: Promise.resolve({ path: ['settings', 'models'] }) };
    const fetcher = vi.fn(async () => new Response('secret-upstream-body', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('POST', {}), ctx)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const result = await POST(request('POST', {}, cookie), ctx);
    expect(result.status).toBe(502);
    const text = await result.text();
    expect(text).toContain('鉴权失败');
    expect(text).not.toContain('secret-upstream-body');
    expect(getConfig('llm_model')).toBe('environment-model');
  });
  it('匿名读写与跨源写入均被拒绝', async () => {
    expect((await GET(request('GET'), context())).status).toBe(401);
    expect((await PATCH(request('PATCH', { llm_model: 'no' }), context())).status).toBe(401);
    expect((await PATCH(request('PATCH', {}, cookie, 'http://evil.example'), context())).status).toBe(403);
  });
  it('保存后模型即时采用配置，读取与保存响应均不泄露密钥', async () => {
    const response = await PATCH(request('PATCH', {
      llm_provider: 'anthropic', llm_model: 'claude-configured',
      llm_base_url: 'https://api.anthropic.com/v1', llm_api_key: 'private-test-secret',
      embedding_model: 'embedding-configured', embedding_api_key: 'embedding-private',
    }, cookie), context());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('private-test-secret');
    expect(text).not.toContain('embedding-private');
    expect(getModel().modelId).toBe('claude-configured');
    expect(getConfig('llm_provider')).toBe('anthropic');
    expect(getConfig('llm_base_url')).toBe('https://api.anthropic.com/v1');
    expect(getConfig('llm_api_key')).toBe('private-test-secret');
    expect(getEmbeddingModel().modelId).toBe('embedding-configured');
    const read = await GET(request('GET', undefined, cookie), context());
    const payload = await read.json();
    expect(payload.data).toMatchObject({ llm_provider: 'anthropic', llm_model: 'claude-configured', llm_api_key_configured: true });
    expect(JSON.stringify(payload)).not.toContain('private-test-secret');
  });
  it('空白密钥不覆盖，清除网页配置后回退环境变量', async () => {
    expect((await PATCH(request('PATCH', { llm_model: 'saved', llm_api_key: 'saved-secret' }, cookie), context())).status).toBe(200);
    expect((await PATCH(request('PATCH', { llm_model: 'edited', llm_api_key: '' }, cookie), context())).status).toBe(200);
    expect(getModel().modelId).toBe('edited');
    expect(getConfig('llm_api_key')).toBe('saved-secret');
    expect((await PATCH(request('PATCH', { llm_model: null }, cookie), context())).status).toBe(200);
    expect(getModel().modelId).toBe('environment-model');
  });
  it('Obsidian vault 路径可保存、读取与清除', async () => {
    const vault = path.join(testDirectory(), 'vault');
    expect((await PATCH(request('PATCH', { obsidian_vault_path: vault }, cookie), context())).status).toBe(200);
    expect((await (await GET(request('GET', undefined, cookie), context())).json()).data.obsidian_vault_path).toBe(vault);
    expect((await PATCH(request('PATCH', { obsidian_vault_path: null }, cookie), context())).status).toBe(200);
    expect((await (await GET(request('GET', undefined, cookie), context())).json()).data.obsidian_vault_path).toBe('');
  });
  it.each([{ llm_provider: 'invalid' }, { llm_base_url: 'javascript:alert(1)' }, { llm_model: 'changed', unexpected: 'bad' }, { obsidian_vault_path: 'relative/vault' }])('无效设置整批拒绝：%j', async (patch) => {
    expect((await PATCH(request('PATCH', patch, cookie), context())).status).toBe(400);
    expect(getModel().modelId).toBe('environment-model');
  });
});
