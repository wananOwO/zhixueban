import {afterEach,describe,expect,it,vi} from 'vitest';
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createLearningModel} from '@/lib/verified-learning/model';
import {LibraryService} from '@/lib/verified-learning/library';
import {CourseService} from '@/lib/verified-learning/courses';
import {JobStore} from '@/lib/verified-learning/jobs';
import {migrateVerifiedLearning} from '@/lib/verified-learning/migrations';
import {openTestDb,testDirectory} from './db-fixtures';
import {generationError} from '@/lib/verified-learning/provider-error';
vi.mock('@/lib/llm/config',()=>({getConfig:(k:string)=>k==='llm_api_key'?'private-test-key':undefined}));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()});
async function setup(){
 const db=openTestDb();await migrateVerifiedLearning(db);const library=new LibraryService(db,testDirectory());const content='大教材正文。'.repeat(80000);const book=await library.importFile('s','u',new File(['# 全书\n\n'+content],'large.md'));const source=library.source('s',book.bookId);const faux=createFauxCore({tokensPerSecond:Infinity});const model=createLearningModel(undefined,{connection:{model:faux.getModel(),streamFn:faux.streamSimple}});const courses=new CourseService(db,library,model);const draft=courses.create('s','d',{goal:'学习',textbookId:book.bookId,allowSupplementalSources:false,sources:[{sourceId:book.bookId,sourceRevision:source.sourceRevision,chapterIds:source.chapters.map(c=>c.chapterId)}]});return{db,library,content,source,faux,courses,draft};
}
describe('大教材Agent与错误',()=>{
 it('大教材不设字数门槛，Agent可完整分页读取，HTTP错误不变成通用文案',async()=>{
  const {db,content,source,faux,courses,draft}=await setup();
  faux.setResponses([fauxAssistantMessage(fauxToolCall('read_source',{sourceId:source.sourceId,chapterId:source.chapters[0].chapterId,offset:0,limit:1})),ctx=>{expect(JSON.stringify(ctx.messages)).toContain(content);return fauxAssistantMessage([],{stopReason:'error',errorMessage:'HTTP 400 context_length_exceeded'})}]);
  const job=courses.generate('s',draft.draftId,0,'g');await expect(courses.runGeneration('s',job.jobId)).rejects.toThrow('context_length_exceeded');expect(new JobStore(db).get('s',job.jobId).error?.message).toContain('HTTP 400');expect(courses.get('s',draft.draftId).input).toEqual(draft.input);
 });
 it('超过60秒不自动中止，超过90秒仍续租，结束清理定时器',async()=>{
  const {db,faux,courses,draft}=await setup();vi.useFakeTimers();let release!:()=>void;
  faux.setResponses([async()=>{await new Promise<void>(r=>{release=r});return fauxAssistantMessage([],{stopReason:'error',errorMessage:'HTTP 400 terminal-error'})}]);
  const job=courses.generate('s',draft.draftId,0,'g');const running=courses.runGeneration('s',job.jobId);const rejected=running.catch(e=>e);
  await vi.advanceTimersByTimeAsync(180000);expect(new JobStore(db).get('s',job.jobId)).toMatchObject({status:'running',resumable:false});release();await vi.runAllTimersAsync();expect(String(await rejected)).toContain('terminal-error');expect(vi.getTimerCount()).toBe(0);
 });
 it.each(['TimeoutError','AbortError','AI_NoObjectGeneratedError'])('非HTTP错误保留具体原因：%s',name=>{expect(generationError(Object.assign(new Error('具体原因'),{name})).message).toContain('具体原因')});
 it('任务错误遮蔽密钥',()=>{expect(generationError(new Error('HTTP 401 private-test-key Bearer another-secret')).message).not.toMatch(/private-test-key|another-secret/)});
});
