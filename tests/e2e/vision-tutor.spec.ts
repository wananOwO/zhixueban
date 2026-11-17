import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { baseRoutes, book, mockApi } from './mock-api';

const points = [
  { knowledgePointId: 'rec', title: '递归与终止条件', prerequisiteIds: [], sourceIds: ['b1'], role: 'target', coverage: 'covered', reason: '' },
];
const outline = [{ moduleId: 'm1', title: '第二章', points }];
const course = {
  courseId: 'c1',
  versionId: 'v1',
  status: 'active',
  sessionId: 's1',
  snapshot: { goal: '掌握递归', outline, sourceRevisions: [{ sourceId: 'b1', sourceRevision: 'r1' }] },
};
const lessonActivity = { activityId: 'a-lesson', kind: 'lesson', moduleId: 'm1', knowledgePointIds: ['rec'], questionCount: 0 };
const variantActivity = { activityId: 'a-vp', kind: 'point_quiz', moduleId: null, knowledgePointIds: ['rec'], questionCount: 1 };
const progress = {
  courseId: 'c1',
  versionId: 'v1',
  completedActivities: 1,
  attempts: { total: 0, correct: 0 },
  dailyActivity: [],
  verifiedKnowledgePointIds: [],
  review: [],
  knowledgePoints: [],
  recent: {},
  evidenceQuestions: 0,
};

