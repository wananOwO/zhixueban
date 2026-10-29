import {describe,expect,it} from 'vitest';
import {openTestDb} from './db-fixtures';
import {migrateVerifiedLearning} from '@/lib/verified-learning/migrations';
import {JobStore} from '@/lib/verified-learning/jobs';
import {AgentJournal} from '@/lib/verified-learning/agent/journal';

describe('学习Agent持久记录',()=>{
 it('分阶段保存会话、产物和调用次数，重开不丢失也不混scope',async()=>{
  const db=openTestDb();await migrateVerifiedLearning(db);const jobs=new JobStore(db);const job=jobs.create('a','lesson','j',{});
  const journal=new AgentJournal(db,'a',job.jobId,'lesson');
  journal.saveArtifacts({sections:{a:{markdown:'已生成'}}});
  journal.saveMessages([{role:'user',content:'生成课件',timestamp:1}]);journal.requestStarted({model:'test',provider:'test'});
  const restored=new AgentJournal(db,'a',job.jobId,'lesson');
  expect(restored.load()).toMatchObject({artifacts:{sections:{a:{markdown:'已生成'}}},requests:1,inFlight:true});
  expect(restored.load().messages).toHaveLength(1);
  restored.saveMessages([{role:'user',content:'生成课件',timestamp:1}]);expect(restored.load().messages).toHaveLength(1);
  expect(()=>new AgentJournal(db,'b',job.jobId,'lesson')).toThrow();
 });
});
