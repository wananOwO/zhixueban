import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LearningError, type CourseVersion, type LearningMode } from './contracts';
import { activateCourseVersion } from './course-version';

export type ActivityKind = 'lesson' | 'point_quiz' | 'chapter_quiz' | 'final_quiz' | 'diagnostic';
export interface Activity {
  activityId: string;
  kind: ActivityKind;
  moduleId: string | null;
  knowledgePointIds: string[];
  questionCount: number;
}
export interface StudySession {
  sessionId: string;
  courseId: string;
  courseVersionId: string;
  mode: LearningMode;
  revision: number;
  currentActivity: Activity | null;
  completedActivityIds: string[];
  abandonedActivityIds: string[];
  displayedKnowledgePointIds: string[];
  practiceCompletedKnowledgePointIds: string[];
  declaredKnowledgePointIds: string[];
  diagnosedKnowledgePointIds: string[];
}
export type NextStep =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'blocked'; reason: 'PRIOR_KNOWLEDGE_REQUIRED' | 'MASTERY_REQUIRED'; knowledgePointIds: string[] }
  | { kind: 'done' };

const id = z.string().refine(value => value.trim().length > 0);
const ids = z.array(id);
const modeSchema = z.enum(['theory', 'practice', 'drill']);
const activitySchema = z.strictObject({
  activityId: id,
  kind: z.enum(['lesson', 'point_quiz', 'chapter_quiz', 'final_quiz', 'diagnostic']),
  moduleId: id.nullable(),
  knowledgePointIds: ids,
  questionCount: z.number().int().min(0).max(50),
});
const sessionSchema = z.strictObject({
  sessionId: id,
  courseId: id,
  courseVersionId: id,
  mode: modeSchema,
  revision: z.number().int().min(0),
  currentActivity: activitySchema.nullable(),
  completedActivityIds: ids,
  abandonedActivityIds: ids,
  displayedKnowledgePointIds: ids,
  practiceCompletedKnowledgePointIds: ids,
  declaredKnowledgePointIds: ids,
  diagnosedKnowledgePointIds: ids,
});
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('start_activity'), activityId: id }),
  z.strictObject({
    type: z.literal('complete_activity'), activityId: id,
    answeredQuestionIds: ids.optional(), diagnosedKnowledgePointIds: ids.optional(),
  }),
  z.strictObject({ type: z.literal('abandon_activity'), activityId: id }),
  z.strictObject({ type: z.literal('change_mode'), mode: modeSchema }),
  z.strictObject({ type: z.literal('declare_prior_knowledge'), knowledgePointIds: ids }),
  z.strictObject({ type: z.literal('record_infrastructure_error'), activityId: id }),
]);
export type SessionCommand = z.infer<typeof commandSchema>;

function invalid(message: string): never {
  throw new LearningError('INVALID_INPUT', message);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) invalid('Invalid session input');
  return result.data;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateVersion(version: CourseVersion): CourseVersion {
  if (!version || (version.status !== 'active' && version.status !== 'archived')) {
    invalid('Session requires an active or archived course version');
  }
  // Reuse the existing snapshot validator without changing the caller's status.
  return { ...activateCourseVersion(version), status: version.status };
}

function activity(
  version: CourseVersion, kind: ActivityKind, scopeId: string,
  moduleId: string | null, knowledgePointIds: string[], questionCount: number,
): Activity {
  return {
    activityId: JSON.stringify([version.courseVersionId, kind, scopeId]),
    kind, moduleId, knowledgePointIds: knowledgePointIds.slice(), questionCount,
  };
}

