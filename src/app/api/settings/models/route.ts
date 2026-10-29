import { embed, generateText } from 'ai';
import { z } from 'zod';
import { DEMO_READ_ONLY_MSG, isDemoMode } from '@/lib/demo';
import { checkKeyDestination, getSettings } from '@/lib/llm/config';
import { getEmbeddingModel, getModel } from '@/lib/llm/provider';
import { modelConnection, settingsSchema, type ModelConnection } from '@/lib/settings';

export const runtime = 'nodejs';

const requestSchema = z.object({
  action: z.enum(['list', 'test']),
  target: z.enum(['llm', 'embedding']),
  settings: settingsSchema.partial(),
}).strict();

const listSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(300) })).max(10000),
  has_more: z.boolean().optional(),
  last_id: z.string().optional(),
});

async function listModels(connection: ModelConnection, signal: AbortSignal): Promise<string[]> {
  const anthropic = connection.provider === 'anthropic';
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': connection.apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${connection.apiKey}` };
  const models = new Set<string>();
  const cursors = new Set<string>();
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${connection.baseURL}/models`);
    if (anthropic) {
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after_id', cursor);
    }
    const response = await fetch(url, { headers, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error('Model list request failed'), { statusCode: response.status });
    const body = listSchema.parse(await response.json());
    for (const model of body.data) models.add(model.id);
    if (!anthropic || !body.has_more) return [...models].sort();
    if (!body.last_id || cursors.has(body.last_id)) break;
    cursor = body.last_id;
    cursors.add(cursor);
  }
  throw new Error('Invalid model list pagination');
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) {
    return Response.json({ error: '请在本站设置页操作' }, { status: 403 });
  }
  if (isDemoMode()) return Response.json({ error: DEMO_READ_ONLY_MSG }, { status: 403 });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: '请检查接口类型、API 地址及模型配置。' }, { status: 400 });
  }
  const { action, target, settings: patch } = parsed.data;
  const saved = getSettings();
  try {
    checkKeyDestination(saved, patch, target);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  const connection = modelConnection({ ...saved, ...patch }, target);
  if (!connection.apiKey) return Response.json({ error: '请先填写 API Key。' }, { status: 400 });
  if (action === 'test' && !connection.modelId) {
    return Response.json({ error: '请先选择或填写模型名。' }, { status: 400 });
  }

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(15000)]);
  try {
    if (action === 'list') return Response.json({ models: await listModels(connection, signal) });
    if (target === 'embedding') {
      const { embedding } = await embed({
        model: getEmbeddingModel(connection), value: '连接测试', maxRetries: 0, abortSignal: signal,
      });
      if (!embedding.length || !embedding.every(Number.isFinite)) throw new Error('Invalid embedding');
      return Response.json({ ok: true, dimensions: embedding.length });
    }
    const result = await generateText({
      model: getModel(connection), prompt: 'Reply with OK.', maxOutputTokens: 64,
      maxRetries: 0, abortSignal: signal,
    });
    if (!result.text.trim()) throw new Error('Empty model response');
    return Response.json({ ok: true });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) {
      return Response.json({ error: '连接超时或已取消，请检查服务地址后重试。' }, { status: 504 });
    }
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const message = status === 401 || status === 403
      ? '认证失败，请检查 API Key 和模型访问权限。'
      : status === 404
        ? '服务未找到该接口或模型，请检查 API 地址（通常包含 /v1）；模型名也可手动填写。'
        : status === 429
          ? '请求频率或服务额度受限，请稍后重试并检查余额。'
          : status === 400 || status === 422
            ? '服务不接受当前模型或请求参数，请确认模型支持所选的对话 / Embedding 接口。'
            : '服务连接失败或返回格式不符，请检查地址、接口类型和模型能力后重试；模型名也可手动填写。';
    // Never return upstream bodies: they may echo credentials or internal addresses.
    return Response.json({ error: message }, { status: 502 });
  }
}
