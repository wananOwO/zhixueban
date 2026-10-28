'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, newKey } from '@/lib/api/client';
import { useBooks } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import { draftTitle } from '@/lib/course';
import { DRAFT_STATE_LABEL } from '@/lib/labels';
import type { FormDraft } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockError, BlockLoading } from '@/components/states/block-states';
import { PageHeader } from '@/components/shell/page-header';
import { DraftEditor } from './draft-editor';
import { GenerationView } from './generation-view';
import { ReviewView } from './review-view';

const DESCRIPTION: Record<string, string> = {
  editing: '写下目标、选好章节，然后生成课程方案。内容自动保存。',
  generating: 'Agent 正在读教材、提交知识点并逐个校验。',
  review: '核对生成的方案：来源、先修与缺口；确认后成为正式课程。',
  confirmed: '方案已确认，课程已创建。',
};

/** 草稿页按状态切换：编辑 → 生成中 → 审核 → 已确认 */
export function DraftPage({ draftId }: { draftId: string }) {
  const client = useQueryClient();
  const draft = useQuery({ queryKey: queryKeys.draft(draftId), queryFn: () => api<FormDraft>(`/drafts/${encodeURIComponent(draftId)}`) });
  const books = useBooks();
  const set = (next: FormDraft) => client.setQueryData(queryKeys.draft(draftId), next);
  const data = draft.data;
  const [backError, setBackError] = useState<unknown>(null);
  /** 回到编辑：空保存一次，后端把状态置回 editing（已生成的方案保留，可接受旧结果） */
  async function backToEdit() {
    if (!data) return;
    setBackError(null);
    try { set(await api<FormDraft>(`/drafts/${data.draftId}`, { method: 'PATCH', body: { expectedRevision: data.revision, input: {} }, key: newKey() })); }
    catch (error) { setBackError(error); }
  }

  return (
    <>
      <PageHeader
        crumbs={[{ href: '/drafts', label: '课程草稿' }, { label: data ? draftTitle(data) : '草稿' }]}
        title={data ? draftTitle(data) : '课程草稿'}
        description={data && (
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={data.state === 'review' ? 'ink' : data.state === 'generating' ? 'zhu' : 'neutral'}>{DRAFT_STATE_LABEL[data.state] ?? data.state}</Pill>
            {DESCRIPTION[data.state]}
          </span>
        )}
      />
      <BlockError className="mt-4" error={draft.error ?? books.error ?? backError} onRetry={() => { void draft.refetch(); void books.refetch(); }} />
      {(draft.isPending || books.isPending) && <Panel className="mt-6"><BlockLoading lines={8} label="正在读取草稿" /></Panel>}
      {data && books.data && data.state === 'editing' && (
        <DraftEditor
          key={data.draftId}
          draft={data}
          books={books.data}
          onSaved={set}
          onGenerating={() => void draft.refetch()}
        />
      )}
      {data && data.state === 'confirmed' && data.confirmed && (
        <Panel className="mt-6" title="课程已创建" tone="zhu">
          <p className="mt-2 text-base">方案已确认。可以从第一个知识点开始学习，也可以先看看课程路线图。</p>
          <div className="mt-4 flex gap-3">
            <Button asChild variant="primary"><Link href={`/learn/${data.confirmed.sessionId}`}>开始学习</Link></Button>
            <Button asChild><Link href={`/courses/${data.confirmed.courseId}`}>课程主页</Link></Button>
          </div>
        </Panel>
      )}
      {data && data.state === 'generating' && data.generationJobId && (
        <>
          <GenerationView jobId={data.generationJobId} onFinished={() => void draft.refetch()} />
          <GenerationFailedActions draft={data} onBack={() => void backToEdit()} />
        </>
      )}
      {data && data.state === 'review' && data.review && <ReviewView key={data.draftId} draft={data} onChange={set} onBackToEdit={() => void backToEdit()} />}
    </>
  );
}

/** 生成失败或被停止时，草稿仍是 generating：可以返回编辑重新生成 */
function GenerationFailedActions({ draft, onBack }: { draft: FormDraft; onBack: () => void }) {
  const job = useQuery({ queryKey: queryKeys.job(draft.generationJobId!), queryFn: () => api<{ status: string }>(`/jobs/${encodeURIComponent(draft.generationJobId!)}`) });
  if (!job.data || !['failed', 'cancelled'].includes(job.data.status)) return null;
  return (
    <div className="mt-4 flex justify-end">
      <Button onClick={onBack}>返回编辑并重新生成</Button>
    </div>
  );
}
