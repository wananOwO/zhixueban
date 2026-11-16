import { describe, expect, it } from 'vitest';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';

describe('Embedding profile', () => {
  it('不包含 Key 且配置变化会生成不同 profile', () => {
    const a = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1/', model: 'embed', dimensions: 3 }, 'v1');
    const b = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://other.example.com/v1', model: 'embed', dimensions: 3 }, 'v1');
    expect(a.profileId).not.toBe(b.profileId);
    expect(JSON.stringify(a)).not.toContain('secret');
  });

  it('未声明维度时仍可建立 profile，维度由实际向量决定', () => {
    const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed' }, 'v1');
    expect(profile.dimensions).toBeNull();
    expect(profile.profileId).toMatch(/^embedding:[0-9a-f]{32}$/);
  });

  it('拒绝带凭据或非 HTTP(S) 地址', () => {
    expect(() => createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://user:secret@example.com/v1', model: 'embed', dimensions: 3 }, 'v1')).toThrow('地址');
    expect(() => createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'file:///tmp/x', model: 'embed', dimensions: 3 }, 'v1')).toThrow('地址');
  });
});
