import { judgeAnswer } from '@/lib/agent/judge';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    questionId?: string;
    answer?: string;
  } | null;
  if (!body?.questionId || body.answer === undefined) {
    return Response.json({ error: '缺少参数：questionId / answer' }, { status: 400 });
  }
  try {
    const result = await judgeAnswer(body.questionId, body.answer);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : '判分失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
