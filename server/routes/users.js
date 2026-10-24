import { Router } from 'express';
import { one, all, run } from '../db.js';
import { requireAuth, hashPassword, verifyPassword, meOut, currentToken } from '../auth.js';
import { profileUpload, withCleanup, checkImageSizes } from '../upload.js';
import { GAMES, gameOut, userSets } from '../games.js';
import { fail, str, int, likeEsc, mediaUrl, publicUser, notify, removeImage } from '../util.js';
import { mailEnabled, maskEmail } from '../mail.js';
import { issueCode, checkCode, codeRow, trustDevice, currentDeviceHash } from '../codes.js';

const r = Router();
export default r;

const DAY = 24 * 3600 * 1000;

export function levelOf(stats) {
  const xp = stats.games * 10 + stats.reviews * 25 + stats.posts * 15 + stats.comments * 3 + stats.friends * 5 + stats.published * 100;
  let level = 0;
  while (20 * (level + 1) ** 2 <= xp) level++;
  return { level, xp, from: 20 * level ** 2, to: 20 * (level + 1) ** 2 };
}

function badgesOf(u, stats) {
  const out = [];
  if (u.role === 'admin') out.push({ id: 'founder', name: 'Основатель', desc: 'Владелец HYTEAM' });
  if (u.role === 'moderator') out.push({ id: 'mod', name: 'Модератор', desc: 'Следит за порядком' });
  if (stats.published > 0) out.push({ id: 'dev', name: 'Разработчик', desc: `Опубликовано игр: ${stats.published}` });
  if (stats.games >= 10) out.push({ id: 'collector', name: 'Коллекционер', desc: '10+ игр в библиотеке' });
  if (stats.reviews >= 5) out.push({ id: 'critic', name: 'Критик', desc: '5+ отзывов' });
  if (stats.friends >= 5) out.push({ id: 'social', name: 'Душа компании', desc: '5+ друзей' });
  if (stats.posts >= 10) out.push({ id: 'writer', name: 'Активист', desc: '10+ постов в сообществе' });
  if (Date.now() - u.created_at > 365 * DAY) out.push({ id: 'veteran', name: 'Ветеран', desc: 'Больше года в HYTEAM' });
  return out;
}

function relationOf(me, userId) {
  if (!me) return 'guest';
  if (me.id === userId) return 'self';
  const row = one(
    'SELECT * FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    me.id, userId, userId, me.id,
  );
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === me.id ? 'outgoing' : 'incoming';
}

function friendsOf(userId, limit = 500) {
  return all(
    `SELECT u.* FROM friends f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?) AND u.banned = 0
     ORDER BY u.last_seen DESC LIMIT ?`,
    userId, userId, userId, limit,
  ).map(publicUser);
}

r.get('/users', (req, res) => {
  const q = str(req.query.q, { max: 60 });
  if (!q) return res.json([]);
  const like = `%${likeEsc(q.toLowerCase())}%`;
  const rows = all(
    `SELECT * FROM users WHERE banned = 0 AND (ulower(username) LIKE ? ESCAPE '\\' OR ulower(display_name) LIKE ? ESCAPE '\\')
     ORDER BY last_seen DESC LIMIT 20`,
    like, like,
  );
  res.json(rows.map((u) => ({ ...publicUser(u), relation: relationOf(req.user, u.id) })));
});

r.get('/users/:username', (req, res) => {
  const u = one('SELECT * FROM users WHERE username = ?', req.params.username);
  if (!u) fail(404, 'Пользователь не найден');
  const count = (sql) => one(sql, u.id).c;
  const stats = {
    games: count('SELECT COUNT(*) AS c FROM library WHERE user_id = ?'),
    reviews: count('SELECT COUNT(*) AS c FROM reviews WHERE user_id = ?'),
    posts: count('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?'),
    comments: count('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?'),
    friends: one("SELECT COUNT(*) AS c FROM friends WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", u.id, u.id).c,
    published: count("SELECT COUNT(*) AS c FROM games WHERE developer_id = ? AND status = 'approved'"),
  };
  const sets = userSets(req.user);
  res.json({
    user: {
      ...publicUser(u),
      bio: u.bio,
      banner: mediaUrl(u.banner),
      created_at: u.created_at,
      last_seen: u.last_seen,
      banned: !!u.banned,
    },
    stats,
    level: levelOf(stats),
    badges: badgesOf(u, stats),
    relation: relationOf(req.user, u.id),
    published: all(`${GAMES} WHERE g.developer_id = ? AND g.status = 'approved' ORDER BY g.published_at DESC LIMIT 12`, u.id)
      .map((g) => gameOut(g, sets)),
    library: all(
      `${GAMES} JOIN library l ON l.game_id = g.id WHERE l.user_id = ? AND g.status = 'approved'
       ORDER BY MAX(COALESCE(l.last_played_at, 0), COALESCE(l.last_download_at, 0), l.added_at) DESC LIMIT 8`,
      u.id,
    ).map((g) => ({
      ...gameOut(g, sets),
      playtime: g.playtime,
      last_activity: Math.max(g.last_played_at || 0, g.last_download_at || 0, g.added_at),
    })),
    playtime_total: one('SELECT COALESCE(SUM(playtime), 0) AS m FROM library WHERE user_id = ?', u.id).m,
    reviews: all(
      `SELECT r.*, g.title AS game_title, g.cover AS game_cover FROM reviews r JOIN games g ON g.id = r.game_id
       WHERE r.user_id = ? AND g.status = 'approved' ORDER BY r.created_at DESC LIMIT 5`,
      u.id,
    ).map((x) => ({
      id: x.id, rating: x.rating, body: x.body, created_at: x.created_at,
      game: { id: x.game_id, title: x.game_title, cover: mediaUrl(x.game_cover) },
    })),
    friends: friendsOf(u.id, 8),
  });
});

