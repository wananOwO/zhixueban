// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonMarkdown } from '@/components/learn/lesson-markdown';

afterEach(cleanup);

describe('LessonMarkdown：只在被引用的那一句下画朱批线', () => {
  it('段落里只有对应句子被包上 .cited，其余文字不变', () => {
    const { container } = render(
      <LessonMarkdown
        markdown={'程序算出的结果存在内存里，人看不见。在 Python 里，解释器看到后面跟着括号的单词 **print** 时，会把括号中的内容打印到屏幕上。'}
        quotes={['在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。']}
      />,
    );
    const cited = [...container.querySelectorAll('.cited')].map(n => n.textContent).join('');
    expect(cited).toBe('在 Python 里，解释器看到后面跟着括号的单词 print 时，会把括号中的内容打印到屏幕上。');
    expect(container.textContent).toBe('程序算出的结果存在内存里，人看不见。在 Python 里，解释器看到后面跟着括号的单词 print 时，会把括号中的内容打印到屏幕上。');
    // 加粗仍保留
    expect(container.querySelector('strong')?.textContent).toBe('print');
  });

  it('代码块不画线；没有引文时不包任何元素；不渲染原始 HTML', () => {
    const { container } = render(<LessonMarkdown markdown={'```python\nprint("hi")\n```\n\n<script>alert(1)</script>'} quotes={['print("hi")']} />);
    expect(container.querySelectorAll('.cited')).toHaveLength(0);
    expect(container.querySelector('script')).toBeNull();
    const plain = render(<LessonMarkdown markdown="普通段落。" />);
    expect(plain.container.querySelectorAll('.cited')).toHaveLength(0);
  });
});
