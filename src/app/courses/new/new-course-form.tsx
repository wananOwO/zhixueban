'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import SetupNotice from '@/components/setup-notice';

const SUBJECTS = [
  { id: 'computer', name: '计算机类', desc: '重代码示例与上机练习' },
  { id: 'math', name: '数学类', desc: '定义-定理-证明链条' },
  { id: 'physics', name: '物理类', desc: '直觉类比 + 量纲检验' },
  { id: 'biology', name: '生物类', desc: '结构-功能对应 + 记忆框架' },
  { id: 'language', name: '语言类', desc: '例句渐进 + 对比' },
  { id: 'general', name: '通用', desc: '由浅入深的默认风格' },
];

const MODES = [
  { id: 1, name: '理论学习', desc: '章节讲解，学完出章末测验' },
  { id: 2, name: '边学边练', desc: '每个知识点配练习，做完再前进' },
  { id: 3, name: '刷题模式', desc: '不讲解直接练，最后综合大题' },
];

const STEPS = ['选择教材', '学科与目标', '模式与题量', '确认大纲'];

interface Textbook {
  id: string;
  title: string;
  format: string;
}

interface CourseResult {
  courseId: string;
  outline: { kpId: string; depth: string }[];
  gaps: string[];
  review: { kept: string[]; excluded: string[]; reorderReason: string; supplements: string[] };
}

export default function NewCourseForm({ initialTextbookId }: { initialTextbookId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [textbookId, setTextbookId] = useState(initialTextbookId);
  const [subjectType, setSubjectType] = useState('computer');
  const [customPrompt, setCustomPrompt] = useState('');
  const [goal, setGoal] = useState('');
  const [goalPrompt, setGoalPrompt] = useState('');
  const [mode, setMode] = useState(2);
  const [perKP, setPerKP] = useState(3);
  const [perChapter, setPerChapter] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CourseResult | null>(null);

  useEffect(() => {
    fetch('/api/textbooks')
      .then((r) => r.json())
      .then((b) => setTextbooks(b.textbooks ?? []))
      .catch(() => setError('教材列表加载失败'));
  }, []);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          textbookId,
          goal,
          goalPrompt: `${goalPrompt}\n${customPrompt}`.trim(),
          subjectType,
          mode,
          quizConfig: { perKnowledgePoint: perKP, perChapter },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? '生成失败');
        return;
      }
      setResult(body);
      setStep(3);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-bold">创建课程</h1>
      <SetupNotice />

      <ol aria-label="课程创建步骤" className="mb-10 flex gap-2">
        {STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? 'step' : undefined}
            className={`flex-1 rounded-md border px-3 py-2 text-center text-xs ${
              i === step
                ? 'border-accent text-accent'
                : i < step
                  ? 'border-success/40 text-success'
                  : 'border-border text-muted-foreground'
            }`}
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <fieldset>
          <legend className="mb-4 text-lg font-medium">选择一本教材</legend>
          {textbooks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              还没有教材，请先<Link href="/textbooks" className="text-accent underline">导入教材</Link>。
            </p>
          )}
          <div className="grid gap-3">
            {textbooks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTextbookId(t.id)}
                aria-pressed={textbookId === t.id}
                className={`flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  textbookId === t.id ? 'border-accent bg-muted' : 'border-border hover:bg-muted'
                }`}
              >
                <span>{t.title}</span>
                <span className="text-xs text-muted-foreground uppercase">{t.format}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <fieldset>
          <legend className="mb-4 text-lg font-medium">学科类型与学习目标</legend>
          <div className="mb-6 grid grid-cols-2 gap-3">
            {SUBJECTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubjectType(s.id)}
                aria-pressed={subjectType === s.id}
                className={`rounded-md border px-4 py-3 text-left transition-colors ${
                  subjectType === s.id ? 'border-accent bg-muted' : 'border-border hover:bg-muted'
                }`}
              >
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </button>
            ))}
          </div>
          <label className="mb-1 block text-sm font-medium" htmlFor="goal">
            学习目标
          </label>
          <input
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例：只学 Python 语法和算法，参加算法比赛"
            className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <label className="mb-1 block text-sm font-medium" htmlFor="goalPrompt">
            课程设计提示词（你的基础、教学偏好）
          </label>
          <textarea
            id="goalPrompt"
            value={goalPrompt}
            onChange={(e) => setGoalPrompt(e.target.value)}
            placeholder="例：我是完全不懂编程的小白，从零开始教我"
            rows={3}
            className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <label className="mb-1 block text-sm font-medium" htmlFor="customPrompt">
            自定义学科提示词（可选，追加到内置学科风格之后）
          </label>
          <textarea
            id="customPrompt"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </fieldset>
      )}

      {step === 2 && (
        <fieldset>
          <legend className="mb-4 text-lg font-medium">学习模式与题量</legend>
          <div className="mb-6 grid gap-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={`rounded-md border px-4 py-3 text-left transition-colors ${
                  mode === m.id ? 'border-accent bg-muted' : 'border-border hover:bg-muted'
                }`}
              >
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">
              每知识点题数
              <input
                type="number"
                min={1}
                max={10}
                value={perKP}
                onChange={(e) => setPerKP(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              章测题数
              <input
                type="number"
                min={1}
                max={30}
                value={perChapter}
                onChange={(e) => setPerChapter(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
        </fieldset>
      )}

      {step === 3 && result && (
        <section aria-label="大纲确认">
          <h2 className="mb-4 text-lg font-medium">大纲已生成，请确认</h2>
          {result.gaps.length > 0 && (
            <div role="alert" className="mb-4 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              <p className="mb-1 font-medium">教材缺口（目标要求但教材未覆盖）：</p>
              <ul className="list-inside list-disc">
                {result.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="mb-6 grid gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium text-success">保留（{result.review.kept.length}）</dt>
              <dd className="text-muted-foreground">{result.review.kept.join('、') || '—'}</dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium text-danger">跳过（{result.review.excluded.length}）</dt>
              <dd className="text-muted-foreground">{result.review.excluded.join('、') || '—'}</dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium">重排理由</dt>
              <dd className="text-muted-foreground">{result.review.reorderReason || '—'}</dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium">补充内容</dt>
              <dd className="text-muted-foreground">{result.review.supplements.join('、') || '—'}</dd>
            </div>
          </dl>
        </section>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 flex justify-between">
        <button
          type="button"
          disabled={step === 0 || loading}
          onClick={() => setStep((s) => s - 1)}
          className="rounded-md border border-border px-5 py-2 text-sm disabled:opacity-40"
        >
          上一步
        </button>
        {step < 2 && (
          <button
            type="button"
            disabled={(step === 0 && !textbookId) || (step === 1 && !goal.trim())}
            onClick={() => setStep((s) => s + 1)}
            className="rounded-md bg-foreground px-5 py-2 text-sm text-background disabled:opacity-40"
          >
            下一步
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void submit()}
            aria-busy={loading}
            className="flex items-center gap-2 rounded-md bg-foreground px-5 py-2 text-sm text-background disabled:opacity-40"
          >
            {loading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {loading ? 'Agent 正在生成课程…' : '生成课程'}
          </button>
        )}
        {step === 3 && result && (
          <button
            type="button"
            onClick={() => router.push(`/learn/${result.courseId}`)}
            className="flex items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm text-accent-foreground"
          >
            <CheckCircle2 aria-hidden className="h-4 w-4" />
            确认，开始学习
          </button>
        )}
      </div>
    </main>
  );
}
