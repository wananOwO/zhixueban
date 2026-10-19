import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { exportNoteToMarkdown, exportNoteToVault } from '@/lib/obsidian/sync';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const kpId = new URL(req.url).searchParams.get('kpId');
  if (!kpId) return Response.json({ error: '缺少 kpId' }, { status: 400 });
  const db = getDb();
  const notes = db
    .prepare('SELECT id, content_md AS contentMd, obsidian_path AS obsidianPath FROM notes WHERE knowledge_point_id = ?')
    .all(kpId);
  return Response.json({ notes });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    kpId?: string;
    contentMd?: string;
    export?: 'download' | 'vault';
    noteId?: string;
  } | null;

  // 导出操作
  if (body?.export && body.noteId) {
    if (body.export === 'download') {
      const md = exportNoteToMarkdown(body.noteId);
      return new Response(md, {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="note.md"' },
      });
    }
    const vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? '';
    const result = exportNoteToVault(body.noteId, vaultPath);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  }

  if (!body?.kpId || !body.contentMd?.trim()) {
    return Response.json({ error: '缺少参数：kpId / contentMd' }, { status: 400 });
  }
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO notes (id, knowledge_point_id, content_md) VALUES (?, ?, ?)').run(
    id,
    body.kpId,
    body.contentMd,
  );
  return Response.json({ id });
}
