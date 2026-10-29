// 本地视觉检查用：把一次性测试库里已完成的课件或题组活动改回「进行中」，便于检查学习页（不调用模型）。
// 用法：node scripts/dev-seed-learning.mjs data/ui-learn.db lesson|quiz
// 只允许操作 data/ui-*.db 一次性测试库；会话状态与活动状态一并改写，作答记录保留（题组用 quiz 时清掉作答以便重新答）。
import Database from 'better-sqlite3';

const [file, kind = 'lesson'] = process.argv.slice(2);
if (!file || !/^data\/ui-[\w-]+\.db$/.test(file)) throw new Error('只允许操作 data/ui-*.db 一次性测试库');
const db = new Database(file);
const want = kind === 'quiz' ? 'point_quiz' : 'lesson';
const run = db.prepare('SELECT * FROM vl_activity_runs').all().find(r => JSON.parse(r.activity_json).kind === want);
if (!run) throw new Error(`没有 ${want} 活动`);
const session = db.prepare('SELECT * FROM vl_study_sessions WHERE scope_id=? AND session_id=?').get(run.scope_id, run.session_id);
const state = JSON.parse(session.state_json);
const activity = JSON.parse(run.activity_json);
// 回到这个活动开始时：它及其之后的活动都不算完成
const index = state.completedActivityIds.indexOf(run.activity_id);
state.completedActivityIds = index >= 0 ? state.completedActivityIds.slice(0, index) : state.completedActivityIds;
state.currentActivity = activity;
state.revision = session.revision + 1;
db.transaction(() => {
  db.prepare('UPDATE vl_study_sessions SET revision=?, state_json=? WHERE scope_id=? AND session_id=?').run(state.revision, JSON.stringify(state), run.scope_id, run.session_id);
  db.prepare("UPDATE vl_activity_runs SET status='ready' WHERE scope_id=? AND run_id=?").run(run.scope_id, run.run_id);
  // 之后的活动标为放弃，保证「当前活动」唯一
  for (const other of db.prepare("SELECT run_id, activity_json FROM vl_activity_runs WHERE scope_id=? AND session_id=? AND run_id<>? AND status<>'abandoned'").all(run.scope_id, run.session_id, run.run_id)) {
    if (!state.completedActivityIds.includes(JSON.parse(other.activity_json).activityId)) db.prepare("UPDATE vl_activity_runs SET status='abandoned' WHERE scope_id=? AND run_id=?").run(run.scope_id, other.run_id);
  }
  if (want === 'point_quiz') {
    db.prepare('DELETE FROM vl_attempts WHERE scope_id=? AND run_id=?').run(run.scope_id, run.run_id);
    db.prepare('DELETE FROM vl_hint_events WHERE scope_id=? AND run_id=?').run(run.scope_id, run.run_id);
  }
})();
console.log(`${run.session_id} 当前活动：${want}（${run.run_id}）`);
db.close();
