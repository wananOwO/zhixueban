import { beforeEach, describe, expect, test } from 'vitest';
import { dailyActivity, graphData, masteryTier } from '@/lib/stats';
import { getDb, resetDbForTest } from '@/lib/db';

describe('masteryTier 掌握度分档', () => {
  test('绿≥0.8 / 黄0.4-0.8 / 红<0.4 / 灰未解锁', () => {
    expect(masteryTier(0.9, 'mastered')).toBe('green');
    expect(masteryTier(0.5, 'learning')).toBe('yellow');
    expect(masteryTier(0.1, 'learning')).toBe('red');
    expect(masteryTier(0, 'locked')).toBe('gray');
  });
});

describe('stats 聚合', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    db.prepare(
      "INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at) VALUES ('c1','tb1','学','','computer',2,'{}','2026-10-19')",
    ).run();
    db.prepare(
      "INSERT INTO questions (id, course_id, scope, scope_id, type, difficulty, content_json, answer_json, source_kp_ids) VALUES ('q1','c1','knowledgePoint','kp1','choice','easy','{}','{}','[]')",
    ).run();
    db.prepare(
      "INSERT INTO attempts (id, question_id, user_answer, correct, created_at) VALUES ('a1','q1','A',1,'2026-10-18T10:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO attempts (id, question_id, user_answer, correct, created_at) VALUES ('a2','q1','A',1,'2026-10-19T10:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO attempts (id, question_id, user_answer, correct, created_at) VALUES ('a3','q1','B',0,'2026-10-19T11:00:00Z')",
    ).run();
  });

  test('dailyActivity 按日期分桶', () => {
    const days = dailyActivity();
    const day18 = days.find((d) => d.date === '2026-10-18');
    const day19 = days.find((d) => d.date === '2026-10-19');
    expect(day18?.count).toBe(1);
    expect(day19?.count).toBe(2);
  });

  test('graphData 返回节点掌握度与边', () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref, mastery_score, status) VALUES ('kp1','tb1','变量','ch1',0.9,'mastered')",
    ).run();
    db.prepare(
      "INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref, mastery_score, status) VALUES ('kp2','tb1','循环','ch1',0,'locked')",
    ).run();
    db.prepare("INSERT INTO knowledge_edges (from_id, to_id) VALUES ('kp1','kp2')").run();

    const g = graphData('tb1');
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes[0].tier).toBe('green');
    expect(g.nodes[1].tier).toBe('gray');
    expect(g.edges).toEqual([{ fromId: 'kp1', toId: 'kp2' }]);
  });
});
