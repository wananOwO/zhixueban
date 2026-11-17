import { expect, test } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

test.describe('教材详情：语义索引面板', () => {
  test('显示待发送段落与字符数，显式确认后建立索引，完成后支持重建且失败可重试', async ({ page }) => {
    let state: Record<string, unknown> = {
      status: 'none',
      profileId: 'embedding:abc',
      ready: 0,
      failed: 0,
      total: 40,
      paragraphCount: 38,
      charCount: 12_800,
      baseUrl: 'https://api.example.com/v1',
      jobId: null,
      usable: false,
      resumable: false,
      leaseExpired: false,
      error: null,
      configured: true,
      model: 'text-embedding-3-small',
    };

    const calls = await mockApi(page, {
      ...baseRoutes,
      'GET /textbooks/b1': () => ({ data: book() }),
      'GET /textbooks/b1/deletion': () => ({ data: { bookId: 'b1', revision: 0, blocked: false, blockers: [] } }),
      'GET /textbooks/b1/chapters/ch1': () => ({
        data: { chapterId: 'ch1', title: '第一章 课前甜点', paragraphs: [{ paragraphIndex: 0, text: '第一段原文', contentHash: 'h0' }], nextOffset: null },
      }),
      'GET /textbooks/b1/retrieval-index': () => ({ data: state }),
      'POST /textbooks/b1/retrieval-index': () => {
        state = { ...state, status: 'succeeded', ready: 40, usable: true, jobId: 'idx-job-1' };
        return { status: 202, data: { jobId: 'idx-job-1', status: 'queued' } };
      },
      'POST /retrieval-jobs/idx-job-1/resume': () => {
        state = { ...state, status: 'succeeded', ready: 40, failed: 0, usable: true, error: null };
        return { status: 202, data: { jobId: 'idx-job-1', status: 'queued' } };
      },
    });

    await page.goto('/library/b1');
    await expect(page.getByText('尚未建立语义索引')).toBeVisible();
    await page.getByRole('button', { name: '建立语义索引' }).click();

    // 确认面板展示段落数、字符数、供应商地址与费用说明
    const confirmBox = page.getByRole('group', { name: '确认建立语义索引' });
    await expect(confirmBox).toContainText('38 个段落');
    await expect(confirmBox).toContainText('12,800 字');
    await expect(confirmBox).toContainText('https://api.example.com/v1');
    await expect(confirmBox).toContainText('模型账户承担');
    expect(calls.some(c => c.method === 'POST' && c.path === '/textbooks/b1/retrieval-index')).toBe(false);

    await confirmBox.getByRole('button', { name: '确认建立' }).click();
    await expect(page.getByText('索引已完成')).toBeVisible();
    await expect(page.getByText('语义检索已可用')).toBeVisible();
    await expect(page.getByRole('button', { name: '重建索引' })).toBeVisible();

    // 模拟失败状态仍可使用关键词检索并支持重试
    state = {
      ...state,
      status: 'failed',
      ready: 20,
      failed: 20,
      usable: false,
      resumable: true,
      error: { code: 'EMBEDDING_FAILED', message: 'Embedding 服务暂时不可用，当前自动使用关键词检索', retryable: true },
    };
    await page.reload();
    await expect(page.locator('main').getByRole('alert')).toContainText('关键词检索');
    await page.getByRole('button', { name: '重试索引' }).click();
    await expect(page.getByText('索引已完成')).toBeVisible();
  });
});
