import { describe, expect, test } from 'vitest';
import { parseTxt } from '@/lib/textbook/parsers/txt';
import { parseMarkdown } from '@/lib/textbook/parsers/markdown';

describe('parseTxt', () => {
  test('有章节标记的 TXT 正常分章', () => {
    const content = [
      '第一章 Python 基础',
      '变量与类型。',
      '第二章 控制流',
      'if 语句。',
      'for 循环。',
    ].join('\n');
    const tree = parseTxt(content, 'Python教程');
    expect(tree.format).toBe('txt');
    expect(tree.chapters).toHaveLength(2);
    expect(tree.chapters[0].title).toContain('Python 基础');
    expect(tree.chapters[1].paragraphs).toHaveLength(2);
    // anchor 单调递增
    expect(tree.chapters[1].paragraphs[0].anchor.index).toBeGreaterThan(
      tree.chapters[0].paragraphs[0].anchor.index,
    );
  });

  test('支持数字编号章节（1. / 1.1 ）', () => {
    const content = '1. 绪论\n内容A\n2. 方法\n内容B';
    const tree = parseTxt(content, '书');
    expect(tree.chapters).toHaveLength(2);
  });

  test('无章节标记的 TXT 降级为约 2000 字伪章节', () => {
    const content = '一段没有章节标记的文字。'.repeat(400); // 4800 字
    const tree = parseTxt(content, '无章节书');
    expect(tree.chapters.length).toBeGreaterThanOrEqual(2);
    expect(tree.chapters[0].title).toMatch(/部分/);
    expect(tree.chapters.flatMap((c) => c.paragraphs).map((p) => p.text).join('')).toContain('一段');
  });
});

describe('parseMarkdown', () => {
  test('按 # 层级分章并保留层级', () => {
    const content = ['# 第一章 基础', '文本A', '## 1.1 变量', '文本B', '# 第二章 进阶', '文本C'].join(
      '\n',
    );
    const tree = parseMarkdown(content, 'MD书');
    expect(tree.format).toBe('md');
    expect(tree.chapters).toHaveLength(3);
    expect(tree.chapters[0].level).toBe(1);
    expect(tree.chapters[1].level).toBe(2);
    expect(tree.chapters[2].title).toContain('进阶');
  });
});
