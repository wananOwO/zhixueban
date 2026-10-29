import {describe,expect,it} from 'vitest';
import {createFauxCore,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {createAgentLearningModel} from '@/lib/verified-learning/agent/learning-agent';
import type { JsonObject } from '@earendil-works/pi-ai';
import type {ContentContext} from '@/lib/verified-learning/backend-contracts';
const citation={sourceId:'book',sourceRevision:'r1',chapterId:'c1',paragraphIndex:42,quote:'变量保存数据'};
const context:ContentContext={goal:'学习变量',teachingPrompt:'举例',language:null,knowledgePointIds:['p'],allowedIds:['p'],allowSupplementalSources:false,sources:[{sourceId:'book',sourceRevision:'r1',title:'教材',format:'txt',chapters:[{chapterId:'c1',title:'变量',paragraphs:[{paragraphIndex:42,text:'变量保存数据',contentHash:'hash'}]}]}]};
const call=(name:string,args:JsonObject)=>fauxAssistantMessage(fauxToolCall(name,args));
const markdown='变量用于保存数据，可以给数据一个名称。例子：将学生年龄记录为 age，之后可以读取和更新这个值。这样不需要在每个地方重新写一个数。小结：变量是名称与值之间的关联，赋值会更新其当前保存的数据。';
describe('自主课件Agent',()=>{
 it('读取来源，错误引用被拒绝，自动纠正并最终提交完整课件',async()=>{
  const faux=createFauxCore({tokensPerSecond:Infinity});
  faux.setResponses([
   call('list_sources',{}),call('read_source',{sourceId:'book',chapterId:'c1'}),
   call('plan_lesson',{sections:[{sectionId:'a',title:'变量概念、示例与总结',knowledgePointIds:['p'],purpose:'讲解和示例'}]}),
   call('submit_lesson_section',{sectionId:'a',markdown,citations:[{...citation,quote:'不存在的句子'}]}),
   ctx=>{expect(ctx.messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('QUOTE_MISMATCH'))).toBe(true);return call('submit_lesson_section',{sectionId:'a',markdown,citations:[citation]});},
   call('finish_generation',{coverage:[{knowledgePointId:'p',conceptSectionId:'a',exampleSectionId:'a',summarySectionId:'a'}]}),
  ]);
  let validated=false;
  const model=createAgentLearningModel({connection:{model:faux.getModel(),streamFn:faux.streamSimple},maxRequests:10});
  const result=await model.lesson(structuredClone(context),()=>{validated=true});
  expect(result.markdown).toContain(markdown);expect(result.markdown.startsWith('## 变量概念')).toBe(true);expect(result.citations).toEqual([citation]);expect(validated).toBe(true);expect(faux.state.callCount).toBe(6);
 });
 it('小节正文自带标题时不重复加标题',async()=>{
  const faux=createFauxCore({tokensPerSecond:Infinity});const own='## 自己的标题\n\n'+markdown;
  faux.setResponses([call('plan_lesson',{sections:[{sectionId:'a',title:'计划标题',knowledgePointIds:['p'],purpose:'讲解'}]}),call('submit_lesson_section',{sectionId:'a',markdown:own,citations:[citation]}),call('finish_generation',{coverage:[{knowledgePointId:'p',conceptSectionId:'a',exampleSectionId:'a',summarySectionId:'a'}]})]);
  const result=await createAgentLearningModel({connection:{model:faux.getModel(),streamFn:faux.streamSimple}}).lesson(structuredClone(context));
  expect(result.markdown).toBe(own);
 });
 it('业务验收失败返回Agent继续修正', async()=>{
  const faux=createFauxCore({tokensPerSecond:Infinity});let validation=0;
  faux.setResponses([
   call('plan_lesson',{sections:[{sectionId:'a',title:'变量',knowledgePointIds:['p'],purpose:'讲解'}]}),call('submit_lesson_section',{sectionId:'a',markdown,citations:[citation]}),
   call('finish_generation',{coverage:[{knowledgePointId:'p',conceptSectionId:'a',exampleSectionId:'a',summarySectionId:'a'}]}),
   call('submit_lesson_section',{sectionId:'a',markdown:markdown+'\n\n补充边界：变量需要先赋值才能读取。',citations:[citation]}),
   call('finish_generation',{coverage:[{knowledgePointId:'p',conceptSectionId:'a',exampleSectionId:'a',summarySectionId:'a'}]}),
  ]);
  const model=createAgentLearningModel({connection:{model:faux.getModel(),streamFn:faux.streamSimple}});
  const result=await model.lesson(structuredClone(context),value=>{validation++;if(!value.markdown.includes('边界'))throw new Error('请补充边界解释');});
  expect(result.markdown).toContain('边界');expect(validation).toBe(2);
 });
});
