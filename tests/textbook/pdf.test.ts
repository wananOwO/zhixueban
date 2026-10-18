import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { parsePdf, PdfNoTextLayerError } from '@/lib/textbook/parsers/pdf';

function buildPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const tmp = path.join(os.tmpdir(), `fixture-${Date.now()}-${Math.random()}.pdf`);
    const stream = fs.createWriteStream(tmp);
    doc.pipe(stream);
    build(doc);
    doc.end();
    stream.on('finish', () => {
      const buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      resolve(buf);
    });
    stream.on('error', reject);
  });
}

describe('parsePdf', () => {
  test('按大字号行分章，正文归入章节', async () => {
    const buf = await buildPdf((doc) => {
      doc.fontSize(20).text('Chapter 1 Syntax');
      doc.fontSize(12).text('Variables and types. A variable stores data.');
      doc.fontSize(20).text('Chapter 2 Algorithms');
      doc.fontSize(12).text('Sorting. Bubble sort is a beginner algorithm.');
    });
    const tree = await parsePdf(buf, 'PDF书');
    expect(tree.format).toBe('pdf');
    expect(tree.chapters).toHaveLength(2);
    expect(tree.chapters[0].title).toContain('Syntax');
    expect(tree.chapters[0].paragraphs[0].text).toContain('Variables');
  });

  test('无文本层的扫描版 PDF 抛出 PdfNoTextLayerError', async () => {
    const buf = await buildPdf((doc) => {
      doc.rect(10, 10, 100, 100).fill('#ccc'); // 只有图形没有文字
    });
    await expect(parsePdf(buf, '扫描版')).rejects.toThrow(PdfNoTextLayerError);
  });
});
