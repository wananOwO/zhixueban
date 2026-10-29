// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useModelKey, modelHeaderValue } from '@/lib/stores/model-key';
import { parseModelHeader } from '@/lib/verified-learning/model-keys';

const config = { provider: 'openai-compatible' as const, baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-browser-only', model: 'deepseek-chat' };

beforeEach(() => { localStorage.clear(); useModelKey.getState().clear(); });
afterEach(() => localStorage.clear());

describe('浏览器端模型配置（线上模式）', () => {
  it('保存后写入 localStorage，清除后移除', () => {
    useModelKey.getState().set(config);
    expect(localStorage.getItem('vl-model')).toContain('sk-browser-only');
    useModelKey.getState().clear();
    expect(useModelKey.getState().config).toBeNull();
    expect(localStorage.getItem('vl-model') ?? '').not.toContain('sk-browser-only');
  });
  it('请求头值可被服务端解析还原；未保存时为 null', () => {
    expect(modelHeaderValue()).toBeNull();
    useModelKey.getState().set(config);
    expect(parseModelHeader(modelHeaderValue())).toEqual(config);
  });
});
