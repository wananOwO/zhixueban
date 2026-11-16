import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { LearningError } from './contracts';

import { SCHEMA_V3 } from './backend-schema';

export const CURRENT_SCHEMA_VERSION = 6;

/** v6：来源快照的派生检索块、向量和可恢复索引任务。 */
const SCHEMA_V6 = `
CREATE TABLE vl_retrieval_chunks (
 scope_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 chapter_id TEXT NOT NULL,
 paragraph_index INTEGER NOT NULL CHECK (typeof(paragraph_index) = 'integer' AND paragraph_index >= 0),
 part_index INTEGER NOT NULL CHECK (typeof(part_index) = 'integer' AND part_index >= 0),
 text TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 preprocess_version TEXT NOT NULL,
 PRIMARY KEY (scope_id, book_id, source_revision, chapter_id, paragraph_index, part_index),
 FOREIGN KEY (scope_id, book_id, source_revision) REFERENCES vl_source_revisions(scope_id, book_id, source_revision)
);
CREATE INDEX vl_retrieval_chunk_scope_revision ON vl_retrieval_chunks(scope_id, book_id, source_revision);
CREATE TABLE vl_retrieval_vectors (
 scope_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 chapter_id TEXT NOT NULL,
 paragraph_index INTEGER NOT NULL,
 part_index INTEGER NOT NULL,
 profile_id TEXT NOT NULL,
 dimensions INTEGER NOT NULL CHECK (typeof(dimensions) = 'integer' AND dimensions > 0),
 vector_blob BLOB,
 status TEXT NOT NULL CHECK (status IN ('pending','ready','failed','stale')),
 error_code TEXT,
 updated_at TEXT NOT NULL,
 CHECK (status <> 'ready' OR (vector_blob IS NOT NULL AND length(vector_blob) = dimensions * 4)),
 PRIMARY KEY (scope_id, book_id, source_revision, chapter_id, paragraph_index, part_index, profile_id),
 FOREIGN KEY (scope_id, book_id, source_revision, chapter_id, paragraph_index, part_index)
   REFERENCES vl_retrieval_chunks(scope_id, book_id, source_revision, chapter_id, paragraph_index, part_index)
);
CREATE INDEX vl_retrieval_vector_ready ON vl_retrieval_vectors(scope_id, book_id, source_revision, profile_id, status);
CREATE TABLE vl_index_jobs (
 scope_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 profile_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_user','succeeded','failed','cancelled')),
 lease_token TEXT,
 lease_until TEXT,
 progress_json TEXT NOT NULL CHECK (json_valid(progress_json)),
 error_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (scope_id, job_id),
 FOREIGN KEY (scope_id, book_id, source_revision) REFERENCES vl_source_revisions(scope_id, book_id, source_revision)
);
CREATE UNIQUE INDEX vl_index_job_active ON vl_index_jobs(scope_id, book_id, source_revision, profile_id)
 WHERE status IN ('queued','running','waiting_user');
`;

/** v5：线上模式的浏览器空间登记与每日生成计数；本地模式不使用。 */
const SCHEMA_V5 = `
CREATE TABLE vl_spaces (
 space_id TEXT PRIMARY KEY CHECK (length(space_id) = 43),
 created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 sample_seeded INTEGER NOT NULL DEFAULT 0 CHECK (sample_seeded IN (0,1))
);
CREATE INDEX vl_space_seen ON vl_spaces(last_seen_at);
CREATE TABLE vl_generation_usage (
 space_id TEXT NOT NULL, day TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(count) = 'integer' AND count >= 0),
 PRIMARY KEY (space_id, day)
);
`;

const SCHEMA_V4 = `
CREATE TABLE vl_agent_states (
 scope_id TEXT NOT NULL, job_id TEXT NOT NULL, stage_id TEXT NOT NULL,
 messages_json TEXT NOT NULL DEFAULT '[]', artifacts_json TEXT NOT NULL DEFAULT '{}',
 requests INTEGER NOT NULL DEFAULT 0, in_flight INTEGER NOT NULL DEFAULT 0,
 model_json TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,job_id,stage_id),
 FOREIGN KEY(scope_id,job_id) REFERENCES vl_jobs(scope_id,job_id)
);
`;

