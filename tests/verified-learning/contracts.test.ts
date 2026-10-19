import { describe, expect, test } from 'vitest';
import {
  LearningError, parseAssessment, parseCourseInput, toQuestionView,
  type StoredQuestion,
} from '@/lib/verified-learning/contracts';
import {
  fromLegacyMode, toLegacyMode, toSourceAnchor, toLegacyAnchor, importLegacyCourse,
  type LegacyCourseRow, type LegacyPoint,
} from '@/lib/verified-learning/legacy';
import { courseInput } from './fixtures';

describe('validated contracts', () => {
  test('applies assessment defaults and accepts endpoints', () => {
    expect(parseAssessment({})).toEqual({
      pointQuestionCount: 3, chapterQuestionCount: 10, finalQuestionCount: 10,
      difficulty: 'easy', progressionPolicy: 'completed',
    });
    expect(parseAssessment({ pointQuestionCount: 1, finalQuestionCount: 50 }))
      .toMatchObject({ pointQuestionCount: 1, finalQuestionCount: 50 });
  });

  test.each([0, -1, 51, 1.5, NaN, Infinity, '3', null])('rejects invalid count %s', value => {
    for (const field of ['pointQuestionCount', 'chapterQuestionCount', 'finalQuestionCount']) {
      expect(() => parseAssessment({ [field]: value })).toThrow(LearningError);
    }
  });

  test.each([
    { difficulty: 'expert' }, { progressionPolicy: 'threshold' }, { extra: true }, null,
  ])('rejects invalid assessment %s', value => {
    expect(() => parseAssessment(value)).toThrow(LearningError);
  });

  test('defaults course optional fields and preserves opaque IDs', () => {
    const input = courseInput();
    const parsed = parseCourseInput({
      textbookId: ' book-a ', goal: input.goal, outline: input.outline,
    });
    expect(parsed).toMatchObject({
      textbookId: ' book-a ', teachingPrompt: '', priorKnowledge: [],
      includedTopics: [], excludedTopics: [], sourceRevisions: [],
      allowSupplementalSources: true, assessment: parseAssessment({}),
    });
  });

  test('module overrides inherit the course settings rather than defaults', () => {
    const input = courseInput();
    input.assessment.difficulty = 'hard';
    input.assessment.pointQuestionCount = 7;
    input.outline[0].assessment = { chapterQuestionCount: 4 };
    expect(parseCourseInput(input).outline[0].assessment).toEqual({
      ...input.assessment, chapterQuestionCount: 4,
    });
  });

  test('undefined optional module overrides still inherit course settings', () => {
    const input = courseInput();
    input.assessment.difficulty = 'hard';
    input.outline[0].assessment = { difficulty: undefined };
    expect(parseCourseInput(input).outline[0].assessment?.difficulty).toBe('hard');
  });

  test('rejects missing required fields, unknown nested keys and malformed IDs', () => {
    for (const field of ['textbookId', 'goal', 'outline']) {
      const input: Record<string, unknown> = { ...courseInput() };
      delete input[field];
      expect(() => parseCourseInput(input)).toThrow(LearningError);
    }
    const mutations = [
      (input: ReturnType<typeof courseInput>) => { input.textbookId = ' '; },
      (input: ReturnType<typeof courseInput>) => { input.outline[0].points[0].knowledgePointId = ''; },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input, { ignored: true }); },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input.outline[0], { ignored: true }); },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input.outline[0].points[0], { ignored: true }); },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input.sourceRevisions[0], { ignored: true }); },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input.outline[0], { points: undefined }); },
      (input: ReturnType<typeof courseInput>) => { Object.assign(input.outline[0].points[0], { coverage: 'guessed' }); },
    ];
    for (const mutate of mutations) {
      const input = courseInput();
      mutate(input);
      expect(() => parseCourseInput(input)).toThrow(LearningError);
    }
  });

  test('projects only student fields and detaches options', () => {
    const stored: StoredQuestion = {
      questionId: 'q1', courseId: 'c1', courseVersionId: 'v1', type: 'choice',
      stem: 'Choose', options: ['A', 'B'], difficulty: 'easy',
      answer: 'ANSWER_SENTINEL', referenceSolution: 'REFERENCE_SENTINEL',
      hiddenTests: [{ secret: 'HIDDEN_SENTINEL' }],
    };
    const view = toQuestionView(stored);
    expect(view).toEqual({
      questionId: 'q1', courseId: 'c1', courseVersionId: 'v1', type: 'choice',
      stem: 'Choose', options: ['A', 'B'], difficulty: 'easy',
    });
    expect(JSON.stringify(view)).not.toMatch(/ANSWER_SENTINEL|REFERENCE_SENTINEL|HIDDEN_SENTINEL/);
    view.options!.push('C');
    expect(stored.options).toEqual(['A', 'B']);
  });
});

