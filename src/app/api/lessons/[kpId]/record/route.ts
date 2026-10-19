import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

/** 读取已保存的课件记录（含来源引用与 Agent 活动） */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kpId: string }> },
): Promise<Response> {
  const { kpId } = await params;
  const courseId = new URL(_req.url).searchParams.get('courseId');
  const db = getDb();
  const lesson = db
    .prepare(
      'SELECT content_mdx AS content, source_refs_json AS sourceRefs, activity_json AS activity FROM lessons WHERE course_id = ? AND knowledge_point_id = ? ORDER BY rowid DESC LIMIT 1',
    )
    .get(courseId, kpId) as { content: string; sourceRefs: string; activity: string } | undefined;
  if (!lesson) return Response.json({ error: '课件不存在' }, { status: 404 });
  return Response.json({
    content: lesson.content,
    sourceRefs: JSON.parse(lesson.sourceRefs),
    activity: JSON.parse(lesson.activity),
  });
}
