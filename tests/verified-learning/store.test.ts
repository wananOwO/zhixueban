import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '@/lib/db/schema';
import { LearningError } from '@/lib/verified-learning/contracts';
import { nextActivity } from '@/lib/verified-learning/session';
import { migrateVerifiedLearning, VerifiedLearningStore } from '@/lib/verified-learning/store';
import { courseInput } from './fixtures';

const handles: Database.Database[] = [];
const directories: string[] = [];
function open(filename = ':memory:') {
  const db = new Database(filename);
  handles.push(db);
  return db;
}
function tempFile() {
  const directory = mkdtempSync(path.join(tmpdir(), 'verified-learning-'));
  directories.push(directory);
  return path.join(directory, 'test.db');
}
function tables(db: Database.Database) {
  return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
}
function eventCount(db: Database.Database) {
  return (db.prepare('SELECT count(*) AS count FROM vl_learning_events').get() as { count: number }).count;
}
async function setup(db = open()) {
  await migrateVerifiedLearning(db);
  const store = new VerifiedLearningStore(db);
  const draft = store.createVersion('a', courseInput());
  const version = store.activateVersion('a', draft.courseVersionId);
  const session = store.createSession('a', version.courseVersionId, 'theory');
  return { db, store, version, session };
}
function error(code: LearningError['code']) {
  return expect.objectContaining({ name: 'LearningError', code });
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('explicit migration', () => {
  it('does not migrate on construction and preserves all eleven legacy schemas and existing rows', async () => {
    const db = open();
    db.exec(SCHEMA_SQL);
    db.exec(`
      INSERT INTO textbooks VALUES ('old-b','Old book','txt','old.txt','{}','2026-10-20T00:00:00.000Z');
      INSERT INTO chunks VALUES ('old-chunk','old-b','chapter','Text','{}',NULL);
      INSERT INTO knowledge_points VALUES ('old-kp','old-b','Point','chapter',0,'locked',NULL);
      INSERT INTO knowledge_points VALUES ('old-kp2','old-b','Point 2','chapter',0,'locked',NULL);
      INSERT INTO knowledge_edges VALUES ('old-kp','old-kp2');
      INSERT INTO courses VALUES ('old-c','old-b','Old goal','Prompt','code',1,'[]','2026-10-20T00:00:00.000Z');
      INSERT INTO lessons VALUES ('old-l','old-c','old-kp','Lesson','[]');
      INSERT INTO questions VALUES ('old-q','old-c','point','old-kp','choice','easy','{}','{}','[]');
      INSERT INTO attempts VALUES ('old-a','old-q','old answer',1,'2026-10-20T00:00:00.000Z');
      INSERT INTO notes VALUES ('old-n','old-kp','Old note',NULL);
      INSERT INTO prompt_templates VALUES ('old-p','code','Name','Prompt');
      INSERT INTO settings VALUES ('legacy','kept');
    `);
    const oldTables = tables(db);
    expect(oldTables).toHaveLength(11);
    const oldRows = oldTables.map(row => {
      const name = (row as { name: string }).name;
      return { name, rows: db.prepare(`SELECT * FROM "${name}"`).all() };
    });
    const pragmas = [db.pragma('foreign_keys'), db.pragma('journal_mode')];
    new VerifiedLearningStore(db);
    expect(tables(db)).toEqual(oldTables);
    await migrateVerifiedLearning(db);
    await migrateVerifiedLearning(db);
    expect(tables(db).filter(row => !(row as { name: string }).name.startsWith('vl_'))).toEqual(oldTables);
    for (const { name, rows } of oldRows) expect(db.prepare(`SELECT * FROM "${name}"`).all()).toEqual(rows);
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'legacy', value: 'kept' }]);
    expect(db.prepare('SELECT version FROM vl_schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect([db.pragma('foreign_keys'), db.pragma('journal_mode')]).toEqual(pragmas);
    db.exec(`
      INSERT INTO textbooks VALUES ('b','Book','txt','book.txt','{}','2026-10-20T00:00:00.000Z');
      INSERT INTO knowledge_points VALUES ('kp','b','Point','chapter',0,'locked',NULL);
      INSERT INTO courses VALUES ('c','b','Goal','Prompt','code',1,'[]','2026-10-20T00:00:00.000Z');
      INSERT INTO questions VALUES ('q','c','point','kp','choice','easy','{}','{}','[]');
      INSERT INTO attempts VALUES ('a','q','answer',1,'2026-10-20T00:00:00.000Z');
      INSERT INTO notes VALUES ('n','kp','Note',NULL);
    `);
    expect(db.prepare(`SELECT t.title, c.goal, a.user_answer, n.content_md
      FROM textbooks t JOIN courses c ON c.textbook_id=t.id
      JOIN questions q ON q.course_id=c.id JOIN attempts a ON a.question_id=q.id
      JOIN knowledge_points k ON k.textbook_id=t.id JOIN notes n ON n.knowledge_point_id=k.id WHERE t.id='b'`).all())
      .toEqual([{ title: 'Book', goal: 'Goal', user_answer: 'answer', content_md: 'Note' }]);
  });

  it('backs up a real file before DDL, skips repeat backups, and persists across reopening', async () => {
    const filename = tempFile();
    const db = open(filename);
    db.exec(SCHEMA_SQL);
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('before', 'migration');
    const { store, session } = await setup(db);
    const saved = store.dispatch('a', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' });
    const backups = readdirSync(path.dirname(filename)).filter(name => name !== 'test.db');
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/);
    const backup = open(path.join(path.dirname(filename), backups[0]));
    expect(tables(backup)).toHaveLength(11);
    expect(backup.prepare('SELECT value FROM settings').get()).toEqual({ value: 'migration' });
    await migrateVerifiedLearning(db);
    expect(readdirSync(path.dirname(filename))).toHaveLength(2);
    db.close();
    const reopened = new VerifiedLearningStore(open(filename));
    expect(reopened.getSession('a', session.sessionId)).toEqual(saved);
    expect(reopened.dispatch('a', session.sessionId, 0, 'key', { mode: 'drill', type: 'change_mode' })).toEqual(saved);
  });

  it('leaves schema untouched when backup fails', async () => {
    const db = open(tempFile());
    db.exec(SCHEMA_SQL);
    const before = tables(db);
    vi.spyOn(db, 'backup').mockRejectedValue(new Error('backup failed'));
    await expect(migrateVerifiedLearning(db)).rejects.toThrow('backup failed');
    expect(tables(db)).toEqual(before);
  });

  it('rolls back partial DDL and the migration record on a real schema conflict', async () => {
    const db = open();
    db.exec('CREATE TABLE vl_study_sessions (sentinel TEXT)');
    const before = tables(db);
    await expect(migrateVerifiedLearning(db)).rejects.toThrow('vl_study_sessions already exists');
    expect(tables(db)).toEqual(before);
  });

  it('rejects a newer schema before backup or DDL', async () => {
    const filename = tempFile();
    const db = open(filename);
    db.exec("CREATE TABLE vl_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO vl_schema_migrations VALUES (4,'future')");
    const before = tables(db);
    await expect(migrateVerifiedLearning(db)).rejects.toThrow(error('VERSION_CONFLICT'));
    expect(tables(db)).toEqual(before);
    expect(readdirSync(path.dirname(filename))).toEqual(['test.db']);
  });

  it('enforces status, revision, active-course uniqueness and scoped references', async () => {
    const { db, version, session } = await setup();
    expect(() => db.prepare("UPDATE vl_course_versions SET status='other'").run()).toThrow();
    expect(() => db.prepare('UPDATE vl_study_sessions SET revision=-1').run()).toThrow();
    expect(() => db.prepare('UPDATE vl_study_sessions SET revision=1.5').run()).toThrow();
    db.pragma('foreign_keys = ON');
    expect(() => db.prepare("UPDATE vl_study_sessions SET scope_id='foreign'").run()).toThrow();
    expect(() => db.prepare(`INSERT INTO vl_course_versions SELECT scope_id,'duplicate',course_id,status,snapshot_json
      FROM vl_course_versions WHERE version_id=?`).run(version.courseVersionId)).toThrow();
    expect(new VerifiedLearningStore(db).getSession('a', session.sessionId).revision).toBe(0);
  });

  it('rejects blank stored identifiers even when the caller disables foreign keys', async () => {
    const { db, store, session } = await setup();
    store.dispatch('a', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' });
    db.pragma('foreign_keys = OFF');
    for (const table of ['vl_study_sessions', 'vl_learning_events']) {
      expect(() => db.prepare(`UPDATE ${table} SET scope_id=' '`).run()).toThrow();
      expect(() => db.prepare(`UPDATE ${table} SET session_id=' '`).run()).toThrow();
    }
    expect(() => db.prepare("UPDATE vl_study_sessions SET version_id=' '").run()).toThrow();
  });
});

describe('scoped versions and sessions', () => {
  it('keeps snapshots immutable, archives only the same scoped course, and pins old sessions', async () => {
    const { db, store, version, session } = await setup();
    const other = store.activateVersion('a', store.createVersion('a', courseInput()).courseVersionId);
    db.prepare(`INSERT INTO vl_course_versions SELECT 'b',version_id,course_id,status,snapshot_json
      FROM vl_course_versions WHERE scope_id='a' AND version_id=?`).run(version.courseVersionId);
    const foreign = store.getVersion('b', version.courseVersionId);
    const snapshot = db.prepare('SELECT snapshot_json FROM vl_course_versions WHERE version_id=?').get(version.courseVersionId);
    const revision = store.reviseVersion('a', version.courseVersionId, { ...courseInput(), goal: 'New goal' });
    expect(revision.courseId).toBe(version.courseId);
    expect(revision.courseVersionId).not.toBe(version.courseVersionId);
    expect(revision.status).toBe('draft');
    const active = store.activateVersion('a', revision.courseVersionId);
    expect(store.activateVersion('a', revision.courseVersionId)).toEqual(active);
    expect(store.getVersion('a', version.courseVersionId).status).toBe('archived');
    expect(store.getVersion('a', other.courseVersionId).status).toBe('active');
    expect(store.getVersion('b', foreign.courseVersionId).status).toBe('active');
    expect(db.prepare('SELECT snapshot_json FROM vl_course_versions WHERE version_id=?').get(version.courseVersionId)).toEqual(snapshot);
    expect(store.getVersion('a', version.courseVersionId).goal).toBe('Python basics');
    expect(store.getSession('a', session.sessionId).courseVersionId).toBe(version.courseVersionId);
    expect(store.dispatch('a', session.sessionId, 0, 'old', { type: 'change_mode', mode: 'practice' }).revision).toBe(1);
    expect(() => store.activateVersion('a', version.courseVersionId)).toThrow(error('VERSION_CONFLICT'));
    expect(() => store.createSession('a', version.courseVersionId, 'theory')).toThrow(error('INVALID_INPUT'));
  });

  it('rejects draft sessions and failed activation without archiving the active version', async () => {
    const { store, version } = await setup();
    const draft = store.reviseVersion('a', version.courseVersionId, { ...courseInput(), outline: [] });
    expect(() => store.createSession('a', draft.courseVersionId, 'theory')).toThrow(error('INVALID_INPUT'));
    expect(() => store.activateVersion('a', draft.courseVersionId)).toThrow(error('VALIDATION_FAILED'));
    expect(store.getVersion('a', version.courseVersionId).status).toBe('active');
  });

  it('returns NOT_FOUND for every cross-scope access and persists no foreign changes', async () => {
    const { db, store, version, session } = await setup();
    const calls = [
      () => store.getVersion('b', version.courseVersionId),
      () => store.reviseVersion('b', version.courseVersionId, courseInput()),
      () => store.activateVersion('b', version.courseVersionId),
      () => store.createSession('b', version.courseVersionId, 'theory'),
      () => store.getSession('b', session.sessionId),
      () => store.dispatch('b', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' }),
      () => store.getVersion('a', 'missing'),
      () => store.getSession('a', 'missing'),
    ];
    for (const call of calls) expect(call).toThrow(error('NOT_FOUND'));
    expect(store.getSession('a', session.sessionId)).toEqual(session);
    expect(eventCount(db)).toBe(0);
  });

  it('validates identifiers, modes, revisions and commands before persisting', async () => {
    const { db, store, version, session } = await setup();
    const calls = [
      () => store.createVersion(' ', courseInput()),
      () => store.createVersion('a', {}),
      () => store.getVersion('', version.courseVersionId),
      () => store.getVersion('a', ' '),
      () => store.reviseVersion('a', '', courseInput()),
      () => store.activateVersion('a', ''),
      () => store.createSession('', version.courseVersionId, 'theory'),
      () => store.createSession('a', '', 'theory'),
      () => store.createSession('a', version.courseVersionId, 1),
      () => store.getSession(' ', session.sessionId),
      () => store.getSession('a', ''),
      () => store.dispatch('a', '', 0, 'key', {}),
      () => store.dispatch('a', session.sessionId, 0, ' ', {}),
      () => store.dispatch('a', session.sessionId, -1, 'key', {}),
      () => store.dispatch('a', session.sessionId, 0.5, 'key', {}),
      () => store.dispatch('a', session.sessionId, 0, 'key', { type: 'unknown' }),
    ];
    for (const call of calls) expect(call).toThrow(error('INVALID_INPUT'));
    expect(store.getSession('a', session.sessionId)).toEqual(session);
    expect(eventCount(db)).toBe(0);
  });
});

describe('atomic dispatch', () => {
  it('returns the original retry result after later commands and treats property order as immaterial', async () => {
    const { db, store, session } = await setup();
    const command = { type: 'change_mode', mode: 'practice' };
    const first = store.dispatch('a', session.sessionId, 0, 'one', command);
    const second = store.dispatch('a', session.sessionId, 1, 'two', { type: 'change_mode', mode: 'drill' });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(store.dispatch('a', session.sessionId, 0, 'one', { mode: 'practice', type: 'change_mode' })).toEqual(first);
    expect(store.getSession('a', session.sessionId)).toEqual(second);
    expect(eventCount(db)).toBe(2);
    const event = db.prepare('SELECT request_json, result_json, created_at FROM vl_learning_events WHERE idempotency_key=?').get('one') as {
      request_json: string; result_json: string; created_at: string;
    };
    expect(JSON.parse(event.request_json)).toEqual({ expectedRevision: 0, command });
    expect(JSON.parse(event.result_json)).toEqual(first);
    expect(new Date(event.created_at).toISOString()).toBe(event.created_at);
  });

  it('rejects key collisions, stale revisions and rejected transitions without side effects', async () => {
    const { db, store, session } = await setup();
    const command = { type: 'change_mode', mode: 'practice' };
    const saved = store.dispatch('a', session.sessionId, 0, 'key', command);
    expect(() => store.dispatch('a', session.sessionId, 1, 'key', command)).toThrow(error('VERSION_CONFLICT'));
    expect(() => store.dispatch('a', session.sessionId, 0, 'key', { ...command, mode: 'drill' })).toThrow(error('VERSION_CONFLICT'));
    expect(() => store.dispatch('a', session.sessionId, 0, 'new-key', command)).toThrow(error('VERSION_CONFLICT'));
    expect(() => store.dispatch('a', session.sessionId, 1, 'bad', { type: 'start_activity', activityId: 'foreign' })).toThrow(error('INVALID_INPUT'));
    expect(() => store.dispatch('a', session.sessionId, 0, 'key', { ...command, extra: undefined })).toThrow(error('INVALID_INPUT'));
    expect(store.getSession('a', session.sessionId)).toEqual(saved);
    expect(eventCount(db)).toBe(1);
  });

  it('scopes idempotency keys to each session', async () => {
    const { db, store, version, session } = await setup();
    const another = store.createSession('a', version.courseVersionId, 'theory');
    store.dispatch('a', session.sessionId, 0, 'same', { type: 'change_mode', mode: 'drill' });
    expect(store.dispatch('a', another.sessionId, 0, 'same', { type: 'change_mode', mode: 'practice' }).mode).toBe('practice');
    expect(eventCount(db)).toBe(2);
  });

  it('rolls back the session update when event insertion aborts', async () => {
    const { db, store, session } = await setup();
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON vl_learning_events BEGIN SELECT RAISE(ABORT, 'event failed'); END");
    expect(() => store.dispatch('a', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' })).toThrow('event failed');
    expect(store.getSession('a', session.sessionId)).toEqual(session);
    expect(eventCount(db)).toBe(0);
    db.exec('DROP TRIGGER fail_event');
    expect(store.dispatch('a', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' }).revision).toBe(1);
  });

  it('rejects an UPDATE that affects no rows and inserts no event', async () => {
    const { db, store, session } = await setup();
    db.exec('CREATE TRIGGER ignore_update BEFORE UPDATE ON vl_study_sessions BEGIN SELECT RAISE(IGNORE); END');
    expect(() => store.dispatch('a', session.sessionId, 0, 'key', { type: 'change_mode', mode: 'drill' }))
      .toThrow(error('VERSION_CONFLICT'));
    expect(store.getSession('a', session.sessionId)).toEqual(session);
    expect(eventCount(db)).toBe(0);
  });

  it('rejects a stale update from a second file connection', async () => {
    const filename = tempFile();
    const { db, store, session } = await setup(open(filename));
    const second = new VerifiedLearningStore(open(filename));
    expect(second.getSession('a', session.sessionId).revision).toBe(0);
    const saved = store.dispatch('a', session.sessionId, 0, 'first', { type: 'change_mode', mode: 'drill' });
    expect(() => second.dispatch('a', session.sessionId, 0, 'second', { type: 'change_mode', mode: 'practice' }))
      .toThrow(error('VERSION_CONFLICT'));
    expect(second.getSession('a', session.sessionId)).toEqual(saved);
    expect(eventCount(db)).toBe(1);
  });

  it('retains mastery gates without claiming an evidence service', async () => {
    const db = open();
    await migrateVerifiedLearning(db);
    const store = new VerifiedLearningStore(db);
    const input = courseInput();
    input.assessment.progressionPolicy = 'mastery';
    const version = store.activateVersion('a', store.createVersion('a', input).courseVersionId);
    let session = store.createSession('a', version.courseVersionId, 'practice');
    for (let index = 0; index < 2; index++) {
      const step = nextActivity(version, session);
      if (step.kind !== 'activity') throw new Error('Expected activity');
      session = store.dispatch('a', session.sessionId, session.revision, `start-${index}`, { type: 'start_activity', activityId: step.activity.activityId });
      session = store.dispatch('a', session.sessionId, session.revision, `complete-${index}`, {
        type: 'complete_activity', activityId: step.activity.activityId,
        ...(index === 1 ? { answeredQuestionIds: ['q1', 'q2', 'q3'] } : {}),
      });
    }
    expect(nextActivity(version, session)).toEqual({ kind: 'blocked', reason: 'MASTERY_REQUIRED', knowledgePointIds: ['variables'] });
  });
});
