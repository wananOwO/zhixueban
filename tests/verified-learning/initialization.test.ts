import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '@/lib/db/schema';
import { initializeVerifiedLearning, openInitializedDb } from '@/lib/verified-learning/initialization';
import { SCHEMA_V1 } from './schema-v1';
import { openTestDb, ownTestDb, testDirectory } from './db-fixtures';

const cli = path.resolve('scripts/verified-learning-init.ts');
function root() {
  const directory = testDirectory();
  mkdirSync(path.join(directory, 'data'));
  return directory;
}
function oldDatabase(filename: string) {
  const db = openTestDb(filename);
  db.exec(SCHEMA_SQL);
  db.exec(SCHEMA_V1);
  db.exec("INSERT INTO vl_schema_migrations VALUES (1,'2026-10-20T00:00:00.000Z')");
  db.exec("INSERT INTO settings VALUES ('old','keep')");
  db.close();
}
afterEach(() => vi.unstubAllEnvs());

describe('显式初始化与只读启动检查', () => {
  it('不指定路径不创建默认数据库，不存在时要求显式create', async () => {
    const directory = root();
    await expect(initializeVerifiedLearning(undefined, false, directory)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(initializeVerifiedLearning('data/new.db', false, directory)).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
    expect(readdirSync(path.join(directory, 'data'))).toEqual([]);
  });

  it('明确create只建立指定库，包含旧表和v2，之后不重复备份', async () => {
    const directory = root();
    const filename = path.join(directory, 'data/new.db');
    const result = await initializeVerifiedLearning('data/new.db', true, directory);
    expect(result).toMatchObject({ schemaVersion: 5, created: true });
    expect(existsSync(filename)).toBe(true);
    const db = ownTestDb(openInitializedDb('data/new.db', directory));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='textbooks'").get()).toEqual({ name: 'textbooks' });
    expect(db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    const files = readdirSync(path.join(directory, 'data'));
    expect(await initializeVerifiedLearning('data/new.db', false, directory)).toMatchObject({ created: false });
    expect(readdirSync(path.join(directory, 'data'))).toEqual(files);
  });

  it('升级前备份旧库且保留旧数据，不触碰旁边另一个库', async () => {
    const directory = root();
    const filename = path.join(directory, 'data/old.db');
    const other = path.join(directory, 'data/other.db');
    oldDatabase(filename);
    oldDatabase(other);
    const before = readFileSync(other);
    await initializeVerifiedLearning(filename, false, directory);
    expect(readFileSync(other)).toEqual(before);
    const db = ownTestDb(openInitializedDb(filename, directory));
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'old', value: 'keep' }]);
    expect(readdirSync(path.join(directory, 'data')).filter(name => name.endsWith('.bak'))).toHaveLength(1);
  });

  it('拒绝越界、内存库、备用路径和符号链接逃逸', async () => {
    const directory = root();
    const outside = root();
    oldDatabase(path.join(outside, 'data/out.db'));
    for (const input of [':memory:', '../out.db', 'data/../out.db', path.join(outside, 'data/out.db')]) {
      await expect(initializeVerifiedLearning(input, true, directory)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    const link = path.join(directory, 'data/link');
    symlinkSync(path.join(outside, 'data'), link, 'junction');
    await expect(initializeVerifiedLearning('data/link/out.db', false, directory)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(readdirSync(path.join(outside, 'data'))).toEqual(['out.db']);
  });

  it('打开缺失或v1库不会偷偷创建/迁移，未来版本拒绝', async () => {
    const directory = root();
    const filename = path.join(directory, 'data/old.db');
    expect(() => openInitializedDb('data/missing.db', directory)).toThrow(expect.objectContaining({ code: 'NOT_INITIALIZED' }));
    expect(existsSync(path.join(directory, 'data/missing.db'))).toBe(false);
    oldDatabase(filename);
    const before = readFileSync(filename);
    expect(() => openInitializedDb(filename, directory)).toThrow(expect.objectContaining({ code: 'NOT_INITIALIZED' }));
    expect(readFileSync(filename)).toEqual(before);
    expect(readdirSync(path.join(directory, 'data'))).toEqual(['old.db']);
    const db = openTestDb(filename);
    db.exec("INSERT INTO vl_schema_migrations VALUES (4,'future')");
    db.close();
    expect(() => openInitializedDb(filename, directory)).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }));
  });

  it('CLI错误参数不写入，显式create可真实运行并再次幂等执行', () => {
    const directory = root();
    const run = (args: string[]) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
    });
    const missing = run([]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('--db');
    expect(run(['--db', 'data/app.db', '--unknown']).status).toBe(1);
    expect(readdirSync(path.join(directory, 'data'))).toEqual([]);
    const created = run(['--db', 'data/app.db', '--create']);
    expect(created.stderr).toBe('');
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('版本 5');
    expect(run(['--db', 'data/app.db']).status).toBe(0);
  // 四次启动子进程（每次约 1 秒），全量并行跑时会超过默认 5 秒
  }, 60_000);
});
