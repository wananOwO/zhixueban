import { z } from 'zod';
import { parse } from './backend-contracts';
import { LearningError } from './contracts';
import { AppError } from './errors';

/** 消息仅来自下方固定文案，不包含上游正文或凭据。 */
export class ModelListError extends AppError {}

const querySchema = z.strictObject({
  provider: z.enum(['openai-compatible', 'anthropic']).optional(),
  baseUrl: z.string().trim().max(2000).optional(),
  apiKey: z.string().trim().max(4096).optional(),
});
function baseAddress(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new LearningError('INVALID_INPUT', 'API 地址不合法'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new LearningError('INVALID_INPUT', 'API 地址必须为不含凭据和查询参数的 HTTP(S) 地址');
  return url.toString().replace(/\/$/, '');
}
const defaultBase = (provider: string) => provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.deepseek.com/v1';

/** 只查询模型元数据，不保存表单、不调用生成；禁止重定向转发密钥。 */
export async function listModels(input: unknown, saved: Record<string, string | undefined>) {
  const query = parse(querySchema, input);
  const storedProvider = saved.llm_provider || 'openai-compatible';
  const provider = query.provider ?? storedProvider;
  const storedBase = baseAddress(saved.llm_base_url || defaultBase(storedProvider));
  const base = baseAddress(query.baseUrl || (provider === storedProvider ? storedBase : defaultBase(provider)));
  if (!query.apiKey && (base !== storedBase || provider !== storedProvider)) throw new LearningError('INVALID_INPUT', '更换地址或供应商后，请明确输入该供应商的 API 密钥再拉取模型');
  const apiKey = query.apiKey || saved.llm_api_key;
  if (!apiKey) throw new LearningError('INVALID_INPUT', '请先填写 API 密钥');
  const headers: Record<string, string> = provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  const models = new Map<string, { id: string; name: string }>();
  const signal = AbortSignal.timeout(15000);
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(base + '/models');
    if (provider === 'anthropic') { url.searchParams.set('limit', '1000'); if (after) url.searchParams.set('after_id', after); }
    let response: Response;
    try { response = await fetch(url, { headers, signal, redirect: 'error', cache: 'no-store' }); }
    catch { throw new ModelListError('PROVIDER_ERROR', '模型列表连接失败或超时，请检查地址后重试'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelListError('PROVIDER_ERROR', response.status === 401 || response.status === 403 ? '供应商鉴权失败，请核对 API 密钥' : `供应商未能提供模型列表（HTTP ${response.status}），可重试或手动填写模型`);
    }
    let body: { data?: unknown; has_more?: boolean; last_id?: string };
    try {
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(value); }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || !Array.isArray(body.data)) throw new Error();
    } catch { throw new ModelListError('PROVIDER_ERROR', '供应商返回的模型列表格式不支持或过大，可手动填写模型'); }
    for (const item of body.data as { id?: unknown; display_name?: unknown }[]) {
      if (item && typeof item.id === 'string' && item.id.trim() && item.id.length <= 300) models.set(item.id, { id: item.id, name: typeof item.display_name === 'string' ? item.display_name.slice(0, 300) : item.id });
    }
    if (!body.has_more) return { models: [...models.values()], truncated: false };
    if (provider !== 'anthropic' || typeof body.last_id !== 'string' || body.last_id === after) return { models: [...models.values()], truncated: true };
    after = body.last_id;
  }
  return { models: [...models.values()], truncated: true };
}
