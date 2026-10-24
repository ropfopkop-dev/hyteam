// Отправка писем с кодами (как Steam Guard). Почтовый сервер (SMTP) настраивается
// в «Модерация → Почта» или переменными окружения SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
import nodemailer from 'nodemailer';
import { one, run } from './db.js';
import { HttpError, esc } from './util.js';

const KEYS = ['host', 'port', 'secure', 'user', 'pass', 'from'];

export const getSetting = (key) => one('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
export function setSetting(key, value) {
  if (value == null || value === '') run('DELETE FROM settings WHERE key = ?', key);
  else run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

export const mailFromEnv = () => !!process.env.SMTP_HOST;

export function mailConfig() {
  if (mailFromEnv()) {
    const port = Number(process.env.SMTP_PORT) || 465;
    return {
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    };
  }
  const c = Object.fromEntries(KEYS.map((k) => [k, getSetting(`smtp.${k}`) ?? '']));
  c.port = Number(c.port) || 465;
  c.secure = c.secure === '' ? c.port === 465 : c.secure === '1';
  return c;
}

export function saveMailConfig(c) {
  for (const k of KEYS) {
    if (k === 'pass' && c.pass === undefined) continue; // пустое поле пароля — оставить прежний
    const v = k === 'secure' ? (c.secure ? '1' : '0') : c[k];
    setSetting(`smtp.${k}`, v);
  }
  transporter = null;
}

export const mailEnabled = () => {
  const c = mailConfig();
  return !!(c.host && c.from);
};

let transporter = null;
let transporterKey = '';
function getTransporter() {
  const c = mailConfig();
  const key = JSON.stringify(c);
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    transporterKey = key;
  }
  return { transporter, from: c.from };
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) throw new HttpError(503, 'Почта на сервере не настроена');
  const { transporter: t, from } = getTransporter();
  try {
    await t.sendMail({ from: from.includes('<') ? from : `HYTEAM <${from}>`, to, subject, text, html });
  } catch (e) {
    console.warn(`Почта: не удалось отправить письмо на ${to}: ${e.message}`);
    throw new HttpError(502, `Не удалось отправить письмо: ${e.message}`);
  }
}

const PURPOSE = {
  verify: ['Подтверждение почты', 'Введите этот код, чтобы подтвердить почту и завершить регистрацию в HYTEAM.'],
  login: ['Код для входа', 'Кто-то (надеемся, вы) входит в ваш аккаунт HYTEAM. Введите этот код, чтобы подтвердить вход.'],
  reset: ['Восстановление пароля', 'Введите этот код, чтобы задать новый пароль для аккаунта HYTEAM.'],
  twofa: ['Включение защиты входа', 'Введите этот код, чтобы включить вход по коду из почты.'],
};

export function codeEmail({ name, code, purpose, ip }) {
  const [title, lead] = PURPOSE[purpose] || PURPOSE.login;
  const text = `${title}\n\nПривет, ${name}!\n${lead}\n\nКод: ${code}\n\nКод действует 15 минут.${ip ? `\nЗапрос с IP: ${ip}` : ''}\nЕсли это были не вы — просто проигнорируйте письмо и смените пароль.\n\nHYTEAM`;
  const html = `<!doctype html><html><body style="margin:0;background:#06041a;padding:32px 12px;font-family:Segoe UI,Arial,sans-serif;color:#f4f2ff">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;width:100%;background:#120b30;border:1px solid #3b2a73;border-radius:18px">
<tr><td style="padding:28px 32px 8px"><span style="font-size:22px;font-weight:800;letter-spacing:4px;color:#ffffff">HYTEAM</span>
<span style="color:#a49cc9;font-size:13px;margin-left:6px">Game Store</span></td></tr>
<tr><td style="padding:12px 32px 0"><h1 style="margin:0 0 12px;font-size:20px;color:#ffffff">${esc(title)}</h1>
<p style="margin:0 0 6px;color:#d6cff5;font-size:15px">Привет, ${esc(name)}!</p>
<p style="margin:0 0 22px;color:#a49cc9;font-size:14px;line-height:1.5">${esc(lead)}</p></td></tr>
<tr><td align="center" style="padding:0 32px">
<div style="background:linear-gradient(135deg,#6d28d9,#a855f7);background-color:#7c3aed;border-radius:14px;padding:18px 10px;font-size:36px;font-weight:800;letter-spacing:12px;color:#ffffff;font-family:Consolas,monospace">${esc(code)}</div></td></tr>
<tr><td style="padding:20px 32px 28px;color:#6f6896;font-size:12.5px;line-height:1.6">Код действует 15 минут.${ip ? ` Запрос с IP ${esc(ip)}.` : ''}<br>Если это были не вы — проигнорируйте письмо и смените пароль.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `HYTEAM: ${title.toLowerCase()} — ${code}`, text, html };
}

/** ro****@gmail.com — чтобы показать, куда ушёл код, не раскрывая адрес целиком. */
export function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 2))}@${domain}`;
}
