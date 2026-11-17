'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react';
import { summaryText, type VisionExtraction } from '@/lib/verified-learning/vision/extraction';
import { Button } from '@/components/ui/button';

export interface AllowedCoursePoint {
  id: string;
  title: string;
}

/**
 * 视觉识别结果核对卡片（VisionExtractionCard）：
 * - 展示题面/代码结构化识别摘要、编程语言、涉及概念与不确定项；
 * - 用户可自由编辑修正识别文字；needsClarification=true 时必须修改或勾选确认后才可继续；
 * - 支持送入助教（解释题目 / 分析代码）或在无进行中活动时选定 1-3 个已学知识点生成 1 道变式题。
 */
export function VisionExtractionCard({
  extraction,
  initialMode = 'explain',
  allowedPoints,
  hasActiveRun,
  busy,
  onExplain,
  onPractice,
  onDiscard,
}: {
  extraction: VisionExtraction;
  initialMode?: 'explain' | 'analyze-code' | 'practice';
  allowedPoints: readonly AllowedCoursePoint[];
  hasActiveRun: boolean;
  busy: boolean;
  onExplain: (payload: {
    mode: 'explain' | 'analyze-code';
    transcription: string;
    concepts: string[];
    language: 'python' | 'javascript' | 'c' | null;
    uncertainty: string[];
    needsClarification: boolean;
    clarified: boolean;
  }) => void;
  onPractice: (payload: {
    transcription: string;
    concepts: string[];
    language: 'python' | 'javascript' | 'c' | null;
    needsClarification: boolean;
    clarified: boolean;
    knowledgePointIds: string[];
  }) => void;
  onDiscard: () => void;
}) {
  const [text, setText] = useState(extraction.transcription);
  const [edited, setEdited] = useState(false);
  const [confirmedManually, setConfirmedManually] = useState(false);
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>(() =>
    allowedPoints.length > 0 ? [allowedPoints[0].id] : [],
  );

  const clarified = !extraction.needsClarification || edited || confirmedManually;
  const canSubmitText = Boolean(text.trim()) && clarified && !busy;
  const canCreatePractice = canSubmitText && !hasActiveRun && selectedPointIds.length >= 1 && selectedPointIds.length <= 3;

  function togglePoint(id: string) {
    setSelectedPointIds(current => {
      if (current.includes(id)) return current.filter(item => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  return (
    <section aria-label="核对截图识别结果" className="grid gap-3 rounded-[var(--radius-control)] border border-rule bg-paper p-3.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{summaryText(extraction)}</p>
        <button type="button" onClick={onDiscard} disabled={busy} className="text-xs text-muted hover:text-ink">
          重新截图
        </button>
      </div>

      {(extraction.uncertainty.length > 0 || extraction.needsClarification) && (
        <div role="alert" className="grid gap-1.5 rounded-[var(--radius-control)] bg-zhu-tint px-3 py-2 text-xs text-zhu-deep">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span>识别结果存在不确定项，请核对下方文字后再继续：</span>
          </p>
          {extraction.uncertainty.length > 0 && (
            <ul className="list-inside list-disc">
              {extraction.uncertainty.map((item, idx) => <li key={idx}>{item}</li>)}
            </ul>
          )}
          {extraction.needsClarification && !edited && (
            <label className="mt-1 flex items-center gap-1.5 font-medium text-ink">
              <input
                type="checkbox"
                checked={confirmedManually}
                onChange={event => setConfirmedManually(event.target.checked)}
              />
              <span>我已核对识别文字无误</span>
            </label>
          )}
        </div>
      )}

      <div className="grid gap-1.5">
        <label htmlFor="vision-transcription-editor" className="text-xs font-medium text-muted">
          识别文字（可编辑核对）
        </label>
        <textarea
          id="vision-transcription-editor"
          rows={4}
          maxLength={8000}
          value={text}
          disabled={busy}
          onChange={event => {
            setText(event.target.value);
            setEdited(true);
          }}
          className="w-full rounded-[var(--radius-control)] border border-rule bg-ground px-2.5 py-2 font-mono text-xs leading-relaxed text-ink outline-none focus:border-ink"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={initialMode !== 'analyze-code' ? 'primary' : undefined}
          disabled={!canSubmitText}
          onClick={() =>
            onExplain({
              mode: 'explain',
              transcription: text.trim(),
              concepts: extraction.concepts,
              language: extraction.language ?? null,
              uncertainty: extraction.uncertainty,
              needsClarification: extraction.needsClarification,
              clarified,
            })
          }
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}确认文字并解释题目
        </Button>
        <Button
          type="button"
          size="sm"
          variant={initialMode === 'analyze-code' ? 'primary' : undefined}
          disabled={!canSubmitText}
          onClick={() =>
            onExplain({
              mode: 'analyze-code',
              transcription: text.trim(),
              concepts: extraction.concepts,
              language: extraction.language ?? null,
              uncertainty: extraction.uncertainty,
              needsClarification: extraction.needsClarification,
              clarified,
            })
          }
        >
          分析代码
        </Button>
      </div>

      <div className="grid gap-2 border-t border-rule pt-3">
        <p className="text-xs text-muted">
          生成 1 道同考点变式练习（经过独立审校与引用核验；不推进主课程进度，不计入掌握证据）：
        </p>
        {hasActiveRun ? (
          <p className="text-xs text-ink-soft">当前有正在进行的课程活动，完成或放弃当前活动后才能生成变式题（避免做题期间泄题）。</p>
        ) : allowedPoints.length === 0 ? (
          <p className="text-xs text-ink-soft">请先完成一节课件学习或自报已有基础后，再针对已学知识点生成变式题。</p>
        ) : (
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">选择变式题考查的已学知识点（最多 3 个）</legend>
            {allowedPoints.map(point => {
              const active = selectedPointIds.includes(point.id);
              return (
                <button
                  key={point.id}
                  type="button"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => togglePoint(point.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    active ? 'border-zhu bg-zhu-tint font-medium text-zhu-deep' : 'border-rule bg-ground text-ink-soft hover:text-ink'
                  }`}
                >
                  {point.title}
                </button>
              );
            })}
          </fieldset>
        )}
        <div>
          <Button
            type="button"
            size="sm"
            disabled={!canCreatePractice}
            onClick={() =>
              onPractice({
                transcription: text.trim(),
                concepts: extraction.concepts,
                language: extraction.language ?? null,
                needsClarification: extraction.needsClarification,
                clarified,
                knowledgePointIds: selectedPointIds,
              })
            }
          >
            <Sparkles aria-hidden />生成 1 道变式题
          </Button>
        </div>
      </div>
    </section>
  );
}
