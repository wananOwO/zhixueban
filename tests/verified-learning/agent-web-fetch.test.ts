import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
const mocks=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}));
vi.mock('node:https',()=>({default:{request:mocks.request}}));
import {fetchPublicText} from '@/lib/verified-learning/agent/web';
afterEach(()=>vi.clearAllMocks());
describe('公开页面DNS固定',()=>{
 it('双栈all:true返回已校验地址数组，禁止再次不受控解析',async()=>{
  mocks.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
  mocks.request.mockImplementation((_url,options,onResponse)=>{
   options.lookup('docs.example',{all:true},(error:unknown,addresses:unknown)=>{expect(error).toBeNull();expect(addresses).toEqual([{address:'8.8.8.8',family:4}]);});
   const request=new EventEmitter() as EventEmitter&{end:()=>void;setTimeout:()=>void};request.setTimeout=()=>{};request.end=()=>{const response=Readable.from([Buffer.from('公开资料正文')]) as Readable&{statusCode:number;headers:Record<string,string>};response.statusCode=200;response.headers={'content-type':'text/plain'};onResponse(response);};return request;
  });
  expect((await fetchPublicText('https://docs.example/page')).text).toBe('公开资料正文');
 });
});
