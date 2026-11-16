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
}

export interface RetrievalSearchInput {
  query: string;
  chunks: readonly RetrievalChunk[];
  keywordHits: readonly RetrievalChunk[];
  vectorHits: readonly RetrievalVectorHit[];
  limit?: number;
}
