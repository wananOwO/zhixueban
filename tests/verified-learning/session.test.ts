import { describe, expect, test } from 'vitest';
import { LearningError, type CourseVersion } from '@/lib/verified-learning/contracts';
import { activateCourseVersion, createCourseVersion } from '@/lib/verified-learning/course-version';
import {
  allowedKnowledgePointIds, createStudySession, nextActivity, transitionSession,
  type Activity, type StudySession,
} from '@/lib/verified-learning/session';
import { activeVersion, courseInput } from './fixtures';

function next(version: CourseVersion, session: StudySession, verified: string[] = []): Activity {
  const step = nextActivity(version, session, verified);
  expect(step.kind).toBe('activity');
  if (step.kind !== 'activity') throw new Error('Expected an activity');
  return step.activity;
}

function finish(version: CourseVersion, session: StudySession, passed?: string[], verified: string[] = []) {
  const activity = next(version, session, verified);
  const running = transitionSession(version, session, session.revision, {
    type: 'start_activity', activityId: activity.activityId,
  }, verified);
  return transitionSession(version, running, running.revision, {
    type: 'complete_activity', activityId: activity.activityId,
    ...(activity.questionCount ? {
      answeredQuestionIds: Array.from({ length: activity.questionCount }, (_, i) => `q-${i}`),
    } : {}),
    ...(passed === undefined ? {} : { diagnosedKnowledgePointIds: passed }),
  }, verified);
}

function declare(version: CourseVersion, session: StudySession, knowledgePointIds: string[]) {
  return transitionSession(version, session, session.revision, {
    type: 'declare_prior_knowledge', knowledgePointIds,
  });
}

describe('three-mode schedules', () => {
  test.each([
    ['theory', ['lesson:variables:0', 'lesson:loops:0', 'chapter_quiz:variables,loops:10']],
    ['practice', ['lesson:variables:0', 'point_quiz:variables:3', 'lesson:loops:0',
      'point_quiz:loops:3', 'chapter_quiz:variables,loops:10']],
    ['drill', ['point_quiz:variables:3', 'point_quiz:loops:3', 'final_quiz:variables,loops:10']],
  ] as const)('%s completes the exact two-point schedule', (mode, expected) => {
    const version = activeVersion();
    let session = createStudySession(version, mode);
    if (mode === 'drill') session = declare(version, session, ['variables', 'loops']);
    const ids: string[] = [];
    for (const description of expected) {
      const activity = next(version, session);
      expect(`${activity.kind}:${activity.knowledgePointIds.join(',')}:${activity.questionCount}`).toBe(description);
      expect(activity.moduleId).toBe(activity.kind === 'final_quiz' ? null : 'basics');
      ids.push(activity.activityId);
      session = finish(version, session);
    }
    expect(nextActivity(version, session)).toEqual({ kind: 'done' });
    expect(session.completedActivityIds).toEqual(ids);
    expect(session.practiceCompletedKnowledgePointIds).toEqual(mode === 'theory' ? [] : ['variables', 'loops']);
    expect(session.displayedKnowledgePointIds).toEqual(mode === 'drill' ? [] : ['variables', 'loops']);
  });

  test('uses module counts and course final count without cross-module leakage', () => {
    const input = courseInput();
    const loops = input.outline[0].points.pop()!;
    input.outline[0].assessment = { pointQuestionCount: 1, chapterQuestionCount: 2, finalQuestionCount: 49 };
    input.outline.push({ moduleId: 'second', title: 'Second', points: [loops] });
    input.assessment.finalQuestionCount = 4;
    const version = activateCourseVersion(createCourseVersion(input));
    let session = createStudySession(version, 'practice');
    for (const [kind, count, moduleId] of [
      ['lesson', 0, 'basics'], ['point_quiz', 1, 'basics'], ['chapter_quiz', 2, 'basics'],
      ['lesson', 0, 'second'], ['point_quiz', 3, 'second'], ['chapter_quiz', 10, 'second'],
    ] as const) {
      expect(next(version, session)).toMatchObject({ kind, questionCount: count, moduleId });
      session = finish(version, session);
    }
    session = transitionSession(version, session, session.revision, { type: 'change_mode', mode: 'drill' });
    expect(next(version, session)).toMatchObject({ kind: 'final_quiz', questionCount: 4 });
  });

  test('has collision-free tuple IDs and the same point quiz across modes', () => {
    const version = activeVersion();
    version.courseVersionId = 'version:point_quiz:"odd"';
    let practice = finish(version, createStudySession(version, 'practice'));
    const practiceQuiz = next(version, practice);
    expect(JSON.parse(practiceQuiz.activityId)).toEqual([version.courseVersionId, 'point_quiz', 'variables']);
    practice = transitionSession(version, practice, practice.revision, { type: 'change_mode', mode: 'drill' });
    expect(next(version, practice).activityId).toBe(practiceQuiz.activityId);
  });

  test.each([undefined, null, 1, 'Practice', 'unknown', {}, []])('rejects unsupported mode %j', mode => {
    expect(() => createStudySession(activeVersion(), mode)).toThrow(LearningError);
  });

  test('creates only on active versions and continues the matching archived version', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'theory');
    const archived = { ...version, status: 'archived' } as const;
    expect(() => createStudySession(archived, 'theory')).toThrow(LearningError);
    expect(() => createStudySession(createCourseVersion(courseInput()), 'theory')).toThrow(LearningError);
    expect(next(archived, session).kind).toBe('lesson');
    expect(finish(archived, session).displayedKnowledgePointIds).toEqual(['variables']);
  });
});

