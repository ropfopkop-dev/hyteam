import { Router } from 'express';
import { one, all, run } from '../db.js';
import { requireMod } from '../auth.js';
import { GAMES, gameOut, userSets } from '../games.js';
import { deleteGame, unwrapLink } from './games.js';
import { catalogList, addFromCatalog } from '../catalog.js';
import { deletePost } from './community.js';
import { fail, str, int, likeEsc, mediaUrl, publicUser, isAdmin, notify, modLog } from '../util.js';
import { mailConfig, mailEnabled, mailFromEnv, saveMailConfig, sendMail, codeEmail } from '../mail.js';

const r = Router();
export default r;
r.use(requireMod);

const ROLES = ['user', 'moderator', 'admin'];

r.get('/overview', (_req, res) => {
  const c = (sql) => one(sql).c;
  res.json({
    pending: c("SELECT COUNT(*) AS c FROM games WHERE status = 'pending'") + c("SELECT COUNT(*) AS c FROM game_versions WHERE status = 'pending'"),
    reports: c("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    games: c("SELECT COUNT(*) AS c FROM games WHERE status = 'approved'"),
    users: c('SELECT COUNT(*) AS c FROM users'),
    banned: c('SELECT COUNT(*) AS c FROM users WHERE banned = 1'),
  });
});

r.get('/games', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const order = status === 'pending' ? 'g.updated_at ASC' : 'g.updated_at DESC';
  const sets = userSets(req.user);
  const rows = all(`${GAMES} WHERE g.status = ? ORDER BY ${order} LIMIT 200`, status);
  res.json(rows.map((g) => ({
    ...gameOut(g, sets, { full: true, viewer: req.user }),
    screenshots: all('SELECT id, path FROM screenshots WHERE game_id = ? ORDER BY sort, id', g.id)
      .map((s) => ({ id: s.id, url: mediaUrl(s.path) })),
  })));
});

function gameOr404(id) {
  const g = one('SELECT * FROM games WHERE id = ?', int(id));
  if (!g) fail(404, 'Игра не найдена');
  return g;
}

r.post('/games/:id/approve', (req, res) => {
  const g = gameOr404(req.params.id);
  run("UPDATE games SET status = 'approved', reject_reason = NULL, published_at = COALESCE(published_at, ?) WHERE id = ?", Date.now(), g.id);
  run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', g.developer_id, g.id, Date.now());
  notify(g.developer_id, `Игра «${g.title}» прошла модерацию и опубликована`, `/game/${g.id}`);
  modLog(req.user.id, 'approve', 'game', g.id, g.title);
  res.json({ ok: true });
});

r.post('/games/:id/reject', (req, res) => {
  const g = gameOr404(req.params.id);
  const reason = str(req.body.reason, { name: 'Причина', required: true, max: 500 });
  run("UPDATE games SET status = 'rejected', reject_reason = ?, featured = 0 WHERE id = ?", reason, g.id);
  notify(g.developer_id, `Игра «${g.title}» отклонена: ${reason}`, `/game/${g.id}`);
  modLog(req.user.id, 'reject', 'game', g.id, `${g.title}: ${reason}`);
  res.json({ ok: true });
});

r.post('/games/:id/feature', (req, res) => {
  const g = gameOr404(req.params.id);
  if (g.status !== 'approved') fail(400, 'В подборку можно добавить только опубликованную игру');
  run('UPDATE games SET featured = ? WHERE id = ?', g.featured ? 0 : 1, g.id);
  modLog(req.user.id, g.featured ? 'unfeature' : 'feature', 'game', g.id, g.title);
  res.json({ featured: !g.featured });
});

// ---------- Жалобы ----------

