import { describe, expect, it, vi } from 'vitest';
import {
  extractVision,
  visionFailureMessage,
  VisionRequestCoordinator,
} from '@/lib/verified-learning/vision/service';
import type { VisionConfig } from '@/lib/verified-learning/vision/keys';

const config: VisionConfig = { provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'vision-mini', apiKey: 'sk-vision-secret' };
const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: 'image/jpeg' as const, width: 100, height: 100, pixelCount: 10_000 };

function reply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
}

const payload = {
  kind: 'code' as const,
  language: 'python' as const,
  transcription: 'def f(n): pass',
  concepts: ['递归'],
  code: 'def f(n): pass',
  question: null,
  uncertainty: [],
  needsClarification: false,
};

describe('视觉识别调用与并发幂等协调', () => {
  it('OpenAI 兼容接口发送 data URL 图片并解析结构化结果', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
      expect(String(input)).toBe('https://api.example.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; image_url?: { url: string } }[] }[] };
      const parts = body.messages[1].content;
      expect(parts.some(part => part.type === 'image_url' && part.image_url?.url === `data:image/jpeg;base64,${jpegBase64}`)).toBe(true);
      return reply(JSON.stringify(payload));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractVision({ config, image, mode: 'explain' });
    expect(result.language).toBe('python');
    expect(result.concepts).toEqual(['递归']);
    vi.unstubAllGlobals();
  });

  it('Anthropic 协议使用 /messages 与 base64 image 块并支持 practice 模式', async () => {
    const anthropicConfig: VisionConfig = {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-secret-key-123456',
    };
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-secret-key-123456');
      const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; source?: { data: string; media_type: string } }[] }[] };
      expect(body.messages[0].content.some(p => p.type === 'image' && p.source?.data === jpegBase64 && p.source?.media_type === 'image/jpeg')).toBe(true);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractVision({ config: anthropicConfig, image, mode: 'practice' });
    expect(result.kind).toBe('code');
    vi.unstubAllGlobals();
  });

  it('模型不支持图片时给出可理解错误，提示改用文字', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'this model does not support image input' } }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await expect(extractVision({ config, image, mode: 'explain' })).rejects.toThrow(/不支持图片|图片/);
    expect(visionFailureMessage(new Error('model does not support image_url'))).toContain('文字');
    vi.unstubAllGlobals();
  });

  it('返回非 JSON 或结构不合法的内容时拒绝，错误信息遮蔽 Key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('这是一段普通的模型文字，不是 JSON')));
    await expect(extractVision({ config, image, mode: 'explain' })).rejects.toThrow(/识别结果/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid key sk-vision-secret' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    try { await extractVision({ config, image, mode: 'explain' }); }
    catch (error) { expect(String(error)).not.toContain('sk-vision-secret'); }
    vi.unstubAllGlobals();
  });

  it('同空间限制单并发，相同 scope + Idempotency-Key 在 5 分钟内进程内去重且取消请求不缓存', async () => {
    let now = 1_000_000;
    const coord = new VisionRequestCoordinator(() => now);
    let calls = 0;
    const first = await coord.execute('scope-a', 'idem-1', undefined, async () => { calls++; return payload; });
    const cached = await coord.execute('scope-a', 'idem-1', undefined, async () => { calls++; return payload; });
    expect(first).toEqual(cached);
    expect(calls).toBe(1);

    // 超过 5 分钟后过期
    now += 5 * 60_000 + 1;
    await coord.execute('scope-a', 'idem-1', undefined, async () => { calls++; return payload; });
    expect(calls).toBe(2);

    // 同空间并发请求被拒绝，跨空间互不阻塞
    let release!: () => void;
    const running = coord.execute('scope-a', 'idem-2', undefined, () => new Promise(resolve => { release = () => resolve(payload); }));
    await expect(coord.execute('scope-a', 'idem-3', undefined, async () => payload)).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    await expect(coord.execute('scope-b', 'idem-3', undefined, async () => payload)).resolves.toEqual(payload);
    release();
    await running;
  });
});
