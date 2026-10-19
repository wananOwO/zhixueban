import { getDb } from '@/lib/db';

export type MasteryTier = 'green' | 'yellow' | 'red' | 'gray';

/** 掌握度分档：绿≥0.8 / 黄0.4-0.8 / 红<0.4 / 灰未解锁 */
export function masteryTier(score: number, status: string): MasteryTier {
  if (status === 'locked') return 'gray';
  if (score >= 0.8) return 'green';
  if (score >= 0.4) return 'yellow';
  return 'red';
}

/** 学习热力图数据：按日期聚合答题数 */
export function dailyActivity(): { date: string; count: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count
       FROM attempts GROUP BY date ORDER BY date`,
    )
    .all() as { date: string; count: number }[];
}

/** 知识图谱数据：节点含掌握度分档 */
export function graphData(textbookId: string): {
  nodes: { id: string; title: string; mastery: number; status: string; tier: MasteryTier }[];
  edges: { fromId: string; toId: string }[];
} {
  const db = getDb();
  const nodes = (
    db
      .prepare(
        'SELECT id, title, mastery_score AS mastery, status FROM knowledge_points WHERE textbook_id = ?',
      )
      .all(textbookId) as { id: string; title: string; mastery: number; status: string }[]
  ).map((n) => ({ ...n, tier: masteryTier(n.mastery, n.status) }));
  const edges = db
    .prepare(
      `SELECT e.from_id AS fromId, e.to_id AS toId FROM knowledge_edges e
       JOIN knowledge_points p ON p.id = e.from_id WHERE p.textbook_id = ?`,
    )
    .all(textbookId) as { fromId: string; toId: string }[];
  return { nodes, edges };
}
