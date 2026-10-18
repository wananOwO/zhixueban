import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { parseSourceRefs, streamLesson } from '@/lib/agent/lesson-writer';
import { MissingApiKeyError } from '@/lib/llm/provider';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kpId: string }> },
): Promise<Response> {
  const { kpId } = await params;
  const courseId = new URL(req.url).searchParams.get('courseId');
  if (!courseId) return Response.json({ error: '缺少 courseId' }, { status: 400 });

  const db = getDb();
  const course = db
    .prepare('SELECT textbook_id AS textbookId, goal_prompt AS goalPrompt, subject_type AS subjectType FROM courses WHERE id = ?')
    .get(courseId) as { textbookId: string; goalPrompt: string; subjectType: string } | undefined;
  if (!course) return Response.json({ error: '课程不存在' }, { status: 404 });

  const kp = db
    .prepare('SELECT title FROM knowledge_points WHERE id = ?')
    .get(kpId) as { title: string } | undefined;
  if (!kp) return Response.json({ error: '知识点不存在' }, { status: 404 });

  try {
    const result = await streamLesson({
      courseId,
      kpId,
      kpTitle: kp.title,
      textbookId: course.textbookId,
      subjectType: course.subjectType,
      goalPrompt: course.goalPrompt,
    });

    // 流完成后落库课件与来源引用（设计 §5.2：来源可追溯）
    void result.text.then((text) => {
      db.prepare(
        'INSERT OR REPLACE INTO lessons (id, course_id, knowledge_point_id, content_mdx, source_refs_json) VALUES (?, ?, ?, ?, ?)',
      ).run(randomUUID(), courseId, kpId, text, JSON.stringify(parseSourceRefs(text)));
    });

    return result.toTextStreamResponse();
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json({ error: '课件生成失败，请重试' }, { status: 500 });
  }
}
