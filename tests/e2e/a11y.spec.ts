import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

/**
 * 无障碍：13 个页面（模拟数据）跑 axe，serious / critical 违规为 0；
 * Tab 键能到达每页的主要控件，且焦点可见（有 outline）。
 */
const kp = (id: string, title: string, role: 'target' | 'prerequisite', pre: string[] = []) => ({ knowledgePointId: id, title, role, prerequisiteIds: pre, sourceIds: ['b1'], coverage: 'covered', reason: '' });
const points = [kp('print', '运行程序与 print()', 'prerequisite'), kp('vars', '变量与数值运算', 'prerequisite', ['print']), kp('input', 'input() 与 int()', 'target', ['vars'])];
const outline = [{ moduleId: 'm1', title: '第一章', points }];
const cite = (paragraphIndex: number) => ({ sourceId: 'b1', sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex, quote: `第 ${paragraphIndex} 段原文` });
const course = { courseId: 'c1', versionId: 'v1', status: 'active', sessionId: 's1', snapshot: { goal: '参加蓝桥杯', outline, sourceRevisions: [{ sourceId: 'b1', sourceRevision: 'r1' }] } };
const lessonActivity = { activityId: 'a1', kind: 'lesson', moduleId: 'm1', knowledgePointIds: ['print'], questionCount: 0 };
const lessonRun = { runId: 'r1', status: 'ready', activity: lessonActivity, questions: [], content: { markdown: '## print()\n\n解释器看到括号里的内容，就打印到屏幕上。\n\n```python\nprint("hi")\n```', citations: [cite(761)] } };
const session = (run: unknown) => ({
  session: { sessionId: 's1', courseId: 'c1', courseVersionId: 'v1', mode: 'practice', revision: 1, completedActivityIds: [] },
  version: { courseId: 'c1', courseVersionId: 'v1', goal: '参加蓝桥杯', outline },
  next: { kind: 'activity', activity: lessonActivity }, currentRun: run, cursor: null,
});
const input = { title: '蓝桥杯 Python', textbookId: 'b1', sources: [{ sourceId: 'b1', sourceRevision: 'r1', chapterIds: ['ch1'] }], goal: '学会 Python 基础', teachingPrompt: '', priorKnowledgeText: '', includedTopics: [], excludedTopics: [], allowSupplementalSources: true, assessment: { pointQuestionCount: 3, chapterQuestionCount: 10, finalQuestionCount: 10, difficulty: 'easy', progressionPolicy: 'completed' }, mode: 'practice', subjectType: 'computer', programmingLanguage: 'python', templateId: 'builtin:computer' };
const proposalPoints = [{ id: 'print', title: '运行程序与 print()', prerequisiteIds: [], relatedIds: [], citations: [cite(761)] }, { id: 'input', title: 'input() 与 int()', prerequisiteIds: ['print'], relatedIds: [], citations: [cite(900)] }];
const draft = (state: string, extra: Record<string, unknown> = {}) => ({
  draftId: 'd1', revision: 3, input, state, generationJobId: state === 'editing' ? null : 'j1', generatedFromRevision: 3, versionId: 'v1', confirmed: null, updatedAt: '2026-10-27T10:00:00.000Z',
  review: state === 'review' ? { proposal: { points: proposalPoints, targetIds: ['input'], declaredIds: [] }, choices: { targetIds: ['input'], excludedIds: [], declaredIds: [], order: null, prerequisiteEdits: [], supplementalSourceIds: [] }, report: { input, issues: [], includedIds: ['print', 'input'], skippedIds: [], decisions: [] }, input, jobId: 'j1', stale: false } : null,
  ...extra,
});
const chapter = ({ url }: { url: URL }) => {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return { data: { chapterId: 'ch1', title: '第一章', paragraphs: Array.from({ length: 20 }, (_, i) => ({ paragraphIndex: 700 + offset + i, text: `第 ${700 + offset + i} 段原文`, contentHash: 'h' })), nextOffset: null } };
};
const job = (status: string) => ({ jobId: 'j1', kind: 'curriculum', status, stage: status, eventCursor: 1, attempts: 1, result: null, error: null, resumable: false });
const progress = { courseId: 'c1', versionId: 'v1', completedActivities: 0, attempts: { total: 0, correct: 0 }, dailyActivity: [], verifiedKnowledgePointIds: [], review: [], knowledgePoints: [], recent: { print: [false, true] }, evidenceQuestions: 2 };

