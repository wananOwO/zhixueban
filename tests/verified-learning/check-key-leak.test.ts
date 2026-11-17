import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const callbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => callbacks.push(fn) }));
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));

import { POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { openVerifiedDb } from '@/lib/verified-learning/server';
import { VerifiedLearningStore } from '@/lib/verified-learning/store';
import { exportSample } from '@/lib/verified-learning/sample-course';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { encodeEmbeddingHeader, encodeModelHeader } from '@/lib/verified-learning/model-keys';
import { encodeVisionHeader } from '@/lib/verified-learning/vision/keys';
import { contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import { scanForSecret } from '../../scripts/check-key-leak';
import { courseInput } from './fixtures';
import { testDirectory } from './db-fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  callbacks.length = 0;
});

const ORIGIN = 'https://learn.example.cn';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

describe('多模态与混合检索零泄漏回归（Key / 原图 / Base64）', () => {
  it('聊天 Key、Embedding Key、Vision Key、原图 EXIF 与图像 base64 均不进入数据库、WAL、Agent 记录与示例导出', async () => {
    resetOnlineLoginLimit();
    const root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
    vi.stubEnv('VL_MODE', 'online');
    vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
    vi.stubEnv('VL_ACCESS_CODE', 'judge-access-2026');
    await initializeVerifiedLearning('data/app.db', true, root);

    const login = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, {
      method: 'POST',
      headers: { host: 'learn.example.cn', origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '198.51.100.88' },
      body: JSON.stringify({ token: 'judge-access-2026' }),
    }), context(['access']));
    const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const scopeId = cookie.split('; ').find(p => p.startsWith('vl_space='))!.slice(9);

    const CHAT_KEY = 'sk-chat-secret-9988776655443322';
    const EMB_KEY = 'sk-embed-secret-1122334455667788';
    const VIS_KEY = 'sk-vision-secret-aabbccddeeff0011';
    const EXIF_SECRET = 'PrivateStudentDeviceSerialNumber2026';

    const source: SourceSnapshot = {
      sourceId: 'book-a',
      sourceRevision: 'rev-1',
      title: '公开教程',
      format: 'txt',
      chapters: [{
        chapterId: 'ch1',
        title: '第一章',
        paragraphs: [{ paragraphIndex: 0, text: '递归必须有终止条件。', contentHash: contentHash('递归必须有终止条件。') }],
      }],
    };

    const db = openVerifiedDb();
    db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,'book-a','owned','ready','2026-11-17T00:00:00Z')").run(scopeId);
    db.prepare("INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,'book-a','rev-1',?,'2026-11-17T00:00:00Z')")
      .run(scopeId, JSON.stringify(source));
    const store = new VerifiedLearningStore(db);
    const version = store.activateVersion(scopeId, store.createVersion(scopeId, courseInput()).courseVersionId);
    const session = store.createSession(scopeId, version.courseVersionId, 'practice');
    db.close();

    let capturedSentImageBase64 = '';
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.6, 0.8] }] }), { headers: { 'content-type': 'application/json' } });
      }
      if (target.endsWith('/chat/completions')) {
        const parsed = JSON.parse(String(init?.body)) as { messages?: { content?: unknown }[] };
        const userParts = parsed.messages?.[1]?.content as { type?: string; image_url?: { url?: string } }[] | undefined;
        const imgUrl = userParts?.find(p => p.type === 'image_url')?.image_url?.url ?? '';
        capturedSentImageBase64 = imgUrl.split(',')[1] ?? '';
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                kind: 'code',
                language: 'python',
                transcription: 'def fact(n): return 1 if n <= 1 else n * fact(n - 1)',
                concepts: ['递归'],
                code: 'def fact(n): return 1 if n <= 1 else n * fact(n - 1)',
                question: null,
                uncertainty: [],
                needsClarification: false,
              }),
            },
          }],
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }));

    // 1. 线上模式建立语义索引（携带 X-VL-Embedding）
    const idxRes = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/textbooks/book-a/retrieval-index`, {
      method: 'POST',
      headers: {
        host: 'learn.example.cn',
        origin: ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': 'leak-idx-1',
        'x-real-ip': '198.51.100.88',
        'x-vl-model': encodeModelHeader({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: CHAT_KEY, model: 'chat-m' }),
        'x-vl-embedding': encodeEmbeddingHeader({ baseUrl: 'https://api.example.com/v1', apiKey: EMB_KEY, model: 'emb-m' }),
      },
      body: JSON.stringify({ confirm: true }),
    }), context(['textbooks', 'book-a', 'retrieval-index']));
    expect(idxRes.status).toBe(202);
    for (const cb of callbacks.splice(0)) await cb();

    // 2. 线上模式上传带隐私 EXIF 的截图做视觉识别（携带 X-VL-Vision）
    const rawImg = await sharp({
      create: { width: 96, height: 64, channels: 3, background: { r: 12, g: 88, b: 196 } },
    }).withExif({ IFD0: { Artist: EXIF_SECRET } }).jpeg().toBuffer();
    const imgAb = new ArrayBuffer(rawImg.byteLength);
    new Uint8Array(imgAb).set(rawImg);

    const form = new FormData();
    form.set('file', new File([imgAb], 'secret-screen.jpg', { type: 'image/jpeg' }));
    form.set('mode', 'analyze-code');
    const visRes = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/sessions/${session.sessionId}/vision/extract`, {
      method: 'POST',
      headers: {
        host: 'learn.example.cn',
        origin: ORIGIN,
        cookie,
        'idempotency-key': 'leak-vis-1',
        'x-real-ip': '198.51.100.88',
        'x-vl-vision': encodeVisionHeader({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: VIS_KEY, model: 'vis-m' }),
      },
      body: form,
    }), context(['sessions', session.sessionId, 'vision', 'extract']));
    expect(visRes.status).toBe(200);
    expect(capturedSentImageBase64.length).toBeGreaterThan(24);
    // 发给第三方模型的重编码图像本身也已剥离 EXIF
    expect(Buffer.from(capturedSentImageBase64, 'base64').toString('latin1')).not.toContain(EXIF_SECRET);

    // 3. 导出示例课程并落盘检查：不含向量、不含索引任务、不含任何密钥或图像字节
    const dbCheck = openVerifiedDb();
    const sampleBundle = exportSample(dbCheck, scopeId, version.courseId);
    dbCheck.close();
    const sampleFile = path.join(root, 'data/sample-export.json');
    writeFileSync(sampleFile, JSON.stringify(sampleBundle), 'utf8');
    expect('vl_retrieval_vectors' in sampleBundle.tables).toBe(false);
    expect('vl_index_jobs' in sampleBundle.tables).toBe(false);

    // 4. 对整个 data 目录（含 app.db、app.db-wal、sample-export.json、uploads）做字节级扫描
    const secretsToCheck = [
      CHAT_KEY,
      EMB_KEY,
      VIS_KEY,
      EXIF_SECRET,
      capturedSentImageBase64.slice(0, 48),
      rawImg.toString('base64').slice(0, 48),
    ];
    for (const secret of secretsToCheck) {
      const scan = scanForSecret([path.join(root, 'data')], secret);
      expect(scan.total, `发现泄露: ${secret.slice(0, 16)}`).toBe(0);
    }
  });
});
