import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getSettings } from './config';
import { modelConnection, type ModelConnection } from '@/lib/settings';

export class MissingApiKeyError extends Error {
  constructor() {
    super('未配置 LLM API Key。请在设置页填写 API Key（或配置环境变量 LLM_API_KEY）后重试。');
    this.name = 'MissingApiKeyError';
  }
}

/**
 * LLM 模型工厂。配置优先级：WebUI 设置（settings 表）> 环境变量。
 * LLM_PROVIDER=anthropic 时走 Anthropic 原生 SDK，否则走 OpenAI 兼容接口
 * （DeepSeek/智谱/OpenAI 均可）。
 */
export function getModel(connection: ModelConnection = modelConnection(getSettings(), 'llm')) {
  const { apiKey, provider, modelId, baseURL } = connection;
  if (!apiKey) throw new MissingApiKeyError();
  if (!modelId) throw new Error('请在设置页选择对话模型。');

  if (provider === 'anthropic') {
    return createAnthropic({ apiKey, baseURL, fetch: providerFetch })(modelId);
  }
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL,
    fetch: providerFetch,
  });
  return compat.chatModel(modelId);
}

/** Embedding 模型工厂，独立配置项（缺省跟随 LLM 的 baseURL） */
export function getEmbeddingModel(connection: ModelConnection = modelConnection(getSettings(), 'embedding')) {
  const { apiKey, baseURL, modelId } = connection;
  if (!apiKey) throw new MissingApiKeyError();
  const compat = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL,
    fetch: providerFetch,
  });
  return compat.embeddingModel(modelId);
}

// Provider credentials must not follow redirects to a different service.
const providerFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' });