const SCHEMA_V1 = `
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

const SCHEMA_V2 = `
CREATE TABLE vl_web_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  expires_at TEXT NOT NULL, config_fingerprint TEXT NOT NULL
);
CREATE INDEX vl_web_session_expiry ON vl_web_sessions(expires_at);
CREATE TABLE vl_jobs (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  job_id TEXT NOT NULL CHECK (length(trim(job_id)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('import','curriculum','lesson','question_set','assessment')),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_user','succeeded','failed','cancelled')),
  stage TEXT NOT NULL CHECK (length(trim(stage)) > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempts) = 'integer' AND attempts BETWEEN 0 AND 9007199254740991),
  lease_token TEXT, lease_until TEXT,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  event_cursor INTEGER NOT NULL DEFAULT 0 CHECK (typeof(event_cursor) = 'integer' AND event_cursor >= 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, job_id), UNIQUE (scope_id, kind, idempotency_key),
  CHECK ((status = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'running' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX vl_job_recent ON vl_jobs(scope_id, created_at DESC, job_id);
CREATE TABLE vl_job_events (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  job_id TEXT NOT NULL CHECK (length(trim(job_id)) > 0),
  cursor INTEGER NOT NULL CHECK (typeof(cursor) = 'integer' AND cursor > 0),
  stage TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, job_id, cursor),
  FOREIGN KEY (scope_id, job_id) REFERENCES vl_jobs(scope_id, job_id)
);
CREATE TABLE vl_books (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  book_id TEXT NOT NULL CHECK (length(trim(book_id)) > 0),
  origin TEXT NOT NULL CHECK (origin IN ('owned','legacy')),
  legacy_id TEXT, file_relpath TEXT, file_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','ready','failed','deleting')),
  archived_at TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, book_id),
  CHECK ((origin = 'legacy' AND legacy_id IS NOT NULL AND length(trim(legacy_id)) > 0)
    OR (origin = 'owned' AND legacy_id IS NULL))
);
CREATE UNIQUE INDEX vl_book_content ON vl_books(scope_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE UNIQUE INDEX vl_book_legacy ON vl_books(scope_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TABLE vl_source_revisions (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  book_id TEXT NOT NULL CHECK (length(trim(book_id)) > 0),
  source_revision TEXT NOT NULL CHECK (length(trim(source_revision)) > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL, revoked_at TEXT,
  PRIMARY KEY (scope_id, book_id, source_revision),
  FOREIGN KEY (scope_id, book_id) REFERENCES vl_books(scope_id, book_id)
);
CREATE TRIGGER vl_source_snapshot_immutable BEFORE UPDATE OF snapshot_json ON vl_source_revisions
WHEN NEW.snapshot_json <> OLD.snapshot_json BEGIN SELECT RAISE(ABORT, '来源快照不可覆盖'); END;
CREATE TABLE vl_deletions (
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  deletion_id TEXT NOT NULL CHECK (length(trim(deletion_id)) > 0),
  book_id TEXT NOT NULL CHECK (length(trim(book_id)) > 0),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0),
  state TEXT NOT NULL CHECK (state IN ('prepared','cleaning','failed','done')),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  error_code TEXT,
  PRIMARY KEY (scope_id, deletion_id)
);
CREATE UNIQUE INDEX vl_pending_deletion ON vl_deletions(scope_id, book_id) WHERE state <> 'done';
`;

export function getSchemaVersion(db: Database.Database): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vl_schema_migrations'").get()) return 0;
  const rows = db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all() as { version: number }[];
  if (rows.some((row, index) => row.version !== index + 1 || row.version > CURRENT_SCHEMA_VERSION)) {
    throw new LearningError('VERSION_CONFLICT', '不支持的学习数据库版本');
  }
  return rows.length;
}

export async function migrateVerifiedLearning(db: Database.Database): Promise<void> {
  if (getSchemaVersion(db) === CURRENT_SCHEMA_VERSION) return;
  const main = (db.pragma('database_list') as { name: string; file: string }[]).find(row => row.name === 'main')!;
  if (main.file) await db.backup(`${main.file}.vl-v${CURRENT_SCHEMA_VERSION}-${randomUUID()}.bak`);
  db.transaction(() => {
    // 等待备份期间其他连接可能已经迁移，取得写锁后重新核验。
    const version = getSchemaVersion(db);
    for (let next = version + 1; next <= CURRENT_SCHEMA_VERSION; next++) {
      db.exec([SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6][next - 1]);
      db.prepare('INSERT INTO vl_schema_migrations(version, applied_at) VALUES (?, ?)').run(next, new Date().toISOString());
    }
  }).immediate();
}