r.put('/me/profile', requireAuth, profileUpload, withCleanup((req, res) => {
  checkImageSizes(req);
  const displayName = str(req.body.display_name, { name: 'Имя', required: true, max: 40 });
  const bio = str(req.body.bio, { name: 'О себе', max: 600 });
  const avatar = req.files?.avatar?.[0];
  const banner = req.files?.banner?.[0];
  const me = req.user;
  run(
    'UPDATE users SET display_name = ?, bio = ?, avatar = COALESCE(?, avatar), banner = COALESCE(?, banner) WHERE id = ?',
    displayName, bio, avatar?.filename, banner?.filename, me.id,
  );
  if (avatar && me.avatar) removeImage(me.avatar);
  if (banner && me.banner) removeImage(me.banner);
  res.json({ user: meOut(one('SELECT * FROM users WHERE id = ?', me.id)) });
}));

r.put('/me/password', requireAuth, (req, res) => {
  const current = String(req.body.current ?? '');
  const next = String(req.body.password ?? '');
  if (!verifyPassword(current, req.user.password_hash)) fail(400, 'Текущий пароль указан неверно');
  if (next.length < 6) fail(400, 'Новый пароль: минимум 6 символов');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  // Выходим со всех остальных устройств.
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, currentToken(req));
  res.json({ ok: true });
});

// ---------- Защита аккаунта: подтверждение почты и вход по коду ----------

r.get('/me/security', requireAuth, (req, res) => {
  const current = currentDeviceHash(req);
  res.json({
    email: req.user.email,
    email_verified: !!req.user.email_verified,
    twofa: !!req.user.twofa,
    mail_enabled: mailEnabled(),
    devices: all('SELECT token_hash, label, created_at, last_used FROM trusted_devices WHERE user_id = ? ORDER BY last_used DESC', req.user.id)
      .map((d) => ({ label: d.label, created_at: d.created_at, last_used: d.last_used, current: d.token_hash === current })),
  });
});

r.post('/me/email/start', requireAuth, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, verified: true });
  const { sent } = await issueCode(req.user, 'verify', { ip: req.ip });
  res.json({ ok: true, sent, email: maskEmail(req.user.email) });
});

r.post('/me/email/confirm', requireAuth, (req, res) => {
  checkCode(codeRow(req.user.id, 'verify'), req.body.code);
  run('UPDATE users SET email_verified = 1 WHERE id = ?', req.user.id);
  res.json({ ok: true });
});

r.post('/me/2fa/start', requireAuth, async (req, res) => {
  if (!mailEnabled()) fail(503, 'Почта на сервере не настроена — коды отправлять некуда. Обратитесь к администратору.');
  if (!req.user.email_verified) fail(400, 'Сначала подтвердите почту');
  const { sent } = await issueCode(req.user, 'twofa', { ip: req.ip });
  res.json({ ok: true, sent, email: maskEmail(req.user.email) });
});

r.post('/me/2fa/confirm', requireAuth, (req, res) => {
  checkCode(codeRow(req.user.id, 'twofa'), req.body.code);
  run('UPDATE users SET twofa = 1 WHERE id = ?', req.user.id);
  trustDevice(req, res, req.user.id); // на этом устройстве код уже подтверждён
  res.json({ ok: true });
});

r.post('/me/2fa/disable', requireAuth, (req, res) => {
  if (!verifyPassword(String(req.body.password ?? ''), req.user.password_hash)) fail(400, 'Неверный пароль');
  run('UPDATE users SET twofa = 0 WHERE id = ?', req.user.id);
  run('DELETE FROM trusted_devices WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

r.delete('/me/devices', requireAuth, (req, res) => {
  // Забываем все устройства и выходим везде, кроме текущего.
  run('DELETE FROM trusted_devices WHERE user_id = ?', req.user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, currentToken(req));
  res.json({ ok: true });
});

// ---------- Друзья ----------

r.get('/friends', requireAuth, (req, res) => {
  const me = req.user.id;
  res.json({
    friends: friendsOf(me),
    incoming: all(
      `SELECT u.* FROM friends f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`,
      me,
    ).map(publicUser),
    outgoing: all(
      `SELECT u.* FROM friends f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`,
      me,
    ).map(publicUser),
  });
});

r.post('/friends/:id', requireAuth, (req, res) => {
  const me = req.user;
  const target = one('SELECT * FROM users WHERE id = ? AND banned = 0', int(req.params.id));
  if (!target) fail(404, 'Пользователь не найден');
  if (target.id === me.id) fail(400, 'Нельзя добавить себя в друзья');
  const relation = relationOf(me, target.id);
  if (relation === 'none') {
    run('INSERT INTO friends(requester_id, addressee_id, created_at) VALUES(?,?,?)', me.id, target.id, Date.now());
    notify(target.id, `${me.display_name} хочет добавить вас в друзья`, '/friends');
    return res.json({ relation: 'outgoing' });
  }
  if (relation === 'incoming') {
    run("UPDATE friends SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?", target.id, me.id);
    notify(target.id, `${me.display_name} принял(а) вашу заявку в друзья`, `/u/${me.username}`);
    return res.json({ relation: 'friends' });
  }
  res.json({ relation });
});

r.delete('/friends/:id', requireAuth, (req, res) => {
  const other = int(req.params.id);
  run(
    'DELETE FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    req.user.id, other, other, req.user.id,
  );
  res.json({ relation: 'none' });
});

// ---------- Уведомления ----------

r.get('/notifications', requireAuth, (req, res) => {
  const items = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', req.user.id);
  const unread = one('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).c;
  res.json({ items: items.map((n) => ({ ...n, is_read: !!n.is_read })), unread });
});

r.post('/notifications/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});
