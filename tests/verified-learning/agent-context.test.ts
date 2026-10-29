import {describe,expect,it} from 'vitest';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai/providers/faux';
import {compactAgentContext} from '@/lib/verified-learning/agent/context';
import type {AgentMessage} from '@earendil-works/pi-agent-core';

describe('Agent请求上下文',()=>{
 it('保留任务和工具声明，旧轮次可回查，最近工具调用结果保持成对',()=>{
  const messages:AgentMessage[]=[{role:'system',content:'工具定义',timestamp:1},{role:'user',content:'完整任务',timestamp:2}];
  for(let n=0;n<30;n++){messages.push(fauxAssistantMessage(fauxToolCall('read_source',{offset:n},{id:'t'+n})),{role:'toolResult',toolName:'read_source',toolCallId:'t'+n,content:[{type:'text',text:'原文'.repeat(1000)}],isError:false,timestamp:n+3});}
  const result=compactAgentContext(messages);expect(result.length).toBeLessThan(messages.length);expect(result.some(m=>m.role==='user'&&m.content==='完整任务')).toBe(true);expect(result.some(m=>m.role==='system'&&m.content==='工具定义')).toBe(true);expect(JSON.stringify(result)).toContain('get_generation_state');
  const ids=new Set(result.flatMap(m=>m.role==='assistant'?m.content.filter(c=>c.type==='toolCall').map(c=>c.id):[]));
  for(const m of result)if(m.role==='toolResult')expect(ids.has(m.toolCallId)).toBe(true);
  expect(messages).toHaveLength(62);
 });
});
