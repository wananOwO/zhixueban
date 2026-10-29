import { getDb } from '@/lib/db';
import { assertDemoWritable, DemoReadOnlyError, isDemoMode } from '@/lib/demo';
import { checkKeyDestination, getSettings } from '@/lib/llm/config';
import { modelConnection, settingsSchema } from '@/lib/settings';

export const runtime = 'nodejs';

function mask(value: string): string {
  return value ? (value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***') : '';
}

export async function GET(): Promise<Response> {
  const settings = getSettings();
  return Response.json({
    ...settings,
    llm_api_key: mask(settings.llm_api_key),
    embedding_api_key: mask(settings.embedding_api_key),
    readOnly: isDemoMode(),
    hasIndexedContent: !!getDb().prepare('SELECT 1 FROM chunks LIMIT 1').get(),
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function PUT(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) {
    return Response.json({ error: '请在本站设置页操作' }, { status: 403 });
  }
  try {
    assertDemoWritable();
  } catch (e) {
    if (e instanceof DemoReadOnlyError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
  const parsed = settingsSchema.partial().safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: `${issue.path.join('.') || '配置'}：${issue.message}` }, { status: 400 });
  }
  const body = parsed.data;
  const saved = getSettings();
  try {
    checkKeyDestination(saved, body, 'llm');
    checkKeyDestination(saved, body, 'embedding');
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }

  const db = getDb();
  const previous = modelConnection(saved, 'embedding');
  const next = modelConnection({ ...saved, ...body }, 'embedding');
  if (db.prepare('SELECT 1 FROM chunks LIMIT 1').get() &&
      (previous.modelId !== next.modelId || previous.baseURL !== next.baseURL)) {
    return Response.json({
      error: '已有教材索引，更换教材检索模型或地址需要重建索引。本轮请保留原检索配置；对话模型与密钥仍可修改。',
    }, { status: 409 });
  }
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  })();
  return Response.json({ ok: true, settings: await (await GET()).json() });
}
