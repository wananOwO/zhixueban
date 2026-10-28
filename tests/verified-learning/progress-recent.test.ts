import {describe,expect,it} from 'vitest';
import {migrateVerifiedLearning,VerifiedLearningStore} from '@/lib/verified-learning/store';
import {StudyService} from '@/lib/verified-learning/study';
import {LibraryService} from '@/lib/verified-learning/library';
import {RecordService} from '@/lib/verified-learning/records';
import type {LearningModel} from '@/lib/verified-learning/backend-contracts';
import {courseInput} from './fixtures';
import {openTestDb,testDirectory} from './db-fixtures';

const model:LearningModel={propose:async()=>{throw new Error('不应调用模型')},lesson:async()=>{throw new Error('不应调用模型')},questions:async()=>{throw new Error('不应调用模型')},review:async()=>{throw new Error('不应调用模型')}};

async function setup(){
  const db=openTestDb();await migrateVerifiedLearning(db);
  const store=new VerifiedLearningStore(db);
  const version=store.activateVersion('a',store.createVersion('a',courseInput()).courseVersionId);
  const session=store.createSession('a',version.courseVersionId,'practice');
  const study=new StudyService(db,new LibraryService(db,testDirectory()),model);
  const activity={activityId:'run',kind:'point_quiz',moduleId:'basics',knowledgePointIds:['variables'],questionCount:5};
  db.prepare("INSERT INTO vl_activity_runs(scope_id,run_id,session_id,version_id,activity_id,activity_json,status,created_at) VALUES ('a','run',?,?,?,?,'completed',?)").run(session.sessionId,version.courseVersionId,'run',JSON.stringify(activity),'2026-10-21T00:00:00.000Z');
  return {db,study,records:new RecordService(db,study),versionId:version.courseVersionId};
}
type Ctx=Awaited<ReturnType<typeof setup>>;
function answer({db}:Ctx,index:number,correct=true,stem=`题目${index}`){
  const id=`q${index}`;
  db.prepare('INSERT INTO vl_questions VALUES (?,?,?,?)').run('a',id,'run',JSON.stringify({questionId:id,type:'choice',stem,answer:'A',targetIds:['variables']}));
  db.prepare("INSERT INTO vl_attempts(scope_id,attempt_id,run_id,question_id,request_key,answer,state,result_json,created_at) VALUES ('a',?,'run',?,?,'A','finished',?,?)").run(`a${index}`,id,`key${index}`,JSON.stringify({correct,category:correct?'accepted':'wrong_answer'}),`2026-10-21T00:00:${String(index).padStart(2,'0')}.000Z`);
}

describe('progress().recent：每个知识点最近 5 道计入证据的不同题',()=>{
  it('按时间先后列出对错，只保留最近 5 道',async()=>{
    const c=await setup();
    answer(c,1,false);answer(c,2);answer(c,3,false);answer(c,4);answer(c,5);answer(c,6);
    expect(c.records.progress('a',c.versionId).recent).toEqual({variables:[true,false,true,true,true]});
  });
  it('看过第 4 级提示的题与重做的同一道题不计入',async()=>{
    const c=await setup();
    answer(c,1);
    c.db.prepare('INSERT INTO vl_hint_events VALUES (?,?,?,?,?,?)').run('a','run','q2',4,'答案','2026-10-20T00:00:00.000Z');
    answer(c,2,false);
    answer(c,3,false,'题目1');
    expect(c.records.progress('a',c.versionId).recent).toEqual({variables:[true]});
  });
  it('与 verified 判定一致：recent 满足掌握条件的点就是 verified 列表',async()=>{
    const c=await setup();
    answer(c,1);answer(c,2);answer(c,3);
    const p=c.records.progress('a',c.versionId);
    expect(p.verifiedKnowledgePointIds).toEqual(['variables']);
    expect(p.recent.variables).toEqual([true,true,true]);
    answer(c,4,false);
    const q=c.records.progress('a',c.versionId);
    expect(q.verifiedKnowledgePointIds).toEqual([]);
    expect(q.recent.variables).toEqual([true,true,true,false]);
  });
  it('没有作答时为空对象，其他空间看不到',async()=>{
    const c=await setup();
    expect(c.records.progress('a',c.versionId).recent).toEqual({});
    expect(c.records.progress('a',c.versionId).evidenceQuestions).toBe(0);
    answer(c,1);
    expect(()=>c.records.progress('b',c.versionId)).toThrow();
  });
  it('evidenceQuestions：计入证据的不同题数，不受最近 5 题截断影响',async()=>{
    const c=await setup();
    for(let i=1;i<=7;i++)answer(c,i);
    c.db.prepare('INSERT INTO vl_hint_events VALUES (?,?,?,?,?,?)').run('a','run','q8',4,'答案','2026-10-20T00:00:00.000Z');
    answer(c,8);
    answer(c,9,true,'题目1');
    const p=c.records.progress('a',c.versionId);
    expect(p.evidenceQuestions).toBe(7);
    expect(p.recent.variables).toHaveLength(5);
    expect(p.attempts).toMatchObject({total:9});
  });
});
