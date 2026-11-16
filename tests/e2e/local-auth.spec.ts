import { expect, test } from '@playwright/test';
import { baseRoutes, mockApi } from './mock-api';

test('本地免登录直接进入，桌面和移动菜单不显示退出', async ({ page }) => {
  await mockApi(page, {
    ...baseRoutes,
    'GET /mode': () => ({ data: { mode: 'local', authRequired: false, uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null } }),
    'GET /textbooks': () => ({ data: [] }),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '今天从哪继续' })).toBeVisible();
  await expect(page.getByLabel('本机密码')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出', includeHidden: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '退出' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('link', { name: '教材库' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '教材库' })).toBeVisible();
});

test('本地固定密码原样提交，错误提示配置文件，退出返回登录', async ({ page }) => {
  let authenticated = false;
  const calls = await mockApi(page, {
    ...baseRoutes,
    'GET /mode': () => ({ data: { mode: 'local', authRequired: true, uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null } }),
    'GET /access': () => authenticated ? { data: { authenticated: true } } : { status: 401, error: { code: 'UNAUTHENTICATED', message: '请先登录' } },
    'POST /access': ({ body }) => {
      if ((body as { token: string }).token !== ' 固定密码 ') return { status: 401, error: { code: 'UNAUTHENTICATED', message: '密码不正确' } };
      authenticated = true;
      return { data: { expiresAt: '2026-11-18T00:00:00Z' } };
    },
    'DELETE /access': () => { authenticated = false; return { data: { loggedOut: true } }; },
    'GET /textbooks': () => ({ data: [] }),
  });
  await page.goto('/');
  await page.getByLabel('本机密码').fill('wrong');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '密码不正确' })).toContainText('VL_LOCAL_PASSWORD');
  await page.getByLabel('本机密码').fill(' 固定密码 ');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '今天从哪继续' })).toBeVisible();
  expect(calls.filter(c => c.method === 'POST' && c.path === '/access').at(-1)?.body).toEqual({ token: ' 固定密码 ' });
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '本机登录' })).toBeVisible();
});
