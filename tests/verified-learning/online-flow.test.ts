import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const callbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => callbacks.push(fn) }));
import { GET, PATCH, POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { encodeModelHeader, type ModelConfig } from '@/lib/verified-learning/model-keys';
import { scanForSecret } from '../../scripts/check-key-leak';
import { testDirectory } from './db-fixtures';

/**
 * 线上模式完整流程（规格 11：Key 不落盘验证）：
 * 访问码登录 → 上传教材 → 草稿 → 生成方案（真实 Agent，模型由假的 OpenAI 兼容流式接口驱动）→ 审核确认 →
 * 开始课件（Agent 生成）→ 读完 → 题组（Agent 出题 + 审校）→ 作答 → 课程进度更新。
 * 结束后对数据库、WAL、上传目录做字节级搜索，Key 命中数为 0。
 */
const ORIGIN = 'https://learn.example.cn';
const CODE = 'judge-code-2026';
const SECRET = 'sk-online-flow-c0ffee-1234567890';
const model: ModelConfig = { provider: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', apiKey: SECRET, model: 'fake-model' };
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

type Call = { name: string; args: Record<string, unknown> };
/** 按 Agent 阶段（系统提示里的任务描述）返回下一次工具调用；每次请求都检查 Key 是否经请求头送达 */
function fakeProvider(plan: (stage: string, step: number, lastResult: string) => Call) {
  const steps = new Map<string, number>();
  const seenKeys = new Set<string>();
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seenKeys.add(headers.get('authorization') ?? '');
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] };
    const first = JSON.stringify(body.messages.find(m => m.role === 'user')?.content ?? '');
    const stage = first.includes('独立审校题目') ? 'review' : first.includes('设计完整学习方案') ? 'curriculum' : first.includes('生成当前活动的完整课件') ? 'lesson' : 'questions';
    const key = stage === 'review' ? `review:${first.length}` : stage;
    const step = steps.get(key) ?? 0;
    steps.set(key, step + 1);
    const last = body.messages.at(-1);
    const call = plan(stage, step, typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? ''));
    const chunks = [
      { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${stage}_${step}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] },
      { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const text = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return { fetch, seenKeys };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetOnlineLoginLimit(); callbacks.length = 0; });

