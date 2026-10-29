import { describe, expect, test } from 'vitest';
import {
  LearningError, parseAssessment, parseCourseInput, toQuestionView,
  type StoredQuestion,
} from '@/lib/verified-learning/contracts';
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
