import { describe, expect, test } from 'vitest';
import { modelConnection, settingsPatch, type Settings } from '@/lib/settings';

const saved: Settings = {
  llm_provider: 'openai-compatible', llm_model: 'chat', llm_base_url: 'https://example.test/v1',
  llm_api_key: 'sto***ey', embedding_model: 'embedding', embedding_base_url: '', embedding_api_key: '',
  mcp_servers: [], judge0_url: '', obsidian_vault_path: '',
};
const draft = { ...saved, llm_api_key: '', embedding_api_key: '' };

describe('设置草稿只提交明确的修改', () => {
  test('原样保存不会将密钥掩码写回，也不复制环境配置', () => {
    expect(settingsPatch(draft, saved, [])).toEqual({});
  });
  test('空白输入保留密钥，明确清除和替换分别提交', () => {
    expect(settingsPatch(draft, saved, ['llm_api_key'])).toEqual({ llm_api_key: '' });
    expect(settingsPatch({ ...draft, llm_api_key: ' new-key ' }, saved, ['llm_api_key']))
      .toEqual({ llm_api_key: 'new-key' });
  });
  test('清空字段以及连续添加的多个 MCP 项都保留在一次提交中', () => {
    const original = { ...saved, judge0_url: 'https://judge.test' };
    const servers = [{ name: 'one', url: 'https://one.test' }, { name: 'two', url: 'https://two.test' }];
    expect(settingsPatch({ ...draft, mcp_servers: servers }, original, []))
      .toEqual({ judge0_url: '', mcp_servers: servers });
  });
  test('Embedding 留空时继承对话地址和 Key，但仍使用独立模型', () => {
    expect(modelConnection({ ...saved, llm_api_key: 'real-key' }, 'embedding')).toEqual({
      provider: 'openai-compatible', baseURL: 'https://example.test/v1',
      apiKey: 'real-key', modelId: 'embedding',
    });
  });
  test('Anthropic 空地址使用原生默认地址，而非 DeepSeek', () => {
    expect(modelConnection({ ...saved, llm_provider: 'anthropic', llm_base_url: '' }, 'llm').baseURL)
      .toBe('https://api.anthropic.com/v1');
  });
});
