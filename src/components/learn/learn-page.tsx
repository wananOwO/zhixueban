'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, MessageCircle, NotebookText, PanelRightOpen, Play } from 'lucide-react';
import { api, ApiError, newKey } from '@/lib/api/client';
import { useBooks, useCourses, useDrafts, useProgress, useSession } from '@/lib/api/hooks';
import { queryKeys, useMode } from '@/lib/api/queries';
import { attachCitations } from '@/lib/citations';
import { courseTitle, describeNext, outlinePoints } from '@/lib/course';
import { ACTIVITY_LABEL, isWebSource, MODE_HINT, MODE_LABEL, sourceDisplayName, sourceNoteLabel } from '@/lib/labels';
import { useModelKey } from '@/lib/stores/model-key';
import { cn, formatCount } from '@/lib/utils';
import type { CitationView, CoursePointView, LearningModeName, ProgressView, RunView, SessionView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { SheetContent } from '@/components/ui/dialog';
import { Panel } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';
import { CitationNote } from '@/components/zhupi/citation-note';
import { GradeMark } from '@/components/zhupi/grade-mark';
import { SourceDrawer, type SourceTarget } from '@/components/zhupi/source-drawer';
import { GenerationView } from '@/components/drafts/generation-view';
import { NextStep } from '@/components/courses/next-step';
import { LessonArticle } from './lesson-article';
import { QuestionSet } from './question-set';
import { TutorPanel, type TutorSelection } from './tutor-panel';

const WIDE = '(min-width: 1440px)';

/**
 * 学习页：左栏课程目录与模式切换，中间纸面（课件 / 题组 / 生成中 / 下一步），右栏旁注或助教。
 * ≥1440 三栏；1024–1439 右栏收为抽屉；<1024 单栏，旁注排在段后，助教用全屏抽屉。
 */
export function LearnPage({ sessionId, focusPoint }: { sessionId: string; focusPoint?: string }) {
  const session = useSession(sessionId);
  if (session.isPending) return <Panel className="mt-6"><BlockLoading lines={10} label="正在读取学习进度" /></Panel>;
  if (session.error || !session.data) {
    const missing = session.error instanceof ApiError && session.error.status === 404;
    return (
      <Panel className="mt-6" title={missing ? '没有找到这个学习会话' : '学习进度读取失败'}>
        {missing ? <BlockEmpty className="mt-3" title="会话不存在或已被删除" action={<Button asChild><Link href="/courses">返回我的课程</Link></Button>} /> : <BlockError className="mt-3" error={session.error} onRetry={() => void session.refetch()} />}
      </Panel>
    );
  }
  return <LearnBody view={session.data} focusPoint={focusPoint} />;
}

function LearnBody({ view, focusPoint }: { view: SessionView; focusPoint?: string }) {
  const client = useQueryClient();
  const sessionId = view.session.sessionId;
  const courses = useCourses();
  const drafts = useDrafts();
  const books = useBooks();
  const progress = useProgress(view.session.courseVersionId);
  const course = courses.data?.find(c => c.versionId === view.session.courseVersionId);
  const title = course ? courseTitle(course, drafts.data) : '课程';
  const points = outlinePoints(view.version.outline);
  const run = view.currentRun;
  const runQuery = useQuery({ queryKey: queryKeys.run(run?.runId ?? ''), enabled: !!run && run.status !== 'generating', queryFn: () => api<RunView>(`/runs/${encodeURIComponent(run!.runId)}`) });
  const next = describeNext(view);
  const currentPoint = next.pointIds[0];
  const activityPoints = (run?.activity.knowledgePointIds ?? next.pointIds).map(id => points.find(p => p.knowledgePointId === id)).filter(Boolean) as CoursePointView[];
  const heading = activityPoints.map(p => p.title).join('、') || title;
  const titles = useMemo(() => Object.fromEntries((books.data ?? []).map(b => [b.bookId, b.title])), [books.data]);
  const allowedPracticePoints = useMemo(() => {
    const allowedSet = new Set(view.allowedKnowledgePointIds ?? []);
    return points
      .filter(p => allowedSet.has(p.knowledgePointId))
      .map(p => ({ id: p.knowledgePointId, title: p.title }));
  }, [points, view.allowedKnowledgePointIds]);

  const [drawer, setDrawer] = useState<SourceTarget | null>(null);
  const [side, setSide] = useState<'notes' | 'tutor'>('notes');
  const [sheet, setSheet] = useState<'notes' | 'tutor' | null>(null);
  const [selection, setSelection] = useState<TutorSelection | null>(null);
  const refresh = useCallback(() => {
    for (const key of [queryKeys.session(sessionId), ['progress'], ['history'], ['courses']]) void client.invalidateQueries({ queryKey: key });
  }, [client, sessionId]);

  const lesson = run?.activity.kind === 'lesson' ? runQuery.data?.content ?? null : null;
  const citations = lesson?.citations ?? [];
  const chapterOf = (sourceId: string, paragraphIndex: number) =>
    citations.find(c => c.sourceId === sourceId && c.paragraphIndex === paragraphIndex)?.chapterId
    ?? citations.find(c => c.sourceId === sourceId)?.chapterId
    ?? books.data?.find(b => b.bookId === sourceId)?.chapters[0]?.id;
  // 布局只用 CSS 断点（服务端渲染即正确）；点击时才读当前宽度决定助教开在右栏还是抽屉
  const openTutor = () => (window.matchMedia(WIDE).matches ? setSide('tutor') : setSheet('tutor'));

  const tutor = (onClose?: () => void) => (
    <TutorPanel
      sessionId={sessionId}
      runId={run?.runId}
      selection={selection}
      onClearSelection={() => setSelection(null)}
      titles={titles}
      chapterOf={chapterOf}
      allowedPoints={allowedPracticePoints}
      hasActiveRun={Boolean(run)}
      onPracticeCreated={refresh}
      onOpen={setDrawer}
      onClose={onClose}
    />
  );

  return (
    <div className={cn('grid grid-cols-1 gap-8 pt-5 lg:grid-cols-[14rem_minmax(0,1fr)]', side === 'tutor' ? 'wide:grid-cols-[15rem_minmax(0,1fr)_24rem]' : 'wide:grid-cols-[15rem_minmax(0,1fr)]')}>
      <aside aria-label="课程目录" className="min-w-0 max-lg:hidden">
        <CourseToc view={view} title={title} courseId={view.session.courseId} progress={progress.data} current={currentPoint} focus={focusPoint} titles={titles} onRefresh={refresh} />
      </aside>

      <main className="min-w-0" aria-labelledby="learn-h">
        <div className="rounded-[var(--radius-paper)] bg-paper px-14 pb-8 pt-10 max-xl:px-9 max-md:px-4 max-md:pb-5 max-md:pt-6">
          <nav aria-label="面包屑" className="text-sm text-muted">
            <Link href="/courses" className="hover:text-ink">我的课程</Link>
            <span aria-hidden> / </span>
            <Link href={`/courses/${encodeURIComponent(view.session.courseId)}`} className="hover:text-ink">{title}</Link>
            {run && <><span aria-hidden> / </span>{ACTIVITY_LABEL[run.activity.kind] ?? '学习'}</>}
          </nav>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <h1 id="learn-h" className="min-w-0 font-serif text-h1 font-bold tracking-[-0.01em] max-md:text-[1.375rem]">{heading}</h1>
            <div className="flex flex-wrap gap-2">
              <ModeSwitch view={view} onChanged={refresh} className="lg:hidden" />
              {lesson && <Button size="sm" className="hidden lg:inline-flex wide:hidden" onClick={() => setSheet('notes')}><PanelRightOpen aria-hidden />旁注</Button>}
              <Button size="sm" className={cn(side === 'tutor' && 'wide:hidden')} onClick={openTutor}><MessageCircle aria-hidden />问助教</Button>
              {side === 'tutor' && lesson && <Button size="sm" className="hidden wide:inline-flex" onClick={() => setSide('notes')}><NotebookText aria-hidden />看旁注</Button>}
              <Button asChild size="sm" variant="ghost"><Link href={`/learn/${encodeURIComponent(sessionId)}/history`}><History aria-hidden />历史回看</Link></Button>
            </div>
          </div>

          {run?.status === 'generating' && run.jobId ? (
            <div className="mt-6">
              <p className="text-base text-muted">Agent 正在读教材写这次的{ACTIVITY_LABEL[run.activity.kind] ?? '内容'}，每节通过验收才会保存。可以离开页面，回来接着看。</p>
              <GenerationView jobId={run.jobId} title={`正在生成${ACTIVITY_LABEL[run.activity.kind] ?? '内容'}`} compact onFinished={() => { refresh(); void runQuery.refetch(); }} />
            </div>
          ) : run ? (
            <ActivityBody
              view={view}
              run={run}
              runView={runQuery.data}
              runError={runQuery.error}
              onRetry={() => void runQuery.refetch()}
              progress={progress.data}
              titles={titles}
              margin={side === 'notes'}
              onOpen={setDrawer}
              onSelect={(sel) => { setSelection(sel); }}
              onDone={() => { refresh(); void runQuery.refetch(); }}
            />
          ) : (
            <NextBody view={view} progress={progress.data} onStarted={refresh} />
          )}
        </div>
      </main>

      {side === 'tutor' && <div className="sticky top-4 hidden h-[calc(100vh-2rem)] min-w-0 flex-col wide:flex">{tutor(() => setSide('notes'))}</div>}

      <Dialog.Root open={sheet !== null} onOpenChange={open => { if (!open) setSheet(null); }}>
        {sheet === 'notes' && (
          <SheetContent title="旁注" description={`本次课件 ${citations.length} 处出处，点一条打开原文`}>
            <div className="grid gap-4 px-6 py-5">
              {[...citations].sort((a, b) => a.paragraphIndex - b.paragraphIndex).map(c => (
                <CitationNote key={`${c.sourceId}#${c.paragraphIndex}`} sourceLabel={isWebSource(c.sourceId) ? sourceNoteLabel(titles[c.sourceId], c.sourceId) : '教材'} paragraphIndex={c.paragraphIndex} quote={c.quote} onOpen={() => { setSheet(null); setDrawer(sourceTarget(c)); }} />
              ))}
            </div>
          </SheetContent>
        )}
        {sheet === 'tutor' && (
          <SheetContent title="助教" className="max-md:w-screen">
            <div className="flex h-full flex-col px-5 py-4">{tutor()}</div>
          </SheetContent>
        )}
      </Dialog.Root>
      <SourceDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

const sourceTarget = (c: CitationView): SourceTarget => ({ sourceId: c.sourceId, sourceRevision: c.sourceRevision, chapterId: c.chapterId, paragraphIndex: c.paragraphIndex });

/** 左栏：课程名、掌握进度、模式切换、按资料分组的知识点目录 */
function CourseToc({ view, title, courseId, progress, current, focus, titles, onRefresh }: {
  view: SessionView; title: string; courseId: string; progress?: ProgressView; current?: string; focus?: string; titles: Record<string, string>; onRefresh: () => void;
}) {
  const points = outlinePoints(view.version.outline);
  const verified = new Set(progress?.verifiedKnowledgePointIds ?? []);
  // 按每个知识点的第一份资料分组（课程大纲的模块名是「版权信息」「公开网页正文」这类章节名，不适合做目录标题）
  const groups = new Map<string, CoursePointView[]>();
  for (const point of points) {
    const key = point.sourceIds[0] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const focusRef = useRef<HTMLLIElement>(null);
  // focus 变化后（从路线图点进来）把该知识点滚到目录可见处
  useEffect(() => { if (focus) focusRef.current?.scrollIntoView({ block: 'nearest' }); }, [focus]);
  return (
    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pb-4">
      <h2 className="font-serif text-h3 font-bold"><Link href={`/courses/${encodeURIComponent(courseId)}`} className="hover:text-zhu">{title}</Link></h2>
      {view.version.goal && <p className="mt-1 line-clamp-2 text-sm text-muted">目标：{view.version.goal}</p>}
      <p className="mt-1 text-sm tabular-nums text-muted">已验证掌握 {verified.size} / {points.length} · 已完成 {view.session.completedActivityIds.length} 个活动</p>
      <ModeSwitch view={view} onChanged={onRefresh} className="mt-4" />
      <nav aria-label="知识点目录" className="mt-5">
        {[...groups].map(([sourceId, list]) => (
          <div key={sourceId} className="mt-4 first:mt-0">
            <h3 className="truncate text-xs font-medium text-muted">{isWebSource(sourceId) ? '公开资料' : '教材'} · {sourceDisplayName(titles[sourceId] ?? '资料', sourceId)}</h3>
            <ol className="mt-1.5">
              {list.map(point => {
                const isCurrent = point.knowledgePointId === current;
                const isFocus = point.knowledgePointId === focus;
                return (
                  <li key={point.knowledgePointId} ref={isFocus ? focusRef : undefined}>
                    <Link
                      href={`/courses/${encodeURIComponent(courseId)}`}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={cn('grid min-h-[1.875rem] grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-control)] px-1 text-sm text-ink-soft hover:bg-paper', isCurrent && 'font-bold text-ink', isFocus && 'bg-paper')}
                      title={point.title}
                    >
                      {verified.has(point.knowledgePointId) ? <GradeMark kind="ok" size="sm" className="justify-self-center" /> : (
                        <span aria-hidden className={cn('size-[0.5625rem] justify-self-center rounded-full border-[1.5px]', isCurrent ? 'border-zhu bg-zhu' : 'border-[#9b9a95]')} />
                      )}
                      <span className="truncate">{point.title}</span>
                      <span className="text-[0.6875rem] font-normal text-muted">{point.role === 'target' ? '目标' : '先修'}</span>
                      <span className="sr-only">{verified.has(point.knowledgePointId) ? '，已验证掌握' : ''}{isCurrent ? '，当前' : ''}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </nav>
    </div>
  );
}

/** 学习模式：理论 / 练习 / 刷题。有进行中的活动时先确认放弃 */
function ModeSwitch({ view, onChanged, className }: { view: SessionView; onChanged: () => void; className?: string }) {
  const [pending, setPending] = useState<LearningModeName | null>(null);
  const change = useMutation({
    mutationFn: async (mode: LearningModeName) => {
      let revision = view.session.revision;
      if (view.currentRun) {
        const after = await api<SessionView>(`/sessions/${encodeURIComponent(view.session.sessionId)}/abandon`, { method: 'POST', body: { runId: view.currentRun.runId, expectedRevision: revision }, key: newKey() });
        revision = after.session.revision;
      }
      return api<SessionView>(`/sessions/${encodeURIComponent(view.session.sessionId)}/mode`, { method: 'PATCH', body: { mode, expectedRevision: revision }, key: newKey() });
    },
    onSuccess: () => { setPending(null); onChanged(); },
  });
  const pick = (mode: LearningModeName) => {
    if (mode === view.session.mode) return;
    if (view.currentRun) setPending(mode); else change.mutate(mode);
  };
  return (
    <div className={className}>
      <fieldset className="grid grid-cols-3 rounded-[8px] bg-raised p-[3px]">
        <legend className="sr-only">学习模式</legend>
        {(['theory', 'practice', 'drill'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            aria-pressed={view.session.mode === mode}
            title={MODE_HINT[mode]}
            disabled={change.isPending}
            onClick={() => pick(mode)}
            className={cn('h-[1.875rem] rounded-[6px] px-3 text-sm text-muted transition-colors hover:text-ink', view.session.mode === mode && 'bg-paper font-medium text-ink')}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}
      </fieldset>
      <BlockError className="mt-2" error={change.error} />
      {pending && (
        <Dialog.Root open onOpenChange={open => { if (!open) setPending(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--radius-paper)] bg-paper p-6 shadow-[var(--shadow-float)]">
              <Dialog.Title className="font-serif text-h3 font-bold">切换到{MODE_LABEL[pending]}模式？</Dialog.Title>
              <Dialog.Description className="text-base text-muted">当前活动会被放弃，已提交的作答保留并计入证据。{MODE_HINT[pending]}。</Dialog.Description>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setPending(null)}>继续当前活动</Button>
                <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate(pending)}>放弃并切换</Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

/** 没有进行中的活动：下一步面板 + 开始按钮 */
function NextBody({ view, progress, onStarted }: { view: SessionView; progress?: ProgressView; onStarted: () => void }) {
  const mode = useMode();
  const modelKey = useModelKey(state => state.config);
  const next = describeNext(view);
  const start = useMutation({
    mutationFn: () => api(`/sessions/${encodeURIComponent(view.session.sessionId)}/start`, { method: 'POST', body: { expectedRevision: view.session.revision }, key: newKey(), modelHeader: true }),
    onSuccess: onStarted,
  });
  // 示例课程里已预先生成的活动不调用模型，没有 Key 也能开始
  const needsKey = mode.data?.mode === 'online' && !modelKey && !view.nextPrepared;
  return (
    <div className="mt-6 grid gap-5">
      <NextStep view={view} progress={progress} footer={next.kind !== 'activity'} />
      {next.kind === 'activity' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={start.isPending || needsKey} onClick={() => start.mutate()}>
            {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}开始{ACTIVITY_LABEL[(view.next as { activity: { kind: string } }).activity.kind] ?? '学习'}
          </Button>
          {needsKey && <Link href="/settings" className="text-sm font-medium underline underline-offset-4">先在设置中填写模型 Key</Link>}
          <BlockError className="w-full" error={start.error} />
        </div>
      )}
    </div>
  );
}

/** 进行中的活动：课件或题组 */
function ActivityBody({ view, run, runView, runError, onRetry, progress, titles, margin, onOpen, onSelect, onDone }: {
  view: SessionView;
  run: NonNullable<SessionView['currentRun']>;
  runView?: RunView;
  runError: unknown;
  onRetry: () => void;
  progress?: ProgressView;
  titles: Record<string, string>;
  /** ≥1440 时旁注在右栏（助教打开时收起） */
  margin: boolean;
  onOpen: (target: SourceTarget) => void;
  onSelect: (selection: TutorSelection) => void;
  onDone: () => void;
}) {
  const sessionId = view.session.sessionId;
  const cursor = view.cursor?.runId === run.runId ? view.cursor : null;
  const cursorRevision = useRef(view.cursor?.revision ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 作答位置：1 秒防抖保存（只保存未提交的输入，不影响证据）
  const saveAnswers = (answers: Record<string, string>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const saved = await api<{ revision: number }>(`/sessions/${encodeURIComponent(sessionId)}/cursor`, { method: 'PATCH', body: { expectedRevision: cursorRevision.current, cursor: { runId: run.runId, answers } } });
        cursorRevision.current = saved.revision;
      } catch { /* 位置保存失败不打断作答 */ }
    }, 1000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const complete = useMutation({
    mutationFn: () => api<SessionView>(`/sessions/${encodeURIComponent(sessionId)}/lesson-completion`, { method: 'POST', body: { runId: run.runId, expectedRevision: view.session.revision }, key: newKey() }),
    onSuccess: onDone,
  });
  const isVisionPractice = run.purpose === 'vision_practice';
  const abandonPractice = useMutation({
    mutationFn: () => api<SessionView>(`/sessions/${encodeURIComponent(sessionId)}/abandon`, {
      method: 'POST',
      body: { runId: run.runId, expectedRevision: view.session.revision },
      key: newKey(),
    }),
    onSuccess: onDone,
  });

  if (runError) return <BlockError className="mt-6" error={runError} onRetry={onRetry} />;
  if (!runView) return <BlockLoading className="mt-6" lines={10} label="正在读取内容" />;

  if (run.activity.kind === 'lesson' && runView.content) {
    const { markdown, citations } = runView.content;
    const bySource = new Map<string, number>();
    for (const c of citations) bySource.set(c.sourceId, (bySource.get(c.sourceId) ?? 0) + 1);
    const sectionCount = attachCitations(markdown, []).blocks.filter(b => b.kind === 'heading' && /^##\s/.test(b.markdown)).length;
    return (
      <>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>课件 <b className="font-medium text-ink">{sectionCount}</b> 节 · <b className="font-medium text-ink">{formatCount(markdown.length)}</b> 字符</span>
          <span>出处 <b className="font-medium text-ink">{citations.length}</b> 处：{[...bySource].map(([id, n]) => `${isWebSource(id) ? sourceNoteLabel(titles[id], id) : '教材'} ${n}`).join(' · ')}</span>
        </p>
        <EvidenceBar points={run.activity.knowledgePointIds} progress={progress} view={view} />
        <div className="mt-8">
          <LessonArticle
            markdown={markdown}
            citations={citations}
            titles={titles}
            margin={margin}
            variant="learn"
            onOpen={onOpen}
            onSelectBlock={(block, text) => {
              const c = block.citations[0];
              if (c) onSelect({ sourceId: c.sourceId, chapterId: c.chapterId, paragraphIndex: c.paragraphIndex, text: text.slice(0, 2000) });
            }}
          />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <Button variant="primary" disabled={complete.isPending} onClick={() => complete.mutate()}>{complete.isPending && <Loader2 className="animate-spin" aria-hidden />}我读完了</Button>
          <span className="text-sm text-muted">读完只推进学习顺序，不算掌握；掌握要靠答题证明。</span>
          <BlockError className="w-full" error={complete.error} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <p>
          {isVisionPractice
            ? '截图变式练习 · 1 题（独立审校通过，用于巩固理解，不推进课程进度、不计入掌握证据）。'
            : `${ACTIVITY_LABEL[run.activity.kind]} · ${runView.questions.length} 题。题目由 Agent 出题并审校，答案在你提交后才显示。`}
        </p>
        {isVisionPractice && runView.status !== 'completed' && (
          <Button size="sm" variant="ghost" disabled={abandonPractice.isPending} onClick={() => abandonPractice.mutate()}>
            退出变式练习
          </Button>
        )}
      </div>
      {!isVisionPractice && <EvidenceBar points={run.activity.knowledgePointIds} progress={progress} view={view} />}
      <div className="mt-6 -mx-6 bg-ground px-6 py-5 max-md:-mx-4 max-md:px-4">
        <QuestionSet runId={run.runId} questions={runView.questions} savedAnswers={cursor?.answers} onAnswersChange={saveAnswers} onAnswered={onDone} />
      </div>
      {runView.status === 'completed' && (
        <p className="mt-5 text-base">
          {isVisionPractice ? '变式练习已完成判分（不改变课程进度）。' : '本组题已全部判分。'}
          <Link href={`/learn/${encodeURIComponent(sessionId)}`} className="ml-1 font-medium underline underline-offset-4" onClick={onDone}>
            {isVisionPractice ? '返回课程主线' : '继续下一步'}
          </Link>
        </p>
      )}
    </>
  );
}

/** 掌握证据条：本知识点最近 5 道计入证据的题（朱批勾叉），以及离掌握还差多少 */
function EvidenceBar({ points, progress, view }: { points: string[]; progress?: ProgressView; view: SessionView }) {
  const titleOf = (id: string) => outlinePoints(view.version.outline).find(p => p.knowledgePointId === id)?.title ?? id;
  if (!progress) return null;
  return (
    <section aria-label="本知识点掌握证据" className="mt-6 grid gap-2 rounded-[8px] bg-zhu-tint px-5 py-4">
      {points.map(id => {
        const recent = progress.recent?.[id] ?? [];
        const verified = progress.verifiedKnowledgePointIds.includes(id);
        const wrong = recent.filter(ok => !ok).length;
        return (
          <div key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {points.length > 1 && <span className="font-medium">{titleOf(id)}</span>}
            <span className="flex items-center gap-1" role="img" aria-label={`最近 ${recent.length} 题：${recent.map(ok => (ok ? '对' : '错')).join('、') || '还没有作答'}`}>
              {Array.from({ length: 5 }, (_, i) => <GradeMark key={i} kind={recent[i] === undefined ? 'pending' : recent[i] ? 'ok' : 'no'} />)}
            </span>
            <span className="text-sm text-ink-soft">
              {verified ? <strong className="font-bold text-ink">已验证掌握。</strong> : recent.length ? <strong className="font-bold text-ink">计入 {recent.length} 题，错 {wrong} 对 {recent.length - wrong}。</strong> : <strong className="font-bold text-ink">还没有计入证据的作答。</strong>}
              {' '}掌握标准：至少 3 道不同题，最近 5 题答对 80% 以上，且最近一题独立答对。
            </span>
          </div>
        );
      })}
    </section>
  );
}
