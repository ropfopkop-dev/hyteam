// Баланс, покупка платных игр и пополнение через Lolz или Telegram-бота.
// Деньги приходят владельцу вручную, поэтому каждое пополнение подтверждает администратор.
import { Router } from 'express';
import { one, all, run, tx } from '../db.js';
import { requireAuth, requireMod, requireAdmin } from '../auth.js';
import { getSetting, setSetting } from '../mail.js';
import { fail, str, int, isMod, notify, notifyMods, modLog } from '../util.js';

const r = Router();
export default r;

const DEFAULT_LOLZ = 'https://lolz.team/members/5353027/';
const METHODS = ['lolz', 'telegram'];
const MIN = 10;
const MAX = 100000;

export function payMethods() {
  return {
    lolz: getSetting('pay.lolz_url') || DEFAULT_LOLZ,
    telegram: getSetting('pay.telegram_url') || '',
  };
}

/** Есть ли у пользователя доступ к платной игре: купил, разработчик или модератор. */
export function ownsPaid(g, user) {
  if (!g.price) return true;
  if (!user) return false;
  if (user.id === g.developer_id || isMod(user)) return true;
  return !!one('SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?', user.id, g.id);
}

r.get('/wallet', requireAuth, (req, res) => {
  res.json({
    balance: one('SELECT balance FROM users WHERE id = ?', req.user.id).balance,
    methods: payMethods(),
    topups: all('SELECT id, amount, method, status, note, created_at, resolved_at FROM topups WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', req.user.id),
    purchases: all(
      `SELECT p.game_id, p.price, p.created_at, g.title FROM purchases p JOIN games g ON g.id = p.game_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 50`,
      req.user.id,
    ),
  });
});

r.post('/wallet/topup', requireAuth, (req, res) => {
  const amount = int(req.body.amount, 0);
  if (amount < MIN || amount > MAX) fail(400, `Сумма пополнения: от ${MIN} до ${MAX} ₽`);
  const method = METHODS.includes(req.body.method) ? req.body.method : fail(400, 'Выберите способ оплаты');
  const note = str(req.body.note, { name: 'Комментарий', max: 300 });
  const pending = one("SELECT COUNT(*) AS c FROM topups WHERE user_id = ? AND status = 'pending'", req.user.id).c;
  if (pending >= 3) fail(429, 'У вас уже есть заявки на проверке — дождитесь подтверждения');
  const info = run(
    'INSERT INTO topups(user_id, amount, method, note, created_at) VALUES(?,?,?,?,?)',
    req.user.id, amount, method, note, Date.now(),
  );
  notifyMods(`Заявка на пополнение: ${req.user.username}, ${amount} ₽ (${method === 'lolz' ? 'Lolz' : 'Telegram'})`, '/mod?tab=topups');
  res.json({ id: Number(info.lastInsertRowid) });
});

r.post('/games/:id/buy', requireAuth, (req, res) => {
  const g = one('SELECT * FROM games WHERE id = ?', int(req.params.id));
  if (!g || g.status !== 'approved') fail(404, 'Игра недоступна');
  if (!g.price) fail(400, 'Эта игра бесплатная — просто добавьте её в библиотеку');
  if (ownsPaid(g, req.user)) fail(400, 'Игра уже куплена');
  tx(() => {
    const u = one('SELECT balance FROM users WHERE id = ?', req.user.id);
    if (u.balance < g.price) fail(402, `Не хватает ${g.price - u.balance} ₽ — пополните баланс`);
    const t = Date.now();
    run('UPDATE users SET balance = balance - ? WHERE id = ?', g.price, req.user.id);
    run('UPDATE users SET balance = balance + ? WHERE id = ?', g.price, g.developer_id);
    run('INSERT INTO purchases(user_id, game_id, price, created_at) VALUES(?,?,?,?)', req.user.id, g.id, g.price, t);
    run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', req.user.id, g.id, t);
    run('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?', req.user.id, g.id);
  });
  notify(g.developer_id, `${req.user.display_name} купил(а) «${g.title}» за ${g.price} ₽`, `/game/${g.id}`);
  res.json({ ok: true, balance: one('SELECT balance FROM users WHERE id = ?', req.user.id).balance });
});

// ---------- Админ: заявки на пополнение и реквизиты ----------

r.get('/mod/topups', requireAuth, requireMod, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  res.json({
    methods: payMethods(),
    items: all(
      `SELECT t.*, u.username, u.display_name, u.balance FROM topups t JOIN users u ON u.id = t.user_id
       WHERE t.status = ? ORDER BY t.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`,
      status,
    ),
  });
});

r.post('/mod/topups/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const t = one('SELECT * FROM topups WHERE id = ?', int(req.params.id));
  if (!t || t.status !== 'pending') fail(404, 'Заявка не найдена или уже обработана');
  // Админ может поправить сумму, если пришло не столько, сколько указано.
  const amount = req.body.amount ? int(req.body.amount, t.amount) : t.amount;
  if (amount <= 0 || amount > MAX) fail(400, 'Некорректная сумма');
  tx(() => {
    run("UPDATE topups SET status = 'approved', amount = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", amount, req.user.id, Date.now(), t.id);
    run('UPDATE users SET balance = balance + ? WHERE id = ?', amount, t.user_id);
  });
  notify(t.user_id, `Баланс пополнен на ${amount} ₽`, '/wallet');
  modLog(req.user.id, 'topup', 'user', t.user_id, `+${amount} ₽`);
  res.json({ ok: true });
});

r.post('/mod/topups/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const t = one('SELECT * FROM topups WHERE id = ?', int(req.params.id));
  if (!t || t.status !== 'pending') fail(404, 'Заявка не найдена или уже обработана');
  const reason = str(req.body.reason, { name: 'Причина', max: 300 }) || 'оплата не найдена';
  run("UPDATE topups SET status = 'rejected', note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", reason, req.user.id, Date.now(), t.id);
  notify(t.user_id, `Заявка на пополнение ${t.amount} ₽ отклонена: ${reason}`, '/wallet');
  res.json({ ok: true });
});

r.put('/mod/payments', requireAuth, requireAdmin, (req, res) => {
  const check = (v, name) => {
    const s = str(v, { name, max: 300 });
    if (s && !/^https:\/\//i.test(s)) fail(400, `${name}: ссылка должна начинаться с https://`);
    return s;
  };
  setSetting('pay.lolz_url', check(req.body.lolz, 'Lolz'));
  setSetting('pay.telegram_url', check(req.body.telegram, 'Telegram-бот'));
  res.json(payMethods());
});