function reportTarget(type, id) {
  if (type === 'game') {
    const g = one('SELECT id, title, developer_id FROM games WHERE id = ?', id);
    return g && { text: g.title, link: `/game/${g.id}` };
  }
  if (type === 'review') {
    const x = one('SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?', id);
    return x && { text: `@${x.username} · ${x.rating}★ · ${x.body || '(без текста)'}`, link: `/game/${x.game_id}?tab=reviews` };
  }
  if (type === 'post') {
    const x = one('SELECT p.*, u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', id);
    return x && { text: `@${x.username}: ${x.title ? `${x.title} — ` : ''}${x.body}`, link: `/post/${x.id}` };
  }
  if (type === 'comment') {
    const x = one('SELECT c.*, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', id);
    return x && { text: `@${x.username}: ${x.body}`, link: `/post/${x.post_id}` };
  }
  if (type === 'user') {
    const x = one('SELECT id, username, display_name FROM users WHERE id = ?', id);
    return x && { text: `${x.display_name} (@${x.username})`, link: `/u/${x.username}` };
  }
  return null;
}

r.get('/reports', (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const rows = all(
    `SELECT rp.*, u.username, u.display_name FROM reports rp JOIN users u ON u.id = rp.reporter_id
     WHERE rp.status = ? ORDER BY rp.created_at DESC LIMIT 200`,
    status,
  );
  res.json(rows.map((x) => ({
    id: x.id,
    target_type: x.target_type,
    target_id: x.target_id,
    reason: x.reason,
    created_at: x.created_at,
    reporter: { username: x.username, display_name: x.display_name },
    target: reportTarget(x.target_type, x.target_id),
  })));
});

function banUser(moderator, target, banned, note = '') {
  if (target.id === moderator.id) fail(400, 'Нельзя заблокировать себя');
  if (!isAdmin(moderator) && target.role !== 'user') fail(403, 'Модератор не может блокировать модераторов и администраторов');
  run('UPDATE users SET banned = ? WHERE id = ?', banned ? 1 : 0, target.id);
  if (banned) run('DELETE FROM sessions WHERE user_id = ?', target.id);
  modLog(moderator.id, banned ? 'ban' : 'unban', 'user', target.id, note || target.username);
}

r.post('/reports/:id/resolve', (req, res) => {
  const rep = one('SELECT * FROM reports WHERE id = ?', int(req.params.id));
  if (!rep) fail(404, 'Жалоба не найдена');
  const action = req.body.action === 'remove' ? 'remove' : 'dismiss';
  if (action === 'remove') {
    const id = rep.target_id;
    if (rep.target_type === 'game') {
      const g = one('SELECT * FROM games WHERE id = ?', id);
      if (g) {
        run("UPDATE games SET status = 'rejected', reject_reason = ?, featured = 0 WHERE id = ?", `Снята по жалобе: ${rep.reason}`, g.id);
        notify(g.developer_id, `Игра «${g.title}» снята с публикации по жалобе`, `/game/${g.id}`);
      }
    } else if (rep.target_type === 'review') {
      run('DELETE FROM reviews WHERE id = ?', id);
    } else if (rep.target_type === 'post') {
      const p = one('SELECT * FROM posts WHERE id = ?', id);
      if (p) deletePost(p);
    } else if (rep.target_type === 'comment') {
      run('DELETE FROM comments WHERE id = ?', id);
    } else if (rep.target_type === 'user') {
      const u = one('SELECT * FROM users WHERE id = ?', id);
      if (u) banUser(req.user, u, true, `по жалобе: ${rep.reason}`);
    }
    modLog(req.user.id, 'remove', rep.target_type, id, rep.reason);
  }
  // Закрываем все открытые жалобы на этот же объект.
  run(
    "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open'",
    req.user.id, Date.now(), rep.target_type, rep.target_id,
  );
  res.json({ ok: true });
});

// ---------- Пользователи ----------

