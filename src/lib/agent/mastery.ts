import { getDb } from '@/lib/db';

const MASTERED_THRESHOLD = 0.8;
const DECAY_TAU_DAYS = 30;

/**
 * 掌握度更新：答对 m' = 1-(1-m)*0.5；答错 m' = m*0.5；
 * 先按距上次更新的天数衰减 m *= exp(-Δdays/30)。
 * m ≥ 0.8 → mastered；答错且曾为 mastered → 回退 learning。
 */
export function updateMastery(kpId: string, correct: boolean, now: Date = new Date()): number {
  const db = getDb();
  const row = db
    .prepare('SELECT mastery_score AS score, status, last_updated AS updated FROM knowledge_points WHERE id = ?')
    .get(kpId) as { score: number; status: string; updated: string | null } | undefined;
  if (!row) throw new Error(`知识点不存在：${kpId}`);

  let m = row.score;
  if (row.updated) {
    const days = (now.getTime() - new Date(row.updated).getTime()) / 86_400_000;
    m *= Math.exp(-Math.max(days, 0) / DECAY_TAU_DAYS);
  }
  m = correct ? 1 - (1 - m) * 0.5 : m * 0.5;

  let status = row.status;
  if (m >= MASTERED_THRESHOLD) status = 'mastered';
  else if (status === 'mastered' || status === 'locked') status = 'learning';

  db.prepare('UPDATE knowledge_points SET mastery_score = ?, status = ?, last_updated = ? WHERE id = ?').run(
    m,
    status,
    now.toISOString(),
    kpId,
  );
  return m;
}
