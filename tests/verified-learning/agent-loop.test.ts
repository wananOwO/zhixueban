import { describe, expect, it } from 'vitest';
import { Type } from '@earendil-works/pi-ai';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { runLearningAgent } from '@/lib/verified-learning/agent/runtime';

describe('Pi学习Agent闭环', () => {
  it('普通回复不完成，错误参数和工具错误回传后自主修正，成功提交才停止', async () => {
    const faux = createFauxCore({ tokensPerSecond: Infinity });
    let accepted = false;
    faux.setResponses([
      fauxAssistantMessage('已经完成'),
      fauxAssistantMessage(fauxToolCall('submit', { value: 7 })),
      fauxAssistantMessage(fauxToolCall('submit', { value: '错误引用' })),
      (context) => {
        expect(context.messages.some(m => m.role === 'toolResult' && m.isError)).toBe(true);
        return fauxAssistantMessage(fauxToolCall('submit', { value: '正确引用' }));
      },
    ]);
    await runLearningAgent({
      model: faux.getModel(), streamFn: faux.streamSimple, prompt: '读取资料后提交结果', isComplete: () => accepted,
      tools: [{ name: 'submit', label: '提交', description: '提交', parameters: Type.Object({ value: Type.String() }), execute: async (_, input) => {
        if ((input as { value: string }).value !== '正确引用') throw new Error('引用不匹配，请重新读取资料');
        accepted = true; return { content: [{ type: 'text', text: '验收通过' }], details: {}, terminate: true };
      } }],
    });
    expect(accepted).toBe(true);
    expect(faux.state.callCount).toBe(4);
  });
  it('输出截断不执行写工具，Agent下一轮重新提交', async () => {
    const faux = createFauxCore({ tokensPerSecond: Infinity });let writes=0;
    faux.setResponses([fauxAssistantMessage(fauxToolCall('submit',{}),{stopReason:'length'}),fauxAssistantMessage(fauxToolCall('submit',{}))]);
    await runLearningAgent({model:faux.getModel(),streamFn:faux.streamSimple,prompt:'生成',isComplete:()=>writes===1,tools:[{name:'submit',label:'提交',description:'提交',parameters:Type.Object({}),execute:async()=>{writes++;return {content:[],details:{},terminate:true}}}]});
    expect(writes).toBe(1);expect(faux.state.callCount).toBe(2);
  });
  it('短暂服务错误退避后继续，不把永久鉴权错误当成功', async () => {
    const faux=createFauxCore({tokensPerSecond:Infinity});let accepted=false;
    faux.setResponses([fauxAssistantMessage([],{stopReason:'error',errorMessage:'HTTP 503 unavailable'}),fauxAssistantMessage(fauxToolCall('submit',{}))]);
    await runLearningAgent({model:faux.getModel(),streamFn:faux.streamSimple,prompt:'生成',isComplete:()=>accepted,retryDelayMs:1,maxRequests:3,tools:[{name:'submit',label:'提交',description:'提交',parameters:Type.Object({}),execute:async()=>{accepted=true;return {content:[],details:{},terminate:true}}}]});
    expect(faux.state.callCount).toBe(2);
    const permanent=createFauxCore({tokensPerSecond:Infinity});permanent.setResponses([fauxAssistantMessage([],{stopReason:'error',errorMessage:'HTTP 401 invalid key'})]);
    await expect(runLearningAgent({model:permanent.getModel(),streamFn:permanent.streamSimple,prompt:'生成',isComplete:()=>false,tools:[],retryDelayMs:1,maxRequests:3})).rejects.toThrow('401');
    expect(permanent.state.callCount).toBe(1);
  });
  it('真实验收调用授权预算耗尽不能假报成功', async () => {
    const faux=createFauxCore({tokensPerSecond:Infinity});faux.setResponses([fauxAssistantMessage('完成')]);
    await expect(runLearningAgent({model:faux.getModel(),streamFn:faux.streamSimple,prompt:'生成',tools:[],isComplete:()=>false,maxRequests:1})).rejects.toThrow(/调用授权/);
    expect(faux.state.callCount).toBe(1);
  });
});
