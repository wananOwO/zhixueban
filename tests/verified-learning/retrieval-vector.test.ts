import { describe, expect, it } from 'vitest';
import { cosineSimilarity, decodeVector, encodeVector } from '@/lib/verified-learning/retrieval/vector';

describe('检索向量工具', () => {
  it('编码和解码保持 Float32 数值与维度', () => {
    const blob = encodeVector([1, 0.5, -2]);
    expect(decodeVector(blob, 3)).toEqual(new Float32Array([1, 0.5, -2]));
  });

  it('拒绝 NaN、无穷、零向量和错误维度', () => {
    expect(() => encodeVector([Number.NaN])).toThrow('向量值不合法');
    expect(() => encodeVector([Number.POSITIVE_INFINITY])).toThrow('向量值不合法');
    expect(() => encodeVector([0, 0])).toThrow('向量不能为零');
    expect(() => decodeVector(Buffer.alloc(4), 2)).toThrow('向量维度不匹配');
  });

  it('计算归一化向量的余弦相似度', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });
});
