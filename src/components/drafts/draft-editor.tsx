'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { api, ApiError, newKey } from '@/lib/api/client';
import { useMode, queryKeys } from '@/lib/api/queries';
import { useModelKey } from '@/lib/stores/model-key';
import { DraftSaveQueue, generationProblems, subjectLabels, teachingSelection } from '@/lib/verified-learning/draft-editor';
import { MODE_HINT, MODE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { BookView, DraftInputShape, FormDraft, JobView, TemplateView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Panel } from '@/components/ui/panel';
import { BlockError } from '@/components/states/block-states';
import { SourcePicker } from './source-picker';
import { TagInput } from './tag-input';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';
const SECTIONS = [
  { id: 'goal', label: '目标' },
  { id: 'sources', label: '资料与章节' },
  { id: 'teaching', label: '教学要求' },
  { id: 'assessment', label: '考核与模式' },
] as const;
const LANGUAGES = [{ value: 'python', label: 'Python 3' }, { value: 'javascript', label: 'JavaScript' }, { value: 'c', label: 'C' }] as const;

/** 草稿编辑器：四个分区纵向排列，左侧目录随滚动高亮；内容自动保存（串行、冲突不覆盖） */
export function DraftEditor({ draft, books, onSaved, onGenerating }: {
  draft: FormDraft;
  books: BookView[];
  onSaved: (draft: FormDraft) => void;
  onGenerating: (job: JobView) => void;
}) {
  const mode = useMode();
  const online = mode.data?.mode === 'online';
  const modelKey = useModelKey(state => state.config);
  const templates = useQuery({ queryKey: queryKeys.templates(), queryFn: () => api<{ builtins: TemplateView[]; custom: TemplateView[] }>('/templates') });

  const [input, setInput] = useState<DraftInputShape>(draft.input);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [generateError, setGenerateError] = useState<unknown>(null);
  const [generating, setGenerating] = useState(false);
  const inputRef = useRef(input);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generateKey = useRef<{ revision: number; key: string } | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const makeQueue = useCallback((revision: number) => new DraftSaveQueue<DraftInputShape>(async (snapshot, expectedRevision, key) => {
    const saved = await api<FormDraft>(`/drafts/${draft.draftId}`, { method: 'PATCH', body: { expectedRevision, input: snapshot }, key });
    onSavedRef.current(saved);
    return saved.revision;
  }, revision), [draft.draftId]);
  const queue = useRef<DraftSaveQueue<DraftInputShape> | null>(null);
  if (!queue.current) queue.current = makeQueue(draft.revision);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flush = useCallback(async () => {
    if (conflict.current) return false;
    setSaveState('saving');
    setSaveError(null);
    try {
      await queue.current!.flush();
      setSaveState('saved');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { conflict.current = true; setSaveState('conflict'); }
      else setSaveState('error');
      setSaveError(error);
      return false;
    }
  }, []);

  function update(patch: Partial<DraftInputShape>) {
    const next = { ...inputRef.current, ...patch };
    next.textbookId = next.sources[0]?.sourceId ?? null;
    next.templateId ??= `builtin:${next.subjectType}`;
    next.programmingLanguage = next.subjectType === 'computer' ? (next.programmingLanguage ?? 'python') : null;
    inputRef.current = next;
    queue.current!.update(next);
    setInput(next);
    if (conflict.current) return;
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }

  async function reloadServer() {
    try {
      const fresh = await api<FormDraft>(`/drafts/${draft.draftId}`);
      conflict.current = false;
      if (timer.current) clearTimeout(timer.current);
      queue.current = makeQueue(fresh.revision);
      inputRef.current = fresh.input;
      setInput(fresh.input);
      setSaveState('idle');
      setSaveError(null);
      onSaved(fresh);
    } catch (error) {
      setSaveError(error);
      setSaveState('error');
    }
  }

  const problems = generationProblems(input);
  const needsKey = online && !modelKey;
  const ready = problems.length === 0 && !needsKey && saveState !== 'conflict';

  async function generate() {
    if (generating) return;
    setGenerateError(null);
    if (timer.current) clearTimeout(timer.current);
    setGenerating(true);
    if (!(await flush())) { setGenerating(false); return; }
    const revision = queue.current!.revision;
    if (generateKey.current?.revision !== revision) generateKey.current = { revision, key: newKey() };
    try {
      const job = await api<JobView>(`/drafts/${draft.draftId}/generate`, { method: 'POST', body: { expectedRevision: revision }, key: generateKey.current.key, modelHeader: true });
      onGenerating(job);
    } catch (error) {
      setGenerateError(error);
      setGenerating(false);
    }
  }

  const allTemplates = [...(templates.data?.builtins ?? []), ...(templates.data?.custom ?? [])];
  const assessment = input.assessment;
  const setAssessment = (patch: Partial<DraftInputShape['assessment']>) => update({ assessment: { ...assessment, ...patch } });

  return (
    <div className="mt-6 grid grid-cols-[13rem_minmax(0,1fr)_20rem] items-start gap-6 max-xl:grid-cols-[minmax(0,1fr)_20rem] max-lg:grid-cols-1">
      <nav aria-label="草稿分区" className="sticky top-4 rounded-[var(--radius-paper)] bg-paper px-3 py-4 max-xl:hidden">
        <ol className="grid gap-0.5">
          {SECTIONS.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-base hover:bg-ground">
                <span className="font-serif text-sm font-bold text-zhu" aria-hidden>{index + 1}</span>
                {section.label}
              </a>
            </li>
          ))}
        </ol>
        <div className="mt-4 border-t border-rule px-2 pt-3"><SaveIndicator state={saveState} /></div>
      </nav>

      <div className="grid min-w-0 gap-6">
        {saveState === 'conflict' && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-paper)] bg-zhu-tint px-5 py-4 text-base">
            <p className="min-w-0 flex-1">草稿已在别处修改（可能是另一个标签页）。你在这里的输入还在，没有覆盖服务器上的版本。</p>
            <Button size="sm" onClick={() => void reloadServer()}>放弃本页修改，加载服务器版本</Button>
          </div>
        )}
        {saveState === 'error' && <BlockError error={saveError} onRetry={() => void flush()} />}

        <Panel title="目标" className="scroll-mt-4" headingLevel={2}>
          <div id="goal" className="mt-4 grid gap-4">
            <Field label="课程标题" htmlFor="draft-title" hint="显示在课程列表里，可以之后再改。">
              <Input id="draft-title" value={input.title} onChange={event => update({ title: event.target.value })} placeholder="例如：蓝桥杯 Python 入门" maxLength={120} />
            </Field>
            <Field label="学习目标" htmlFor="draft-goal" required hint="写成能检验的样子。Agent 据此挑选目标知识点并补齐先修。">
              <Textarea id="draft-goal" rows={3} value={input.goal} onChange={event => update({ goal: event.target.value })} placeholder="例如：能用 Python 写出蓝桥杯入门题，掌握枚举、前缀和与二分查找" />
            </Field>
          </div>
        </Panel>

        <Panel title="资料与章节" className="scroll-mt-4" description="第一本是主教材。课件里的每句讲解都要能在这些章节里找到出处。">
          <div id="sources" className="mt-4">
            <SourcePicker books={books} sources={input.sources} onChange={sources => update({ sources })} />
            <label className="mt-5 flex items-start gap-2.5 text-base">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-ink)]" checked={input.allowSupplementalSources} onChange={event => update({ allowSupplementalSources: event.target.checked })} />
              <span>允许 Agent 联网补充教材没有的内容<span className="block text-sm text-muted">只用公开网页，保存正文快照供回查；确认方案时会逐个列出请你认可。</span></span>
            </label>
          </div>
        </Panel>

        <Panel title="教学要求" className="scroll-mt-4">
          <div id="teaching" className="mt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="教学方案" htmlFor="draft-template" hint="决定讲解风格和题型，例如计算机类会出编程题。">
                <Select
                  id="draft-template"
                  value={input.templateId ?? `builtin:${input.subjectType}`}
                  onChange={event => {
                    const template = allTemplates.find(t => t.templateId === event.target.value);
                    if (template) update(teachingSelection(template, input.programmingLanguage));
                  }}
                >
                  {Object.entries(subjectLabels).map(([subject, label]) => <option key={subject} value={`builtin:${subject}`}>{label}</option>)}
                  {(templates.data?.custom ?? []).map(t => <option key={t.templateId} value={t.templateId}>{t.name}</option>)}
                </Select>
              </Field>
              {input.subjectType === 'computer' && (
                <Field label="编程语言" htmlFor="draft-language" hint="编程题用这门语言作答，由隔离判题服务运行。">
                  <Select id="draft-language" value={input.programmingLanguage ?? 'python'} onChange={event => update({ programmingLanguage: event.target.value as DraftInputShape['programmingLanguage'] })}>
                    {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <Field label="讲解要求（可选）" htmlFor="draft-prompt">
              <Textarea id="draft-prompt" rows={2} value={input.teachingPrompt} onChange={event => update({ teachingPrompt: event.target.value })} placeholder="例如：多举生活中的例子，代码逐行解释" />
            </Field>
            <Field label="已有基础（可选）" htmlFor="draft-prior" hint="生成时作为参考；不会当作掌握证据。">
              <Textarea id="draft-prior" rows={2} value={input.priorKnowledgeText} onChange={event => update({ priorKnowledgeText: event.target.value })} placeholder="例如：学过 C 语言的变量和循环" />
            </Field>
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <TagInput label="重点包含的主题" values={input.includedTopics} onChange={includedTopics => update({ includedTopics })} />
              <TagInput label="不要包含的主题" values={input.excludedTopics} onChange={excludedTopics => update({ excludedTopics })} />
            </div>
          </div>
        </Panel>

        <Panel title="考核与模式" className="scroll-mt-4">
          <div id="assessment" className="mt-4 grid gap-5">
            <fieldset>
              <legend className="text-base font-medium">学习模式</legend>
              <div className="mt-2 grid grid-cols-3 gap-2 max-md:grid-cols-1">
                {(['theory', 'practice', 'drill'] as const).map(value => (
                  <label key={value} className={cn('cursor-pointer rounded-[var(--radius-control)] border px-4 py-3 transition-colors', input.mode === value ? 'border-ink bg-ground' : 'border-line hover:border-control-strong')}>
                    <input type="radio" name="draft-mode" value={value} checked={input.mode === value} onChange={() => update({ mode: value })} className="sr-only" />
                    <span className="block font-medium">{MODE_LABEL[value]}</span>
                    <span className="mt-0.5 block text-sm text-muted">{MODE_HINT[value]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
              {([['pointQuestionCount', '每个知识点'], ['chapterQuestionCount', '每章测验'], ['finalQuestionCount', '期末考核']] as const).map(([field, label]) => (
                <Field key={field} label={`${label}题量`} htmlFor={`draft-${field}`}>
                  <Input id={`draft-${field}`} type="number" min={1} max={50} value={assessment[field]} onChange={event => setAssessment({ [field]: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} />
                </Field>
              ))}
              <Field label="难度" htmlFor="draft-difficulty">
                <Select id="draft-difficulty" value={assessment.difficulty} onChange={event => setAssessment({ difficulty: event.target.value as 'easy' | 'medium' | 'hard' })}>
                  <option value="easy">入门</option>
                  <option value="medium">中等</option>
                  <option value="hard">困难</option>
                </Select>
              </Field>
            </div>
            <p className="text-sm text-muted">题量为 1–50。掌握标准不随题量变化：至少 3 道不同题，最近 5 题答对 80% 以上，且最近一题独立答对。</p>
          </div>
        </Panel>
      </div>

      <aside className="sticky top-4 grid gap-4 max-lg:static" aria-label="生成课程方案">
        <Panel title="生成课程方案" tone={ready ? 'zhu' : 'paper'}>
          <p className="mt-2 text-base text-ink-soft">Agent 会读你选的章节，提交知识点并逐个校验出处与先修关系，通常需要几分钟到几十分钟，可以离开页面。</p>
          {problems.length > 0 && (
            <ul className="mt-4 grid gap-1.5 text-base" aria-label="还不能生成的原因">
              {problems.map(problem => <li key={problem} className="flex gap-2"><span aria-hidden className="text-zhu">·</span>{problem}</li>)}
            </ul>
          )}
          {needsKey && (
            <p className="mt-4 text-base">线上演示需要你自己的模型 Key（只保存在本浏览器）。<Link href="/settings" className="ml-1 font-medium underline underline-offset-4">去设置填写模型 Key</Link></p>
          )}
          <BlockError className="mt-4" error={generateError} />
          <Button variant="primary" className="mt-5 w-full" disabled={!ready || generating} onClick={() => void generate()}>
            {generating ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            生成课程方案
          </Button>
          <div className="mt-3 xl:hidden"><SaveIndicator state={saveState} /></div>
        </Panel>
      </aside>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text: Record<SaveState, string> = { idle: '自动保存已开启', pending: '编辑中…', saving: '保存中…', saved: '已保存', error: '保存失败', conflict: '有冲突，未保存' };
  return (
    <p role="status" aria-live="polite" className={cn('text-sm', state === 'error' || state === 'conflict' ? 'text-zhu' : 'text-muted')}>
      {text[state]}
    </p>
  );
}
