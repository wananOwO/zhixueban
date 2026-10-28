import { expect, test } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

const input = { title: '蓝桥杯 Python', textbookId: 'b1', sources: [{ sourceId: 'b1', sourceRevision: 'r1', chapterIds: ['ch1'] }], goal: '学会 Python 基础', teachingPrompt: '', priorKnowledgeText: '', includedTopics: [], excludedTopics: [], allowSupplementalSources: true, assessment: { pointQuestionCount: 3, chapterQuestionCount: 10, finalQuestionCount: 10, difficulty: 'easy', progressionPolicy: 'completed' }, mode: 'practice', subjectType: 'computer', programmingLanguage: 'python', templateId: 'builtin:computer' };
const job = (status: string, extra: Record<string, unknown> = {}) => ({ jobId: 'j1', kind: 'curriculum', status, stage: status === 'running' ? 'Agent：读取原文' : status, eventCursor: 3, attempts: 1, result: null, error: null, resumable: false, ...extra });
const cite = (paragraphIndex: number) => ({ sourceId: 'b1', sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex, quote: `第 ${paragraphIndex} 段原文` });
const points = [
  { id: 'print', title: '运行程序与 print()', prerequisiteIds: [], relatedIds: [], citations: [cite(761)] },
  { id: 'vars', title: '变量与数值运算', prerequisiteIds: ['print'], relatedIds: [], citations: [cite(766)] },
  { id: 'input', title: 'input() 与 int()', prerequisiteIds: ['vars'], relatedIds: [], citations: [cite(900)] },
];
const reviewDraft = (issues: unknown[] = [], choices?: unknown) => ({
  draftId: 'd1', revision: 3, input, state: 'review', generationJobId: 'j1', generatedFromRevision: 3, versionId: 'v1', confirmed: null,
  review: { proposal: { points, targetIds: ['input'], declaredIds: [] }, choices: choices ?? { targetIds: ['input'], excludedIds: [], declaredIds: [], order: null, prerequisiteEdits: [], supplementalSourceIds: [] }, report: { input, issues, includedIds: ['print', 'vars', 'input'], skippedIds: [], decisions: [] }, input, jobId: 'j1', stale: false },
});
const sse = (events: string[]) => ({ raw: { contentType: 'text/event-stream; charset=utf-8', body: events.join('') } });
const progress = (cursor: number, message: string) => `id: ${cursor}\nevent: progress\ndata: ${JSON.stringify({ cursor, stage: 'curriculum', message, createdAt: `2026-10-27T10:00:0${cursor}.000Z` })}\n\n`;

