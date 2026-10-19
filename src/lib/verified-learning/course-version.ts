import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  LearningError, parseCourseInput, type CourseVersion, type CurriculumPointView,
} from './contracts';

const id = z.string().refine(value => value.trim().length > 0);
const metadataSchema = z.strictObject({
  courseId: id,
  courseVersionId: id,
  engine: z.literal('verified-v1'),
  status: z.enum(['draft', 'active', 'archived']),
  createdAt: z.iso.datetime(),
});

function parseCourseVersion(version: CourseVersion): CourseVersion {
  const { courseId, courseVersionId, engine, status, createdAt, ...input } = version;
  const metadata = metadataSchema.safeParse({ courseId, courseVersionId, engine, status, createdAt });
  if (!metadata.success) throw new LearningError('INVALID_INPUT', 'Invalid course version metadata');
  return { ...parseCourseInput(input), ...metadata.data };
}

export function createCourseVersion(input: unknown, courseId: string = randomUUID()): CourseVersion {
  if (typeof courseId !== 'string' || courseId.trim().length === 0) {
    throw new LearningError('INVALID_INPUT', 'Invalid course ID');
  }
  return {
    ...parseCourseInput(input),
    courseId,
    courseVersionId: randomUUID(),
    engine: 'verified-v1',
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

export function reviseCourseVersion(previous: CourseVersion, input: unknown): CourseVersion {
  return createCourseVersion(input, parseCourseVersion(previous).courseId);
}

function assertAcyclic(points: CurriculumPointView[]): void {
  const indegree = new Map(points.map(point => [point.knowledgePointId, 0]));
  const dependents = new Map<string, string[]>();
  for (const point of points) {
    for (const prerequisite of point.prerequisiteIds) {
      if (!indegree.has(prerequisite)) continue;
      indegree.set(point.knowledgePointId, indegree.get(point.knowledgePointId)! + 1);
      const targets = dependents.get(prerequisite) ?? [];
      targets.push(point.knowledgePointId);
      dependents.set(prerequisite, targets);
    }
  }
  const ready = [...indegree.keys()].filter(id => indegree.get(id) === 0);
  for (let index = 0; index < ready.length; index++) {
    for (const target of dependents.get(ready[index]) ?? []) {
      const count = indegree.get(target)! - 1;
      indegree.set(target, count);
      if (count === 0) ready.push(target);
    }
  }
  if (ready.length !== points.length) {
    throw new LearningError('VALIDATION_FAILED', 'Course prerequisites contain a cycle');
  }
}

export function activateCourseVersion(version: CourseVersion): CourseVersion {
  const course = parseCourseVersion(version);
  const points = course.outline.flatMap(module => module.points);
  if (course.outline.length === 0 || course.outline.some(module => module.points.length === 0)) {
    throw new LearningError('VALIDATION_FAILED', 'Course outline is empty');
  }
  // Prior knowledge may satisfy ordering, but must not conceal an in-outline cycle.
  assertAcyclic(points);
  const available = new Set(course.priorKnowledge.map(point => point.knowledgePointId));
  const sources = new Set(course.sourceRevisions.map(source => source.sourceId));
  for (const point of points) {
    if (point.coverage === 'missing' || point.sourceIds.length === 0 ||
      point.sourceIds.some(source => !sources.has(source))) {
      throw new LearningError('VALIDATION_FAILED', 'Course point lacks source coverage');
    }
    if (!course.allowSupplementalSources &&
      (point.coverage === 'supplemented' || point.sourceIds.some(source => source !== course.textbookId))) {
      throw new LearningError('VALIDATION_FAILED', 'Supplemental sources are disabled');
    }
    if (point.prerequisiteIds.some(prerequisite => !available.has(prerequisite))) {
      throw new LearningError('VALIDATION_FAILED', 'Course prerequisite is not available earlier in the outline');
    }
    available.add(point.knowledgePointId);
  }
  return { ...course, status: 'active' };
}
