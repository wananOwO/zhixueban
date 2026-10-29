// 第一阶段 7dc9145 的历史 schema 快照，用于真实升级回归，不跟随新迁移生成。
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS vl_schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0), applied_at TEXT NOT NULL
);
CREATE TABLE vl_course_versions (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  version_id TEXT NOT NULL CHECK (length(trim(version_id)) > 0),
  course_id TEXT NOT NULL CHECK (length(trim(course_id)) > 0),
  status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  PRIMARY KEY (scope_id, version_id)
);
CREATE UNIQUE INDEX vl_active_course ON vl_course_versions(scope_id, course_id) WHERE status = 'active';
CREATE TABLE vl_study_sessions (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  version_id TEXT NOT NULL CHECK (length(trim(version_id)) > 0),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  PRIMARY KEY (scope_id, session_id),
  FOREIGN KEY (scope_id, version_id) REFERENCES vl_course_versions(scope_id, version_id)
);
CREATE INDEX vl_session_version ON vl_study_sessions(scope_id, version_id);
CREATE TABLE vl_learning_events (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, session_id, idempotency_key),
  UNIQUE (scope_id, session_id, revision),
  FOREIGN KEY (scope_id, session_id) REFERENCES vl_study_sessions(scope_id, session_id)
);
`;