describe('validated transitions and detached state', () => {
  test('starts without granting reading and only completion adds displayed knowledge', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'practice');
    const activity = next(version, session);
    const running = transitionSession(version, session, 0, { type: 'start_activity', activityId: activity.activityId });
    expect(running.revision).toBe(1);
    expect(running.currentActivity).toEqual(activity);
    expect(allowedKnowledgePointIds(running)).toEqual([]);
    expect(session.currentActivity).toBeNull();
    const completed = transitionSession(version, running, 1, { type: 'complete_activity', activityId: activity.activityId });
    expect(completed.revision).toBe(2);
    expect(completed.currentActivity).toBeNull();
    expect(allowedKnowledgePointIds(completed)).toEqual(['variables']);
    expect(completed.practiceCompletedKnowledgePointIds).toEqual([]);
  });

  test('rejects start/finish mismatches, switching in progress and stale revisions without mutation', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'practice');
    const activity = next(version, session);
    expect(() => transitionSession(version, session, 0, { type: 'start_activity', activityId: 'other' })).toThrow(LearningError);
    expect(() => transitionSession(version, session, 0, { type: 'complete_activity', activityId: activity.activityId })).toThrow(LearningError);
    const running = transitionSession(version, session, 0, { type: 'start_activity', activityId: activity.activityId });
    const before = structuredClone(running);
    for (const command of [
      { type: 'start_activity', activityId: activity.activityId },
      { type: 'complete_activity', activityId: 'other' },
      { type: 'abandon_activity', activityId: 'other' },
      { type: 'record_infrastructure_error', activityId: 'other' },
      { type: 'change_mode', mode: 'drill' },
    ]) expect(() => transitionSession(version, running, 1, command)).toThrow(LearningError);
    for (const revision of [-1, 0, 1.5, NaN, Infinity, '1']) {
      expect(() => transitionSession(version, running, revision as number, {
        type: 'complete_activity', activityId: activity.activityId,
      })).toThrow(LearningError);
    }
    expect(running).toEqual(before);
  });

  test.each([
    null, {}, { type: 'invented' }, { type: 'change_mode', mode: 3 },
    { type: 'change_mode', mode: 'drill', extra: true },
    { type: 'declare_prior_knowledge', knowledgePointIds: [' '] },
    { type: 'declare_prior_knowledge', knowledgePointIds: ['foreign'] },
    { type: 'declare_prior_knowledge', knowledgePointIds: 'variables' },
    { type: 'start_activity', activityId: 7 },
  ])('rejects malformed/unknown command %j', command => {
    const version = activeVersion();
    const session = createStudySession(version, 'theory');
    expect(() => transitionSession(version, session, 0, command)).toThrow(LearningError);
    expect(session.revision).toBe(0);
  });

  test('records abandonment separately, allows re-offer and retains histories across round-trip switches', () => {
    const version = activeVersion();
    let session = createStudySession(version, 'practice');
    const lesson = next(version, session);
    session = transitionSession(version, session, 0, { type: 'start_activity', activityId: lesson.activityId });
    session = transitionSession(version, session, 1, { type: 'abandon_activity', activityId: lesson.activityId });
    expect(session.abandonedActivityIds).toEqual([lesson.activityId]);
    expect(session.completedActivityIds).toEqual([]);
    expect(session.revision).toBe(2);
    expect(next(version, session)).toEqual(lesson);
    session = finish(version, session);
    const quiz = next(version, session);
    session = finish(version, session);
    const retained = structuredClone(session);
    session = transitionSession(version, session, session.revision, { type: 'change_mode', mode: 'drill' });
    expect(next(version, session)).toMatchObject({ kind: 'diagnostic', knowledgePointIds: ['loops'] });
    session = transitionSession(version, session, session.revision, { type: 'change_mode', mode: 'practice' });
    expect(next(version, session)).toMatchObject({ kind: 'lesson', knowledgePointIds: ['loops'] });
    expect(session).toEqual({ ...retained, revision: retained.revision + 2 });
    expect(session.completedActivityIds).toEqual([lesson.activityId, quiz.activityId]);
  });

  test('infrastructure error only advances revision and returns detached activity and arrays', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'theory');
    const activity = next(version, session);
    const running = transitionSession(version, session, 0, { type: 'start_activity', activityId: activity.activityId });
    const changed = transitionSession(version, running, 1, { type: 'record_infrastructure_error', activityId: activity.activityId });
    expect(changed).toEqual({ ...running, revision: 2 });
    changed.currentActivity!.knowledgePointIds.push('foreign');
    changed.completedActivityIds.push('foreign');
    expect(running.currentActivity!.knowledgePointIds).toEqual(['variables']);
    expect(running.completedActivityIds).toEqual([]);
    const derived = next(version, running);
    derived.knowledgePointIds.push('foreign');
    expect(running.currentActivity!.knowledgePointIds).toEqual(['variables']);
  });

  test('requires enough distinct nonblank answers without treating quiz completion as new allowed knowledge', () => {
    const version = activeVersion();
    let session = declare(version, createStudySession(version, 'drill'), ['variables']);
    const quiz = next(version, session);
    session = transitionSession(version, session, session.revision, { type: 'start_activity', activityId: quiz.activityId });
    for (const answeredQuestionIds of [undefined, ['a', 'a', 'b'], ['a', 'b'], ['a', 'b', ' '], [1, 2, 3]]) {
      expect(() => transitionSession(version, session, session.revision, {
        type: 'complete_activity', activityId: quiz.activityId, answeredQuestionIds,
      })).toThrow(LearningError);
    }
    const completed = transitionSession(version, session, session.revision, {
      type: 'complete_activity', activityId: quiz.activityId, answeredQuestionIds: ['a', 'b', 'c', 'c'],
    });
    expect(completed.practiceCompletedKnowledgePointIds).toEqual(['variables']);
    expect(allowedKnowledgePointIds(completed)).toEqual(['variables']);
    expect(completed.diagnosedKnowledgePointIds).toEqual([]);
    expect(completed.displayedKnowledgePointIds).toEqual([]);
  });

  test('rejects diagnosis fields on ordinary completion and answers on a lesson', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'theory');
    const activity = next(version, session);
    const running = transitionSession(version, session, 0, { type: 'start_activity', activityId: activity.activityId });
    for (const fields of [{ diagnosedKnowledgePointIds: ['variables'] }, { answeredQuestionIds: ['a'] }]) {
      expect(() => transitionSession(version, running, 1, {
        type: 'complete_activity', activityId: activity.activityId, ...fields,
      })).toThrow(LearningError);
    }
  });

  test('rejects foreign version, course, histories, current activities and malformed session state', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'practice');
    const foreign = activeVersion();
    expect(() => nextActivity(foreign, session)).toThrow(LearningError);
    for (const fields of [
      { courseId: 'foreign' }, { courseVersionId: 'foreign' }, { sessionId: ' ' }, { revision: 0.5 },
      { mode: 'other' }, { extra: true }, { displayedKnowledgePointIds: ['foreign'] },
      { completedActivityIds: [JSON.stringify([foreign.courseVersionId, 'lesson', 'variables'])] },
      { abandonedActivityIds: ['foreign'] },
      { currentActivity: { ...next(version, session), questionCount: 50 } },
      { currentActivity: {
        ...next(version, session),
        activityId: JSON.stringify([version.courseVersionId, 'lesson', 'loops']),
        knowledgePointIds: ['loops'],
      } },
    ]) {
      const invalid = { ...session, ...fields } as StudySession;
      expect(() => nextActivity(version, invalid)).toThrow(LearningError);
      expect(() => transitionSession(version, invalid, 0, { type: 'change_mode', mode: 'drill' })).toThrow(LearningError);
    }
  });

  test('deduplicates the allowed union and detaches all input/output arrays', () => {
    const input = courseInput();
    input.priorKnowledge = [
      { knowledgePointId: 'variables', source: 'declared' },
      { knowledgePointId: 'loops', source: 'diagnosed' },
    ];
    const version = activateCourseVersion(createCourseVersion(input));
    const initial = createStudySession(version, 'theory');
    const completed = finish(version, initial);
    const ids = ['variables', 'loops'];
    const declared = declare(version, completed, ids);
    ids.push('foreign');
    const allowed = allowedKnowledgePointIds(declared);
    expect(allowed).toEqual(['variables', 'loops']);
    allowed.push('foreign');
    expect(declared.declaredKnowledgePointIds).toEqual(['variables', 'loops']);
    expect(initial.declaredKnowledgePointIds).toEqual(['variables']);
    expect(initial.diagnosedKnowledgePointIds).toEqual(['loops']);
    expect(version.priorKnowledge).toHaveLength(2);
  });
});