const routes = {
  ...baseRoutes,
  'GET /courses': () => ({ data: [course] }),
  'GET /drafts': () => ({ data: [draft('editing', { draftId: 'd0' }), draft('review')] }),
  'GET /drafts/d1': () => ({ data: draft('review') }),
  'GET /drafts/d2': () => ({ data: draft('generating', { draftId: 'd2' }) }),
  'GET /drafts/d3': () => ({ data: draft('editing', { draftId: 'd3' }) }),
  'GET /textbooks': () => ({ data: [book()] }),
  'GET /textbooks/b1': () => ({ data: book() }),
  'GET /textbooks/b1/deletion': () => ({ data: { bookId: 'b1', revision: 0, blocked: true, blockers: [{ kind: 'course', id: 'v1', courseId: 'c1', status: 'active' }] } }),
  'GET /textbooks/b1/chapters/ch1': chapter,
  'GET /templates': () => ({ data: [] }),
  'GET /sessions/s1': () => ({ data: session({ runId: 'r1', status: 'ready', activity: lessonActivity, jobId: null }) }),
  'GET /runs/r1': () => ({ data: lessonRun }),
  'GET /progress': () => ({ data: progress }),
  'GET /sessions/s1/history': () => ({ data: [{ runId: 'r1', status: 'completed', activity: lessonActivity, createdAt: '2026-10-22T18:25:51.000Z' }] }),
  'GET /sessions/s1/history/r1': () => ({ data: { ...lessonRun, status: 'completed' } }),
  'GET /notes': () => ({ data: [] }),
  'GET /jobs/j1': () => ({ data: job('running') }),
  'GET /jobs/j1/stream': () => ({ raw: { contentType: 'text/event-stream', body: `id: 1\nevent: progress\ndata: ${JSON.stringify({ cursor: 1, stage: 'curriculum', message: 'Agent：读取原文', createdAt: '2026-10-27T10:00:01.000Z' })}\n\n` } }),
  'GET /jobs/j1/trace': () => ({ data: { stages: [{ stageId: 'curriculum', requests: 2, steps: [{ at: 1, tool: 'read_source', label: '读取原文', ok: true, read: { sourceId: 'b1', chapterId: 'ch1', from: 1, to: 20 } }] }], sources: [{ sourceId: 'b1', title: 'Python 官方教程', paragraphs: 400 }] } }),
  'GET /settings': () => ({ data: { llm_provider: 'openai-compatible', llm_model: 'deepseek-chat', llm_base_url: '', llm_api_key_configured: true } }),
  'GET /judge': () => ({ status: 502, error: { code: 'JUDGE_UNAVAILABLE', message: '判题服务不可用' } }),
};

const PAGES: [string, string][] = [
  ['首页', '/'],
  ['教材库', '/library'],
  ['教材详情', '/library/b1'],
  ['课程草稿', '/drafts'],
  ['草稿编辑', '/drafts/d3'],
  ['生成过程', '/drafts/d2'],
  ['方案审核', '/drafts/d1'],
  ['我的课程', '/courses'],
  ['课程主页', '/courses/c1'],
  ['学习', '/learn/s1'],
  ['历史回看', '/learn/s1/history'],
  ['设置', '/settings'],
];

async function scan(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}

/** Tab 遍历：记录每个焦点元素的名称与是否有可见 outline */
async function tabThrough(page: Page, steps = 40) {
  const seen: { name: string; visible: boolean }[] = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // 焦点指示可以在元素本身，也可以在用 focus-within 画框的外层（如标签输入框、助教提问栏）
      const ringOf = (node: Element | null) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        return (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      };
      const visible = ringOf(el) || ringOf(el.parentElement) || ringOf(el.parentElement?.parentElement ?? null);
      const label = (el as HTMLInputElement).labels?.[0]?.textContent;
      const name = (el.getAttribute('aria-label') || label || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 40);
      return { name, visible };
    });
    if (info) seen.push(info);
  }
  return seen;
}

test.describe('无障碍', () => {
  for (const [name, path] of PAGES) {
    test(`${name}：axe 无严重违规，Tab 可达且焦点可见`, async ({ page }) => {
      await mockApi(page, routes);
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      await page.waitForLoadState('networkidle');
      expect(await scan(page)).toEqual([]);
      const focused = await tabThrough(page);
      expect(focused.length).toBeGreaterThan(3);
      expect(focused.filter(f => !f.visible)).toEqual([]);
    });
  }

  test('登录：axe 无严重违规，访问码输入框可用 Tab 到达', async ({ page }) => {
    await mockApi(page, { ...routes, 'GET /access': () => ({ status: 401, error: { code: 'UNAUTHENTICATED', message: '请先登录' } }) });
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await scan(page)).toEqual([]);
    const focused = await tabThrough(page, 10);
    expect(focused.some(f => /密码|访问码|登录/.test(f.name))).toBe(true);
    expect(focused.filter(f => !f.visible)).toEqual([]);
  });

  test('手机宽度 390px：课程主页与学习页 axe 无严重违规', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, routes);
    for (const path of ['/courses/c1', '/learn/s1']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await scan(page), path).toEqual([]);
    }
  });
});
