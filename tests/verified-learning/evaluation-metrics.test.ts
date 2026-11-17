import { describe, expect, it } from 'vitest';
import {
  computeGenerationMetrics,
  computeLearningMetrics,
  evaluateLearningPipeline,
  formatMetric,
  learningReportToMarkdown,
  ratioMetric,
} from '@/lib/verified-learning/evaluation/metrics';

describe('生成 / 学习 / 工程量化指标计算', () => {
  it('无样本时明确返回 unavailable，绝不用 0 伪装真实结果', () => {
    const empty = ratioMetric(0, 0);
    expect(empty).toEqual({ status: 'unavailable', value: null, numerator: 0, denominator: 0 });
    expect(formatMetric(empty)).toBe('不可用（0/0，无样本）');

    const gen = computeGenerationMetrics({
      lessonsTotal: 0,
      lessonsPassed: 0,
      questionsTotal: 0,
      questionsFirstPass: 0,
      citationsTotal: 0,
      citationsValid: 0,
      duplicateCandidates: 0,
      duplicateIntercepted: 0,
      resumedJobsTotal: 0,
      resumedJobsSucceeded: 0,
    });
    expect(gen.lessonPassRate.status).toBe('unavailable');
    expect(gen.questionFirstPassReviewRate.status).toBe('unavailable');
    expect(gen.jobRecoveryRate.status).toBe('unavailable');

    const learn = computeLearningMetrics({
      diagnosticCorrect: 0,
      diagnosticTotal: 0,
      practiceCorrect: 0,
      practiceTotal: 0,
      verifiedPoints: 0,
      totalPoints: 0,
      remedialDeltas: [],
      completionMinutes: [],
    });
    expect(learn.diagnosticAccuracyBefore.status).toBe('unavailable');
    expect(learn.remedialGain.status).toBe('unavailable');
    expect(learn.goalCompletionMinutes.status).toBe('unavailable');
  });

  it('有样本时准确计算生成验收率、首轮审校通过率、重复题拦截率、补练提升幅度与掌握通过率', () => {
    const gen = computeGenerationMetrics({
      lessonsTotal: 4,
      lessonsPassed: 4,
      questionsTotal: 10,
      questionsFirstPass: 8,
      citationsTotal: 15,
      citationsValid: 15,
      duplicateCandidates: 3,
      duplicateIntercepted: 3,
      resumedJobsTotal: 2,
      resumedJobsSucceeded: 2,
    });
    expect(gen.lessonPassRate).toEqual({ status: 'ok', value: 1, numerator: 4, denominator: 4 });
    expect(gen.questionFirstPassReviewRate).toEqual({ status: 'ok', value: 0.8, numerator: 8, denominator: 10 });
    expect(gen.citationConsistencyRate).toEqual({ status: 'ok', value: 1, numerator: 15, denominator: 15 });
    expect(gen.duplicateQuestionInterceptRate).toEqual({ status: 'ok', value: 1, numerator: 3, denominator: 3 });
    expect(gen.jobRecoveryRate).toEqual({ status: 'ok', value: 1, numerator: 2, denominator: 2 });

    const learn = computeLearningMetrics({
      diagnosticCorrect: 1,
      diagnosticTotal: 4,
      practiceCorrect: 9,
      practiceTotal: 10,
      verifiedPoints: 2,
      totalPoints: 2,
      remedialDeltas: [0.4, 0.6],
      completionMinutes: [18, 22, 26],
    });
    expect(learn.diagnosticAccuracyBefore.value).toBeCloseTo(0.25);
    expect(learn.practiceAccuracyAfter.value).toBeCloseTo(0.9);
    expect(learn.masteryPassRate.value).toBe(1);
    expect(learn.remedialGain).toMatchObject({ status: 'ok', sampleCount: 2 });
    expect(learn.remedialGain.value!).toBeCloseTo(0.5);
    expect(learn.goalCompletionMinutes).toMatchObject({ status: 'ok', value: 22, sampleCount: 3 });
  });

  it('离线端到端学习管线评测只用临时数据库，输出完整可审计指标与 Markdown 报告', async () => {
    const report = await evaluateLearningPipeline({ gitRevision: 'test-sha' });
    expect(report.gitRevision).toBe('test-sha');
    expect(report.generation.citationConsistencyRate).toMatchObject({ status: 'ok', value: 1 });
    expect(report.generation.duplicateQuestionInterceptRate).toMatchObject({ status: 'ok', value: 1 });
    expect(report.generation.jobRecoveryRate).toMatchObject({ status: 'ok', value: 1 });
    expect(report.engineering.sampleCourseAvailableRate).toMatchObject({ status: 'ok', value: 1 });
    expect(report.learning.masteryPassRate.status).toBe('ok');
    const md = learningReportToMarkdown(report);
    expect(md).toContain('生成质量与自愈验收指标');
    expect(md).toContain('学习证据与掌握闭环指标');
    expect(md).toContain('工程与免 Key 示例课程指标');
  });
});
