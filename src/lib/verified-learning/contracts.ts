import { z } from 'zod';

export type LearningMode = 'theory' | 'practice' | 'drill';
export type LegacyMode = 1 | 2 | 3;
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'VERSION_CONFLICT'
  | 'VALIDATION_FAILED' | 'ACTIVITY_IN_PROGRESS';

export class LearningError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'LearningError';
  }
}

export interface AssessmentSettings {
  pointQuestionCount: number;
  chapterQuestionCount: number;
  finalQuestionCount: number;
  difficulty: Difficulty;
  progressionPolicy: 'completed' | 'mastery';
}

export interface PriorKnowledge {
  knowledgePointId: string;
  source: 'declared' | 'diagnosed';
}

export interface CurriculumPointView {
  knowledgePointId: string;
  title: string;
  prerequisiteIds: string[];
  sourceIds: string[];
  role: 'target' | 'prerequisite' | 'supplement';
  coverage: 'covered' | 'missing' | 'supplemented';
  reason: string;
}

export interface CourseModuleView {
  moduleId: string;
  title: string;
  points: CurriculumPointView[];
  assessment?: Partial<AssessmentSettings>;
}

export interface CourseVersion {
  courseId: string;
  courseVersionId: string;
  engine: 'verified-v1';
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
  textbookId: string;
  goal: string;
  teachingPrompt: string;
  priorKnowledge: PriorKnowledge[];
  includedTopics: string[];
  excludedTopics: string[];
  allowSupplementalSources: boolean;
  assessment: AssessmentSettings;
  outline: CourseModuleView[];
  sourceRevisions: { sourceId: string; sourceRevision: string }[];
}

export type CourseInput = Omit<CourseVersion, 'courseId' | 'courseVersionId' | 'engine' | 'status' | 'createdAt'>;

const id = z.string().refine(value => value.trim().length > 0);
const questionCount = z.number().int().min(1).max(50);
const assessmentFields = {
  pointQuestionCount: questionCount,
  chapterQuestionCount: questionCount,
  finalQuestionCount: questionCount,
  difficulty: z.enum(['easy', 'medium', 'hard']),
  progressionPolicy: z.enum(['completed', 'mastery']),
};
const assessmentSchema = z.strictObject({
  ...assessmentFields,
  pointQuestionCount: questionCount.default(3),
  chapterQuestionCount: questionCount.default(10),
  finalQuestionCount: questionCount.default(10),
  difficulty: assessmentFields.difficulty.default('easy'),
  progressionPolicy: assessmentFields.progressionPolicy.default('completed'),
});
const assessmentOverrideSchema = z.strictObject(assessmentFields).partial();
const pointSchema = z.strictObject({
  knowledgePointId: id,
  title: id,
  prerequisiteIds: z.array(id),
  sourceIds: z.array(id),
  role: z.enum(['target', 'prerequisite', 'supplement']),
  coverage: z.enum(['covered', 'missing', 'supplemented']),
  reason: z.string(),
});
const courseSchema = z.strictObject({
  textbookId: id,
  goal: id,
  teachingPrompt: z.string().default(''),
  priorKnowledge: z.array(z.strictObject({
    knowledgePointId: id,
    source: z.enum(['declared', 'diagnosed']),
  })).default([]),
  includedTopics: z.array(id).default([]),
  excludedTopics: z.array(id).default([]),
  allowSupplementalSources: z.boolean().default(true),
  assessment: assessmentSchema.default(() => parseAssessment({})),
  outline: z.array(z.strictObject({
    moduleId: id,
    title: id,
    points: z.array(pointSchema),
    assessment: assessmentOverrideSchema.optional(),
  })),
  sourceRevisions: z.array(z.strictObject({ sourceId: id, sourceRevision: id })).default([]),
});

export function parseAssessment(input: unknown): AssessmentSettings {
  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('INVALID_INPUT', 'Invalid assessment settings');
  return parsed.data;
}

export function parseCourseInput(input: unknown): CourseInput {
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('INVALID_INPUT', 'Invalid course input');
  const course = parsed.data;
  const ids = [
    course.outline.map(module => module.moduleId),
    course.outline.flatMap(module => module.points.map(point => point.knowledgePointId)),
    course.sourceRevisions.map(source => source.sourceId),
  ];
  if (ids.some(values => new Set(values).size !== values.length)) {
    throw new LearningError('INVALID_INPUT', 'Duplicate module, point or source ID');
  }
  for (const module of course.outline) {
    if (module.assessment) {
      const overrides = Object.fromEntries(Object.entries(module.assessment).filter(([, value]) => value !== undefined));
      module.assessment = { ...course.assessment, ...overrides };
    }
  }
  return course;
}

export interface StoredQuestion {
  questionId: string;
  courseId: string;
  courseVersionId: string;
  type: 'choice' | 'fill' | 'code';
  stem: string;
  options?: string[];
  difficulty: Difficulty;
  answer: string;
  referenceSolution?: string;
  hiddenTests?: unknown[];
}

export type QuestionView = Pick<StoredQuestion,
  'questionId' | 'courseId' | 'courseVersionId' | 'type' | 'stem' | 'options' | 'difficulty'>;

export function toQuestionView(question: StoredQuestion): QuestionView {
  return {
    questionId: question.questionId,
    courseId: question.courseId,
    courseVersionId: question.courseVersionId,
    type: question.type,
    stem: question.stem,
    options: question.options?.slice(),
    difficulty: question.difficulty,
  };
}
