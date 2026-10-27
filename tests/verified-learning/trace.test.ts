import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { JobStore } from '@/lib/verified-learning/jobs';
import { buildTrace } from '@/lib/verified-learning/trace';
import { ownTestDb } from './db-fixtures';

const BOOK = 'book-1';
const call = (id: string, name: string, args: unknown) => ({ role: 'assistant', stopReason: 'toolUse', timestamp: 1000, content: [{ type: 'toolCall', id, name, arguments: args }] });
const result = (id: string, name: string, payload: unknown, isError = false, timestamp = 2000) => ({
  role: 'toolResult', toolCallId: id, toolName: name, isError, timestamp,
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
});

async function setup() {
  const db = ownTestDb(new Database(':memory:'));
  await migrateVerifiedLearning(db);
  const job = new JobStore(db).create('s', 'lesson', 'k', {});
  db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('s',?,'owned','ready','t')").run(BOOK);
  const snapshot = { sourceId: BOOK, sourceRevision: 'r1', title: 'Python编程：从入门到实践', format: 'epub', chapters: [{ chapterId: 'ch1', title: '全书', paragraphs: Array.from({ length: 4049 }, (_, i) => ({ paragraphIndex: i, text: 't', contentHash: 'h' })) }] };
  db.prepare("INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('s',?,'r1',?,'t')").run(BOOK, JSON.stringify(snapshot));
  const messages = [
    { role: 'system', content: '系统提示：不得泄露', timestamp: 1 },
    { role: 'user', content: [{ type: 'text', text: '生成课件' }], timestamp: 2 },
    call('c1', 'search_sources', { query: 'print 函数' }),
    result('c1', 'search_sources', { total: 2, matches: [{ sourceId: BOOK, paragraphIndex: 761, text: '原文正文不应出现' }] }),
    call('c2', 'read_source', { sourceId: BOOK, chapterId: 'ch1', offset: 680, limit: 20 }),
    result('c2', 'read_source', { sourceId: BOOK, chapterId: 'ch1', paragraphs: [{ paragraphIndex: 680, text: '原文' }, { paragraphIndex: 699, text: '原文' }], nextOffset: 700 }),
    call('c3', 'submit_lesson_section', { sectionId: 's1', markdown: '## 课件正文不应出现', citations: [{ sourceId: BOOK, sourceRevision: 'r1', chapterId: 'ch1', paragraphIndex: 761, quote: '引文不应出现' }] }),
    result('c3', 'submit_lesson_section', '引用 book-1/ch1/761 不通过：QUOTE_MISMATCH。请用read_source读取原文后修正quote，不要编造。', true),
    call('c4', 'submit_question', { index: 1, question: { type: 'choice', stem: '题干不应出现', options: ['A'], answer: '答案不应出现', explanation: '解析不应出现', referenceCode: 'print(1)', tests: [{ stdin: '', expectedStdout: '隐藏用例不应出现' }], targetIds: ['p'], dependencyIds: [], citations: [] } }),
    result('c4', 'submit_question', { accepted: true }),
    { role: 'assistant', stopReason: 'stop', timestamp: 3000, content: [{ type: 'text', text: '模型文字输出不应出现' }] },
  ];
  db.prepare('INSERT INTO vl_agent_states(scope_id,job_id,stage_id,messages_json,artifacts_json,requests,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('s', job.jobId, 'lesson', JSON.stringify(messages), '{}', 5, 't');
  return { db, jobId: job.jobId };
}

describe('Agent 执行轨迹', () => {
  it('提取工具调用：读取区间、搜索词、引用段号、校验错误', async () => {
    const { db, jobId } = await setup();
    const trace = buildTrace(db, 's', jobId);
    expect(trace.stages).toHaveLength(1);
    const [stage] = trace.stages;
    expect(stage.requests).toBe(5);
    expect(stage.steps.map(s => s.tool)).toEqual(['search_sources', 'read_source', 'submit_lesson_section', 'submit_question']);
    expect(stage.steps[0]).toMatchObject({ label: '搜索资料', search: 'print 函数', ok: true });
    expect(stage.steps[1]).toMatchObject({ label: '读取原文', ok: true, read: { sourceId: BOOK, chapterId: 'ch1', from: 680, to: 699 } });
    expect(stage.steps[2]).toMatchObject({ ok: false, section: 's1', cites: [{ sourceId: BOOK, paragraphIndex: 761 }] });
    expect(stage.steps[2].error).toBe('引文与原文不一致，Agent 重新读取原文修正');
    expect(stage.steps[3]).toMatchObject({ question: 1, ok: true });
    expect(trace.sources).toEqual([{ sourceId: BOOK, title: 'Python编程：从入门到实践', paragraphs: 4049 }]);
  });

  it('脱敏：不含提示词、正文、引文、题目内容、答案、解析、参考解与隐藏用例', async () => {
    const { db, jobId } = await setup();
    const text = JSON.stringify(buildTrace(db, 's', jobId));
    for (const leaked of ['系统提示', '原文正文', '课件正文', '引文不应出现', '题干', '答案', '解析', 'print(1)', '隐藏用例', '模型文字输出', 'referenceCode', 'explanation', 'markdown', 'quote']) {
      expect(text, leaked).not.toContain(leaked);
    }
  });

  it('其他空间不能读取轨迹', async () => {
    const { db, jobId } = await setup();
    expect(() => buildTrace(db, 'other', jobId)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
