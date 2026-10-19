import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { assertDemoWritable, DemoReadOnlyError } from '@/lib/demo';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const db = getDb();
  const templates = db
    .prepare('SELECT id, subject_type AS subjectType, name, content_md AS contentMd FROM prompt_templates ORDER BY rowid')
    .all();
  return Response.json({ templates });
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertDemoWritable();
  } catch (e) {
    if (e instanceof DemoReadOnlyError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    contentMd?: string;
    subjectType?: string;
    import?: string;
  } | null;

  // 导入 .md（含 frontmatter）
  if (body?.import) {
    const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(body.import);
    const nameMatch = fm?.[1].match(/name:\s*(.+)/);
    const name = nameMatch?.[1].trim() || '导入的提示词';
    const contentMd = (fm?.[2] ?? body.import).trim();
    const id = randomUUID();
    getDb()
      .prepare('INSERT INTO prompt_templates (id, name, content_md) VALUES (?, ?, ?)')
      .run(id, name, contentMd);
    return Response.json({ id });
  }

  if (!body?.name?.trim() || !body.contentMd?.trim()) {
    return Response.json({ error: '缺少参数：name / contentMd' }, { status: 400 });
  }
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO prompt_templates (id, subject_type, name, content_md) VALUES (?, ?, ?, ?)')
    .run(id, body.subjectType ?? null, body.name.trim(), body.contentMd.trim());
  return Response.json({ id });
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    assertDemoWritable();
  } catch (e) {
    if (e instanceof DemoReadOnlyError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: '缺少 id' }, { status: 400 });
  const info = getDb().prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  if (info.changes === 0) return Response.json({ error: '模板不存在' }, { status: 404 });
  return Response.json({ ok: true });
}
