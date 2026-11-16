import type Database from 'better-sqlite3';
import { createRetrievalChunks } from './chunking';
import type { EmbeddingProfile } from './profile';
import { encodeVector } from './vector';
import type { RetrievalChunk } from './types';

export interface EmbeddingPort {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface IndexSummary {
  ready: number;
  failed: number;
  skipped: number;
}

/** 每批最多 16 个子块、合计 12000 字符（设计 5.3）。 */
const MAX_BATCH_CHUNKS = 16;
const MAX_BATCH_CHARS = 12_000;

const keyOf = (chunk: { chapterId: string; paragraphIndex: number; partIndex: number }) =>
  `${chunk.chapterId}\0${chunk.paragraphIndex}\0${chunk.partIndex}`;

function ensureChunks(db: Database.Database, scopeId: string, chunks: readonly RetrievalChunk[]): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO vl_retrieval_chunks
    (scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const chunk of chunks) {
      insert.run(scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId, chunk.paragraphIndex, chunk.partIndex, chunk.text, chunk.contentHash, chunk.preprocessVersion);
    }
  })();
}

function pendingChunks(db: Database.Database, scopeId: string, chunks: readonly RetrievalChunk[], profile: EmbeddingProfile): RetrievalChunk[] {
  const rows = db.prepare(`SELECT chapter_id,paragraph_index,part_index,status,dimensions FROM vl_retrieval_vectors
    WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=?`).all(scopeId, chunks[0]?.sourceId ?? '', chunks[0]?.sourceRevision ?? '', profile.profileId) as
    { chapter_id: string; paragraph_index: number; part_index: number; status: string; dimensions: number }[];
  const done = new Set(rows.filter(row => row.status === 'ready' && row.dimensions === profile.dimensions).map(row => keyOf({ chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, partIndex: row.part_index })));
  return chunks.filter(chunk => !done.has(keyOf(chunk)));
}

function batches(items: readonly RetrievalChunk[]): RetrievalChunk[][] {
  const out: RetrievalChunk[][] = [];
  let current: RetrievalChunk[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= MAX_BATCH_CHUNKS || chars + item.text.length > MAX_BATCH_CHARS)) { out.push(current); current = []; chars = 0; }
    current.push(item); chars += item.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

function save(db: Database.Database, scopeId: string, profile: EmbeddingProfile, chunk: RetrievalChunk, status: 'ready' | 'failed', blob: Buffer | null, errorCode: string | null): void {
  db.prepare(`INSERT INTO vl_retrieval_vectors
    (scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,error_code,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id)
    DO UPDATE SET dimensions=excluded.dimensions,vector_blob=excluded.vector_blob,status=excluded.status,error_code=excluded.error_code,updated_at=excluded.updated_at`)
    .run(scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId, chunk.paragraphIndex, chunk.partIndex, profile.profileId, profile.dimensions, blob, status, errorCode, new Date().toISOString());
}

/**
 * 为来源快照建立向量索引：来源快照始终是事实源，失败只记录状态，不影响关键词检索。
 * 已存在且维度匹配的 ready 向量不会重复请求，因此重复调用不重复计费。
 */
export async function indexSource(db: Database.Database, scopeId: string, source: Parameters<typeof createRetrievalChunks>[0], profile: EmbeddingProfile, port: EmbeddingPort): Promise<IndexSummary> {
  const chunks = createRetrievalChunks(source, profile.preprocessVersion).map(chunk => ({ ...chunk, scopeId }));
  if (!chunks.length) return { ready: 0, failed: 0, skipped: 0 };
  ensureChunks(db, scopeId, chunks);
  const pending = pendingChunks(db, scopeId, chunks, profile);
  let ready = 0, failed = 0;
  for (const batch of batches(pending)) {
    try {
      const vectors = await port.embed(batch.map(chunk => chunk.text));
      if (vectors.length !== batch.length) throw new Error('返回数量不匹配');
      db.transaction(() => {
        batch.forEach((chunk, index) => {
          const values = vectors[index];
          if (!values || values.length !== profile.dimensions) { save(db, scopeId, profile, chunk, 'failed', null, 'DIMENSION_MISMATCH'); failed++; return; }
          save(db, scopeId, profile, chunk, 'ready', encodeVector(values), null); ready++;
        });
      })();
    } catch {
      db.transaction(() => { for (const chunk of batch) save(db, scopeId, profile, chunk, 'failed', null, 'EMBEDDING_FAILED'); })();
      failed += batch.length;
    }
  }
  return { ready, failed, skipped: chunks.length - pending.length };
}
