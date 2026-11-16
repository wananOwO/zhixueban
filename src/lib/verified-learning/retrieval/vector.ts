function assertFinite(values: readonly number[]): void {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) throw new Error('向量值不合法');
  if (values.every(value => value === 0)) throw new Error('向量不能为零');
}

export function encodeVector(values: readonly number[]): Buffer {
  assertFinite(values);
  const output = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => output.writeFloatLE(value, index * 4));
  return output;
}

export function decodeVector(blob: Buffer, dimensions: number): Float32Array {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || blob.length !== dimensions * 4) throw new Error('向量维度不匹配');
  const output = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index++) output[index] = blob.readFloatLE(index * 4);
  assertFinite([...output]);
  return output;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) throw new Error('向量维度不匹配');
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index++) {
    if (!Number.isFinite(a[index]) || !Number.isFinite(b[index])) throw new Error('向量值不合法');
    dot += a[index] * b[index]; normA += a[index] * a[index]; normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) throw new Error('向量不能为零');
  return dot / Math.sqrt(normA * normB);
}
