// 用户授权的一次真实知识点课件验收：总计最多30次请求；可传原验收目录继续，预算不重置。
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeVerifiedLearning } from '../src/lib/verified-learning/initialization';
import { LibraryService } from '../src/lib/verified-learning/library';
import { VerifiedLearningStore } from '../src/lib/verified-learning/store';
import { StudyService } from '../src/lib/verified-learning/study';
import { JobStore } from '../src/lib/verified-learning/jobs';
import { createLearningModel } from '../src/lib/verified-learning/model';
import type { SourceSnapshot } from '../src/lib/verified-learning/sources';
import { generationError } from '../src/lib/verified-learning/provider-error';

async function main() {
  const resume = process.argv[2];
  const folder = resume ?? path.join('data', 'agent-acceptance-' + randomUUID());
  const filename = path.join(folder, 'acceptance.db');
  if (!resume) { mkdirSync(folder, { recursive: true }); await initializeVerifiedLearning(filename, true); }
  const db = new Database(filename, { fileMustExist: true });
  process.env.DB_PATH = filename;
  const library = new LibraryService(db, path.join(folder, 'uploads'));
  let sessionId: string, runId: string, jobId: string;
  if (resume) {
    const run = db.prepare('SELECT session_id,run_id,job_id FROM vl_activity_runs ORDER BY rowid DESC LIMIT 1').get() as {session_id:string;run_id:string;job_id:string};
    sessionId=run.session_id;runId=run.run_id;jobId=run.job_id;
    new JobStore(db).resume('acceptance',jobId);
  } else {
    const original = new Database('data/verified-learning-dev.db', { readonly: true, fileMustExist: true });
    let source: SourceSnapshot;
    try {
      const settings = original.prepare("SELECT key,value FROM settings WHERE key IN ('llm_provider','llm_model','llm_base_url','llm_api_key')").all() as {key:string;value:string}[];
      for (const { key, value } of settings) db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(key,value);
      const row=original.prepare('SELECT snapshot_json FROM vl_source_revisions WHERE book_id NOT LIKE ? ORDER BY created_at DESC LIMIT 1').get('web:%') as {snapshot_json:string};
      source=JSON.parse(row.snapshot_json);
    } finally { original.close(); }
    db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,?,'owned','ready',?)").run('acceptance',source.sourceId,new Date().toISOString());
    db.prepare('INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,?,?,?)').run('acceptance',source.sourceId,source.sourceRevision,JSON.stringify(source),new Date().toISOString());
    const store=new VerifiedLearningStore(db);
    let version=store.createVersion('acceptance',{
      textbookId:source.sourceId,goal:'为零基础学生讲清楚 Python 变量与赋值，包含可运行示例、常见错误和总结。',teachingPrompt:'中文，讲解准确，示例简短，不需要练习题。',
      sourceRevisions:[{sourceId:source.sourceId,sourceRevision:source.sourceRevision}],allowSupplementalSources:true,
      outline:[{moduleId:'variables-module',title:'Python变量',points:[{knowledgePointId:'variables',title:'变量与赋值',prerequisiteIds:[],sourceIds:[source.sourceId],role:'target',coverage:'covered',reason:'真实验收知识点'}]}],
    });
    version=store.activateVersion('acceptance',version.courseVersionId);
    const session=store.createSession('acceptance',version.courseVersionId,'theory');sessionId=session.sessionId;
    const started=new StudyService(db,library,createLearningModel()).start('acceptance',sessionId,0,'acceptance-start');
    runId=started.run.runId;jobId=started.job!.jobId;
  }
  const count=()=>Number((db.prepare('SELECT coalesce(sum(requests),0) AS n FROM vl_agent_states WHERE job_id=?').get(jobId) as {n:number}).n);
  const budget = Number(process.env.AGENT_ACCEPTANCE_BUDGET ?? 30);
  const remaining=budget-count();
  if(remaining<=0){db.close();throw new Error('真实验收授权已用尽，不再调用模型');}
  console.log('验收记录：'+folder+'；剩余授权请求：'+remaining);
  const model=createLearningModel({db,scope:'acceptance',jobId,library},{maxRequests:remaining});
  const study=new StudyService(db,library,model);
  const timer=setInterval(()=>console.log(`进度：${new JobStore(db).get('acceptance',jobId).stage}；累计请求 ${count()}`),15000);
  try {
    await study.runContent('acceptance',jobId);
    const run=study.runView('acceptance',runId);
    const snapshot=db.prepare('SELECT messages_json FROM vl_agent_states WHERE job_id=? AND stage_id=?').get(jobId,'lesson') as {messages_json:string};
    const tools=JSON.parse(snapshot.messages_json).filter((m:{role:string})=>m.role==='toolResult').map((m:{toolName:string;isError:boolean})=>({name:m.toolName,error:m.isError}));
    const result={jobStatus:new JobStore(db).get('acceptance',jobId).status,runStatus:run.status,requests:count(),tools,characters:run.content?.markdown.length,citations:run.content?.citations.length,readCompleted:study.get('acceptance',sessionId).session.completedActivityIds.length};
    writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));writeFileSync(path.join(folder,'lesson.md'),run.content?.markdown??'');console.log(JSON.stringify(result,null,2));
    if(result.jobStatus!=='succeeded'||result.runStatus!=='ready'||!result.citations||result.readCompleted!==0)throw new Error('真实课件未通过验收');
  }finally{clearInterval(timer);db.close();}
}
main().catch(error=>{console.error(generationError(error).message);process.exitCode=1;});
