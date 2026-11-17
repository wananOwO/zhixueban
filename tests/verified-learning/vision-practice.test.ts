import { describe, expect, it } from 'vitest';
import { migrateVerifiedLearning, VerifiedLearningStore } from '@/lib/verified-learning/store';
import { StudyService } from '@/lib/verified-learning/study';
import { LibraryService } from '@/lib/verified-learning/library';
import { RecordService } from '@/lib/verified-learning/records';
import { contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import type { LearningModel, QuestionCandidate } from '@/lib/verified-learning/backend-contracts';
import { courseInput } from './fixtures';
import { openTestDb, testDirectory } from './db-fixtures';

const textbookSource: SourceSnapshot = {
  sourceId: 'book-a',
  sourceRevision: 'rev-1',
  title: 'Python 教程',
  format: 'txt',
  chapters: [{
    chapterId: 'ch1',
    title: '变量与循环',
    paragraphs: [
      { paragraphIndex: 0, text: '变量用于绑定对象的值，赋值时自动关联。', contentHash: contentHash('变量用于绑定对象的值，赋值时自动关联。') },
      { paragraphIndex: 1, text: 'for 循环用于遍历可迭代序列。', contentHash: contentHash('for 循环用于遍历可迭代序列。') },
    ],
  }],
};

const variantQuestion: QuestionCandidate = {
  type: 'choice',
  stem: '在 Python 中执行 x = 10 时，变量 x 的本质是什么？',
  options: ['绑定在整数对象上的名字', '固定 4 字节的寄存器地址'],
  answer: '绑定在整数对象上的名字',
  explanation: 'Python 变量是绑定在对象上的名字。',
  targetIds: ['variables'],
  dependencyIds: ['variables'],
  citations: [{
    sourceId: 'book-a',
    sourceRevision: 'rev-1',
    chapterId: 'ch1',
    paragraphIndex: 0,
    quote: '变量用于绑定对象的值',
  }],
};

function createFakeModel(): { model: LearningModel; reviewCalls: () => number; lastPrompt: () => string } {
  let reviews = 0;
  let prompt = '';
  return {
    reviewCalls: () => reviews,
    lastPrompt: () => prompt,
    model: {
      propose: async () => { throw new Error('不应调用 propose'); },
      lesson: async () => ({ markdown: '## 变量\n\n变量用于绑定对象的值，这是基础概念讲解与代码示例总结。'.repeat(3), citations: variantQuestion.citations }),
      questions: async (ctx, validate) => {
        prompt = ctx.teachingPrompt;
        await validate?.(variantQuestion);
        return [variantQuestion];
      },
      review: async () => {
        reviews++;
        return { ok: true, answerConsistent: true, usedKnowledgeIds: ['variables'], reason: '通过审校' };
      },
    },
  };
}

async function setup() {
  const db = openTestDb();
  await migrateVerifiedLearning(db);
  db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES ('a','book-a','owned','ready','2026-11-17T00:00:00Z')").run();
  db.prepare("INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES ('a','book-a','rev-1',?,'2026-11-17T00:00:00Z')")
    .run(JSON.stringify(textbookSource));

  const store = new VerifiedLearningStore(db);
  const version = store.activateVersion('a', store.createVersion('a', courseInput()).courseVersionId);
  const session = store.createSession('a', version.courseVersionId, 'practice');
  const fake = createFakeModel();
  const study = new StudyService(db, new LibraryService(db, testDirectory()), fake.model);
  const records = new RecordService(db, study);
  return { db, study, records, session, version, fake };
}

describe('vision_practice：截图变式练习隔离与校验', () => {
  it('拒绝跨课程知识点、超纲未学知识点、超过 3 个知识点以及进行中活动时创建', async () => {
    const { study, session } = await setup();
    // 尚未学习也未自报 variables，属于超纲知识点
    expect(() => study.visionPractice('a', session.sessionId, 'vp-unlearned', {
      transcription: 'x = 1',
      knowledgePointIds: ['variables'],
    })).toThrow(/已学范围|尚未学习/);

    // 自报掌握 variables 后：跨课程知识点仍拒绝，未学的 loops 仍拒绝，超过 3 个知识点拒绝
    study.declarePrior('a', session.sessionId, 0, 'decl-1', ['variables']);
    expect(() => study.visionPractice('a', session.sessionId, 'vp-foreign', {
      transcription: 'x = 1',
      knowledgePointIds: ['not-in-course'],
    })).toThrow(/不属于当前课程/);
    expect(() => study.visionPractice('a', session.sessionId, 'vp-future', {
      transcription: 'for i in range(3): pass',
      knowledgePointIds: ['loops'],
    })).toThrow(/已学范围|尚未学习/);
    expect(() => study.visionPractice('a', session.sessionId, 'vp-many', {
      transcription: 'x = 1',
      knowledgePointIds: ['variables', 'p2', 'p3', 'p4'],
    })).toThrow();

    // 开始主课程活动后，进行中活动期间禁止创建 vision_practice（防止借变式题泄题）
    const currentView = study.get('a', session.sessionId);
    study.start('a', session.sessionId, currentView.session.revision, 'start-main');
    expect(() => study.visionPractice('a', session.sessionId, 'vp-busy', {
      transcription: 'x = 1',
      knowledgePointIds: ['variables'],
    })).toThrow(expect.objectContaining({ code: 'ACTIVITY_IN_PROGRESS' }));
  });

  it('固定生成 1 题并通过独立审校与引用校验，作答后不推进主课程会话且不计入掌握证据', async () => {
    const { study, records, session, version, fake } = await setup();
    study.declarePrior('a', session.sessionId, 0, 'decl-vars', ['variables']);
    const beforeView = study.get('a', session.sessionId);
    const beforeRevision = beforeView.session.revision;
    const beforeNext = beforeView.next;

    const created = study.visionPractice('a', session.sessionId, 'vp-ok', {
      transcription: '截图原题：x = 5; y = x; x = 6; 求 y',
      concepts: ['变量绑定'],
      knowledgePointIds: ['variables'],
    });
    expect(created.run.purpose).toBe('vision_practice');
    expect(created.job.kind).toBe('question_set');

    await study.runContent('a', created.job.jobId);
    expect(fake.reviewCalls()).toBe(1);
    expect(fake.lastPrompt()).toContain('截图原题：x = 5');

    const runView = study.runView('a', created.run.runId);
    expect(runView.status).toBe('ready');
    expect(runView.questions).toHaveLength(1);

    // 连续答对变式题：完成活动但不改变 session.revision、不改变 nextActivity、不计入 evidence() 和 verified()
    const submitted = await study.submit('a', created.run.runId, runView.questions[0].questionId, 'att-vp-1', variantQuestion.answer);
    expect(submitted.result?.correct).toBe(true);
    expect(study.runView('a', created.run.runId).status).toBe('completed');

    const afterView = study.get('a', session.sessionId);
    expect(afterView.session.revision).toBe(beforeRevision);
    expect(afterView.session.completedActivityIds).toEqual([]);
    expect(afterView.next).toEqual(beforeNext);
    expect(study.evidence('a', version.courseVersionId).get('variables')).toBeUndefined();
    expect(study.verified('a', version.courseVersionId)).toEqual([]);
    expect(records.progress('a', version.courseVersionId).evidenceQuestions).toBe(0);
  });
});
