// 页面截图：自动用本地口令登录后，按指定宽度截图（供视觉自检）。
// 用法：node scripts/shot.mjs <路径> <输出前缀> [宽度,宽度...] [--full] [--no-login]
// 口令读取自 scripts/dev-local.ps1 写入的 %TEMP%\vl-dev-token.txt。
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [route = '/', prefix = path.join(tmpdir(), 'vl-shot'), widthsArg = '1440,390', ...flags] = process.argv.slice(2);
const base = process.env.VL_BASE ?? 'http://127.0.0.1:3101';
const widths = widthsArg.split(',').map(Number);
const full = flags.includes('--full');
const login = !flags.includes('--no-login');

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ locale: 'zh-CN' });
  if (login) {
    const token = readFileSync(path.join(tmpdir(), 'vl-dev-token.txt'), 'utf8').trim();
    const response = await context.request.post(`${base}/api/verified-learning/v1/access`, {
      data: { token }, headers: { origin: base },
    });
    if (!response.ok()) throw new Error(`登录失败：HTTP ${response.status()}`);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const file = `${prefix}-${width}.png`;
    await page.screenshot({ path: file, fullPage: full });
    console.log(file);
  }
  if (errors.length) console.log('页面错误：\n' + [...new Set(errors)].join('\n'));
} finally {
  await browser.close();
}
