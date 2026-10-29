'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useArchiveBook, useBook, useBookUsage, useCourses, useDrafts } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import { courseTitle, draftTitle } from '@/lib/course';
import { formatLabel, isWebSource, sourceDisplayName } from '@/lib/labels';
import { cn, formatCount } from '@/lib/utils';
import type { BookView, ChapterPage } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Panel } from '@/components/ui/panel';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';

/** 网址里的 #p-761 表示要定位的全书段号 */
function hashParagraph(): number | null {
  if (typeof window === 'undefined') return null;
  const match = /^#p-(\d+)$/.exec(window.location.hash);
  return match ? Number(match[1]) : null;
}

export function BookDetail({ bookId }: { bookId: string }) {
  const book = useBook(bookId);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setTarget(hashParagraph());
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const chapters = book.data?.chapters ?? [];
  const active = chapterId ?? chapters[0]?.id ?? null;
  const title = book.data ? sourceDisplayName(book.data.title, book.data.bookId) : '教材';

  return (
    <>
      <PageHeader
        crumbs={[{ href: '/library', label: '教材库' }, { label: title }]}
        title={title}
        description={book.data && `${isWebSource(bookId) ? 'Agent 联网补充的公开网页' : formatLabel(book.data.format)} · ${book.data.chapters.length} 章 · ${formatCount(book.data.chapters.reduce((n, c) => n + c.characterCount, 0))} 字${book.data.archived ? ' · 已归档' : ''}`}
      />
      <BlockError className="mt-4" error={book.error} onRetry={() => void book.refetch()} />
      {book.isPending && <Panel className="mt-6"><BlockLoading lines={8} label="正在读取教材" /></Panel>}
      {book.data && (
        <div className="mt-6 grid grid-cols-[15rem_minmax(0,1fr)_20rem] items-start gap-6 max-xl:grid-cols-[13rem_minmax(0,1fr)] max-md:grid-cols-1">
          <nav aria-label="章节" className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[var(--radius-paper)] bg-paper px-3 py-4 max-md:static max-md:max-h-64">
            <h2 className="px-2 text-sm font-medium text-muted">章节（{chapters.length}）</h2>
            <ol className="mt-2 grid">
              {chapters.map(chapter => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    aria-current={chapter.id === active ? 'true' : undefined}
                    onClick={() => setChapterId(chapter.id)}
                    className={cn('flex w-full items-baseline justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-base hover:bg-ground', chapter.id === active && 'bg-ground font-medium')}
                  >
                    <span className="min-w-0 truncate">{chapter.title}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{formatCount(chapter.characterCount)} 字</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {active && book.data.sourceRevision && <ChapterText book={book.data} chapterId={active} target={target} />}
          <div className="sticky top-4 grid gap-6 max-xl:static max-xl:col-span-2 max-xl:grid-cols-2 max-md:col-span-1 max-md:grid-cols-1">
            <UsagePanel book={book.data} />
          </div>
        </div>
      )}
    </>
  );
}

function ChapterText({ book, chapterId, target }: { book: BookView; chapterId: string; target: number | null }) {
  const chapter = book.chapters.find(c => c.id === chapterId);
  const pages = useInfiniteQuery({
    queryKey: [...queryKeys.chapter(book.bookId, chapterId, book.sourceRevision), 'reader'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<ChapterPage>(`/textbooks/${encodeURIComponent(book.bookId)}/chapters/${encodeURIComponent(chapterId)}?revision=${encodeURIComponent(book.sourceRevision)}&offset=${pageParam}`),
    getNextPageParam: last => last.nextOffset ?? undefined,
  });
  const paragraphs = useMemo(() => pages.data?.pages.flatMap(p => p.paragraphs) ?? [], [pages.data]);
  const targetRef = useRef<HTMLLIElement>(null);

  // 目标段不在已加载页内时继续加载，加载到后滚动到位
  useEffect(() => {
    if (target === null || !pages.data) return;
    const last = paragraphs.at(-1)?.paragraphIndex ?? -1;
    if (target > last && pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
  }, [target, paragraphs, pages]);
  // 目标段渲染出来（或换了目标）时滚动到位
  const targetLoaded = target !== null && paragraphs.some(p => p.paragraphIndex === target);
  useEffect(() => {
    if (targetLoaded) targetRef.current?.scrollIntoView({ block: 'center' });
  }, [targetLoaded]);

  return (
    <article aria-label={chapter?.title} className="min-w-0 rounded-[var(--radius-paper)] bg-paper px-10 py-8 max-md:px-4 max-md:py-5">
      <h2 className="font-serif text-h2 font-bold">{chapter?.title}</h2>
      <BlockError className="mt-4" error={pages.error} onRetry={() => void pages.refetch()} />
      {pages.isPending && <BlockLoading className="mt-6" lines={10} label="正在加载原文" />}
      {pages.data && paragraphs.length === 0 && <BlockEmpty className="mt-4" title="本章没有正文" />}
      <ol className="mt-6 grid gap-3">
        {paragraphs.map(p => {
          const hit = p.paragraphIndex === target;
          return (
            <li key={p.paragraphIndex} id={`p-${p.paragraphIndex}`} ref={hit ? targetRef : undefined} className="grid grid-cols-[3.25rem_minmax(0,38em)] gap-4 max-md:grid-cols-[2.5rem_minmax(0,1fr)]">
              <a href={`#p-${p.paragraphIndex}`} className={cn('pt-[0.35em] text-right text-xs tabular-nums hover:text-ink', hit ? 'font-medium text-zhu' : 'text-muted')} aria-label={`第 ${p.paragraphIndex} 段`}>
                {p.paragraphIndex}
              </a>
              <p className={cn('whitespace-pre-wrap font-serif text-body leading-[1.85]', hit && 'target-paragraph rounded-sm')} aria-current={hit ? 'location' : undefined}>
                {p.text}
              </p>
            </li>
          );
        })}
      </ol>
      {pages.hasNextPage && (
        <div className="mt-6 pl-[4.25rem] max-md:pl-0">
          <Button disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {pages.isFetchingNextPage ? '加载中…' : '继续加载'}
          </Button>
        </div>
      )}
    </article>
  );
}

/** 谁在用这本书：课程版本与草稿；删除前必须为空，否则只能归档 */
function UsagePanel({ book }: { book: BookView }) {
  const usage = useBookUsage(book.bookId);
  const courses = useCourses();
  const drafts = useDrafts();
  const archive = useArchiveBook();
  const blockers = usage.data?.blockers ?? [];
  // 同一课程的多个版本合并为一行
  const rows: { key: string; text: string }[] = [];
  const seenCourses = new Set<string>();
  for (const b of blockers) {
    if (b.kind === 'course') {
      const courseId = b.courseId ?? b.id;
      if (seenCourses.has(courseId)) continue;
      seenCourses.add(courseId);
      const course = courses.data?.find(c => c.courseId === courseId);
      const versions = blockers.filter(x => x.kind === 'course' && (x.courseId ?? x.id) === courseId).length;
      rows.push({ key: `course:${courseId}`, text: `${course ? `课程《${courseTitle(course, drafts.data)}》` : '一门未确认的课程'}${versions > 1 ? `（${versions} 个版本）` : ''}` });
    } else if (b.kind === 'draft') {
      const draft = drafts.data?.find(d => d.draftId === b.id);
      rows.push({ key: `draft:${b.id}`, text: draft ? `草稿《${draftTitle(draft)}》` : '一份草稿' });
    } else {
      rows.push({ key: `${b.kind}:${b.id}`, text: b.kind === 'import' ? '正在进行的导入' : b.kind });
    }
  }
  return (
    <Panel title="使用情况" description="被课程或草稿引用的资料不能删除，可以归档：归档后不出现在新建课程里，已有课程照常回查原文。">
      {usage.isPending ? <BlockLoading className="mt-4" lines={2} /> : blockers.length === 0 ? (
        <p className="mt-4 text-base text-ink-soft">没有课程或草稿使用这本资料。</p>
      ) : (
        <ul className="mt-4 grid gap-1.5 text-base">
          {rows.map(row => <li key={row.key}>{row.text}</li>)}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button disabled={archive.isPending} onClick={() => archive.mutate(book)}>
          {book.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {book.archived ? '恢复' : '归档'}
        </Button>
        {!usage.isPending && blockers.length === 0 && <DeleteBook book={book} revision={usage.data?.revision ?? book.revision} />}
      </div>
      <BlockError className="mt-4" error={archive.error ?? usage.error} />
    </Panel>
  );
}

function DeleteBook({ book, revision }: { book: BookView; revision: number }) {
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/textbooks/${encodeURIComponent(book.bookId)}/deletion`, { method: 'DELETE', body: { expectedRevision: revision, confirmName: name } });
      void client.invalidateQueries({ queryKey: queryKeys.booksAll() });
      router.replace('/library');
    } catch (e) {
      setError(e);
      void client.invalidateQueries({ queryKey: queryKeys.bookUsage(book.bookId) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="danger"><Trash2 aria-hidden />彻底删除</Button></DialogTrigger>
      <DialogContent title="彻底删除这本资料？" description="删除后原文与解析结果不可恢复；外部的原文件不受影响。输入完整书名确认。">
        <div className="grid gap-1.5">
          <label htmlFor="confirm-name" className="text-base font-medium">书名：{book.title}</label>
          <Input id="confirm-name" value={name} onChange={event => setName(event.target.value)} autoComplete="off" />
        </div>
        <BlockError error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="zhu" disabled={busy || name !== book.title} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
