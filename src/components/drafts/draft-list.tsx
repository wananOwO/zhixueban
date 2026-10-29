'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Copy, FilePen, Trash2 } from 'lucide-react';
import { api, newKey } from '@/lib/api/client';
import { useBooks, useCreateDraft, useDrafts } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import { draftTitle } from '@/lib/course';
import { DRAFT_STATE_LABEL, MODE_LABEL } from '@/lib/labels';
import { formatShortTime } from '@/lib/utils';
import type { FormDraft } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';

const STATE_TONE: Record<string, 'neutral' | 'zhu' | 'ink'> = { editing: 'neutral', generating: 'zhu', review: 'ink', confirmed: 'neutral' };

export function DraftList() {
  const drafts = useDrafts();
  const books = useBooks();
  const create = useCreateDraft();
  const client = useQueryClient();
  const router = useRouter();
  const copy = useMutation({
    mutationFn: (draft: FormDraft) => api<FormDraft>(`/drafts/${draft.draftId}/copy`, { method: 'POST', body: {}, key: newKey() }),
    onSuccess: copied => { void client.invalidateQueries({ queryKey: queryKeys.drafts() }); router.push(`/drafts/${copied.draftId}`); },
  });
  const discard = useMutation({
    mutationFn: (draft: FormDraft) => api(`/drafts/${draft.draftId}`, { method: 'DELETE', body: { expectedRevision: draft.revision } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.drafts() }),
  });
  const list = (drafts.data ?? []).filter(d => d.state !== 'discarded');
  const open = list.filter(d => d.state !== 'confirmed');
  const done = list.filter(d => d.state === 'confirmed');
  const bookTitle = (id: string) => books.data?.find(b => b.bookId === id)?.title;

  const row = (draft: FormDraft) => {
    const title = draftTitle(draft);
    const sources = draft.input.sources.map(s => bookTitle(s.sourceId)).filter(Boolean);
    const chapters = draft.input.sources.reduce((n, s) => n + s.chapterIds.length, 0);
    return (
      <li key={draft.draftId} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-t border-rule py-4 first:border-t-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={draft.state === 'confirmed' && draft.confirmed ? `/courses/${draft.confirmed.courseId}` : `/drafts/${draft.draftId}`} className="font-medium hover:text-zhu">{title}</Link>
            <Pill tone={STATE_TONE[draft.state] ?? 'neutral'}>{DRAFT_STATE_LABEL[draft.state] ?? draft.state}</Pill>
          </div>
          {draft.input.goal && draft.input.title && <p className="mt-1 text-base text-ink-soft">目标：{draft.input.goal}</p>}
          <p className="mt-1 text-sm text-muted">
            {sources.length ? `${sources.join('、')} · ${chapters} 章` : '未选教材'} · {MODE_LABEL[draft.input.mode] ?? draft.input.mode}模式
            {draft.updatedAt && ` · 更新于 ${formatShortTime(draft.updatedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={copy.isPending} onClick={() => copy.mutate(draft)} aria-label={`复制《${title}》为新草稿`}>
            <Copy aria-hidden />复制
          </Button>
          {draft.state !== 'confirmed' && draft.state !== 'generating' && (
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="丢弃这份草稿？"
              description={`《${title}》的填写内容和已生成的方案都会删除，不可恢复。`}
              confirmLabel="丢弃"
              danger
              onConfirm={() => discard.mutateAsync(draft).then(() => undefined)}
            >
              <span className="sr-only">丢弃《{title}》</span>
              <Trash2 aria-hidden /><span aria-hidden>丢弃</span>
            </ConfirmButton>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="课程草稿"
        description="写下学习目标、选好教材章节，Agent 据此生成课程方案。草稿自动保存，确认方案后成为正式课程。"
        actions={<Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}><FilePen aria-hidden />新建课程</Button>}
      />
      <BlockError className="mt-4" error={drafts.error ?? create.error ?? copy.error ?? discard.error} onRetry={() => void drafts.refetch()} />
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-6 max-lg:grid-cols-1">
        <div className="grid gap-6">
          <Panel title="未完成" description={open.length ? `${open.length} 份` : undefined}>
            {drafts.isPending ? <BlockLoading className="mt-4" lines={4} /> : open.length === 0 ? (
              <BlockEmpty className="mt-4" title="还没有草稿" action={<Button variant="primary" onClick={() => create.mutate()}><FilePen aria-hidden />新建课程</Button>}>
                新建课程时，填写的内容会自动保存在这里。
              </BlockEmpty>
            ) : <ul className="mt-2">{open.map(row)}</ul>}
          </Panel>
          <Panel title="从草稿到课程">
            <ol className="mt-4 grid grid-cols-4 gap-6 max-xl:grid-cols-2 max-md:grid-cols-1">
              {[
                ['写目标', '写成能检验的样子，例如“能独立写出二分查找并分析复杂度”。'],
                ['选章节', '只选和目标有关的章节；Agent 会自动补齐需要的先修知识点。'],
                ['生成方案', 'Agent 读教材提交知识点，每个都要有能回查的出处；校验不过会自动修正。'],
                ['核对确认', '在先修路线图上调整目标、标记已掌握或排除，确认后成为正式课程。'],
              ].map(([title, body], index) => (
                <li key={title}>
                  <span className="font-serif text-h2 font-bold leading-none text-zhu" aria-hidden>{index + 1}</span>
                  <h3 className="mt-2 font-medium">{title}</h3>
                  <p className="mt-1 text-base text-ink-soft">{body}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="sticky top-4 grid gap-6 max-lg:static">
          <Panel title="已确认为课程" description={done.length ? `${done.length} 份` : undefined}>
            {done.length ? <ul className="mt-2">{done.map(row)}</ul> : <BlockEmpty className="mt-3" title="还没有确认的课程">核对并确认方案后，草稿会成为正式课程。</BlockEmpty>}
          </Panel>
        </div>
      </div>
    </>
  );
}
