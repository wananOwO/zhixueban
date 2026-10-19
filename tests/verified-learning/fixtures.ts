import type { CourseInput } from '@/lib/verified-learning/contracts';
import { activateCourseVersion, createCourseVersion } from '@/lib/verified-learning/course-version';

export function courseInput(): CourseInput {
  return {
    textbookId: 'book-a',
    goal: 'Python basics',
    teachingPrompt: '',
    priorKnowledge: [],
    includedTopics: [],
    excludedTopics: [],
    allowSupplementalSources: true,
    assessment: {
      pointQuestionCount: 3,
      chapterQuestionCount: 10,
      finalQuestionCount: 10,
      difficulty: 'easy',
      progressionPolicy: 'completed',
    },
    sourceRevisions: [{ sourceId: 'book-a', sourceRevision: 'rev-1' }],
    outline: [{
      moduleId: 'basics',
      title: 'Basics',
      points: [
        {
          knowledgePointId: 'variables', title: 'Variables', prerequisiteIds: [],
          sourceIds: ['book-a'], role: 'target', coverage: 'covered', reason: 'Required',
        },
        {
          knowledgePointId: 'loops', title: 'Loops', prerequisiteIds: ['variables'],
          sourceIds: ['book-a'], role: 'target', coverage: 'covered', reason: 'Required',
        },
      ],
    }],
  };
}

export function activeVersion() {
  return activateCourseVersion(createCourseVersion(courseInput()));
}
