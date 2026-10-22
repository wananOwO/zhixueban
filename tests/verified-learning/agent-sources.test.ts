import {describe,expect,it,vi} from 'vitest';
import {createSourceTools} from '@/lib/verified-learning/agent/source-tools';
import {assertPublicUrl} from '@/lib/verified-learning/agent/web';
import type {SourceSnapshot} from '@/lib/verified-learning/sources';
const source:SourceSnapshot={sourceId:'b',sourceRevision:'r',title:'教材',format:'md',chapters:[{chapterId:'c',title:'第一章',paragraphs:[{paragraphIndex:9,text:'变量保存数据',contentHash:'h'},{paragraphIndex:10,text:'循环重复操作',contentHash:'h2'}]}]};
describe('Agent教材工具',()=>{
 it('返回真实引用与分页，不存在来源作为工具错误',async()=>{
  const tools=createSourceTools([source]);const read=tools.find(t=>t.name==='read_source')!;
  const result=await read.execute('x',{sourceId:'b',chapterId:'c',offset:0,limit:1});
  expect(JSON.stringify(result)).toContain('变量保存数据');expect(JSON.stringify(result)).toContain('nextOffset');
  await expect(read.execute('y',{sourceId:'unknown',chapterId:'c',offset:0,limit:1})).rejects.toThrow();
  const search=await tools.find(t=>t.name==='search_sources')!.execute('s',{query:'循环'});expect(JSON.stringify(search)).toContain('10');
 });
 it.each(['http://127.0.0.1/x','http://localhost/x','http://169.254.169.254/','http://[::1]/','file:///etc/passwd','https://user:secret@example.com/'])('只允许公开资料：%s',async url=>{await expect(assertPublicUrl(url)).rejects.toThrow();});
});
