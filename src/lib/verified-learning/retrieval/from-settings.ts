import type Database from 'better-sqlite3';
import { getConfig } from '@/lib/llm/config';
import { createEmbeddingPort } from './embedding';
import { createEmbeddingProfile, type EmbeddingProfile } from './profile';
import { createRetrievalService, type RetrievalService } from './service';

/** 预处理版本：分块规则或清洗规则变化时递增，使旧向量自然失效 */
export const PREPROCESS_VERSION = 'paragraph-v1';

export interface EmbeddingSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions?: number | null;
}

/** 从设置表/环境变量读取 Embedding 配置；缺任一必填项时返回 null（只用关键词检索） */
export function embeddingSettings(db: Database.Database): EmbeddingSettings | null {
  const row = (key: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? getConfig(key);
  const model = row('embedding_model')?.trim();
  if (!model) return null;
  const apiKey = row('embedding_api_key') || row('llm_api_key');
  const baseUrl = row('embedding_base_url') || row('llm_base_url');
  if (!apiKey || !baseUrl) return null;
  return { baseUrl, model, apiKey };
}

export interface RetrievalBundle {
  service: RetrievalService;
  profile: EmbeddingProfile;
  settings: EmbeddingSettings;
  publicOnly: boolean;
}

/**
 * 为一个空间构造检索服务：配置缺失时返回 null，调用方退回关键词检索。
 * publicOnly=true（线上模式）时每次请求都校验公网地址，凭据只在内存里。
 */
export function retrievalBundle(db: Database.Database, scopeId: string, options: { settings?: EmbeddingSettings | null; publicOnly?: boolean } = {}): RetrievalBundle | null {
  const settings = options.settings ?? embeddingSettings(db);
  if (!settings) return null;
  const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: settings.baseUrl, model: settings.model, dimensions: settings.dimensions ?? null }, PREPROCESS_VERSION);
  const port = createEmbeddingPort({ baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey, dimensions: settings.dimensions ?? undefined }, { publicOnly: options.publicOnly });
  return { service: createRetrievalService(db, scopeId, { profile, embed: port.embed }), profile, settings, publicOnly: options.publicOnly === true };
}

/** 供 UI 展示的非秘密配置描述 */
export function embeddingProfileView(settings: EmbeddingSettings, dimensions?: number | null) {
  const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: settings.baseUrl, model: settings.model, dimensions: dimensions ?? null }, PREPROCESS_VERSION);
  return { profileId: profile.profileId, model: settings.model, preprocessVersion: PREPROCESS_VERSION, dimensions: dimensions ?? null };
}