import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/store';
import { LibraryService } from '@/lib/verified-learning/library';
import { CourseService } from '@/lib/verified-learning/courses';
import { StudyService } from '@/lib/verified-learning/study';
import { RecordService } from '@/lib/verified-learning/records';
import { buildTrace } from '@/lib/verified-learning/trace';
import { exportSample, seedFromEnv, seedSample } from '@/lib/verified-learning/sample-course';
import type { LearningModel } from '@/lib/verified-learning/backend-contracts';
import { openTestDb, testDirectory } from './db-fixtures';

const SPACE = 'S'.repeat(43);
const OTHER = 'T'.repeat(43);

/** 在空间 template 里用 faux 模型走完：教材 → 草稿 → 方案 → 确认 → 课件（读完）→ 题组（作答） */
async function template() {
  const db = openTestDb();
  await migrateVerifiedLearning(db);
  const library = new LibraryService(db, testDirectory());
  const book = await library.importFile('template', 'book', new File(['# 基础\n\n变量用于保存数据。\n\n赋值语句把值绑定到名字上。'], 'intro.md'));
  const source = library.source('template', book.bookId);
  const [p0, p1] = source.chapters[0].paragraphs;
  const cite = (p: typeof p0) => ({ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterId: source.chapters[0].chapterId, paragraphIndex: p.paragraphIndex, quote: p.text });
  const proposal = { points: [{ id: 'variables', title: '变量', prerequisiteIds: [], relatedIds: [], citations: [cite(p0)] }], targetIds: ['variables'], declaredIds: [] };
  const model: LearningModel = {
    propose: async () => proposal,
    lesson: async () => ({ markdown: '## 变量\n\n变量用于保存数据，赋值语句把值绑定到名字上。', citations: [cite(p0), cite(p1)] }),
    questions: async () => [
      { type: 'choice' as const, stem: '变量的作用？', options: ['保存数据', '删除程序'], answer: '保存数据', explanation: '变量保存数据。', targetIds: ['variables'], dependencyIds: ['variables'], citations: [cite(p0)] },
      { type: 'fill' as const, stem: '把值绑定到名字上的语句叫什么？', answer: '赋值语句', explanation: '见第二段。', targetIds: ['variables'], dependencyIds: ['variables'], citations: [cite(p1)] },
    ],
    review: async () => ({ ok: true, usedKnowledgeIds: ['variables'], answerConsistent: true, reason: '范围内' }),
  };
  const courses = new CourseService(db, library, model);
  const draft = courses.create('template', 'draft', { title: '变量入门', textbookId: book.bookId, sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: source.chapters.map(c => c.chapterId) }], goal: '学会变量', assessment: { pointQuestionCount: 2, chapterQuestionCount: 1 }, mode: 'practice' });
  const job = courses.generate('template', draft.draftId, 0, 'gen');
  await courses.runGeneration('template', job.jobId);
  const confirmed = courses.confirm('template', draft.draftId, courses.get('template', draft.draftId).revision, 'confirm', true);
  const study = new StudyService(db, library, model);
  // 给方案任务写一条 Agent 轨迹（真实生成会由 Agent 会话记录写入）
  db.prepare('INSERT INTO vl_agent_states(scope_id,job_id,stage_id,messages_json,artifacts_json,requests,updated_at) VALUES (?,?,?,?,?,?,?)').run('template', job.jobId, 'curriculum', JSON.stringify([
    { role: 'system', content: '系统提示：不应被导出' },
    { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: '模型的思考文字：不应被导出' }, { type: 'toolCall', id: 'c1', name: 'read_source', arguments: { sourceId: book.bookId, chapterId: source.chapters[0].chapterId, offset: 0, limit: 2 } }] },
    { role: 'toolResult', toolCallId: 'c1', timestamp: 2, content: [{ type: 'text', text: JSON.stringify({ paragraphs: [{ paragraphIndex: p0.paragraphIndex, text: p0.text }] }) }] },
    { role: 'assistant', timestamp: 3, content: [{ type: 'toolCall', id: 'c2', name: 'submit_curriculum_point', arguments: { id: 'variables', title: '变量', citations: [{ sourceId: book.bookId, paragraphIndex: p0.paragraphIndex, quote: '模型提交的引文：不应被导出' }] } }] },
    { role: 'toolResult', toolCallId: 'c2', timestamp: 4, isError: true, content: [{ type: 'text', text: 'QUOTE_MISMATCH 工具反馈原文：不应被导出' }] },
  ]), JSON.stringify({ secret: '中间产物' }), 3, 't');
  let view = study.get('template', confirmed.sessionId);
  const lesson = study.start('template', confirmed.sessionId, view.session.revision, 'start');
  await study.runContent('template', lesson.job!.jobId);
  view = study.get('template', confirmed.sessionId);
  study.completeLesson('template', confirmed.sessionId, lesson.run.runId, view.session.revision, 'read');
  view = study.get('template', confirmed.sessionId);
  const quiz = study.start('template', confirmed.sessionId, view.session.revision, 'quiz');
  await study.runContent('template', quiz.job!.jobId);
  const question = study.runView('template', quiz.run.runId).questions[0];
  await study.submit('template', quiz.run.runId, question.questionId, 'answer', '保存数据');
  study.hint('template', quiz.run.runId, question.questionId, 1);
  new RecordService(db, study).saveNote('template', 'note', { versionId: confirmed.versionId, knowledgePointId: 'variables', content: '模板空间的私人笔记' });
  return { db, library, study, model, confirmed, planJob: job.jobId, lessonRun: lesson.run.runId, quizRun: quiz.run.runId };
}

