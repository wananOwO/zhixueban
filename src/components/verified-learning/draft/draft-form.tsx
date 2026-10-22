'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import {
  api,
  ApiError,
  newKey,
  type BookView,
  type DraftInputShape,
  type FormDraft,
  type TemplateView,
} from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import ChapterPicker from './chapter-picker';
import { DraftSaveQueue, generationProblems, subjectLabels, teachingSelection } from '@/lib/verified-learning/draft-editor';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

const MODE_OPTIONS = [
  { value: 'practice', label: '练习模式（学练结合）' },
  { value: 'theory', label: '理论模式（只学不考）' },
  { value: 'drill', label: '刷题模式（以题带学）' },
];
const LANGUAGE_OPTIONS = [
  { value: 'python', label: 'Python 3' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'c', label: 'C' },
];

function TagInput({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState('');
  function add() {
    const value = text.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setText('');
  }
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`移除 ${value}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={values.length === 0 ? '输入后回车添加' : ''}
          className="min-w-28 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function DraftForm({
  draft,
  books,
  onSaved,
  onGenerating,
  onDiscarded,
}: {
  draft: FormDraft;
  books: BookView[];
  onSaved: (draft: FormDraft) => void;
  onGenerating: (jobId: string) => void;
  onDiscarded: () => void;
}) {
  const [input, setInput] = useState<DraftInputShape>(draft.input);
  const [revision, setRevision] = useState(draft.revision);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [generateError, setGenerateError] = useState<unknown>(null);
  const [generating, setGenerating] = useState(false);
  const [templates, setTemplates] = useState<{ builtins: TemplateView[]; custom: TemplateView[] }>({
    builtins: [],
    custom: [],
  });

  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef(input);
  const generateKey = useRef<{ revision: number; key: string } | null>(null);
  const queueRef = useRef<DraftSaveQueue<DraftInputShape> | null>(null);
  if (!queueRef.current) queueRef.current = new DraftSaveQueue(async (snapshot, expectedRevision, key) => {
    const saved = await api<FormDraft>(`/drafts/${draft.draftId}`, 'PATCH', { expectedRevision, input: snapshot }, key);
    setRevision(saved.revision); onSaved(saved); return saved.revision;
  }, draft.revision);

  useEffect(() => {
    api<{ builtins: TemplateView[]; custom: TemplateView[] }>('/templates').then(setTemplates).catch(setSaveError);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const flush = useCallback(async () => {
    if (conflictRef.current) return false;
    setSaveState('saving'); setSaveError(null);
    try {
      await queueRef.current!.flush(); setSaveState('saved'); return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { conflictRef.current = true; setSaveState('conflict'); }
      else setSaveState('error');
      setSaveError(e); return false;
    }
  }, []);

  function update(patch: Partial<DraftInputShape>) {
    const next = { ...inputRef.current, ...patch };
    next.textbookId = next.sources[0]?.sourceId ?? null;
    next.templateId ??= 'builtin:' + next.subjectType;
    next.programmingLanguage = next.subjectType === 'computer' ? next.programmingLanguage ?? 'python' : null;
    inputRef.current = next;
    queueRef.current!.update(next);
    setInput(next);
    if (conflictRef.current) return;
    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 800);
  }

  async function reloadServer() {
    try {
      const fresh = await api<FormDraft>(`/drafts/${draft.draftId}`);
      conflictRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      queueRef.current = new DraftSaveQueue(async (snapshot, expectedRevision, key) => {
        const saved = await api<FormDraft>(`/drafts/${draft.draftId}`, 'PATCH', { expectedRevision, input: snapshot }, key);
        setRevision(saved.revision); onSaved(saved); return saved.revision;
      }, fresh.revision);
      inputRef.current = fresh.input;
      setInput(fresh.input);
      setRevision(fresh.revision);
      setSaveState('idle');
      onSaved(fresh);
    } catch (e) {
      setSaveError(e);
      setSaveState('error');
    }
  }

  const problems = generationProblems(input);
  const readyToGenerate = problems.length === 0;

  async function generate() {
    setGenerateError(null);
    // 先落盘未保存内容，保证 generate 的 expectedRevision 有效
    if (timerRef.current) clearTimeout(timerRef.current);
    if (generating) return;
    setGenerating(true);
    if (!await flush()) { setGenerating(false); return; }
    const currentRevision = queueRef.current!.revision;
    if (generateKey.current?.revision !== currentRevision) generateKey.current = { revision: currentRevision, key: newKey() };
    try {
      const job = await api<{ jobId: string }>(
        `/drafts/${draft.draftId}/generate`,
        'POST',
        { expectedRevision: currentRevision },
        generateKey.current!.key,
      );
      onGenerating(job.jobId);
    } catch (e) {
      setGenerateError(e);
      setGenerating(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  const labelClass = 'mb-1 block text-sm font-medium';

  return (
    <div className="space-y-6">
      {/* 保存状态 */}
      <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
        {saveState === 'pending' && <span>编辑中…</span>}
        {saveState === 'saving' && (
          <span className="flex items-center gap-1">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            保存中…
          </span>
        )}
        {saveState === 'saved' && <span className="text-success">已保存</span>}
        {saveState === 'conflict' && (
          <span className="text-warning">保存冲突：内容已在别处被修改</span>
        )}
        {saveState === 'error' && <span className="text-danger">保存失败</span>}
      </div>

      {saveState === 'conflict' && (
        <div
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
        >
          <p>
            服务器上的草稿已被修改（可能是另一个标签页）。你的输入保留在本页，不会被覆盖。
          </p>
          <button
            type="button"
            onClick={() => void reloadServer()}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            放弃我的修改，加载服务器版本
          </button>
        </div>
      )}
      {!!saveError && saveState !== 'conflict' && (
        <ErrorBox
          error={saveError}
          onRetry={() => {
            setSaveState('pending');
            void flush();
          }}
        />
      )}

      <div>
        <label htmlFor="draft-title" className={labelClass}>
          课程标题
        </label>
        <input
          id="draft-title"
          type="text"
          value={input.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="例如：数据结构入门"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="draft-goal" className={labelClass}>
          学习目标 <span className="text-danger">*</span>
        </label>
        <textarea
          id="draft-goal"
          value={input.goal}
          onChange={(e) => update({ goal: e.target.value })}
          rows={3}
          placeholder="想学完达到什么程度？例如：能手写常见排序并分析复杂度"
          className={inputClass}
        />
      </div>

      <ChapterPicker
        books={books}
        sources={input.sources}
        onChange={(sources) => update({ sources })}
        onError={setSaveError}
      />
      <p className="-mt-4 text-xs text-muted-foreground">
        第一个资料来源为主教材；生成课程前需至少为主教材选择一章。
      </p>

      <div>
        <label htmlFor="draft-prompt" className={labelClass}>
          教学要求（可选）
        </label>
        <textarea
          id="draft-prompt"
          value={input.teachingPrompt}
          onChange={(e) => update({ teachingPrompt: e.target.value })}
          rows={3}
          placeholder="对讲解风格的额外要求，例如：多举生活中的例子"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="draft-prior" className={labelClass}>
          已有基础（可选）
        </label>
        <textarea
          id="draft-prior"
          value={input.priorKnowledgeText}
          onChange={(e) => update({ priorKnowledgeText: e.target.value })}
          rows={2}
          placeholder="你已经会什么？生成时会参考，但不替代掌握证据"
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TagInput
          label="重点包含的主题"
          values={input.includedTopics}
          onChange={(includedTopics) => update({ includedTopics })}
        />
        <TagInput
          label="排除的主题"
          values={input.excludedTopics}
          onChange={(excludedTopics) => update({ excludedTopics })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={input.allowSupplementalSources}
          onChange={(e) => update({ allowSupplementalSources: e.target.checked })}
        />
        允许 AI 补充教材之外的资料（补充来源需在确认前明确认可）
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="draft-mode" className={labelClass}>
            学习模式
          </label>
          <select
            id="draft-mode"
            value={input.mode}
            onChange={(e) => update({ mode: e.target.value as DraftInputShape['mode'] })}
            className={inputClass}
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="draft-template" className={labelClass}>教学方案</label>
          <select id="draft-template" value={input.templateId ?? 'builtin:' + input.subjectType} onChange={e => {
            const template = [...templates.builtins, ...templates.custom].find(t => t.templateId === e.target.value);
            if (template) update(teachingSelection(template, input.programmingLanguage));
          }} className={inputClass}>
            {Object.entries(subjectLabels).map(([subject, label]) => <option key={subject} value={'builtin:' + subject}>{label}</option>)}
            {templates.custom.map(t => <option key={t.templateId} value={t.templateId}>{t.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">一次选择同步学科与教学模板，上方可补充额外要求。</p>
        </div>
        {input.subjectType === 'computer' && (
          <div>
            <label htmlFor="draft-language" className={labelClass}>
              编程语言
            </label>
            <select
              id="draft-language"
              value={input.programmingLanguage ?? 'python'}
              onChange={(e) =>
                update({
                  programmingLanguage: e.target.value as DraftInputShape['programmingLanguage'],
                })
              }
              className={inputClass}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">考核设置</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          {(
            [
              ['pointQuestionCount', '知识点题量'],
              ['chapterQuestionCount', '章题量'],
              ['finalQuestionCount', '期末题量'],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`draft-${field}`} className="mb-1 block text-xs">
                {label}（1—50）
              </label>
              <input
                id={`draft-${field}`}
                type="number"
                min={1}
                max={50}
                value={input.assessment[field]}
                onChange={(e) =>
                  update({
                    assessment: {
                      ...input.assessment,
                      [field]: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    },
                  })
                }
                className={inputClass}
              />
            </div>
          ))}
          <div>
            <label htmlFor="draft-difficulty" className="mb-1 block text-xs">
              难度
            </label>
            <select
              id="draft-difficulty"
              value={input.assessment.difficulty}
              onChange={(e) =>
                update({
                  assessment: {
                    ...input.assessment,
                    difficulty: e.target.value as 'easy' | 'medium' | 'hard',
                  },
                })
              }
              className={inputClass}
            >
              <option value="easy">入门</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
        </div>
      </fieldset>

      <div className="rounded-lg border border-border p-4">
        <ErrorBox error={generateError} />
        <button
          type="button"
          disabled={!readyToGenerate || generating || saveState === 'conflict'}
          onClick={() => void generate()}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="h-4 w-4" />
          )}
          生成课程方案
        </button>
        {!readyToGenerate && (
          <p className="mt-2 text-xs text-muted-foreground">
            {problems.join('；')}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          修订号 {revision}；空表单也可以随时保存，之后继续编辑。
        </p>
        <button
          type="button"
          onClick={onDiscarded}
          className="mt-3 text-xs text-danger hover:underline"
        >
          丢弃此草稿
        </button>
      </div>
    </div>
  );
}