function schedule(version: CourseVersion, mode: LearningMode): Activity[] {
  const activities: Activity[] = [];
  for (const module of version.outline) {
    const settings = { ...version.assessment, ...module.assessment };
    for (const point of module.points) {
      const scope = point.knowledgePointId;
      if (mode !== 'drill') activities.push(activity(version, 'lesson', scope, module.moduleId, [scope], 0));
      if (mode !== 'theory') {
        activities.push(activity(version, 'point_quiz', scope, module.moduleId, [scope], settings.pointQuestionCount));
      }
    }
    if (mode !== 'drill') {
      activities.push(activity(version, 'chapter_quiz', module.moduleId, module.moduleId,
        module.points.map(point => point.knowledgePointId), settings.chapterQuestionCount));
    }
  }
  if (mode === 'drill') {
    activities.push(activity(version, 'final_quiz', version.courseId, null,
      version.outline.flatMap(module => module.points.map(point => point.knowledgePointId)),
      version.assessment.finalQuestionCount));
  }
  return activities;
}

function diagnosticScope(activityId: string, version: CourseVersion): string[] | null {
  let tuple: unknown;
  try { tuple = JSON.parse(activityId); } catch { invalid('Invalid activity history'); }
  if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== version.courseVersionId ||
    tuple[1] !== 'diagnostic' || typeof tuple[2] !== 'string') return null;
  let scope: string[];
  try { scope = parse(ids.min(1).max(50), JSON.parse(tuple[2])); } catch { invalid('Invalid diagnostic scope'); }
  const ordered = version.outline.flatMap(module => module.points.map(point => point.knowledgePointId))
    .filter(pointId => scope.includes(pointId));
  if (JSON.stringify(ordered) !== JSON.stringify(scope) ||
    activityId !== JSON.stringify([version.courseVersionId, 'diagnostic', JSON.stringify(scope)])) {
    invalid('Invalid diagnostic scope');
  }
  return scope;
}

function knowledgeIds(version: CourseVersion): Set<string> {
  return new Set([
    ...version.priorKnowledge.map(point => point.knowledgePointId),
    ...version.outline.flatMap(module => module.points.flatMap(point =>
      [point.knowledgePointId, ...point.prerequisiteIds])),
  ]);
}

function validateSession(version: CourseVersion, input: StudySession): StudySession {
  const session = parse(sessionSchema, input);
  if (session.courseId !== version.courseId || session.courseVersionId !== version.courseVersionId) {
    invalid('Session does not belong to this course version');
  }
  const allKnowledge = knowledgeIds(version);
  const outlineIds = new Set(version.outline.flatMap(module => module.points.map(point => point.knowledgePointId)));
  for (const values of [session.displayedKnowledgePointIds, session.practiceCompletedKnowledgePointIds]) {
    if (values.some(value => !outlineIds.has(value))) invalid('Foreign outline knowledge');
  }
  for (const values of [session.declaredKnowledgePointIds, session.diagnosedKnowledgePointIds]) {
    if (values.some(value => !allKnowledge.has(value))) invalid('Foreign prior knowledge');
  }
  const activities = new Map(
    [...schedule(version, 'practice'), ...schedule(version, 'drill')].map(item => [item.activityId, item]),
  );
  for (const activityId of [...session.completedActivityIds, ...session.abandonedActivityIds]) {
    if (!activities.has(activityId) && !diagnosticScope(activityId, version)) invalid('Foreign activity history');
  }
  const current = session.currentActivity;
  if (current) {
    const pending = schedule(version, session.mode).find(item => !session.completedActivityIds.includes(item.activityId));
    let canonical = activities.get(current.activityId);
    if (current.kind === 'diagnostic') {
      const scope = diagnosticScope(current.activityId, version);
      const module = version.outline.find(item => item.moduleId === current.moduleId);
      const point = module?.points.find(point => point.knowledgePointId === pending?.knowledgePointIds[0]);
      if (!scope || !module || !point || pending?.kind !== 'point_quiz' ||
        !scope.every(id => id === point.knowledgePointId || point.prerequisiteIds.includes(id))) {
        invalid('Foreign diagnostic activity');
      }
      canonical = activity(version, 'diagnostic', JSON.stringify(scope), module.moduleId, scope, scope.length);
    } else if (pending?.activityId !== current.activityId) {
      invalid('Running activity is not next in the schedule');
    }
    const allowedKinds: ActivityKind[] = session.mode === 'drill'
      ? ['diagnostic', 'point_quiz', 'final_quiz']
      : session.mode === 'theory' ? ['lesson', 'chapter_quiz'] : ['lesson', 'point_quiz', 'chapter_quiz'];
    if (!canonical || !allowedKinds.includes(current.kind) ||
      session.completedActivityIds.includes(current.activityId) ||
      JSON.stringify(canonical) !== JSON.stringify(current)) invalid('Invalid running activity');
  }
  return session;
}

