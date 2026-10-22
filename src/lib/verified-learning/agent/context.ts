import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** 只缩减下一轮请求上下文；完整会话与成果仍在数据库，可经工具重新读取。 */
export function compactAgentContext(messages: AgentMessage[]): AgentMessage[] {
  const turns=messages.flatMap((m,i)=>m.role==='assistant'?[i]:[]);
  if(turns.length<=12)return messages;
  const start=turns[turns.length-12];
  const firstTask=messages.find(m=>m.role==='user');
  const system=messages.filter(m=>m.role==='system');
  const tail=messages.slice(start).filter(m=>m.role!=='system');
  return [...system,...(firstTask?[firstTask]:[]),{
    role:'user',content:'较早轮次已归档，完整记录仍保存。先调用get_generation_state查看已验收成果和计划；需要旧原文时重新用资料工具读取。不要重复生成已有内容，也不要猜测归档信息。',timestamp:Date.now(),
  },...tail];
}
