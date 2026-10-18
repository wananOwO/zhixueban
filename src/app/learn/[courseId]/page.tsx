import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { nextStep } from '@/lib/agent/learn-flow';
import LessonView from '@/components/lesson-view';
import QuizPanel from '@/components/quiz-panel';
import LearnShell from './learn-shell';

export const dynamic = 'force-dynamic';

export default async function LearnPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const db = getDb();
  const course = db
    .prepare(
      `SELECT c.goal, c.mode, c.outline_json, t.title AS textbookTitle
       FROM courses c JOIN textbooks t ON t.id = c.textbook_id WHERE c.id = ?`,
    )
    .get(courseId) as
    | { goal: string; mode: number; outline_json: string; textbookTitle: string }
    | undefined;
  if (!course) notFound();

  const outline = JSON.parse(course.outline_json) as {
    nodes: { kpId: string; depth: string }[];
    quizConfig?: { perKnowledgePoint?: number; perChapter?: number; finalCount?: number };
  };
  const quizConfig = outline.quizConfig ?? {};
  const step = nextStep(courseId);

  const kpTitles = new Map(
    (
      db
        .prepare(
          `SELECT id, title FROM knowledge_points WHERE textbook_id = (SELECT textbook_id FROM courses WHERE id = ?)`,
        )
        .all(courseId) as { id: string; title: string }[]
    ).map((r) => [r.id, r.title]),
  );

  return (
    <LearnShell
      courseId={courseId}
      goal={course.goal}
      mode={course.mode}
      textbookTitle={course.textbookTitle}
      outline={outline.nodes.map((n) => ({ kpId: n.kpId, title: kpTitles.get(n.kpId) ?? n.kpId }))}
    >
      {step.kind === 'lesson' && (
        <section aria-label="课件">
          <h2 className="mb-4 text-xl font-semibold">{kpTitles.get(step.kpId)}</h2>
          <LessonView courseId={courseId} kpId={step.kpId} />
        </section>
      )}
      {step.kind === 'quiz' && (
        <section aria-label="知识点练习">
          <h2 className="mb-4 text-xl font-semibold">
            练习：{kpTitles.get(step.kpId)}
          </h2>
          <QuizPanel
            courseId={courseId}
            scope="knowledgePoint"
            scopeId={step.kpId}
            count={quizConfig.perKnowledgePoint ?? 3}
            onAllDone={() => {}}
          />
        </section>
      )}
      {step.kind === 'chapterQuiz' && (
        <section aria-label="章节测验">
          <h2 className="mb-4 text-xl font-semibold">章节测验</h2>
          <QuizPanel
            courseId={courseId}
            scope="chapter"
            scopeId={step.chapterId}
            count={quizConfig.perChapter ?? 10}
            onAllDone={() => {}}
          />
        </section>
      )}
      {step.kind === 'diagnostic' && (
        <section aria-label="摸底诊断">
          <h2 className="mb-4 text-xl font-semibold">摸底诊断</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            刷题模式下，先用几道快速题确认你的基础，以便出合适的题。
          </p>
          <QuizPanel
            courseId={courseId}
            scope="diagnostic"
            scopeId={courseId}
            count={5}
            onAllDone={() => {}}
          />
        </section>
      )}
      {step.kind === 'finalQuiz' && (
        <section aria-label="综合大题">
          <h2 className="mb-4 text-xl font-semibold">综合大题</h2>
          <QuizPanel
            courseId={courseId}
            scope="final"
            scopeId={courseId}
            count={quizConfig.finalCount ?? 10}
            onAllDone={() => {}}
          />
        </section>
      )}
      {step.kind === 'done' && (
        <section aria-label="完成" className="rounded-lg border border-success/40 bg-success/5 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-success">课程全部完成 🎉</h2>
          <p className="text-sm text-muted-foreground">去「学习画像」查看掌握度热力图与知识图谱。</p>
        </section>
      )}
    </LearnShell>
  );
}
