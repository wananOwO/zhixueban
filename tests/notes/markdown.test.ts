import { describe, expect, test } from 'vitest';
import { tiptapJsonToMarkdown } from '@/lib/notes/markdown';

describe('tiptapJsonToMarkdown', () => {
  test('段落/标题/加粗/列表/代码块', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '要点' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '递归的核心是' },
            { type: 'text', marks: [{ type: 'bold' }], text: '基例' },
            { type: 'text', text: '。' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'def f(n): return 1 if n<=1 else n*f(n-1)' }] },
      ],
    };
    const md = tiptapJsonToMarkdown(doc);
    expect(md).toContain('## 要点');
    expect(md).toContain('**基例**');
    expect(md).toContain('- 第一项');
    expect(md).toContain('```');
  });

  test('空文档返回空串', () => {
    expect(tiptapJsonToMarkdown({ type: 'doc', content: [] })).toBe('');
  });
});
