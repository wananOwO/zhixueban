import { ACTIVITY_LABEL } from './labels';
import type { CourseListItem, CoursePointView, FormDraft, SessionView } from './api/types';
import type { RoadmapPoint } from './roadmap';

type Outline = { moduleId: string; title: string; points: CoursePointView[] }[] | undefined;

/** 按课程大纲顺序展开全部知识点 */
export function outlinePoints(outline: Outline): CoursePointView[] {
  return (outline ?? []).flatMap(module => module.points);
}

export function toRoadmapPoints(outline: Outline): RoadmapPoint[] {
  return outlinePoints(outline).map(point => ({
    id: point.knowledgePointId,
    title: point.title,
    role: point.role,
    prerequisiteIds: point.prerequisiteIds,
  }));
}

/** 课程名称取自确认它的草稿标题；没有标题时用学习目标 */
export function courseTitle(course: CourseListItem, drafts?: FormDraft[]): string {
  const draft = drafts?.find(d => d.confirmed?.courseId === course.courseId);
  return draft?.input.title?.trim() || course.snapshot.goal?.trim() || '未命名课程';
}

export function draftTitle(draft: FormDraft): string {
  return draft.input.title?.trim() || draft.input.goal?.trim() || '未命名草稿';
}

export interface NextStep {
  kind: 'continue' | 'activity' | 'prior' | 'mastery' | 'done';
  title: string;
  detail: string;
  pointIds: string[];
}

/** 一句话说明学习会话的下一步 */
export function describeNext(view: SessionView): NextStep {
  const titleOf = (id: string) => outlinePoints(view.version.outline).find(p => p.knowledgePointId === id)?.title ?? id;
  const names = (ids: string[]) => ids.map(titleOf).join('、');
  if (view.currentRun) {
    const activity = view.currentRun.activity;
    return {
      kind: 'continue',
      title: `继续${ACTIVITY_LABEL[activity.kind] ?? '学习'}：${names(activity.knowledgePointIds)}`,
      detail: view.currentRun.status === 'generating' ? 'Agent 正在生成这次活动的内容。' : '上次学到一半，继续即可回到原位置。',
      pointIds: activity.knowledgePointIds,
    };
  }
  if (view.next.kind === 'activity') {
    const activity = view.next.activity;
    const count = activity.questionCount > 0 ? `，共 ${activity.questionCount} 题` : '';
    return {
      kind: 'activity',
      title: `下一步：${ACTIVITY_LABEL[activity.kind] ?? '学习'} · ${names(activity.knowledgePointIds)}`,
      detail: activity.kind === 'lesson' ? `开始后 Agent 读教材写课件，每句讲解标明出处${count}。` : `题目由 Agent 出题并审校${count}。`,
      pointIds: activity.knowledgePointIds,
    };
  }
  if (view.next.kind === 'blocked' && view.next.reason === 'PRIOR_KNOWLEDGE_REQUIRED') {
    return {
      kind: 'prior',
      title: `先确认已有基础：${names(view.next.knowledgePointIds)}`,
      detail: '后面的内容依赖这些先修知识点。可以自报已经掌握（不算掌握证据），或切到理论模式先学。',
      pointIds: view.next.knowledgePointIds,
    };
  }
  if (view.next.kind === 'blocked') {
    return {
      kind: 'mastery',
      title: `需要补练：${names(view.next.knowledgePointIds)}`,
      detail: '这些知识点还没达到掌握标准：至少 3 道不同题、最近 5 题答对 80% 以上，且最近一题独立答对。',
      pointIds: view.next.knowledgePointIds,
    };
  }
  return { kind: 'done', title: '课程已全部完成', detail: '可以回看课件与作答记录，或查看每个知识点的掌握证据。', pointIds: [] };
}
