import { readdirSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { initializeVerifiedLearning, openInitializedDb } from '@/lib/verified-learning/initialization';
import { ownTestDb, testDirectory } from './db-fixtures';

function tables(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(r => r.name);
}

describe('schema v5：线上空间与生成配额', () => {
  it('当前版本为 5，新增空间登记与每日生成计数表', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
    const db = ownTestDb(new Database(':memory:'));
    await migrateVerifiedLearning(db);
    expect(db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all().map(r => (r as { version: number }).version)).toEqual([1, 2, 3, 4, 5]);
    expect(tables(db)).toEqual(expect.arrayContaining(['vl_spaces', 'vl_generation_usage']));
    // 空间 ID 固定 43 位（32 字节 base64url）
    expect(() => db.prepare("INSERT INTO vl_spaces(space_id,created_at,last_seen_at) VALUES ('short','t','t')").run()).toThrow(/CHECK/);
    db.prepare('INSERT INTO vl_spaces(space_id,created_at,last_seen_at) VALUES (?,?,?)').run('a'.repeat(43), 't', 't');
    db.prepare('INSERT INTO vl_generation_usage(space_id,day,count) VALUES (?,?,?)').run('a'.repeat(43), '2026-10-27', 1);
    expect(() => db.prepare('INSERT INTO vl_generation_usage(space_id,day,count) VALUES (?,?,?)').run('a'.repeat(43), '2026-10-27', 2)).toThrow(/UNIQUE|PRIMARY/);
  });

  it('v4 文件库升级到 v5 前自动备份', async () => {
    const directory = testDirectory();
    const filename = path.join(directory, 'app.db');
    const db = ownTestDb(new Database(filename));
    await migrateVerifiedLearning(db);
    // 退回到 v4：删除 v5 表与记录，模拟旧库
    db.exec('DROP TABLE vl_spaces; DROP TABLE vl_generation_usage; DELETE FROM vl_schema_migrations WHERE version = 5;');
    for (const name of readdirSync(directory).filter(n => n.endsWith('.bak'))) void name;
    const before = readdirSync(directory).filter(n => n.endsWith('.bak')).length;
    await migrateVerifiedLearning(db);
    const after = readdirSync(directory).filter(n => n.endsWith('.bak'));
    expect(after.length).toBe(before + 1);
    expect(after.some(n => /^app\.db\.vl-v5-[0-9a-f-]+\.bak$/.test(n))).toBe(true);
    expect(tables(db)).toContain('vl_spaces');
  });

  it('打开初始化后的文件库使用 WAL 与忙等待，生成中可以并发读写', async () => {
    const root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    await initializeVerifiedLearning('data/app.db', true, root);
    const db = ownTestDb(openInitializedDb('data/app.db', root));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
