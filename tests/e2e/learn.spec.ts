import { expect, test, type Page } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

const points = [
  { knowledgePointId: 'print', title: '运行程序与 print()', prerequisiteIds: [], sourceIds: ['b1'], role: 'prerequisite', coverage: 'covered', reason: '' },
  { knowledgePointId: 'vars', title: '变量与数值运算', prerequisiteIds: ['print'], sourceIds: ['b1'], role: 'prerequisite', coverage: 'covered', reason: '' },
  { knowledgePointId: 'input', title: 'input() 与 int()', prerequisiteIds: ['vars'], sourceIds: ['b1'], role: 'target', coverage: 'covered', reason: '' },
];
const outline = [{ moduleId: 'm1', title: '第一章', points }];
const course = { courseId: 'c1', versionId: 'v1', status: 'active', sessionId: 's1', snapshot: { goal: '参加蓝桥杯', outline, sourceRevisions: [{ sourceId: 'b1', sourceRevision: 'r1' }] } };
const lessonActivity = { activityId: 'a-lesson', kind: 'lesson', moduleId: 'm1', knowledgePointIds: ['print'], questionCount: 0 };
const quizActivity = { activityId: 'a-quiz', kind: 'point_quiz', moduleId: 'm1', knowledgePointIds: ['print'], questionCount: 3 };
const cite = (paragraphIndex: number, quote: string) => ({ sourceId: 'b1', sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex, quote });
const markdown = [
  '## 二、print() 函数：把结果显示到屏幕',
  '',
  '程序算出的结果存在内存里，人看不见。在 Python 里，解释器看到后面跟着括号的单词 print 时，会把括号中的内容打印到屏幕上。',
  '',
  '```python',
  'print("Hello Python world!")',
  '```',
  '',
  '## 三、小结',
  '',
  '字符串就是一系列字符，用引号括起来。',
].join('\n');
const lessonRun = {
  runId: 'r-lesson', status: 'ready', activity: lessonActivity, questions: [],
  content: { markdown, citations: [cite(761, '在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。'), cite(791, '字符串就是一系列字符。在 Python 中，用引号括起来的都是字符串。')] },
};
const question = (id: string, type: 'choice' | 'fill' | 'code', extra: Record<string, unknown> = {}) => ({ questionId: id, type, stem: `${id} 题干`, attempt: null, ...extra });
const quizRun = {
  runId: 'r-quiz', status: 'ready', activity: quizActivity, content: null,
  questions: [
    question('q1', 'choice', { stem: '哪一行能输出 Hello？', options: ['Print("Hello")', 'print("Hello")'] }),
    question('q2', 'fill', { stem: 'print(1, 2, sep="-") 输出什么？' }),
    question('q3', 'code', { stem: '读入两个整数，输出它们的和。', language: 'python', samples: [{ stdin: '1 2\n', expectedStdout: '3\n' }] }),
  ],
};
const sessionWith = (run: { runId: string; activity: unknown } | null, next: unknown = { kind: 'activity', activity: lessonActivity }, revision = 3, completed: string[] = []) => ({
  session: { sessionId: 's1', courseId: 'c1', courseVersionId: 'v1', mode: 'practice', revision, completedActivityIds: completed },
  version: { courseId: 'c1', courseVersionId: 'v1', goal: '参加蓝桥杯', outline },
  next,
  currentRun: run ? { runId: run.runId, status: 'ready', activity: run.activity, jobId: null } : null,
  cursor: null,
});
const progress = { courseId: 'c1', versionId: 'v1', completedActivities: 0, attempts: { total: 0, correct: 0 }, dailyActivity: [], verifiedKnowledgePointIds: [], review: [], knowledgePoints: [], recent: {}, evidenceQuestions: 0 };
const chapter = ({ url }: { url: URL }) => {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return { data: { chapterId: 'ch1', title: '第一章', paragraphs: Array.from({ length: 100 }, (_, i) => ({ paragraphIndex: 700 + offset + i, text: `第 ${700 + offset + i} 段原文`, contentHash: 'h' })), nextOffset: offset + 100 < 300 ? offset + 100 : null } };
};
const common = {
  ...baseRoutes,
  'GET /courses': () => ({ data: [course] }),
  'GET /drafts': () => ({ data: [] }),
  'GET /progress': () => ({ data: progress }),
  'GET /textbooks': () => ({ data: [book()] }),
  'GET /textbooks/b1': () => ({ data: book() }),
  'GET /textbooks/b1/chapters/ch1': chapter,
  'GET /sessions/s1/history': () => ({ data: [] }),
  'PATCH /sessions/s1/cursor': () => ({ data: { revision: 1 } }),
};
/** 助教的 UI message stream（SSE），分段返回 */
const tutorStream = (text: string) => ({
  raw: {
    contentType: 'text/event-stream',
    body: [
      { type: 'start', messageId: 'a1' },
      { type: 'text-start', id: 't1' },
      ...text.match(/.{1,6}/gsu)!.map(delta => ({ type: 'text-delta', id: 't1', delta })),
      { type: 'text-end', id: 't1' },
      { type: 'finish' },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
  },
});

async function openLesson(page: Page, extra: Record<string, Parameters<typeof mockApi>[1][string]> = {}) {
  let session = sessionWith(lessonRun);
  const calls = await mockApi(page, {
    ...common,
    'GET /sessions/s1': () => ({ data: session }),
    'GET /runs/r-lesson': () => ({ data: lessonRun }),
    'POST /sessions/s1/lesson-completion': () => {
      session = sessionWith(null, { kind: 'activity', activity: quizActivity }, 4, ['a-lesson']);
      return { data: session };
    },
    ...extra,
  });
  await page.goto('/learn/s1');
  return calls;
}

test.describe('学习页', () => {
  test('课件：宋体正文、朱批旁注；点旁注打开原文并定位第 761 段', async ({ page }) => {
    await openLesson(page);
    await expect(page.getByRole('heading', { level: 1, name: '运行程序与 print()' })).toBeVisible();
    const article = page.getByRole('article');
    await expect(article.locator('.cited').first()).toContainText('解释器看到后面跟着括号的单词 print');
    await page.getByRole('button', { name: /教材 · 第 761 段/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.locator('[aria-current="location"]')).toHaveText('第 761 段原文');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('课件：「我读完了」提交并进入下一活动', async ({ page }) => {
    const calls = await openLesson(page);
    await page.getByRole('button', { name: '我读完了' }).click();
    await expect(page.getByRole('heading', { name: /下一步：知识点练习/ })).toBeVisible();
    const done = calls.find(c => c.path === '/sessions/s1/lesson-completion');
    expect(done?.body).toEqual({ runId: 'r-lesson', expectedRevision: 3 });
    expect(done?.headers['idempotency-key']).toBeTruthy();
  });

  test('题组：选择题提交后出现「答对」批改与解析；第 4 级提示需确认', async ({ page }) => {
    const calls = await mockApi(page, {
      ...common,
      'GET /sessions/s1': () => ({ data: sessionWith(quizRun, { kind: 'activity', activity: quizActivity }) }),
      'GET /runs/r-quiz': () => ({ data: quizRun }),
      'POST /runs/r-quiz/attempts': ({ body }) => {
        const { questionId } = body as { questionId: string };
        if (questionId === 'q3') return { status: 202, data: { attemptId: 'at3', questionId, state: 'pending', result: null } };
        return { data: { attemptId: `at-${questionId}`, questionId, state: 'finished', result: { correct: true, category: 'accepted', feedback: '回答正确', explanation: 'print 全小写，字符串要加引号。' } } };
      },
      'GET /attempts/at3': (() => { let n = 0; return () => ({ data: { attemptId: 'at3', questionId: 'q3', state: n++ < 1 ? 'running' : 'finished', result: n > 1 ? { correct: true, category: 'accepted', feedback: '通过全部测试', explanation: '用 split 拆分输入。' } : null } }); })(),
      'POST /runs/r-quiz/hints': ({ body }) => {
        const { level } = body as { level: number };
        return { data: { level, content: level === 4 ? '完整解析：sep 放在值之间。\n答案：1-2' : '相关知识：print' } };
      },
    });
    await page.goto('/learn/s1');
    const q1 = page.getByRole('group', { name: /第 1 题/ });
    await q1.getByLabel('print("Hello")', { exact: true }).check();
    await q1.getByRole('button', { name: '提交答案' }).click();
    await expect(q1.getByRole('img', { name: '答对' })).toBeVisible();
    await expect(q1).toContainText('print 全小写，字符串要加引号。');
    expect(calls.find(c => c.path === '/runs/r-quiz/attempts')?.body).toEqual({ questionId: 'q1', answer: 'print("Hello")' });

    const q2 = page.getByRole('group', { name: /第 2 题/ });
    await q2.getByRole('button', { name: '提示' }).click();
    await expect(q2).toContainText('相关知识：print');
    await q2.getByRole('button', { name: '看完整解析' }).click();
    const confirm = page.getByRole('dialog', { name: '看完整解析？' });
    await expect(confirm).toContainText('不计入独立证据');
    await confirm.getByRole('button', { name: '看解析' }).click();
    await expect(q2).toContainText('完整解析：sep 放在值之间。');
    expect(calls.filter(c => c.path === '/runs/r-quiz/hints').map(c => (c.body as { level: number }).level)).toEqual([1, 4]);

    const q3 = page.getByRole('group', { name: /第 3 题/ });
    await expect(q3).toContainText('1 2');
    await q3.getByRole('textbox', { name: '代码' }).click();
    await page.keyboard.type('a, b = map(int, input().split())\nprint(a + b)');
    await q3.getByRole('button', { name: '提交答案' }).click();
    await expect(q3.getByText('判题中')).toBeVisible();
    await expect(q3.getByRole('img', { name: '答对' })).toBeVisible({ timeout: 10_000 });
  });

  test('助教：流式回答逐步出现，出处可点击；请求带 runId', async ({ page }) => {
    const calls = await openLesson(page, {
      'POST /sessions/s1/tutor': () => tutorStream('两者都只能写成关键字参数〔b1·第761段〕。'),
    });
    await page.getByRole('button', { name: '问助教' }).click();
    const panel = page.getByRole('complementary', { name: '助教' });
    await panel.getByLabel('向助教提问').fill('sep 和 end 有什么区别？');
    await panel.getByRole('button', { name: '提问' }).click();
    await expect(panel).toContainText('两者都只能写成关键字参数');
    await panel.getByRole('button', { name: /教材 · 第 761 段/ }).click();
    await expect(page.getByRole('dialog').locator('[aria-current="location"]')).toHaveText('第 761 段原文');
    const body = calls.find(c => c.path === '/sessions/s1/tutor')?.body as { runId?: string; messages: unknown[] };
    expect(body.runId).toBe('r-lesson');
    expect(body.messages).toHaveLength(1);
  });

  test('1024px 右栏收为抽屉；390px 单栏且旁注在段后', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openLesson(page);
    await expect(page.getByRole('heading', { level: 1, name: '运行程序与 print()' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '旁注' })).toBeHidden();
    await page.getByRole('button', { name: '旁注' }).click();
    await expect(page.getByRole('dialog', { name: '旁注' }).getByRole('button', { name: /教材 · 第 761 段/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    const note = page.getByRole('article').getByRole('button', { name: /教材 · 第 761 段/ });
    await expect(note).toBeVisible();
    const [paragraph, noteBox] = await Promise.all([page.getByRole('article').locator('.cited').first().boundingBox(), note.boundingBox()]);
    expect(noteBox!.y).toBeGreaterThan(paragraph!.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('历史回看：时间线 + 只读课件与作答记录（含答案与解析）', async ({ page }) => {
    await mockApi(page, {
      ...common,
      'GET /sessions/s1': () => ({ data: sessionWith(null) }),
      'GET /sessions/s1/history': () => ({ data: [
        { runId: 'r-quiz', status: 'completed', activity: quizActivity, createdAt: '2026-10-22T18:33:50.000Z' },
        { runId: 'r-lesson', status: 'completed', activity: lessonActivity, createdAt: '2026-10-22T18:25:51.000Z' },
      ] }),
      'GET /sessions/s1/history/r-quiz': () => ({ data: { ...quizRun, status: 'completed', questions: [
        { ...quizRun.questions[0], attempt: { attemptId: 'a1', questionId: 'q1', state: 'finished', result: { correct: false, category: 'wrong_answer', feedback: '答错了' } }, answer: 'print("Hello")', explanation: '注意大小写。' },
      ] } }),
      'GET /sessions/s1/history/r-lesson': () => ({ data: { ...lessonRun, status: 'completed' } }),
    });
    await page.goto('/learn/s1/history?run=r-quiz');
    await expect(page.getByRole('heading', { level: 1, name: '历史回看' })).toBeVisible();
    await expect(page.getByRole('link', { name: /知识点练习 · 运行程序与 print\(\)/ })).toHaveAttribute('aria-current', 'page');
    const q1 = page.getByRole('group', { name: /第 1 题/ });
    await expect(q1.getByRole('img', { name: '答错' })).toBeVisible();
    await expect(q1).toContainText('正确答案：print("Hello")');
    await expect(q1).toContainText('注意大小写。');
    await expect(q1.getByRole('button', { name: '提交答案' })).toHaveCount(0);
    await page.getByRole('link', { name: /课件学习 · 运行程序与 print\(\)/ }).click();
    await expect(page).toHaveURL(/run=r-lesson/);
    await expect(page.getByRole('article')).toContainText('字符串就是一系列字符');
  });
});
