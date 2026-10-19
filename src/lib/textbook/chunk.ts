import type { ChapterTree } from './types';

export interface Chunk {
  id: string;
  textbookId?: string;
  chapterId: string;
  content: string;
  anchor: { chapterId: string; index: number };
}

const CHUNK_SIZE = 500;

/** 章节树 → 检索分块：按段落聚合，单块不超 CHUNK_SIZE；超长段落单独成块 */
export function chunkChapterTree(tree: ChapterTree): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = '';
  let bufAnchor: { chapterId: string; index: number } | null = null;
  let bufChapterId = '';
  let seq = 0;

  const flush = () => {
    if (!buf || !bufAnchor) return;
    seq += 1;
    chunks.push({
      id: `chunk${seq}`,
      chapterId: bufChapterId,
      content: buf,
      anchor: bufAnchor,
    });
    buf = '';
    bufAnchor = null;
  };

  for (const chapter of tree.chapters) {
    for (const p of chapter.paragraphs) {
      if (p.text.length > CHUNK_SIZE) {
        flush();
        seq += 1;
        chunks.push({
          id: `chunk${seq}`,
          chapterId: chapter.id,
          content: p.text,
          anchor: p.anchor,
        });
        continue;
      }
      if (bufChapterId !== chapter.id) flush();
      if (!bufAnchor) {
        bufAnchor = p.anchor;
        bufChapterId = chapter.id;
        buf = `【${chapter.title}】`; // 分块携带章节标题上下文
      }
      if (buf.length + p.text.length > CHUNK_SIZE) {
        flush();
        bufAnchor = p.anchor;
        bufChapterId = chapter.id;
      }
      buf += (buf ? '\n' : '') + p.text;
    }
  }
  flush();
  return chunks;
}
