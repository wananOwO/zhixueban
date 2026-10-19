import { beforeEach, describe, expect, test } from 'vitest';
import { nextStep, switchMode } from '@/lib/agent/learn-flow';
import { getDb, resetDbForTest } from '@/lib/db';

function seedCourse(mode: number): void {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
  ).run();
  const insKp = db.prepare(
    'INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref, status) VALUES (?, ?, ?, ?, ?)',
  );
  insKp.run('kp1', 'tb1', '变量', 'ch1', 'unlocked');
  insKp.run('kp2', 'tb1', '循环', 'ch1', 'unlocked');
  insKp.run('kp3', 'tb1', '函数', 'ch2', 'unlocked');
  db.prepare(
    `INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at)
     VALUES ('c1','tb1','学','','computer',?,?,'2026-10-19')`,
  ).run(
    mode,
    JSON.stringify({
      version: 1,
      nodes: [
        { kpId: 'kp1', depth: 'normal' },
        { kpId: 'kp2', depth: 'normal' },
        { kpId: 'kp3', depth: 'normal' },
      ],
      gaps: [],
      quizConfig: { perKnowledgePoint: 1, perChapter: 1, finalCount: 1 },
    }),
  );
}

function markLesson(kpId: string): void {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO lessons (id, course_id, knowledge_point_id, content_mdx) VALUES (?, 'c1', ?, '内容')",
  ).run(`l-${kpId}`, kpId);
}

function markQuiz(scope: string, scopeId: string): void {
  const db = getDb(':memory:');
  db.prepare(
    `INSERT INTO questions (id, course_id, scope, scope_id, type, difficulty, content_json, answer_json, source_kp_ids)
     VALUES (?, 'c1', ?, ?, 'choice', 'easy', '{}', '{}', '[]')`,
  ).run(`q-${scope}-${scopeId}`, scope, scopeId);
  db.prepare(
    "INSERT INTO attempts (id, question_id, user_answer, correct, created_at) VALUES (?, ?, 'A', 1, '2026-10-19')",
  ).run(`a-${scope}-${scopeId}`, `q-${scope}-${scopeId}`);
}

describe('模式 2 边学边练', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('流程：kp1 课件 → kp1 练习 → kp2 课件… → 章测 → done', () => {
    seedCourse(2);
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp1' });

    markLesson('kp1');
    expect(nextStep('c1')).toEqual({ kind: 'quiz', kpId: 'kp1' });

    markQuiz('knowledgePoint', 'kp1');
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp2' });

    markLesson('kp2');
    markQuiz('knowledgePoint', 'kp2');
    // ch1 两个知识点完成 → 章测
    expect(nextStep('c1')).toEqual({ kind: 'chapterQuiz', chapterId: 'ch1' });

    markQuiz('chapter', 'ch1');
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp3' });

    markLesson('kp3');
    markQuiz('knowledgePoint', 'kp3');
    markQuiz('chapter', 'ch2');
    expect(nextStep('c1')).toEqual({ kind: 'done' });
  });

  test('练习未做完不解锁下一知识点', () => {
    seedCourse(2);
    markLesson('kp1');
    const step = nextStep('c1');
    expect(step).toEqual({ kind: 'quiz', kpId: 'kp1' });
  });
});

describe('模式 1 理论学习', () => {
  test('章节全部课件 → 章测', () => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    seedCourse(1);
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp1' });
    markLesson('kp1');
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp2' });
    markLesson('kp2');
    expect(nextStep('c1')).toEqual({ kind: 'chapterQuiz', chapterId: 'ch1' });
  });
});

describe('模式 3 刷题模式', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('无任何记录时先 diagnostic', () => {
    seedCourse(3);
    expect(nextStep('c1')).toEqual({ kind: 'diagnostic' });
  });

  test('有诊断记录后逐知识点刷题，最后综合大题', () => {
    seedCourse(3);
    markQuiz('diagnostic', 'c1'); // 诊断完成
    expect(nextStep('c1')).toEqual({ kind: 'quiz', kpId: 'kp1' });
    markQuiz('knowledgePoint', 'kp1');
    markQuiz('knowledgePoint', 'kp2');
    markQuiz('knowledgePoint', 'kp3');
    expect(nextStep('c1')).toEqual({ kind: 'finalQuiz' });
    markQuiz('final', 'c1');
    expect(nextStep('c1')).toEqual({ kind: 'done' });
  });
});

describe('switchMode', () => {
  test('切换模式保留答题记录', () => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    seedCourse(2);
    markLesson('kp1');
    markQuiz('knowledgePoint', 'kp1');
    switchMode('c1', 1);
    const db = getDb(':memory:');
    expect(db.prepare('SELECT COUNT(*) n FROM attempts').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT mode FROM courses WHERE id = ?').get('c1')).toEqual({ mode: 1 });
    // 模式 1 下 kp1 课件已完成 → 下一步 kp2 课件
    expect(nextStep('c1')).toEqual({ kind: 'lesson', kpId: 'kp2' });
  });
});
