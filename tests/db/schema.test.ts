import { expect, test } from 'vitest';
import { getDb } from '@/lib/db';

test('建库后 11 张表存在且可插入', () => {
  const db = getDb(':memory:');
  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(
    expect.arrayContaining([
      'textbooks',
      'chunks',
      'knowledge_points',
      'knowledge_edges',
      'courses',
      'lessons',
      'questions',
      'attempts',
      'notes',
      'prompt_templates',
      'settings',
    ]),
  );
});

test('textbooks 表可插入并读回', () => {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('t1', 'Python教程', 'txt', '/a.txt', '{}', '2026-10-19')",
  ).run();
  const row = db.prepare("SELECT title FROM textbooks WHERE id = 't1'").get() as { title: string };
  expect(row.title).toBe('Python教程');
});
