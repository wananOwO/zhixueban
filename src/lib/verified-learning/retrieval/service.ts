import type Database from 'better-sqlite3';
import { LearningError } from '../contracts';
import { checkCitation, type SourceSnapshot } from '../sources';
import { createRetrievalChunks } from './chunking';
import { PREPROCESS_VERSION } from './from-settings';
import type { EmbeddingProfile } from './profile';
import { chapterKeyOf, hybridSearch, keywordSearch, paragraphKeyOf } from './search';
import { decodeVector } from './vector';
import type { RetrievalChunk, RetrievalHit, RetrievalVectorHit } from './types';

export interface RetrievalEmbeddingPort {
  profile: EmbeddingProfile;
  embed(values: readonly string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}

export interface RetrieveOptions {
  chapterIds?: string[];
  limit?: number;
  signal?: AbortSignal;
}

export interface RetrieveResult {
  hits: RetrievalHit[];
  /** 向量检索不可用或超限，本次退回了关键词检索 */
  degraded: boolean;
  degradedReason?: 'EMBEDDING_ERROR' | 'CHUNK_LIMIT_EXCEEDED';
  notice?: string;
  keywordCount: number;
  vectorCount: number;
  embedLatencyMs?: number;
  localSearchLatencyMs?: number;
}

export const MAX_QUERY = 200;
export const MAX_RETRIEVAL_CHUNKS = 20_000;
const CANDIDATES = 40;
const YIELD_BATCH = 256;

const partKeyOf = (item: { sourceId: string; sourceRevision: string; chapterId: string; paragraphIndex: number; partIndex: number }) =>
  `${item.sourceId}\0${item.sourceRevision}\0${item.chapterId}\0${item.paragraphIndex}\0${item.partIndex}`;

/**
 * 统一检索层：
 * - 来源快照与章节范围是唯一事实源；已撤销的来源修订立即拒绝；
 * - 未建立派生索引的教材或新拉取的 web 公开来源按需在内存分块做关键词召回，绝不静默丢段落，也不悄悄付费建向量；
 * - 向量扫描单次上限 20000 子块，每 256 条让出事件循环避免阻塞 SSE；异常维度向量忽略并标记 stale；
 * - 返回前以来源快照原文与 checkCitation 二次校验引用合法性。
 */
export function createRetrievalService(db: Database.Database, scopeId: string, embedding?: RetrievalEmbeddingPort) {
  const preprocessVersion = embedding?.profile.preprocessVersion ?? PREPROCESS_VERSION;

  const isAuthorizedRevisionInDb = (sourceId: string, sourceRevision: string): boolean => {
    const row = db.prepare(
      'SELECT revoked_at FROM vl_source_revisions WHERE scope_id=? AND book_id=? AND source_revision=?',
    ).get(scopeId, sourceId, sourceRevision) as { revoked_at: string | null } | undefined;
    return Boolean(row && row.revoked_at === null);
  };

  const prepareAuthorized = (sources: readonly SourceSnapshot[], chapterIds?: string[]) => {
    const wantedChapters = chapterIds?.length ? new Set(chapterIds) : null;
    const chapterFiltered = Boolean(wantedChapters);
    const activeSources: SourceSnapshot[] = [];
    const paragraphs = new Map<string, string>();
    const paragraphHashes = new Map<string, string>();
    const chapterTitles = new Map<string, string>();
    const sourceTitles = new Map<string, string>();

    for (const source of sources) {
      if (!isAuthorizedRevisionInDb(source.sourceId, source.sourceRevision)) continue;
      const filteredChapters = wantedChapters
        ? source.chapters.filter(ch => wantedChapters.has(ch.chapterId))
        : source.chapters;
      if (!filteredChapters.length) continue;
      const filteredSource: SourceSnapshot = { ...source, chapters: filteredChapters };
      activeSources.push(filteredSource);
      sourceTitles.set(`${source.sourceId}\0${source.sourceRevision}`, source.title);

      for (const chapter of filteredChapters) {
        chapterTitles.set(chapterKeyOf({ sourceId: source.sourceId, sourceRevision: source.sourceRevision, chapterId: chapter.chapterId }), chapter.title);
        for (const paragraph of chapter.paragraphs) {
          const pKey = paragraphKeyOf({
            sourceId: source.sourceId,
            sourceRevision: source.sourceRevision,
            chapterId: chapter.chapterId,
            paragraphIndex: paragraph.paragraphIndex,
          });
          paragraphs.set(pKey, paragraph.text);
          paragraphHashes.set(pKey, paragraph.contentHash);
        }
      }
    }

    if (!activeSources.length) {
      return { activeSources, chunks: [] as RetrievalChunk[], paragraphs, chapterTitles, sourceTitles, chapterFiltered };
    }

    const selectChunks = db.prepare(`SELECT chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version
      FROM vl_retrieval_chunks WHERE scope_id=? AND book_id=? AND source_revision=? AND preprocess_version=?`);

    const chunks: RetrievalChunk[] = [];
    for (const source of activeSources) {
      const dbRows = selectChunks.all(scopeId, source.sourceId, source.sourceRevision, preprocessVersion) as {
        chapter_id: string; paragraph_index: number; part_index: number;
        text: string; content_hash: string; preprocess_version: string;
      }[];

      const validDbByParagraph = new Map<string, RetrievalChunk[]>();
      for (const row of dbRows) {
        const pKey = paragraphKeyOf({
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          chapterId: row.chapter_id,
          paragraphIndex: row.paragraph_index,
        });
        const expectedHash = paragraphHashes.get(pKey);
        if (!expectedHash || expectedHash !== row.content_hash) continue;
        const list = validDbByParagraph.get(pKey) ?? [];
        list.push({
          scopeId,
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          chapterId: row.chapter_id,
          paragraphIndex: row.paragraph_index,
          partIndex: row.part_index,
          text: row.text,
          contentHash: row.content_hash,
          preprocessVersion: row.preprocess_version,
        });
        validDbByParagraph.set(pKey, list);
      }

      // 只对尚未落入 vl_retrieval_chunks 的段落按需内存分块，避免每次查询对已建索引全书重复正则切句
      for (const chapter of source.chapters) {
        const missingParagraphs = chapter.paragraphs.filter(p => {
          const pKey = paragraphKeyOf({
            sourceId: source.sourceId,
            sourceRevision: source.sourceRevision,
            chapterId: chapter.chapterId,
            paragraphIndex: p.paragraphIndex,
          });
          return !validDbByParagraph.has(pKey);
        });
        const fallbackMap = new Map<string, RetrievalChunk[]>();
        if (missingParagraphs.length > 0) {
          const partialSource: SourceSnapshot = { ...source, chapters: [{ ...chapter, paragraphs: missingParagraphs }] };
          for (const chunk of createRetrievalChunks(partialSource, preprocessVersion)) {
            const pKey = paragraphKeyOf(chunk);
            const list = fallbackMap.get(pKey) ?? [];
            list.push({ ...chunk, scopeId });
            fallbackMap.set(pKey, list);
          }
        }
        for (const p of chapter.paragraphs) {
          const pKey = paragraphKeyOf({
            sourceId: source.sourceId,
            sourceRevision: source.sourceRevision,
            chapterId: chapter.chapterId,
            paragraphIndex: p.paragraphIndex,
          });
          const stored = validDbByParagraph.get(pKey) ?? fallbackMap.get(pKey);
          if (stored?.length) chunks.push(...stored);
        }
      }
    }

    return { activeSources, chunks, paragraphs, chapterTitles, sourceTitles, chapterFiltered };
  };

  const scanVectors = async (
    activeSources: readonly SourceSnapshot[],
    chunkByPart: ReadonlyMap<string, RetrievalChunk>,
    queryVector: number[],
  ): Promise<RetrievalVectorHit[]> => {
    if (!embedding || !chunkByPart.size || !queryVector.length) return [];
    let normB = 0;
    for (let i = 0; i < queryVector.length; i++) {
      if (!Number.isFinite(queryVector[i])) throw new Error('查询向量包含非法数值');
      normB += queryVector[i] * queryVector[i];
    }
    if (normB === 0) throw new Error('查询向量不能为零');

    const selectVectors = db.prepare(`SELECT chapter_id,paragraph_index,part_index,dimensions,vector_blob
      FROM vl_retrieval_vectors WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=? AND status='ready'`);
    const markStale = db.prepare(`UPDATE vl_retrieval_vectors SET status='stale', error_code='DIMENSION_MISMATCH', updated_at=?
      WHERE scope_id=? AND book_id=? AND source_revision=? AND chapter_id=? AND paragraph_index=? AND part_index=? AND profile_id=?`);

    const scored: RetrievalVectorHit[] = [];
    const staleItems: { bookId: string; sourceRevision: string; chapterId: string; paragraphIndex: number; partIndex: number }[] = [];
    let scanned = 0;

    for (const source of activeSources) {
      const rows = selectVectors.all(scopeId, source.sourceId, source.sourceRevision, embedding.profile.profileId) as {
        chapter_id: string; paragraph_index: number; part_index: number; dimensions: number; vector_blob: Buffer;
      }[];

      for (const row of rows) {
        const chunk = chunkByPart.get(partKeyOf({
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          chapterId: row.chapter_id,
          paragraphIndex: row.paragraph_index,
          partIndex: row.part_index,
        }));
        if (!chunk) continue;

        scanned++;
        if (scanned % YIELD_BATCH === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }

        if (row.dimensions !== queryVector.length || (embedding.profile.dimensions !== null && row.dimensions !== embedding.profile.dimensions)) {
          staleItems.push({ bookId: source.sourceId, sourceRevision: source.sourceRevision, chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, partIndex: row.part_index });
          continue;
        }
        let vector: Float32Array;
        try {
          vector = decodeVector(row.vector_blob, row.dimensions);
        } catch {
          staleItems.push({ bookId: source.sourceId, sourceRevision: source.sourceRevision, chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, partIndex: row.part_index });
          continue;
        }
        let dot = 0;
        let normA = 0;
        for (let index = 0; index < vector.length; index++) {
          dot += vector[index] * queryVector[index];
          normA += vector[index] * vector[index];
        }
        if (!normA) {
          staleItems.push({ bookId: source.sourceId, sourceRevision: source.sourceRevision, chapterId: row.chapter_id, paragraphIndex: row.paragraph_index, partIndex: row.part_index });
          continue;
        }
        scored.push({ chunk, similarity: dot / Math.sqrt(normA * normB) });
      }
    }

    if (staleItems.length > 0) {
      const now = new Date().toISOString();
      try {
        db.transaction(() => {
          for (const item of staleItems) {
            markStale.run(now, scopeId, item.bookId, item.sourceRevision, item.chapterId, item.paragraphIndex, item.partIndex, embedding.profile.profileId);
          }
        })();
      } catch {
        /* 只读连接下忽略 stale 回写失败 */
      }
    }

    const bestByParagraph = new Map<string, RetrievalVectorHit>();
    for (const hit of scored) {
      const pKey = paragraphKeyOf(hit.chunk);
      const prior = bestByParagraph.get(pKey);
      if (!prior || hit.similarity > prior.similarity || (hit.similarity === prior.similarity && hit.chunk.partIndex < prior.chunk.partIndex)) {
        bestByParagraph.set(pKey, hit);
      }
    }

    return [...bestByParagraph.values()]
      .sort((a, b) =>
        b.similarity - a.similarity
        || a.chunk.sourceId.localeCompare(b.chunk.sourceId)
        || a.chunk.chapterId.localeCompare(b.chunk.chapterId)
        || a.chunk.paragraphIndex - b.chunk.paragraphIndex)
      .slice(0, CANDIDATES);
  };

  return {
    async retrieve(query: string, sources: readonly SourceSnapshot[], options: RetrieveOptions = {}): Promise<RetrieveResult> {
      const text = query.trim();
      if (!text) return { hits: [], degraded: false, keywordCount: 0, vectorCount: 0 };
      if (text.length > MAX_QUERY) throw new LearningError('INVALID_INPUT', '查询过长，请缩减到 200 字以内');

      const localStart = performance.now();
      const { activeSources, chunks, paragraphs, chapterTitles, sourceTitles, chapterFiltered } = prepareAuthorized(sources, options.chapterIds);
      if (!chunks.length) return { hits: [], degraded: false, keywordCount: 0, vectorCount: 0 };

      const keyword = keywordSearch(text, chunks, CANDIDATES, chapterTitles);
      let vectors: RetrievalVectorHit[] = [];
      let degraded = false;
      let degradedReason: RetrieveResult['degradedReason'];
      let notice: string | undefined;
      let embedLatencyMs = 0;

      if (embedding) {
        if (chunks.length > MAX_RETRIEVAL_CHUNKS) {
          degraded = true;
          degradedReason = 'CHUNK_LIMIT_EXCEEDED';
          notice = `当前检索范围包含 ${chunks.length} 个子块（超过 ${MAX_RETRIEVAL_CHUNKS} 上限），请缩小所选章节；本次已自动使用完整授权范围的关键词检索。`;
        } else {
          const embedStart = performance.now();
          try {
            const [queryVec] = await embedding.embed([text], { signal: options.signal });
            embedLatencyMs = performance.now() - embedStart;
            if (!queryVec) throw new Error('Embedding 未返回查询向量');
            const chunkByPart = new Map(chunks.map(chunk => [partKeyOf(chunk), chunk]));
            vectors = await scanVectors(activeSources, chunkByPart, queryVec);
          } catch (error) {
            embedLatencyMs = performance.now() - embedStart;
            if (options.signal?.aborted) throw error;
            degraded = true;
            degradedReason = 'EMBEDDING_ERROR';
            notice = '语义索引暂不可用，当前使用关键词检索。';
          }
        }
      }

      const rawHits = hybridSearch({
        query: text,
        chunks,
        keywordHits: keyword,
        vectorHits: vectors,
        paragraphs,
        chapterTitles,
        limit: options.limit,
      });

      // 返回前再次校验来源快照与引用合法性（设计 5.5 步骤 10）
      const verifiedHits = rawHits.flatMap((hit): RetrievalHit[] => {
        const quoteSample = hit.text.trim().slice(0, Math.min(80, hit.text.trim().length));
        if (!quoteSample) return [];
        const check = checkCitation(activeSources, {
          sourceId: hit.sourceId,
          sourceRevision: hit.sourceRevision,
          chapterId: hit.chapterId,
          paragraphIndex: hit.paragraphIndex,
          quote: quoteSample,
        });
        if (!check.ok) return [];
        return [{
          ...hit,
          text: check.paragraphText,
          contentHash: check.citation.contentHash,
          sourceTitle: sourceTitles.get(`${hit.sourceId}\0${hit.sourceRevision}`),
          chapterTitle: chapterTitles.get(chapterKeyOf(hit)),
          chapterFiltered,
        }];
      });

      const localSearchLatencyMs = Math.max(0, performance.now() - localStart - embedLatencyMs);
      return {
        hits: verifiedHits,
        degraded,
        ...(degradedReason ? { degradedReason } : {}),
        ...(notice ? { notice } : {}),
        keywordCount: keyword.length,
        vectorCount: vectors.length,
        embedLatencyMs,
        localSearchLatencyMs,
      };
    },
  };
}

export type RetrievalService = ReturnType<typeof createRetrievalService>;
