import type { Model, Api } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { stream as streamOpenAI } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { getConfig } from '../../llm/config';

export interface AgentConnection { model: Model<Api>; streamFn: StreamFn }

/** 只使用本应用显式配置，不发现 Pi CLI 的个人凭据或项目工具。 */
export function createAgentConnection(): AgentConnection {
  const apiKey = getConfig('llm_api_key');
  if (!apiKey) throw new Error('请先在设置页配置 API Key');
  const anthropic = getConfig('llm_provider') === 'anthropic';
  const model: Model<Api> = {
    id: getConfig('llm_model') || 'deepseek-chat', name: '学习模型',
    api: anthropic ? 'anthropic-messages' : 'openai-completions', provider: 'learning-provider',
    baseUrl: getConfig('llm_base_url') || (anthropic ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'),
    reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
  };
  if (anthropic) model.baseUrl = model.baseUrl.replace(/\/v1\/?$/, '');
  // 内容分节提交；输出截断由 Pi 拒绝执行并要求Agent缩小单次提交，而非发布残缺内容。
  return { model, streamFn: (_model, context, options) => {
    // SDK默认请求计时器会报 Request timed out；设为24小时，实际只服从任务取消信号。
    const fetchWithoutDeadline: typeof fetch = (url, init) => fetch(url, { ...init, signal: options?.signal });
    const requestOptions = { ...options, apiKey, maxRetries: 0, timeoutMs: 24 * 60 * 60 * 1000, fetch: fetchWithoutDeadline };
    return anthropic
      ? streamAnthropic(model as Model<'anthropic-messages'>, context, { ...requestOptions, toolChoice: 'any', maxTokens: 8192 })
      : streamOpenAI(model as Model<'openai-completions'>, context, { ...requestOptions, toolChoice: 'required' });
  } };
}
