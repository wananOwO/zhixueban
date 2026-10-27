/** 界面用的中文标签：所有页面共用，避免同一状态出现两种叫法 */
export const ACTIVITY_LABEL: Record<string, string> = {
  lesson: '课件学习',
  point_quiz: '知识点练习',
  chapter_quiz: '章节测验',
  final_quiz: '期末考核',
  diagnostic: '摸底诊断',
};
export const JOB_KIND_LABEL: Record<string, string> = {
  import: '教材导入',
  curriculum: '课程方案生成',
  lesson: '课件生成',
  question_set: '题组生成',
  assessment: '考核生成',
};
export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  waiting_user: '等待确认',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
export const DRAFT_STATE_LABEL: Record<string, string> = {
  editing: '编辑中',
  generating: '生成中',
  review: '待确认',
  confirmed: '已确认',
  discarded: '已丢弃',
};
export const MODE_LABEL: Record<string, string> = { theory: '理论', practice: '练习', drill: '刷题' };
export const MODE_HINT: Record<string, string> = {
  theory: '只学不考：读完课件即可推进',
  practice: '学练结合：每个知识点学完做练习',
  drill: '以题带学：先做题，薄弱处再看课件',
};

export const ACCEPTED_FORMATS = ['.txt', '.md', '.markdown', '.epub', '.pdf', '.docx', '.mobi', '.azw3'];

export function formatLabel(format: string): string {
  const value = format.replace(/^\./, '').toUpperCase();
  return value === 'MARKDOWN' ? 'MD' : value || '—';
}

/** Agent 联网补充的公开资料以 web: 开头，标题是网址 */
export function isWebSource(sourceId: string): boolean {
  return sourceId.startsWith('web:');
}

/** 网址来源显示为「域名 + 路径」，过长截断 */
export function sourceDisplayName(title: string, sourceId: string): string {
  if (!isWebSource(sourceId)) return title;
  try {
    const url = new URL(title);
    const path = url.pathname.replace(/\/$/, '');
    return `${url.hostname}${path}`.slice(0, 80);
  } catch {
    return title;
  }
}

/** 旁注上的来源称呼：上传教材叫「教材」，联网补充显示域名 */
export function sourceNoteLabel(title: string | undefined, sourceId: string): string {
  if (!isWebSource(sourceId)) return '教材';
  try { return new URL(title ?? '').hostname || '公开资料'; } catch { return '公开资料'; }
}
