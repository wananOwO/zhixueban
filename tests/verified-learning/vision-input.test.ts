import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  readMultipartForm,
  validateImageFile,
} from '@/lib/verified-learning/vision/input';

function file(bytes: Uint8Array, name: string, type: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

async function makeRealImage(format: 'png' | 'jpeg' | 'webp', width = 120, height = 80, withExif = false): Promise<Uint8Array> {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 245, g: 242, b: 235 } },
  });
  if (withExif) {
    pipeline = pipeline.withExif({ IFD0: { Artist: 'SecretAuthorName', Software: 'PrivateDeviceGPS' } });
  }
  const buf = format === 'png'
    ? await pipeline.png().toBuffer()
    : format === 'jpeg'
      ? await pipeline.jpeg().toBuffer()
      : await pipeline.webp().toBuffer();
  return new Uint8Array(buf);
}

/** 伪造超大尺寸或 0 尺寸的最小 PNG 头（用于测试文件头拦截与损坏负载拒绝） */
function fakePngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  header.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return header;
}

describe('截图输入安全校验与像素重编码', () => {
  it('接受真实 PNG/JPEG/WebP 并完成像素解码与重编码', async () => {
    const pngBytes = await makeRealImage('png', 200, 120);
    const jpegBytes = await makeRealImage('jpeg', 160, 100);
    const webpBytes = await makeRealImage('webp', 140, 90);

    const png = await validateImageFile(file(pngBytes, 'a.png', 'image/png'));
    expect(png).toMatchObject({ mimeType: 'image/png', width: 200, height: 120, pixelCount: 24_000 });
    expect(await validateImageFile(file(jpegBytes, 'b.jpg', 'image/jpeg'))).toMatchObject({ mimeType: 'image/jpeg', width: 160, height: 100 });
    expect(await validateImageFile(file(webpBytes, 'c.webp', 'image/webp'))).toMatchObject({ mimeType: 'image/webp', width: 140, height: 90 });
  });

  it('剥离原始 EXIF 元信息且不保留原图 Buffer 引用或文件名', async () => {
    const rawWithExif = await makeRealImage('jpeg', 120, 90, true);
    expect(Buffer.from(rawWithExif).toString('latin1')).toContain('SecretAuthorName');

    const cleaned = await validateImageFile(file(rawWithExif, 'private-photo.jpg', 'image/jpeg'));
    expect(Buffer.from(cleaned.bytes).toString('latin1')).not.toContain('SecretAuthorName');
    expect(Buffer.from(cleaned.bytes).toString('latin1')).not.toContain('PrivateDeviceGPS');
    expect(cleaned.bytes.buffer).not.toBe(rawWithExif.buffer);
    expect(Object.keys(cleaned).sort()).toEqual(['bytes', 'height', 'mimeType', 'pixelCount', 'width']);
    expect(JSON.stringify({ ...cleaned, bytes: cleaned.bytes.length })).not.toContain('private-photo');
  });

  it('按真实文件头与解码结果校验，拒绝截断伪造头、SVG、远程 URL 与空文件', async () => {
    const realJpeg = await makeRealImage('jpeg', 100, 80);
    // 扩展名和声明 MIME 伪装成 png，按真实头识别为 image/jpeg；若声明为非图像 MIME（如 application/pdf）则拒绝
    await expect(validateImageFile(file(realJpeg, 'x.png', 'image/png'))).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    await expect(validateImageFile(file(realJpeg, 'x.pdf', 'application/pdf'))).rejects.toThrow(/MIME|格式/);
    // 只有 PNG 文件头但无合法像素数据的损坏图片必须拒绝
    await expect(validateImageFile(file(fakePngHeader(100, 100), 'corrupt.png', 'image/png'))).rejects.toThrow(/损坏|解码|格式/);
    await expect(validateImageFile(file(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml'))).rejects.toThrow(/不支持 SVG/);
    await expect(validateImageFile(file(new Uint8Array(0), 'x.png', 'image/png'))).rejects.toThrow(/空/);
    await expect(validateImageFile(file(new TextEncoder().encode('https://example.com/a.png'), 'a.txt', 'text/plain'))).rejects.toThrow(/格式/);
  });

  it('拒绝超过 5 MiB、超过 1600 万像素、最长边超过 4096 与尺寸为 0 的图片', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(fakePngHeader(10, 10));
    await expect(validateImageFile(file(huge, 'big.png', 'image/png'))).rejects.toThrow(/5 MiB/);
    await expect(validateImageFile(file(fakePngHeader(4000, 4001), 'wide.png', 'image/png'))).rejects.toThrow(/像素/);
    await expect(validateImageFile(file(fakePngHeader(4097, 100), 'long.png', 'image/png'))).rejects.toThrow(/4096/);
    await expect(validateImageFile(file(fakePngHeader(0, 0), 'zero.png', 'image/png'))).rejects.toThrow(/尺寸/);
    expect(MAX_IMAGE_PIXELS).toBe(16_000_000);
  });

  it('在流式读取请求阶段即拦截超大 multipart 请求体', async () => {
    const form = new FormData();
    form.set('file', file(new Uint8Array(2048), 'big.bin', 'image/png'));
    const req = new Request('http://127.0.0.1:3101/upload', { method: 'POST', body: form });
    await expect(readMultipartForm(req, 512)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