export function createStudySession(version: CourseVersion, mode: unknown): StudySession {
  if (!version || version.status !== 'active') invalid('New sessions require an active version');
  const course = validateVersion(version);
  return {
    sessionId: randomUUID(), courseId: course.courseId, courseVersionId: course.courseVersionId,
    mode: parse(modeSchema, mode), revision: 0, currentActivity: null,
    completedActivityIds: [], abandonedActivityIds: [],
    displayedKnowledgePointIds: [], practiceCompletedKnowledgePointIds: [],
    declaredKnowledgePointIds: unique(course.priorKnowledge.filter(point => point.source === 'declared')
      .map(point => point.knowledgePointId)),
    diagnosedKnowledgePointIds: unique(course.priorKnowledge.filter(point => point.source === 'diagnosed')
      .map(point => point.knowledgePointId)),
  };
}

export function allowedKnowledgePointIds(session: StudySession): string[] {
  const parsed = parse(sessionSchema, session);
  return unique([
    ...parsed.displayedKnowledgePointIds, ...parsed.declaredKnowledgePointIds, ...parsed.diagnosedKnowledgePointIds,
  ]);
}

function verifiedIds(version: CourseVersion, input: readonly string[]): Set<string> {
  const parsed = parse(ids, input);
  const known = knowledgeIds(version);
  if (parsed.some(value => !known.has(value))) invalid('Foreign verified knowledge');
  return new Set(parsed);
}

function deriveNext(version: CourseVersion, session: StudySession, verified: Set<string>): NextStep {
  if (session.currentActivity) return { kind: 'activity', activity: session.currentActivity };
  const allowed = new Set(allowedKnowledgePointIds(session));
  const completed = new Set(session.completedActivityIds);
  const points = version.outline.flatMap(module => module.points);
  for (const item of schedule(version, session.mode)) {
    if (completed.has(item.activityId)) {
      const module = version.outline.find(module => module.moduleId === item.moduleId);
      const policy = module?.assessment?.progressionPolicy ?? version.assessment.progressionPolicy;
      const missing = item.knowledgePointIds.filter(id => !verified.has(id));
      if (item.kind !== 'lesson' && policy === 'mastery' && missing.length) {
        return { kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: missing };
      }
      continue;
    }
    if (item.kind === 'lesson') return { kind: 'activity', activity: item };
    const required = item.kind === 'point_quiz'
      ? unique([...points.find(point => point.knowledgePointId === item.knowledgePointIds[0])!.prerequisiteIds,
        ...item.knowledgePointIds])
      : item.knowledgePointIds;
    const missing = required.filter(id => !allowed.has(id));
    if (missing.length) {
      if (session.mode === 'drill' && item.kind === 'point_quiz') {
        const outlineIds = new Set(points.map(point => point.knowledgePointId));
        const external = missing.filter(id => !outlineIds.has(id));
        if (external.length) return { kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: external };
        const tested = new Set(session.completedActivityIds.flatMap(id => diagnosticScope(id, version) ?? []));
        const failed = points.map(point => point.knowledgePointId).filter(id => missing.includes(id) && tested.has(id));
        if (failed.length) return { kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: failed };
        const batch = points.map(point => point.knowledgePointId).filter(id => missing.includes(id)).slice(0, 50);
        return {
          kind: 'activity',
          activity: activity(version, 'diagnostic', JSON.stringify(batch), item.moduleId, batch, batch.length),
        };
      }
      return { kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: missing };
    }
    return { kind: 'activity', activity: item };
  }
  return { kind: 'done' };
}

