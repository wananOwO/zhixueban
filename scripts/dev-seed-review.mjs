// 本地视觉检查用：把一次性测试库里已确认草稿的方案复制成一份「待确认」草稿（不调用模型）。
// 用法：node scripts/dev-seed-review.mjs data/ui-real.db  → 打印新草稿 ID
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const file = process.argv[2];
if (!file || !file.startsWith('data/ui-')) throw new Error('只允许操作 data/ui-*.db 一次性测试库');
const db = new Database(file);
const source = db.prepare("SELECT * FROM vl_drafts WHERE state='confirmed' LIMIT 1").get();
if (!source) throw new Error('没有已确认的草稿可以复制');
const id = randomUUID();
const now = new Date().toISOString();
const review = JSON.parse(source.review_json);
review.stale = false;
const input = JSON.parse(source.input_json);
input.title = input.title ? `${input.title}（审核演示）` : '审核演示';
// 草稿审核需要一个草稿状态的课程版本：复制已确认版本的快照为新的 draft 版本
const version = db.prepare('SELECT * FROM vl_course_versions WHERE scope_id=? AND version_id=?').get(source.scope_id, source.version_id);
const versionId = randomUUID();
const snapshot = JSON.parse(version.snapshot_json);
snapshot.courseVersionId = versionId;
snapshot.status = 'draft';
db.prepare("INSERT INTO vl_course_versions(scope_id,version_id,course_id,status,snapshot_json) VALUES (?,?,?,'draft',?)").run(source.scope_id, versionId, version.course_id, JSON.stringify(snapshot));
const reviewRow = db.prepare('SELECT * FROM vl_course_reviews WHERE scope_id=? AND version_id=?').get(source.scope_id, source.version_id);
if (reviewRow) db.prepare('INSERT INTO vl_course_reviews VALUES (?,?,?,?,?,?,?)').run(source.scope_id, versionId, id, reviewRow.proposal_json, reviewRow.choices_json, reviewRow.report_json, reviewRow.teaching_json);
db.prepare(`INSERT INTO vl_drafts(scope_id,draft_id,input_json,state,created_at,updated_at,revision,generation_job_id,generated_revision,version_id,review_json)
  VALUES (?,?,?,'review',?,?,?,?,?,?,?)`).run(source.scope_id, id, JSON.stringify(input), now, now, 1, source.generation_job_id, 1, versionId, JSON.stringify(review));
console.log(id);
db.close();
