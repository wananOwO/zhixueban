import {describe,expect,it} from 'vitest';
import {migrateVerifiedLearning} from '@/lib/verified-learning/migrations';
import {LibraryService} from '@/lib/verified-learning/library';
import {VerifiedLearningStore} from '@/lib/verified-learning/store';
import {StudyService} from '@/lib/verified-learning/study';
import type {LearningModel,QuestionCandidate} from '@/lib/verified-learning/backend-contracts';
import {openTestDb,testDirectory} from './db-fixtures';

describe('Agent题目验收',()=>{
 it('提交工具通过的同一道题不重复模型审校',async()=>{
  const db=openTestDb();await migrateVerifiedLearning(db);const library=new LibraryService(db,testDirectory());const book=await library.importFile('s','u',new File(['# 变量\n变量保存数据。'],'b.md'));const source=library.source('s',book.bookId);const c=source.chapters[0],p=c.paragraphs[0];
  const store=new VerifiedLearningStore(db);let version=store.createVersion('s',{textbookId:book.bookId,goal:'变量',sourceRevisions:[{sourceId:book.bookId,sourceRevision:source.sourceRevision}],assessment:{pointQuestionCount:1,chapterQuestionCount:1,finalQuestionCount:1},outline:[{moduleId:'m',title:'变量',points:[{knowledgePointId:'p',title:'变量',prerequisiteIds:[],sourceIds:[book.bookId],role:'target',coverage:'covered',reason:'目标'}]}]});version=store.activateVersion('s',version.courseVersionId);const session=store.createSession('s',version.courseVersionId,'practice');
  let reviews=0;
  const question:QuestionCandidate={type:'choice',stem:'变量的作用？',options:['保存数据','停止运行'],answer:'保存数据',explanation:'保存数据',targetIds:['p'],dependencyIds:['p'],citations:[{sourceId:book.bookId,sourceRevision:source.sourceRevision,chapterId:c.chapterId,paragraphIndex:p.paragraphIndex,quote:p.text}]};
  const model:LearningModel={propose:async()=>({points:[],targetIds:[],declaredIds:[]}),lesson:async()=>({markdown:'变量保存数据',citations:question.citations}),questions:async(_ctx,validate)=>{await validate?.(question);return [question];},review:async()=>{reviews++;return {ok:true,answerConsistent:true,usedKnowledgeIds:['p'],reason:'通过'};}};
  const study=new StudyService(db,library,model);const first=study.start('s',session.sessionId,0,'first');await study.runContent('s',first.job!.jobId);study.completeLesson('s',session.sessionId,first.run.runId,1,'read');const quiz=study.start('s',session.sessionId,2,'quiz');await study.runContent('s',quiz.job!.jobId);
  expect(reviews).toBe(1);expect(study.runView('s',quiz.run.runId).status).toBe('ready');
 });
});
