import type Database from 'better-sqlite3';
import type { SourceSnapshot } from '../sources';
import type { EmbeddingProfile } from './profile';
import { hybridSearch, keywordSearch } from './search';
import { decodeVector } from './vector';
import type { RetrievalChunk, RetrievalHit, RetrievalVectorHit } from './types';

export interface RetrievalEmbeddingPort {
  profile: EmbeddingProfile;
  embed(values: readonly string[]): Promise<number[][]>;
}

export interface RetrieveOptions {
  chapterIds?: string[];
  limit?: number;
}

export interface RetrieveResult {
  hits: RetrievalHit[];
  /** 向量检索不可用，本次只用了关键词 */
  degraded: boolean;
  keywordCount: number;
  vectorCount: number;
}

const MAX_QUERY = 200;
const CANDIDATES = 40;
const keyOf = (chunk: RetrievalChunk) => `${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}\0${chunk.paragraphIndex}`;
const chunkKey = (chunk: { sourceId: string; sourceRevision: string; chapterId: string; paragraphIndex: number }) => `${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}\0${chunk.paragraphIndex}`;

/**
 * 统一检索层：来源快照与章节范围决定可访问的段落，派生块/向量只作检索加速。
 * 无 Embedding 配置或查询向量失败时退回关键词检索，调用方拿到 degraded 标记。
 */
export function createRetrievalService(db: Database.Database, scopeId: string, embedding?: RetrievalEmbeddingPort) {
  const loadChunks = (sources: readonly SourceSnapshot[], chapterIds?: string[]): RetrievalChunk[] => {
    const allowed = new Set(sources.map(source => `${source.sourceId}\0${source.sourceRevision}`));
    const chapters = new Set(sources.flatMap(source => source.chapters.map(chapter => `${source.sourceId}\0${source.sourceRevision}\0${chapter.chapterId}`)));
    const wanted = chapterIds?.length ? new Set(chapterIds) : null;
    if (!allowed.size) return [];
    const rows = db.prepare(`SELECT book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version
      FROM vl_retrieval_chunks WHERE scope_id=?`).all(scopeId) as {
        book_id: string; source_revision: string; chapter_id: string; paragraph_index: number; part_index: number;
        text: string; content_hash: string; preprocess_version: string }[];
    return rows
      .map(row => ({
        scopeId, sourceId: row.book_id, sourceRevision: row.source_revision, chapterId: row.chapter_id,
        paragraphIndex: row.paragraph_index, partIndex: row.part_index, text: row.text, contentHash: row.content_hash, preprocessVersion: row.preprocess_version,
      }))
      .filter(chunk => allowed.has(`${chunk.sourceId}\0${chunk.sourceRevision}`))
      .filter(chunk => chapters.has(`${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}`))
      .filter(chunk => !wanted || wanted.has(chunk.chapterId))
      .map(chunk => ({ ...chunk, scopeId }));
  };

  const vectorHits = (chunks: readonly RetrievalChunk[], query: number[]): RetrievalVectorHit[] => {
    if (!embedding || !chunks.length) return [];
    const ids = new Set(chunks.map(chunk => `${chunk.sourceId}|${chunk.sourceRevision}|${chunk.chapterId}|${chunk.paragraphIndex}|${chunk.partIndex}`));
    const rows = db.prepare(`SELECT book_id,source_revision,chapter_id,paragraph_index,part_index,dimensions,vector_blob
      FROM vl_retrieval_vectors WHERE scope_id=? AND profile_id=? AND status='ready'`).all(scopeId, embedding.profile.profileId) as
      { book_id: string; source_revision: string; chapter_id: string; paragraph_index: number; part_index: number; dimensions: number; vector_blob: Buffer }[];
    const scored: RetrievalVectorHit[] = [];
    for (const row of rows) {
      if (!ids.has(`${row.book_id}|${row.source_revision}|${row.chapter_id}|${row.paragraph_index}|${row.part_index}`)) continue;
      let vector: Float32Array;
      try { vector = decodeVector(row.vector_blob, row.dimensions); } catch { continue; }
      if (vector.length !== query.length) continue;
      let dot = 0, normA = 0, normB = 0;
      for (let index = 0; index < vector.length; index++) { dot += vector[index] * query[index]; normA += vector[index] * vector[index]; normB += query[index] * query[index]; }
      if (!normA || !normB) continue;
      const chunk = chunks.find(item => item.sourceId === row.book_id && item.sourceRevision === row.source_revision && item.chapterId === row.chapter_id && item.paragraphIndex === row.paragraph_index && item.partIndex === row.part_index)!;
      scored.push({ chunk, similarity: dot / Math.sqrt(normA * normB) });
    }
    return scored.sort((a, b) => b.similarity - a.similarity || keyOf(a.chunk).localeCompare(keyOf(b.chunk)) || a.chunk.partIndex - b.chunk.partIndex).slice(0, CANDIDATES);
  };

  return {
    async retrieve(query: string, sources: readonly SourceSnapshot[], options: RetrieveOptions = {}): Promise<RetrieveResult> {
      const text = query.trim();
      if (!text) return { hits: [], degraded: false, keywordCount: 0, vectorCount: 0 };
      if (text.length > MAX_QUERY) throw new Error('查询过长，请缩减到 200 字以内');
      const chunks = loadChunks(sources, options.chapterIds);
      if (!chunks.length) return { hits: [], degraded: false, keywordCount: 0, vectorCount: 0 };
      const keyword = keywordSearch(text, chunks, CANDIDATES);
      let vectors: RetrievalVectorHit[] = [], degraded = false;
      if (embedding) {
        try {
          const [vector] = await embedding.embed([text]);
          if (!vector) throw new Error('Embedding 未返回查询向量');
          vectors = vectorHits(chunks, vector);
        } catch { degraded = true; }
      }
      const hits = hybridSearch({ query: text, chunks, keywordHits: keyword, vectorHits: vectors, limit: options.limit });
      return { hits, degraded, keywordCount: keyword.length, vectorCount: vectors.length };
    },
  };
}

export type RetrievalService = ReturnType<typeof createRetrievalService>;
