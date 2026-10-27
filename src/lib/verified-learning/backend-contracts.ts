import { z } from 'zod';
import { LearningError, parseAssessment, type AssessmentSettings, type LearningMode } from './contracts';
import type { CitationInput, SourceRef, SourceSnapshot } from './sources';

export const identifier = z.string().trim().min(1).max(512);
export const languageSchema = z.enum(['python','javascript','c']);
export type ProgrammingLanguage = z.infer<typeof languageSchema>;
export const citationSchema = z.strictObject({sourceId:identifier,sourceRevision:identifier,chapterId:identifier,
 paragraphIndex:z.number().int().min(0),quote:z.string().min(1).max(2000)});
export const proposalSchema=z.strictObject({points:z.array(z.strictObject({id:identifier,title:z.string().min(1).max(300),
 prerequisiteIds:z.array(identifier).max(200),relatedIds:z.array(identifier).max(200),citations:z.array(citationSchema).max(8)})).max(200),
 targetIds:z.array(identifier).max(200),declaredIds:z.array(identifier).max(200)});
export type CurriculumProposal=z.infer<typeof proposalSchema>;
export const choicesSchema=z.strictObject({targetIds:z.array(identifier).max(200),excludedIds:z.array(identifier).max(200).default([]),
 declaredIds:z.array(identifier).max(200).default([]),order:z.array(identifier).nullable().default(null),
 prerequisiteEdits:z.array(z.strictObject({pointId:identifier,prerequisiteIds:z.array(identifier),reason:z.string().min(1).max(1000)})).default([]),
 supplementalSourceIds:z.array(identifier).default([])});
export type DesignChoices=z.infer<typeof choicesSchema>;
const inputSchema=z.strictObject({title:z.string().max(300).default(''),textbookId:identifier.nullable().default(null),
 sources:z.array(z.strictObject({sourceId:identifier,sourceRevision:identifier,chapterIds:z.array(identifier)})).max(4).default([]),
 goal:z.string().max(2000).default(''),teachingPrompt:z.string().max(8000).default(''),priorKnowledgeText:z.string().max(4000).default(''),
 includedTopics:z.array(identifier).default([]),excludedTopics:z.array(identifier).default([]),allowSupplementalSources:z.boolean().default(true),
 assessment:z.unknown().default({}),mode:z.enum(['theory','practice','drill']).default('practice'),
 subjectType:z.enum(['computer','math','physics','biology','language','general']).default('general'),
 programmingLanguage:languageSchema.nullable().default(null),templateId:identifier.nullable().default(null),
 templateSnapshot:z.strictObject({templateId:identifier,revision:z.number().int(),content:z.string()}).nullable().default(null)});
export type DraftInput=Omit<z.infer<typeof inputSchema>,'assessment'> & {assessment:AssessmentSettings};
export function parse<T>(schema:z.ZodType<T>,input:unknown):T {const parsed=schema.safeParse(input);if(!parsed.success)throw new LearningError('INVALID_INPUT','输入格式不合法');return parsed.data;}
export function parseDraft(input:unknown):DraftInput {const result=parse(inputSchema,input);return {...result,assessment:parseAssessment(result.assessment)};}
export const questionSchema=z.strictObject({type:z.enum(['choice','fill','code']),stem:z.string().min(1).max(8000),
 options:z.array(z.string().max(1000)).min(2).max(6).optional(),answer:z.string().max(8000),explanation:z.string().max(8000),
 acceptedAnswers:z.array(z.string().min(1).max(1000)).max(10).optional(),targetIds:z.array(identifier).min(1),dependencyIds:z.array(identifier),
 citations:z.array(citationSchema).min(1).max(8),language:languageSchema.optional(),referenceCode:z.string().max(65536).optional(),
 tests:z.array(z.strictObject({caseId:identifier,stdin:z.string().max(32768),expectedStdout:z.string().max(32768),visibility:z.enum(['sample','hidden'])})).max(20).optional()});
export type QuestionCandidate=z.infer<typeof questionSchema>;
export const verdictSchema=z.strictObject({ok:z.boolean(),usedKnowledgeIds:z.array(identifier),answerConsistent:z.boolean(),reason:z.string().max(2000)});
export type ReviewVerdict=z.infer<typeof verdictSchema>;
export interface ContentContext {goal:string;teachingPrompt:string;language:ProgrammingLanguage|null;knowledgePointIds:string[];allowedIds:string[];sources:SourceSnapshot[];count?:number;difficulty?:string;diagnostic?:boolean;knowledgePointTitles?:string[];allowSupplementalSources?:boolean}
export interface LearningModel {
 propose(input:DraftInput,sources:SourceSnapshot[],validate?:(proposal:CurriculumProposal,sources:SourceSnapshot[])=>void):Promise<CurriculumProposal>;
 lesson(context:ContentContext,validate?:(content:{markdown:string;citations:CitationInput[]})=>void):Promise<{markdown:string;citations:CitationInput[]}>;
 questions(context:ContentContext,validate?:(question:QuestionCandidate)=>Promise<void>):Promise<QuestionCandidate[]>;
 review(question:QuestionCandidate,context:ContentContext):Promise<ReviewVerdict>;
}
export interface DraftView {draftId:string;revision:number;input:DraftInput;state:string;generationJobId:string|null;generatedFromRevision:number|null;versionId:string|null;review:unknown;confirmed:unknown;updatedAt?:string}
export type { CitationInput,SourceRef,SourceSnapshot,LearningMode };
