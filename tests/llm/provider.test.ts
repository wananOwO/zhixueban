import { afterEach, describe, expect, test } from 'vitest';
import { getModel, getEmbeddingModel, MissingApiKeyError } from '@/lib/llm/provider';
import { loadSubjectPrompt } from '@/lib/llm/prompts';

describe('llm provider', () => {
  afterEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  test('缺少 API Key 时抛出中文配置指引', () => {
    delete process.env.LLM_API_KEY;
    expect(() => getModel()).toThrow(MissingApiKeyError);
    expect(() => getModel()).toThrow(/设置页/);
  });

  test('默认走 OpenAI 兼容接口', () => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_MODEL = 'deepseek-chat';
    process.env.LLM_BASE_URL = 'https://api.deepseek.com/v1';
    const model = getModel();
    expect(model.provider).toContain('openai-compatible');
  });

  test('LLM_PROVIDER=anthropic 时走 Anthropic 分支', () => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-4-5';
    expect(getModel().provider).toContain('anthropic');
  });

  test('getEmbeddingModel 同样需要 Key', () => {
    delete process.env.LLM_API_KEY;
    expect(() => getEmbeddingModel()).toThrow(MissingApiKeyError);
  });
});

describe('loadSubjectPrompt', () => {
  test('加载内置学科提示词', () => {
    const p = loadSubjectPrompt('computer');
    expect(p.length).toBeGreaterThan(50);
    expect(p).toContain('代码');
  });

  test('未知类型回退 general', () => {
    expect(loadSubjectPrompt('不存在的学科')).toBe(loadSubjectPrompt('general'));
  });
});
