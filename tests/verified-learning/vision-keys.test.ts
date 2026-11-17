import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));
import { saveSettings, readSettings } from '@/lib/verified-learning/settings';
import {
  assertPublicVisionAddress,
  encodeVisionHeader,
  parseVisionHeader,
  resolveLocalVisionConfig,
  type VisionConfig,
} from '@/lib/verified-learning/vision/keys';

const config: VisionConfig = { provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'vision-mini', apiKey: 'sk-vision-secret' };

describe('视觉模型配置', () => {
  it('编码后可还原，超长与非法值拒绝', () => {
    expect(parseVisionHeader(encodeVisionHeader(config))).toEqual(config);
    expect(parseVisionHeader(null)).toBeNull();
    for (const bad of ['%%%', 'a'.repeat(9000), Buffer.from(JSON.stringify({ ...config, baseUrl: 'javascript:x' })).toString('base64url')]) {
      expect(() => parseVisionHeader(bad)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
  });

  it('错误信息不包含 Key', () => {
    try { parseVisionHeader(Buffer.from(JSON.stringify({ ...config, model: '' })).toString('base64url')); }
    catch (error) { expect(String(error)).not.toContain('sk-vision-secret'); }
  });

  it('线上模式只接受公网地址', async () => {
    await expect(assertPublicVisionAddress({ ...config, baseUrl: 'http://169.254.169.254/v1' })).rejects.toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await expect(assertPublicVisionAddress(config)).resolves.toBeUndefined();
  });

  it('本地模式优先使用独立视觉配置，未填时回退聊天模型且不回显 Key', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    saveSettings(db, {
      llm_provider: 'openai-compatible',
      llm_base_url: 'https://api.deepseek.com/v1',
      llm_model: 'deepseek-chat',
      llm_api_key: 'sk-chat-secret',
    });
    expect(resolveLocalVisionConfig(db)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-chat-secret',
    });

    const view = saveSettings(db, {
      vision_provider: 'anthropic',
      vision_base_url: 'https://api.anthropic.com/v1',
      vision_model: 'claude-sonnet-4-20250514',
      vision_api_key: 'sk-ant-vision-secret',
    });
    expect(view.vision_api_key_configured).toBe(true);
    expect(JSON.stringify(readSettings(db))).not.toContain('sk-ant-vision-secret');
    expect(resolveLocalVisionConfig(db)).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-vision-secret',
    });
    db.close();
  });
});
