import {describe,expect,it} from 'vitest';
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createAgentLearningModel} from '@/lib/verified-learning/agent/learning-agent';
import {AgentJournal} from '@/lib/verified-learning/agent/journal';
import {migrateVerifiedLearning} from '@/lib/verified-learning/migrations';
import {JobStore} from '@/lib/verified-learning/jobs';
import {openTestDb} from './db-fixtures';
import type {ContentContext} from '@/lib/verified-learning/backend-contracts';

it('持久课件续作：已保存小节不重生成，孤立工具调用补未知反馈，取消不发布',async()=>{
 const db=openTestDb();await migrateVerifiedLearning(db);const job=new JobStore(db).create('s','lesson','j',{});const journal=new AgentJournal(db,'s',job.jobId,'lesson');
 const citation={sourceId:'b',sourceRevision:'r',chapterId:'c',paragraphIndex:0,quote:'变量保存数据'};
 const markdown='变量保存数据，名称指向值。'.repeat(10);
 journal.saveArtifacts({plan:[{sectionId:'a',title:'变量',knowledgePointIds:['p'],purpose:'概念例子总结'}],sections:{a:{sectionId:'a',markdown,citations:[citation]}}});
 journal.saveMessages([{role:'user',content:'生成',timestamp:1},fauxAssistantMessage(fauxToolCall('submit_lesson_section',{sectionId:'a',markdown,citations:[citation]},{id:'interrupted'}))]);
 const ctx:ContentContext={goal:'学习',teachingPrompt:'',language:null,knowledgePointIds:['p'],allowedIds:['p'],allowSupplementalSources:false,sources:[{sourceId:'b',sourceRevision:'r',title:'教材',format:'txt',chapters:[{chapterId:'c',title:'变量',paragraphs:[{paragraphIndex:0,text:'变量保存数据',contentHash:'h'}]}]}]};
 const faux=createFauxCore({tokensPerSecond:Infinity});faux.setResponses([context=>{expect(context.messages.some(m=>m.role==='toolResult'&&m.toolCallId==='interrupted'&&m.isError)).toBe(true);return fauxAssistantMessage(fauxToolCall('get_generation_state',{}));},fauxAssistantMessage(fauxToolCall('finish_generation',{coverage:[{knowledgePointId:'p',conceptSectionId:'a',exampleSectionId:'a',summarySectionId:'a'}]}))]);
 const model=createAgentLearningModel({connection:{model:faux.getModel(),streamFn:faux.streamSimple},journal:()=>journal});
 const result=await model.lesson(ctx);expect(result.markdown).toContain(markdown);expect(faux.state.callCount).toBe(2);
 const again=await model.lesson(ctx);expect(again).toEqual(result);expect(faux.state.callCount).toBe(2);
});
