import {describe,expect,it} from 'vitest';
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {Type} from '@earendil-works/pi-ai';
import {runLearningAgent} from '@/lib/verified-learning/agent/runtime';
import {AgentJournal} from '@/lib/verified-learning/agent/journal';
import {JobStore} from '@/lib/verified-learning/jobs';
import {migrateVerifiedLearning} from '@/lib/verified-learning/migrations';
import {openTestDb} from './db-fixtures';

describe('Agent取消与租约隔离',()=>{
 it('用户取消后不执行写工具或后续调用',async()=>{
  const faux=createFauxCore({tokensPerSecond:Infinity});const controller=new AbortController();let writes=0;
  faux.setResponses([()=>{controller.abort(new Error('用户取消'));return fauxAssistantMessage(fauxToolCall('submit',{}));}]);
  await expect(runLearningAgent({model:faux.getModel(),streamFn:faux.streamSimple,prompt:'生成',signal:controller.signal,isComplete:()=>writes>0,tools:[{name:'submit',label:'提交',description:'提交',parameters:Type.Object({}),execute:async()=>{writes++;return {content:[],details:{},terminate:true}}}]})).rejects.toThrow('用户取消');
  expect(writes).toBe(0);expect(faux.state.callCount).toBe(1);
 });
 it('恢复领取新租约后旧worker不得覆盖会话和产物',async()=>{
  const db=openTestDb();await migrateVerifiedLearning(db);let now=new Date();const jobs=new JobStore(db,()=>now);
  const job=jobs.create('s','lesson','j',{});jobs.claim('s',job.jobId);const old=new AgentJournal(db,'s',job.jobId,'lesson');
  old.saveArtifacts({section:'first'});now=new Date(now.getTime()+100000);jobs.resume('s',job.jobId);jobs.claim('s',job.jobId);
  const fresh=new AgentJournal(db,'s',job.jobId,'lesson');fresh.saveArtifacts({section:'new'});
  expect(old.cancelled()).toBe(true);expect(()=>old.saveArtifacts({section:'late'})).toThrow();
  expect(fresh.load().artifacts).toEqual({section:'new'});
 });
});
