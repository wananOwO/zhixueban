import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { SourceSnapshot } from '../sources';

export function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} };
}

/** 引用必须来自工具返回的真实段落编号，不把数组下标当段落编号。 */
export function createSourceTools(sources: SourceSnapshot[]): AgentTool<any>[] {
  return [
    {name:'list_sources',label:'查看资料目录',description:'列出可访问资料及章节，正文通过read_source读取。',parameters:Type.Object({}),execute:async()=>toolResult(sources.map(s=>({sourceId:s.sourceId,sourceRevision:s.sourceRevision,title:s.title,chapters:s.chapters.map(c=>({chapterId:c.chapterId,title:c.title,paragraphCount:c.paragraphs.length}))})))},
    {name:'search_sources',label:'搜索资料',description:'在全部已授权教材和补充资料正文中搜索关键词；返回可引用原文。',parameters:Type.Object({query:Type.String({minLength:1,maxLength:200})}),execute:async(_,input)=>{
      const args=input as {query:string};
      const query=String(args.query).toLowerCase();const terms=query.split(/\s+/).filter(Boolean);
      const hits=sources.flatMap(s=>s.chapters.flatMap(c=>c.paragraphs.filter(p=>terms.some(t=>p.text.toLowerCase().includes(t))).map(p=>({sourceId:s.sourceId,sourceRevision:s.sourceRevision,chapterId:c.chapterId,paragraphIndex:p.paragraphIndex,text:p.text}))));
      return toolResult({total:hits.length,matches:hits.slice(0,20)});
    }},
    {name:'read_source',label:'读取原文',description:'按章节分页读取真实原文。offset是章节内偏移，引用使用返回的paragraphIndex。',parameters:Type.Object({sourceId:Type.String(),chapterId:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:20}))}),execute:async(_,input)=>{
      const args=input as {sourceId:string;chapterId:string;offset?:number;limit?:number};
      const source=sources.find(s=>s.sourceId===args.sourceId);const chapter=source?.chapters.find(c=>c.chapterId===args.chapterId);if(!source||!chapter)throw new Error('资料或章节不存在，请先调用list_sources');
      const offset=Number(args.offset??0),limit=Number(args.limit??10);return toolResult({sourceId:source.sourceId,sourceRevision:source.sourceRevision,chapterId:chapter.chapterId,paragraphs:chapter.paragraphs.slice(offset,offset+limit),nextOffset:offset+limit<chapter.paragraphs.length?offset+limit:null});
    }},
  ];
}
