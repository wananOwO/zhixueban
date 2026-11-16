import {randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const callbacks:(()=>Promise<void>)[]=[];
vi.mock('next/server',()=>({after:(fn:()=>Promise<void>)=>callbacks.push(fn)}));
import {GET,POST,PATCH} from '@/app/api/verified-learning/v1/[[...path]]/route';
import {initializeVerifiedLearning} from '@/lib/verified-learning/initialization';
import {testDirectory} from './db-fixtures';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();callbacks.length=0;});
function request(method:string,segments:string[],body?:unknown,cookie?:string,key='request-1'){const headers:Record<string,string>={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101','idempotency-key':key};if(cookie)headers.cookie=cookie;if(body!==undefined&&!(body instanceof FormData))headers['content-type']='application/json';return new Request('http://127.0.0.1:3101/api/verified-learning/v1/'+segments.join('/'),{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}
const context=(segments:string[])=>({params:Promise.resolve({path:segments})});
async function setup(){const root=testDirectory();mkdirSync(path.join(root,'data'));vi.spyOn(process,'cwd').mockReturnValue(root);vi.stubEnv('DB_PATH',path.join(root,'data/app.db'));vi.stubEnv('VL_LOCAL_AUTH','1');const secret=randomBytes(32).toString('base64url');vi.stubEnv('VL_LOCAL_PASSWORD',secret);await initializeVerifiedLearning('data/app.db',true,root);const res=await POST(request('POST',['access'],{token:secret}),context(['access']));return {cookie:res.headers.get('set-cookie')!,login:res};}
describe('实际增强API路由',()=>{
 it('默认免登录可无cookie读取，仍拒绝跨站写入，模式只公开认证开关',async()=>{
  await setup();vi.stubEnv('VL_LOCAL_AUTH','0');
  const access=await GET(request('GET',['access']),context(['access']));expect(access.status).toBe(200);
  expect((await GET(request('GET',['textbooks']),context(['textbooks']))).status).toBe(200);
  const mode=await GET(request('GET',['mode']),context(['mode']));expect((await mode.json()).data).toEqual({mode:'local',authRequired:false,uploadLimitBytes:50*1024*1024,booksPerSpace:null});
  const req=request('POST',['drafts'],{});req.headers.set('origin','http://evil.example');
  expect((await POST(req,context(['drafts']))).status).toBe(403);
  vi.stubEnv('VL_LOCAL_AUTH','1');vi.stubEnv('VL_LOCAL_PASSWORD','fixed-password');
  const protectedMode=await GET(request('GET',['mode']),context(['mode']));const modeText=await protectedMode.text();expect(JSON.parse(modeText).data.authRequired).toBe(true);expect(modeText).not.toContain('fixed-password');
  expect((await GET(request('GET',['access']),context(['access']))).status).toBe(401);
 });
 it('登录只通过cookie返回身份，匿名教材请求401',async()=>{const {login,cookie}=await setup();expect(login.status).toBe(200);expect(await login.json()).toMatchObject({contractVersion:1,data:{expiresAt:expect.any(String)}});expect((await GET(request('GET',['textbooks']),context(['textbooks']))).status).toBe(401);expect((await GET(request('GET',['textbooks'],undefined,cookie),context(['textbooks']))).status).toBe(200);expect((await GET(request('GET',['access']),context(['access']))).status).toBe(401);});
 it('真实教材上传、草稿保存、模板和未确认课程列表',async()=>{const {cookie}=await setup();const form=new FormData();form.set('file',new File(['# 基础\n变量保存数据。'],'lesson.md'));const uploaded=await POST(request('POST',['textbooks'],form,cookie),context(['textbooks']));expect(uploaded.status).toBe(201);const book=(await uploaded.json()).data;const draftRes=await POST(request('POST',['drafts'],{textbookId:book.bookId,goal:'学习'},cookie),context(['drafts']));expect(draftRes.status).toBe(201);const draft=(await draftRes.json()).data;const saved=await PATCH(request('PATCH',['drafts',draft.draftId],{expectedRevision:0,input:{goal:'学习C语言',programmingLanguage:'c'}},cookie,'save'),context(['drafts',draft.draftId]));expect(saved.status).toBe(200);expect((await saved.json()).data.input.programmingLanguage).toBe('c');expect((await (await GET(request('GET',['courses'],undefined,cookie),context(['courses']))).json()).data).toEqual([]);expect(callbacks).toHaveLength(0);const templates=await GET(request('GET',['templates'],undefined,cookie),context(['templates']));expect((await templates.json()).data.builtins).toHaveLength(6);});
});
