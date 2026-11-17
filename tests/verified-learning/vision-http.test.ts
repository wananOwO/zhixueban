import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const callbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => callbacks.push(fn) }));
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));

import { POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { openVerifiedDb } from '@/lib/verified-learning/server';
import { VerifiedLearningStore } from '@/lib/verified-learning/store';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { encodeModelHeader } from '@/lib/verified-learning/model-keys';
import { encodeVisionHeader } from '@/lib/verified-learning/vision/keys';
import { contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import { courseInput } from './fixtures';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const VISION_SECRET = 'sk-vision-online-only-secret-8899';
const CHAT_SECRET = 'sk-chat-online-only-secret-7766';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

let root = '';
let cookie = '';
let scopeId = '';
let sessionId = '';

const textbookSource: SourceSnapshot = {
  sourceId: 'book-a',
  sourceRevision: 'rev-1',
  title: 'Python 教程',
  format: 'txt',
  chapters: [{
    chapterId: 'ch1',
    title: '第一章 变量',
    paragraphs: [
      { paragraphIndex: 0, text: '变量是贴在对象上的标签，赋值操作将名字绑定到对象。', contentHash: contentHash('变量是贴在对象上的标签，赋值操作将名字绑定到对象。') },
    ],
  }],
};

function jsonRequest(segments: string[], body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, {
    method: 'POST',
    headers: {
      host: 'learn.example.cn',
      origin: ORIGIN,
      cookie,
      'content-type': 'application/json',
      'idempotency-key': `idem-${Math.random()}`,
      'x-real-ip': '198.51.100.20',
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

async function makePngFile(markerText = 'UniqueExifMarker9988'): Promise<{ file: File; rawBytes: Buffer }> {
  const rawBytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).withExif({ IFD0: { Artist: markerText } }).jpeg().toBuffer();
  const ab = new ArrayBuffer(rawBytes.byteLength);
  new Uint8Array(ab).set(rawBytes);
  return { file: new File([ab], 'question-shot.jpg', { type: 'image/jpeg' }), rawBytes };
}

beforeEach(async () => {
  callbacks.length = 0;
  resetOnlineLoginLimit();
  root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_MODE', 'online');
  vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
  vi.stubEnv('VL_ACCESS_CODE', 'judge-code-2026');
  await initializeVerifiedLearning('data/app.db', true, root);

  const login = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, {
    method: 'POST',
    headers: { host: 'learn.example.cn', origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '198.51.100.20' },
    body: JSON.stringify({ token: 'judge-code-2026' }),
  }), context(['access']));
  cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  scopeId = cookie.split('; ').find(p => p.startsWith('vl_space='))!.slice(9);

  const db = openVerifiedDb();
  db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,'book-a','owned','ready','2026-11-17T00:00:00Z')").run(scopeId);
  db.prepare("INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,'book-a','rev-1',?,'2026-11-17T00:00:00Z')")
    .run(scopeId, JSON.stringify(textbookSource));
  const store = new VerifiedLearningStore(db);
  const input = {
    ...courseInput(),
    priorKnowledge: [{ knowledgePointId: 'variables', source: 'declared' as const }],
  };
  const version = store.activateVersion(scopeId, store.createVersion(scopeId, input).courseVersionId);
  sessionId = store.createSession(scopeId, version.courseVersionId, 'practice').sessionId;
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('多模态截图接口：extract / explain / practice', () => {
  it('extract 返回结构化识别结果、不自动解题、5 分钟幂等去重且原图与 Key 不落盘', async () => {
    const { file, rawBytes } = await makePngFile();
    let visionCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      visionCalls++;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              kind: 'code',
              language: 'python',
              transcription: 'a = [1, 2]\nb = a',
              concepts: ['变量', '引用'],
              code: 'a = [1, 2]\nb = a',
              question: null,
              uncertainty: [],
              needsClarification: false,
            }),
          },
        }],
      }), { headers: { 'content-type': 'application/json' } });
    }));

    const makeMultipart = (idemKey: string, sessionTarget = sessionId, visionHdr?: string) => {
      const form = new FormData();
      form.set('file', file);
      form.set('mode', 'analyze-code');
      const headers: Record<string, string> = {
        host: 'learn.example.cn',
        origin: ORIGIN,
        cookie,
        'idempotency-key': idemKey,
        'x-real-ip': '198.51.100.20',
      };
      if (visionHdr) headers['x-vl-vision'] = visionHdr;
      return new Request(`${ORIGIN}/api/verified-learning/v1/sessions/${sessionTarget}/vision/extract`, {
        method: 'POST',
        headers,
        body: form,
      });
    };

    // 缺少模型 Key 时返回 400 MODEL_KEY_REQUIRED
    const noKey = await POST(makeMultipart('v-nokey'), context(['sessions', sessionId, 'vision', 'extract']));
    expect(noKey.status).toBe(400);
    expect((await noKey.json()).error.code).toBe('MODEL_KEY_REQUIRED');

    const hdr = encodeVisionHeader({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'vision-1', apiKey: VISION_SECRET });
    // 不存在的会话返回 404，不触发第三方付费识别
    const missing = await POST(makeMultipart('v-missing', 'other-session', hdr), context(['sessions', 'other-session', 'vision', 'extract']));
    expect(missing.status).toBe(404);
    expect(visionCalls).toBe(0);

    const res1 = await POST(makeMultipart('v-same-key', sessionId, hdr), context(['sessions', sessionId, 'vision', 'extract']));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()).data;
    expect(body1.extraction).toMatchObject({ kind: 'code', language: 'python', transcription: 'a = [1, 2]\nb = a' });
    expect(visionCalls).toBe(1);

    // 相同幂等键重放不重复计费调用
    const res2 = await POST(makeMultipart('v-same-key', sessionId, hdr), context(['sessions', sessionId, 'vision', 'extract']));
    expect(res2.status).toBe(200);
    expect(visionCalls).toBe(1);

    // 数据库与 WAL 中绝不包含原图字节、EXIF 标记或 Vision Key
    const base64Snippet = rawBytes.subarray(0, 24).toString('base64');
    for (const dbFile of ['data/app.db', 'data/app.db-wal']) {
      const full = path.join(root, dbFile);
      if (existsSync(full)) {
        const content = readFileSync(full);
        expect(content.includes(Buffer.from(VISION_SECRET))).toBe(false);
        expect(content.includes(Buffer.from('UniqueExifMarker9988'))).toBe(false);
        expect(content.includes(Buffer.from(base64Snippet))).toBe(false);
      }
    }
  });

  it('explain 在 needsClarification 未确认时拒绝；practice 在无活动时创建、有活动时拒绝', async () => {
    const modelHdr = {
      'x-vl-model': encodeModelHeader({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: CHAT_SECRET, model: 'deepseek-chat' }),
    };

    // needsClarification=true 且未标记 clarified=true 时拒绝直接生成结论
    const unclarified = await POST(
      jsonRequest(['sessions', sessionId, 'vision', 'explain'], {
        mode: 'explain',
        transcription: '模糊不清的题干',
        needsClarification: true,
        clarified: false,
      }, modelHdr),
      context(['sessions', sessionId, 'vision', 'explain']),
    );
    expect(unclarified.status).toBe(422);

    // 超纲知识点 loops 拒绝创建变式题
    const outOfScope = await POST(
      jsonRequest(['sessions', sessionId, 'vision', 'practice'], {
        transcription: 'for x in arr: print(x)',
        knowledgePointIds: ['loops'],
      }, modelHdr),
      context(['sessions', sessionId, 'vision', 'practice']),
    );
    expect(outOfScope.status).toBe(422);

    // 已声明掌握的 variables 可以创建 1 题变式练习
    const practiceOk = await POST(
      jsonRequest(['sessions', sessionId, 'vision', 'practice'], {
        transcription: 'x = 10; y = x',
        concepts: ['变量'],
        knowledgePointIds: ['variables'],
      }, modelHdr),
      context(['sessions', sessionId, 'vision', 'practice']),
    );
    expect(practiceOk.status).toBe(202);
    const created = (await practiceOk.json()).data;
    expect(created.run.purpose).toBe('vision_practice');

    // 已有进行中的变式题时再次创建返回 409 ACTIVITY_IN_PROGRESS
    const conflict = await POST(
      jsonRequest(['sessions', sessionId, 'vision', 'practice'], {
        transcription: 'x = 20',
        knowledgePointIds: ['variables'],
      }, modelHdr),
      context(['sessions', sessionId, 'vision', 'practice']),
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('ACTIVITY_IN_PROGRESS');
  });
});
