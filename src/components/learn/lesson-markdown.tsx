'use client';

import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeHighlight } from './code-highlight';
import { rehypeCited } from './rehype-cited';

/**
 * 课件 Markdown：react-markdown 不执行原始 HTML；支持表格、数学公式；代码块按语言高亮。
 * 链接一律新窗口打开并去掉来源信息。
 */
const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ className, children }) => {
    const language = /language-([\w+-]+)/.exec(className ?? '')?.[1];
    const text = String(children ?? '');
    // 行内代码没有 language-，且不含换行
    if (!language && !text.includes('\n')) return <code>{children}</code>;
    return <CodeHighlight code={text.replace(/\n$/, '')} language={language} />;
  },
  table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
};

/** quotes：本块被引用的原句，用来在对应的句子下画朱批线 */
export function LessonMarkdown({ markdown, quotes = [] }: { markdown: string; quotes?: string[] }) {
  const key = quotes.join('\u0000');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 按引文内容（key）缓存插件，数组本身每次渲染都是新的
  const rehype = useMemo(() => [rehypeKatex, rehypeCited(quotes)], [key]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehype} components={components} skipHtml>
      {markdown}
    </ReactMarkdown>
  );
}
