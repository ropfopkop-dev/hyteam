// Загрузка файлов игр любого размера по частям с докачкой.
// POST /uploads {name, size} → {id, chunk}; PUT /uploads/:id?offset=N — очередной кусок; GET — сколько уже принято.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { TMP_DIR, GAMES_DIR, MAX_GAME_MB, CHUNK_MB } from '../config.js';
import { one, all, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { fail, str } from '../util.js';

const r = Router();
export default r;

const CHUNK = CHUNK_MB * 1024 * 1024;
const STALE_MS = 24 * 3600 * 1000;
const busy = new Set();
const tmpPath = (id) => path.join(TMP_DIR, path.basename(id));

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

function drop(u) {
  run('DELETE FROM uploads WHERE id = ?', u.id);
  fs.rm(tmpPath(u.id), { force: true }, () => {});
}

function ownUpload(req) {
  const u = one('SELECT * FROM uploads WHERE id = ? AND user_id = ?', String(req.params.id), req.user.id);
  if (!u) fail(404, 'Загрузка не найдена — выберите файл заново');
  return u;
}

r.post('/uploads', requireAuth, (req, res) => {
  const name = str(req.body.name, { name: 'Имя файла', required: true, max: 255 });
  const size = Number(req.body.size);
  if (!Number.isSafeInteger(size) || size <= 0) fail(400, 'Некорректный размер файла');
  if (MAX_GAME_MB && size > MAX_GAME_MB * 1024 * 1024) fail(413, `Файл больше ${MAX_GAME_MB} МБ`);

  // Брошенные загрузки (закрыли страницу) не должны копиться: оставляем пользователю 4 последних.
  for (const old of all('SELECT * FROM uploads WHERE user_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET 4', req.user.id)) drop(old);

  const pending = all('SELECT size, received FROM uploads').reduce((s, u) => s + (u.size - u.received), 0);
  if (freeBytes(TMP_DIR) < size + pending + 512 * 1024 * 1024) fail(507, 'На сервере не хватает свободного места для этого файла');

  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(tmpPath(id), '');
  const t = Date.now();
  run('INSERT INTO uploads(id, user_id, name, size, received, created_at, updated_at) VALUES(?,?,?,?,0,?,?)', id, req.user.id, name, size, t, t);
  res.json({ id, chunk: CHUNK, received: 0 });
});

r.get('/uploads/:id', requireAuth, (req, res) => {
  const u = ownUpload(req);
  res.json({ id: u.id, size: u.size, received: u.received });
});

r.put('/uploads/:id', requireAuth, async (req, res) => {
  const u = ownUpload(req);
  const offset = Number(req.query.offset);
  if (busy.has(u.id) || offset !== u.received) return res.status(409).json({ error: 'Смещение не совпадает', received: u.received });
  const len = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(len) || len <= 0) fail(411, 'Нужен заголовок Content-Length');
  if (len > CHUNK + 1024) fail(413, 'Слишком большой кусок файла');
  if (offset + len > u.size) fail(400, 'Данных больше, чем размер файла');

  busy.add(u.id);
  try {
    await pipeline(req, fs.createWriteStream(tmpPath(u.id), { flags: 'r+', start: offset }));
  } catch {
    // Соединение оборвалось — сохраним то, что успело записаться, клиент докачает остальное.
  } finally {
    busy.delete(u.id);
  }
  const received = Math.min(fs.statSync(tmpPath(u.id)).size, u.size);
  run('UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?', received, Date.now(), u.id);
  if (received < offset + len) return res.status(409).json({ error: 'Кусок загрузился не полностью', received });
  res.json({ received });
});

r.delete('/uploads/:id', requireAuth, (req, res) => {
  drop(ownUpload(req));
  res.json({ ok: true });
});

/** Забирает полностью загруженный файл в хранилище игр. Возвращает { filename, name, size }. */
export function takeUpload(id, userId) {
  const u = one('SELECT * FROM uploads WHERE id = ? AND user_id = ?', String(id), userId);
  if (!u) fail(400, 'Файл игры не найден — загрузите его заново');
  if (u.received !== u.size) fail(400, 'Файл игры загружен не полностью');
  const ext = path.extname(u.name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12) || '.bin';
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  fs.renameSync(tmpPath(u.id), path.join(GAMES_DIR, filename));
  run('DELETE FROM uploads WHERE id = ?', u.id);
  return { filename, name: u.name, size: u.size };
}

export function cleanupStaleUploads() {
  for (const u of all('SELECT * FROM uploads WHERE updated_at < ?', Date.now() - STALE_MS)) drop(u);
  const known = new Set(all('SELECT id FROM uploads').map((u) => u.id));
  for (const f of fs.readdirSync(TMP_DIR)) {
    if (!known.has(f)) fs.rm(path.join(TMP_DIR, f), { force: true }, () => {});
  }
}
