import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { learningEntries } from '@/lib/navigation';
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? pages(path.join(dir, entry.name)) : entry.name === 'page.tsx' ? [path.join(dir, entry.name)] : []);
}
describe('单一学习工作台', () => {
  it('五项主导航与全部静态页面一一对应', () => {
    const links = learningEntries.map(item => item.href);
    expect(links).toEqual(['/', '/verified-learning/textbooks', '/verified-learning/courses', '/verified-learning/drafts', '/settings']);
    const routes = pages('src/app').filter(file => !file.includes('[')).map(file => '/' + path.relative('src/app', path.dirname(file)).replaceAll('\\', '/'));
    expect(routes.sort()).toEqual([...links].sort());
  });
  it('删除旧页面与专用 API，不保留跳转壳', () => {
    for (const file of ['courses/page.tsx','courses/new/page.tsx','textbooks/page.tsx','stats/page.tsx','learn/[courseId]/page.tsx','verified-learning/page.tsx','verified-learning/legacy/page.tsx','api/courses/route.ts','api/textbooks/route.ts','api/questions/route.ts','api/attempts/route.ts']) {
      expect(existsSync(path.join('src/app', file)), file).toBe(false);
    }
  });
  it('根布局统一承载导航，各页面不重复挂载 Shell', () => {
    expect(readFileSync('src/app/layout.tsx', 'utf8')).toContain('<Shell>');
    for (const file of pages('src/app')) expect(readFileSync(file,'utf8'),file).not.toContain('<Shell>');
  });
});
