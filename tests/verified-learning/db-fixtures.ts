import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const handles: Database.Database[] = [];
const directories: string[] = [];
export function openTestDb(filename = ':memory:'): Database.Database {
  const db = new Database(filename);
  handles.push(db);
  return db;
}
export function testDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'vl-v2-test-'));
  directories.push(directory);
  return directory;
}
export function ownTestDb(db: Database.Database): Database.Database {
  handles.push(db);
  return db;
}
afterEach(() => {
  for (const db of handles.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
