// 设计检查：design-taste-frontend 的 inspect.mjs 用一次性浏览器、不能登录。
// 这里先用 Playwright 登录并把渲染完成的页面另存为静态快照（样式、字体内联到同目录），再交给 inspect.mjs。
// 用法：node scripts/inspect-page.mjs <路径> <名称> [--widths 1440,768,390]
// 快照保存在 .superpowers/inspect/<名称>/index.html，不提交。
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [route = '/', name = 'page', ...rest] = process.argv.slice(2);
const widthsIndex = rest.indexOf('--widths');
const widths = widthsIndex >= 0 ? rest[widthsIndex + 1] : '1440,768,390';
const base = process.env.VL_BASE ?? 'http://127.0.0.1:3101';
const out = path.resolve('.superpowers', 'inspect', name);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const token = readFileSync(path.join(tmpdir(), 'vl-dev-token.txt'), 'utf8').trim();
  const login = await context.request.post(`${base}/api/verified-learning/v1/access`, { data: { token }, headers: { origin: base } });
  if (!login.ok()) throw new Error(`登录失败：HTTP ${login.status()}`);
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  // 收集样式表与字体文件，改写为本地相对路径
  const assets = new Map();
  const download = async (url) => {
    if (assets.has(url)) return assets.get(url);
    const file = `asset-${assets.size}${path.extname(new URL(url).pathname) || '.bin'}`;
    assets.set(url, file);
    const response = await context.request.get(url);
    let body = await response.body();
    if (file.endsWith('.css')) {
      let css = body.toString('utf8');
      for (const match of [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]) {
        const absolute = new URL(match[2], url).href;
        if (absolute.startsWith('data:')) continue;
        css = css.replace(match[0], `url(${await download(absolute)})`);
      }
      body = Buffer.from(css);
    }
    writeFileSync(path.join(out, file), body);
    return file;
  };
  let html = await page.evaluate(() => {
    // 去掉脚本：快照是静态的；保留 DOM 与内联样式
    for (const script of document.querySelectorAll('script, nextjs-portal')) script.remove();
    return '<!DOCTYPE html>' + document.documentElement.outerHTML;
  });
  for (const match of [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"[^>]*>/g)]) {
    const local = await download(new URL(match[1], base).href);
    html = html.replace(match[1], local);
  }
  writeFileSync(path.join(out, 'index.html'), html);
  console.log(path.join(out, 'index.html'));
} finally {
  await browser.close();
}

const inspect = 'C:/Users/Windows/.pi/agent/skills/design-taste-frontend/scripts/inspect.mjs';
const result = spawnSync(process.execPath, [inspect, path.join(out, 'index.html'), '--app', '--widths', widths, '--out', path.join(out, 'shots')], { encoding: 'utf8' });
const text = result.stdout + result.stderr;
const keep = text.split('\n').filter(line => /FAIL|WARN|\[|RESULT|sizes in use|typefaces|line\(s\)/.test(line));
console.log(keep.join('\n'));
