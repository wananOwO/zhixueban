'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Archive, ArchiveRestore, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useArchiveBook, useBooks, useCourses, useDrafts } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import type { BookView, DeletionImpact } from '@/lib/api/types';
import { courseTitle, draftTitle } from '@/lib/course';
import { formatLabel, isWebSource, sourceDisplayName } from '@/lib/labels';
import { formatCount, formatShortTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { UploadZone } from './upload-zone';

const totalCharacters = (book: BookView) => book.chapters.reduce((sum, c) => sum + c.characterCount, 0);

export function LibraryView() {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [deletingBook, setDeletingBook] = useState<BookView | null>(null);
  const books = useBooks(query, archived);
  const archive = useArchiveBook();
  const list = books.data ?? [];
  const uploaded = list.filter(b => !isWebSource(b.bookId));
  const web = list.filter(b => isWebSource(b.bookId));

  return (
    <>
      <PageHeader title="教材库" description="上传的教材按章节、段落解析，课件里的每处出处都指向这里的原文段落。Agent 联网补充的公开资料也保存在这里，可以回查。" />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-6 max-lg:grid-cols-1">
        <Panel
          title={archived ? '已归档的资料' : '资料'}
          actions={
            <>
              <search className="relative">
                <label htmlFor="book-search" className="sr-only">搜索书名</label>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="book-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索书名" className="h-8 w-56 pl-9 max-sm:w-full" />
              </search>
              <Button size="sm" variant="ghost" aria-pressed={archived} onClick={() => setArchived(value => !value)}>
                {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {archived ? '返回资料' : '已归档'}
              </Button>
            </>
          }
        >
          <BlockError className="mt-4" error={books.error ?? archive.error} onRetry={() => void books.refetch()} />
          {books.isPending ? <BlockLoading className="mt-5" lines={5} label="正在读取教材" /> : list.length === 0 ? (
            <BlockEmpty className="mt-4" title={query ? '没有匹配的书名' : archived ? '没有已归档的资料' : '还没有教材'}>
              {query ? '换个关键词试试。' : archived ? '归档的教材不会出现在新建课程的选择里，已有课程不受影响。' : '在右侧上传第一本教材。'}
            </BlockEmpty>
          ) : (
            <>
              {uploaded.length > 0 && (
                <BookTable
                  books={uploaded}
                  onArchive={book => archive.mutate(book)}
                  onDelete={book => setDeletingBook(book)}
                  busy={archive.isPending}
                />
              )}
              {web.length > 0 && (
                <>
                  <h3 className="mt-8 text-base font-medium">Agent 联网补充的公开资料</h3>
                  <p className="mt-0.5 text-sm text-muted">生成课件时教材缺少的内容，Agent 会搜索公开网页并保存正文快照，引用同样可以回查。</p>
                  <BookTable
                    books={web}
                    onArchive={book => archive.mutate(book)}
                    onDelete={book => setDeletingBook(book)}
                    busy={archive.isPending}
                  />
                </>
              )}
            </>
          )}
        </Panel>
        <div className="sticky top-4 max-lg:static">
          <UploadZone
            onUploaded={book => {
              setArchived(false);
              void client.invalidateQueries({ queryKey: queryKeys.booksAll() });
              client.setQueryData(queryKeys.book(book.bookId), book);
            }}
          />
        </div>
      </div>
      <ArchivedDeleteDialog
        key={deletingBook?.bookId ?? 'closed'}
        book={deletingBook}
        onOpenChange={open => { if (!open) setDeletingBook(null); }}
      />
    </>
  );
}

function BookTable({
  books,
  onArchive,
  onDelete,
  busy,
}: {
  books: BookView[];
  onArchive: (book: BookView) => void;
  onDelete: (book: BookView) => void;
  busy: boolean;
}) {
  return (
    <>
      {/* 手机：两行列表，书名在第一行，其余字段在第二行 */}
      <ul className="mt-3 md:hidden">
        {books.map(book => {
          const display = sourceDisplayName(book.title, book.bookId);
          return (
            <li key={book.bookId} className="flex items-start justify-between gap-3 border-t border-rule py-3 first:border-t-0">
              <div className="min-w-0">
                <Link href={`/library/${encodeURIComponent(book.bookId)}`} className="break-words font-medium hover:text-zhu">
                  {display}
                </Link>
                <p className="mt-0.5 text-sm text-muted">
                  {isWebSource(book.bookId) ? '网页' : formatLabel(book.format)} · {book.chapters.length} 章 · {formatCount(totalCharacters(book))} 字 · {formatShortTime(book.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onArchive(book)} aria-label={`${book.archived ? '恢复' : '归档'}《${display}》`}>
                  {book.archived ? '恢复' : '归档'}
                </Button>
                {book.archived && (
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => onDelete(book)} aria-label={`删除《${display}》`}>
                    <Trash2 aria-hidden />
                    删除
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 overflow-x-auto max-md:hidden">
        <table className="w-full min-w-[40rem] border-collapse text-base">
          <thead>
            <tr className="text-left text-sm text-muted">
              <th scope="col" className="w-1/2 pb-2 font-normal">书名</th>
              <th scope="col" className="pb-2 font-normal">格式</th>
              <th scope="col" className="pb-2 text-right font-normal">章节</th>
              <th scope="col" className="pb-2 text-right font-normal">字数</th>
              <th scope="col" className="pb-2 text-right font-normal">导入时间</th>
              <th scope="col" className="pb-2"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {books.map(book => {
              const display = sourceDisplayName(book.title, book.bookId);
              return (
                <tr key={book.bookId} className="border-t border-rule">
                  <td className="py-3 pr-4">
                    <Link href={`/library/${encodeURIComponent(book.bookId)}`} className="font-medium hover:text-zhu">
                      {display}
                    </Link>
                    {book.status !== 'ready' && <Pill className="ml-2" tone="zhu">{book.status === 'processing' ? '解析中' : book.status === 'failed' ? '解析失败' : book.status}</Pill>}
                  </td>
                  <td className="py-3 text-muted">{isWebSource(book.bookId) ? '网页' : formatLabel(book.format)}</td>
                  <td className="py-3 text-right tabular-nums">{book.chapters.length}</td>
                  <td className="py-3 text-right tabular-nums">{formatCount(totalCharacters(book))}</td>
                  <td className="py-3 text-right tabular-nums text-muted">{formatShortTime(book.createdAt)}</td>
                  <td className="py-3 pl-3 text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onArchive(book)} aria-label={`${book.archived ? '恢复' : '归档'}《${display}》`}>
                        {book.archived ? '恢复' : '归档'}
                      </Button>
                      {book.archived && (
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => onDelete(book)} aria-label={`删除《${display}》`}>
                          <Trash2 aria-hidden />
                          删除
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ArchivedDeleteDialog({
  book,
  onOpenChange,
}: {
  book: BookView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const courses = useCourses();
  const drafts = useDrafts();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const usage = useQuery({
    queryKey: queryKeys.bookUsage(book?.bookId ?? ''),
    enabled: !!book,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: () => api<DeletionImpact>(`/textbooks/${encodeURIComponent(book!.bookId)}/deletion`),
  });

  const blockers = usage.data?.blockers ?? [];
  const blockerRows: { key: string; text: string }[] = [];
  const seenCourses = new Set<string>();
  for (const b of blockers) {
    if (b.kind === 'course') {
      const courseId = b.courseId ?? b.id;
      if (seenCourses.has(courseId)) continue;
      seenCourses.add(courseId);
      const course = courses.data?.find(c => c.courseId === courseId);
      const versions = blockers.filter(x => x.kind === 'course' && (x.courseId ?? x.id) === courseId).length;
      blockerRows.push({
        key: `course:${courseId}`,
        text: `${course ? `课程《${courseTitle(course, drafts.data)}》` : '一门未确认的课程'}${versions > 1 ? `（${versions} 个版本）` : ''}`,
      });
    } else if (b.kind === 'draft') {
      const draft = drafts.data?.find(d => d.draftId === b.id);
      blockerRows.push({ key: `draft:${b.id}`, text: draft ? `草稿《${draftTitle(draft)}》` : '一份草稿' });
    } else if (b.kind === 'index') {
      blockerRows.push({ key: `index:${b.id}`, text: '正在运行的语义索引任务' });
    } else {
      blockerRows.push({ key: `${b.kind}:${b.id}`, text: b.kind === 'import' ? '正在进行的导入' : b.kind });
    }
  }

  async function remove() {
    if (!book) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/textbooks/${encodeURIComponent(book.bookId)}/deletion`, {
        method: 'DELETE',
        body: { expectedRevision: usage.data?.revision ?? book.revision, confirmName: name },
      });
      toast(`已彻底删除《${sourceDisplayName(book.title, book.bookId)}》`);
      void client.invalidateQueries({ queryKey: queryKeys.booksAll() });
      client.removeQueries({ queryKey: queryKeys.book(book.bookId) });
      onOpenChange(false);
    } catch (e) {
      setError(e);
      void client.invalidateQueries({ queryKey: queryKeys.bookUsage(book.bookId) });
    } finally {
      setBusy(false);
    }
  }

  const display = book ? sourceDisplayName(book.title, book.bookId) : '';

  return (
    <Dialog open={!!book} onOpenChange={onOpenChange}>
      {book && (
        <DialogContent
          title={`彻底删除《${display}》？`}
          description="删除后原文、语义索引与解析结果不可恢复；外部的原文件不受影响。"
        >
          {usage.isPending ? (
            <BlockLoading lines={2} label="正在检查关联课程与草稿" />
          ) : blockers.length > 0 ? (
            <>
              <p className="text-base text-zhu">这本资料仍被以下内容使用，需先删除对应课程或丢弃草稿后才能彻底删除：</p>
              <ul className="grid gap-1.5 rounded-[var(--radius-control)] bg-ground px-3.5 py-2.5 text-base">
                {blockerRows.map(row => <li key={row.key}>{row.text}</li>)}
              </ul>
              <div className="flex justify-end">
                <DialogClose asChild>
                  <Button>我知道了</Button>
                </DialogClose>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="archive-confirm-name" className="min-w-0 break-all text-base font-medium">
                    书名：{book.title}
                  </label>
                  <button
                    type="button"
                    onClick={() => setName(book.title)}
                    className="shrink-0 text-sm text-muted underline hover:text-ink"
                  >
                    填入书名
                  </button>
                </div>
                <Input
                  id="archive-confirm-name"
                  value={name}
                  placeholder="输入上方完整书名以确认删除"
                  onChange={event => setName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <BlockError error={error ?? usage.error} />
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost" disabled={busy}>取消</Button>
                </DialogClose>
                <Button variant="zhu" disabled={busy || name !== book.title} onClick={() => void remove()}>
                  {busy ? '删除中…' : '确认删除'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
