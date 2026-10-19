import { switchMode } from '@/lib/agent/learn-flow';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { courseId?: string; mode?: number } | null;
  if (!body?.courseId || ![1, 2, 3].includes(body.mode ?? 0)) {
    return Response.json({ error: '缺少参数或模式非法' }, { status: 400 });
  }
  try {
    switchMode(body.courseId, body.mode as 1 | 2 | 3);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: '课程不存在' }, { status: 404 });
  }
}