describe('diagnosis and knowledge gates', () => {
  test('diagnoses only missing required in-outline points and only passed IDs become allowed', () => {
    const version = activeVersion();
    let session = createStudySession(version, 'drill');
    const diagnostic = next(version, session);
    expect(diagnostic).toMatchObject({ kind: 'diagnostic', knowledgePointIds: ['variables'], questionCount: 1 });
    session = finish(version, session, ['variables']);
    expect(session.diagnosedKnowledgePointIds).toEqual(['variables']);
    expect(session.declaredKnowledgePointIds).toEqual([]);
    expect(session.practiceCompletedKnowledgePointIds).toEqual([]);
    expect(next(version, session)).toMatchObject({ kind: 'point_quiz', knowledgePointIds: ['variables'] });
    session = finish(version, session);
    const second = next(version, session);
    expect(second).toMatchObject({ kind: 'diagnostic', knowledgePointIds: ['loops'], questionCount: 1 });
    expect(second.activityId).not.toBe(diagnostic.activityId);
    session = finish(version, session, ['loops']);
    session = finish(version, session);
    expect(next(version, session).kind).toBe('final_quiz');
    session = finish(version, session);
    expect(nextActivity(version, session)).toEqual({ kind: 'done' });
  });

  test('unsuccessful diagnosis blocks instead of silently passing, inserting lessons or retrying', () => {
    const version = activeVersion();
    let session = finish(version, createStudySession(version, 'drill'), []);
    expect(session.diagnosedKnowledgePointIds).toEqual([]);
    expect(nextActivity(version, session)).toEqual({
      kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: ['variables'],
    });
    session = declare(version, session, ['variables']);
    expect(next(version, session).kind).toBe('point_quiz');
  });

  test('rejects passing IDs outside the running diagnostic scope', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'drill');
    const diagnostic = next(version, session);
    const running = transitionSession(version, session, 0, { type: 'start_activity', activityId: diagnostic.activityId });
    for (const passed of [['loops'], ['foreign'], ['variables', 'loops']]) {
      expect(() => transitionSession(version, running, 1, {
        type: 'complete_activity', activityId: diagnostic.activityId,
        answeredQuestionIds: ['q'], diagnosedKnowledgePointIds: passed,
      })).toThrow(LearningError);
    }
    expect(running.diagnosedKnowledgePointIds).toEqual([]);
  });

  test('supports explicitly named external prior knowledge without diagnosing out-of-outline IDs', () => {
    const input = courseInput();
    input.priorKnowledge = [{ knowledgePointId: 'arithmetic', source: 'diagnosed' }];
    input.outline[0].points[0].prerequisiteIds = ['arithmetic'];
    const version = activateCourseVersion(createCourseVersion(input));
    let session = createStudySession(version, 'drill');
    expect(session.diagnosedKnowledgePointIds).toEqual(['arithmetic']);
    session.diagnosedKnowledgePointIds = [];
    expect(nextActivity(version, session)).toEqual({
      kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: ['arithmetic'],
    });
    session = declare(version, session, ['arithmetic']);
    expect(next(version, session)).toMatchObject({ kind: 'diagnostic', knowledgePointIds: ['variables'] });
  });

  test('batches missing prerequisite knowledge in outline order and blocks failed portions of a batch', () => {
    const input = courseInput();
    const point = input.outline[0].points[0];
    const prerequisites = Array.from({ length: 55 }, (_, i) => `p-${i}`);
    input.outline[0].points = [
      ...prerequisites.map(knowledgePointId => ({ ...point, knowledgePointId })),
      { ...point, knowledgePointId: 'target', prerequisiteIds: prerequisites.slice().reverse() },
    ];
    const version = activateCourseVersion(createCourseVersion(input));
    let session = createStudySession(version, 'drill');
    // Imported trusted completion facts do not imply prior knowledge or mastery.
    session.completedActivityIds = prerequisites.map(id => JSON.stringify([version.courseVersionId, 'point_quiz', id]));
    const first = next(version, session);
    expect(first.knowledgePointIds).toEqual(prerequisites.slice(0, 50));
    expect(first.questionCount).toBe(50);
    const failed = finish(version, session, prerequisites.slice(0, 49));
    expect(allowedKnowledgePointIds(failed)).toEqual(prerequisites.slice(0, 49));
    expect(nextActivity(version, failed)).toEqual({
      kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: ['p-49'],
    });
    session = finish(version, session, prerequisites.slice(0, 50));
    expect(allowedKnowledgePointIds(session)).toEqual(prerequisites.slice(0, 50));
    const second = next(version, session);
    expect(second.knowledgePointIds).toEqual([...prerequisites.slice(50), 'target']);
    expect(second.questionCount).toBe(6);
    expect(second.activityId).not.toBe(first.activityId);
    session = finish(version, session, second.knowledgePointIds);
    expect(next(version, session)).toMatchObject({ kind: 'point_quiz', knowledgePointIds: ['target'] });
  });

  test('chapter and final gates require the allowed union, not just completed quiz history', () => {
    const version = activeVersion();
    for (const mode of ['theory', 'drill'] as const) {
      const session = createStudySession(version, mode);
      session.completedActivityIds = ['variables', 'loops'].map(id =>
        JSON.stringify([version.courseVersionId, mode === 'theory' ? 'lesson' : 'point_quiz', id]));
      expect(nextActivity(version, session)).toEqual({
        kind: 'blocked', reason: 'PRIOR_KNOWLEDGE_REQUIRED', knowledgePointIds: ['variables', 'loops'],
      });
    }
  });
});

