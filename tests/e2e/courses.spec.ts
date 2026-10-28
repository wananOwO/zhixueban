import { expect, test } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

// 课程结构取自开发库真实课程（18 个知识点、先修关系原样）
const P: [string, string, 'target' | 'prerequisite', string[]][] = [
  ['py-hello-print', '运行程序与 print()', 'prerequisite', []],
  ['py-variables-numbers', '变量与数值运算', 'prerequisite', ['py-hello-print']],
  ['py-input-int', 'input() 与 int()', 'target', ['py-variables-numbers']],
  ['py-if-conditions', 'if-elif-else 分支', 'prerequisite', ['py-variables-numbers']],
  ['py-list', '列表 list', 'prerequisite', ['py-variables-numbers']],
  ['py-for-range', 'for 与 range()', 'prerequisite', ['py-list']],
  ['py-while-break', 'while 与 break', 'prerequisite', ['py-if-conditions']],
  ['py-sort', 'sort() 与 sorted()', 'prerequisite', ['py-list']],
  ['py-dict', '字典 dict', 'target', ['py-list']],
  ['py-function', '函数 def 与 return', 'prerequisite', ['py-if-conditions', 'py-list']],
  ['algo-complexity', '时间复杂度', 'prerequisite', ['py-for-range']],
  ['algo-enumerate', '枚举', 'target', ['py-for-range', 'py-if-conditions', 'algo-complexity']],
  ['algo-prefix-sum', '一维前缀和', 'target', ['py-for-range', 'algo-complexity']],
  ['algo-binary-search', '二分查找', 'target', ['py-while-break', 'py-sort', 'algo-complexity']],
  ['algo-recursion', '递归', 'prerequisite', ['py-function']],
  ['algo-greedy', '贪心算法', 'target', ['py-sort', 'algo-enumerate']],
  ['algo-dp-basic', '动态规划基础', 'target', ['algo-recursion', 'py-list']],
  ['algo-bfs', '广度优先搜索', 'target', ['py-while-break', 'py-list', 'py-dict', 'py-function']],
];
const points = P.map(([knowledgePointId, title, role, prerequisiteIds]) => ({ knowledgePointId, title, role, prerequisiteIds, sourceIds: ['b1'], coverage: 'covered', reason: '' }));
const outline = [{ moduleId: 'm1', title: '第一章', points }];
const web = 'web:aaea';
const course = {
  courseId: 'c1', versionId: 'v1', status: 'active', sessionId: 's1',
  snapshot: { goal: '参加蓝桥杯 Python 组', outline, sourceRevisions: [{ sourceId: 'b1', sourceRevision: 'r1' }, { sourceId: web, sourceRevision: 'r2' }], createdAt: '2026-10-22T17:59:00.000Z' },
};
const lessonActivity = { activityId: 'a-lesson', kind: 'lesson', moduleId: 'm1', knowledgePointIds: ['py-hello-print'], questionCount: 0 };
const quizActivity = { activityId: 'a-quiz', kind: 'point_quiz', moduleId: 'm1', knowledgePointIds: ['py-hello-print'], questionCount: 3 };
const session = {
  session: { sessionId: 's1', courseId: 'c1', courseVersionId: 'v1', mode: 'practice', revision: 4, completedActivityIds: ['a-lesson', 'a-quiz'] },
  version: { courseId: 'c1', courseVersionId: 'v1', goal: '参加蓝桥杯 Python 组', outline },
  next: { kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['py-hello-print'] },
  currentRun: null,
  cursor: null,
};
const progress = {
  courseId: 'c1', versionId: 'v1', completedActivities: 2, attempts: { total: 3, correct: 1 }, dailyActivity: [],
  verifiedKnowledgePointIds: ['py-variables-numbers'], review: [],
  knowledgePoints: points.map(p => ({ ...p, mastery: p.knowledgePointId === 'py-variables-numbers' ? 'verified' : 'unverified' })),
  recent: { 'py-hello-print': [false, true], 'py-variables-numbers': [true, true, true] },
};
const history = [
  { runId: 'r-quiz', status: 'completed', activity: quizActivity, createdAt: '2026-10-22T18:33:50.000Z' },
  { runId: 'r-lesson', status: 'completed', activity: lessonActivity, createdAt: '2026-10-22T18:25:51.000Z' },
];
const jobs = [
  { jobId: 'j-lesson', kind: 'lesson', status: 'succeeded', stage: 'succeeded', eventCursor: 9, attempts: 1, result: { kind: 'lesson', id: 'r-lesson' }, error: null, resumable: false },
  { jobId: 'j-plan', kind: 'curriculum', status: 'succeeded', stage: 'succeeded', eventCursor: 30, attempts: 1, result: { kind: 'course', id: 'c1', versionId: 'v0' }, error: null, resumable: false },
];
const trace = (sourceTitle: string) => ({
  stages: [{ stageId: 'x', requests: 3, steps: [
    { at: 1, tool: 'read_source', label: '读取原文', ok: true, read: { sourceId: 'b1', chapterId: 'ch1', from: 680, to: 699 } },
    { at: 2, tool: 'submit_lesson_section', label: '提交小节', ok: true, section: 's1', cites: [{ sourceId: 'b1', paragraphIndex: 761 }, { sourceId: 'b1', paragraphIndex: 766 }] },
  ] }],
  sources: [{ sourceId: 'b1', title: sourceTitle, paragraphs: 4049 }],
});
const lessonRun = { runId: 'r-lesson', status: 'completed', activity: lessonActivity, content: { markdown: '# print()\n\n正文', citations: [{ sourceId: 'b1', sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex: 761, quote: 'q' }, { sourceId: 'b1', sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex: 766, quote: 'q2' }] }, questions: [] };

