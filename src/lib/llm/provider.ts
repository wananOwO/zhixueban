import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getConfig } from './config';

export class MissingApiKeyError extends Error {
  constructor() {
    super('未配置 LLM API Key。请在设置页填写 API Key（或配置环境变量 LLM_API_KEY）后重试。');
    this.name = 'MissingApiKeyError';
  }
}

function requireKey(): string {
  const apiKey = getConfig('llm_api_key', 'LLM_API_KEY');
  if (!apiKey) throw new MissingApiKeyError();
  return apiKey;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * LLM 模型工厂。配置优先级：WebUI 设置（settings 表）> 环境变量。
 * LLM_PROVIDER=anthropic 时走 Anthropic 原生 SDK，否则走 OpenAI 兼容接口
 * （DeepSeek/智谱/OpenAI 均可）。
 */
export function getModel() {
  const apiKey = requireKey();
  const provider = getConfig('llm_provider') ?? 'openai-compatible';
  const modelId = getConfig('llm_model') ?? 'deepseek-chat';

  if (provider === 'anthropic') {
    return createAnthropic({ apiKey })(modelId);
  }
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: getConfig('llm_base_url', 'LLM_BASE_URL') ?? DEFAULT_BASE_URL,
  });
  return compat.chatModel(modelId);
}

/** Embedding 模型工厂，独立配置项（缺省跟随 LLM 的 baseURL） */
export function getEmbeddingModel() {
  const apiKey = getConfig('embedding_api_key') ?? requireKey();
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL:
      getConfig('embedding_base_url') ??
      getConfig('llm_base_url', 'LLM_BASE_URL') ??
      DEFAULT_BASE_URL,
  });
  return compat.embeddingModel(getConfig('embedding_model', 'EMBEDDING_MODEL') ?? 'text-embedding-3-small');
}
