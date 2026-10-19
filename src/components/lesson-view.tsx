'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookMarked } from 'lucide-react';
import 'katex/dist/katex.min.css';

/** [src:ch:idx] → 可点击的来源链接占位（ref:// 协议由 a 渲染器接管） */
function markSourceRefs(text: string): string {
  return text.replace(/\[src:([A-Za-z0-9_-]+):(\d+)\]/g, '[📖](ref://$1/$2)');
}

export default function LessonView({ courseId, kpId }: { courseId: string; kpId: string }) {
  const [content, setContent] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/lessons/${kpId}?courseId=${courseId}`);
        if (!res.ok || !res.body) {
          setError((await res.json().catch(() => null))?.error ?? '课件生成失败');
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setContent(acc);
        }
      } catch {
        setError('网络错误，请重试');
      } finally {
        setStreaming(false);
      }
    })();
  }, [courseId, kpId]);

  if (error) {
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }

  return (
    <article aria-busy={streaming} className="prose max-w-none">
      {/* 无障碍：屏幕阅读器感知生成进度 */}
      <span aria-live="polite" className="sr-only">
        {streaming ? '课件生成中' : '课件已生成完毕'}
      </span>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('ref://')) {
              return (
                <span
                  role="button"
                  tabIndex={0}
                  title={`教材出处：${href.replace('ref://', '')}`}
                  className="mx-0.5 inline-flex cursor-help items-center text-accent"
                >
                  <BookMarked aria-hidden className="h-3.5 w-3.5" />
                  <span className="sr-only">教材来源 {href}</span>
                  {children}
                </span>
              );
            }
            return (
              <a href={href} className="text-accent underline" target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          code: ({ className, children }) => (
            <code className={`rounded bg-muted px-1 py-0.5 text-sm ${className ?? ''}`}>
              {children}
            </code>
          ),
        }}
      >
        {markSourceRefs(content)}
      </ReactMarkdown>
      {streaming && <span aria-hidden className="inline-block h-4 w-2 animate-pulse bg-accent" />}
    </article>
  );
}
