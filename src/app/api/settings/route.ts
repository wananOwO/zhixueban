import { getDb } from '@/lib/db';
import { assertDemoWritable, DemoReadOnlyError } from '@/lib/demo';

export const runtime = 'nodejs';

/** 敏感 key 不回传明文 */
const SENSITIVE_KEYS = new Set(['llm_api_key', 'embedding_api_key']);

const ALLOWED_KEYS = new Set([
  'llm_api_key',
  'embedding_api_key',
  'mcp_servers',
  'obsidian_vault_path',
  'judge0_url',
]);

function mask(value: string): string {
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***';
}

function parseOrRaw(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    out[r.key] = SENSITIVE_KEYS.has(r.key) ? mask(r.value) : parseOrRaw(r.value);
  }
  return Response.json(out);
}

export async function PUT(req: Request): Promise<Response> {
  try {
    assertDemoWritable();
  } catch (e) {
    if (e instanceof DemoReadOnlyError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });

  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return Response.json({ error: `不允许的设置项：${key}` }, { status: 400 });
    }
    upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return Response.json({ ok: true });
}
