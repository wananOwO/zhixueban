import { createHash } from 'node:crypto';

export interface EmbeddingConfig {
  provider: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingProfile extends EmbeddingConfig {
  profileId: string;
  preprocessVersion: string;
}

export function createEmbeddingProfile(config: EmbeddingConfig, preprocessVersion: string): EmbeddingProfile {
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new Error('Embedding 地址不合法'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Embedding 地址不合法');
  if (!config.model.trim() || !Number.isInteger(config.dimensions) || config.dimensions <= 0) throw new Error('Embedding 配置不合法');
  const normalized = { provider: config.provider, baseUrl: url.href.replace(/\/$/, ''), model: config.model.trim(), dimensions: config.dimensions, preprocessVersion };
  const profileId = `embedding:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32)}`;
  return { ...normalized, profileId };
}
