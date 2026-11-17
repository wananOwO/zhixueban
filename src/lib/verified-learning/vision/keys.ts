import type Database from 'better-sqlite3';
import { z } from 'zod';
import { getConfig } from '@/lib/llm/config';
import { assertPublicUrl } from '../agent/web';
import { LearningError } from '../contracts';

/**
 * 视觉模型配置（设计 6.4）：
 * - 线上模式使用独立 X-VL-Vision 头（缺省时可回退 X-VL-Model 聊天模型）；
 * - 本地模式优先读取 vision_* 设置，未填时可回退 llm_* 聊天模型；
 * - Key 只在浏览器 localStorage 与单次请求内存，绝不写入数据库任务、检查点或日志。
 */
export interface VisionConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  model: string;
  apiKey: string;
}

const DEFAULT_BASE: Record<VisionConfig['provider'], string> = {
  'openai-compatible': 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

const MAX_HEADER = 8192;
const schema = z.strictObject({
  provider: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().trim().max(2000).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }),
  model: z.string().trim().min(1).max(300),
  apiKey: z.string().trim().min(1).max(4096),
});

function invalid(): never {
  throw new LearningError('INVALID_INPUT', '视觉模型配置格式不合法，请在设置中重新填写');
}

export function encodeVisionHeader(config: VisionConfig): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}

export function parseVisionHeader(value: string | null): VisionConfig | null {
  if (value === null || value === '') return null;
  if (value.length > MAX_HEADER || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { invalid(); }
  const result = schema.safeParse(parsed);
  if (!result.success) invalid();
  return result.data;
}

/** 线上模式下视觉地址来自浏览器：只允许公网，拒绝内网与云元数据地址 */
export async function assertPublicVisionAddress(config: VisionConfig): Promise<void> {
  try {
    await assertPublicUrl(config.baseUrl);
  } catch {
    throw new LearningError('INVALID_INPUT', '线上站只能连接公网视觉模型服务（HTTPS 默认端口）');
  }
}

/** 本地模式：优先独立视觉配置（vision_*），未填视觉模型时复用聊天模型（llm_*） */
export function resolveLocalVisionConfig(db: Database.Database): VisionConfig | null {
  const read = (key: string): string => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return (row?.value || getConfig(key) || '').trim();
  };

  const visionModel = read('vision_model');
  if (visionModel) {
    const providerRaw = read('vision_provider') || read('llm_provider') || 'openai-compatible';
    const provider: VisionConfig['provider'] = providerRaw === 'anthropic' ? 'anthropic' : 'openai-compatible';
    const baseUrl = read('vision_base_url') || read('llm_base_url') || DEFAULT_BASE[provider];
    const apiKey = read('vision_api_key') || read('llm_api_key');
    if (!apiKey) return null;
    return { provider, baseUrl, model: visionModel, apiKey };
  }

  const chatModel = read('llm_model');
  const chatKey = read('llm_api_key');
  if (!chatModel || !chatKey) return null;
  const providerRaw = read('llm_provider') || 'openai-compatible';
  const provider: VisionConfig['provider'] = providerRaw === 'anthropic' ? 'anthropic' : 'openai-compatible';
  const baseUrl = read('llm_base_url') || DEFAULT_BASE[provider];
  return { provider, baseUrl, model: chatModel, apiKey: chatKey };
}
