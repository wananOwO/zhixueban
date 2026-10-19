import { beforeEach, describe, expect, test } from 'vitest';
import { DELETE, GET, POST } from '@/app/api/prompts/route';
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from '@/app/api/settings/route';
import { getDb, resetDbForTest } from '@/lib/db';

describe('设置读写', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('PUT 后 GET 返回相同值', async () => {
    await PUT_SETTINGS(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcp_servers: [{ name: 's', url: 'http://x' }] }),
      }),
    );
    const body = await (await GET_SETTINGS()).json();
    expect(body.mcp_servers).toHaveLength(1);
  });

  test('API Key 不回传明文', async () => {
    await PUT_SETTINGS(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ llm_api_key: 'sk-secret-123' }),
      }),
    );
    const body = await (await GET_SETTINGS()).json();
    expect(body.llm_api_key).not.toBe('sk-secret-123');
    expect(body.llm_api_key).toMatch(/\*\*\*/);
  });
});

describe('自定义提示词 CRUD', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('创建 → 读取 → 删除', async () => {
    const created = await (
      await POST(
        new Request('http://localhost/api/prompts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '我的风格', contentMd: '用武侠小说的比喻讲代码' }),
        }),
      )
    ).json();
    expect(created.id).toBeTruthy();

    const list = await (await GET()).json();
    expect(list.templates).toHaveLength(1);
    expect(list.templates[0].name).toBe('我的风格');

    const del = await DELETE(
      new Request(`http://localhost/api/prompts?id=${created.id}`, { method: 'DELETE' }),
    );
    expect(del.status).toBe(200);
    expect((await (await GET()).json()).templates).toHaveLength(0);
  });

  test('导入导出往返一致', async () => {
    const md = '---\nname: 导入模板\n---\n\n逐字逐句带读教材。';
    const created = await (
      await POST(
        new Request('http://localhost/api/prompts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ import: md }),
        }),
      )
    ).json();
    const db = getDb(':memory:');
    const row = db.prepare('SELECT name, content_md FROM prompt_templates WHERE id = ?').get(created.id) as {
      name: string;
      content_md: string;
    };
    expect(row.name).toBe('导入模板');
    expect(row.content_md).toContain('逐字逐句');
  });
});
