'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
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
      <BlockError className="mt-4" error={draft.error ?? books.error} onRetry={() => { void draft.refetch(); void books.refetch(); }} />
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
      {data && (data.state === 'generating' || data.state === 'review') && <DraftProgress draft={data} onChange={set} onReload={() => void draft.refetch()} />}
    </>
  );
}

/** 生成中与审核视图：任务 10 实现 */
function DraftProgress({ draft }: { draft: FormDraft; onChange: (draft: FormDraft) => void; onReload: () => void }) {
  return <Panel className="mt-6" title={draft.state === 'generating' ? '正在生成课程方案' : '核对课程方案'}><BlockLoading className="mt-4" lines={4} /></Panel>;
}
