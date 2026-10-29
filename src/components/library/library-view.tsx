'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Archive, ArchiveRestore, Search } from 'lucide-react';
import { useArchiveBook, useBooks } from '@/lib/api/hooks';
import { formatLabel, isWebSource, sourceDisplayName } from '@/lib/labels';
import { formatCount, formatShortTime } from '@/lib/utils';
import type { BookView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { UploadZone } from './upload-zone';

const totalCharacters = (book: BookView) => book.chapters.reduce((sum, c) => sum + c.characterCount, 0);

export function LibraryView() {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
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
              {uploaded.length > 0 && <BookTable books={uploaded} onArchive={book => archive.mutate(book)} busy={archive.isPending} />}
              {web.length > 0 && (
                <>
                  <h3 className="mt-8 text-base font-medium">Agent 联网补充的公开资料</h3>
                  <p className="mt-0.5 text-sm text-muted">生成课件时教材缺少的内容，Agent 会搜索公开网页并保存正文快照，引用同样可以回查。</p>
                  <BookTable books={web} onArchive={book => archive.mutate(book)} busy={archive.isPending} />
                </>
              )}
            </>
          )}
        </Panel>
        <div className="sticky top-4 max-lg:static"><UploadZone onUploaded={() => void books.refetch()} /></div>
      </div>
    </>
  );
}

function BookTable({ books, onArchive, busy }: { books: BookView[]; onArchive: (book: BookView) => void; busy: boolean }) {
  return (
    <>
      {/* 手机：两行列表，书名在第一行，其余字段在第二行 */}
      <ul className="mt-3 md:hidden">
        {books.map(book => (
          <li key={book.bookId} className="flex items-start justify-between gap-3 border-t border-rule py-3 first:border-t-0">
            <div className="min-w-0">
              <Link href={`/library/${encodeURIComponent(book.bookId)}`} className="break-words font-medium hover:text-zhu">
                {sourceDisplayName(book.title, book.bookId)}
              </Link>
              <p className="mt-0.5 text-sm text-muted">
                {isWebSource(book.bookId) ? '网页' : formatLabel(book.format)} · {book.chapters.length} 章 · {formatCount(totalCharacters(book))} 字 · {formatShortTime(book.createdAt)}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="shrink-0" disabled={busy} onClick={() => onArchive(book)} aria-label={`${book.archived ? '恢复' : '归档'}《${sourceDisplayName(book.title, book.bookId)}》`}>
              {book.archived ? '恢复' : '归档'}
            </Button>
          </li>
        ))}
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
          {books.map(book => (
            <tr key={book.bookId} className="border-t border-rule">
              <td className="py-3 pr-4">
                <Link href={`/library/${encodeURIComponent(book.bookId)}`} className="font-medium hover:text-zhu">
                  {sourceDisplayName(book.title, book.bookId)}
                </Link>
                {book.status !== 'ready' && <Pill className="ml-2" tone="zhu">{book.status === 'processing' ? '解析中' : book.status === 'failed' ? '解析失败' : book.status}</Pill>}
              </td>
              <td className="py-3 text-muted">{isWebSource(book.bookId) ? '网页' : formatLabel(book.format)}</td>
              <td className="py-3 text-right tabular-nums">{book.chapters.length}</td>
              <td className="py-3 text-right tabular-nums">{formatCount(totalCharacters(book))}</td>
              <td className="py-3 text-right tabular-nums text-muted">{formatShortTime(book.createdAt)}</td>
              <td className="py-3 pl-3 text-right">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onArchive(book)} aria-label={`${book.archived ? '恢复' : '归档'}《${sourceDisplayName(book.title, book.bookId)}》`}>
                  {book.archived ? '恢复' : '归档'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