describe('legacy adapters', () => {
  test.each([[1, 'theory'], [2, 'practice'], [3, 'drill']] as const)('round trips mode %s', (number, name) => {
    expect(fromLegacyMode(number)).toBe(name);
    expect(toLegacyMode(name)).toBe(number);
  });

  test.each([0, 4, 1.5, '1', null, {}, NaN])('rejects legacy mode %s', value => {
    expect(() => fromLegacyMode(value)).toThrow(LearningError);
  });
  test.each(['other', 1, null, {}])('rejects learning mode %s', value => {
    expect(() => toLegacyMode(value)).toThrow(LearningError);
  });

  test('round trips zero-based anchors without coercion', () => {
    expect(toSourceAnchor({ chapterId: ' ch1 ', index: 0 })).toEqual({ chapterId: ' ch1 ', paragraphIndex: 0 });
    expect(toLegacyAnchor({ chapterId: 'ch1', paragraphIndex: 0 })).toEqual({ chapterId: 'ch1', index: 0 });
    expect(() => toSourceAnchor({ chapterId: 'ch1', index: -1 })).toThrow(LearningError);
    expect(() => toLegacyAnchor({ chapterId: '', paragraphIndex: 0 })).toThrow(LearningError);
  });

  const points: LegacyPoint[] = [
    { id: 'p1', title: 'One', chapter_ref: 'a' },
    { id: 'p2', title: 'Two', chapter_ref: 'b' },
    { id: 'p3', title: 'Three', chapter_ref: 'a' },
  ];
  function row(outline: unknown = { nodes: points.map(point => ({ kpId: point.id, depth: 'normal' })) }): LegacyCourseRow {
    return { id: 'old-course', textbook_id: 'book-a', goal: 'Learn', goal_prompt: 'Explain', mode: 2, outline_json: JSON.stringify(outline) };
  }

  test('imports ordered contiguous chapter groups as review-only drafts', () => {
    const result = importLegacyCourse(row(), points);
    expect(result).toMatchObject({ mode: 'practice', masteryOrigin: 'legacy' });
    expect(result.draft).toMatchObject({ courseId: 'old-course', status: 'draft', teachingPrompt: 'Explain', assessment: parseAssessment({}) });
    expect(result.draft.outline.flatMap(module => module.points.map(point => point.knowledgePointId))).toEqual(['p1', 'p2', 'p3']);
    expect(new Set(result.draft.outline.map(module => module.moduleId)).size).toBe(3);
    expect(result.draft.outline.every(module => module.points.every(point => point.coverage === 'missing' && point.sourceIds.length === 0))).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('maps positive legacy thresholds with an explicit conversion warning', () => {
    const result = importLegacyCourse(row({
      version: 1, nodes: [{ kpId: 'p1', depth: 'brief' }], gaps: [],
      quizConfig: { perKnowledgePoint: 4, perChapter: 5, finalCount: 6, passThreshold: 0.8 },
      review: { kept: ['p1'], excluded: [], reorderReason: '', supplements: [] },
    }), points);
    expect(result.draft.assessment).toMatchObject({
      pointQuestionCount: 4, chapterQuestionCount: 5, finalQuestionCount: 6, progressionPolicy: 'mastery',
    });
    expect(result.warnings.join(' ')).toMatch(/threshold.*not equivalent/i);
  });

  test('groups adjacent same-chapter points and retains completed policy for a zero threshold', () => {
    const result = importLegacyCourse(row({
      nodes: [{ kpId: 'p1', depth: 'normal' }, { kpId: 'p3', depth: 'deep' }],
      quizConfig: { passThreshold: 0 },
    }), points);
    expect(result.draft.outline).toHaveLength(1);
    expect(result.draft.outline[0].points.map(point => point.knowledgePointId)).toEqual(['p1', 'p3']);
    expect(result.draft.assessment.progressionPolicy).toBe('completed');
  });

  test.each([
    { nodes: [{ kpId: 'unknown', depth: 'normal' }] },
    { nodes: [{ kpId: 'p1', depth: 'normal' }, { kpId: 'p1', depth: 'deep' }] },
    { nodes: [{ kpId: 'p1', depth: 'invalid' }] },
    { nodes: [], quizConfig: { perChapter: 0 } },
    { nodes: [], quizConfig: { passThreshold: -1 } },
    { nodes: [], quizConfig: { passThreshold: 2 } },
    { nodes: [], unexpected: true },
  ])('rejects invalid legacy outlines %s', outline => {
    expect(() => importLegacyCourse(row(outline), points)).toThrow(LearningError);
  });
  test('rejects invalid JSON and duplicate point catalog IDs', () => {
    expect(() => importLegacyCourse({ ...row(), outline_json: '{' }, points)).toThrow(LearningError);
    expect(() => importLegacyCourse(row(), [...points, points[0]])).toThrow(LearningError);
  });
});
