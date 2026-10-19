export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS textbooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chapter_tree_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id),
  chapter_id TEXT NOT NULL,
  content TEXT NOT NULL,
  anchor TEXT NOT NULL,
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id),
  title TEXT NOT NULL,
  chapter_ref TEXT NOT NULL,
  mastery_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'locked',
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  from_id TEXT NOT NULL REFERENCES knowledge_points(id),
  to_id TEXT NOT NULL REFERENCES knowledge_points(id),
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  textbook_id TEXT NOT NULL REFERENCES textbooks(id),
  goal TEXT NOT NULL,
  goal_prompt TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  mode INTEGER NOT NULL,
  outline_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id),
  content_mdx TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  content_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  source_kp_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  user_answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id),
  content_md TEXT NOT NULL,
  obsidian_path TEXT
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  subject_type TEXT,
  name TEXT NOT NULL,
  content_md TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
