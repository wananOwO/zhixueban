import { expect, test } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

const input = (overrides: Record<string, unknown> = {}) => ({
  title: '', textbookId: null, sources: [], goal: '', teachingPrompt: '', priorKnowledgeText: '',
  includedTopics: [], excludedTopics: [], allowSupplementalSources: true,
  assessment: { pointQuestionCount: 3, chapterQuestionCount: 10, finalQuestionCount: 10, difficulty: 'easy', progressionPolicy: 'completed' },
  mode: 'practice', subjectType: 'general', programmingLanguage: null, templateId: null, ...overrides,
});
const draft = (overrides: Record<string, unknown> = {}) => ({
  draftId: 'd1', revision: 0, input: input(), state: 'editing', generationJobId: null, generatedFromRevision: null,
  versionId: null, review: null, confirmed: null, updatedAt: '2026-10-27T08:00:00.000Z', ...overrides,
});
const templates = { builtins: ['general', 'computer', 'math'].map(s => ({ templateId: `builtin:${s}`, name: s, subjectType: s, content: '', revision: 0 })), custom: [] };
const snapshot = { sourceId: 'b1', sourceRevision: 'r1', title: 'Python 官方教程', format: 'md', chapters: [{ chapterId: 'ch1', title: '第一章 课前甜点', paragraphs: [] }, { chapterId: 'ch2', title: '第二章 使用解释器', paragraphs: [] }] };

test.describe('课程草稿', () => {
  test('输入目标后自动保存一次并显示已保存；409 冲突保留本地输入', async ({ page }) => {
    let current = draft();
    let conflict = false;
    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: current }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /templates': () => ({ data: templates }),
      'PATCH /drafts/d1': ({ body }) => {
        if (conflict) return { status: 409, error: { code: 'VERSION_CONFLICT', message: '内容已发生变化，请重新读取' } };
        const b = body as { input: Record<string, unknown> };
        current = draft({ revision: current.revision + 1, input: { ...current.input, ...b.input } });
        return { data: current };
      },
    });
    await page.goto('/drafts/d1');
    await page.getByLabel('学习目标').fill('能用 Python 写出蓝桥杯入门题');
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    expect(calls.filter(c => c.method === 'PATCH').length).toBe(1);

    conflict = true;
    await page.getByLabel('课程标题').fill('蓝桥杯 Python 入门');
    await expect(page.getByRole('alert').filter({ hasText: '草稿已在别处修改' })).toBeVisible();
    await expect(page.getByLabel('课程标题')).toHaveValue('蓝桥杯 Python 入门');
  });

  test('未选章节时列出阻塞原因；选章节后可生成', async ({ page }) => {
    let current = draft({ input: input({ goal: '学会 Python 基础' }) });
    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: current }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /templates': () => ({ data: templates }),
      'GET /textbooks/b1/source': () => ({ data: snapshot }),
      'PATCH /drafts/d1': ({ body }) => { current = draft({ revision: current.revision + 1, input: { ...current.input, ...(body as { input: object }).input } }); return { data: current }; },
      'POST /drafts/d1/generate': () => { current = draft({ ...current, state: 'generating', generationJobId: 'j1' }); return { status: 202, data: { jobId: 'j1', kind: 'curriculum', status: 'queued', stage: 'queued', eventCursor: 1, attempts: 0, result: null, error: null, resumable: false } }; },
    });
    await page.goto('/drafts/d1');
    const generate = page.getByRole('button', { name: '生成课程方案' });
    await expect(generate).toBeDisabled();
    await expect(page.getByText('请选择主教材')).toBeVisible();
    await page.getByRole('button', { name: /加入《Python 官方教程》/ }).click();
    await expect(page.getByText('请为第 1 本教材选择章节')).toBeVisible();
    await page.getByRole('button', { name: '全选章节' }).click();
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(() => calls.some(c => c.method === 'POST' && c.path === '/drafts/d1/generate')).toBe(true);
    const generateCall = calls.find(c => c.path === '/drafts/d1/generate')!;
    expect(generateCall.headers['idempotency-key']).toBeTruthy();
  });

  test('线上模式未填模型 Key 时不能生成，并提示去设置', async ({ page }) => {
    const current = draft({ input: input({ goal: '学会 Python 基础', textbookId: 'b1', sources: [{ sourceId: 'b1', sourceRevision: 'r1', chapterIds: ['ch1'] }] }) });
    await mockApi(page, {
      ...baseRoutes,
      'GET /mode': () => ({ data: { mode: 'online', uploadLimitBytes: 20 * 1024 * 1024, booksPerSpace: 10 } }),
      'GET /drafts/d1': () => ({ data: current }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /templates': () => ({ data: templates }),
      'GET /textbooks/b1/source': () => ({ data: snapshot }),
    });
    await page.goto('/drafts/d1');
    await expect(page.getByRole('button', { name: '生成课程方案' })).toBeDisabled();
    await expect(page.getByRole('link', { name: '去设置填写模型 Key' })).toBeVisible();
  });

  test('草稿列表：丢弃需要确认', async ({ page }) => {
    let list = [draft({ input: input({ title: '蓝桥杯 Python 入门', goal: '学会基础' }) })];
    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /drafts': () => ({ data: list }),
      'DELETE /drafts/d1': () => { list = []; return { data: { discarded: true } }; },
    });
    await page.goto('/drafts');
    await page.getByRole('button', { name: '丢弃《蓝桥杯 Python 入门》' }).click();
    const dialog = page.getByRole('dialog', { name: '丢弃这份草稿？' });
    await expect(dialog).toBeVisible();
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
    await dialog.getByRole('button', { name: '丢弃' }).click();
    await expect(page.getByText('还没有草稿')).toBeVisible();
  });
});
