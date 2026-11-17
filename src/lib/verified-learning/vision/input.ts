import sharp from 'sharp';
import { LearningError } from '../contracts';
import { AppError } from '../errors';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_EDGE = 4096;
/** multipart/form-data 边界开销预留 64 KiB，流式阶段即强制限制请求体总大小 */
export const MAX_VISION_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  pixelCount: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ALLOWED_DECLARED_MIMES = new Set(['', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/octet-stream']);

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 30) return false;
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  const form = String.fromCharCode(...bytes.subarray(8, 12));
  return head === 'RIFF' && form === 'WEBP';
}

function pngHeaderSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegHeaderSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

function webpHeaderSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8X') {
    return {
      width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
      height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
    };
  }
  if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: 0, height: 0 };
}

function assertDimensions(width: number, height: number): number {
  if (!width || !height) throw new LearningError('INVALID_INPUT', '图片尺寸无法识别，请重新截图');
  const pixelCount = width * height;
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    throw new LearningError('INVALID_INPUT', '图片最长边超过 4096 像素，请裁剪后再试');
  }
  if (pixelCount > MAX_IMAGE_PIXELS) {
    throw new LearningError('INVALID_INPUT', '图片像素超过 1600 万，请裁剪后再试');
  }
  return pixelCount;
}

/**
 * 流式限制 multipart 请求体大小，防止 21 MiB 部署上限绕过应用层 5 MiB 截图上限。
 */
export async function readMultipartForm(request: Request, maxBytes = MAX_VISION_MULTIPART_BYTES): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data') || !request.body) {
    throw new LearningError('INVALID_INPUT', '需要 multipart/form-data 图片请求');
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', '图片超过 5 MiB，请裁剪后再试');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AppError('PAYLOAD_TOO_LARGE', '图片超过 5 MiB，请裁剪后再试');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bounded = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: Buffer.concat(chunks),
  });
  return bounded.formData();
}

/**
 * 截图输入安全校验：
 * 1. 检查声明 MIME 与大小上限（<= 5 MiB），拒绝 SVG 与非图片类型；
 * 2. 检查真实文件头（PNG/JPEG/WebP）与头部尺寸上限（<= 4096 边长、<= 1600 万像素）；
 * 3. 用带 limitInputPixels 的 sharp 实际解码像素并重新编码，防御压缩炸弹、拒绝截断损坏文件、彻底剥离 EXIF/GPS/设备元信息；
 * 4. 返回全新的像素编码字节，不保留原 File、原文件名或原 Buffer 引用。
 */
export async function validateImageFile(file: File): Promise<ValidatedImage> {
  if (!file.size) throw new LearningError('INVALID_INPUT', '图片为空，请重新截图');
  if (file.size > MAX_IMAGE_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', '图片超过 5 MiB，请裁剪后再试');

  const declaredMime = (file.type ?? '').trim().toLowerCase();
  if (declaredMime === 'image/svg+xml') {
    throw new LearningError('INVALID_INPUT', '不支持 SVG，请改用 PNG 或 JPEG 截图');
  }
  if (!ALLOWED_DECLARED_MIMES.has(declaredMime)) {
    throw new LearningError('INVALID_INPUT', '图片 MIME 格式不受支持（仅 PNG/JPEG/WebP）');
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  if (rawBytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', '图片超过 5 MiB，请裁剪后再试');
  }

  let detectedMime: ValidatedImage['mimeType'] | null = null;
  let headerSize = { width: 0, height: 0 };
  if (isPng(rawBytes)) {
    detectedMime = 'image/png';
    headerSize = pngHeaderSize(rawBytes);
  } else if (isJpeg(rawBytes)) {
    detectedMime = 'image/jpeg';
    headerSize = jpegHeaderSize(rawBytes);
  } else if (isWebp(rawBytes)) {
    detectedMime = 'image/webp';
    headerSize = webpHeaderSize(rawBytes);
  } else {
    const headText = new TextDecoder().decode(rawBytes.subarray(0, Math.min(64, rawBytes.length))).trim();
    if (/^(<\?xml|<svg)/i.test(headText)) {
      throw new LearningError('INVALID_INPUT', '不支持 SVG，请改用 PNG 或 JPEG 截图');
    }
    throw new LearningError('INVALID_INPUT', '不是支持的图片格式（仅 PNG/JPEG/WebP）');
  }

  assertDimensions(headerSize.width, headerSize.height);

  try {
    // rotate() 根据方向重置像素排列且不调用 withMetadata()，从而彻底清除 EXIF/XMP/IPTC/ICC 等隐私元信息
    const decoder = sharp(rawBytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', sequentialRead: true }).rotate();
    const reencoded = detectedMime === 'image/png'
      ? await decoder.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true })
      : detectedMime === 'image/jpeg'
        ? await decoder.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
        : await decoder.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });

    const width = reencoded.info.width;
    const height = reencoded.info.height;
    const pixelCount = assertDimensions(width, height);
    if (reencoded.data.byteLength > MAX_IMAGE_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', '图片重编码后超过 5 MiB，请裁剪后再试');
    }

    const cleanCopy = new Uint8Array(reencoded.data.byteLength);
    cleanCopy.set(reencoded.data);
    return {
      bytes: cleanCopy,
      mimeType: detectedMime,
      width,
      height,
      pixelCount,
    };
  } catch (error) {
    if (error instanceof LearningError || error instanceof AppError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    if (/pixel limit/i.test(msg)) {
      throw new LearningError('INVALID_INPUT', '图片像素超过 1600 万，请裁剪后再试');
    }
    throw new LearningError('INVALID_INPUT', '图片已损坏或无法解码，请重新截图后再试');
  }
}
