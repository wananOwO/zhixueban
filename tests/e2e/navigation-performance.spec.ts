import { expect, test, type Page } from '@playwright/test';
import { baseRoutes, book, mockApi } from './mock-api';

const course = {
  courseId: 'c1', versionId: 'v1', status: 'active',
  snapshot: { goal: '导航测试课程', outline: [], sourceRevisions: [] },
};

async function setup(page: Page, delay = 0) {
  return mockApi(page, {
    ...baseRoutes,
    'GET /courses': () => ({ data: [course] }),
    'GET /textbooks': async () => {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return { data: [book()] };
    },
    'GET /notes': () => ({ data: [] }),
    'GET /settings': () => ({ data: {} }),
  });
}

async function clickToContent(page: Page) {
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '教材库' }).click();
  await expect(page.getByRole('link', { name: 'Python 官方教程', exact: true }).filter({ visible: true })).toBeVisible();
  return Math.round(await page.evaluate(() => performance.now()) - start);
}

test('性能样本：冷切换与意图预热后切换（模拟接口延迟 150ms）', async ({ page }, info) => {
  const calls = await setup(page, 150);
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { level: 1, name: '课程草稿' })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { navMarker: string }).navMarker = '同一文档'; });
  const cold = await clickToContent(page);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '课程草稿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '课程草稿' })).toBeVisible();
  await page.evaluate(() => { document.querySelector('header')!.setAttribute('data-persistent', 'yes'); });
  const before = calls.filter(c => c.path === '/textbooks').length;
  const warm = await clickToContent(page);
  expect(calls.filter(c => c.path === '/textbooks').length).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { navMarker: string }).navMarker)).toBe('同一文档');
  await expect(page.locator('header')).toHaveAttribute('data-persistent', 'yes');
  // 刷新重建 QueryClient，让意图预热样本不是上一轮页面访问留下的缓存。
  await page.mouse.move(0, 0);
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { level: 1, name: '课程草稿' })).toBeVisible();
  const library = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '教材库' });
  const warmed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/textbooks'));
  await library.focus();
  await warmed;
  const intent = await clickToContent(page);
  const result = { coldClickToDataMs: cold, cachedClickToDataMs: warm, intentPrefetchedClickToDataMs: intent, environment: '本地生产构建，模拟接口固定延迟150ms，单次样本含Playwright点击成本' };
  console.log('NAVIGATION_SAMPLE', JSON.stringify(result));
  await info.attach('navigation-sample', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('课程标签本地切换：保留版本与锚点，不请求 RSC，前进后退同步', async ({ page }) => {
  await setup(page);
  await page.goto('/courses/c1?versionId=v1&tab=unknown#notes');
  await expect(page.getByRole('tab', { name: '路线图' })).toHaveAttribute('aria-selected', 'true');
  const rsc: string[] = [];
  page.on('request', request => {
    if (request.headers().rsc === '1' && new URL(request.url()).pathname === '/courses/c1' && !request.headers()['next-router-prefetch']) rsc.push(request.url());
  });
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(page.getByText('还没有笔记')).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('versionId')).toBe('v1');
  expect(url.searchParams.get('tab')).toBe('notes');
  expect(rsc).toEqual([]);
  expect(url.hash).toBe('#notes');
  await page.evaluate(() => window.history.pushState(null, '', '?versionId=v1&tab=history#notes'));
  await expect(page.getByRole('tab', { name: '历史回看' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('tab', { name: '笔记', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.getByRole('tab', { name: '历史回看' })).toHaveAttribute('aria-selected', 'true');
});

test('键盘意图在点击前预热教材，进入目标页复用结果', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { level: 1, name: '课程草稿' })).toBeVisible();
  const link = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '教材库' });
  await link.focus();
  await expect.poll(() => calls.filter(c => c.path === '/textbooks').length).toBe(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Python 官方教程', exact: true }).filter({ visible: true })).toBeVisible();
  expect(calls.filter(c => c.path === '/textbooks')).toHaveLength(1);
});

test('真实浏览器轻动效：仅内容区运动，连续导航不中断交互', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    const samples: { duration: number | string | undefined; inContent: boolean }[] = [];
    Object.assign(window, { routeMotionSamples: samples });
    Element.prototype.animate = function (frames, options) {
      if (typeof options === 'object' && options.duration === 160) samples.push({ duration: options.duration, inContent: !!this.closest('#main') });
      return original.call(this, frames, options);
    };
  });
  await setup(page);
  await page.goto('/drafts');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '教材库' }).click();
  await nav.getByRole('link', { name: '我的课程' }).click();
  await nav.getByRole('link', { name: '教材库' }).click();
  await expect(page.getByRole('link', { name: 'Python 官方教程', exact: true }).filter({ visible: true })).toBeVisible();
  const samples = await page.evaluate(() => (window as unknown as { routeMotionSamples: { duration: number; inContent: boolean }[] }).routeMotionSamples);
  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every(sample => sample.duration === 160 && sample.inContent)).toBe(true);
  await page.evaluate(async () => {
    await Promise.all(document.querySelector('#main')!.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  expect(await page.locator('#main > div').evaluate(element => getComputedStyle(element).transform)).toBe('none');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const path = info.outputPath(`navigation-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(`navigation-${width}`, { path, contentType: 'image/png' });
  }
});

test('减少动态效果与移动菜单导航', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/drafts');
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('dialog').getByRole('link', { name: '教材库' }).click();
  await expect(page.getByRole('link', { name: 'Python 官方教程', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const motion = await page.evaluate(() => document.querySelector('#main')!.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().duration === 160).length);
  expect(motion).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
