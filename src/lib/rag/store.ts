import type Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Chunk } from '../textbook/chunk';

export interface ScoredChunk extends Chunk {
  distance: number;
}

const vecLoadedDbs = new WeakSet<Database.Database>();

function ensureVec(db: Database.Database, dims: number): void {
  if (!vecLoadedDbs.has(db)) {
    sqliteVec.load(db);
    vecLoadedDbs.add(db);
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[${dims}])`,
  );
}

function toF32(embedding: number[]): Float32Array {
  return new Float32Array(embedding);
}

/** 插入分块文本到 chunks 表，向量到 chunk_vectors（rowid 对应） */
export function upsertChunks(
  db: Database.Database,
  textbookId: string,
  chunks: Chunk[],
  embeddings: number[][],
): void {
  ensureVec(db, embeddings[0]?.length ?? 1536);
  if (chunks.length !== embeddings.length) {
    throw new Error(`分块数(${chunks.length})与向量数(${embeddings.length})不一致`);
  }
  const insertChunk = db.prepare(
    'INSERT INTO chunks (id, textbook_id, chapter_id, content, anchor) VALUES (?, ?, ?, ?, ?)',
  );
  const insertVec = db.prepare(
    'INSERT INTO chunk_vectors (rowid, embedding) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    chunks.forEach((c, i) => {
      const info = insertChunk.run(c.id, textbookId, c.chapterId, c.content, JSON.stringify(c.anchor));
      insertVec.run(BigInt(info.lastInsertRowid), toF32(embeddings[i]));
    });
  });
  tx();
}

/** 向量近邻检索：返回按距离升序的 k 个分块 */
export function searchChunks(
  db: Database.Database,
  textbookId: string,
  queryEmbedding: number[],
  k: number,
): ScoredChunk[] {
  ensureVec(db, queryEmbedding.length);
  const rows = db
    .prepare(
      `SELECT c.id, c.chapter_id AS chapterId, c.content, c.anchor, v.distance
       FROM chunk_vectors v
       JOIN chunks c ON c.rowid = v.rowid
       WHERE v.embedding MATCH ? AND k = ? AND c.textbook_id = ?
       ORDER BY v.distance`,
    )
    .all(toF32(queryEmbedding), k, textbookId) as {
    id: string;
    chapterId: string;
    content: string;
    anchor: string;
    distance: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    chapterId: r.chapterId,
    content: r.content,
    anchor: JSON.parse(r.anchor),
    distance: r.distance,
  }));
}
