export interface RetrievalChunk {
  scopeId: string;
  sourceId: string;
  sourceRevision: string;
  chapterId: string;
  paragraphIndex: number;
  partIndex: number;
  text: string;
  contentHash: string;
  preprocessVersion: string;
}

export interface RetrievalVectorHit {
  chunk: RetrievalChunk;
  similarity: number;
}

export interface RetrievalHit {
  sourceId: string;
  sourceRevision: string;
  chapterId: string;
  paragraphIndex: number;
  text: string;
  score: number;
  match: { keyword: boolean; vector: boolean; chapterBoost: boolean };
  contentHash: string;
  sourceTitle?: string;
  chapterTitle?: string;
  chapterFiltered?: boolean;
}

export interface RetrievalSearchInput {
  query: string;
  chunks: readonly RetrievalChunk[];
  keywordHits: readonly RetrievalChunk[];
  vectorHits: readonly RetrievalVectorHit[];
  /** 来源快照中的真实原段文本（key: sourceId\0sourceRevision\0chapterId\0paragraphIndex），避免切块重叠破坏引文 */
  paragraphs?: ReadonlyMap<string, string>;
  /** 章节标题映射（key: sourceId\0sourceRevision\0chapterId），用于计算 chapterBoost */
  chapterTitles?: ReadonlyMap<string, string>;
  limit?: number;
}
