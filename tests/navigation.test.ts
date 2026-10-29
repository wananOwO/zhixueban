import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isActive, navItems } from '@/lib/nav';

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? pages(path.join(dir, entry.name)) : entry.name === 'page.tsx' ? [path.join(dir, entry.name)] : []);
}
// 路由组 (app) 不出现在网址里
function toRoute(file: string): string {
  const segments = path.relative('src/app', path.dirname(file)).split(path.sep).filter(s => s && !/^\(.+\)$/.test(s));
  return '/' + segments.join('/');
}

describe('朱批本前端路由', () => {
  it('五项主导航与全部静态页面一一对应', () => {
    expect(navItems.map(item => item.href)).toEqual(['/', '/library', '/courses', '/drafts', '/settings']);
    const routes = pages('src/app').filter(file => !file.includes('[')).map(toRoute);
    expect(routes.sort()).toEqual(['/', '/courses', '/drafts', '/library', '/settings']);
  });
  it('第一版页面、组件与请求层已删除', () => {
    for (const file of ['src/app/verified-learning', 'src/components/verified-learning', 'src/lib/navigation.ts', 'src/lib/verified-learning/client.ts']) {
      expect(existsSync(file), file).toBe(false);
    }
  });
  it('学习与历史回看页归在「我的课程」下（样张 a-zhupi）', () => {
    const current = (pathname: string) => navItems.filter(item => isActive(pathname, item.href)).map(item => item.label);
    expect(current('/learn/s1')).toEqual(['我的课程']);
    expect(current('/learn/s1/history')).toEqual(['我的课程']);
    expect(current('/courses/c1')).toEqual(['我的课程']);
    expect(current('/learning')).toEqual([]);
    expect(current('/')).toEqual(['首页']);
  });
  it('顶栏只在 (app) 布局挂载一次', () => {
    expect(readFileSync('src/app/(app)/layout.tsx', 'utf8')).toContain('<TopBar');
    for (const file of pages('src/app')) expect(readFileSync(file, 'utf8'), file).not.toContain('<TopBar');
  });
});
