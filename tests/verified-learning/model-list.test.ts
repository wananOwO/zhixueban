import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels } from '@/lib/verified-learning/model-list';
afterEach(()=>vi.unstubAllGlobals());
const saved={llm_provider:'openai-compatible',llm_base_url:'https://example.test/v1',llm_api_key:'private-key'};
describe('供应商模型列表',()=>{
 it('OpenAI兼容协议，临时表单优先，去重且不回传密钥',async()=>{
  const fetcher=vi.fn(async()=>Response.json({data:[{id:'m1'},{id:'m1'},{id:'m2'}]}));vi.stubGlobal('fetch',fetcher);
  const result=await listModels({},saved);expect(result.models.map(m=>m.id)).toEqual(['m1','m2']);expect(JSON.stringify(result)).not.toContain('private-key');
  const [url,init]=fetcher.mock.calls[0] as unknown as [URL,RequestInit];expect(String(url)).toBe('https://example.test/v1/models');expect(init.headers).toMatchObject({Authorization:'Bearer private-key'});expect(init.redirect).toBe('error');
 });
 it('新地址不复用已存密钥',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(listModels({baseUrl:'https://else.test/v1'},saved)).rejects.toThrow(/密钥/);expect(fetcher).not.toHaveBeenCalled();
 });
 it('Anthropic请求头和分页',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({data:[{id:'c1',display_name:'Claude 1'}],has_more:true,last_id:'c1'})).mockResolvedValueOnce(Response.json({data:[{id:'c2'}],has_more:false}));vi.stubGlobal('fetch',fetcher);
  const result=await listModels({provider:'anthropic',baseUrl:'https://api.anthropic.com/v1',apiKey:'temporary-key'},saved);
  expect(result.models).toHaveLength(2);expect(fetcher.mock.calls[0][1].headers).toMatchObject({'x-api-key':'temporary-key','anthropic-version':'2023-06-01'});expect(String(fetcher.mock.calls[1][0])).toContain('after_id=c1');
 });
 it.each([401,404,500])('上游%d不泄露响应正文',async status=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('private-key',{status})));await expect(listModels({},saved)).rejects.toThrow(/模型|鉴权/);try{await listModels({},saved)}catch(e){expect(String(e)).not.toContain('private-key')}
 });
 it('拒绝非JSON及危险地址',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>')));await expect(listModels({},saved)).rejects.toThrow();await expect(listModels({baseUrl:'file:///etc/passwd',apiKey:'key'},saved)).rejects.toThrow();
 });
});
