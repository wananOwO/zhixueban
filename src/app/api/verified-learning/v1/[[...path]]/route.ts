import {after} from 'next/server';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {getLocalServices,openVerifiedDb} from '@/lib/verified-learning/server';
import {login,logout,readLocalConfig,assertLocalRequest,requireLocalAccess} from '@/lib/verified-learning/local-access';
import {ok,fail,readJson} from '@/lib/verified-learning/http';
import {LearningError} from '@/lib/verified-learning/contracts';
import {LibraryService} from '@/lib/verified-learning/library';
import {CourseService} from '@/lib/verified-learning/courses';
import {StudyService} from '@/lib/verified-learning/study';
import {RecordService} from '@/lib/verified-learning/records';
import {createLearningModel} from '@/lib/verified-learning/model';
import {parse} from '@/lib/verified-learning/backend-contracts';
import {Judge0Port} from '@/lib/verified-learning/judge0';
import {readSettings,saveSettings} from '@/lib/verified-learning/settings';
import {listModels,ModelListError} from '@/lib/verified-learning/model-list';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path?:string[]}>};
// Next dev 服务器会把 request.url 的主机名规范化为 localhost，与 Host 头不一致；
// 在边界处按 Host 头还原 URL，保证 local-access 的同源校验语义不变。
function normalizeDevUrl(request:Request):Request{const url=new URL(request.url);const host=request.headers.get('host');if(url.hostname==='localhost'&&host==='127.0.0.1:3101'&&url.port==='3101'){return new Request(`http://127.0.0.1:3101${url.pathname}${url.search}`,request);}return request;}
function services(request:Request){const base=getLocalServices(request),library=new LibraryService(base.db,path.join(process.cwd(),'data','verified-learning','uploads')),model=createLearningModel(),courses=new CourseService(base.db,library,model),study=new StudyService(base.db,library,model);return {...base,library,courses,study,records:new RecordService(base.db,study)};}
function schedule(request:Request,scope:string,jobId:string){after(async()=>{const db=openVerifiedDb();try{const library=new LibraryService(db,path.join(process.cwd(),'data','verified-learning','uploads')),model=createLearningModel({db,scope,jobId,library});const {JobStore}=await import('@/lib/verified-learning/jobs');const job=new JobStore(db).get(scope,jobId);if(job.kind==='curriculum')await new CourseService(db,library,model).runGeneration(scope,jobId);else if(job.kind==='lesson'||job.kind==='question_set')await new StudyService(db,library,model).runContent(scope,jobId);}catch{console.error('增强学习任务失败；详情已保存在任务状态中');}finally{db.close();}});}
function scheduleAttempt(scope:string,attemptId:string){after(async()=>{const db=openVerifiedDb();try{await new StudyService(db,new LibraryService(db,path.join(process.cwd(),'data','verified-learning','uploads')),createLearningModel()).processAttempt(scope,attemptId);}catch{console.error('判题任务未完成，请读取作答状态后恢复');}finally{db.close();}});}
async function handle(rawRequest:Request,context:Context){const requestId=randomUUID();const request=normalizeDevUrl(rawRequest);let opened:ReturnType<typeof services>|undefined;try{const parts=(await context.params).path??[],[resource,id,action,subId]=parts;const method=request.method;const key=()=>{const value=request.headers.get('idempotency-key');if(!value?.trim()||value.length>200)throw new LearningError('INVALID_INPUT','需要Idempotency-Key');return value;};const body=async()=>{const value=await readJson(request);if(!value||typeof value!=='object'||Array.isArray(value))throw new LearningError('INVALID_INPUT','需要JSON对象');return value as Record<string,unknown>;};
 if(resource==='access'){readLocalConfig();assertLocalRequest(request);const db=openVerifiedDb();try{if(method==='POST'){const input=parse(z.strictObject({token:z.string().max(128)}),await readJson(request,4096));const result=login(db,request,input.token);const response=ok({expiresAt:result.expiresAt},requestId);response.headers.set('set-cookie',result.cookie);return response;}if(method==='DELETE'){const response=ok({loggedOut:true},requestId);response.headers.set('set-cookie',logout(db,request));return response;}requireLocalAccess(db,request);return ok({authenticated:true},requestId);}finally{db.close();}}
 opened=services(request);const {scopeId:scope,library,courses,study,records,jobs}=opened;const url=new URL(request.url);
 if(resource==='settings'&&id==='models'&&method==='POST'){const saved:Record<string,string|undefined>={};for(const name of ['llm_provider','llm_base_url','llm_api_key']){const row=opened.db.prepare('SELECT value FROM settings WHERE key=?').get(name) as {value:string}|undefined;saved[name]=row?.value||process.env[name.toUpperCase()];}return ok(await listModels(await body(),saved),requestId);}
 if(resource==='settings'&&!id){if(method==='GET')return ok(readSettings(opened.db),requestId);if(method==='PATCH')return ok(saveSettings(opened.db,await body()),requestId);}
 if(resource==='textbooks'){
  if(!id&&method==='GET')return ok(library.list(scope,url.searchParams.get('q')??'',url.searchParams.get('archived')==='true'),requestId);
  if(!id&&method==='POST'){const form=await request.formData();const file=form.get('file');if(!(file instanceof File))throw new LearningError('INVALID_INPUT','缺少教材文件');return ok(await library.importFile(scope,key(),file),requestId,201);}
  if(id&&action==='chapters'&&subId&&method==='GET')return ok(library.readChapter(scope,id,url.searchParams.get('revision')??library.source(scope,id).sourceRevision,subId,Number(url.searchParams.get('offset')??0)),requestId);
  if(id&&action==='source'&&method==='GET')return ok(library.source(scope,id,url.searchParams.get('revision')??undefined),requestId);
  if(id&&action==='deletion'){if(method==='GET')return ok(library.inspectDeletion(scope,id),requestId);if(method==='DELETE'){const b=parse(z.strictObject({expectedRevision:z.number().int().min(0),confirmName:z.string()}),await body());return ok(await library.deleteBook(scope,id,b.expectedRevision,b.confirmName),requestId);}}
  if(id&&!action&&method==='GET')return ok(library.get(scope,id),requestId);
  if(id&&!action&&method==='PATCH'){const b=parse(z.strictObject({expectedRevision:z.number().int().min(0),archived:z.boolean()}),await body());return ok(library.archive(scope,id,b.expectedRevision,b.archived),requestId);}
 }
 if(resource==='drafts'){
  if(!id&&method==='GET')return ok(courses.list(scope),requestId);if(!id&&method==='POST')return ok(courses.create(scope,key(),await body()),requestId,201);
  if(id&&!action&&method==='GET')return ok(courses.get(scope,id),requestId);
  if(id&&!action&&method==='PATCH'){const b=await body();return ok(courses.save(scope,id,Number(b.expectedRevision),key(),b.input),requestId);}
  if(id&&!action&&method==='DELETE'){const b=await body();return ok(courses.discard(scope,id,Number(b.expectedRevision)),requestId);}
  if(id&&method==='POST'){const b=await body();if(action==='generate'){const job=courses.generate(scope,id,Number(b.expectedRevision),key());schedule(request,scope,job.jobId);return ok(job,requestId,202);}if(action==='choices')return ok(courses.saveChoices(scope,id,Number(b.expectedRevision),key(),b.choices),requestId);if(action==='confirm')return ok(courses.confirm(scope,id,Number(b.expectedRevision),key(),b.acceptSourceAndPrerequisiteReview===true),requestId);if(action==='accept-result')return ok(courses.acceptResult(scope,id,Number(b.expectedRevision),key()),requestId);if(action==='copy'){const draft=courses.get(scope,id);return ok(courses.create(scope,key(),draft.input),requestId,201);}}
 }
 if(resource==='courses'&&method==='GET')return ok(courses.courses(scope),requestId);
 if(resource==='jobs'){if(!id&&method==='GET')return ok(jobs.list(scope),requestId);if(id&&method==='GET')return ok(action==='events'?jobs.events(scope,id,Number(url.searchParams.get('after')??0)):jobs.get(scope,id),requestId);if(id&&method==='POST'&&action==='resume'){if(jobs.get(scope,id).kind==='import')throw new LearningError('VALIDATION_FAILED','导入重试请重新上传原文件');const job=jobs.resume(scope,id);schedule(request,scope,id);return ok(job,requestId,202);}if(id&&method==='POST'&&action==='cancel')return ok(jobs.cancel(scope,id),requestId);}
 if(resource==='sessions'&&id){if(!action&&method==='GET')return ok(study.get(scope,id),requestId);if(action==='history'&&method==='GET')return ok(study.history(scope,id,subId),requestId);if(method==='POST'||method==='PATCH'){const b=await body();if(action==='start'){const result=study.start(scope,id,Number(b.expectedRevision),key());if(result.job)schedule(request,scope,result.job.jobId);return ok(result,requestId,result.job?202:200);}if(action==='lesson-completion')return ok(study.completeLesson(scope,id,String(b.runId),Number(b.expectedRevision),key()),requestId);if(action==='prior-knowledge')return ok(study.declarePrior(scope,id,Number(b.expectedRevision),key(),parse(z.array(z.string().min(1)).max(200),b.knowledgePointIds)),requestId);if(action==='mode')return ok(study.changeMode(scope,id,Number(b.expectedRevision),key(),String(b.mode)),requestId);if(action==='abandon')return ok(study.abandon(scope,id,String(b.runId),Number(b.expectedRevision),key()),requestId);if(action==='cursor')return ok(study.saveCursor(scope,id,Number(b.expectedRevision),b.cursor as Parameters<StudyService['saveCursor']>[3]),requestId);if(action==='remedial'){const result=study.remedial(scope,id,key());schedule(request,scope,result.job.jobId);return ok(result,requestId,202);}}}
 if(resource==='runs'&&id){if(!action&&method==='GET')return ok(study.runView(scope,id),requestId);if(action==='attempts'&&method==='POST'){const b=parse(z.strictObject({questionId:z.string(),answer:z.string().max(65536)}),await body());const result=await study.submit(scope,id,b.questionId,key(),b.answer);if(result.state==='pending')scheduleAttempt(scope,result.attemptId);return ok(result,requestId,result.state==='pending'?202:200);}if(action==='hints'&&method==='POST'){const b=parse(z.strictObject({questionId:z.string(),level:z.number().int().min(1).max(4)}),await body());return ok(study.hint(scope,id,b.questionId,b.level),requestId);}}
 if(resource==='attempts'&&id){if(method==='GET')return ok(study.attemptStatus(scope,id),requestId);if(method==='POST'&&action==='resume'){const b=await body();return ok(await study.resumeAttempt(scope,id,b.allowUnknown===true),requestId);}}
 if(resource==='templates'){if(method==='GET')return ok(records.templates(scope),requestId);if(method==='POST'||method==='PATCH')return ok(records.saveTemplate(scope,key(),await body() as Parameters<RecordService['saveTemplate']>[2]),requestId);}
 if(resource==='notes'){if(id&&action==='export'&&method==='GET')return new Response(records.exportNote(scope,id),{headers:{'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename="note-${encodeURIComponent(id)}.md"`,'cache-control':'no-store'}});if(method==='GET')return ok(records.notes(scope,url.searchParams.get('courseId')??undefined),requestId);if(method==='POST'||method==='PATCH')return ok(records.saveNote(scope,key(),{...await body(),...(id?{noteId:id}:{})} as Parameters<RecordService['saveNote']>[2]),requestId);}
 if(resource==='progress'&&method==='GET')return ok(records.progress(scope,url.searchParams.get('versionId')??''),requestId);
 if(resource==='judge'&&method==='GET')return ok({languages:await new Judge0Port().capabilities()},requestId);
 throw new LearningError('NOT_FOUND','接口不存在');
 }catch(error){if(error instanceof ModelListError)return Response.json({contractVersion:1,requestId,error:{code:error.code,message:error.message,retryable:true}},{status:502,headers:{'cache-control':'no-store'}});return fail(error,requestId);}finally{opened?.db.close();}}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
