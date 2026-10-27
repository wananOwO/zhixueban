import {after} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getServices,openVerifiedDb,assertEnabled,UPLOADS_ROOT} from '@/lib/verified-learning/server';
import {assertRequest,loginWith,logoutWith,requireAccess,uploadsDirectory} from '@/lib/verified-learning/access';
import {isOnline,modeView,ONLINE_LIMITS,LOCAL_UPLOAD_BYTES} from '@/lib/verified-learning/mode';
import {parseModelHeader,rememberJobKey,forgetJobKey,jobKey,type ModelConfig} from '@/lib/verified-learning/model-keys';
import {checkGenerationQuota,countGeneration} from '@/lib/verified-learning/quota';
import {jobStreamResponse} from '@/lib/verified-learning/job-stream';
import {buildTrace} from '@/lib/verified-learning/trace';
import {buildTutorContext,parseTutorRequest,tutorModel,tutorResponse} from '@/lib/verified-learning/tutor';
import type {UIMessage} from 'ai';
import {AppError} from '@/lib/verified-learning/errors';
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
/** 线上模式上传文件按空间分目录；上传限制按模式 */
function library(db:ConstructorParameters<typeof LibraryService>[0],scope:string){return new LibraryService(db,uploadsDirectory(UPLOADS_ROOT(),scope),isOnline()?{maxBytes:ONLINE_LIMITS.uploadBytes,maxBooks:ONLINE_LIMITS.booksPerSpace}:{maxBytes:LOCAL_UPLOAD_BYTES,maxBooks:null});}
/**
 * 线上模式：需要模型的请求从 X-VL-Model 读取浏览器保存的配置，只放进程内存（规格 8.4）。
 * 本地模式返回 undefined，由 Agent 连接读取设置。
 */