const tutorStream = (text: string) => ({
  raw: {
    contentType: 'text/event-stream',
    body: [
      { type: 'start', messageId: 'v-a1' },
      { type: 'text-start', id: 'v-t1' },
      ...text.match(/.{1,10}/gsu)!.map(delta => ({ type: 'text-delta', id: 'v-t1', delta })),
      { type: 'text-end', id: 'v-t1' },
      { type: 'finish' },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
  },
});

test.describe('学习页助教：题目/代码截图多模态闭环', () => {
  test('截图上传 → 核对编辑 → 混合检索出处回查 → 变式练习（不计入掌握证据）；支持失败兜底与手机端', async ({ page }) => {
    const samplePng = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 245, g: 245, b: 240 } },
    }).png().toBuffer();

    let currentRun: Record<string, unknown> | null = null;
    let failVisionOnce = true;

    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /courses': () => ({ data: [course] }),
      'GET /progress': () => ({ data: progress }),
      'GET /textbooks': () => ({ data: [book()] }),
      'GET /textbooks/b1': () => ({ data: book() }),
      'GET /textbooks/b1/chapters/ch1': () => ({
        data: {
          chapterId: 'ch1',
          title: '第二章 函数',
          paragraphs: [{ paragraphIndex: 761, text: '递归函数必须具备明确的终止条件，否则会引发栈溢出。', contentHash: 'h761' }],
          nextOffset: null,
        },
      }),
      'GET /sessions/s1/history': () => ({ data: [] }),
      'PATCH /sessions/s1/cursor': () => ({ data: { revision: 1 } }),
      'GET /sessions/s1': () => ({
        data: {
          session: { sessionId: 's1', courseId: 'c1', courseVersionId: 'v1', mode: 'practice', revision: 2, completedActivityIds: ['a-lesson'] },
          version: { courseId: 'c1', courseVersionId: 'v1', goal: '掌握递归', outline },
          next: { kind: 'activity', activity: lessonActivity },
          allowedKnowledgePointIds: ['rec'],
          currentRun,
          cursor: null,
        },
      }),
      'GET /runs/r-vp': () => ({
        data: {
          runId: 'r-vp',
          status: 'ready',
          activity: variantActivity,
          content: null,
          questions: [{
            questionId: 'q-vp-1',
            type: 'choice',
            stem: '下列哪个条件能避免递归无限调用？',
            options: ['明确的基准终止条件', '增加局部变量数量'],
            attempt: null,
          }],
        },
      }),
      'POST /sessions/s1/vision/extract': () => {
        if (failVisionOnce) {
          failVisionOnce = false;
          return { status: 502, error: { code: 'PROVIDER_ERROR', message: '当前模型不支持图片输入，请在设置中更换视觉模型或改用粘贴文字', retryable: true } };
        }
        return {
          data: {
            summary: '代码 · python · 涉及：递归',
            extraction: {
              kind: 'code',
              language: 'python',
              transcription: 'def f(n):\n    return n * f(n - 1)',
              concepts: ['递归', '终止条件'],
              code: 'def f(n):\n    return n * f(n - 1)',
              question: null,
              uncertainty: ['缩进空格数请核对'],
              needsClarification: false,
            },
          },
        };
      },
      'POST /sessions/s1/retrieve': () => ({
        data: {
          degraded: false,
          keywordCount: 1,
          vectorCount: 1,
          hits: [{
            sourceId: 'b1',
            sourceRevision: 'r1',
            chapterId: 'ch1',
            paragraphIndex: 761,
            text: '递归函数必须具备明确的终止条件，否则会引发栈溢出。',
            score: 0.016,
            match: { keyword: true, vector: true, chapterBoost: true },
            contentHash: 'h761',
            sourceTitle: 'Python 官方教程',
            chapterTitle: '第二章 函数',
            chapterFiltered: true,
          }],
        },
      }),
      'POST /sessions/s1/vision/explain': () =>
        tutorStream('该函数缺少基准情形终止条件，会导致栈溢出〔b1·第761段〕。'),
      'POST /sessions/s1/vision/practice': () => {
        currentRun = { runId: 'r-vp', status: 'ready', purpose: 'vision_practice', activity: variantActivity, jobId: null };
        return { status: 202, data: { run: currentRun, job: { jobId: 'j-vp', kind: 'question_set', status: 'succeeded' } } };
      },
    });

    await page.goto('/learn/s1');
    await page.getByRole('button', { name: '问助教' }).click();
    const panel = page.getByRole('complementary', { name: '助教' });
    await panel.getByRole('tab', { name: '截图提问' }).click();

    await panel.locator('input[type=file]').setInputFiles({
      name: 'recursion-code.png',
      mimeType: 'image/png',
      buffer: samplePng,
    });
    await expect(panel.getByText(/截图将发送给所选视觉服务/)).toBeVisible();

    // 首次模拟模型不支持图片：展示清晰错误与文字兜底，重试后成功识别
    await panel.getByRole('button', { name: '识别截图内容' }).click();
    await expect(panel.getByRole('alert')).toContainText('不支持图片');
    await panel.getByRole('button', { name: /手动重试识别/ }).click();

    // 编辑核对识别文字并生成带出处的讲解
    const editor = panel.getByLabel('识别文字（可编辑核对）');
    await expect(editor).toHaveValue('def f(n):\n    return n * f(n - 1)');
    await editor.fill('def f(n):\n    return n * f(n - 1)  # 缺少终止条件');
    await panel.getByRole('button', { name: '确认文字并解释题目' }).click();

    await expect(panel).toContainText('该函数缺少基准情形终止条件');
    await expect(panel.getByText('语义命中')).toBeVisible();

    // 点击出处详情或正文引用均可打开原书第 761 段
    await panel.getByRole('button', { name: /Python 官方教程 · 第二章 函数 · 第 761 段/ }).click();
    await expect(page.getByRole('dialog').locator('[aria-current="location"]')).toContainText('递归函数必须具备明确的终止条件');
    await page.keyboard.press('Escape');

    // 无进行中活动时创建 1 道变式练习，主区域展示不计入掌握证据的变式题且提交前不显示答案
    await panel.getByRole('button', { name: '生成 1 道变式题' }).click();
    await expect.poll(() => calls.some(c => c.path === '/sessions/s1/vision/practice')).toBe(true);
    await expect(page.getByText(/截图变式练习 · 1 题/)).toBeVisible();
    await expect(page.getByText('下列哪个条件能避免递归无限调用？')).toBeVisible();
    await expect(page.getByText(/正确答案：/)).toHaveCount(0);

    // 手机端 390px 宽度可正常打开助教截图页且无横向溢出
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
