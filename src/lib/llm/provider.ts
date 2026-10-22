import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getConfig } from './config';

export class MissingApiKeyError extends Error {
  constructor() {
    super('未配置 LLM API Key。请在设置页填写 LLM_API_KEY（或在 .env.local 中配置）后重试。');
    this.name = 'MissingApiKeyError';
  }
}

function requireEnv(name: string): string {
  const value = getConfig(name.toLowerCase());
  if (!value) throw new MissingApiKeyError();
  return value;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * LLM 模型工厂：默认走 OpenAI 兼容接口（DeepSeek/智谱/OpenAI 均可），
 * LLM_PROVIDER=anthropic 时走 Anthropic 原生 SDK。
 * 配置优先级：WebUI settings 表 > LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY
 */
export function getModel() {
  const apiKey = requireEnv('LLM_API_KEY');
  const provider = getConfig('llm_provider') ?? 'openai-compatible';
  const modelId = getConfig('llm_model') ?? 'deepseek-chat';

  if (provider === 'anthropic') {
    return createAnthropic({ apiKey, baseURL: getConfig('llm_base_url') })(modelId);
  }
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: getConfig('llm_base_url') ?? DEFAULT_BASE_URL,
  });
  return compat.chatModel(modelId);
}

/** Embedding 模型工厂。环境变量：EMBEDDING_MODEL / EMBEDDING_BASE_URL（默认同 LLM） */
export function getEmbeddingModel() {
  const apiKey = getConfig('embedding_api_key') ?? requireEnv('LLM_API_KEY');
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: getConfig('embedding_base_url') ?? getConfig('llm_base_url') ?? DEFAULT_BASE_URL,
  });
  return compat.embeddingModel(getConfig('embedding_model') ?? 'text-embedding-3-small');
}
