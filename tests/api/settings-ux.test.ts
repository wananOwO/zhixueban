import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GET, PUT } from '@/app/api/settings/route';
import { getDb, resetDbForTest } from '@/lib/db';
import { getConfig } from '@/lib/llm/config';

function save(body: unknown, origin?: string) {
  return PUT(new Request('http://localhost/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('设置页的有效配置与可靠保存', () => {
  beforeEach(() => {
    resetDbForTest();
    vi.stubEnv('DB_PATH', ':memory:');
    for (const key of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_PROVIDER',
      'EMBEDDING_API_KEY', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL', 'DEMO_MODE']) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    resetDbForTest();
    vi.unstubAllEnvs();
  });

  test('展示环境变量中的有效配置，密钥始终脱敏', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic');
    vi.stubEnv('LLM_API_KEY', 'sk-environment-secret');
    vi.stubEnv('LLM_MODEL', 'configured-model');
    const body = await (await GET()).json();
    expect(body.llm_provider).toBe('anthropic');
    expect(body.llm_model).toBe('configured-model');
    expect(body.llm_base_url).toBe('https://api.anthropic.com/v1');
    expect(body.llm_api_key).toMatch(/\*\*\*/);
    expect(JSON.stringify(body)).not.toContain('sk-environment-secret');
  });

  test('明确清除密钥后不再悄悄回退到环境变量', async () => {
    vi.stubEnv('LLM_API_KEY', 'env-key');
    expect((await save({ llm_api_key: '' })).status).toBe(200);
    expect(getConfig('llm_api_key')).toBeUndefined();
    expect((await (await GET()).json()).llm_api_key).toBe('');
  });

  test('保存空地址可恢复继承关系，普通保存不覆盖已有密钥', async () => {
    await save({ llm_api_key: 'saved-key', embedding_base_url: 'https://embed.test/v1' });
    expect((await save({ llm_model: 'another-model', embedding_base_url: '' })).status).toBe(200);
    expect(getConfig('llm_api_key')).toBe('saved-key');
    expect(getConfig('embedding_base_url')).toBeUndefined();
  });

  test('整份配置先校验，非法字段不会造成部分写入', async () => {
    await save({ llm_model: 'original' });
    expect((await save({ llm_model: 'changed', unknown: 'invalid' })).status).toBe(400);
    expect(getConfig('llm_model')).toBe('original');
  });

  test.each([
    [],
    { llm_provider: 'unknown' },
    { llm_model: 42 },
    { llm_api_key: 'sk-***et' },
    { llm_base_url: 'file:///private' },
    { llm_base_url: 'not-a-url' },
    { llm_base_url: 'https://user:password@host.test/v1' },
    { mcp_servers: [{ name: 'same', url: 'https://a.test' }, { name: 'same', url: 'https://b.test' }] },
  ].map((body) => ({ body })))('拒绝不合法的配置：$body', async ({ body }) => {
    expect((await save(body)).status).toBe(400);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });

  test('跨来源页面不得修改本机配置', async () => {
    expect((await save({ llm_model: 'changed' }, 'https://other.test')).status).toBe(403);
    expect(getConfig('llm_model')).toBeUndefined();
  });

  test('更换服务域名时要求重新提供密钥，避免向新服务发送旧密钥', async () => {
    await save({ llm_base_url: 'https://original.test/v1', llm_api_key: 'original-key' });
    expect((await save({ llm_base_url: 'https://different.test/v1' })).status).toBe(400);
    expect(getConfig('llm_base_url')).toBe('https://original.test/v1');
    expect((await save({ llm_base_url: 'https://different.test/v1', llm_api_key: 'new-key' })).status).toBe(200);
  });

  test('已有索引时阻止静默切换向量空间，但允许轮换密钥', async () => {
    await save({ llm_base_url: 'https://model.test/v1', llm_api_key: 'key' });
    getDb().prepare("INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('t', 'Book', 'txt', 'fixture.txt', '{}', '2026-10-20')").run();
    getDb().prepare("INSERT INTO chunks (id, textbook_id, chapter_id, content, anchor) VALUES ('c', 't', 'ch', 'text', '{}')").run();
    const result = await save({ embedding_model: 'different-embedding', llm_model: 'also-changed' });
    expect(result.status).toBe(409);
    expect(getConfig('embedding_model')).toBeUndefined();
    expect(getConfig('llm_model')).toBeUndefined();
    expect((await save({ llm_api_key: 'rotated-key' })).status).toBe(200);
    expect((await (await GET()).json()).hasIndexedContent).toBe(true);
  });

  test('演示模式告知前端只读状态', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    expect((await (await GET()).json()).readOnly).toBe(true);
    expect((await save({ llm_model: 'changed' })).status).toBe(403);
  });
});
