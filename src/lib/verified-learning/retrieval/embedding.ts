import { LearningError } from '../contracts';
import { AppError } from '../errors';
import { withTransientSecret } from '../model-keys';
import { redact } from '../provider-error';
import { assertPublicUrl, publicOnlyFetch } from '../agent/web';
import type { EmbeddingPort } from './indexer';

export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;

export interface EmbeddingRequestConfig {
  /** OpenAI 兼容的 embeddings 接口根地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions?: number;
}

export interface EmbeddingPortOptions {
  publicOnly?: boolean;
  timeoutMs?: number;
}

/**
 * OpenAI 兼容 embeddings 调用层。
 * publicOnly：线上模式（地址来自浏览器）逐次校验公网、禁止重定向；本地模式沿用普通 fetch。
 * 单请求默认 30 秒超时，错误文本统一遮蔽 Key，教材原文不会出现在错误里。
 */
export function createEmbeddingPort(config: EmbeddingRequestConfig, options: EmbeddingPortOptions = {}): EmbeddingPort {
  const send = options.publicOnly ? publicOnlyFetch : fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
  const url = `${config.baseUrl.replace(/\/$/, '')}/embeddings`;

  return {
    async embed(values: readonly string[], callOptions?: { signal?: AbortSignal }): Promise<number[][]> {
      if (!values.length) return [];
      if (options.publicOnly) {
        try {
          await assertPublicUrl(url);
        } catch {
          throw new LearningError('INVALID_INPUT', '线上站只能使用公网 Embedding 服务地址');
        }
      }
      return withTransientSecret(config.apiKey, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Embedding 请求超时')), timeoutMs);
        const onAbort = () => controller.abort(callOptions?.signal?.reason);
        callOptions?.signal?.addEventListener('abort', onAbort, { once: true });
        if (callOptions?.signal?.aborted) onAbort();

        try {
          const response = await send(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({
              model: config.model,
              input: [...values],
              ...(config.dimensions ? { dimensions: config.dimensions } : {}),
            }),
            signal: controller.signal,
          }).catch((error: unknown) => {
            if (callOptions?.signal?.aborted) throw callOptions.signal.reason ?? new Error('任务已取消');
            throw new AppError('PROVIDER_ERROR', redact(error instanceof Error ? error.message : String(error)));
          });
          const text = await response.text();
          if (!response.ok) {
            throw new AppError('PROVIDER_ERROR', redact(`Embedding 服务返回 HTTP ${response.status}`));
          }
          let rawData: unknown;
          try {
            rawData = (JSON.parse(text) as { data?: { index?: number; embedding?: number[] }[] }).data;
          } catch {
            throw new AppError('PROVIDER_ERROR', 'Embedding 服务响应格式不合法');
          }
          if (!Array.isArray(rawData) || rawData.length !== values.length) {
            throw new AppError('PROVIDER_ERROR', 'Embedding 服务返回数量与请求不一致');
          }
          const items = rawData as { index?: unknown; embedding?: unknown }[];
          const hasValidIndices = items.every((item, idx) => typeof item?.index === 'number' && Number.isInteger(item.index) && item.index >= 0 && item.index < values.length)
            && new Set(items.map(item => item.index as number)).size === values.length;
          const ordered = hasValidIndices ? [...items].sort((a, b) => (a.index as number) - (b.index as number)) : items;

          return ordered.map(item => {
            if (!Array.isArray(item?.embedding) || !item.embedding.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
              throw new AppError('PROVIDER_ERROR', 'Embedding 服务返回的向量不合法');
            }
            return item.embedding as number[];
          });
        } finally {
          clearTimeout(timer);
          callOptions?.signal?.removeEventListener('abort', onAbort);
        }
      });
    },
  };
}