function routes(extra: Record<string, Parameters<typeof mockApi>[1][string]> = {}) {
  let notes: { noteId: string; courseId: string; versionId: string; knowledgePointId: string; revision: number; content: string }[] = [];
  return {
    ...baseRoutes,
    'GET /courses': () => ({ data: [course] }),
    'GET /drafts': () => ({ data: [{ draftId: 'd1', revision: 9, state: 'confirmed', input: { title: 'python算法入门', goal: '参加蓝桥杯 Python 组' }, confirmed: { courseId: 'c1', versionId: 'v1', sessionId: 's1' }, generationJobId: 'j-plan', generatedFromRevision: 9, versionId: 'v1', review: null }] }),
    'GET /sessions/s1': () => ({ data: session }),
    'GET /progress': () => ({ data: progress }),
    'GET /sessions/s1/history': () => ({ data: history }),
    'GET /sessions/s1/history/r-lesson': () => ({ data: lessonRun }),
    'GET /jobs': () => ({ data: jobs }),
    'GET /jobs/j-lesson/trace': () => ({ data: trace('Python编程') }),
    'GET /jobs/j-plan/trace': () => ({ data: { stages: [], sources: [] } }),
    'GET /textbooks': () => ({ data: [book({ bookId: 'b1', title: 'Python编程' }), book({ bookId: web, title: 'https://docs.python.org/3/library/functions.html', format: 'html' })] }),
    'GET /notes': () => ({ data: notes }),
    'POST /notes': ({ body }: { body: unknown }) => {
      const input = body as { versionId: string; knowledgePointId: string; content: string };
      const note = { noteId: `n${notes.length + 1}`, courseId: 'c1', revision: 0, ...input };
      notes = [...notes, note];
      return { status: 201, data: note };
    },
    ...extra,
  };
}

