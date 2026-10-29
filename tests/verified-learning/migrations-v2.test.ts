import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '@/lib/db/schema';
import { migrateVerifiedLearning, VerifiedLearningStore } from '@/lib/verified-learning/store';
import { SCHEMA_V1 } from './schema-v1';
import { courseInput } from './fixtures';
import { openTestDb, testDirectory } from './db-fixtures';

function v1(filename = ':memory:') {
  const db = openTestDb(filename);
  db.exec(SCHEMA_SQL);
  db.exec(SCHEMA_V1);
  db.exec("INSERT INTO vl_schema_migrations VALUES (1,'2026-10-20T00:00:00.000Z')");
  return db;
}
function names(db: ReturnType<typeof openTestDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
    .map(row => row.name);
}

describe('第二阶段显式迁移', () => {
  it('保留真实 v1 会话、事件和旧表，并添加 v2 任务与教材表', async () => {
    const db = v1();
    db.exec("INSERT INTO settings VALUES ('old','keep')");
    const store = new VerifiedLearningStore(db);
    const version = store.activateVersion('a', store.createVersion('a', courseInput()).courseVersionId);
    const session = store.createSession('a', version.courseVersionId, 'theory');
    const result = store.dispatch('a', session.sessionId, 0, 'once', { type: 'change_mode', mode: 'practice' });
    const oldTables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    await migrateVerifiedLearning(db);
    expect(db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(names(db)).toEqual(expect.arrayContaining(['vl_web_sessions', 'vl_jobs', 'vl_job_events', 'vl_books', 'vl_source_revisions', 'vl_deletions']));
    for (const row of oldTables as { name: string; sql: string }[]) {
      expect(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(row.name)).toEqual({ sql: row.sql });
    }
    expect(store.getSession('a', session.sessionId)).toEqual(result);
    expect(store.dispatch('a', session.sessionId, 0, 'once', { type: 'change_mode', mode: 'practice' })).toEqual(result);
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'old', value: 'keep' }]);
  });

  it('新空库在一次显式迁移中建立 v1 和 v2，重复执行不改记录', async () => {
    const db = openTestDb();
    new VerifiedLearningStore(db);
    expect(names(db)).toEqual([]);
    await migrateVerifiedLearning(db);
    const records = db.prepare('SELECT * FROM vl_schema_migrations ORDER BY version').all();
    expect(records).toHaveLength(5);
    await migrateVerifiedLearning(db);
    expect(db.prepare('SELECT * FROM vl_schema_migrations ORDER BY version').all()).toEqual(records);
  });

  it('升级文件库前保留独立 v1 备份，重复迁移不多备份且可重开', async () => {
    const directory = testDirectory();
    const filename = path.join(directory, 'app.db');
    const db = v1(filename);
    await migrateVerifiedLearning(db);
    const backups = readdirSync(directory).filter(name => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^app\.db\.vl-v5-[0-9a-f-]+\.bak$/);
    const backup = openTestDb(path.join(directory, backups[0]));
    expect(names(backup)).not.toContain('vl_jobs');
    expect(backup.prepare('SELECT version FROM vl_schema_migrations').all()).toEqual([{ version: 1 }]);
    await migrateVerifiedLearning(db);
    expect(readdirSync(directory).filter(name => name.endsWith('.bak'))).toEqual(backups);
    db.close();
    expect(names(openTestDb(filename))).toContain('vl_jobs');
  });

  it('v2 DDL 冲突回滚新增表和记录但保留旧会话', async () => {
    const db = v1();
    db.exec('CREATE TABLE vl_jobs (sentinel TEXT)');
    const before = names(db);
    await expect(migrateVerifiedLearning(db)).rejects.toThrow(/vl_jobs.*already exists/);
    expect(names(db)).toEqual(before);
    expect(db.prepare('SELECT version FROM vl_schema_migrations').all()).toEqual([{ version: 1 }]);
  });

  it('备份失败不执行 v2 DDL', async () => {
    const db = v1(path.join(testDirectory(), 'app.db'));
    const backup = vi.spyOn(db, 'backup').mockRejectedValue(new Error('磁盘不可写'));
    await expect(migrateVerifiedLearning(db)).rejects.toThrow('磁盘不可写');
    expect(names(db)).not.toContain('vl_jobs');
    expect(db.prepare('SELECT version FROM vl_schema_migrations').all()).toEqual([{ version: 1 }]);
    backup.mockRestore();
  });

  it('拒绝未来版本，不先备份', async () => {
    const directory = testDirectory();
    const db = v1(path.join(directory, 'app.db'));
    db.exec("INSERT INTO vl_schema_migrations VALUES (4,'future')");
    await expect(migrateVerifiedLearning(db)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(readdirSync(directory)).toEqual(['app.db']);
  });
});
