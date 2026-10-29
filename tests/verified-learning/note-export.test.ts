import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning, VerifiedLearningStore } from '@/lib/verified-learning/store';
import { LibraryService } from '@/lib/verified-learning/library';
import { StudyService } from '@/lib/verified-learning/study';
import { RecordService } from '@/lib/verified-learning/records';
import { noteFileName, renderNoteMarkdown } from '@/lib/verified-learning/note-export';
import type { LearningModel } from '@/lib/verified-learning/backend-contracts';
import { openTestDb, testDirectory } from './db-fixtures';

/** 一门只有一个知识点的课程，直接建版本（不经生成）；课程标题来自确认它的草稿 */
async function setup(options: { draftTitle?: string } = { draftTitle: 'Python: 入门/基础' }) {
  const db = openTestDb();
  await migrateVerifiedLearning(db);
  const library = new LibraryService(db, testDirectory());
  const book = await library.importFile('a', 'b', new File(['# 第一章\n变量用于保存数据。'], 'python.md'));
  const version = new VerifiedLearningStore(db).createVersion('a', {
    textbookId: book.bookId, goal: '学会变量',
    outline: [{ moduleId: 'm', title: '第一章', points: [
      { knowledgePointId: 'variables', title: '变量与 赋值?', role: 'target', prerequisiteIds: [], sourceIds: [book.bookId], coverage: 'covered', reason: '' },
    ] }],
  });
  if (options.draftTitle) {
    db.prepare("INSERT INTO vl_drafts(scope_id,draft_id,input_json,state,created_at,updated_at,version_id,confirmed_json) VALUES ('a','d1',?,'confirmed',?,?,?,?)")
      .run(JSON.stringify({ title: options.draftTitle }), new Date().toISOString(), new Date().toISOString(), version.courseVersionId, JSON.stringify({ courseId: version.courseId, versionId: version.courseVersionId, sessionId: 's' }));
  }
  const records = new RecordService(db, new StudyService(db, library, {} as LearningModel));
  const note = records.saveNote('a', 'n', { versionId: version.courseVersionId, knowledgePointId: 'variables', content: '变量名区分大小写。' });
  return { db, records, note, version };
}

describe('笔记导出为 Markdown', () => {
  it('带 frontmatter：课程、知识点、导出时间、来源；正文原样保留', async () => {
    const { records, note } = await setup();
    const md = records.exportNote('a', note.noteId, new Date('2026-10-30T08:00:00.000Z'));
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('course: "Python: 入门/基础"');
    expect(md).toContain('knowledge_point: "变量与 赋值?"');
    expect(md).toContain('exported_at: 2026-10-30T08:00:00.000Z');
    expect(md).toContain('source: 智学伴');
    expect(md.trimEnd().endsWith('变量名区分大小写。')).toBe(true);
  });

  it('没有草稿标题时课程名用学习目标', async () => {
    const { records, note } = await setup({});
    expect(records.exportNote('a', note.noteId)).toContain('course: "学会变量"');
  });

  it('frontmatter 中的引号、换行被转义，不能注入额外字段', () => {
    const md = renderNoteMarkdown({ course: 'a"\nevil: true', point: 'p', content: 'x', exportedAt: '2026-10-30T00:00:00.000Z' });
    const header = md.split('---')[1];
    expect(header).not.toMatch(/^evil:/m);
    expect(header).toContain('course: "a\\"\\nevil: true"');
  });

  it('文件名去掉路径分隔符与 Windows 非法字符，不能越出目录', () => {
    expect(noteFileName('变量与 赋值?')).toBe('变量与 赋值_.md');
    expect(noteFileName('../../etc/passwd')).not.toMatch(/[\\/]/);
    expect(noteFileName('CON')).toBe('_CON.md');
    expect(noteFileName('   ')).toBe('笔记.md');
    expect(noteFileName('a'.repeat(300)).length).toBeLessThanOrEqual(124);
  });
});

describe('笔记写入本地 Obsidian vault', () => {
  it('写到 <vault>/智学伴/<课程>/<知识点>.md，重复写入覆盖同一文件', async () => {
    const { records, note } = await setup();
    const vault = mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    const first = records.writeNoteToVault('a', note.noteId, vault);
    expect(first.path).toBe(path.join(vault, '智学伴', 'Python_ 入门_基础', '变量与 赋值_.md'));
    expect(readFileSync(first.path, 'utf8')).toContain('变量名区分大小写。');
    records.writeNoteToVault('a', note.noteId, vault);
    expect(readdirSync(path.dirname(first.path))).toHaveLength(1);
  });

  it('vault 路径不存在、不是目录或为相对路径时明确报错，不创建目录', async () => {
    const { records, note } = await setup();
    const missing = path.join(os.tmpdir(), `no-vault-${Date.now()}`);
    expect(() => records.writeNoteToVault('a', note.noteId, missing)).toThrow(/Obsidian vault 路径不存在/);
    expect(existsSync(missing)).toBe(false);
    expect(() => records.writeNoteToVault('a', note.noteId, 'relative/vault')).toThrow(/绝对路径/);
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'vault-file-')), 'x.md');
    writeFileSync(file, '');
    expect(() => records.writeNoteToVault('a', note.noteId, file)).toThrow(/不是文件夹/);
  });

  it('不能写其他空间的笔记', async () => {
    const { records, note } = await setup();
    const vault = mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    expect(() => records.writeNoteToVault('b', note.noteId, vault)).toThrow(/笔记不存在/);
  });
});
