/** 唯一主导航；课程内的学习、回看、笔记与进度从对应课程进入。 */
export const navItems = [
  { href: '/', label: '首页' },
  { href: '/library', label: '教材库' },
  { href: '/courses', label: '我的课程' },
  { href: '/drafts', label: '课程草稿' },
  { href: '/settings', label: '设置' },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
