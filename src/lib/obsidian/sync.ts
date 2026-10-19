import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { embedMany } from 'ai';
import { getDb } from '@/lib/db';
import { getEmbeddingModel } from '@/lib/llm/provider';
import { upsertChunks } from '@/lib/rag/store';
import { parseMarkdown } from '@/lib/textbook/parsers/markdown';
import { chunkChapterTree } from '@/lib/textbook/chunk';

export interface SyncResult {
  ok: boolean;
  degraded?: boolean;
  error?: string;
}

/**
 * 导入 Obsidian vault 打包（zip）为补充知识库：
 * 取其中 .md 文件，解析分块、embedding 入库，作为 RAG 补充数据源（设计 §5.6.1）。
 */
export async function importVaultArchive(zipBuf: Buffer): Promise<number> {
  const db = getDb();
  const zip = await JSZip.loadAsync(zipBuf);
  const mdFiles = Object.keys(zip.files).filter(
    (f) => f.endsWith('.md') && !zip.files[f].dir,
  );

  // vault 作为一个虚拟教材条目入库（source=obsidian）
  const vaultId = `vault-${randomUUID().slice(0, 8)}`;
  const tree = { title: 'Obsidian 补充知识库', format: 'md' as const, chapters: [] };
  db.prepare(
    "INSERT OR IGNORE INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES (?, ?, 'md', 'obsidian://vault', ?, ?)",
  ).run(vaultId, tree.title, JSON.stringify(tree), new Date().toISOString());

  const allChunks = [];
  for (const filePath of mdFiles) {
    const content = await zip.files[filePath].async('string');
    const parsed = parseMarkdown(content, path.basename(filePath, '.md'));
    for (const chunk of chunkChapterTree(parsed)) {
      allChunks.push({ ...chunk, id: `${vaultId}-${chunk.id}-${randomUUID().slice(0, 6)}` });
    }
  }

  if (allChunks.length > 0) {
    const { embeddings } = await embedMany({
      model: getEmbeddingModel(),
      values: allChunks.map((c) => c.content),
    });
    upsertChunks(db, vaultId, allChunks, embeddings);
  }
  return mdFiles.length;
}

/** 导出笔记为带 frontmatter 的 Markdown 字符串 */
export function exportNoteToMarkdown(noteId: string): string {
  const db = getDb();
  const note = db
    .prepare('SELECT knowledge_point_id AS kpId, content_md AS content FROM notes WHERE id = ?')
    .get(noteId) as { kpId: string; content: string } | undefined;
  if (!note) throw new Error('笔记不存在');

  return [
    '---',
    `knowledge_point: ${note.kpId}`,
    `exported_at: ${new Date().toISOString()}`,
    'source: 智学伴',
    '---',
    '',
    note.content,
    '',
  ].join('\n');
}

/**
 * 导出笔记到本地 vault 目录（仅本地部署可用；VPS 上路径无效时降级）。
 * 写入 {vaultPath}/智学伴/{知识点ID}.md。
 */
export function exportNoteToVault(noteId: string, vaultPath: string): SyncResult {
  let md: string;
  try {
    md = exportNoteToMarkdown(noteId);
  } catch (e) {
    return { ok: false, degraded: true, error: e instanceof Error ? e.message : '笔记不存在' };
  }
  try {
    if (!fs.existsSync(vaultPath)) {
      return { ok: false, degraded: true, error: 'Vault 路径无效或无访问权限' };
    }
    const outDir = path.join(vaultPath, '智学伴');
    fs.mkdirSync(outDir, { recursive: true });
    const db = getDb();
    const note = db
      .prepare('SELECT knowledge_point_id AS kpId FROM notes WHERE id = ?')
      .get(noteId) as { kpId: string };
    const outPath = path.join(outDir, `${note.kpId}.md`);
    fs.writeFileSync(outPath, md, 'utf-8');
    db.prepare('UPDATE notes SET obsidian_path = ? WHERE id = ?').run(outPath, noteId);
    return { ok: true };
  } catch (e) {
    return { ok: false, degraded: true, error: String(e) };
  }
}
