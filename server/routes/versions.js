// Версии игр: список, добавление (файл любого размера или ссылка), метки, основная версия, модерация.
import { Router } from 'express';
import { one, all, run } from '../db.js';
import { requireAuth, requireMod } from '../auth.js';
import { canSee } from '../games.js';
import { takeUpload } from './uploads.js';
import { readDownloadUrl } from './games.js';
import { CHANNELS, applyMain, listVersions, versionOut, removeVersionFile } from '../versions.js';
import { fail, str, int, isMod, notify, notifyMods, modLog } from '../util.js';

const r = Router();
export default r;

const CHANNEL_NAMES = { stable: 'стабильная', beta: 'бета', alpha: 'альфа', rc: 'предрелиз', unstable: 'нестабильная', broken: 'нерабочая' };
const readChannel = (c) => (CHANNELS.includes(c) ? c : 'stable');

function editableGame(req, id) {
  const g = one('SELECT * FROM games WHERE id = ?', int(id));
  if (!g) fail(404, 'Игра не найдена');
  if (g.developer_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  return g;
}

function editableVersion(req) {
  const v = one('SELECT * FROM game_versions WHERE id = ?', int(req.params.vid));
  if (!v) fail(404, 'Версия не найдена');
  return { v, g: editableGame(req, v.game_id) };
}

function notifyOwners(g, v) {
  for (const o of all('SELECT user_id FROM library WHERE game_id = ? LIMIT 2000', g.id)) {
    notify(o.user_id, `Вышла версия ${v.version} «${g.title}» (${CHANNEL_NAMES[v.channel]})`, `/game/${g.id}?tab=versions`);
  }
}

r.get('/games/:id/versions', (req, res) => {
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g || !canSee(g, req.user)) fail(404, 'Игра не найдена');
  res.json(listVersions(g, req.user));
});

r.post('/games/:id/versions', requireAuth, (req, res) => {
  const g = editableGame(req, req.params.id);
  if (g.source === 'github') fail(400, 'Версии этой игры приходят с GitHub автоматически');
  const version = str(req.body.version, { name: 'Номер версии', required: true, max: 30 });
  const channel = readChannel(req.body.channel);
  const notes = str(req.body.notes, { name: 'Что нового', max: 20000 });
  const makeMain = !!req.body.make_main && channel !== 'broken';
  let file = null;
  let external = null;
  if (req.body.upload_id) file = takeUpload(req.body.upload_id, req.user.id);
  else external = readDownloadUrl(req.body.external_url);
  if (!file && !external) fail(400, 'Загрузите файл версии или укажите ссылку');

  // Новую версию обычного разработчика проверяет модератор, как и новую игру.
  const approved = isMod(req.user);
  const info = run(
    `INSERT INTO game_versions(game_id, version, channel, notes, file_path, file_name, file_size, external_url, source, status, want_main, created_by, created_at)
     VALUES(?,?,?,?,?,?,?,?,'file',?,?,?,?)`,
    g.id, version, channel, notes, file?.filename, file?.name, file?.size, external,
    approved ? 'approved' : 'pending', makeMain ? 1 : 0, req.user.id, Date.now(),
  );
  const vid = Number(info.lastInsertRowid);
  if (approved && makeMain) {
    applyMain(g.id, vid);
    if (g.status === 'approved') notifyOwners(g, one('SELECT * FROM game_versions WHERE id = ?', vid));
  }
  if (!approved) notifyMods(`Новая версия ${version} игры «${g.title}» ждёт проверки`, '/mod');
  res.json({ id: vid, status: approved ? 'approved' : 'pending' });
});

r.patch('/versions/:vid', requireAuth, (req, res) => {
  const { v, g } = editableVersion(req);
  const channel = req.body.channel !== undefined ? readChannel(req.body.channel) : v.channel;
  const notes = req.body.notes !== undefined ? str(req.body.notes, { name: 'Что нового', max: 20000 }) : v.notes;
  const version = req.body.version !== undefined && v.source !== 'github'
    ? str(req.body.version, { name: 'Номер версии', required: true, max: 30 })
    : v.version;
  run('UPDATE game_versions SET channel = ?, notes = ?, version = ?, channel_manual = 1 WHERE id = ?', channel, notes, version, v.id);
  if (v.id === g.main_version_id) {
    // Основную версию нельзя оставить «нерабочей» — подберём другую.
    if (channel === 'broken') pickNewMain(g, v.id);
    else applyMain(g.id, v.id);
  }
  res.json(versionOut(one('SELECT * FROM game_versions WHERE id = ?', v.id), one('SELECT * FROM games WHERE id = ?', g.id), req.user));
});

