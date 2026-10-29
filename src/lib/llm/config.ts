import { getDb } from '@/lib/db';
import { defaultBaseUrl, modelConnection, type ModelTarget, type Settings } from '@/lib/settings';

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
    // An explicitly cleared WebUI value overrides the environment, too.
    if (row) return row.value || undefined;
  } catch {
    // 数据库不可用（如构建期）时直接走环境变量
  }
  return process.env[envName ?? key.toUpperCase()] || undefined;
}

export function getSettings(): Settings {
  const provider = getConfig('llm_provider') === 'anthropic' ? 'anthropic' : 'openai-compatible';
  return {
    llm_provider: provider,
    llm_model: getConfig('llm_model') ?? (provider === 'anthropic' ? '' : 'deepseek-chat'),
    llm_base_url: getConfig('llm_base_url') ?? defaultBaseUrl(provider),
    llm_api_key: getConfig('llm_api_key') ?? '',
    embedding_model: getConfig('embedding_model') ?? 'text-embedding-3-small',
    embedding_base_url: getConfig('embedding_base_url') ?? '',
    embedding_api_key: getConfig('embedding_api_key') ?? '',
    judge0_url: getConfig('judge0_url') ?? '',
    obsidian_vault_path: getConfig('obsidian_vault_path') ?? '',
    mcp_servers: JSON.parse(getConfig('mcp_servers') ?? '[]'),
  };
}

export function checkKeyDestination(saved: Settings, patch: Partial<Settings>, target: ModelTarget): void {
  const next = { ...saved, ...patch };
  const connection = modelConnection(next, target);
  const keyField = target === 'embedding' && next.embedding_api_key ? 'embedding_api_key' : 'llm_api_key';
  const trusted = (['llm', 'embedding'] as const).some((kind) => {
    const previous = modelConnection(saved, kind);
    return previous.apiKey === connection.apiKey && previous.provider === connection.provider &&
      new URL(previous.baseURL).origin === new URL(connection.baseURL).origin;
  });
  if (connection.apiKey && !patch[keyField] && !trusted) {
    throw new Error('更换服务域名或接口类型后，请重新输入对应 API Key，避免旧密钥被发送到新服务。');
  }
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
