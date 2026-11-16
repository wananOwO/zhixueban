import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { removeIdleSpaces } from '@/lib/verified-learning/cleanup';
import { ownTestDb, testDirectory } from './db-fixtures';

const SPACE = 'a'.repeat(43);
const source = { sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt', chapters: [] };

async function dbWithIndexedSpace() {
  const db = ownTestDb(new Database(':memory:'));
  await migrateVerifiedLearning(db);
  db.prepare('INSERT INTO vl_spaces(space_id,created_at,last_seen_at) VALUES (?,?,?)').run(SPACE, '2020-01-01', '2020-01-01');
  db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,?,'owned','ready','t')`).run(SPACE, 'book');
  db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,'revision',?,'t')`).run(SPACE, 'book', JSON.stringify(source));
  db.prepare(`INSERT INTO vl_retrieval_chunks(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
    VALUES (?,?,'revision','chapter',0,0,'text','hash','v1')`).run(SPACE, 'book');
  db.prepare(`INSERT INTO vl_retrieval_vectors(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,updated_at)
    VALUES (?,?,'revision','chapter',0,0,'profile',3,NULL,'failed','t')`).run(SPACE, 'book');
  db.prepare(`INSERT INTO vl_index_jobs(scope_id,job_id,book_id,source_revision,profile_id,status,progress_json,created_at,updated_at)
    VALUES (?,?,'book','revision','profile','queued','{}','t','t')`).run(SPACE, 'job');
  return db;
}

describe('闲置空间清理覆盖检索派生数据', () => {
  it('删除空间时同时清理检索块、向量和索引任务', async () => {
    const db = await dbWithIndexedSpace();
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT count(*) AS n FROM vl_retrieval_chunks')).toBe(1);
    removeIdleSpaces(db, testDirectory(), new Date('2026-01-01'));
    expect(count('SELECT count(*) AS n FROM vl_retrieval_chunks')).toBe(0);
    expect(count('SELECT count(*) AS n FROM vl_retrieval_vectors')).toBe(0);
    expect(count('SELECT count(*) AS n FROM vl_index_jobs')).toBe(0);
  });
});
