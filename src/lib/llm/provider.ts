import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { EmbeddingModel, LanguageModel } from 'ai';

export class MissingApiKeyError extends Error {
  constructor() {
    super('未配置 LLM API Key。请在设置页填写 LLM_API_KEY（或在 .env.local 中配置）后重试。');
    this.name = 'MissingApiKeyError';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new MissingApiKeyError();
  return value;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * LLM 模型工厂：默认走 OpenAI 兼容接口（DeepSeek/智谱/OpenAI 均可），
 * LLM_PROVIDER=anthropic 时走 Anthropic 原生 SDK。
 * 环境变量：LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY
 */
export function getModel(): LanguageModel {
  const apiKey = requireEnv('LLM_API_KEY');
  const provider = process.env.LLM_PROVIDER ?? 'openai-compatible';
  const modelId = process.env.LLM_MODEL ?? 'deepseek-chat';

  if (provider === 'anthropic') {
    return createAnthropic({ apiKey })(modelId);
  }
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
  });
  return compat.chatModel(modelId);
}

/** Embedding 模型工厂。环境变量：EMBEDDING_MODEL / EMBEDDING_BASE_URL（默认同 LLM） */
export function getEmbeddingModel(): EmbeddingModel {
  const apiKey = requireEnv('LLM_API_KEY');
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
  });
  return compat.embeddingModel(process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small');
}
