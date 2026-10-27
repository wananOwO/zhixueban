import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { migrateVerifiedLearning } from '@/lib/verified-learning/store';
import { LibraryService } from '@/lib/verified-learning/library';
import { CourseService } from '@/lib/verified-learning/courses';
import { StudyService } from '@/lib/verified-learning/study';
import type { LearningModel } from '@/lib/verified-learning/backend-contracts';
import { buildTutorContext, tutorResponse, parseTutorRequest } from '@/lib/verified-learning/tutor';
import { openTestDb, testDirectory } from './db-fixtures';

/** 搭一门已确认、正在做题的课程：题目有答案与解析 */
async function setup() {
  const db = openTestDb();
  await migrateVerifiedLearning(db);
  const library = new LibraryService(db, testDirectory());
  const book = await library.importFile('a', 'book', new File(['# 基础\n变量用于保存数据。\n\nprint() 把内容输出到屏幕。'], 'intro.md'));
  const source = library.source('a', book.bookId);
  const [first, second] = source.chapters[0].paragraphs;
  const cite = (p: typeof first) => ({ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterId: source.chapters[0].chapterId, paragraphIndex: p.paragraphIndex, quote: p.text });
  const proposal = { points: [{ id: 'variables', title: '变量', prerequisiteIds: [], relatedIds: [], citations: [cite(first)] }], targetIds: ['variables'], declaredIds: [] };
  const model: LearningModel = {
    propose: async () => proposal,
    lesson: async () => ({ markdown: '## 变量\n\n变量用于保存数据。', citations: [cite(first), cite(second)] }),
    questions: async () => [{ type: 'choice' as const, stem: '变量的作用？', options: ['保存数据', '删除程序'], answer: '保存数据', explanation: '变量用于保存数据，这是秘密解析。', targetIds: ['variables'], dependencyIds: ['variables'], citations: [cite(first)] }],
    review: async () => ({ ok: true, usedKnowledgeIds: ['variables'], answerConsistent: true, reason: '范围内' }),
  };
  const courses = new CourseService(db, library, model);
  const draft = courses.create('a', 'draft', { textbookId: book.bookId, sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: source.chapters.map(c => c.chapterId) }], goal: '学习变量', assessment: { pointQuestionCount: 1 }, mode: 'practice' });
  const job = courses.generate('a', draft.draftId, 0, 'gen');
  await courses.runGeneration('a', job.jobId);
  const confirmed = courses.confirm('a', draft.draftId, courses.get('a', draft.draftId).revision, 'confirm', true);
  const study = new StudyService(db, library, model);
  let view = study.get('a', confirmed.sessionId);
  const lesson = study.start('a', confirmed.sessionId, view.session.revision, 'start');
  await study.runContent('a', lesson.job!.jobId);
  view = study.get('a', confirmed.sessionId);
  study.completeLesson('a', confirmed.sessionId, lesson.run.runId, view.session.revision, 'read');
  view = study.get('a', confirmed.sessionId);
  const quiz = study.start('a', confirmed.sessionId, view.session.revision, 'quiz');
  await study.runContent('a', quiz.job!.jobId);
  return { db, library, study, sessionId: confirmed.sessionId, lessonRunId: lesson.run.runId, quizRunId: quiz.run.runId, bookId: book.bookId };
}

function textModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: text },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
        ],
      }),
    }),
  });
}

describe('学习助教', () => {
  it('作答未完成时，上下文不含题目答案与解析，并要求不直接给答案', async () => {
    const { db, library, sessionId, quizRunId } = await setup();
    const context = buildTutorContext(db, library, 'a', sessionId, quizRunId);
    expect(context.system).toContain('学习变量');
    expect(context.system).toContain('不要直接给出当前练习题的答案');
    expect(context.system).not.toContain('秘密解析');
    expect(context.system).not.toContain('保存数据，这是');
  });

  it('课件活动的上下文包含课件正文与可引用段号', async () => {
    const { db, library, sessionId, lessonRunId, bookId } = await setup();
    const context = buildTutorContext(db, library, 'a', sessionId, lessonRunId);
    expect(context.system).toContain('变量用于保存数据。');
    expect(context.system).toContain(bookId);
    expect(context.sources.map(s => s.sourceId)).toEqual([bookId]);
  });

  it('作答完成后可以加入该题解析', async () => {
    const { db, library, study, sessionId, quizRunId } = await setup();
    const question = study.runView('a', quizRunId).questions[0];
    await study.submit('a', quizRunId, question.questionId, 'answer', '保存数据');
    const context = buildTutorContext(db, library, 'a', sessionId, quizRunId);
    expect(context.system).toContain('秘密解析');
  });

  it('流式返回 UI 消息流，正文含模型文字', async () => {
    const { db, library, sessionId, lessonRunId } = await setup();
    const context = buildTutorContext(db, library, 'a', sessionId, lessonRunId);
    const response = tutorResponse({ model: textModel('变量是贴在值上的标签〔book·第0段〕'), context, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '什么是变量？' }] }] });
    const body = await (await response).text();
    expect(body).toContain('变量是贴在值上的标签');
  });

  it('其他空间的会话不可用；请求体校验消息条数与长度', async () => {
    const { db, library, sessionId } = await setup();
    expect(() => buildTutorContext(db, library, 'other', sessionId)).toThrow();
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, role: 'user', parts: [{ type: 'text', text: 'hi' }] }));
    expect(() => parseTutorRequest({ messages: many })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => parseTutorRequest({ messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(4001) }] }] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(parseTutorRequest({ messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: '你好' }] }], runId: 'r' }).runId).toBe('r');
  });
});
