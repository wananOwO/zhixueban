import { createHash } from 'node:crypto';
import type { ChapterTree } from '../textbook/types';
import { LearningError } from './contracts';

export interface SourceRef { sourceId: string; sourceRevision: string }
export interface CitationInput extends SourceRef { chapterId: string; paragraphIndex: number; quote: string }
export interface SourceSnapshot extends SourceRef {
  title: string; format: ChapterTree['format'];
  chapters: { chapterId: string; title: string; paragraphs: { paragraphIndex: number; text: string; contentHash: string }[] }[];
}
export function contentHash(text: string | Buffer): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
export function createSourceSnapshot(sourceId: string, tree: ChapterTree): SourceSnapshot {
  if (!sourceId.trim() || !Array.isArray(tree.chapters)) throw new LearningError('INVALID_INPUT', '教材结构不合法');
  const chapterIds = new Set<string>();
  const indices = new Set<number>();
  const chapters = tree.chapters.map(chapter => {
    if (!chapter.id || chapterIds.has(chapter.id)) throw new LearningError('INVALID_INPUT', '章节编号重复');
    chapterIds.add(chapter.id);
    return { chapterId: chapter.id, title: chapter.title, paragraphs: chapter.paragraphs.map(paragraph => {
      const index = paragraph.anchor.index;
      if (paragraph.anchor.chapterId !== chapter.id || !Number.isSafeInteger(index) || index < 0 || indices.has(index)) {
        throw new LearningError('INVALID_INPUT', '段落锚点不合法');
      }
      indices.add(index);
      const text = paragraph.text.replace(/\r\n/g, '\n');
      return { paragraphIndex: index, text, contentHash: contentHash(text) };
    }) };
  });
  const body = { title: tree.title, format: tree.format, chapters };
  return { sourceId, sourceRevision: contentHash(JSON.stringify(body)), ...body };
}
export function checkCitation(sources: readonly SourceSnapshot[], citation: CitationInput) {
  const source = sources.find(item => item.sourceId === citation.sourceId);
  if (!source) return { ok: false as const, reason: 'SOURCE_MISSING' };
  if (source.sourceRevision !== citation.sourceRevision) return { ok: false as const, reason: 'REVISION_MISMATCH' };
  const paragraph = source.chapters.find(item => item.chapterId === citation.chapterId)?.paragraphs
    .find(item => item.paragraphIndex === citation.paragraphIndex);
  if (!paragraph) return { ok: false as const, reason: 'ANCHOR_MISSING' };
  if (!citation.quote.trim() || !paragraph.text.includes(citation.quote.replace(/\r\n/g, '\n'))) {
    return { ok: false as const, reason: 'QUOTE_MISMATCH' };
  }
  return { ok: true as const, citation: { ...citation, contentHash: paragraph.contentHash }, paragraphText: paragraph.text };
}
