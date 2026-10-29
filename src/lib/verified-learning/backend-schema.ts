export const SCHEMA_V3 = `
CREATE TABLE vl_drafts (
 scope_id TEXT NOT NULL,draft_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),state TEXT NOT NULL,
 generation_job_id TEXT,generated_revision INTEGER,version_id TEXT,review_json TEXT,
 confirmed_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,draft_id)
);
CREATE TABLE vl_requests (
 scope_id TEXT NOT NULL,resource_id TEXT NOT NULL,request_key TEXT NOT NULL,
 request_json TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(scope_id,resource_id,request_key)
);
CREATE TABLE vl_course_reviews (
 scope_id TEXT NOT NULL,version_id TEXT NOT NULL,draft_id TEXT NOT NULL,
 proposal_json TEXT NOT NULL,choices_json TEXT NOT NULL,report_json TEXT NOT NULL,teaching_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,version_id),FOREIGN KEY(scope_id,version_id) REFERENCES vl_course_versions(scope_id,version_id)
);
CREATE TABLE vl_templates (
 scope_id TEXT NOT NULL,template_id TEXT NOT NULL,revision INTEGER NOT NULL,name TEXT NOT NULL,
 content TEXT NOT NULL,subject_type TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope_id,template_id)
);
CREATE TABLE vl_activity_runs (
 scope_id TEXT NOT NULL,run_id TEXT NOT NULL,session_id TEXT NOT NULL,version_id TEXT NOT NULL,
 activity_id TEXT NOT NULL,activity_json TEXT NOT NULL,purpose TEXT NOT NULL DEFAULT 'scheduled',
 status TEXT NOT NULL,content_json TEXT,job_id TEXT,created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,run_id),FOREIGN KEY(scope_id,session_id) REFERENCES vl_study_sessions(scope_id,session_id)
);
CREATE INDEX vl_run_session ON vl_activity_runs(scope_id,session_id,created_at);
CREATE TABLE vl_questions (
 scope_id TEXT NOT NULL,question_id TEXT NOT NULL,run_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,question_id),FOREIGN KEY(scope_id,run_id) REFERENCES vl_activity_runs(scope_id,run_id)
);
CREATE TABLE vl_attempts (
 scope_id TEXT NOT NULL,attempt_id TEXT NOT NULL,run_id TEXT NOT NULL,question_id TEXT NOT NULL,
 request_key TEXT NOT NULL,answer TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,
 judge_json TEXT,created_at TEXT NOT NULL,PRIMARY KEY(scope_id,attempt_id),
 UNIQUE(scope_id,run_id,question_id),FOREIGN KEY(scope_id,question_id) REFERENCES vl_questions(scope_id,question_id)
);
CREATE TABLE vl_study_cursors (
 scope_id TEXT NOT NULL,session_id TEXT NOT NULL,revision INTEGER NOT NULL,cursor_json TEXT NOT NULL,
 PRIMARY KEY(scope_id,session_id)
);
CREATE TABLE vl_notes (
 scope_id TEXT NOT NULL,note_id TEXT NOT NULL,course_id TEXT NOT NULL,version_id TEXT NOT NULL,
 knowledge_point_id TEXT NOT NULL,revision INTEGER NOT NULL,content_md TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,note_id)
);
CREATE TABLE vl_hint_events (
 scope_id TEXT NOT NULL,run_id TEXT NOT NULL,question_id TEXT NOT NULL,level INTEGER NOT NULL,
 content TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(scope_id,run_id,question_id,level)
);
CREATE TABLE vl_legacy_study (
 scope_id TEXT NOT NULL,course_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 cursor_json TEXT,read_ids_json TEXT NOT NULL DEFAULT '[]',bridge_draft_id TEXT,
 PRIMARY KEY(scope_id,course_id)
);
`;
