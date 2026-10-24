import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, IMAGES_DIR, GAMES_DIR, TMP_DIR } from './config.js';

for (const dir of [DATA_DIR, IMAGES_DIR, GAMES_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'hyteam.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
// LIKE в SQLite не понимает регистр кириллицы, поэтому ищем через свою функцию.
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  banner TEXT,
  bio TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  short_desc TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT 'Другое',
  tags TEXT NOT NULL DEFAULT '',
  developer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  platform TEXT NOT NULL DEFAULT 'Windows',
  requirements TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  external_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS games_status ON games(status);
CREATE INDEX IF NOT EXISTS games_dev ON games(developer_id);

CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  last_download_at INTEGER,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_votes (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  image TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friends (
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  resolved_by INTEGER,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Версии игры: основная копируется в games.*, остальные можно скачать отдельно.
CREATE TABLE IF NOT EXISTS game_versions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  channel_manual INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  external_url TEXT,
  source TEXT NOT NULL DEFAULT 'file',
  status TEXT NOT NULL DEFAULT 'approved',
  reject_reason TEXT,
  want_main INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS game_versions_game ON game_versions(game_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Одноразовые коды из письма: подтверждение почты, вход (2FA), сброс пароля, включение защиты.
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  ticket TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_codes_user ON email_codes(user_id, purpose);

-- Устройства, на которых пользователь отметил «Запомнить» — там код при входе не спрашиваем.
CREATE TABLE IF NOT EXISTS trusted_devices (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY,
  moderator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`);

// Миграции для баз, созданных до появления новых колонок.
function addColumn(table, column, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('library', 'playtime', 'INTEGER NOT NULL DEFAULT 0');
addColumn('library', 'last_played_at', 'INTEGER');
// Источник файла игры: 'file' (загружен или по ссылке) или 'github' (последний релиз репозитория).
addColumn('games', 'source', "TEXT NOT NULL DEFAULT 'file'");
addColumn('games', 'launch_path', "TEXT NOT NULL DEFAULT ''");
addColumn('games', 'github_repo', 'TEXT');
addColumn('games', 'github_asset', "TEXT NOT NULL DEFAULT ''");
addColumn('games', 'github_prerelease', 'INTEGER NOT NULL DEFAULT 0');
addColumn('games', 'github_tag', 'TEXT');
addColumn('games', 'github_etag', 'TEXT');
addColumn('games', 'github_notes', "TEXT NOT NULL DEFAULT ''");
addColumn('games', 'github_checked_at', 'INTEGER');
addColumn('games', 'github_error', 'TEXT');
// Почта уже существующих аккаунтов считаем подтверждённой; новые подтверждают код из письма.
addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 1');
addColumn('users', 'twofa', 'INTEGER NOT NULL DEFAULT 0');
addColumn('games', 'main_version_id', 'INTEGER');
// Категория программы (для фильтра магазина), цена (₽, 0 — бесплатно), баланс пользователя.
addColumn('games', 'category', "TEXT NOT NULL DEFAULT ''");
addColumn('games', 'price', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'balance', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE TABLE IF NOT EXISTS purchases (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_by INTEGER,
  resolved_at INTEGER
);
`);
addColumn('games', 'channel', "TEXT NOT NULL DEFAULT 'stable'");

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
// node:sqlite не принимает undefined и boolean — приводим к допустимым значениям.
const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

export const one = (sql, ...p) => stmt(sql).get(...norm(p));
export const all = (sql, ...p) => stmt(sql).all(...norm(p));
export const run = (sql, ...p) => stmt(sql).run(...norm(p));

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
