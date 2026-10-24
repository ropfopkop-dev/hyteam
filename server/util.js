import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR, GAMES_DIR } from './config.js';
import { all, run } from './db.js';

export const GENRES = [
  'Экшен', 'Приключения', 'RPG', 'Стратегия', 'Шутер', 'Симулятор', 'Головоломка', 'Платформер',
  'Хоррор', 'Гонки', 'Спорт', 'Выживание', 'Песочница', 'Визуальная новелла', 'Казуальная', 'Аркада', 'Программа', 'Другое',
];
export const PLATFORMS = ['Windows', 'macOS', 'Linux', 'Android', 'Браузер', 'Кроссплатформенная'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function fail(status, message) {
  throw new HttpError(status, message);
}

export function str(value, { name = 'Поле', required = false, min = 0, max = 1000 } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (!s) {
    if (required) fail(400, `${name}: обязательное поле`);
    return '';
  }
  if (s.length < min) fail(400, `${name}: минимум ${min} симв.`);
  if (s.length > max) fail(400, `${name}: максимум ${max} симв.`);
  return s;
}
export function int(value, def = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : def;
}
export const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export function parseTags(value) {
  const out = [];
  const seen = new Set();
  for (const part of String(value ?? '').split(',')) {
    const t = part.trim().replace(/\s+/g, ' ').slice(0, 24);
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
    if (out.length === 10) break;
  }
  return out;
}
export const splitTags = (s) => (s ? s.split(',').filter(Boolean) : []);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const likeEsc = (s) => s.replace(/[\\%_]/g, '\\$&');

// busboy отдаёт имя файла в latin1 — восстанавливаем UTF-8 (кириллица в именах файлов).
export function fixName(name) {
  if (!name) return 'file';
  if (/[^\x00-\xff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export const mediaUrl = (file) => (file ? `/media/${file}` : null);
export function removeImage(file) {
  if (file) fs.rm(path.join(IMAGES_DIR, path.basename(file)), { force: true }, () => {});
}
export function removeGameFile(file) {
  if (file) fs.rm(path.join(GAMES_DIR, path.basename(file)), { force: true }, () => {});
}

export const isMod = (u) => !!u && (u.role === 'moderator' || u.role === 'admin');
export const isAdmin = (u) => !!u && u.role === 'admin';

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar: mediaUrl(u.avatar),
    role: u.role,
    online: !!u.last_seen && Date.now() - u.last_seen < 5 * 60e3,
  };
}
// Автор из строки JOIN-запроса (posts/reviews/comments + users).
export function author(r) {
  return publicUser({
    id: r.user_id, username: r.username, display_name: r.display_name,
    avatar: r.avatar, role: r.role, last_seen: r.last_seen,
  });
}

export function notify(userId, text, link = null) {
  run('INSERT INTO notifications(user_id, text, link, created_at) VALUES(?,?,?,?)', userId, text, link, Date.now());
}
export function notifyMods(text, link = '/mod') {
  for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin') AND banned = 0")) notify(m.id, text, link);
}
export function modLog(moderatorId, action, targetType, targetId, note = '') {
  run(
    'INSERT INTO mod_log(moderator_id, action, target_type, target_id, note, created_at) VALUES(?,?,?,?,?,?)',
    moderatorId, action, targetType, targetId, note, Date.now(),
  );
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
