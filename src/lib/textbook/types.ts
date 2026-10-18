export type BookFormat = 'txt' | 'md' | 'epub' | 'pdf' | 'docx' | 'mobi' | 'azw3';

/** 段落级位置锚点：chapterId + 全书段落序号，用于来源标注跳回教材 */
export interface Paragraph {
  text: string;
  images?: string[];
  anchor: { chapterId: string; index: number };
}

export interface Chapter {
  id: string;
  title: string;
  level: number;
  paragraphs: Paragraph[];
}

/** 所有格式解析后的统一中间表示 */
export interface ChapterTree {
  title: string;
  format: BookFormat;
  chapters: Chapter[];
}

let globalParagraphIndex = 0;

export function resetParagraphCounter(): void {
  globalParagraphIndex = 0;
}

export function makeParagraph(chapterId: string, text: string, images?: string[]): Paragraph {
  return { text, images, anchor: { chapterId, index: globalParagraphIndex++ } };
}

export function makeChapter(id: string, title: string, level: number): Chapter {
  return { id, title, level, paragraphs: [] };
}
