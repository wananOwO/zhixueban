import { composeCourse } from '@/lib/agent/course-composer';
import { MissingApiKeyError } from '@/lib/llm/provider';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const { textbookId, goal, goalPrompt, subjectType, mode, quizConfig } = body as {
    textbookId?: string;
    goal?: string;
    goalPrompt?: string;
    subjectType?: string;
    mode?: number;
    quizConfig?: { perKnowledgePoint?: number; perChapter?: number; finalCount?: number; passThreshold?: number };
  };

  if (!textbookId) return Response.json({ error: '请选择教材' }, { status: 400 });
  if (!goal?.trim()) return Response.json({ error: '请填写学习目标' }, { status: 400 });
  if (![1, 2, 3].includes(mode ?? 0)) {
    return Response.json({ error: '学习模式必须是 1（理论学习）/2（边学边练）/3（刷题模式）' }, { status: 400 });
  }

  try {
    const course = await composeCourse({
      textbookId,
      goal: goal.trim(),
      goalPrompt: goalPrompt ?? '',
      subjectType: subjectType ?? 'general',
      mode: mode as 1 | 2 | 3,
      quizConfig,
    });
    return Response.json({
      courseId: course.id,
      outline: course.outline,
      gaps: course.gaps,
      review: course.review,
    });
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    const message = e instanceof Error ? e.message : '课程生成失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
