import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { LibraryService } from '@/lib/verified-learning/library';
import { CourseService } from '@/lib/verified-learning/courses';
import { StudyService } from '@/lib/verified-learning/study';
import { exportSample } from '@/lib/verified-learning/sample-course';
import type { LearningModel } from '@/lib/verified-learning/backend-contracts';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const CODE = 'judge-code-2026';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
const headers = (cookie?: string) => ({ host: 'learn.example.cn', origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '198.51.100.7', ...(cookie ? { cookie } : {}) });

/** 在临时库的 template 空间生成一门小课并导出为示例文件 */
async function sampleFile(root: string): Promise<string> {
  const db = new Database(path.join(root, 'template.db'));
  const { migrateVerifiedLearning } = await import('@/lib/verified-learning/store');
  await migrateVerifiedLearning(db);
  const library = new LibraryService(db, path.join(root, 'template-uploads'));
  const book = await library.importFile('template', 'book', new File(['# 基础\n\n变量用于保存数据。'], 'intro.md'));
  const source = library.source('template', book.bookId);
  const p = source.chapters[0].paragraphs[0];
  const cite = { sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterId: source.chapters[0].chapterId, paragraphIndex: p.paragraphIndex, quote: p.text };
  const model: LearningModel = {
    propose: async () => ({ points: [{ id: 'variables', title: '变量', prerequisiteIds: [], relatedIds: [], citations: [cite] }], targetIds: ['variables'], declaredIds: [] }),
    lesson: async () => ({ markdown: '## 变量\n\n变量用于保存数据。', citations: [cite] }),
    questions: async () => [],
    review: async () => ({ ok: true, usedKnowledgeIds: [], answerConsistent: true, reason: '' }),
  };
  const courses = new CourseService(db, library, model);
  const draft = courses.create('template', 'd', { textbookId: book.bookId, sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: source.chapters.map(c => c.chapterId) }], goal: '学会变量', mode: 'theory' });
  const job = courses.generate('template', draft.draftId, 0, 'g');
  await courses.runGeneration('template', job.jobId);
  const confirmed = courses.confirm('template', draft.draftId, courses.get('template', draft.draftId).revision, 'c', true);
  const study = new StudyService(db, library, model);
  const started = study.start('template', confirmed.sessionId, 0, 's');
  await study.runContent('template', started.job!.jobId);
  const file = path.join(root, 'sample.json');
  writeFileSync(file, JSON.stringify(exportSample(db, 'template', confirmed.courseId)));
  db.close();
  return file;
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetOnlineLoginLimit(); });

describe('线上新空间自动种入示例课程', () => {
  it('第一次登录的新空间有示例课程，可直接读课件（不带 Key）；回到原空间不重复种入', async () => {
    const root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    const file = await sampleFile(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
    vi.stubEnv('VL_MODE', 'online');
    vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
    vi.stubEnv('VL_ACCESS_CODE', CODE);
    vi.stubEnv('VL_SAMPLE_PATH', file);
    await initializeVerifiedLearning('data/app.db', true, root);

    const login = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, { method: 'POST', headers: headers(), body: JSON.stringify({ token: CODE }) }), context(['access']));
    const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const list = (await (await GET(new Request(`${ORIGIN}/api/verified-learning/v1/courses`, { headers: headers(cookie) }), context(['courses']))).json()).data;
    expect(list).toHaveLength(1);
    const sessionId = list[0].sessionId;
    const session = (await (await GET(new Request(`${ORIGIN}/api/verified-learning/v1/sessions/${sessionId}`, { headers: headers(cookie) }), context(['sessions', sessionId]))).json()).data;
    expect(session.currentRun.status).toBe('ready');
    const run = await GET(new Request(`${ORIGIN}/api/verified-learning/v1/runs/${session.currentRun.runId}`, { headers: headers(cookie) }), context(['runs', session.currentRun.runId]));
    expect((await run.json()).data.content.markdown).toContain('变量用于保存数据');
    // 示例教材没有上传文件：不占每空间 10 本的上传额度
    const books = (await (await GET(new Request(`${ORIGIN}/api/verified-learning/v1/textbooks`, { headers: headers(cookie) }), context(['textbooks']))).json()).data;
    expect(books).toHaveLength(1);

    // 退出后回到原空间：不重复种入
    const again = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, { method: 'POST', headers: headers(cookie), body: JSON.stringify({ token: CODE }) }), context(['access']));
    const cookie2 = again.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const list2 = (await (await GET(new Request(`${ORIGIN}/api/verified-learning/v1/courses`, { headers: headers(cookie2) }), context(['courses']))).json()).data;
    expect(list2).toHaveLength(1);
  });
});
