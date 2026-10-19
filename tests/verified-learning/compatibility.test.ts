import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTest } from '@/lib/db';
import { parseTextbook } from '@/lib/textbook/parse';
import { MissingApiKeyError } from '@/lib/llm/provider';
import { POST } from '@/app/api/textbooks/route';

vi.mock('@/lib/textbook/parse', () => ({ parseTextbook: vi.fn() }));
vi.mock('ai', () => ({ embedMany: vi.fn(async () => ({ embeddings: [[0, 1]] })) }));
vi.mock('@/lib/rag/store', () => ({ upsertChunks: vi.fn() }));

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'verified-upload-'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('LLM_API_KEY', 'test-only-key');
  resetDbForTest();
  vi.mocked(parseTextbook).mockResolvedValue({
    title: 'Book', format: 'txt',
    chapters: [{ id: 'c1', title: 'Chapter', level: 1, paragraphs: [{ text: 'Content', anchor: { chapterId: 'c1', index: 0 } }] }],
  });
});
afterEach(() => {
  resetDbForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function request(filename?: string) {
  const form = new FormData();
  if (filename) form.set('file', new File(['content'], filename));
  return new Request('http://localhost/api/textbooks', { method: 'POST', body: form });
}
async function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error).toBe('string');
  expect(body.error.length).toBeGreaterThan(0);
  return body;
}
describe('legacy textbook POST contract', () => {
  it('keeps the exact HTTP 200 success keys and real textbook persistence', async () => {
    const response = await POST(request('book.txt'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['chapterCount', 'textbookId']);
    expect(body).toEqual({ textbookId: expect.any(String), chapterCount: 1 });
    expect(getDb().prepare('SELECT id, title FROM textbooks').all()).toEqual([{ id: body.textbookId, title: 'Book' }]);
    expect(readdirSync(path.join(root, 'data', 'uploads'))).toEqual([`${body.textbookId}.txt`]);
  });
  it('keeps missing-file errors at 400', async () => {
    await expectError(await POST(request()), 400);
    expect(readdirSync(root)).toEqual([]);
  });
  it('keeps invalid-format errors at 400', async () => {
    await expectError(await POST(request('book.exe')), 400);
    expect(readdirSync(root)).toEqual([]);
  });
  it('keeps MissingApiKeyError at 400 and removes its uploaded file', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    expect(await expectError(await POST(request('book.txt')), 400)).toEqual({ error: new MissingApiKeyError().message });
    expect(readdirSync(path.join(root, 'data', 'uploads'))).toEqual([]);
  });
  it('keeps parse failures at 422 and removes their uploaded files', async () => {
    vi.mocked(parseTextbook).mockRejectedValueOnce(new Error('parse failed'));
    expect(await expectError(await POST(request('book.txt')), 422)).toEqual({ error: 'parse failed' });
    expect(readdirSync(path.join(root, 'data', 'uploads'))).toEqual([]);
  });
});
