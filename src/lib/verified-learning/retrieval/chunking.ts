import type { SourceSnapshot } from '../sources';
import type { RetrievalChunk } from './types';

const SENTENCE = /[^。！？!?；;\n]+[。！？!?；;]?/g;

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const sentences = text.match(SENTENCE)?.map(value => value.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) { chunks.push(current); current = ''; }
      for (let index = 0; index < sentence.length; index += maxLength) chunks.push(sentence.slice(index, index + maxLength));
      continue;
    }
    if (current && current.length + sentence.length > maxLength) { chunks.push(current); current = ''; }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, maxLength)];
}

export function createRetrievalChunks(source: SourceSnapshot, preprocessVersion: string, maxLength = 1000): RetrievalChunk[] {
  return source.chapters.flatMap(chapter => chapter.paragraphs.flatMap(paragraph => {
    if (!paragraph.text.trim()) return [];
    return splitText(paragraph.text, maxLength).map((text, partIndex) => ({
      scopeId: '', sourceId: source.sourceId, sourceRevision: source.sourceRevision, chapterId: chapter.chapterId,
      paragraphIndex: paragraph.paragraphIndex, partIndex, text, contentHash: paragraph.contentHash, preprocessVersion,
    }));
  }));
}
