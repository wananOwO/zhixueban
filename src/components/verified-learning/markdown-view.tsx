'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookMarked } from 'lucide-react';
import type { CitationView } from '@/lib/verified-learning/client';
import 'katex/dist/katex.min.css';

/**
 * 安全 Markdown 渲染：react-markdown 默认不执行原始 HTML/脚本。
 * 引用以可点击徽章形式列在文末，跳转到教材原文对应章节段落。
 */
export default function MarkdownView({
  markdown,
  citations,
  onCitation,
}: {
  markdown: string;
  citations?: CitationView[];
  onCitation?: (citation: CitationView) => void;
}) {
  return (
    <article className="prose max-w-none leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a href={href} className="text-accent underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children }) => (
            <code className={`rounded bg-muted px-1 py-0.5 text-sm ${className ?? ''}`}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 text-sm">
              {children}
            </pre>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
      {citations && citations.length > 0 && (
        <footer className="mt-8 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">教材引用</p>
          <ul className="flex flex-wrap gap-2">
            {citations.map((citation, index) => (
              <li key={`${citation.chapterId}:${citation.paragraphIndex}:${index}`}>
                <button
                  type="button"
                  onClick={() => onCitation?.(citation)}
                  title={citation.quote}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-accent hover:bg-muted"
                >
                  <BookMarked aria-hidden className="h-3.5 w-3.5" />
                  出处 {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}
