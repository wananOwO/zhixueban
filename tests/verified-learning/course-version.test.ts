import { describe, expect, test } from 'vitest';
import { LearningError, type CourseVersion } from '@/lib/verified-learning/contracts';
import { activateCourseVersion, createCourseVersion, reviseCourseVersion } from '@/lib/verified-learning/course-version';
import { courseInput, activeVersion } from './fixtures';

describe('course version snapshots', () => {
  test('creation and revision issue new draft IDs without modifying history', () => {
    const first = createCourseVersion(courseInput());
    const next = reviseCourseVersion(first, { ...courseInput(), goal: 'Algorithms' });
    expect(next.courseId).toBe(first.courseId);
    expect(next.courseVersionId).not.toBe(first.courseVersionId);
    expect(first.goal).toBe('Python basics');
    expect(next.status).toBe('draft');
    expect(first.engine).toBe('verified-v1');
    expect(first.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(createCourseVersion(courseInput()).courseId).not.toBe(first.courseId);
    expect(() => createCourseVersion(courseInput(), ' ')).toThrow(LearningError);
  });

  test('activation retains identity and all snapshots are deeply detached', () => {
    const input = courseInput();
    const draft = createCourseVersion(input);
    const active = activateCourseVersion(draft);
    const revision = reviseCourseVersion(active, input);
    expect(active.courseVersionId).toBe(draft.courseVersionId);
    expect(active.status).toBe('active');
    expect(draft.status).toBe('draft');
    input.outline[0].points[0].title = 'Input edit';
    active.outline[0].points[0].sourceIds.push('other');
    revision.sourceRevisions[0].sourceRevision = 'changed';
    expect(draft.outline[0].points[0].title).toBe('Variables');
    expect(draft.outline[0].points[0].sourceIds).toEqual(['book-a']);
    expect(active.sourceRevisions[0].sourceRevision).toBe('rev-1');
  });

  describe.each([
    ['activation', activateCourseVersion],
    ['revision', (version: CourseVersion) => reviseCourseVersion(version, courseInput())],
  ] as const)('%s metadata validation', (_operation, consume) => {
    test.each([
      ['courseId', ' '],
      ['courseVersionId', ' '],
      ['courseId', 7],
      ['courseVersionId', undefined],
      ['engine', 'legacy'],
      ['status', 'published'],
      ['createdAt', 'not-a-timestamp'],
      ['createdAt', '2026-02-30T00:00:00.000Z'],
      ['createdAt', '2026-10-20T00:00:00'],
      ['createdAt', '2026-10-20T00:00:00+08:00'],
    ])('rejects invalid %s = %s', (field, value) => {
      const version = createCourseVersion(courseInput());
      Object.assign(version, { [field]: value });
      expect(() => consume(version)).toThrow(LearningError);
    });
  });

  test('retains opaque metadata IDs and valid UTC timestamps without normalization', () => {
    const version = createCourseVersion(courseInput(), ' opaque-course ');
    version.courseVersionId = ' opaque-version ';
    version.createdAt = '2024-02-29T12:30:00Z';
    expect(activateCourseVersion(version)).toMatchObject({
      courseId: ' opaque-course ', courseVersionId: ' opaque-version ',
      createdAt: '2024-02-29T12:30:00Z',
    });
    expect(reviseCourseVersion(version, courseInput()).courseId).toBe(' opaque-course ');
  });

  test('rejects duplicate module, point and source revision IDs at draft creation', () => {
    const inputs = [courseInput(), courseInput(), courseInput()];
    inputs[0].outline.push({ ...inputs[0].outline[0], points: [] });
    inputs[1].outline[0].points.push(inputs[1].outline[0].points[0]);
    inputs[2].sourceRevisions.push({ sourceId: 'book-a', sourceRevision: 'rev-2' });
    for (const input of inputs) expect(() => createCourseVersion(input)).toThrow(LearningError);
  });

  test('keeps gaps and unresolved prerequisites in drafts but rejects activation', () => {
    const inputs = [courseInput(), courseInput(), courseInput(), courseInput(), courseInput()];
    inputs[0].outline = [];
    inputs[1].outline[0].points[0].coverage = 'missing';
    inputs[2].outline[0].points[0].prerequisiteIds = ['unknown'];
    inputs[3].outline[0].points = [];
    inputs[4].outline[0].points[0].sourceIds = [];
    for (const input of inputs) {
      const draft = createCourseVersion(input);
      expect(draft.status).toBe('draft');
      expect(() => activateCourseVersion(draft)).toThrow(LearningError);
    }
  });

  test('rejects reversed order, cycles and self prerequisites', () => {
    const inputs = [courseInput(), courseInput(), courseInput()];
    inputs[0].outline[0].points.reverse();
    inputs[1].outline[0].points[0].prerequisiteIds = ['loops'];
    inputs[2].outline[0].points[0].prerequisiteIds = ['variables'];
    for (const input of inputs) expect(() => activateCourseVersion(createCourseVersion(input))).toThrow(LearningError);
  });

  test('prior knowledge does not conceal a cycle or self dependency in the outline', () => {
    const input = courseInput();
    input.priorKnowledge = [
      { knowledgePointId: 'variables', source: 'declared' },
      { knowledgePointId: 'loops', source: 'diagnosed' },
    ];
    input.outline[0].points[0].prerequisiteIds = ['loops'];
    expect(() => activateCourseVersion(createCourseVersion(input))).toThrow(LearningError);
    input.outline[0].points[0].prerequisiteIds = ['variables'];
    expect(() => activateCourseVersion(createCourseVersion(input))).toThrow(LearningError);
  });

  test('accepts explicitly recorded prior knowledge and cross-module prerequisites', () => {
    const input = courseInput();
    input.outline[0].points[0].prerequisiteIds = ['arithmetic'];
    input.priorKnowledge = [{ knowledgePointId: 'arithmetic', source: 'declared' }];
    const loops = input.outline[0].points.pop()!;
    input.outline.push({ moduleId: 'next', title: 'Next', points: [loops] });
    expect(activateCourseVersion(createCourseVersion(input)).status).toBe('active');
    expect(activeVersion().status).toBe('active');
  });

  test('rejects absent source revisions and disabled supplemental sources', () => {
    const missing = courseInput();
    missing.sourceRevisions = [];
    expect(() => activateCourseVersion(createCourseVersion(missing))).toThrow(LearningError);
    const supplemental = courseInput();
    supplemental.outline[0].points[0].sourceIds = ['external'];
    supplemental.outline[0].points[0].coverage = 'supplemented';
    supplemental.sourceRevisions.push({ sourceId: 'external', sourceRevision: 'ext-v1' });
    expect(activateCourseVersion(createCourseVersion(supplemental)).status).toBe('active');
    supplemental.allowSupplementalSources = false;
    expect(() => activateCourseVersion(createCourseVersion(supplemental))).toThrow(LearningError);
  });
});
