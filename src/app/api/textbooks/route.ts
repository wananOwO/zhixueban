import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { embedMany } from 'ai';
import { getDb } from '@/lib/db';
import { getEmbeddingModel, MissingApiKeyError } from '@/lib/llm/provider';
import { chunkChapterTree } from '@/lib/textbook/chunk';
import { parseTextbook } from '@/lib/textbook/parse';
import { upsertChunks } from '@/lib/rag/store';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const db = getDb();
  const textbooks = db
    .prepare('SELECT id, title, format, created_at AS createdAt FROM textbooks ORDER BY created_at DESC')
    .all();
  return Response.json({ textbooks });
}

const ALLOWED_EXT = new Set(['.txt', '.md', '.markdown', '.epub', '.pdf', '.docx', '.mobi', '.azw3']);

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: '请上传教材文件' }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return Response.json(
      { error: `不支持的教材格式 "${ext}"，支持：txt/md/epub/pdf/docx/mobi/azw3` },
      { status: 400 },
    );
  }

  const textbookId = randomUUID();
  const uploadDir = path.join(process.cwd(), 'data', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const savedPath = path.join(uploadDir, `${textbookId}${ext}`);
  fs.writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()));

  try {
    const tree = await parseTextbook(savedPath);
    const chunks = chunkChapterTree(tree);

    const db = getDb();
    db.prepare(
      'INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      textbookId,
      tree.title,
      tree.format,
      savedPath,
      JSON.stringify(tree),
      new Date().toISOString(),
    );

    if (chunks.length > 0) {
      const { embeddings } = await embedMany({
        model: getEmbeddingModel(),
        values: chunks.map((c) => c.content),
      });
      upsertChunks(db, textbookId, chunks, embeddings);
    }

    return Response.json({ textbookId, chapterCount: tree.chapters.length });
  } catch (e) {
    fs.rmSync(savedPath, { force: true });
    if (e instanceof MissingApiKeyError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    const message = e instanceof Error ? e.message : '解析失败';
    return Response.json({ error: message }, { status: 422 });
  }
}