test.describe('生成过程与方案审核', () => {
  test('生成中：执行记录逐条出现，书带画出读取范围与出处', async ({ page }) => {
    const generating = { ...reviewDraft(), state: 'generating', review: null };
    await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: generating }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /jobs/j1': () => ({ data: job('running') }),
      'GET /jobs/j1/stream': () => sse([progress(1, '任务已排队'), progress(2, 'Agent：读取原文'), `event: job\ndata: ${JSON.stringify(job('running'))}\n\n`]),
      'GET /jobs/j1/trace': () => ({ data: {
        stages: [{ stageId: 'curriculum', requests: 4, steps: [
          { at: 1, tool: 'search_sources', label: '搜索资料', ok: true, search: 'print 函数' },
          { at: 2, tool: 'read_source', label: '读取原文', ok: true, read: { sourceId: 'b1', chapterId: 'ch1', from: 680, to: 699 } },
          { at: 3, tool: 'submit_curriculum_point', label: '提交知识点', ok: false, section: 'print', error: '引文与原文不一致，Agent 重新读取原文修正' },
          { at: 4, tool: 'submit_curriculum_point', label: '提交知识点', ok: true, section: 'print', cites: [{ sourceId: 'b1', paragraphIndex: 761 }] },
        ] }],
        sources: [{ sourceId: 'b1', title: 'Python 官方教程', paragraphs: 4049 }],
      } }),
    });
    await page.goto('/drafts/d1');
    await expect(page.getByRole('heading', { name: '正在生成课程方案' })).toBeVisible();
    await expect(page.getByText('读取原文：Python 官方教程 第 680–699 段')).toBeVisible();
    await expect(page.getByText('引文与原文不一致，Agent 重新读取原文修正')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Python 官方教程：共 4,049 段，Agent 读过 20 段，课件引用 1 处' })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  });

  test('服务器重启丢失 Key：显示原因与继续任务', async ({ page }) => {
    const generating = { ...reviewDraft(), state: 'generating', review: null };
    const failed = job('failed', { resumable: true, error: { code: 'MODEL_KEY_REQUIRED', message: '需要模型 Key', retryable: true } });
    await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: generating }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /jobs/j1': () => ({ data: failed }),
      'GET /jobs/j1/stream': () => sse([progress(1, '任务已排队'), `event: job\ndata: ${JSON.stringify(failed)}\n\n`, 'event: end\ndata: {}\n\n']),
      'GET /jobs/j1/trace': () => ({ data: { stages: [], sources: [] } }),
    });
    await page.goto('/drafts/d1');
    await expect(page.getByText('服务器已重启，模型 Key 只保存在你的浏览器里')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续任务' })).toBeVisible();
    await expect(page.getByRole('button', { name: '返回编辑并重新生成' })).toBeVisible();
  });

  test('审核：排除必需先修后出现问题且不能确认；修正后勾选核对即可确认并进入学习', async ({ page }) => {
    let current = reviewDraft();
    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: current }),
      'GET /textbooks': () => ({ data: [book()] }),
      'POST /drafts/d1/choices': ({ body }) => {
        const choices = (body as { choices: { excludedIds: string[] } }).choices;
        const issues = choices.excludedIds.includes('vars') ? [{ code: 'EXCLUDED_PREREQUISITE', knowledgePointIds: ['vars'], message: '排除项仍是目标或必要先修' }] : [];
        current = { ...reviewDraft(issues, choices), revision: current.revision + 1 };
        return { data: current };
      },
      'POST /drafts/d1/confirm': () => ({ data: { courseId: 'c1', versionId: 'v1', sessionId: 's1' } }),
      'GET /sessions/s1': () => ({ status: 404, error: { code: 'NOT_FOUND', message: '测试中不需要' } }),
    });
    await page.goto('/drafts/d1');
    await expect(page.getByRole('heading', { name: '先修路线图' })).toBeVisible();
    await page.getByRole('button', { name: /变量与数值运算，自动先修/ }).click();
    await page.getByText('排除', { exact: true }).click();
    await page.getByRole('button', { name: '保存并校验调整' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '排除了必需的先修知识点' })).toBeVisible();
    await page.getByLabel('我已核对出处覆盖与先修关系').check();
    await expect(page.getByRole('button', { name: '确认并创建课程' })).toBeDisabled();

    await page.getByText('跟随先修自动决定').click();
    await page.getByRole('button', { name: '保存并校验调整' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '排除了必需的先修知识点' })).toHaveCount(0);
    await page.getByLabel('我已核对出处覆盖与先修关系').check();
    await page.getByRole('button', { name: '确认并创建课程' }).click();
    await expect(page).toHaveURL(/\/learn\/s1$/);
    expect(calls.some(c => c.path === '/drafts/d1/confirm' && (c.body as { acceptSourceAndPrerequisiteReview: boolean }).acceptSourceAndPrerequisiteReview)).toBe(true);
  });

  test('审核：点知识点出处打开原文抽屉', async ({ page }) => {
    await mockApi(page, {
      ...baseRoutes,
      'GET /drafts/d1': () => ({ data: reviewDraft() }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /textbooks/b1': () => ({ data: book() }),
      'GET /textbooks/b1/chapters/ch1': ({ url }) => {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const base = 700;
        return { data: { chapterId: 'ch1', title: '第一章', paragraphs: Array.from({ length: 100 }, (_, i) => ({ paragraphIndex: base + offset + i, text: `第 ${base + offset + i} 段原文`, contentHash: 'h' })), nextOffset: offset + 100 < 300 ? offset + 100 : null } };
      },
    });
    await page.goto('/drafts/d1');
    await page.getByRole('button', { name: /运行程序与 print\(\)/ }).first().click();
    await page.getByRole('button', { name: /教材 · 第 761 段/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.locator('[aria-current="location"]')).toHaveText('第 761 段原文');
  });
});