describe('线上模式完整流程', () => {
  it('从登录到作答全程可用，数据库、WAL 与上传目录里搜不到 Key', async () => {
    const root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
    vi.stubEnv('VL_MODE', 'online');
    vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
    vi.stubEnv('VL_ACCESS_CODE', CODE);
    await initializeVerifiedLearning('data/app.db', true, root);

    let cookie = '';
    const call = async (method: 'GET' | 'POST' | 'PATCH', segments: string[], body?: unknown, withKey = false) => {
      const headers: Record<string, string> = { host: 'learn.example.cn', origin: ORIGIN, 'x-real-ip': '198.51.100.7', 'idempotency-key': `k-${Math.random()}` };
      if (cookie) headers.cookie = cookie;
      if (withKey) headers['x-vl-model'] = encodeModelHeader(model);
      if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
      const request = new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
      const handler = method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST;
      const response = await handler(request, context(segments));
      const json = await response.json();
      if (!response.ok) throw new Error(`${method} ${segments.join('/')} → ${response.status} ${JSON.stringify(json.error)}`);
      return { response, data: json.data };
    };
    const drain = async () => { while (callbacks.length) await callbacks.shift()!(); };

    // 登录
    const login = await call('POST', ['access'], { token: CODE });
    cookie = login.response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');

    // 上传教材
    const form = new FormData();
    form.set('file', new File(['# 第一章 变量\n\n变量用于保存数据。\n\n赋值语句把值绑定到名字上。\n\n变量名区分大小写。'], 'intro.md'));
    const book = (await call('POST', ['textbooks'], form)).data;
    const source = (await call('GET', ['textbooks', book.bookId, 'source'])).data;
    const chapter = source.chapters[0];
    const [p0, p1, p2] = chapter.paragraphs;
    const cite = (p: { paragraphIndex: number; text: string }) => ({ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterId: chapter.chapterId, paragraphIndex: p.paragraphIndex, quote: p.text });

    // 假模型：每个阶段先读原文，再提交，最后验收
    const provider = fakeProvider((stage, step) => {
      const read = { name: 'read_source', args: { sourceId: book.bookId, chapterId: chapter.chapterId, offset: 0, limit: 10 } };
      if (stage === 'curriculum') {
        return [read,
          { name: 'submit_curriculum_point', args: { id: 'variables', title: '变量', prerequisiteIds: [], relatedIds: [], citations: [cite(p0), cite(p1)] } },
          { name: 'finish_generation', args: { targetIds: ['variables'], declaredIds: [] } }][Math.min(step, 2)];
      }
      if (stage === 'lesson') {
        return [read,
          { name: 'plan_lesson', args: { sections: [{ sectionId: 's1', title: '变量是什么', knowledgePointIds: ['variables'], purpose: '概念、例子与小结' }] } },
          { name: 'submit_lesson_section', args: { sectionId: 's1', markdown: '## 变量是什么\n\n变量用于保存数据。赋值语句把值绑定到名字上，例如 `x = 1` 把 1 绑定到名字 x。\n\n小结：变量名区分大小写，x 和 X 是两个不同的变量。', citations: [cite(p0), cite(p1), cite(p2)] } },
          { name: 'finish_generation', args: { coverage: [{ knowledgePointId: 'variables', conceptSectionId: 's1', exampleSectionId: 's1', summarySectionId: 's1' }] } }][Math.min(step, 3)];
      }
      if (stage === 'review') return { name: 'submit_review', args: { ok: true, usedKnowledgeIds: ['variables'], answerConsistent: true, reason: '只用到变量' } };
      const q = (index: number, stem: string, answer: string, options?: string[]) => ({ name: 'submit_question', args: { index, question: { type: options ? 'choice' : 'fill', stem, ...(options ? { options } : {}), answer, explanation: '见教材第一章。', targetIds: ['variables'], dependencyIds: ['variables'], citations: [cite(p0)] } } });
      return [read,
        q(1, '变量的作用是什么？', '保存数据', ['保存数据', '删除程序']),
        q(2, '把值绑定到名字上的语句叫什么？', '赋值语句'),
        q(3, '变量名区分大小写吗？', '区分', ['区分', '不区分']),
        { name: 'finish_generation', args: {} }][Math.min(step, 4)];
    });
    vi.stubGlobal('fetch', provider.fetch);

    // 草稿 → 生成（需要 Key）→ 审核 → 确认
    const draft = (await call('POST', ['drafts'], { title: '变量入门', textbookId: book.bookId, sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: [chapter.chapterId] }], goal: '学会变量', assessment: { pointQuestionCount: 3, chapterQuestionCount: 3 }, mode: 'practice' })).data;
    await call('POST', ['drafts', draft.draftId, 'generate'], { expectedRevision: draft.revision }, true);
    await drain();
    const reviewed = (await call('GET', ['drafts', draft.draftId])).data;
    expect(reviewed.state).toBe('review');
    const confirmed = (await call('POST', ['drafts', reviewed.draftId, 'confirm'], { expectedRevision: reviewed.revision, acceptSourceAndPrerequisiteReview: true })).data;

    // 课件
    let session = (await call('GET', ['sessions', confirmed.sessionId])).data;
    await call('POST', ['sessions', confirmed.sessionId, 'start'], { expectedRevision: session.session.revision }, true);
    await drain();
    session = (await call('GET', ['sessions', confirmed.sessionId])).data;
    const lesson = (await call('GET', ['runs', session.currentRun.runId])).data;
    expect(lesson.content.markdown).toContain('变量用于保存数据');
    // 课件生成过程的轨迹可读（书带数据）
    const trace = (await call('GET', ['jobs', session.currentRun.jobId, 'trace'])).data;
    expect(trace.stages[0].steps.map((s: { tool: string }) => s.tool)).toContain('read_source');
    await call('POST', ['sessions', confirmed.sessionId, 'lesson-completion'], { runId: lesson.runId, expectedRevision: session.session.revision });

    // 题组
    session = (await call('GET', ['sessions', confirmed.sessionId])).data;
    await call('POST', ['sessions', confirmed.sessionId, 'start'], { expectedRevision: session.session.revision }, true);
    await drain();
    session = (await call('GET', ['sessions', confirmed.sessionId])).data;
    const quiz = (await call('GET', ['runs', session.currentRun.runId])).data;
    expect(quiz.questions).toHaveLength(3);
    const answers: Record<string, string> = { '变量的作用是什么？': '保存数据', '把值绑定到名字上的语句叫什么？': '赋值语句', '变量名区分大小写吗？': '区分' };
    for (const question of quiz.questions) {
      const attempt = (await call('POST', ['runs', quiz.runId, 'attempts'], { questionId: question.questionId, answer: answers[question.stem] })).data;
      expect(attempt.result.correct).toBe(true);
    }
    const after = (await GET(new Request(`${ORIGIN}/api/verified-learning/v1/progress?versionId=${confirmed.versionId}`, { headers: { host: 'learn.example.cn', origin: ORIGIN, cookie } }), context(['progress']))).json();
    const p = (await after).data;
    expect(p.verifiedKnowledgePointIds).toEqual(['variables']);
    expect(p.recent.variables).toEqual([true, true, true]);

    // Key 只经请求头送到模型供应商
    expect([...provider.seenKeys]).toEqual([`Bearer ${SECRET}`]);
    // Key 不落盘：数据库、WAL、上传目录
    const leak = scanForSecret([path.join(root, 'data')], SECRET);
    expect(leak.scannedFiles).toBeGreaterThan(1);
    expect(leak.hits).toEqual([]);
  });
});
