import { Router } from 'express';
import { one, run } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession, meOut, deviceAccounts, saveAccounts, setSessionCookie, currentToken } from '../auth.js';
import { publicUser } from '../util.js';
import { mailEnabled, maskEmail } from '../mail.js';
import { issueCode, checkCode, codeRow, codeByTicket, newTicket, isTrustedDevice, trustDevice } from '../codes.js';
import { fail, str, isMod } from '../util.js';

const r = Router();
export default r;

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const attempts = new Map();
function rateLimit(req, max = 20) {
  const now = Date.now();
  const list = (attempts.get(req.ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= max) fail(429, 'Слишком много попыток. Подождите несколько минут.');
  list.push(now);
  attempts.set(req.ip, list);
}

function readPassword(value) {
  const password = String(value ?? '');
  if (password.length < 6) fail(400, 'Пароль: минимум 6 символов');
  if (password.length > 200) fail(400, 'Пароль слишком длинный');
  return password;
}

const findByLogin = (login) => {
  const s = String(login ?? '').trim();
  return s ? one('SELECT * FROM users WHERE username = ? OR email = ?', s, s.toLowerCase()) : null;
};

function signIn(req, res, u) {
  createSession(req, res, u.id);
  res.json({ user: meOut(one('SELECT * FROM users WHERE id = ?', u.id)) });
}

// ---------- Регистрация с подтверждением почты ----------

r.post('/register', async (req, res) => {
  rateLimit(req);
  const username = str(req.body.username, { name: 'Логин', required: true, max: 24 });
  if (!USERNAME_RE.test(username)) fail(400, 'Логин: 3–24 символа — латиница, цифры, _ . -');
  const email = str(req.body.email, { name: 'Email', required: true, max: 120 }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'Некорректный email');
  const password = readPassword(req.body.password);
  const displayName = str(req.body.display_name, { name: 'Имя', max: 40 }) || username;

  // Неподтверждённая регистрация старше суток не держит логин и почту.
  run('DELETE FROM users WHERE email_verified = 0 AND created_at < ? AND (username = ? OR email = ?)', Date.now() - 24 * 3600e3, username, email);
  if (one('SELECT 1 FROM users WHERE username = ?', username)) fail(409, 'Этот логин уже занят');
  if (one('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Этот email уже зарегистрирован');

  const verify = mailEnabled();
  // Первый зарегистрированный аккаунт становится владельцем (администратором) магазина.
  const role = one("SELECT 1 FROM users WHERE role = 'admin'") ? 'user' : 'admin';
  const info = run(
    'INSERT INTO users(username, email, password_hash, display_name, role, created_at, last_seen, email_verified) VALUES(?,?,?,?,?,?,?,?)',
    username, email, hashPassword(password), displayName, role, Date.now(), Date.now(), verify ? 0 : 1,
  );
  const u = one('SELECT * FROM users WHERE id = ?', Number(info.lastInsertRowid));
  if (!verify) return signIn(req, res, u);
  try {
    await issueCode(u, 'verify', { ip: req.ip });
  } catch (e) {
    run('DELETE FROM users WHERE id = ?', u.id);
    throw e;
  }
  res.json({ need_verify: true, login: u.username, email: maskEmail(u.email) });
});

r.post('/verify', (req, res) => {
  rateLimit(req, 40);
  const u = findByLogin(req.body.login);
  if (!u) fail(404, 'Аккаунт не найден');
  if (u.email_verified) return signIn(req, res, u);
  checkCode(codeRow(u.id, 'verify'), req.body.code);
  run('UPDATE users SET email_verified = 1 WHERE id = ?', u.id);
  signIn(req, res, u);
});

r.post('/resend', async (req, res) => {
  rateLimit(req);
  const u = findByLogin(req.body.login);
  if (!u || u.email_verified) return res.json({ ok: true });
  const { sent } = await issueCode(u, 'verify', { ip: req.ip });
  res.json({ ok: true, sent });
});

// ---------- Вход, при необходимости — с кодом из почты ----------

r.post('/login', async (req, res) => {
  rateLimit(req);
  const login = str(req.body.login, { name: 'Логин', required: true, max: 120 });
  const u = findByLogin(login);
  if (!u || !verifyPassword(String(req.body.password ?? ''), u.password_hash)) fail(401, 'Неверный логин или пароль');
  if (u.banned) fail(403, 'Аккаунт заблокирован модерацией');
  const mail = mailEnabled();

  if (mail && !u.email_verified) {
    await issueCode(u, 'verify', { ip: req.ip });
    return res.json({ need_verify: true, login: u.username, email: maskEmail(u.email) });
  }
  // Если почта на сервере выключена, коды отправить нельзя — пускаем по паролю, чтобы не запереть владельца.
  // Как Steam Guard: после пароля на новом устройстве всегда нужен код из почты.
  if (mail && !isTrustedDevice(req, u.id)) {
    const ticket = newTicket();
    const { sent } = await issueCode(u, 'login', { ip: req.ip, ticket });
    return res.json({ need_code: true, ticket, email: maskEmail(u.email), sent });
  }
  signIn(req, res, u);
});

r.post('/login/code', (req, res) => {
  rateLimit(req, 40);
  const row = codeByTicket(req.body.ticket);
  if (!row) fail(400, 'Код устарел — войдите заново');
  checkCode(row, req.body.code);
  const u = one('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!u || u.banned) fail(403, 'Аккаунт недоступен');
  if (req.body.remember) trustDevice(req, res, u.id);
  signIn(req, res, u);
});

r.post('/login/resend', async (req, res) => {
  rateLimit(req);
  const row = codeByTicket(req.body.ticket);
  if (!row) fail(400, 'Войдите заново');
  const u = one('SELECT * FROM users WHERE id = ?', row.user_id);
  const ticket = newTicket();
  run('UPDATE email_codes SET created_at = 0 WHERE id = ?', row.id); // разрешаем отправить новое письмо
  const { sent } = await issueCode(u, 'login', { ip: req.ip, ticket });
  res.json({ ticket, sent });
});

// ---------- Восстановление пароля ----------

r.post('/reset/request', async (req, res) => {
  rateLimit(req);
  if (!mailEnabled()) fail(503, 'Восстановление по почте недоступно — обратитесь к администратору магазина');
  const u = findByLogin(req.body.login);
  // Не сообщаем, есть ли такой аккаунт, — чтобы нельзя было перебирать почты.
  if (u && !u.banned) await issueCode(u, 'reset', { ip: req.ip });
  res.json({ ok: true });
});

r.post('/reset/confirm', (req, res) => {
  rateLimit(req, 40);
  const u = findByLogin(req.body.login);
  if (!u) fail(400, 'Неверный код');
  const password = readPassword(req.body.password);
  checkCode(codeRow(u.id, 'reset'), req.body.code);
  run('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', hashPassword(password), u.id);
  // Новый пароль — выходим со всех устройств и забываем доверенные.
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  run('DELETE FROM trusted_devices WHERE user_id = ?', u.id);
  if (u.banned) fail(403, 'Аккаунт заблокирован модерацией');
  signIn(req, res, u);
});

r.post('/logout', (req, res) => {
  const current = currentToken(req);
  const rest = deviceAccounts(req).filter((a) => a.token !== current);
  destroySession(req, res);
  saveAccounts(req, res, rest.map((a) => a.token));
  // Остался другой аккаунт на этом устройстве — сразу переключаемся на него.
  if (rest.length) {
    setSessionCookie(req, res, rest[rest.length - 1].token);
    return res.json({ ok: true, switched: meOut(rest[rest.length - 1].user) });
  }
  res.json({ ok: true });
});

// ---------- Переключение аккаунтов ----------

r.get('/accounts', (req, res) => {
  const current = currentToken(req);
  res.json(deviceAccounts(req).map((a) => ({ ...publicUser(a.user), current: a.token === current })));
});

r.post('/switch', (req, res) => {
  const acc = deviceAccounts(req).find((a) => a.user.id === Number(req.body.user_id));
  if (!acc) fail(404, 'Этот аккаунт больше не сохранён на устройстве — войдите заново');
  setSessionCookie(req, res, acc.token);
  res.json({ user: meOut(acc.user) });
});

r.post('/forget', (req, res) => {
  const current = currentToken(req);
  const list = deviceAccounts(req);
  const acc = list.find((a) => a.user.id === Number(req.body.user_id));
  if (acc && acc.token !== current) run('DELETE FROM sessions WHERE token = ?', acc.token);
  saveAccounts(req, res, list.filter((a) => a !== acc || a.token === current).map((a) => a.token));
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  const u = req.user;
  if (!u) return res.json({ user: null, unread: 0, mod_pending: 0 });
  const unread = one('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', u.id).c;
  const modPending = isMod(u)
    ? one("SELECT (SELECT COUNT(*) FROM games WHERE status = 'pending') + (SELECT COUNT(*) FROM game_versions WHERE status = 'pending') + (SELECT COUNT(*) FROM reports WHERE status = 'open') AS c").c
    : 0;
  res.json({ user: meOut(u), unread, mod_pending: modPending });
});
