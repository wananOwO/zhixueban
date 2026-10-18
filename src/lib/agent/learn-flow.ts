import { getDb } from '@/lib/db';

export type LearnStep =
  | { kind: 'diagnostic' }
  | { kind: 'lesson'; kpId: string }
  | { kind: 'quiz'; kpId: string }
  | { kind: 'chapterQuiz'; chapterId: string }
  | { kind: 'finalQuiz' }
  | { kind: 'done' };

interface OutlineNode {
  kpId: string;
  depth: string;
}

interface CourseRow {
  textbook_id: string;
  mode: number;
  outline_json: string;
}

function lessonDone(db: ReturnType<typeof getDb>, courseId: string, kpId: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM lessons WHERE course_id = ? AND knowledge_point_id = ? LIMIT 1')
    .get(courseId, kpId);
}

/** 某范围下被做过的题目数 ≥ 配置题数 即视为"做完"（做完≠达标，见设计 §5.3） */
function quizDone(
  db: ReturnType<typeof getDb>,
  courseId: string,
  scope: string,
  scopeId: string,
  required: number,
): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT q.id) AS n FROM questions q
       JOIN attempts a ON a.question_id = q.id
       WHERE q.course_id = ? AND q.scope = ? AND q.scope_id = ?`,
    )
    .get(courseId, scope, scopeId) as { n: number };
  return row.n >= required;
}

/** 三模式学习状态机：只读学习记录计算下一步，切换模式不丢记录 */
export function nextStep(courseId: string): LearnStep {
  const db = getDb();
  const course = db
    .prepare('SELECT textbook_id, mode, outline_json FROM courses WHERE id = ?')
    .get(courseId) as CourseRow | undefined;
  if (!course) throw new Error('课程不存在');

  const outline = JSON.parse(course.outline_json) as {
    nodes: OutlineNode[];
    quizConfig?: { perKnowledgePoint?: number; perChapter?: number; finalCount?: number };
  };
  const perKP = outline.quizConfig?.perKnowledgePoint ?? 3;
  const perChapter = outline.quizConfig?.perChapter ?? 10;
  const finalCount = outline.quizConfig?.finalCount ?? 10;

  const kpChapter = new Map(
    (
      db
        .prepare('SELECT id, chapter_ref FROM knowledge_points WHERE textbook_id = ?')
        .all(course.textbook_id) as { id: string; chapter_ref: string }[]
    ).map((r) => [r.id, r.chapter_ref]),
  );

  const chapters: string[] = [];
  for (const n of outline.nodes) {
    const ch = kpChapter.get(n.kpId) ?? 'unknown';
    if (!chapters.includes(ch)) chapters.push(ch);
  }

  if (course.mode === 3) {
    // 刷题：无记录先诊断 → 逐 KP 刷题 → 综合大题
    if (!quizDone(db, courseId, 'diagnostic', courseId, 1)) return { kind: 'diagnostic' };
    for (const n of outline.nodes) {
      if (!quizDone(db, courseId, 'knowledgePoint', n.kpId, perKP)) {
        return { kind: 'quiz', kpId: n.kpId };
      }
    }
    if (!quizDone(db, courseId, 'final', courseId, 1)) return { kind: 'finalQuiz' };
    return { kind: 'done' };
  }

  for (const chapterId of chapters) {
    const kps = outline.nodes.filter((n) => (kpChapter.get(n.kpId) ?? 'unknown') === chapterId);

    for (const n of kps) {
      if (!lessonDone(db, courseId, n.kpId)) return { kind: 'lesson', kpId: n.kpId };
      if (course.mode === 2 && !quizDone(db, courseId, 'knowledgePoint', n.kpId, perKP)) {
        return { kind: 'quiz', kpId: n.kpId };
      }
    }
    if (!quizDone(db, courseId, 'chapter', chapterId, perChapter)) {
      return { kind: 'chapterQuiz', chapterId };
    }
  }
  return { kind: 'done' };
}

/** 切换学习模式：只改 mode，学习记录（lessons/attempts/notes）全部保留 */
export function switchMode(courseId: string, mode: 1 | 2 | 3): void {
  const db = getDb();
  const info = db.prepare('UPDATE courses SET mode = ? WHERE id = ?').run(mode, courseId);
  if (info.changes === 0) throw new Error('课程不存在');
}
