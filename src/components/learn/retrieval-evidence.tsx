'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { isWebSource, sourceDisplayName } from '@/lib/labels';
import type { SourceTarget } from '@/components/zhupi/source-drawer';

export interface RetrievalEvidenceHit {
  sourceId: string;
  sourceRevision: string;
  chapterId: string;
  paragraphIndex: number;
  text: string;
  score: number;
  match: { keyword: boolean; vector: boolean; chapterBoost: boolean };
  contentHash: string;
  sourceTitle?: string;
  chapterTitle?: string;
  chapterFiltered?: boolean;
}

/**
 * 可解释检索证据面板（设计 5.7 / 6.7）：
 * 默认折叠；展开后显示命中的来源名称、章节名称、真实段落编号、关键词/语义/章节加权标签，
 * 点击直接打开原书 SourceDrawer，不把排序分值伪装为置信百分比。
 */
export function RetrievalEvidence({
  hits,
  degraded,
  notice,
  onOpen,
  defaultOpen = false,
}: {
  hits: readonly RetrievalEvidenceHit[];
  degraded?: boolean;
  notice?: string;
  onOpen: (target: SourceTarget) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!hits.length && !notice && !degraded) return null;

  const chapterFiltered = hits.some(h => h.chapterFiltered);
  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 font-sans text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-2 text-left font-medium text-ink-soft hover:text-ink"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <BookOpen className="size-3.5 shrink-0 text-zhu" aria-hidden />
          <span>出处详情（检索命中 {hits.length} 段）</span>
          {degraded && <span className="rounded bg-raised px-1.5 py-0.5 text-[0.6875rem] text-muted">已降级关键词检索</span>}
          {chapterFiltered && <span className="rounded bg-raised px-1.5 py-0.5 text-[0.6875rem] text-muted">已按课程章节过滤</span>}
        </span>
        {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
      </button>

      {open && (
        <div className="mt-2 grid gap-2 border-t border-rule pt-2">
          {notice && <p className="text-muted">{notice}</p>}
          {hits.length === 0 ? (
            <p className="text-muted">资料中没有找到匹配段落。</p>
          ) : (
            <ul className="grid gap-2">
              {hits.map(hit => {
                const srcLabel = sourceDisplayName(hit.sourceTitle ?? (isWebSource(hit.sourceId) ? '公开资料' : '教材'), hit.sourceId);
                return (
                  <li key={`${hit.sourceId}:${hit.chapterId}:${hit.paragraphIndex}`} className="grid gap-1 rounded bg-ground px-2.5 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpen({
                          sourceId: hit.sourceId,
                          sourceRevision: hit.sourceRevision,
                          chapterId: hit.chapterId,
                          paragraphIndex: hit.paragraphIndex,
                        })}
                        className="font-medium text-zhu hover:underline hover:underline-offset-4"
                      >
                        {srcLabel}
                        {hit.chapterTitle ? ` · ${hit.chapterTitle}` : ''}
                        {` · 第 ${hit.paragraphIndex} 段`}
                      </button>
                      <span className="flex flex-wrap gap-1 text-[0.6875rem]">
                        {hit.match.keyword && <span className="rounded bg-paper px-1.5 py-0.5 text-ink-soft">关键词命中</span>}
                        {hit.match.vector && <span className="rounded bg-zhu-tint px-1.5 py-0.5 text-zhu-deep">语义命中</span>}
                        {hit.match.chapterBoost && <span className="rounded bg-paper px-1.5 py-0.5 text-ink-soft">章节加权</span>}
                      </span>
                    </div>
                    <p className="line-clamp-2 font-serif text-[0.8125rem] leading-relaxed text-ink-soft">{hit.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