describe('trusted evidence and mastery gates', () => {
  test.each([
    ['point_quiz', 'practice', 'theory', 2, ['variables'], 'lesson', ['loops']],
    ['chapter_quiz', 'theory', 'drill', 3, ['variables', 'loops'], 'point_quiz', ['variables']],
    ['final_quiz', 'drill', 'theory', 3, ['variables', 'loops'], 'lesson', ['variables']],
  ] as const)('retains completed %s mastery gates across %s -> %s switches',
    (kind, originalMode, mode, completions, missing, nextKind, nextScope) => {
      const input = courseInput();
      input.assessment.progressionPolicy = kind === 'final_quiz' ? 'mastery' : 'completed';
      input.outline[0].assessment = { progressionPolicy: kind === 'final_quiz' ? 'completed' : 'mastery' };
      const version = activateCourseVersion(createCourseVersion(input));
      let session = createStudySession(version, originalMode);
      if (originalMode === 'drill') session = declare(version, session, ['variables', 'loops']);
      for (let index = 0; index < completions; index++) session = finish(version, session);
      const history = session.completedActivityIds.slice();
      session = transitionSession(version, session, session.revision, { type: 'change_mode', mode });
      expect(session.mode).toBe(mode);
      expect(session.completedActivityIds).toEqual(history);
      const blocked = { kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: [...missing] };
      expect(nextActivity(version, session)).toEqual(blocked);
      session = declare(version, session, ['variables', 'loops']);
      expect(nextActivity(version, session)).toEqual(blocked);
      const activity = next(version, session, [...missing]);
      expect(activity).toMatchObject({ kind: nextKind, knowledgePointIds: [...nextScope] });
      const command = { type: 'start_activity', activityId: activity.activityId };
      expect(() => transitionSession(version, session, session.revision, command)).toThrow(LearningError);
      const running = transitionSession(version, session, session.revision, command, missing);
      expect(running.currentActivity).toEqual(activity);
      expect(running.revision).toBe(session.revision + 1);
      expect(running.completedActivityIds).toEqual(history);
    });

  test('completed point quiz blocks advancement until evidence arrives without manufacturing mastery', () => {
    const input = courseInput();
    input.assessment.progressionPolicy = 'mastery';
    const version = activateCourseVersion(createCourseVersion(input));
    let session = finish(version, createStudySession(version, 'practice'));
    session = finish(version, session);
    const before = structuredClone(session);
    expect(nextActivity(version, session)).toEqual({
      kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['variables'],
    });
    expect(next(version, session, ['variables'])).toMatchObject({ kind: 'lesson', knowledgePointIds: ['loops'] });
    expect(session).toEqual(before);
    expect(() => transitionSession(version, session, session.revision, {
      type: 'start_activity', activityId: JSON.stringify([version.courseVersionId, 'lesson', 'loops']),
    })).toThrow(LearningError);
  });

  test('reading allows a chapter quiz but never substitutes for evidence after its completion', () => {
    const input = courseInput();
    input.assessment.progressionPolicy = 'mastery';
    const version = activateCourseVersion(createCourseVersion(input));
    let session = createStudySession(version, 'theory');
    session = finish(version, session);
    session = finish(version, session);
    expect(next(version, session).kind).toBe('chapter_quiz');
    session = finish(version, session);
    expect(session.completedActivityIds).toHaveLength(3);
    expect(nextActivity(version, session)).toEqual({
      kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['variables', 'loops'],
    });
    expect(nextActivity(version, session, ['variables'])).toEqual({
      kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['loops'],
    });
    expect(nextActivity(version, session, ['variables', 'loops'])).toEqual({ kind: 'done' });
  });

  test('module overrides govern point/chapter gates while final uses course policy', () => {
    const input = courseInput();
    input.assessment.progressionPolicy = 'mastery';
    input.outline[0].assessment = { progressionPolicy: 'completed' };
    const version = activateCourseVersion(createCourseVersion(input));
    let session = declare(version, createStudySession(version, 'drill'), ['variables', 'loops']);
    session = finish(version, session);
    session = finish(version, session);
    expect(next(version, session).kind).toBe('final_quiz');
    session = finish(version, session);
    expect(session.completedActivityIds).toHaveLength(3);
    expect(nextActivity(version, session)).toEqual({
      kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['variables', 'loops'],
    });
    expect(nextActivity(version, session, ['variables', 'loops'])).toEqual({ kind: 'done' });
    input.assessment.progressionPolicy = 'completed';
    input.outline[0].assessment = { progressionPolicy: 'mastery' };
    const stricter = activateCourseVersion(createCourseVersion(input));
    let practice = finish(stricter, createStudySession(stricter, 'practice'));
    practice = finish(stricter, practice);
    expect(nextActivity(stricter, practice).kind).toBe('blocked');
  });

  test('evidence does not add allowed knowledge or bypass diagnostic requirements', () => {
    const version = activeVersion();
    const session = createStudySession(version, 'drill');
    expect(next(version, session, ['variables', 'loops']).kind).toBe('diagnostic');
    expect(allowedKnowledgePointIds(session)).toEqual([]);
    expect(() => nextActivity(version, session, ['foreign'])).toThrow(LearningError);
    expect(() => nextActivity(version, session, [' '])).toThrow(LearningError);
  });
});
