import { LearningError } from '../contracts';
import { AppError } from '../errors';
import { redact } from '../provider-error';
import { assertPublicUrl, publicOnlyFetch } from '../agent/web';
import type { EmbeddingPort } from './indexer';

export interface EmbeddingRequestConfig {
  /** OpenAI 兼容的 embeddings 接口根地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions?: number;
}

/**
 * OpenAI 兼容 embeddings 调用层。
 * publicOnly：线上模式（地址来自浏览器）逐次校验公网、禁止重定向；本地模式沿用普通 fetch。
 * 错误文本统一遮蔽 Key，请求正文（教材原文）不会出现在错误里。
 */
export function createEmbeddingPort(config: EmbeddingRequestConfig, options: { publicOnly?: boolean } = {}): EmbeddingPort {
  const send = options.publicOnly ? publicOnlyFetch : fetch;
  const url = `${config.baseUrl.replace(/\/$/, '')}/embeddings`;
  return {
    async embed(values: readonly string[]): Promise<number[][]> {
      if (!values.length) return [];
      // 地址来自浏览器时先明确拒绝内网/保留地址（配置错误，不是服务故障）
      if (options.publicOnly) {
        try { await assertPublicUrl(url); } catch { throw new LearningError('INVALID_INPUT', '线上站只能使用公网 Embedding 服务地址'); }
      }
      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, input: [...values], ...(config.dimensions ? { dimensions: config.dimensions } : {}) }),
      }).catch((error: unknown) => { throw new AppError('PROVIDER_ERROR', redact(error instanceof Error ? error.message : String(error))); });
      const text = await response.text();
      if (!response.ok) throw new AppError('PROVIDER_ERROR', redact(`Embedding 服务返回 HTTP ${response.status}`));
      let vectors: unknown;
      try { vectors = (JSON.parse(text) as { data?: { index?: number; embedding?: number[] }[] }).data; } catch { throw new AppError('PROVIDER_ERROR', 'Embedding 服务响应格式不合法'); }
      if (!Array.isArray(vectors) || vectors.length !== values.length) throw new AppError('PROVIDER_ERROR', 'Embedding 服务返回数量与请求不一致');
      return vectors.map(item => {
        if (!Array.isArray(item?.embedding) || !item.embedding.every((value: unknown) => typeof value === 'number')) throw new AppError('PROVIDER_ERROR', 'Embedding 服务返回的向量不合法');
        return item.embedding;
      });
    },
  };
}