describe('示例课程：从模板空间导出，种入新空间', () => {
  it('导出包只含课程内容与脱敏轨迹，不含作答、提示、笔记、任务输入、会话原文', async () => {
    const t = await template();
    const bundle = exportSample(t.db, 'template', t.confirmed.courseId);
    const text = JSON.stringify(bundle);
    expect(bundle.version).toBe(1);
    expect(text).not.toContain('模板空间的私人笔记');
    expect(text).not.toContain('系统提示');
    expect(text).not.toContain('模型的思考文字');
    expect(text).not.toContain('中间产物');
    expect(text).not.toContain('模型提交的引文');
    expect(text).not.toContain('工具反馈原文');
    expect(Object.keys(bundle.tables).filter(k => ['vl_attempts', 'vl_hint_events', 'vl_notes', 'vl_requests', 'vl_learning_events'].includes(k))).toEqual([]);
    for (const row of bundle.tables.vl_jobs) expect(row.input_json).toBe('{}');
    // 课件是当前活动（未读），题组已生成但未开始
    expect(bundle.tables.vl_activity_runs.map(r => r.status).sort()).toEqual(['prepared', 'ready']);
  });

  it('种入后生成过程的轨迹与模板空间完全一致（含自动修正的类别说明）', async () => {
    const t = await template();
    seedSample(t.db, SPACE, exportSample(t.db, 'template', t.confirmed.courseId));
    const before = buildTrace(t.db, 'template', t.planJob);
    expect(before.stages[0].steps.map(s => [s.tool, s.ok, s.error])).toEqual([['read_source', true, undefined], ['submit_curriculum_point', false, '引文与原文不一致，Agent 重新读取原文修正']]);
    expect(buildTrace(t.db, SPACE, t.planJob)).toEqual(before);
  });

  it('种入后新空间有 1 门课，课件与引用一致，轨迹可读，题目可作答且判分', async () => {
    const t = await template();
    const bundle = exportSample(t.db, 'template', t.confirmed.courseId);
    seedSample(t.db, SPACE, bundle);
    const courses = new CourseService(t.db, t.library, t.model);
    const list = courses.courses(SPACE) as { courseId: string; sessionId?: string; versionId: string }[];
    expect(list).toHaveLength(1);
    const sessionId = list[0].sessionId!;
    // 会话回到课件：可以直接阅读，不需要模型
    const view = t.study.get(SPACE, sessionId);
    expect(view.currentRun?.runId).toBe(t.lessonRun);
    expect(view.session.completedActivityIds).toEqual([]);
    const lesson = t.study.runView(SPACE, t.lessonRun);
    expect(lesson.content).toEqual(t.study.runView('template', t.lessonRun).content);
    // 原文可回查
    const cite = lesson.content!.citations[0];
    expect(t.library.source(SPACE, cite.sourceId, cite.sourceRevision).chapters[0].paragraphs.some(p => p.text === cite.quote)).toBe(true);
    // 生成过程回放：轨迹工具调用保留
    const trace = buildTrace(t.db, SPACE, t.planJob);
    expect(trace.stages[0].steps.map(s => s.tool)).toEqual(['read_source', 'submit_curriculum_point']);
    expect(trace.sources.map(s => s.sourceId)).toEqual([cite.sourceId]);
    // 历史里只有已开始的活动；题组未开始，不出现
    expect((t.study.history(SPACE, sessionId) as unknown as { runId: string }[]).map(r => r.runId)).toEqual([t.lessonRun]);
    // 读完课件进入题组：题组已生成，开始时不新建任务，也就不需要模型 Key
    t.study.completeLesson(SPACE, sessionId, t.lessonRun, view.session.revision, 'read');
    const next = t.study.get(SPACE, sessionId);
    expect(next.currentRun).toBeNull();
    // 下一活动的内容已生成：前端据此在没有 Key 时也允许开始
    expect(next.nextPrepared).toBe(true);
    const quiz = t.study.start(SPACE, sessionId, next.session.revision, 'start-quiz');
    expect(quiz.run.runId).toBe(t.quizRun);
    expect(quiz.job).toBeNull();
    const question = t.study.runView(SPACE, t.quizRun).questions[0];
    expect(question.attempt).toBeNull();
    const result = await t.study.submit(SPACE, t.quizRun, question.questionId, 'k', '保存数据');
    expect(result.result?.correct).toBe(true);
    // 模板空间的作答不受影响
    expect(t.db.prepare('SELECT count(*) AS n FROM vl_attempts WHERE scope_id=?').get('template')).toEqual({ n: 1 });
  });

  it('同一空间重复种入不重复；两个空间互不影响；sample_seeded 置 1', async () => {
    const t = await template();
    const bundle = exportSample(t.db, 'template', t.confirmed.courseId);
    t.db.prepare('INSERT INTO vl_spaces(space_id,created_at,last_seen_at) VALUES (?,?,?)').run(SPACE, 't', 't');
    seedSample(t.db, SPACE, bundle);
    seedSample(t.db, SPACE, bundle);
    seedSample(t.db, OTHER, bundle);
    const count = (scope: string) => (t.db.prepare('SELECT count(*) AS n FROM vl_course_versions WHERE scope_id=?').get(scope) as { n: number }).n;
    expect(count(SPACE)).toBe(count('template'));
    expect(count(OTHER)).toBe(count('template'));
    expect(t.db.prepare('SELECT sample_seeded FROM vl_spaces WHERE space_id=?').get(SPACE)).toEqual({ sample_seeded: 1 });
    // 在 SPACE 作答不影响 OTHER
    const sessionId = (new CourseService(t.db, t.library, t.model).courses(SPACE) as { sessionId?: string }[])[0].sessionId!;
    const view = t.study.get(SPACE, sessionId);
    t.study.completeLesson(SPACE, sessionId, t.lessonRun, view.session.revision, 'read');
    expect(t.study.get(OTHER, sessionId).session.completedActivityIds).toEqual([]);
  });

  it('种入时不携带派生检索数据，也不新建索引任务', async () => {
    const t = await template();
    const snapshot = JSON.parse((t.db.prepare('SELECT snapshot_json FROM vl_course_versions WHERE scope_id=? AND version_id=?').get('template', t.confirmed.versionId) as { snapshot_json: string }).snapshot_json) as { sourceRevisions: { sourceId: string; sourceRevision: string }[] };
    const { sourceId, sourceRevision } = snapshot.sourceRevisions[0];
    t.db.prepare(`INSERT INTO vl_retrieval_chunks(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,text,content_hash,preprocess_version)
      VALUES ('template',?,?, 'chapter',0,0,'文本','hash','v1')`).run(sourceId, sourceRevision);
    t.db.prepare(`INSERT INTO vl_retrieval_vectors(scope_id,book_id,source_revision,chapter_id,paragraph_index,part_index,profile_id,dimensions,vector_blob,status,updated_at)
      VALUES ('template',?,?,'chapter',0,0,'profile',3,NULL,'failed','t')`).run(sourceId, sourceRevision);
    t.db.prepare(`INSERT INTO vl_index_jobs(scope_id,job_id,book_id,source_revision,profile_id,idempotency_key,status,progress_json,created_at,updated_at)
      VALUES ('template','job',?,?,'profile','key','queued','{}','t','t')`).run(sourceId, sourceRevision);
    const count = (sql: string, scope: string) => (t.db.prepare(sql).get(scope) as { n: number }).n;
    expect(count('SELECT count(*) AS n FROM vl_retrieval_chunks WHERE scope_id=?', 'template')).toBe(1);
    seedSample(t.db, SPACE, exportSample(t.db, 'template', t.confirmed.courseId));
    expect(count('SELECT count(*) AS n FROM vl_retrieval_chunks WHERE scope_id=?', SPACE)).toBe(0);
    expect(count('SELECT count(*) AS n FROM vl_retrieval_vectors WHERE scope_id=?', SPACE)).toBe(0);
    expect(count('SELECT count(*) AS n FROM vl_index_jobs WHERE scope_id=?', SPACE)).toBe(0);
  });

  it('导出包格式不对时拒绝种入，不写入任何行', async () => {
    const t = await template();
    expect(() => seedSample(t.db, SPACE, { version: 2, courseId: 'x', tables: {} } as never)).toThrow();
    const bundle = exportSample(t.db, 'template', t.confirmed.courseId);
    const evil = { ...bundle, tables: { ...bundle.tables, vl_books: [{ ...bundle.tables.vl_books[0], 'book_id) VALUES (1); --': 'x' }] } };
    expect(() => seedSample(t.db, SPACE, evil)).toThrow();
    expect(t.db.prepare('SELECT count(*) AS n FROM vl_books WHERE scope_id=?').get(SPACE)).toEqual({ n: 0 });
  });

  it('seedFromEnv：按 VL_SAMPLE_PATH 种入；未配置或文件不存在时跳过且不报错', async () => {
    const t = await template();
    const file = path.join(testDirectory(), 'sample.json');
    writeFileSync(file, JSON.stringify(exportSample(t.db, 'template', t.confirmed.courseId)));
    expect(seedFromEnv(t.db, SPACE, {})).toBe(false);
    expect(seedFromEnv(t.db, SPACE, { VL_SAMPLE_PATH: path.join(path.dirname(file), 'missing.json') })).toBe(false);
    expect(seedFromEnv(t.db, SPACE, { VL_SAMPLE_PATH: file })).toBe(true);
    expect(new CourseService(t.db, t.library, t.model).courses(SPACE)).toHaveLength(1);
  });
});
