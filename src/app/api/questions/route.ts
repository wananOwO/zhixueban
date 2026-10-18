import { generateQuestions } from '@/lib/agent/question-gen';
import { getDb } from '@/lib/db';
import { MissingApiKeyError } from '@/lib/llm/provider';

export const runtime = 'nodejs';

/** 已解锁知识点 = 状态非 locked 的知识点；章节集合由其 chapter_ref 推出 */
function getUnlocked(textbookId: string): { kpIds: string[]; chapterIds: string[] } {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, chapter_ref FROM knowledge_points WHERE textbook_id = ? AND status != 'locked'")
    .all(textbookId) as { id: string; chapter_ref: string }[];
  return {
    kpIds: rows.map((r) => r.id),
    chapterIds: [...new Set(rows.map((r) => r.chapter_ref))],
  };
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    courseId?: string;
    scope?: 'knowledgePoint' | 'chapter' | 'course';
    scopeId?: string;
    count?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
  } | null;

  if (!body?.courseId || !body.scope || !body.scopeId || !body.count) {
    return Response.json(
      { error: '缺少参数：courseId / scope / scopeId / count' },
      { status: 400 },
    );
  }

  const db = getDb();
  const course = db
    .prepare('SELECT textbook_id AS textbookId FROM courses WHERE id = ?')
    .get(body.courseId) as { textbookId: string } | undefined;
  if (!course) return Response.json({ error: '课程不存在' }, { status: 404 });

  const unlocked = getUnlocked(course.textbookId);
  try {
    const questions = await generateQuestions({
      courseId: body.courseId,
      scope: body.scope,
      scopeId: body.scopeId,
      count: Math.min(body.count, 30),
      difficulty: body.difficulty ?? 'easy',
      unlockedKPIds: unlocked.kpIds,
      unlockedChapterIds: unlocked.chapterIds,
    });
    return Response.json({ questions });
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json({ error: '出题失败，请重试' }, { status: 500 });
  }
}
