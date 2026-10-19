import { beforeEach, describe, expect, test, vi } from 'vitest';
import JSZip from 'jszip';

vi.mock('@/lib/llm/provider', () => ({ getEmbeddingModel: () => ({ modelId: 'fake' }) }));
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    embedMany: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [1, 0, 0, 0]),
    }),
  };
});

import { exportNoteToMarkdown, exportNoteToVault, importVaultArchive } from '@/lib/obsidian/sync';
import { getDb, resetDbForTest } from '@/lib/db';

describe('importVaultArchive', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('zip 中的 md 文件导入后分块可检索', async () => {
    const zip = new JSZip();
    zip.file('笔记/递归.md', '# 递归\n函数调用自身。');
    zip.file('图片.png', Buffer.from([0])); // 非 md 应跳过
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const count = await importVaultArchive(buf);
    expect(count).toBe(1);

    const db = getDb(':memory:');
    const chunks = db.prepare('SELECT content FROM chunks').all() as { content: string }[];
    expect(chunks.map((c) => c.content).join()).toContain('递归');
  });
});

describe('笔记导出', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    db.prepare(
      "INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref) VALUES ('kp1','tb1','递归','ch1')",
    ).run();
    db.prepare(
      "INSERT INTO notes (id, knowledge_point_id, content_md) VALUES ('n1','kp1','递归的核心是**基例**与**递推**。')",
    ).run();
  });

  test('导出 Markdown 含 frontmatter 与正文', () => {
    const md = exportNoteToMarkdown('n1');
    expect(md).toContain('递归的核心');
    expect(md).toMatch(/^---/);
    expect(md).toContain('kp1');
  });

  test('vault 路径无效时降级，不抛异常（Review Focus #5）', () => {
    const result = exportNoteToVault('n1', 'Z:\\不存在的\\路径\\vault');
    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
  });

  test('vault 路径有效时写入文件', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    const result = exportNoteToVault('n1', dir);
    expect(result.ok).toBe(true);
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
  });
});
