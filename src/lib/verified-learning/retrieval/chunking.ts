import type { SourceSnapshot } from '../sources';
import type { RetrievalChunk } from './types';

// 保留句末标点与换行、不调用 trim()，保证无重叠时拼接与原文逐字符一致，代码缩进与大小写不丢失
const SENTENCE_SPAN = /[^。！？!?；;\n]+[。！？!?；;\n]*/g;

function splitOversizedSpan(span: string, maxLength: number, overlapLimit: number): string[] {
  const pieces: string[] = [];
  const step = overlapLimit > 0 && maxLength > overlapLimit * 2 ? maxLength - overlapLimit : maxLength;
  for (let start = 0; start < span.length; start += step) {
    pieces.push(span.slice(start, start + maxLength));
    if (start + maxLength >= span.length) break;
  }
  return pieces;
}

function splitText(text: string, maxLength: number, maxOverlap: number): string[] {
  if (text.length <= maxLength) return [text];
  const overlapLimit = Math.max(0, Math.min(maxOverlap, Math.floor(maxLength / 4)));
  const spans = text.match(SENTENCE_SPAN) ?? [text];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const span of spans) {
    if (!span) continue;
    if (span.length > maxLength) {
      if (currentLength > 0) {
        chunks.push(current.join(''));
        current = [];
        currentLength = 0;
      }
      chunks.push(...splitOversizedSpan(span, maxLength, overlapLimit));
      continue;
    }
    if (currentLength > 0 && currentLength + span.length > maxLength) {
      chunks.push(current.join(''));
      // 从上一块末尾按句界回溯重叠，最多 overlapLimit 字符且能容纳当前句
      const overlap: string[] = [];
      let overlapLen = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const candidate = current[i];
        if (overlapLen + candidate.length > overlapLimit) break;
        if (overlapLen + candidate.length + span.length > maxLength) break;
        overlap.unshift(candidate);
        overlapLen += candidate.length;
      }
      current = overlap;
      currentLength = overlapLen;
    }
    current.push(span);
    currentLength += span.length;
  }
  if (currentLength > 0) chunks.push(current.join(''));
  return chunks.length ? chunks : [text.slice(0, maxLength)];
}

export function createRetrievalChunks(
  source: SourceSnapshot,
  preprocessVersion: string,
  maxLength = 1000,
  maxOverlap = 100,
): RetrievalChunk[] {
  return source.chapters.flatMap(chapter =>
    chapter.paragraphs.flatMap(paragraph => {
      if (!paragraph.text.trim()) return [];
      return splitText(paragraph.text, maxLength, maxOverlap).map((text, partIndex) => ({
        scopeId: '',
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        chapterId: chapter.chapterId,
        paragraphIndex: paragraph.paragraphIndex,
        partIndex,
        text,
        contentHash: paragraph.contentHash,
        preprocessVersion,
      }));
    }),
  );
}