function requestModel(request:Request):ModelConfig|undefined{if(!isOnline())return undefined;const config=parseModelHeader(request.headers.get('x-vl-model'));if(!config)throw new AppError('MODEL_KEY_REQUIRED','请先在设置中填写模型 Key');return config;}
/** 发起生成前：线上模式检查配额并拿到内存配置 */
function beginGeneration(db:ConstructorParameters<typeof LibraryService>[0],request:Request,scope:string):ModelConfig|undefined{const config=requestModel(request);checkGenerationQuota(db,scope);return config;}
const TERMINAL=new Set(['succeeded','failed','cancelled','waiting_user']);
function services(request:Request){const base=getServices(request),lib=library(base.db,base.scopeId),model=createLearningModel(),courses=new CourseService(base.db,lib,model),study=new StudyService(base.db,lib,model);return {...base,library:lib,courses,study,records:new RecordService(base.db,study)};}
function schedule(_request:Request,scope:string,jobId:string,config?:ModelConfig){if(config){rememberJobKey(scope,jobId,config);}after(async()=>{const db=openVerifiedDb();try{const lib=library(db,scope),model=createLearningModel({db,scope,jobId,library:lib,config:jobKey(scope,jobId)});const {JobStore}=await import('@/lib/verified-learning/jobs');const store=new JobStore(db);const job=store.get(scope,jobId);if(job.kind==='curriculum')await new CourseService(db,lib,model).runGeneration(scope,jobId);else if(job.kind==='lesson'||job.kind==='question_set')await new StudyService(db,lib,model).runContent(scope,jobId);}catch{console.error('增强学习任务失败；详情已保存在任务状态中');}finally{try{const {JobStore}=await import('@/lib/verified-learning/jobs');if(TERMINAL.has(new JobStore(db).get(scope,jobId).status))forgetJobKey(scope,jobId);}catch{forgetJobKey(scope,jobId);}db.close();}});}
function scheduleAttempt(scope:string,attemptId:string){after(async()=>{const db=openVerifiedDb();try{await new StudyService(db,library(db,scope),createLearningModel()).processAttempt(scope,attemptId);}catch{console.error('判题任务未完成，请读取作答状态后恢复');}finally{db.close();}});}
async function handle(rawRequest:Request,context:Context){const requestId=randomUUID();const request=normalizeDevUrl(rawRequest);let opened:ReturnType<typeof services>|undefined;try{const parts=(await context.params).path??[],[resource,id,action,subId]=parts;const method=request.method;const key=()=>{const value=request.headers.get('idempotency-key');if(!value?.trim()||value.length>200)throw new LearningError('INVALID_INPUT','需要Idempotency-Key');return value;};const body=async()=>{const value=await readJson(request);if(!value||typeof value!=='object'||Array.isArray(value))throw new LearningError('INVALID_INPUT','需要JSON对象');return value as Record<string,unknown>;};
 if(resource==='mode'&&method==='GET')return ok(modeView(),requestId);
 if(resource==='access'){assertEnabled();assertRequest(request);const db=openVerifiedDb();try{if(method==='POST'){const input=parse(z.strictObject({token:z.string().max(128)}),await readJson(request,4096));const result=loginWith(db,request,input.token);const response=ok({expiresAt:result.expiresAt},requestId);for(const cookie of result.cookies)response.headers.append('set-cookie',cookie);return response;}if(method==='DELETE'){const response=ok({loggedOut:true},requestId);for(const cookie of logoutWith(db,request))response.headers.append('set-cookie',cookie);return response;}requireAccess(db,request);return ok({authenticated:true},requestId);}finally{db.close();}}
 opened=services(request);const {scopeId:scope,library,courses,study,records,jobs}=opened;const url=new URL(request.url);
 if(resource==='settings'&&id==='models'&&method==='POST'){if(isOnline()){const config=requestModel(request)!;return ok(await listModels({provider:config.provider,baseUrl:config.baseUrl,apiKey:config.apiKey},{}),requestId);}const saved:Record<string,string|undefined>={};for(const name of ['llm_provider','llm_base_url','llm_api_key']){const row=opened.db.prepare('SELECT value FROM settings WHERE key=?').get(name) as {value:string}|undefined;saved[name]=row?.value||process.env[name.toUpperCase()];}return ok(await listModels(await body(),saved),requestId);}
 if(resource==='settings'&&!id){if(isOnline()&&method!=='GET')throw new AppError('FORBIDDEN','线上模式的模型配置只保存在浏览器里');if(method==='GET')return ok(isOnline()?{llm_provider:'openai-compatible',online:true}:readSettings(opened.db),requestId);if(method==='PATCH')return ok(saveSettings(opened.db,await body()),requestId);}
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
  if(id&&method==='POST'){const b=await body();if(action==='generate'){const config=beginGeneration(opened.db,request,scope);const job=courses.generate(scope,id,Number(b.expectedRevision),key());countGeneration(opened.db,scope);schedule(request,scope,job.jobId,config);return ok(job,requestId,202);}if(action==='choices')return ok(courses.saveChoices(scope,id,Number(b.expectedRevision),key(),b.choices),requestId);if(action==='confirm')return ok(courses.confirm(scope,id,Number(b.expectedRevision),key(),b.acceptSourceAndPrerequisiteReview===true),requestId);if(action==='accept-result')return ok(courses.acceptResult(scope,id,Number(b.expectedRevision),key()),requestId);if(action==='copy'){const draft=courses.get(scope,id);return ok(courses.create(scope,key(),draft.input),requestId,201);}}
 }
 if(resource==='courses'&&method==='GET')return ok(courses.courses(scope),requestId);
 if(resource==='jobs'){if(!id&&method==='GET')return ok(jobs.list(scope),requestId);if(id&&method==='GET'&&action==='stream'){const last=Number(request.headers.get('last-event-id')??url.searchParams.get('after')??0);return jobStreamResponse(openVerifiedDb,scope,id,Number.isSafeInteger(last)?last:0,request.signal);}if(id&&method==='GET'&&action==='trace')return ok(buildTrace(opened.db,scope,id),requestId);if(id&&method==='GET')return ok(action==='events'?jobs.events(scope,id,Number(url.searchParams.get('after')??0)):jobs.get(scope,id),requestId);if(id&&method==='POST'&&action==='resume'){if(jobs.get(scope,id).kind==='import')throw new LearningError('VALIDATION_FAILED','导入重试请重新上传原文件');const config=requestModel(request);const job=jobs.resume(scope,id);schedule(request,scope,id,config);return ok(job,requestId,202);}if(id&&method==='POST'&&action==='cancel')return ok(jobs.cancel(scope,id),requestId);}
 if(resource==='sessions'&&id){if(!action&&method==='GET')return ok(study.get(scope,id),requestId);if(action==='tutor'&&method==='POST'){const config=requestModel(request);const input=parseTutorRequest(await readJson(request,256*1024));const context=buildTutorContext(opened.db,library,scope,id,input.runId,input.selection);return await tutorResponse({model:tutorModel(config),context,messages:input.messages as unknown as UIMessage[],abortSignal:request.signal,secret:config?.apiKey});}if(action==='history'&&method==='GET')return ok(study.history(scope,id,subId),requestId);if(method==='POST'||method==='PATCH'){const b=await body();if(action==='start'){const current=study.get(scope,id);const config=current.currentRun?requestModel(request):beginGeneration(opened.db,request,scope);const result=study.start(scope,id,Number(b.expectedRevision),key());if(result.job){if(!current.currentRun)countGeneration(opened.db,scope);schedule(request,scope,result.job.jobId,config);}return ok(result,requestId,result.job?202:200);}if(action==='lesson-completion')return ok(study.completeLesson(scope,id,String(b.runId),Number(b.expectedRevision),key()),requestId);if(action==='prior-knowledge')return ok(study.declarePrior(scope,id,Number(b.expectedRevision),key(),parse(z.array(z.string().min(1)).max(200),b.knowledgePointIds)),requestId);if(action==='mode')return ok(study.changeMode(scope,id,Number(b.expectedRevision),key(),String(b.mode)),requestId);if(action==='abandon')return ok(study.abandon(scope,id,String(b.runId),Number(b.expectedRevision),key()),requestId);if(action==='cursor')return ok(study.saveCursor(scope,id,Number(b.expectedRevision),b.cursor as Parameters<StudyService['saveCursor']>[3]),requestId);if(action==='remedial'){const config=beginGeneration(opened.db,request,scope);const result=study.remedial(scope,id,key());countGeneration(opened.db,scope);schedule(request,scope,result.job.jobId,config);return ok(result,requestId,202);}}}
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
