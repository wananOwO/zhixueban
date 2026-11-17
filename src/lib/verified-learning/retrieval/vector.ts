import os from 'node:os';

const IS_LITTLE_ENDIAN = os.endianness() === 'LE';

function assertFiniteArray(values: ArrayLike<number>): void {
  if (values.length === 0) throw new Error('向量值不合法');
  let hasNonZero = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) throw new Error('向量值不合法');
    if (v !== 0) hasNonZero = true;
  }
  if (!hasNonZero) throw new Error('向量不能为零');
}

export function encodeVector(values: readonly number[]): Buffer {
  assertFiniteArray(values);
  if (IS_LITTLE_ENDIAN) {
    const f32 = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) f32[i] = values[i];
    assertFiniteArray(f32);
    return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  }
  const output = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index++) output.writeFloatLE(values[index], index * 4);
  return output;
}

export function decodeVector(blob: Buffer, dimensions: number): Float32Array {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || blob.byteLength !== dimensions * 4) {
    throw new Error('向量维度不匹配');
  }
  let output: Float32Array;
  if (IS_LITTLE_ENDIAN) {
    if (blob.byteOffset % 4 === 0) {
      output = new Float32Array(blob.buffer, blob.byteOffset, dimensions);
    } else {
      const aligned = new ArrayBuffer(dimensions * 4);
      new Uint8Array(aligned).set(new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength));
      output = new Float32Array(aligned);
    }
  } else {
    output = new Float32Array(dimensions);
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    for (let index = 0; index < dimensions; index++) output[index] = view.getFloat32(index * 4, true);
  }
  assertFiniteArray(output);
  return output;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) throw new Error('向量维度不匹配');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const va = a[index];
    const vb = b[index];
    if (!Number.isFinite(va) || !Number.isFinite(vb)) throw new Error('向量值不合法');
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) throw new Error('向量不能为零');
  return dot / Math.sqrt(normA * normB);
}
