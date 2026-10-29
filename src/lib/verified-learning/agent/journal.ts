import type Database from 'better-sqlite3';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export class AgentJournal {
  private readonly lease: string | null;
  private assertActive() { if (this.cancelled()) throw new Error('Agent任务已取消或执行租约已变化，停止旧worker写入'); }
  constructor(private readonly db: Database.Database, private readonly scope: string, private readonly job: string, private readonly stage: string) {
    const task = db.prepare('SELECT lease_token FROM vl_jobs WHERE scope_id=? AND job_id=?').get(scope,job) as {lease_token:string|null}|undefined;
    if (!task) throw new Error('Agent任务不存在');
    this.lease = task.lease_token;
    db.prepare('INSERT OR IGNORE INTO vl_agent_states(scope_id,job_id,stage_id,updated_at) VALUES (?,?,?,?)').run(scope,job,stage,new Date().toISOString());
  }
  load(): { messages: AgentMessage[]; artifacts: Record<string, unknown>; requests: number; inFlight: boolean } {
    const row=this.db.prepare('SELECT * FROM vl_agent_states WHERE scope_id=? AND job_id=? AND stage_id=?').get(this.scope,this.job,this.stage) as {messages_json:string;artifacts_json:string;requests:number;in_flight:number};
    return {messages:JSON.parse(row.messages_json),artifacts:JSON.parse(row.artifacts_json),requests:row.requests,inFlight:row.in_flight===1};
  }
  saveMessages(messages: AgentMessage[]) {
    this.assertActive();
    this.db.prepare('UPDATE vl_agent_states SET messages_json=?,updated_at=? WHERE scope_id=? AND job_id=? AND stage_id=?').run(JSON.stringify(messages),new Date().toISOString(),this.scope,this.job,this.stage);
  }
  saveArtifacts(artifacts: Record<string, unknown>) {
    this.assertActive();
    this.db.prepare('UPDATE vl_agent_states SET artifacts_json=?,updated_at=? WHERE scope_id=? AND job_id=? AND stage_id=?').run(JSON.stringify(artifacts),new Date().toISOString(),this.scope,this.job,this.stage);
  }
  requestStarted(model: unknown) {
    this.assertActive();
    this.db.prepare('UPDATE vl_agent_states SET requests=requests+1,in_flight=1,model_json=?,updated_at=? WHERE scope_id=? AND job_id=? AND stage_id=?').run(JSON.stringify(model),new Date().toISOString(),this.scope,this.job,this.stage);
  }
  requestFinished() {
    this.assertActive();
    this.db.prepare('UPDATE vl_agent_states SET in_flight=0,updated_at=? WHERE scope_id=? AND job_id=? AND stage_id=?').run(new Date().toISOString(),this.scope,this.job,this.stage);
  }
  progress(message: string) {
    this.assertActive();
    this.db.transaction(()=>{
      this.db.prepare('UPDATE vl_jobs SET event_cursor=event_cursor+1,stage=?,updated_at=? WHERE scope_id=? AND job_id=?').run(message,new Date().toISOString(),this.scope,this.job);
      this.db.prepare('INSERT INTO vl_job_events SELECT scope_id,job_id,event_cursor,?,?,? FROM vl_jobs WHERE scope_id=? AND job_id=?').run(this.stage,message,new Date().toISOString(),this.scope,this.job);
    })();
  }
  cancelled() {
    const row=this.db.prepare('SELECT status,lease_token,lease_until FROM vl_jobs WHERE scope_id=? AND job_id=?').get(this.scope,this.job) as {status:string;lease_token:string|null;lease_until:string|null}|undefined;
    return !row || row.status==='cancelled' || (this.lease !== null && (row.status!=='running' || row.lease_token!==this.lease || (row.lease_until!==null && Date.parse(row.lease_until)<=Date.now())));
  }
}