export function nextActivity(
  version: CourseVersion, session: StudySession, verifiedKnowledgePointIds: readonly string[] = [],
): NextStep {
  const course = validateVersion(version);
  return deriveNext(course, validateSession(course, session), verifiedIds(course, verifiedKnowledgePointIds));
}

export function transitionSession(
  version: CourseVersion, session: StudySession, expectedRevision: number,
  command: unknown, verifiedKnowledgePointIds: readonly string[] = [],
): StudySession {
  const course = validateVersion(version);
  const next = validateSession(course, session);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid('Invalid expected revision');
  if (expectedRevision !== next.revision) throw new LearningError('VERSION_CONFLICT', 'Session revision changed');
  if (next.revision === Number.MAX_SAFE_INTEGER) invalid('Session revision is exhausted');
  const event = parse(commandSchema, command);
  const verified = verifiedIds(course, verifiedKnowledgePointIds);
  switch (event.type) {
    case 'start_activity': {
      if (next.currentActivity) throw new LearningError('ACTIVITY_IN_PROGRESS', 'An activity is running');
      const step = deriveNext(course, next, verified);
      if (step.kind !== 'activity' || step.activity.activityId !== event.activityId) invalid('Activity is not next');
      next.currentActivity = step.activity;
      break;
    }
    case 'change_mode':
      if (next.currentActivity) throw new LearningError('ACTIVITY_IN_PROGRESS', 'Finish or abandon the running activity');
      next.mode = event.mode;
      break;
    case 'declare_prior_knowledge': {
      const known = knowledgeIds(course);
      if (event.knowledgePointIds.some(id => !known.has(id))) invalid('Foreign prior knowledge');
      next.declaredKnowledgePointIds = unique([...next.declaredKnowledgePointIds, ...event.knowledgePointIds]);
      break;
    }
    case 'complete_activity':
    case 'abandon_activity':
    case 'record_infrastructure_error': {
      const current = next.currentActivity;
      if (!current || current.activityId !== event.activityId) invalid('Activity is not running');
      if (event.type === 'record_infrastructure_error') break;
      if (event.type === 'abandon_activity') {
        next.abandonedActivityIds = unique([...next.abandonedActivityIds, current.activityId]);
      } else {
        if (current.kind === 'lesson' && event.answeredQuestionIds !== undefined) invalid('Lessons have no questions');
        if (current.kind !== 'diagnostic' && event.diagnosedKnowledgePointIds !== undefined) {
          invalid('Only diagnostics record diagnosed knowledge');
        }
        if (unique(event.answeredQuestionIds ?? []).length < current.questionCount) invalid('Not enough distinct answers');
        const passed = event.diagnosedKnowledgePointIds ?? [];
        if (passed.some(id => !current.knowledgePointIds.includes(id))) invalid('Passed knowledge is outside the diagnostic');
        if (current.kind === 'lesson') {
          next.displayedKnowledgePointIds = unique([...next.displayedKnowledgePointIds, ...current.knowledgePointIds]);
        } else if (current.kind === 'point_quiz') {
          next.practiceCompletedKnowledgePointIds = unique([...next.practiceCompletedKnowledgePointIds, ...current.knowledgePointIds]);
        } else if (current.kind === 'diagnostic') {
          next.diagnosedKnowledgePointIds = unique([...next.diagnosedKnowledgePointIds, ...passed]);
        }
        next.completedActivityIds = unique([...next.completedActivityIds, current.activityId]);
      }
      next.currentActivity = null;
      break;
    }
  }
  next.revision++;
  return next;
}
