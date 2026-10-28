'use client';

import { useEffect, useMemo, useRef } from 'react';
import { attachCitations, type Block } from '@/lib/citations';
import { isWebSource, sourceNoteLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { CitationView } from '@/lib/api/types';
import { CitationNote } from '@/components/zhupi/citation-note';
import type { SourceTarget } from '@/components/zhupi/source-drawer';
import { LessonMarkdown } from './lesson-markdown';

/**
 * 课件正文：宋体，每行 30–38 个汉字。被引用的块下有朱批细下划线，块右侧旁注写出处与原句。
 * 布局只用 CSS 断点（服务端渲染与首屏即正确）：
 * - margin=true：≥1440 旁注与正文块顶端对齐放在右栏；
 * - variant=learn：<1024 旁注排在段后，1024–1439 不显示（学习页另有旁注抽屉）；
 * - variant=history：<1440 旁注都排在段后。
 */
export function LessonArticle({ markdown, citations, titles, margin, variant, onOpen, onSelectBlock }: {
  markdown: string;
  citations: CitationView[];
  /** sourceId → 资料标题，用于旁注上的来源称呼 */
  titles: Record<string, string>;
  margin: boolean;
  variant: 'learn' | 'history';
  onOpen: (target: SourceTarget) => void;
  /** 用户在某块里选中文字时回调（「就这段提问」） */
  onSelectBlock?: (block: Block, text: string) => void;
}) {
  const { blocks, sections } = useMemo(() => attachCitations(markdown, citations), [markdown, citations]);
  const root = useRef<HTMLElement>(null);
  const select = useRef(onSelectBlock);
  select.current = onSelectBlock;
  // 选中文字：监听文档的 selectionchange（鼠标和键盘选择都会触发），取选区所在的块
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        const node = sel?.anchorNode;
        if (!text || !node || !root.current?.contains(node)) return;
        const host = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-block]');
        const block = host ? blocks[Number(host.dataset.block)] : undefined;
        if (block) select.current?.(block, text);
      }, 250);
    };
    document.addEventListener('selectionchange', onChange);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', onChange); };
  }, [blocks]);
  const open = (c: CitationView) => onOpen({ sourceId: c.sourceId, sourceRevision: c.sourceRevision, chapterId: c.chapterId, paragraphIndex: c.paragraphIndex });
  const label = (c: CitationView) => (isWebSource(c.sourceId) ? sourceNoteLabel(titles[c.sourceId], c.sourceId) : '教材');
  // 段后旁注在哪些宽度隐藏：学习页 ≥1024；回看页有右栏时 ≥1440
  const inlineHide = variant === 'learn' ? 'lg:hidden' : margin ? 'wide:hidden' : undefined;
  const notes = (list: CitationView[], className?: string) => (
    <div className={cn('grid content-start gap-3.5', className)}>
      {list.map(c => <CitationNote key={`${c.sourceId}#${c.paragraphIndex}`} sourceLabel={label(c)} paragraphIndex={c.paragraphIndex} quote={c.quote} onOpen={() => open(c)} />)}
    </div>
  );

  return (
    <article ref={root} className="prose-zhupi max-w-none" aria-label="课件正文">
      {blocks.map((block, index) => {
        const nextSection = blocks[index + 1]?.section;
        const sectionEnd = nextSection === undefined || nextSection !== block.section;
        const unplaced = sectionEnd ? sections[block.section]?.unplaced ?? [] : [];
        return (
          <div key={index}>
            <div data-block={index} className={cn(margin && MARGIN_GRID)}>
              <div className={cn('min-w-0 [&>*:first-child]:mt-0', block.kind === 'heading' ? 'pt-0' : 'pt-3', block.citations.length > 0 && 'cited-block')}>
                <LessonMarkdown markdown={block.markdown} quotes={block.citations.map(c => c.quote)} />
              </div>
              {margin && block.citations.length > 0 && notes(block.citations, 'hidden pt-4 font-sans wide:grid')}
            </div>
            {block.citations.length > 0 && notes(block.citations, cn('mt-2.5 border-l-2 border-zhu/30 pl-3 font-sans', inlineHide))}
            {unplaced.length > 0 && (
              <aside aria-label="本节出处" className={cn('mt-5 font-sans', margin && MARGIN_GRID, !margin && inlineHide)}>
                <p className={cn('text-sm text-muted', margin && 'wide:self-start wide:pt-1 wide:text-right')}>本节另有 {unplaced.length} 处出处</p>
                {notes(unplaced, 'mt-2 wide:mt-0')}
              </aside>
            )}
          </div>
        );
      })}
    </article>
  );
}

const MARGIN_GRID = 'wide:grid wide:grid-cols-[minmax(0,38em)_13.75rem] wide:gap-x-10';
