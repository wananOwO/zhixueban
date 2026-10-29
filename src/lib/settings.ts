import { z } from 'zod';

const text = z.string().trim().max(2000);
const httpUrl = text.refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}, '请填写 http:// 或 https:// 地址，不包含账号、密码或锚点');
const baseUrl = httpUrl.refine((value) => !value.includes('?'), 'API 地址请勿包含查询参数');
const secret = text.refine((value) => !value.includes('***'), '请输入完整密钥，脱敏占位符不是密钥');

export const settingsSchema = z.object({
  llm_provider: z.enum(['openai-compatible', 'anthropic']),
  llm_model: text,
  llm_base_url: baseUrl,
  llm_api_key: secret,
  embedding_model: text,
  embedding_base_url: baseUrl,
  embedding_api_key: secret,
  judge0_url: httpUrl,
  obsidian_vault_path: text,
  mcp_servers: z.array(z.object({
    name: text.min(1, '请填写 MCP 名称'),
    url: httpUrl.refine(Boolean, '请填写 MCP 地址'),
  }).strict()).max(30).refine(
    (servers) => new Set(servers.map((s) => s.name)).size === servers.length,
    'MCP 服务器名称重复',
  ),
}).strict();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsSnapshot = Settings & { readOnly: boolean; hasIndexedContent: boolean };
export type ModelTarget = 'llm' | 'embedding';
export type SecretKey = 'llm_api_key' | 'embedding_api_key';

export function defaultBaseUrl(provider: Settings['llm_provider']): string {
  return provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.deepseek.com/v1';
}

export interface ModelConnection {
  provider: Settings['llm_provider'];
  baseURL: string;
  modelId: string;
  apiKey: string;
}

export function modelConnection(settings: Settings, target: ModelTarget): ModelConnection {
  const base = settings.llm_base_url || defaultBaseUrl(settings.llm_provider);
  return target === 'llm'
    ? {
        provider: settings.llm_provider,
        baseURL: base.replace(/\/+$/, ''),
        modelId: settings.llm_model,
        apiKey: settings.llm_api_key,
      }
    : {
        provider: 'openai-compatible',
        baseURL: (settings.embedding_base_url || base).replace(/\/+$/, ''),
        modelId: settings.embedding_model,
        apiKey: settings.embedding_api_key || settings.llm_api_key,
      };
}

/** Only changed fields are sent; a blank key input means keep the saved key. */
export function settingsPatch(draft: Settings, saved: Settings, cleared: SecretKey[]): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(settingsSchema.shape) as (keyof Settings)[]) {
    if (key === 'llm_api_key' || key === 'embedding_api_key') {
      if (draft[key].trim()) patch[key] = draft[key].trim();
      else if (cleared.includes(key)) patch[key] = '';
    } else if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) {
      patch[key] = draft[key];
    }
  }
  return patch;
}