r.get('/users', (req, res) => {
  const q = str(req.query.q, { max: 60 });
  const like = `%${likeEsc(q.toLowerCase())}%`;
  const rows = all(
    `SELECT u.*, (SELECT COUNT(*) FROM games g WHERE g.developer_id = u.id) AS games_count FROM users u
     WHERE ? = '' OR ulower(u.username) LIKE ? ESCAPE '\\' OR ulower(u.display_name) LIKE ? ESCAPE '\\' OR ulower(u.email) LIKE ? ESCAPE '\\'
     ORDER BY u.created_at DESC LIMIT 100`,
    q, like, like, like,
  );
  res.json(rows.map((u) => ({
    ...publicUser(u),
    email: isAdmin(req.user) ? u.email : undefined,
    banned: !!u.banned,
    created_at: u.created_at,
    last_seen: u.last_seen,
    games_count: u.games_count,
  })));
});

r.post('/users/:id/ban', (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', int(req.params.id));
  if (!u) fail(404, 'Пользователь не найден');
  banUser(req.user, u, !!req.body.banned);
  res.json({ banned: !!req.body.banned });
});

r.post('/users/:id/role', (req, res) => {
  if (!isAdmin(req.user)) fail(403, 'Менять роли может только администратор');
  const u = one('SELECT * FROM users WHERE id = ?', int(req.params.id));
  if (!u) fail(404, 'Пользователь не найден');
  const role = String(req.body.role);
  if (!ROLES.includes(role)) fail(400, 'Неизвестная роль');
  if (u.id === req.user.id && role !== 'admin') fail(400, 'Нельзя снять роль администратора с самого себя');
  run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
  const names = { user: 'пользователь', moderator: 'модератор', admin: 'администратор' };
  notify(u.id, `Ваша роль изменена: ${names[role]}`, `/u/${u.username}`);
  modLog(req.user.id, 'role', 'user', u.id, `${u.username} → ${role}`);
  res.json({ role });
});

// ---------- Каталог программ ----------

r.get('/catalog', (_req, res) => res.json(catalogList()));

r.post('/catalog/:key', async (req, res) => {
  const url = req.body.url ? unwrapLink(String(req.body.url).trim()) : '';
  const id = await addFromCatalog(String(req.params.key), req.user, url);
  modLog(req.user.id, 'catalog', 'game', id, req.params.key);
  res.json({ id });
});

// ---------- Почта (только администратор) ----------

function mailOut() {
  const c = mailConfig();
  return {
    env: mailFromEnv(),
    enabled: mailEnabled(),
    host: c.host, port: c.port, secure: !!c.secure, user: c.user, from: c.from,
    has_pass: !!c.pass,
  };
}

r.get('/mail', (req, res) => {
  if (!isAdmin(req.user)) fail(403, 'Только для администратора');
  res.json(mailOut());
});

r.put('/mail', (req, res) => {
  if (!isAdmin(req.user)) fail(403, 'Только для администратора');
  if (mailFromEnv()) fail(400, 'Почта задана переменными окружения SMTP_* на сервере');
  const b = req.body;
  const port = int(b.port, 465);
  if (port < 1 || port > 65535) fail(400, 'Некорректный порт');
  saveMailConfig({
    host: str(b.host, { name: 'Сервер', max: 200 }),
    port,
    secure: !!b.secure,
    user: str(b.user, { name: 'Логин', max: 200 }),
    pass: b.pass ? String(b.pass).slice(0, 500) : undefined,
    from: str(b.from, { name: 'Отправитель', max: 200 }),
  });
  modLog(req.user.id, 'mail', 'settings', null, b.host || 'выключено');
  res.json(mailOut());
});

r.post('/mail/test', async (req, res) => {
  if (!isAdmin(req.user)) fail(403, 'Только для администратора');
  const to = str(req.body.to, { name: 'Адрес', max: 200 }) || req.user.email;
  await sendMail({ to, ...codeEmail({ name: req.user.display_name, code: '123456', purpose: 'login' }), subject: 'HYTEAM: проверка почты' });
  res.json({ ok: true, to });
});

r.get('/log', (_req, res) => {
  const rows = all(
    `SELECT m.*, u.username, u.display_name FROM mod_log m JOIN users u ON u.id = m.moderator_id
     ORDER BY m.created_at DESC LIMIT 150`,
  );
  res.json(rows);
});