function pickNewMain(g, excludeId) {
  const next = one(
    `SELECT * FROM game_versions WHERE game_id = ? AND id <> ? AND status = 'approved' AND channel <> 'broken'
     ORDER BY (channel = 'stable') DESC, created_at DESC LIMIT 1`,
    g.id, excludeId,
  );
  if (next) applyMain(g.id, next.id);
  return next;
}

r.post('/versions/:vid/main', requireAuth, (req, res) => {
  const { v, g } = editableVersion(req);
  if (v.status !== 'approved') fail(400, 'Версия ещё не прошла проверку');
  if (v.channel === 'broken') fail(400, 'Нерабочую версию нельзя сделать основной');
  applyMain(g.id, v.id);
  if (g.status === 'approved' && v.id !== g.main_version_id) notifyOwners(g, v);
  res.json({ ok: true });
});

r.delete('/versions/:vid', requireAuth, (req, res) => {
  const { v, g } = editableVersion(req);
  if (v.id === g.main_version_id && !pickNewMain(g, v.id)) fail(400, 'Это единственная рабочая версия — её нельзя удалить');
  run('DELETE FROM game_versions WHERE id = ?', v.id);
  removeVersionFile(v);
  res.json({ ok: true });
});

// ---------- Модерация версий ----------

r.get('/mod/versions', requireAuth, requireMod, (req, res) => {
  const rows = all(
    `SELECT v.*, g.title AS game_title, g.developer_id, g.main_version_id, u.username, u.display_name
     FROM game_versions v JOIN games g ON g.id = v.game_id LEFT JOIN users u ON u.id = v.created_by
     WHERE v.status = 'pending' ORDER BY v.created_at ASC LIMIT 200`,
  );
  res.json(rows.map((v) => ({
    ...versionOut(v, { developer_id: v.developer_id, main_version_id: v.main_version_id }, req.user),
    game: { id: v.game_id, title: v.game_title },
    author: v.username ? { username: v.username, display_name: v.display_name } : null,
    want_main: !!v.want_main,
    external_url: v.external_url,
  })));
});

r.post('/mod/versions/:vid/approve', requireAuth, requireMod, (req, res) => {
  const v = one('SELECT * FROM game_versions WHERE id = ?', int(req.params.vid));
  if (!v) fail(404, 'Версия не найдена');
  const g = one('SELECT * FROM games WHERE id = ?', v.game_id);
  run("UPDATE game_versions SET status = 'approved', reject_reason = NULL WHERE id = ?", v.id);
  if (v.want_main && v.channel !== 'broken') {
    applyMain(g.id, v.id);
    if (g.status === 'approved') notifyOwners(g, v);
  }
  notify(g.developer_id, `Версия ${v.version} «${g.title}» прошла проверку`, `/game/${g.id}?tab=versions`);
  modLog(req.user.id, 'approve', 'game', g.id, `${g.title} ${v.version}`);
  res.json({ ok: true });
});

r.post('/mod/versions/:vid/reject', requireAuth, requireMod, (req, res) => {
  const v = one('SELECT * FROM game_versions WHERE id = ?', int(req.params.vid));
  if (!v) fail(404, 'Версия не найдена');
  const g = one('SELECT * FROM games WHERE id = ?', v.game_id);
  const reason = str(req.body.reason, { name: 'Причина', required: true, max: 500 });
  run("UPDATE game_versions SET status = 'rejected', reject_reason = ? WHERE id = ?", reason, v.id);
  notify(g.developer_id, `Версия ${v.version} «${g.title}» отклонена: ${reason}`, `/game/${g.id}?tab=versions`);
  modLog(req.user.id, 'reject', 'game', g.id, `${g.title} ${v.version}: ${reason}`);
  res.json({ ok: true });
});

