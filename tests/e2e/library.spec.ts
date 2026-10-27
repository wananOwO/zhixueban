import { expect, test } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

test.describe('首页与教材库', () => {
  test('空库首页显示三步引导，点击上传教材进入教材库', async ({ page }) => {
    await mockApi(page, { ...baseRoutes, 'GET /textbooks': () => ({ data: [] }) });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '今天从哪继续' })).toBeVisible();
    const steps = page.getByRole('list', { name: '开始使用的三个步骤' });
    await expect(steps.getByRole('heading', { name: '上传教材' })).toBeVisible();
    await expect(steps.getByRole('heading', { name: '写下学习目标' })).toBeVisible();
    await steps.getByRole('link', { name: '去上传教材' }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('heading', { level: 1, name: '教材库' })).toBeVisible();
  });

  test('上传教材后出现在列表；不支持的格式被拒绝', async ({ page }) => {
    let books: unknown[] = [];
    await mockApi(page, {
      ...baseRoutes,
      'GET /textbooks': () => ({ data: books }),
      'POST /textbooks': () => { books = [book()]; return { status: 201, data: book() }; },
    });
    await page.goto('/library');
    await expect(page.getByText('还没有教材')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'tutorial.md', mimeType: 'text/markdown', buffer: Buffer.from('# 第一章\n内容') });
    await expect(page.getByRole('link', { name: 'Python 官方教程' }).first()).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'slides.pptx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
    await expect(page.getByRole('region', { name: '上传教材' }).getByRole('alert')).toContainText('不支持 .pptx 格式');
  });

  test('线上模式上传上限为 20 MiB，超过时在前端直接拒绝', async ({ page }) => {
    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /mode': () => ({ data: { mode: 'online', uploadLimitBytes: 20 * 1024 * 1024, booksPerSpace: 10 } }),
      'GET /textbooks': () => ({ data: [] }),
    });
    await page.goto('/library');
    await expect(page.getByText(/单本不超过 20 MiB，最多 10 本/)).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(21 * 1024 * 1024, 97) });
    await expect(page.getByRole('region', { name: '上传教材' }).getByRole('alert')).toContainText('超过 20 MiB 的上限');
    expect(calls.some(c => c.method === 'POST' && c.path === '/textbooks')).toBe(false);
  });

  test('教材详情按 #p-段号 定位并高亮该段', async ({ page }) => {
    const paragraphs = (offset: number) => Array.from({ length: 100 }, (_, i) => ({ paragraphIndex: offset + i, text: `第 ${offset + i} 段原文`, contentHash: 'h' }));
    await mockApi(page, {
      ...baseRoutes,
      'GET /textbooks/b1': () => ({ data: book() }),
      'GET /textbooks/b1/deletion': () => ({ data: { bookId: 'b1', revision: 0, blocked: false, blockers: [] } }),
      'GET /textbooks/b1/chapters/ch1': ({ url }) => {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return { data: { chapterId: 'ch1', title: '第一章 课前甜点', paragraphs: paragraphs(offset), nextOffset: offset + 100 < 300 ? offset + 100 : null } };
      },
    });
    await page.goto('/library/b1#p-120');
    const target = page.locator('#p-120');
    await expect(target).toBeVisible();
    await expect(target.locator('p')).toHaveAttribute('aria-current', 'location');
    await expect(target.locator('p')).toHaveText('第 120 段原文');
  });

  test('删除需要输入完整书名；被课程使用时只能归档', async ({ page }) => {
    let blockers: unknown[] = [];
    await mockApi(page, {
      ...baseRoutes,
      'GET /textbooks/b1': () => ({ data: book() }),
      'GET /textbooks/b1/deletion': () => ({ data: { bookId: 'b1', revision: 0, blocked: blockers.length > 0, blockers } }),
      'GET /textbooks/b1/chapters/ch1': () => ({ data: { chapterId: 'ch1', title: '第一章', paragraphs: [], nextOffset: null } }),
    });
    await page.goto('/library/b1');
    await page.getByRole('button', { name: '彻底删除' }).click();
    const dialog = page.getByRole('dialog', { name: '彻底删除这本资料？' });
    const confirm = dialog.getByRole('button', { name: '确认删除' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/书名/).fill('Python 官方');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/书名/).fill('Python 官方教程');
    await expect(confirm).toBeEnabled();
    await page.keyboard.press('Escape');

    blockers = [{ kind: 'course', id: 'v1', courseId: 'c1', status: 'active' }];
    await page.reload();
    await expect(page.getByText('一门未确认的课程')).toBeVisible();
    await expect(page.getByRole('button', { name: '彻底删除' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '归档' })).toBeVisible();
  });
});
