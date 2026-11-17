import type Database from 'better-sqlite3';
import { createRetrievalChunks } from './chunking';
import type { EmbeddingProfile } from './profile';
import { decodeVector, encodeVector } from './vector';
import type { RetrievalChunk } from './types';

export interface EmbeddingPort {
  embed(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}

export interface IndexSummary {
  ready: number;
  failed: number;
  skipped: number;
}

/** 每批最多 16 个子块、合计 12000 字符、单次授权上限 100 批次请求（设计 5.3）。 */
export const MAX_BATCH_CHUNKS = 16;
export const MAX_BATCH_CHARS = 12_000;
export const MAX_BATCH_REQUESTS = 100;

const keyOf = (chunk: { chapterId: string; paragraphIndex: number; partIndex: number }) =>
  `${chunk.chapterId}\0${chunk.paragraphIndex}\0${chunk.partIndex}`;

export function ensureChunks(db: Database.Database, scopeId: string, chunks: readonly RetrievalChunk[]): void {
  const selectExisting = db.prepare(`SELECT content_hash, preprocess_version FROM vl_retrieval_chunks
    WHERE scope_id=? AND book_id=? AND source_revision=? AND chapter_id=? AND paragraph_index=? AND part_index=?`);
  const upsertChunk = db.prepare(`INSERT INTO vl_retrieval_chunks
    (scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index)
    DO UPDATE SET text=excluded.text,content_hash=excluded.content_hash,preprocess_version=excluded.preprocess_version`);
  const markStale = db.prepare(`UPDATE vl_retrieval_vectors SET status='stale', error_code='CONTENT_CHANGED', updated_at=?
    WHERE scope_id=? AND book_id=? AND source_revision=? AND chapter_id=? AND paragraph_index=? AND part_index=?`);
  const now = new Date().toISOString();

  db.transaction(() => {
    for (const chunk of chunks) {
      const prior = selectExisting.get(
        scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId, chunk.paragraphIndex, chunk.partIndex,
      ) as { content_hash: string; preprocess_version: string } | undefined;
      if (prior && (prior.content_hash !== chunk.contentHash || prior.preprocess_version !== chunk.preprocessVersion)) {
        markStale.run(now, scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId, chunk.paragraphIndex, chunk.partIndex);
      }
      upsertChunk.run(
        scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId,
        chunk.paragraphIndex, chunk.partIndex, chunk.text, chunk.contentHash, chunk.preprocessVersion,
      );
    }
  })();
}

export function invalidateProfileVectors(db: Database.Database, scopeId: string, bookId: string, sourceRevision: string, profileId: string): void {
  db.prepare(`UPDATE vl_retrieval_vectors SET status='stale', error_code='REBUILD_REQUESTED', updated_at=?
    WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=?`)
    .run(new Date().toISOString(), scopeId, bookId, sourceRevision, profileId);
}

export function pendingChunks(
  db: Database.Database,
  scopeId: string,
  bookId: string,
  sourceRevision: string,
  chunks: readonly RetrievalChunk[],
  profile: EmbeddingProfile,
): RetrievalChunk[] {
  const rows = db.prepare(`SELECT v.chapter_id,v.paragraph_index,v.part_index,v.status,v.dimensions,v.vector_blob,c.content_hash,c.preprocess_version
    FROM vl_retrieval_vectors v
    JOIN vl_retrieval_chunks c ON c.scope_id=v.scope_id AND c.book_id=v.book_id AND c.source_revision=v.source_revision
      AND c.chapter_id=v.chapter_id AND c.paragraph_index=v.paragraph_index AND c.part_index=v.part_index
    WHERE v.scope_id=? AND v.book_id=? AND v.source_revision=? AND v.profile_id=?`).all(
    scopeId, bookId, sourceRevision, profile.profileId,
  ) as {
    chapter_id: string; paragraph_index: number; part_index: number; status: string;
    dimensions: number; vector_blob: Buffer | null; content_hash: string; preprocess_version: string;
  }[];

  const byKey = new Map(rows.map(row => [keyOf({ chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, partIndex: row.part_index }), row]));
  return chunks.filter(chunk => {
    const row = byKey.get(keyOf(chunk));
    if (!row || row.status !== 'ready' || !row.vector_blob) return true;
    if (row.content_hash !== chunk.contentHash || row.preprocess_version !== chunk.preprocessVersion) return true;
    if (profile.dimensions !== null && row.dimensions !== profile.dimensions) return true;
    try {
      decodeVector(row.vector_blob, row.dimensions);
      return false;
    } catch {
      return true;
    }
  });
}

export function batches(items: readonly RetrievalChunk[]): RetrievalChunk[][] {
  const out: RetrievalChunk[][] = [];
  let current: RetrievalChunk[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= MAX_BATCH_CHUNKS || chars + item.text.length > MAX_BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

export function saveVector(
  db: Database.Database,
  scopeId: string,
  profile: EmbeddingProfile,
  chunk: RetrievalChunk,
  dimensions: number,
  status: 'ready' | 'failed' | 'stale',
  blob: Buffer | null,
  errorCode: string | null,
): void {
  db.prepare(`INSERT INTO vl_retrieval_vectors
    (scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,error_code,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id)
    DO UPDATE SET dimensions=excluded.dimensions,vector_blob=excluded.vector_blob,status=excluded.status,error_code=excluded.error_code,updated_at=excluded.updated_at`)
    .run(
      scopeId, chunk.sourceId, chunk.sourceRevision, chunk.chapterId,
      chunk.paragraphIndex, chunk.partIndex, profile.profileId, dimensions,
      blob, status, errorCode, new Date().toISOString(),
    );
}

/** 派生块构造（来源快照不变） */
export function sourceChunks(scopeId: string, source: Parameters<typeof createRetrievalChunks>[0], preprocessVersion: string): RetrievalChunk[] {
  return createRetrievalChunks(source, preprocessVersion).map(chunk => ({ ...chunk, scopeId }));
}

/**
 * 为来源快照建立向量索引：来源快照始终是事实源，失败只记录状态，不影响关键词检索。
 * 已存在且维度、hash、格式校验通过的 ready 向量不会重复请求，重复调用不重复计费。
 */
export async function indexSource(
  db: Database.Database,
  scopeId: string,
  source: Parameters<typeof createRetrievalChunks>[0],
  profile: EmbeddingProfile,
  port: EmbeddingPort,
): Promise<IndexSummary> {
  const chunks = sourceChunks(scopeId, source, profile.preprocessVersion);
  if (!chunks.length) return { ready: 0, failed: 0, skipped: 0 };
  ensureChunks(db, scopeId, chunks);
  const pending = pendingChunks(db, scopeId, source.sourceId, source.sourceRevision, chunks, profile);
  let ready = 0;
  let failed = 0;
  let expectedDims: number | null = profile.dimensions;

  for (const batch of batches(pending)) {
    try {
      const vectors = await port.embed(batch.map(chunk => chunk.text));
      if (vectors.length !== batch.length) throw new Error('返回数量不匹配');
      db.transaction(() => {
        batch.forEach((chunk, index) => {
          const values = vectors[index];
          const dimensions = expectedDims ?? values?.length ?? 0;
          if (!values || !dimensions || values.length !== dimensions) {
            saveVector(db, scopeId, profile, chunk, Math.max(0, values?.length ?? 0), 'failed', null, 'DIMENSION_MISMATCH');
            failed++;
            return;
          }
          try {
            saveVector(db, scopeId, profile, chunk, dimensions, 'ready', encodeVector(values), null);
            if (expectedDims === null) expectedDims = dimensions;
            ready++;
          } catch {
            saveVector(db, scopeId, profile, chunk, dimensions, 'failed', null, 'DIMENSION_MISMATCH');
            failed++;
          }
        });
      })();
    } catch {
      db.transaction(() => {
        for (const chunk of batch) saveVector(db, scopeId, profile, chunk, profile.dimensions ?? 0, 'failed', null, 'EMBEDDING_FAILED');
      })();
      failed += batch.length;
    }
  }
  return { ready, failed, skipped: chunks.length - pending.length };
}
