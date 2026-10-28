import { expect, test } from '@playwright/test';
import { baseRoutes, mockApi } from './mock-api';

const localSettings = { llm_provider: 'openai-compatible', llm_model: 'deepseek-chat', llm_base_url: 'https://api.deepseek.com/v1', llm_api_key_configured: true, embedding_model: '', embedding_base_url: '', embedding_api_key_configured: false };
const online = { 'GET /mode': () => ({ data: { mode: 'online', uploadLimitBytes: 20 * 1024 * 1024, booksPerSpace: 10 } }) };
const judgeOk = { 'GET /judge': () => ({ data: { languages: [{ id: 71, name: 'Python (3.8.1)' }, { id: 63, name: 'JavaScript (Node.js 12.14.0)' }] } }) };

test.describe('设置页', () => {
  test('本地模式：保存发出 PATCH，API Key 留空表示保持原值', async ({ page }) => {
    const calls = await mockApi(page, {
      ...baseRoutes,
      ...judgeOk,
      'GET /settings': () => ({ data: localSettings }),
      'PATCH /settings': ({ body }) => ({ data: { ...localSettings, ...(body as object), llm_api_key_configured: true } }),
    });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', /已配置/);
    await page.getByLabel('模型名称').fill('deepseek-reasoner');
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    const patch = calls.find(c => c.method === 'PATCH' && c.path === '/settings');
    expect(patch?.body).toMatchObject({ llm_model: 'deepseek-reasoner', llm_api_key: '' });
  });

  test('线上模式：保存不发 PATCH，写入 localStorage；清除后为空', async ({ page }) => {
    const calls = await mockApi(page, { ...baseRoutes, ...online, ...judgeOk, 'GET /settings': () => ({ data: { llm_provider: 'openai-compatible', online: true } }) });
    await page.goto('/settings');
    await expect(page.getByText('Key 只保存在这个浏览器里')).toBeVisible();
    await expect(page.getByLabel('Embedding 模型')).toHaveCount(0);
    await page.getByLabel('API 地址').fill('https://api.deepseek.com/v1');
    await page.getByLabel('API Key', { exact: true }).fill('sk-test-online');
    await page.getByLabel('模型名称').fill('deepseek-chat');
    await page.getByRole('button', { name: '保存到本浏览器' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存到本浏览器' })).toBeVisible();
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
    const saved = await page.evaluate(() => localStorage.getItem('vl-model'));
    expect(JSON.parse(saved!).state.config).toEqual({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test-online', model: 'deepseek-chat' });

    await page.getByRole('button', { name: '清除 Key' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '清除' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vl-model') ?? '{"state":{"config":null}}').state.config)).toBeNull();
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  });

  test('线上模式拉取模型列表带 X-VL-Model 请求头；失败时显示错误并允许手填', async ({ page }) => {
    let fail = true;
    const calls = await mockApi(page, {
      ...baseRoutes,
      ...online,
      ...judgeOk,
      'GET /settings': () => ({ data: { llm_provider: 'openai-compatible', online: true } }),
      'POST /settings/models': () => (fail
        ? { status: 502, error: { code: 'UPSTREAM_ERROR', message: '模型供应商返回 401：密钥无效', retryable: true } }
        : { data: { models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }, { id: 'deepseek-reasoner', name: 'deepseek-reasoner' }], truncated: false } }),
    });
    await page.goto('/settings');
    await page.getByLabel('API 地址').fill('https://api.deepseek.com/v1');
    await page.getByLabel('API Key', { exact: true }).fill('sk-wrong');
    await page.getByRole('button', { name: '拉取模型列表' }).click();
    await expect(page.getByRole('region', { name: '模型供应商' }).getByRole('alert')).toContainText('密钥无效');
    await expect(page.getByLabel('模型名称')).toBeEditable();
    const first = calls.find(c => c.path === '/settings/models');
    expect(first?.headers['x-vl-model']).toBeTruthy();
    // 请求头里的配置是当前表单内容（未保存时也一样），请求体不带 Key
    const decoded = JSON.parse(Buffer.from(first!.headers['x-vl-model'], 'base64url').toString('utf8'));
    expect(decoded).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-wrong' });
    expect(JSON.stringify(first?.body ?? {})).not.toContain('sk-wrong');

    fail = false;
    await page.getByLabel('API Key', { exact: true }).fill('sk-right');
    await page.getByRole('button', { name: '拉取模型列表' }).click();
    await page.getByLabel('选择模型').selectOption('deepseek-reasoner');
    await expect(page.getByLabel('模型名称')).toHaveValue('deepseek-reasoner');
  });

  test('判题服务不可用时说明影响；可用时列出语言', async ({ page }) => {
    await mockApi(page, { ...baseRoutes, 'GET /settings': () => ({ data: localSettings }), 'GET /judge': () => ({ status: 502, error: { code: 'JUDGE_UNAVAILABLE', message: '判题服务不可用' } }) });
    await page.goto('/settings');
    const judge = page.getByRole('region', { name: '判题服务' });
    await expect(judge).toContainText('判题服务未配置：编程题无法生成和判分，选择题、填空题不受影响');

    await mockApi(page, { ...baseRoutes, ...judgeOk, 'GET /settings': () => ({ data: localSettings }) });
    await page.reload();
    await expect(page.getByRole('region', { name: '判题服务' })).toContainText('Python (3.8.1)');
  });
});
