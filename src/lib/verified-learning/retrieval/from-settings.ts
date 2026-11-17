import type Database from 'better-sqlite3';
import { getConfig } from '@/lib/llm/config';
import { createEmbeddingPort } from './embedding';
import { createEmbeddingProfile, type EmbeddingProfile } from './profile';
import { createRetrievalService, type RetrievalService } from './service';

/** 预处理版本：分块规则或清洗规则变化时递增，使旧向量自然失效 */
export const PREPROCESS_VERSION = 'paragraph-v2';

export interface EmbeddingSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions?: number | null;
}

/** 从本地设置表/环境变量读取 Embedding 配置；缺任一必填项时返回 null（只用关键词检索） */
export function embeddingSettings(db: Database.Database): EmbeddingSettings | null {
  const row = (key: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? getConfig(key);
  const model = row('embedding_model')?.trim();
  if (!model) return null;
  const apiKey = (row('embedding_api_key') || row('llm_api_key'))?.trim();
  const baseUrl = (row('embedding_base_url') || row('llm_base_url'))?.trim();
  if (!apiKey || !baseUrl) return null;
  return { baseUrl, model, apiKey };
}

export interface RetrievalBundle {
  service: RetrievalService;
  profile: EmbeddingProfile | null;
  settings: EmbeddingSettings | null;
  publicOnly: boolean;
}

/**
 * 为一个空间构造统一检索服务：
 * - 有 Embedding 配置时启用关键词 + 向量混合检索；
 * - 无配置时仍返回统一检索服务（执行分词+二元组+章节加权的关键词检索），绝不返回空壳。
 * - online=true 时绝不读取服务器数据库 settings 表，仅使用显式传入的浏览器配置。
 */
export function retrievalBundle(
  db: Database.Database,
  scopeId: string,
  options: { settings?: EmbeddingSettings | null; publicOnly?: boolean; online?: boolean } = {},
): RetrievalBundle {
  const settings = options.settings !== undefined ? options.settings : (options.online ? null : embeddingSettings(db));
  if (!settings) {
    return {
      service: createRetrievalService(db, scopeId),
      profile: null,
      settings: null,
      publicOnly: options.publicOnly === true,
    };
  }
  const profile = createEmbeddingProfile(
    { provider: 'openai-compatible', baseUrl: settings.baseUrl, model: settings.model, dimensions: settings.dimensions ?? null },
    PREPROCESS_VERSION,
  );
  const port = createEmbeddingPort(
    { baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey, dimensions: settings.dimensions ?? undefined },
    { publicOnly: options.publicOnly },
  );
  return {
    service: createRetrievalService(db, scopeId, { profile, embed: port.embed }),
    profile,
    settings,
    publicOnly: options.publicOnly === true,
  };
}

/** 供 UI 展示的非秘密配置描述（不含 API Key 与路径外凭据） */
export function embeddingProfileView(settings: EmbeddingSettings, dimensions?: number | null) {
  const profile = createEmbeddingProfile(
    { provider: 'openai-compatible', baseUrl: settings.baseUrl, model: settings.model, dimensions: dimensions ?? null },
    PREPROCESS_VERSION,
  );
  return {
    profileId: profile.profileId,
    baseUrl: profile.baseUrl,
    model: profile.model,
    preprocessVersion: PREPROCESS_VERSION,
    dimensions: dimensions ?? null,
  };
}
