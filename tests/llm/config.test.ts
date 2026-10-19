import { beforeEach, describe, expect, test } from 'vitest';
import { getModel, getEmbeddingModel, MissingApiKeyError } from '@/lib/llm/provider';
import { getConfig } from '@/lib/llm/config';
import { getDb, resetDbForTest } from '@/lib/db';

describe('配置解析：数据库设置优先，环境变量兜底', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
  });

  test('DB 无设置时读环境变量', () => {
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_MODEL = 'env-model';
    expect(getModel().modelId).toBe('env-model');
  });

  test('DB 设置覆盖环境变量', () => {
    process.env.LLM_API_KEY = 'env-key';
    process.env.LLM_MODEL = 'env-model';
    const db = getDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('llm_api_key', 'db-key');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('llm_model', 'db-model');
    expect(getModel().modelId).toBe('db-model');
  });

  test('DB 和环境变量都没有 Key 时抛中文错误', () => {
    expect(() => getModel()).toThrow(MissingApiKeyError);
  });

  test('embedding 独立配置：DB 的 embedding_model 生效', () => {
    const db = getDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('llm_api_key', 'k');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('embedding_model', 'emb-db');
    expect(getEmbeddingModel().modelId).toBe('emb-db');
  });

  test('judge0_url 也可走 DB 设置', () => {
    const db = getDb(':memory:');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('judge0_url', 'http://j:2358');
    expect(getConfig('judge0_url')).toBe('http://j:2358');
  });
});
