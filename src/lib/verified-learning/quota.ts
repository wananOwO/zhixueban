import type Database from 'better-sqlite3';
import { AppError } from './errors';
import { isOnline, ONLINE_LIMITS } from './mode';

/** 生成类任务：会调用模型并占用服务器；教材导入不算 */
const GENERATION_KINDS = ['curriculum', 'lesson', 'question_set', 'assessment'];
const placeholders = GENERATION_KINDS.map(() => '?').join(',');

function day(now: Date): string {
  // 按北京时间切日，评委所在时区
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 线上模式发起生成前检查：每空间同时 1 个、每天 20 次，全站同时 6 个（规格 8.4） */
export function checkGenerationQuota(db: Database.Database, scope: string, now = new Date()): void {
  if (!isOnline()) return;
  const active = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  if (active(`SELECT count(*) AS n FROM vl_jobs WHERE scope_id=? AND status IN ('queued','running') AND kind IN (${placeholders})`, scope, ...GENERATION_KINDS) >= ONLINE_LIMITS.concurrentPerSpace) {
    throw new AppError('LIMIT_EXCEEDED', '已有生成任务正在进行，请等它完成后再开始新的');
  }
  const used = (db.prepare('SELECT count FROM vl_generation_usage WHERE space_id=? AND day=?').get(scope, day(now)) as { count: number } | undefined)?.count ?? 0;
  if (used >= ONLINE_LIMITS.dailyPerSpace) throw new AppError('LIMIT_EXCEEDED', `今天的生成次数已用完（每天 ${ONLINE_LIMITS.dailyPerSpace} 次），明天再试`);
  if (active(`SELECT count(*) AS n FROM vl_jobs WHERE status IN ('queued','running') AND kind IN (${placeholders})`, ...GENERATION_KINDS) >= ONLINE_LIMITS.concurrentGlobal) {
    throw new AppError('LIMIT_EXCEEDED', '服务器正忙，请稍后再试');
  }
}

export function countGeneration(db: Database.Database, scope: string, now = new Date()): void {
  if (!isOnline()) return;
  db.prepare(`INSERT INTO vl_generation_usage(space_id,day,count) VALUES (?,?,1)
    ON CONFLICT(space_id,day) DO UPDATE SET count=count+1`).run(scope, day(now));
}
