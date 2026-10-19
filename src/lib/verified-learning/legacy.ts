import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Paragraph } from '@/lib/textbook/types';
import {
  LearningError, parseAssessment, type CourseModuleView, type CourseVersion,
  type LearningMode, type LegacyMode,
} from './contracts';
import { createCourseVersion } from './course-version';

const id = z.string().refine(value => value.trim().length > 0);
const legacyModeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const learningModeSchema = z.enum(['theory', 'practice', 'drill']);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new LearningError('INVALID_INPUT', 'Invalid legacy input');
  return result.data;
}

export function fromLegacyMode(input: unknown): LearningMode {
  return ({ 1: 'theory', 2: 'practice', 3: 'drill' } as const)[parse(legacyModeSchema, input)];
}

export function toLegacyMode(input: unknown): LegacyMode {
  return ({ theory: 1, practice: 2, drill: 3 } as const)[parse(learningModeSchema, input)];
}

export function toSourceAnchor(anchor: Paragraph['anchor']): { chapterId: string; paragraphIndex: number } {
  const value = parse(z.strictObject({ chapterId: id, index: z.number().int().min(0) }), anchor);
  return { chapterId: value.chapterId, paragraphIndex: value.index };
}

export function toLegacyAnchor(anchor: { chapterId: string; paragraphIndex: number }): Paragraph['anchor'] {
  const value = parse(z.strictObject({ chapterId: id, paragraphIndex: z.number().int().min(0) }), anchor);
  return { chapterId: value.chapterId, index: value.paragraphIndex };
}

export interface LegacyCourseRow {
  id: string;
  textbook_id: string;
  goal: string;
  goal_prompt: string;
  mode: number;
  outline_json: string;
}

export interface LegacyPoint {
  id: string;
  title: string;
  chapter_ref: string;
}

const rowSchema = z.strictObject({
  id, textbook_id: id, goal: id, goal_prompt: z.string(),
  mode: legacyModeSchema, outline_json: z.string(),
});
const legacyPointsSchema = z.array(z.strictObject({ id, title: id, chapter_ref: id }));
const legacyOutlineSchema = z.strictObject({
  version: z.literal(1).optional(),
  nodes: z.array(z.strictObject({ kpId: id, depth: z.enum(['brief', 'normal', 'deep']) })),
  gaps: z.array(z.string()).optional(),
  quizConfig: z.strictObject({
    perKnowledgePoint: z.number().int().min(1).max(50).optional(),
    perChapter: z.number().int().min(1).max(50).optional(),
    finalCount: z.number().int().min(1).max(50).optional(),
    passThreshold: z.number().min(0).max(1).optional(),
  }).optional(),
  review: z.strictObject({
    kept: z.array(z.string()), excluded: z.array(z.string()),
    reorderReason: z.string(), supplements: z.array(z.string()),
  }).optional(),
});

export function importLegacyCourse(row: LegacyCourseRow, points: LegacyPoint[]): {
  draft: CourseVersion;
  mode: LearningMode;
  masteryOrigin: 'legacy';
  warnings: string[];
} {
  const course = parse(rowSchema, row);
  const catalog = parse(legacyPointsSchema, points);
  const byId = new Map(catalog.map(point => [point.id, point]));
  if (byId.size !== catalog.length) throw new LearningError('INVALID_INPUT', 'Duplicate legacy point ID');
  let json: unknown;
  try {
    json = JSON.parse(course.outline_json);
  } catch {
    throw new LearningError('INVALID_INPUT', 'Malformed legacy outline JSON');
  }
  const legacy = parse(legacyOutlineSchema, json);
  const settings = legacy.quizConfig;
  const mastery = (settings?.passThreshold ?? 0) > 0;
  const warnings = ['Legacy source coverage and prerequisites require review; old mastery scores are not verified state.'];
  if (mastery) warnings.push('Legacy threshold converted to mastery policy; numeric thresholds are not equivalent.');
  const outline: CourseModuleView[] = [];
  let previousChapter: string | undefined;
  for (const node of legacy.nodes) {
    const point = byId.get(node.kpId);
    if (!point) throw new LearningError('INVALID_INPUT', 'Unknown legacy point ID');
    if (point.chapter_ref !== previousChapter) {
      outline.push({ moduleId: randomUUID(), title: point.chapter_ref, points: [] });
      previousChapter = point.chapter_ref;
    }
    outline[outline.length - 1].points.push({
      knowledgePointId: point.id, title: point.title, prerequisiteIds: [],
      sourceIds: [], role: 'target', coverage: 'missing', reason: 'Imported legacy point; source and prerequisite review required',
    });
  }
  return {
    draft: createCourseVersion({
      textbookId: course.textbook_id, goal: course.goal, teachingPrompt: course.goal_prompt,
      outline,
      assessment: parseAssessment({
        pointQuestionCount: settings?.perKnowledgePoint,
        chapterQuestionCount: settings?.perChapter,
        finalQuestionCount: settings?.finalCount,
        progressionPolicy: mastery ? 'mastery' : 'completed',
      }),
    }, course.id),
    mode: fromLegacyMode(course.mode),
    masteryOrigin: 'legacy',
    warnings,
  };
}
