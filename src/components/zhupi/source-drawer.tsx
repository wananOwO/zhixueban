'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queries';
import type { BookView, ChapterPage } from '@/lib/api/types';
import { SheetContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BlockError, BlockLoading } from '@/components/states/block-states';

const PAGE = 100;
export interface SourceTarget { sourceId: string; sourceRevision?: string; chapterId: string; paragraphIndex: number }

/** 原文抽屉：从目标段所在页开始加载，滚动到该段并朱批高亮；可向前、向后继续加载 */
export function SourceDrawer({ target, onClose }: { target: SourceTarget | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!target} onOpenChange={open => { if (!open) onClose(); }}>
      {target && <SourceDrawerBody target={target} />}
    </Dialog.Root>
  );
}

function SourceDrawerBody({ target }: { target: SourceTarget }) {
  const book = useQuery({ queryKey: queryKeys.book(target.sourceId), queryFn: () => api<BookView>(`/textbooks/${encodeURIComponent(target.sourceId)}`) });
  const revision = target.sourceRevision ?? book.data?.sourceRevision;
  const chapterTitle = book.data?.chapters.find(c => c.id === target.chapterId)?.title;
  const firstIndex = useRef<number | null>(null);

  // 段号是全书编号，章节内分页按偏移：先读第一页拿到本章首段编号，再跳到目标所在页
  const pages = useInfiniteQuery({
    queryKey: [...queryKeys.chapter(target.sourceId, target.chapterId, revision ?? ''), 'from', target.paragraphIndex],
    enabled: !!revision,
    initialPageParam: -1,
    queryFn: async ({ pageParam }) => {
      const read = (offset: number) => api<ChapterPage>(`/textbooks/${encodeURIComponent(target.sourceId)}/chapters/${encodeURIComponent(target.chapterId)}?revision=${encodeURIComponent(revision!)}&offset=${offset}`);
      if (pageParam !== -1) return { page: await read(pageParam), offset: pageParam };
      const head = await read(0);
      const first = head.paragraphs[0]?.paragraphIndex ?? 0;
      firstIndex.current = first;
      const offset = Math.max(0, Math.floor((target.paragraphIndex - first) / PAGE) * PAGE);
      return offset === 0 ? { page: head, offset: 0 } : { page: await read(offset), offset };
    },
    getNextPageParam: last => last.page.nextOffset ?? undefined,
    getPreviousPageParam: first => (first.offset > 0 ? Math.max(0, first.offset - PAGE) : undefined),
  });

  const targetRef = useRef<HTMLParagraphElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!scrolled.current && targetRef.current) {
      targetRef.current.scrollIntoView({ block: 'center' });
      scrolled.current = true;
    }
  });

  const paragraphs = pages.data?.pages.flatMap(p => p.page.paragraphs) ?? [];
  const title = book.data?.title ?? '原文';
  return (
    <SheetContent title={title} description={`${chapterTitle ? `${chapterTitle} · ` : ''}第 ${target.paragraphIndex} 段`}>
      <div className="px-6 py-5">
        {(book.isPending || pages.isPending) && <BlockLoading lines={8} label="正在加载原文" />}
        <BlockError error={book.error ?? pages.error} onRetry={() => { void book.refetch(); void pages.refetch(); }} />
        {pages.hasPreviousPage && (
          <Button size="sm" variant="ghost" className="mb-3" disabled={pages.isFetchingPreviousPage} onClick={() => void pages.fetchPreviousPage()}>
            {pages.isFetchingPreviousPage ? '加载中…' : '加载前文'}
          </Button>
        )}
        <ol className="grid gap-3 font-serif text-[1rem] leading-[1.85]">
          {paragraphs.map(p => {
            const hit = p.paragraphIndex === target.paragraphIndex;
            return (
              <li key={p.paragraphIndex} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
                <span className={hit ? 'pt-[0.3em] text-right font-sans text-xs font-medium text-zhu' : 'pt-[0.3em] text-right font-sans text-xs text-muted'}>
                  {p.paragraphIndex}
                </span>
                <p ref={hit ? targetRef : undefined} className={hit ? 'target-paragraph whitespace-pre-wrap rounded-sm' : 'whitespace-pre-wrap'} aria-current={hit ? 'location' : undefined}>
                  {p.text}
                </p>
              </li>
            );
          })}
        </ol>
        {pages.hasNextPage && (
          <Button size="sm" variant="ghost" className="mt-4" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {pages.isFetchingNextPage ? '加载中…' : '加载后文'}
          </Button>
        )}
      </div>
    </SheetContent>
  );
}
