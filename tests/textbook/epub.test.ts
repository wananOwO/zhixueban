import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { parseEpub } from '@/lib/textbook/parsers/epub';

/** 构造最小合法 EPUB：两章，各两段 */
async function makeFixtureEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>
      <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  zip.file(
    'OEBPS/c1.xhtml',
    `<html><body><h1>第一章 语法</h1><p>变量。</p><p>类型。</p></body></html>`,
  );
  zip.file(
    'OEBPS/c2.xhtml',
    `<html><body><h1>第二章 算法</h1><p>排序。</p><p>搜索。</p></body></html>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parseEpub', () => {
  test('按 spine 顺序解析章节，标题层级与 anchor 正确', async () => {
    const buf = await makeFixtureEpub();
    const tree = await parseEpub(buf, '测试EPUB');
    expect(tree.format).toBe('epub');
    expect(tree.chapters).toHaveLength(2);
    expect(tree.chapters[0].title).toContain('语法');
    expect(tree.chapters[1].title).toContain('算法');
    expect(tree.chapters[0].paragraphs).toHaveLength(2);
    expect(tree.chapters[1].paragraphs[0].anchor.index).toBeGreaterThan(
      tree.chapters[0].paragraphs[0].anchor.index,
    );
    expect(tree.chapters[0].paragraphs[0].anchor.chapterId).toBe(tree.chapters[0].id);
  });
});
