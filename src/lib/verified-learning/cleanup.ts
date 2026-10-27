import type Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ONLINE_LIMITS } from './mode';

/**
 * 删除最近 30 天未访问的线上空间：数据库中该空间的全部行与上传目录（规格 8.4）。
 * 表按外键依赖顺序删除：子表在前。
 */
const SCOPED_TABLES = [
  'vl_agent_states', 'vl_job_events', 'vl_jobs',
  'vl_hint_events', 'vl_attempts', 'vl_questions', 'vl_activity_runs',
  'vl_study_cursors', 'vl_notes', 'vl_learning_events', 'vl_study_sessions',
  'vl_course_reviews', 'vl_course_versions',
  'vl_drafts', 'vl_templates', 'vl_requests', 'vl_legacy_study',
  'vl_deletions', 'vl_source_revisions', 'vl_books',
  'vl_web_sessions',
];

export function removeIdleSpaces(db: Database.Database, uploadsRoot: string, now = new Date()): number {
  const cutoff = new Date(now.getTime() - ONLINE_LIMITS.idleDeleteDays * 86_400_000).toISOString();
  const idle = (db.prepare('SELECT space_id FROM vl_spaces WHERE last_seen_at < ?').all(cutoff) as { space_id: string }[]).map(r => r.space_id);
  if (!idle.length) return 0;
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name));
  const tables = SCOPED_TABLES.filter(name => existing.has(name));
  db.transaction(() => {
    for (const scope of idle) {
      for (const table of tables) db.prepare(`DELETE FROM ${table} WHERE scope_id=?`).run(scope);
      db.prepare('DELETE FROM vl_generation_usage WHERE space_id=?').run(scope);
      db.prepare('DELETE FROM vl_spaces WHERE space_id=?').run(scope);
    }
  }).immediate();
  for (const scope of idle) {
    // 空间 ID 只含 base64url 字符，拼接路径不会越出上传根目录
    if (!/^[A-Za-z0-9_-]{43}$/.test(scope)) continue;
    const directory = path.join(uploadsRoot, scope);
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  }
  return idle.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** 线上模式：启动时清理一次，之后每 6 小时一次；不阻止进程退出 */
export function scheduleCleanup(open: () => Database.Database, uploadsRoot: string) {
  if (timer) return;
  const run = () => {
    let db: Database.Database | null = null;
    try { db = open(); removeIdleSpaces(db, uploadsRoot); }
    catch { console.error('空间清理未完成，将在下次重试'); }
    finally { db?.close(); }
  };
  run();
  timer = setInterval(run, 6 * 3_600_000);
  timer.unref();
}
