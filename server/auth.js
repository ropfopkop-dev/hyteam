import crypto from 'node:crypto';
import { one, run } from './db.js';
import { COOKIE_SECURE } from './config.js';
import { fail, publicUser, mediaUrl, isMod, isAdmin } from './util.js';

const COOKIE = 'hy_session';
const TTL = 30 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function readToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)', token, userId, Date.now() + TTL);
  setSessionCookie(req, res, token);
  rememberAccount(req, res, token, userId);
}

export function setSessionCookie(req, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE || req.secure, maxAge: TTL, path: '/' });
}

// ---------- Несколько аккаунтов на одном устройстве (как в Steam) ----------
// Сессии всех вошедших аккаунтов хранятся в отдельной httpOnly-cookie — JS страницы их не видит.

const ACCOUNTS = 'hy_accounts';
const MAX_ACCOUNTS = 5;

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** Живые сессии из списка аккаунтов устройства: [{ token, user }]. */
export function deviceAccounts(req) {
  const out = [];
  for (const token of readCookie(req, ACCOUNTS).split('.').filter((t) => /^[a-f0-9]{64}$/.test(t))) {
    const u = one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.banned = 0', token, Date.now());
    if (u && !out.some((x) => x.user.id === u.id)) out.push({ token, user: u });
  }
  return out;
}

export function saveAccounts(req, res, tokens) {
  res.cookie(ACCOUNTS, tokens.slice(-MAX_ACCOUNTS).join('.'), { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE || req.secure, maxAge: TTL, path: '/' });
}

function rememberAccount(req, res, token, userId) {
  const list = deviceAccounts(req).filter((a) => a.user.id !== userId).map((a) => a.token);
  saveAccounts(req, res, [...list, token]);
}

export function destroySession(req, res) {
  const token = readToken(req);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

export function currentToken(req) {
  return readToken(req);
}

export function loadUser(req, _res, next) {
  const token = readToken(req);
  if (token) {
    const u = one(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
      token, Date.now(),
    );
    if (u && !u.banned) {
      req.user = u;
      if (!u.last_seen || Date.now() - u.last_seen > 60e3) run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), u.id);
    }
  }
  next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : fail(401, 'Войдите в аккаунт'));
export const requireMod = (req, _res, next) => (isMod(req.user) ? next() : fail(403, 'Доступно только модераторам'));
export const requireAdmin = (req, _res, next) => (isAdmin(req.user) ? next() : fail(403, 'Доступно только администратору'));

export function meOut(u) {
  return {
    ...publicUser(u),
    email: u.email,
    bio: u.bio,
    banner: mediaUrl(u.banner),
    created_at: u.created_at,
    email_verified: !!u.email_verified,
    twofa: !!u.twofa,
    balance: u.balance || 0,
  };
}
