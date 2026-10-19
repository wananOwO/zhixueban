import { getDb } from '@/lib/db';

/**
 * 配置解析：数据库 settings 表优先，环境变量兜底。
 * key 为 settings 表键名（snake_case）；envName 为对应环境变量名。
 * 约定：llm_api_key → LLM_API_KEY（大写即环境变量名）
 */
export function getConfig(key: string, envName?: string): string | undefined {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (row?.value) return row.value;
  } catch {
    // 数据库不可用（如构建期）时直接走环境变量
  }
  return process.env[envName ?? key.toUpperCase()];
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
