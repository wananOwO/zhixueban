import { createHash } from 'node:crypto';

export interface EmbeddingConfig {
  provider: string;
  baseUrl: string;
  model: string;
  /** 请求供应商返回的维度；省略时由实际向量长度决定，同一来源内必须一致 */
  dimensions?: number | null;
}

export interface EmbeddingProfile extends EmbeddingConfig {
  dimensions: number | null;
  profileId: string;
  preprocessVersion: string;
}

/**
 * 向量只属于这一组非秘密配置：协议 + 规范化地址 + 模型名 + 维度 + 预处理版本。
 * API Key 不参与 profile，也不能出现在返回值里；不同供应商即使同名同维也不混用。
 */
export function createEmbeddingProfile(config: EmbeddingConfig, preprocessVersion: string): EmbeddingProfile {
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new Error('Embedding 地址不合法'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Embedding 地址不合法');
  if (!config.model.trim() || !preprocessVersion.trim()) throw new Error('Embedding 配置不合法');
  if (config.dimensions !== undefined && config.dimensions !== null && (!Number.isInteger(config.dimensions) || config.dimensions <= 0)) throw new Error('Embedding 配置不合法');
  const normalized = { provider: config.provider, baseUrl: url.href.replace(/\/$/, ''), model: config.model.trim(), dimensions: config.dimensions ?? null, preprocessVersion };
  const profileId = `embedding:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32)}`;
  return { ...normalized, profileId };
}
