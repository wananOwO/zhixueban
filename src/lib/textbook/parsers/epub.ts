import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { ChapterTree } from '../types';
import { makeChapter, makeParagraph, resetParagraphCounter } from '../types';

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** 提取首个 h1-h3 作为章节标题，其余 <p> 作为段落 */
function extractChapter(xhtml: string): { title: string | null; paragraphs: string[] } {
  const headingMatch = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/i.exec(xhtml);
  const title = headingMatch ? stripTags(headingMatch[2]) : null;
  const paragraphs = [...xhtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 0);
  return { title, paragraphs };
}

/** EPUB 解析：zip → container.xml → opf → 按 spine 顺序展开为章节树 */
export async function parseEpub(buf: Buffer, title: string): Promise<ChapterTree> {
  resetParagraphCounter();
  const zip = await JSZip.loadAsync(buf);
  const xml = new XMLParser({ ignoreAttributes: false });

  const containerText = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerText) throw new Error('非法 EPUB：缺少 META-INF/container.xml');
  const container = xml.parse(containerText);
  const rootfile = container.container.rootfiles.rootfile;
  const opfPath = rootfile['@_full-path'];
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfText = await zip.file(opfPath)?.async('string');
  if (!opfText) throw new Error(`非法 EPUB：缺少 ${opfPath}`);
  const opf = xml.parse(opfText);

  const manifestItems = Array.isArray(opf.package.manifest.item)
    ? opf.package.manifest.item
    : [opf.package.manifest.item];
  const hrefById = new Map<string, string>(
    manifestItems.map((it: Record<string, string>) => [it['@_id'], it['@_href']]),
  );
  const spineRefs = Array.isArray(opf.package.spine.itemref)
    ? opf.package.spine.itemref
    : [opf.package.spine.itemref];

  const tree: ChapterTree = { title, format: 'epub', chapters: [] };
  let chapterNo = 0;

  for (const ref of spineRefs) {
    const href = hrefById.get(ref['@_idref']);
    if (!href) continue;
    const file = zip.file(opfDir + href);
    if (!file) continue;
    const xhtml = await file.async('string');
    const { title: chapterTitle, paragraphs } = extractChapter(xhtml);
    if (paragraphs.length === 0 && !chapterTitle) continue;

    chapterNo += 1;
    const chapter = makeChapter(`ch${chapterNo}`, chapterTitle ?? `第 ${chapterNo} 章`, 1);
    for (const p of paragraphs) {
      chapter.paragraphs.push(makeParagraph(chapter.id, p));
    }
    tree.chapters.push(chapter);
  }
  return tree;
}