test.describe('课程列表与课程主页', () => {
  test('课程列表：掌握进度条按真实比例，继续学习进入学习页', async ({ page }) => {
    await mockApi(page, routes());
    await page.goto('/courses');
    await expect(page.getByRole('heading', { level: 1, name: '我的课程' })).toBeVisible();
    const bar = page.getByRole('progressbar', { name: /python算法入门/ });
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '18');
    const fill = bar.locator('[data-fill]');
    const [outer, inner] = await Promise.all([bar.boundingBox(), fill.boundingBox()]);
    expect(inner!.width / outer!.width).toBeCloseTo(1 / 18, 2);
    await expect(page.getByRole('link', { name: '继续学习 python算法入门' })).toHaveAttribute('href', '/learn/s1');
  });

  test('课程列表为空时引导去草稿', async ({ page }) => {
    await mockApi(page, { ...routes(), 'GET /courses': () => ({ data: [] }) });
    await page.goto('/courses');
    await expect(page.getByText('还没有正式课程')).toBeVisible();
    await expect(page.getByRole('link', { name: '去课程草稿' })).toHaveAttribute('href', '/drafts');
  });

  test('课程主页：18 个路线图节点、证据标记与真实统计', async ({ page }) => {
    await mockApi(page, routes());
    await page.goto('/courses/c1');
    await expect(page.getByRole('heading', { level: 1, name: 'python算法入门' })).toBeVisible();
    const map = page.getByRole('region', { name: '先修路线图' });
    await expect(map.locator('button[data-id]')).toHaveCount(18);
    const print = map.locator('button[data-id="py-hello-print"]');
    // 节点内的标记对读屏隐藏（按钮名已含证据题数），这里按 SVG 的标签数
    await expect(print).toHaveAccessibleName(/计入证据 2 题，正在学习/);
    await expect(print.locator('svg[aria-label="答错"]')).toHaveCount(1);
    await expect(print.locator('svg[aria-label="答对"]')).toHaveCount(1);
    await expect(print.locator('svg[aria-label="待作答"]')).toHaveCount(3);
    await expect(print).toHaveAttribute('aria-current', 'step');
    const kpis = page.getByRole('list', { name: '课程进度' });
    await expect(kpis).toContainText('已验证掌握1/ 18 个知识点');
    await expect(kpis).toContainText('已完成活动2');
    await expect(kpis).toContainText('课件出处2');
    await expect(page.getByRole('heading', { name: '需要补练：运行程序与 print()' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Python编程：共 4,049 段，Agent 读过 20 段，课件引用 2 处' })).toBeVisible();
  });

  test('点路线图节点进入学习页并定位该知识点', async ({ page }) => {
    await mockApi(page, routes());
    await page.goto('/courses/c1');
    await page.getByRole('region', { name: '先修路线图' }).locator('button[data-id="py-list"]').click();
    await expect(page).toHaveURL(/\/learn\/s1\?point=py-list$/);
  });

  test('?tab=notes 直接打开笔记，新建笔记后出现在列表', async ({ page }) => {
    const calls = await mockApi(page, routes());
    await page.goto('/courses/c1?tab=notes');
    await expect(page.getByRole('tab', { name: '笔记' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('还没有笔记')).toBeVisible();
    await page.getByLabel('知识点').selectOption('py-list');
    await page.getByLabel('笔记内容').fill('列表下标从 0 开始');
    await page.getByRole('button', { name: '保存笔记' }).click();
    await expect(page.getByRole('article').filter({ hasText: '列表下标从 0 开始' })).toBeVisible();
    const post = calls.find(c => c.method === 'POST' && c.path === '/notes');
    expect(post?.body).toEqual({ versionId: 'v1', knowledgePointId: 'py-list', content: '列表下标从 0 开始' });
    expect(post?.headers['idempotency-key']).toBeTruthy();
  });

  test('切换标签页更新网址；资料来源标签列出上传与联网补充', async ({ page }) => {
    await mockApi(page, routes());
    await page.goto('/courses/c1');
    await page.getByRole('tab', { name: '资料来源' }).click();
    await expect(page).toHaveURL(/tab=sources/);
    const table = page.getByRole('table');
    await expect(table.getByRole('row').filter({ hasText: 'Python编程' })).toContainText('上传教材');
    await expect(table.getByRole('row').filter({ hasText: 'docs.python.org' })).toContainText('联网补充');
    await page.getByRole('tab', { name: '历史回看' }).click();
    await expect(page.getByRole('link', { name: /知识点练习 · 运行程序与 print\(\)/ })).toHaveAttribute('href', '/learn/s1/history?run=r-quiz');
  });
});
