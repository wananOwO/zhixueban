import type Database from 'better-sqlite3';
import { LearningError, type CourseVersion } from './contracts';
import { activateCourseVersion, createCourseVersion, reviseCourseVersion } from './course-version';
import { createStudySession, transitionSession, type StudySession } from './session';

export { migrateVerifiedLearning } from './migrations';

function assertIds(...ids: string[]): void {
  if (ids.some(id => typeof id !== 'string' || id.trim().length === 0)) {
    throw new LearningError('INVALID_INPUT', 'Expected nonblank identifiers');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new LearningError('INVALID_INPUT', 'Command must contain only JSON values');
}

export class VerifiedLearningStore {
  constructor(private readonly db: Database.Database) {}

  private insertVersion(scopeId: string, version: CourseVersion): CourseVersion {
    this.db.prepare(`INSERT INTO vl_course_versions(scope_id, version_id, course_id, status, snapshot_json)
      VALUES (?, ?, ?, ?, ?)`).run(scopeId, version.courseVersionId, version.courseId, version.status, JSON.stringify(version));
    return version;
  }

  createVersion(scopeId: string, input: unknown): CourseVersion {
    assertIds(scopeId);
    return this.insertVersion(scopeId, createCourseVersion(input));
  }

  reviseVersion(scopeId: string, versionId: string, input: unknown): CourseVersion {
    return this.db.transaction(() =>
      this.insertVersion(scopeId, reviseCourseVersion(this.getVersion(scopeId, versionId), input))).immediate();
  }

  getVersion(scopeId: string, versionId: string): CourseVersion {
    assertIds(scopeId, versionId);
    const row = this.db.prepare('SELECT status, snapshot_json FROM vl_course_versions WHERE scope_id=? AND version_id=?')
      .get(scopeId, versionId) as { status: CourseVersion['status']; snapshot_json: string } | undefined;
    if (!row) throw new LearningError('NOT_FOUND', 'Course version not found');
    return { ...JSON.parse(row.snapshot_json), status: row.status };
  }

  activateVersion(scopeId: string, versionId: string): CourseVersion {
    return this.db.transaction(() => {
      const version = this.getVersion(scopeId, versionId);
      if (version.status === 'active') return version;
      if (version.status === 'archived') throw new LearningError('VERSION_CONFLICT', 'Archived versions stay archived');
      const active = activateCourseVersion(version);
      this.db.prepare("UPDATE vl_course_versions SET status='archived' WHERE scope_id=? AND course_id=? AND status='active'")
        .run(scopeId, version.courseId);
      this.db.prepare("UPDATE vl_course_versions SET status='active' WHERE scope_id=? AND version_id=?").run(scopeId, versionId);
      return active;
    }).immediate();
  }

  createSession(scopeId: string, versionId: string, mode: unknown): StudySession {
    return this.db.transaction(() => {
      const session = createStudySession(this.getVersion(scopeId, versionId), mode);
      this.db.prepare(`INSERT INTO vl_study_sessions(scope_id, session_id, version_id, revision, state_json)
        VALUES (?, ?, ?, ?, ?)`).run(scopeId, session.sessionId, versionId, session.revision, JSON.stringify(session));
      return session;
    }).immediate();
  }

  getSession(scopeId: string, sessionId: string): StudySession {
    assertIds(scopeId, sessionId);
    const row = this.db.prepare('SELECT state_json FROM vl_study_sessions WHERE scope_id=? AND session_id=?')
      .get(scopeId, sessionId) as { state_json: string } | undefined;
    if (!row) throw new LearningError('NOT_FOUND', 'Study session not found');
    return JSON.parse(row.state_json);
  }

  dispatch(scopeId: string, sessionId: string, expectedRevision: number, idempotencyKey: string, command: unknown): StudySession {
    assertIds(scopeId, sessionId, idempotencyKey);
    return this.db.transaction(() => {
      const current = this.getSession(scopeId, sessionId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new LearningError('INVALID_INPUT', 'Invalid expected revision');
      }
      let request: string;
      try {
        request = canonicalJson({ expectedRevision, command });
      } catch {
        throw new LearningError('INVALID_INPUT', 'Command must contain only JSON values');
      }
      const prior = this.db.prepare(`SELECT request_json, result_json FROM vl_learning_events
        WHERE scope_id=? AND session_id=? AND idempotency_key=?`).get(scopeId, sessionId, idempotencyKey) as {
        request_json: string; result_json: string;
      } | undefined;
      if (prior) {
        if (prior.request_json !== request) throw new LearningError('VERSION_CONFLICT', 'Idempotency key was reused');
        return JSON.parse(prior.result_json);
      }
      const version = this.getVersion(scopeId, current.courseVersionId);
      const result = transitionSession(version, current, expectedRevision, command);
      const serialized = JSON.stringify(result);
      const update = this.db.prepare(`UPDATE vl_study_sessions SET revision=?, state_json=?
        WHERE scope_id=? AND session_id=? AND revision=?`)
        .run(result.revision, serialized, scopeId, sessionId, expectedRevision);
      if (update.changes !== 1) throw new LearningError('VERSION_CONFLICT', 'Session revision changed');
      this.db.prepare(`INSERT INTO vl_learning_events
        (scope_id, session_id, idempotency_key, revision, request_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(scopeId, sessionId, idempotencyKey, result.revision, request, serialized, new Date().toISOString());
      return result;
    }).immediate();
  }
}
