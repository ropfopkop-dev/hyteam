import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { GAMES_DIR } from '../config.js';
import { one, all, run, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { gameUpload, withCleanup, checkImageSizes } from '../upload.js';
import { GAMES, SORTS, gameOut, userSets, getGame, canSee } from '../games.js';
import { recommendFor, similarTo } from '../recommend.js';
import { githubPreview, syncGame, fetchGithubCover, getGameRow } from '../github.js';
import { takeUpload } from './uploads.js';
import { syncMainFromGame } from '../versions.js';
import { GROUPS } from '../catalog.js';
import { ownsPaid } from './payments.js';
import {
  GENRES, PLATFORMS, fail, str, int, clamp, parseTags, likeEsc, fixName, mediaUrl, isMod,
  notify, notifyMods, modLog, removeImage, removeGameFile, author,
} from '../util.js';

const r = Router();
export default r;

const MAX_SHOTS = 12;

function findGames({ q, genre, tag, category, sort, limit, offset }, user) {
  const where = ["g.status = 'approved'"];
  const p = [];
  if (q) {
    const like = `%${likeEsc(q.toLowerCase())}%`;
    where.push(`(ulower(g.title) LIKE ? ESCAPE '\\' OR ulower(g.tags) LIKE ? ESCAPE '\\'
      OR ulower(g.short_desc) LIKE ? ESCAPE '\\' OR ulower(g.dev_name) LIKE ? ESCAPE '\\')`);
    p.push(like, like, like, like);
  }
  if (genre) {
    where.push('g.genre = ?');
    p.push(genre);
  }
  if (category) {
    where.push('g.category = ?');
    p.push(category);
  }
  if (tag) {
    where.push(`(',' || ulower(g.tags) || ',') LIKE ? ESCAPE '\\'`);
    p.push(`%,${likeEsc(tag.toLowerCase())},%`);
  }
  const w = where.join(' AND ');
  const total = one(`SELECT COUNT(*) AS c FROM (${GAMES} WHERE ${w})`, ...p).c;
  const rows = all(`${GAMES} WHERE ${w} ORDER BY ${SORTS[sort] || SORTS.popular} LIMIT ? OFFSET ?`, ...p, limit, offset);
  const sets = userSets(user);
  return { total, items: rows.map((g) => gameOut(g, sets)) };
}

r.get('/games', (req, res) => {
  res.json(findGames({
    q: str(req.query.q, { max: 100 }),
    genre: str(req.query.genre, { max: 40 }),
    tag: str(req.query.tag, { max: 24 }),
    category: str(req.query.category, { max: 60 }),
    sort: String(req.query.sort || 'popular'),
    limit: clamp(int(req.query.limit, 24), 1, 60),
    offset: Math.max(int(req.query.offset, 0), 0),
  }, req.user));
});

r.get('/home', (req, res) => {
  const sets = userSets(req.user);
  const take = (order, n, extra = '') =>
    all(`${GAMES} WHERE g.status = 'approved' ${extra} ORDER BY ${order} LIMIT ?`, n).map((g) => gameOut(g, sets));
  let featured = take(SORTS.new, 5, 'AND g.featured = 1');
  if (!featured.length) featured = take(SORTS.popular, 3);
  res.json({
    featured,
    popular: take(SORTS.popular, 12),
    fresh: take(SORTS.new, 12),
    top: take(SORTS.rating, 12, 'AND g.reviews_count > 0'),
    recommended: req.user ? recommendFor(req.user, 12).map((x) => ({ ...gameOut(x.game, sets), reason: x.reason })) : [],
    stats: {
      games: one("SELECT COUNT(*) AS c FROM games WHERE status = 'approved'").c,
      users: one('SELECT COUNT(*) AS c FROM users').c,
    },
  });
});

// Бесплатные программы, которые качаются не с нашего сервера (GitHub, сайт производителя).
// Программа HYTEAM сохраняет этот список и ставит их, даже когда сервер выключен.
r.get('/offline-catalog', (_req, res) => {
  res.json(all(
    `SELECT id, title, version, short_desc, category, genre, launch_path AS launch, external_url AS url
     FROM games WHERE status = 'approved' AND price = 0 AND file_path IS NULL AND external_url IS NOT NULL
     ORDER BY category, title COLLATE NOCASE`,
  ));
});

r.get('/categories', (_req, res) => {
  res.json(all("SELECT category, COUNT(*) AS count FROM games WHERE status = 'approved' AND category <> '' GROUP BY category"));
});

r.get('/genres', (_req, res) => {
  res.json(all("SELECT genre, COUNT(*) AS count FROM games WHERE status = 'approved' GROUP BY genre ORDER BY count DESC"));
});

r.get('/recommendations', (req, res) => {
  const sets = userSets(req.user);
  res.json(recommendFor(req.user, clamp(int(req.query.limit, 12), 1, 40)).map((x) => ({ ...gameOut(x.game, sets), reason: x.reason })));
});

r.get('/games/:id', (req, res) => {
  const g = getGame(req.params.id);
  if (!g || !canSee(g, req.user)) fail(404, 'Игра не найдена');
  const sets = userSets(req.user);
  const out = gameOut(g, sets, { full: true, viewer: req.user });
  out.screenshots = all('SELECT id, path FROM screenshots WHERE game_id = ? ORDER BY sort, id', g.id)
    .map((s) => ({ id: s.id, url: mediaUrl(s.path) }));
  out.similar = similarTo(g, 6).map((x) => gameOut(x, sets));
  out.more_from_dev = all(
    `${GAMES} WHERE g.status = 'approved' AND g.developer_id = ? AND g.id <> ? ORDER BY ${SORTS.popular} LIMIT 4`,
    g.developer_id, g.id,
  ).map((x) => gameOut(x, sets));
  res.json(out);
});

// ---------- Публикация и редактирование ----------

// Ссылки-переходники соцсетей и поисковиков (vk.ru/away.php?to=…) заменяем настоящим адресом файла.
const LINK_WRAPPERS = [
  { host: /(^|\.)vk\.(com|ru)$/i, path: /^\/away\.php$/i, param: 'to' },
  { host: /(^|\.)facebook\.com$/i, path: /^\/l\.php$/i, param: 'u' },
  { host: /(^|\.)google\.[a-z.]+$/i, path: /^\/url$/i, param: 'q' },
];

export function unwrapLink(href) {
  let url = new URL(href);
  for (let i = 0; i < 3; i++) {
    const w = LINK_WRAPPERS.find((x) => x.host.test(url.hostname) && x.path.test(url.pathname) && url.searchParams.get(x.param));
    if (!w) break;
    url = new URL(url.searchParams.get(w.param));
  }
  return url.href;
}

export function readDownloadUrl(value) {
  const s = str(value, { name: 'Ссылка на скачивание', max: 2000 });
  if (!s) return null;
  let href = null;
  try {
    href = unwrapLink(s);
  } catch {
    href = null;
  }
  if (!href || !/^https?:\/\//i.test(href)) fail(400, 'Ссылка на скачивание должна начинаться с http:// или https://');
  if (href.length > 1000) fail(400, 'Ссылка на скачивание слишком длинная');
  return href;
}

function readGameFields(body) {
  return {
    title: str(body.title, { name: 'Название', required: true, min: 2, max: 80 }),
    short_desc: str(body.short_desc, { name: 'Краткое описание', max: 300 }),
    description: str(body.description, { name: 'Описание', max: 20000 }),
    genre: GENRES.includes(body.genre) ? body.genre : 'Другое',
    tags: parseTags(body.tags).join(','),
    version: str(body.version, { name: 'Версия', max: 30 }) || '1.0',
    platform: PLATFORMS.includes(body.platform) ? body.platform : 'Windows',
    requirements: str(body.requirements, { name: 'Системные требования', max: 3000 }),
    launch_path: str(body.launch_path, { name: 'Файл запуска', max: 200 }).replace(/\\/g, '/'),
    category: GROUPS.includes(body.category) ? body.category : '',
    price: clamp(int(body.price, 0), 0, 1000000),
  };
}

/**
 * Откуда берётся файл игры: загруженный файл (целиком или по частям), внешняя ссылка или релиз GitHub.
 * prev — текущая запись игры при редактировании.
 */
async function readSource(req, prev) {
  const b = req.body;
  const kind = ['file', 'link', 'github'].includes(b.source)
    ? b.source
    : b.github_repo ? 'github' : b.external_url && !b.upload_id && !req.files?.gamefile ? 'link' : 'file';
  if (kind === 'github') {
    const preview = await githubPreview(b.github_repo, b.github_prerelease === '1');
    return {
      source: 'github',
      github_repo: preview.repo,
      github_asset: str(b.github_asset, { name: 'Файл релиза', max: 200 }),
      github_prerelease: b.github_prerelease === '1' ? 1 : 0,
      external_url: prev?.source === 'github' ? prev.external_url : null,
      file: null,
      preview,
    };
  }
  const base = { source: 'file', github_repo: null, github_asset: '', github_prerelease: 0 };
  if (kind === 'link') {
    const url = readDownloadUrl(b.external_url);
    if (!url) fail(400, 'Укажите ссылку на скачивание');
    return { ...base, external_url: url, file: null };
  }
  const multi = req.files?.gamefile?.[0];
  let file = null;
  if (b.upload_id) file = { ...takeUpload(b.upload_id, req.user.id), taken: true };
  else if (multi) file = { filename: multi.filename, name: fixName(multi.originalname), size: multi.size };
  if (!file && !prev?.file_path) fail(400, 'Загрузите файл игры');
  return { ...base, external_url: null, file };
}

r.post('/games', requireAuth, gameUpload, withCleanup(async (req, res) => {
  checkImageSizes(req);
  const f = readGameFields(req.body);
  const src = await readSource(req, null);
  const files = req.files || {};
  const mod = isMod(req.user);
  const t = Date.now();
  let cover = files.cover?.[0]?.filename ?? null;
  let id = null;
  try {
    if (!cover && src.source === 'github') cover = await fetchGithubCover(src.github_repo);
    id = tx(() => {
      const info = run(
        `INSERT INTO games(title, short_desc, description, genre, tags, developer_id, cover, version, platform, requirements,
          launch_path, file_path, file_name, file_size, external_url, source, github_repo, github_asset, github_prerelease,
          status, created_at, updated_at, published_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        f.title, f.short_desc, f.description, f.genre, f.tags, req.user.id, cover,
        src.source === 'github' ? src.preview.release.tag.slice(0, 30) : f.version, f.platform, f.requirements,
        f.launch_path, src.file?.filename, src.file?.name, src.file?.size, src.external_url,
        src.source, src.github_repo, src.github_asset, src.github_prerelease,
        mod ? 'approved' : 'pending', t, t, mod ? t : null,
      );
      const gid = Number(info.lastInsertRowid);
      (files.screenshots || []).forEach((s, i) => run('INSERT INTO screenshots(game_id, path, sort) VALUES(?,?,?)', gid, s.filename, i));
      run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', req.user.id, gid, t);
      run('UPDATE games SET category = ?, price = ? WHERE id = ?', f.category, f.price, gid);
      return gid;
    });
    if (src.source === 'github') await syncGame(getGameRow(id), { force: true });
    else syncMainFromGame(id, req.user.id);
  } catch (e) {
    if (id) deleteGame(getGameRow(id));
    else {
      if (src.file?.taken) removeGameFile(src.file.filename);
      if (cover && !files.cover) removeImage(cover);
    }
    throw e;
  }
  if (!mod) notifyMods(`Новая игра на модерации: «${f.title}» от ${req.user.display_name}`);
  res.json({ id, status: mod ? 'approved' : 'pending' });
}));

r.put('/games/:id', requireAuth, gameUpload, withCleanup(async (req, res) => {
  checkImageSizes(req);
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g) fail(404, 'Игра не найдена');
  const mod = isMod(req.user);
  if (g.developer_id !== req.user.id && !mod) fail(403, 'Нет доступа');

  const f = readGameFields(req.body);
  const files = req.files || {};
  const newCover = files.cover?.[0];
  const shots = files.screenshots || [];
  const shotCount = one('SELECT COUNT(*) AS c FROM screenshots WHERE game_id = ?', g.id).c;
  if (shotCount + shots.length > MAX_SHOTS) fail(400, `Не больше ${MAX_SHOTS} скриншотов`);

  const src = await readSource(req, g);
  let { file_path: filePath, file_name: fileName, file_size: fileSize } = g;
  if (src.file) {
    filePath = src.file.filename;
    fileName = src.file.name;
    fileSize = src.file.size;
  } else if (src.source === 'github' || src.external_url) {
    filePath = null;
    if (src.source !== 'github') fileName = fileSize = null;
  }
  const githubChanged = src.source === 'github' && (g.source !== 'github' || src.github_repo !== g.github_repo
    || src.github_asset !== g.github_asset || src.github_prerelease !== g.github_prerelease);
  const version = src.source === 'github' ? (g.source === 'github' ? g.version : src.preview.release.tag.slice(0, 30)) : f.version;

  // Смена источника (другой репозиторий или уход с GitHub) — старые версии из GitHub больше не относятся к игре.
  if (g.source === 'github' && (src.source !== 'github' || githubChanged)) {
    run("DELETE FROM game_versions WHERE game_id = ? AND source = 'github'", g.id);
    run('UPDATE games SET main_version_id = NULL WHERE id = ?', g.id);
  }

  // Правки обычного разработчика уходят на повторную проверку, правки модератора — нет.
  const status = mod ? g.status : 'pending';
  tx(() => {
    run(
      `UPDATE games SET title=?, short_desc=?, description=?, genre=?, tags=?, version=?, platform=?, requirements=?,
        launch_path=?, external_url=?, cover=COALESCE(?, cover), file_path=?, file_name=?, file_size=?,
        source=?, github_repo=?, github_asset=?, github_prerelease=?,
        github_etag = CASE WHEN ? = 1 THEN NULL ELSE github_etag END,
        github_tag = CASE WHEN ? = 1 THEN NULL ELSE github_tag END,
        status=?, reject_reason = CASE WHEN ? = 'pending' THEN NULL ELSE reject_reason END, updated_at=?
       WHERE id=?`,
      f.title, f.short_desc, f.description, f.genre, f.tags, version, f.platform, f.requirements,
      f.launch_path, src.external_url, newCover?.filename, filePath, fileName, fileSize,
      src.source, src.github_repo, src.github_asset, src.github_prerelease,
      githubChanged ? 1 : 0, githubChanged ? 1 : 0,
      status, status, Date.now(), g.id,
    );
    run('UPDATE games SET category = ?, price = ? WHERE id = ?', f.category, f.price, g.id);
    const base = one('SELECT COALESCE(MAX(sort), 0) AS m FROM screenshots WHERE game_id = ?', g.id).m;
    shots.forEach((s, i) => run('INSERT INTO screenshots(game_id, path, sort) VALUES(?,?,?)', g.id, s.filename, base + i + 1));
  });
  if (src.source !== 'github') syncMainFromGame(g.id, req.user.id);
  if (newCover && g.cover) removeImage(g.cover);
  if (g.file_path && g.file_path !== filePath && !one('SELECT 1 FROM game_versions WHERE file_path = ?', g.file_path)) removeGameFile(g.file_path);
  let warning = null;
  if (githubChanged) {
    try {
      await syncGame(getGameRow(g.id), { force: true });
    } catch (e) {
      warning = e.message;
    }
  }
  if (status === 'pending' && g.status !== 'pending') notifyMods(`Игра «${f.title}» обновлена и ждёт повторной проверки`);
  res.json({ id: g.id, status, warning });
}));

// ---------- GitHub ----------

r.get('/github/preview', requireAuth, async (req, res) => {
  res.json(await githubPreview(req.query.repo, req.query.prerelease === '1'));
});

r.post('/games/:id/github/sync', requireAuth, async (req, res) => {
  const g = getGameRow(int(req.params.id));
  if (!g || g.source !== 'github') fail(404, 'Игра не подключена к GitHub');
  if (g.developer_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  const r2 = await syncGame(g);
  res.json(r2);
});

r.delete('/games/:id/screenshots/:sid', requireAuth, (req, res) => {
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g) fail(404, 'Игра не найдена');
  if (g.developer_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  const s = one('SELECT * FROM screenshots WHERE id = ? AND game_id = ?', int(req.params.sid), g.id);
  if (!s) fail(404, 'Скриншот не найден');
  run('DELETE FROM screenshots WHERE id = ?', s.id);
  removeImage(s.path);
  res.json({ ok: true });
});

export function deleteGame(g) {
  const shots = all('SELECT path FROM screenshots WHERE game_id = ?', g.id);
  const files = all('SELECT file_path FROM game_versions WHERE game_id = ? AND file_path IS NOT NULL', g.id);
  run('DELETE FROM games WHERE id = ?', g.id);
  removeImage(g.cover);
  removeGameFile(g.file_path);
  for (const f of files) removeGameFile(f.file_path);
  for (const s of shots) removeImage(s.path);
}

r.delete('/games/:id', requireAuth, (req, res) => {
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g) fail(404, 'Игра не найдена');
  const own = g.developer_id === req.user.id;
  if (!own && !isMod(req.user)) fail(403, 'Нет доступа');
  deleteGame(g);
  if (!own) {
    modLog(req.user.id, 'delete', 'game', g.id, g.title);
    notify(g.developer_id, `Модератор удалил вашу игру «${g.title}»`, '/dev');
  }
  res.json({ ok: true });
});

// ---------- Скачивание, библиотека, избранное ----------

r.get('/games/:id/download', requireAuth, (req, res) => {
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g) fail(404, 'Игра не найдена');
  const privileged = g.developer_id === req.user.id || isMod(req.user);
  if (g.status !== 'approved' && !privileged) fail(403, 'Игра ещё не прошла модерацию');
  if (!ownsPaid(g, req.user)) fail(402, `Это платная игра (${g.price} ₽) — сначала купите её`);
  // ?v=id — конкретная версия (бета, старая и т. д.), без него — основная.
  const vid = int(req.query.v, 0);
  let target = g;
  if (vid) {
    target = one('SELECT * FROM game_versions WHERE id = ? AND game_id = ?', vid, g.id);
    if (!target) fail(404, 'Версия не найдена');
    if (target.status !== 'approved' && !privileged) fail(403, 'Эта версия ещё не прошла проверку');
  }
  if (g.status === 'approved') {
    const t = Date.now();
    run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', req.user.id, g.id, t);
    run('UPDATE library SET last_download_at = ? WHERE user_id = ? AND game_id = ?', t, req.user.id, g.id);
    run('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?', req.user.id, g.id);
    run('UPDATE games SET downloads = downloads + 1 WHERE id = ?', g.id);
    const countId = vid || g.main_version_id;
    if (countId) run('UPDATE game_versions SET downloads = downloads + 1 WHERE id = ?', countId);
  }
  if (target.file_path) {
    const abs = path.join(GAMES_DIR, path.basename(target.file_path));
    if (!fs.existsSync(abs)) fail(404, 'Файл игры не найден на сервере');
    return res.download(abs, target.file_name || `game-${g.id}`);
  }
  if (target.external_url) return res.redirect(target.external_url);
  fail(404, g.source === 'github' ? 'Файл ещё не получен с GitHub — попробуйте через пару минут' : 'У игры нет файла для скачивания');
});

function approvedGame(id) {
  const g = one('SELECT id, status, developer_id, title FROM games WHERE id = ?', int(id));
  if (!g || g.status !== 'approved') fail(404, 'Игра недоступна');
  return g;
}

r.post('/games/:id/library', requireAuth, (req, res) => {
  const g = approvedGame(req.params.id);
  if (!ownsPaid(one('SELECT * FROM games WHERE id = ?', g.id), req.user)) fail(402, 'Это платная игра — сначала купите её');
  run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', req.user.id, g.id, Date.now());
  run('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?', req.user.id, g.id);
  res.json({ ok: true });
});

r.delete('/games/:id/library', requireAuth, (req, res) => {
  run('DELETE FROM library WHERE user_id = ? AND game_id = ?', req.user.id, int(req.params.id));
  res.json({ ok: true });
});

r.post('/games/:id/wishlist', requireAuth, (req, res) => {
  const g = approvedGame(req.params.id);
  run('INSERT OR IGNORE INTO wishlist(user_id, game_id, added_at) VALUES(?,?,?)', req.user.id, g.id, Date.now());
  res.json({ ok: true });
});

r.delete('/games/:id/wishlist', requireAuth, (req, res) => {
  run('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?', req.user.id, int(req.params.id));
  res.json({ ok: true });
});

r.get('/library', requireAuth, (req, res) => {
  const sets = userSets(req.user);
  const rows = all(
    `${GAMES} JOIN library l ON l.game_id = g.id AND l.user_id = ?
     ORDER BY MAX(COALESCE(l.last_played_at, 0), COALESCE(l.last_download_at, 0), l.added_at) DESC`,
    req.user.id,
  );
  res.json(rows.map((g) => ({
    ...gameOut(g, sets, { full: true, viewer: req.user }),
    added_at: g.added_at,
    last_download_at: g.last_download_at,
    playtime: g.playtime,
    last_played_at: g.last_played_at,
    update_available: !!g.last_download_at && g.updated_at > g.last_download_at,
    available: g.status === 'approved' || g.developer_id === req.user.id,
  })));
});

// Лёгкий список версий для автообновления игр в десктоп-клиенте.
r.get('/library/versions', requireAuth, (req, res) => {
  res.json(all(
    `SELECT g.id, g.title, g.version, g.launch_path AS launch,
       (g.file_path IS NULL AND g.external_url IS NOT NULL AND g.source <> 'github') AS external
     FROM library l JOIN games g ON g.id = l.game_id WHERE l.user_id = ? AND g.status = 'approved'`,
    req.user.id,
  ).map((x) => ({ ...x, external: !!x.external })));
});

// Десктоп-клиент сообщает, сколько минут длилась игровая сессия.
r.post('/games/:id/playtime', requireAuth, (req, res) => {
  const gid = int(req.params.id);
  const minutes = clamp(int(req.body.minutes), 0, 24 * 60);
  const info = run(
    'UPDATE library SET playtime = playtime + ?, last_played_at = ? WHERE user_id = ? AND game_id = ?',
    minutes, Date.now(), req.user.id, gid,
  );
  if (!info.changes) fail(404, 'Игры нет в вашей библиотеке');
  res.json({ playtime: one('SELECT playtime FROM library WHERE user_id = ? AND game_id = ?', req.user.id, gid).playtime });
});

r.get('/wishlist', requireAuth, (req, res) => {
  const sets = userSets(req.user);
  const rows = all(
    `${GAMES} JOIN wishlist w ON w.game_id = g.id AND w.user_id = ? WHERE g.status = 'approved' ORDER BY w.added_at DESC`,
    req.user.id,
  );
  res.json(rows.map((g) => gameOut(g, sets)));
});

r.get('/me/games', requireAuth, (req, res) => {
  const sets = userSets(req.user);
  const rows = all(`${GAMES} WHERE g.developer_id = ? ORDER BY g.updated_at DESC`, req.user.id);
  res.json(rows.map((g) => gameOut(g, sets, { full: true, viewer: req.user })));
});

// ---------- Отзывы ----------

function reviewOut(row, viewer) {
  return {
    id: row.id,
    game_id: row.game_id,
    rating: row.rating,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    helpful: row.helpful ?? 0,
    voted: !!row.voted,
    user_games: row.user_games ?? 0,
    user: author(row),
    can_delete: !!viewer && (viewer.id === row.user_id || isMod(viewer)),
  };
}

const REVIEW_SELECT = (viewerId) => `SELECT r.*, u.username, u.display_name, u.avatar, u.role, u.last_seen,
  (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id) AS helpful,
  (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id AND v.user_id = ${Number(viewerId) || 0}) AS voted,
  (SELECT COUNT(*) FROM library l WHERE l.user_id = r.user_id) AS user_games
  FROM reviews r JOIN users u ON u.id = r.user_id`;

r.get('/games/:id/reviews', (req, res) => {
  const gid = int(req.params.id);
  const viewerId = req.user?.id;
  const order = req.query.sort === 'new' ? 'r.created_at DESC' : 'helpful DESC, r.created_at DESC';
  const rows = all(`${REVIEW_SELECT(viewerId)} WHERE r.game_id = ? ORDER BY ${order} LIMIT 50`, gid);
  const summary = one('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE game_id = ?', gid);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of all('SELECT rating, COUNT(*) AS c FROM reviews WHERE game_id = ? GROUP BY rating', gid)) dist[d.rating] = d.c;
  const mine = viewerId ? one(`${REVIEW_SELECT(viewerId)} WHERE r.game_id = ? AND r.user_id = ?`, gid, viewerId) : null;
  res.json({
    summary: { count: summary.count, avg: summary.avg == null ? null : Number(summary.avg), dist },
    reviews: rows.map((x) => reviewOut(x, req.user)),
    mine: mine ? reviewOut(mine, req.user) : null,
  });
});

r.post('/games/:id/reviews', requireAuth, (req, res) => {
  const g = approvedGame(req.params.id);
  if (g.developer_id === req.user.id) fail(400, 'Нельзя оценивать собственную игру');
  if (!one('SELECT 1 FROM library WHERE user_id = ? AND game_id = ?', req.user.id, g.id)) {
    fail(403, 'Отзыв можно оставить только на игру из вашей библиотеки');
  }
  const rating = int(req.body.rating);
  if (rating < 1 || rating > 5) fail(400, 'Поставьте оценку от 1 до 5');
  const body = str(req.body.body, { name: 'Отзыв', max: 5000 });
  const existed = one('SELECT id FROM reviews WHERE game_id = ? AND user_id = ?', g.id, req.user.id);
  const t = Date.now();
  run(
    `INSERT INTO reviews(game_id, user_id, rating, body, created_at, updated_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(game_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = excluded.updated_at`,
    g.id, req.user.id, rating, body, t, t,
  );
  if (!existed) notify(g.developer_id, `${req.user.display_name} оценил(а) «${g.title}» на ${rating}★`, `/game/${g.id}?tab=reviews`);
  res.json({ ok: true });
});

r.delete('/reviews/:id', requireAuth, (req, res) => {
  const rev = one('SELECT * FROM reviews WHERE id = ?', int(req.params.id));
  if (!rev) fail(404, 'Отзыв не найден');
  if (rev.user_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  run('DELETE FROM reviews WHERE id = ?', rev.id);
  if (rev.user_id !== req.user.id) modLog(req.user.id, 'delete', 'review', rev.id, rev.body.slice(0, 120));
  res.json({ ok: true });
});

r.post('/reviews/:id/helpful', requireAuth, (req, res) => {
  const rev = one('SELECT * FROM reviews WHERE id = ?', int(req.params.id));
  if (!rev) fail(404, 'Отзыв не найден');
  if (rev.user_id === req.user.id) fail(400, 'Нельзя голосовать за свой отзыв');
  const voted = one('SELECT 1 FROM review_votes WHERE review_id = ? AND user_id = ?', rev.id, req.user.id);
  if (voted) run('DELETE FROM review_votes WHERE review_id = ? AND user_id = ?', rev.id, req.user.id);
  else run('INSERT INTO review_votes(review_id, user_id) VALUES(?,?)', rev.id, req.user.id);
  const helpful = one('SELECT COUNT(*) AS c FROM review_votes WHERE review_id = ?', rev.id).c;
  res.json({ voted: !voted, helpful });
});
