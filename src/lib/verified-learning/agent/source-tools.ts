import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { SourceSnapshot } from '../sources';
import { createRetrievalChunks } from '../retrieval/chunking';
import { chapterKeyOf, hybridSearch, keywordSearch, paragraphKeyOf } from '../retrieval/search';
import type { RetrievalService } from '../retrieval/service';

export function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} };
}

/** 注入统一检索服务后，search_sources 返回混合检索结果；服务出错时在工具内退回统一关键词检索 */
export type SourceRetrieval = Pick<RetrievalService, 'retrieve'>;

function localKeywordFallback(query: string, sources: SourceSnapshot[], degraded: boolean) {
  const paragraphs = new Map<string, string>();
  const chapterTitles = new Map<string, string>();
  for (const s of sources) {
    for (const c of s.chapters) {
      chapterTitles.set(chapterKeyOf({ sourceId: s.sourceId, sourceRevision: s.sourceRevision, chapterId: c.chapterId }), c.title);
      for (const p of c.paragraphs) {
        paragraphs.set(paragraphKeyOf({ sourceId: s.sourceId, sourceRevision: s.sourceRevision, chapterId: c.chapterId, paragraphIndex: p.paragraphIndex }), p.text);
      }
    }
  }
  const chunks = sources.flatMap(s => createRetrievalChunks(s, 'fallback'));
  const keywordHits = keywordSearch(String(query), chunks, 40, chapterTitles);
  const hits = hybridSearch({ query: String(query), chunks, keywordHits, vectorHits: [], paragraphs, chapterTitles, limit: 20 });
  return toolResult({
    total: hits.length,
    degraded,
    keywordCount: keywordHits.length,
    vectorCount: 0,
    matches: hits,
  });
}

/** 引用必须来自工具返回的真实段落编号，不把数组下标当段落编号。 */
export function createSourceTools(sources: SourceSnapshot[], retrieval?: SourceRetrieval): AgentTool<any>[] {
  return [
    {
      name: 'list_sources',
      label: '查看资料目录',
      description: '列出可访问资料及章节，正文通过read_source读取。',
      parameters: Type.Object({}),
      execute: async () => toolResult(sources.map(s => ({
        sourceId: s.sourceId,
        sourceRevision: s.sourceRevision,
        title: s.title,
        chapters: s.chapters.map(c => ({ chapterId: c.chapterId, title: c.title, paragraphCount: c.paragraphs.length })),
      }))),
    },
    {
      name: 'search_sources',
      label: '搜索资料',
      description: '在全部已授权教材和补充资料正文中检索（关键词+语义），返回可引用原文与命中方式。',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }) }),
      execute: async (_, input) => {
        const args = input as { query: string };
        if (retrieval) {
          try {
            const result = await retrieval.retrieve(args.query, sources);
            return toolResult({
              total: result.hits.length,
              degraded: result.degraded,
              keywordCount: result.keywordCount,
              vectorCount: result.vectorCount,
              ...(result.notice ? { notice: result.notice } : {}),
              matches: result.hits,
            });
          } catch {
            return localKeywordFallback(args.query, sources, true);
          }
        }
        return localKeywordFallback(args.query, sources, false);
      },
    },
    {
      name: 'read_source',
      label: '读取原文',
      description: '按章节分页读取真实原文。offset是章节内偏移，引用使用返回的paragraphIndex。',
      parameters: Type.Object({
        sourceId: Type.String(),
        chapterId: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_, input) => {
        const args = input as { sourceId: string; chapterId: string; offset?: number; limit?: number };
        const source = sources.find(s => s.sourceId === args.sourceId);
        const chapter = source?.chapters.find(c => c.chapterId === args.chapterId);
        if (!source || !chapter) throw new Error('资料或章节不存在，请先调用list_sources');
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 10);
        return toolResult({
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          chapterId: chapter.chapterId,
          paragraphs: chapter.paragraphs.slice(offset, offset + limit),
          nextOffset: offset + limit < chapter.paragraphs.length ? offset + limit : null,
        });
      },
    },
  ];
}
