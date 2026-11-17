import type Database from 'better-sqlite3';
import path from 'node:path';
import { z } from 'zod';
import { parse } from './backend-contracts';

const text = z.string().trim().max(300);
const url = z.string().trim().max(2000).refine(value => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
});
const secret = z.string().trim().max(4096);
// 本机 Obsidian vault：只接受绝对路径（笔记写入时再检查是否存在）
const folder = z.string().trim().max(1000).refine(value => !value || path.isAbsolute(value), '请填写绝对路径');

const schema = z.strictObject({
  llm_provider: z.enum(['openai-compatible', 'anthropic']).nullable().optional(),
  llm_model: text.nullable().optional(),
  llm_base_url: url.nullable().optional(),
  llm_api_key: secret.nullable().optional(),
  embedding_model: text.nullable().optional(),
  embedding_base_url: url.nullable().optional(),
  embedding_api_key: secret.nullable().optional(),
  vision_provider: z.enum(['openai-compatible', 'anthropic']).nullable().optional(),
  vision_model: text.nullable().optional(),
  vision_base_url: url.nullable().optional(),
  vision_api_key: secret.nullable().optional(),
  obsidian_vault_path: folder.nullable().optional(),
});
const keys = Object.keys(schema.shape);

/** 只返回配置状态，不返回密钥或其片段。 */
export function readSettings(db: Database.Database) {
  const result: Record<string, string | boolean> = {};
  for (const key of keys) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    const value = row?.value || process.env[key.toUpperCase()] || '';
    if (key.endsWith('_api_key')) result[`${key}_configured`] = Boolean(value);
    else result[key] = value;
  }
  result.llm_provider ||= 'openai-compatible';
  return result;
}

export function saveSettings(db: Database.Database, input: unknown) {
  const patch = parse(schema, input);
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      // 密钥输入留空表示保持原值；显式 null 才删除网页覆盖配置。
      if (key.endsWith('_api_key') && value === '') continue;
      if (value === null || value === '') db.prepare('DELETE FROM settings WHERE key=?').run(key);
      else db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    }
  })();
  return readSettings(db);
}
