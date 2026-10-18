import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({
  getModel: () => ({ modelId: 'fake' }),
  getEmbeddingModel: () => ({ modelId: 'fake-emb' }),
}));

const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    embed: async () => ({ embedding: [1, 0, 0, 0] }),
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  };
});

import { buildQuestionCorpus, generateQuestions } from '@/lib/agent/question-gen';
import { verifyQuestion } from '@/lib/agent/question-verify';
import { getDb, resetDbForTest } from '@/lib/db';
import { upsertChunks } from '@/lib/rag/store';

function seedCourseAndChunks(): void {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
  ).run();
  db.prepare(
    `INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at)
     VALUES ('c1', 'tb1', '学算法', '', 'computer', 2, '{"version":1,"nodes":[],"gaps":[],"quizConfig":{}}', '2026-10-19')`,
  ).run();
  upsertChunks(
    db,
    'tb1',
    [
      { id: 'c-unlocked', chapterId: 'ch1', content: '循环：for 和 while', anchor: { chapterId: 'ch1', index: 0 } },
      { id: 'c-locked', chapterId: 'ch9', content: '递归：函数调用自身', anchor: { chapterId: 'ch9', index: 9 } },
    ],
    [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ],
  );
}

describe('buildQuestionCorpus', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('语料只包含已解锁知识点章节的内容', async () => {
    seedCourseAndChunks();
    const corpus = await buildQuestionCorpus({
      textbookId: 'tb1',
      query: '循环',
      unlockedChapterIds: ['ch1'],
    });
    expect(corpus).toContain('循环');
    expect(corpus).not.toContain('递归');
  });
});

describe('generateQuestions（工具调用提交）', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockGenerateText.mockReset();
  });

  test('模型通过 submitQuestion 提交，题目落库', async () => {
    seedCourseAndChunks();
    mockGenerateText.mockImplementationOnce(async ({ tools }) => {
      await tools.submitQuestion.execute(
        {
          type: 'choice',
          stem: 'for 循环的三部分是？',
          options: ['初始化/条件/步进', '声明/判断/返回'],
          answer: '初始化/条件/步进',
          rubric: '选对即对',
          sourceKPIds: ['kp-loop'],
        },
        {},
      );
      return { text: 'done' };
    });

    const questions = await generateQuestions({
      courseId: 'c1',
      scope: 'knowledgePoint',
      scopeId: 'kp-loop',
      count: 1,
      difficulty: 'easy',
      unlockedKPIds: ['kp-loop'],
      unlockedChapterIds: ['ch1'],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].stem).toContain('for');

    const db = getDb(':memory:');
    expect(db.prepare('SELECT COUNT(*) n FROM questions').get()).toEqual({ n: 1 });
  });
});

describe('verifyQuestion（验题与出题拆开）', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  test('标为「循环」但解法依赖递归的题被拒绝', async () => {
    // 校验器独立调用：模型判定解法实际用到 unlocked 之外的知识
    mockGenerateText.mockImplementationOnce(async ({ tools }) => {
      await tools.submitVerdict.execute(
        { ok: false, reason: '参考解法使用递归，超出已解锁范围', usedKnowledge: ['递归'] },
        {},
      );
      return { text: 'done' };
    });
    const verdict = await verifyQuestion(
      {
        type: 'code',
        stem: '用循环实现阶乘',
        answer: '见参考解',
        referenceSolution: 'function f(n){return n<=1?1:n*f(n-1)}',
        testCases: [{ name: 'f(3)', assert: 'f(3) === 6' }],
        rubric: '',
        sourceKPIds: ['kp-loop'],
      },
      ['kp-loop'],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('超出');
  });

  test('code 题缺 referenceSolution 或 testCases 直接拒绝（不调 LLM）', async () => {
    const verdict = await verifyQuestion(
      { type: 'code', stem: 'x', answer: '', rubric: '', sourceKPIds: ['kp-loop'] },
      ['kp-loop'],
    );
    expect(verdict.ok).toBe(false);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  test('code 题参考解跑不通测试用例时被拒绝', async () => {
    // LLM 校验通过，但执行器跑不通
    mockGenerateText.mockImplementationOnce(async ({ tools }) => {
      await tools.submitVerdict.execute({ ok: true, usedKnowledge: ['kp-loop'] }, {});
      return { text: 'done' };
    });
    const verdict = await verifyQuestion(
      {
        type: 'code',
        stem: '实现加法',
        answer: '见参考解',
        referenceSolution: 'function add(a,b){return a-b}', // 错误参考解
        testCases: [{ name: 'add(1,2)', assert: 'add(1,2) === 3' }],
        rubric: '',
        sourceKPIds: ['kp-loop'],
      },
      ['kp-loop'],
      'javascript',
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/参考解/);
  });
});
