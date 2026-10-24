// Одноразовые 6-значные коды из письма и «доверенные устройства» для входа без кода.
import crypto from 'node:crypto';
import { one, run } from './db.js';
import { fail } from './util.js';
import { sendMail, codeEmail } from './mail.js';

const TTL = 15 * 60e3;
const RESEND_MS = 60e3;
const MAX_ATTEMPTS = 5;
const DEVICE_COOKIE = 'hy_device';
const DEVICE_TTL = 180 * 24 * 3600e3;

const hashCode = (userId, purpose, code) => crypto.createHash('sha256').update(`${userId}:${purpose}:${code}`).digest('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Отправляет код на почту пользователя. Если код того же назначения ушёл меньше минуты назад —
 * новое письмо не шлём, а продолжаем с прежним кодом (возвращает sent: false).
 */
export async function issueCode(user, purpose, { ip = null, ticket = null } = {}) {
  const last = one('SELECT * FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1', user.id, purpose);
  if (last && last.expires_at > Date.now() && Date.now() - last.created_at < RESEND_MS) {
    if (ticket) run('UPDATE email_codes SET ticket = ? WHERE id = ?', ticket, last.id);
    return { sent: false };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await sendMail({ to: user.email, ...codeEmail({ name: user.display_name, code, purpose, ip }) });
  run('DELETE FROM email_codes WHERE user_id = ? AND purpose = ?', user.id, purpose);
  run(
    'INSERT INTO email_codes(user_id, purpose, code_hash, ticket, expires_at, created_at) VALUES(?,?,?,?,?,?)',
    user.id, purpose, hashCode(user.id, purpose, code), ticket, Date.now() + TTL, Date.now(),
  );
  return { sent: true };
}

/** Проверяет код. При ошибке бросает понятное сообщение и считает попытки. */
export function checkCode(row, code) {
  if (!row || row.expires_at < Date.now()) fail(400, 'Код устарел — запросите новый');
  if (row.attempts >= MAX_ATTEMPTS) fail(429, 'Слишком много неверных попыток — запросите новый код');
  const given = Buffer.from(hashCode(row.user_id, row.purpose, String(code ?? '').replace(/\D/g, '')));
  if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) {
    run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    fail(400, left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код. Запросите новый');
  }
  run('DELETE FROM email_codes WHERE id = ?', row.id);
}

export const codeRow = (userId, purpose) =>
  one('SELECT * FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1', userId, purpose);
export const codeByTicket = (ticket) =>
  one("SELECT * FROM email_codes WHERE ticket = ? AND purpose = 'login'", String(ticket || ''));
export const newTicket = () => crypto.randomBytes(24).toString('hex');

// ---------- Доверенные устройства ----------

function readDeviceToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === DEVICE_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isTrustedDevice(req, userId) {
  const token = readDeviceToken(req);
  if (!token) return false;
  const row = one('SELECT * FROM trusted_devices WHERE token_hash = ? AND user_id = ?', sha(token), userId);
  if (!row || Date.now() - row.last_used > DEVICE_TTL) return false;
  run('UPDATE trusted_devices SET last_used = ? WHERE token_hash = ?', Date.now(), row.token_hash);
  return true;
}

export function trustDevice(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ua = String(req.headers['user-agent'] || '');
  const label = /Electron|HYTEAM/i.test(ua) ? 'Программа HYTEAM' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Браузер';
  run('INSERT INTO trusted_devices(token_hash, user_id, label, created_at, last_used) VALUES(?,?,?,?,?)', sha(token), userId, label, Date.now(), Date.now());
  res.cookie(DEVICE_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: DEVICE_TTL, path: '/' });
}

export const currentDeviceHash = (req) => {
  const t = readDeviceToken(req);
  return t ? sha(t) : null;
};
