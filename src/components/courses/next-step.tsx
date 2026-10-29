'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api, newKey } from '@/lib/api/client';
import { queryKeys, useMode } from '@/lib/api/queries';
import { answersNeeded, describeNext, outlinePoints } from '@/lib/course';
import { useModelKey } from '@/lib/stores/model-key';
import { cn } from '@/lib/utils';
import type { ProgressView, SessionView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { BlockError } from '@/components/states/block-states';
import { GradeMark } from '@/components/zhupi/grade-mark';

/**
 * 下一步：会话的四种情况（继续/开始活动、先修自报、掌握补练、全部完成）。
 * 补练时逐个知识点列出最近 5 题的批改标记，并算出还要独立答对几道题。
 */
export function NextStep({ view, progress, className, footer = true }: { view: SessionView; progress?: ProgressView; className?: string; footer?: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const mode = useMode();
  const modelKey = useModelKey(state => state.config);
  const sessionId = view.session.sessionId;
  const next = describeNext(view);
  const points = outlinePoints(view.version.outline);
  const titleOf = (id: string) => points.find(p => p.knowledgePointId === id)?.title ?? id;
  const needsKey = mode.data?.mode === 'online' && !modelKey;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    void client.invalidateQueries({ queryKey: ['progress'] });
  };

  const remedial = useMutation({
    mutationFn: () => api(`/sessions/${encodeURIComponent(sessionId)}/remedial`, { method: 'POST', body: {}, key: newKey(), modelHeader: true }),
    onSuccess: () => { refresh(); router.push(`/learn/${sessionId}`); },
  });
  const declare = useMutation({
    mutationFn: () => api(`/sessions/${encodeURIComponent(sessionId)}/prior-knowledge`, { method: 'POST', body: { expectedRevision: view.session.revision, knowledgePointIds: next.pointIds }, key: newKey() }),
    onSuccess: refresh,
  });

  return (
    <section aria-labelledby={`next-${sessionId}`} className={cn('flex flex-col rounded-[var(--radius-paper)] bg-zhu-tint px-7 py-6 max-md:px-4 max-md:py-5', className)}>
      <h2 id={`next-${sessionId}`} className="font-serif text-h3 font-bold">{next.title}</h2>

      {next.kind === 'mastery' ? (
        <ul className="mt-3 grid gap-3">
          {next.pointIds.map(id => {
            const recent = progress?.recent?.[id] ?? [];
            const wrong = recent.filter(ok => !ok).length;
            return (
              <li key={id}>
                {next.pointIds.length > 1 && <p className="font-medium">{titleOf(id)}</p>}
                <span className="mt-1 flex items-center gap-1" role="img" aria-label={`${titleOf(id)} 最近 ${recent.length} 题：${recent.map(ok => (ok ? '对' : '错')).join('、') || '还没有作答'}`}>
                  {Array.from({ length: 5 }, (_, i) => <GradeMark key={i} kind={recent[i] === undefined ? 'pending' : recent[i] ? 'ok' : 'no'} />)}
                </span>
                <p className="mt-1.5 text-base text-ink-soft">
                  {recent.length > 0 ? `最近计入 ${recent.length} 题，错 ${wrong} 对 ${recent.length - wrong}。` : '还没有计入证据的作答。'}
                  再独立答对 {answersNeeded(recent)} 道不同题，最近 5 题正确率达到 80%，就算掌握。
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-base text-ink-soft">{next.detail}</p>
      )}

      <BlockError className="mt-3" error={remedial.error ?? declare.error} />
      {footer && (
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
          {(next.kind === 'continue' || next.kind === 'activity') && (
            <Button asChild variant="primary"><Link href={`/learn/${sessionId}`}>{next.kind === 'continue' ? '继续学习' : '开始学习'}<ArrowRight aria-hidden /></Link></Button>
          )}
          {next.kind === 'mastery' && (
            <>
              <Button variant="primary" disabled={remedial.isPending || needsKey} onClick={() => remedial.mutate()}>
                {remedial.isPending && <Loader2 className="animate-spin" aria-hidden />}生成补练题组
              </Button>
              {needsKey && <Link href="/settings" className="text-sm font-medium underline underline-offset-4">先在设置中填写模型 Key</Link>}
            </>
          )}
          {next.kind === 'prior' && (
            <>
              <Button variant="primary" disabled={declare.isPending} onClick={() => declare.mutate()}>我已掌握，继续</Button>
              <Link href={`/learn/${sessionId}`} className="text-sm font-medium underline underline-offset-4">去学习页切换理论模式</Link>
            </>
          )}
          {next.kind === 'done' && <Button asChild><Link href={`/learn/${sessionId}/history`}>回看课件与作答</Link></Button>}
        </div>
      )}
    </section>
  );
}
