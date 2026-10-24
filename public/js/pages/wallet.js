import { api, html, mount, $, $$, fmt, toast, toastError } from '../lib.js';
import { state } from '../state.js';
import { icon, empty } from '../components.js';
import { renderChrome } from '../app.js';

const STATUS = { pending: ['На проверке', 'st-pending'], approved: ['Зачислено', 'st-approved'], rejected: ['Отклонено', 'st-rejected'] };
const METHOD = { lolz: 'Lolz', telegram: 'Telegram-бот' };

// В приложении window.open открывает системный браузер.
const openLink = (url) => window.open(url, '_blank', 'noopener');

export default async function wallet(el) {
  const w = await api('/wallet');
  state.user.balance = w.balance;
  const login = state.user.username;
  let method = 'lolz';

  mount(el, html`<div class="page-head">
      <h1>${icon('wallet', 26, 'accent')} Кошелёк</h1>
      <p class="muted">Баланс HYTEAM нужен только для платных игр — все программы из каталога бесплатные</p>
    </div>
    <div class="wallet">
      <div class="card wallet-balance">
        <span class="muted">Ваш баланс</span>
        <b>${fmt.money(w.balance)}</b>
      </div>

      <div class="card wallet-topup">
        <h2>Пополнить баланс</h2>
        <div class="seg" id="w-method">
          <button data-m="lolz" class="on">${icon('send', 15)} Перевод на Lolz <small>долго</small></button>
          <button data-m="telegram" ${w.methods.telegram ? '' : 'disabled title="Бот ещё не подключён"'}>${icon('message', 15)} Telegram-бот <small>быстро</small></button>
        </div>
        <div class="field"><label for="w-amount">Сумма, ₽</label>
          <input class="input" id="w-amount" type="number" min="10" max="100000" step="1" value="100"></div>
        <div id="w-steps"></div>
        <div class="field"><label for="w-note">Комментарий для проверки (необязательно)</label>
          <input class="input" id="w-note" maxlength="300" placeholder="Например: ник на Lolz или время перевода"></div>
        <button class="btn btn-primary btn-lg" id="w-paid">${icon('check', 16)} Я оплатил — отправить на проверку</button>
      </div>

      <div class="card">
        <h2>Заявки на пополнение</h2>
        ${w.topups.length
          ? html`<div class="w-list">${w.topups.map((t) => html`<div class="w-row">
              <span><b>${fmt.money(t.amount)}</b> <span class="muted">· ${METHOD[t.method] || t.method} · ${fmt.ago(t.created_at)}</span>
                ${t.status === 'rejected' && t.note ? html`<span class="muted xs">Причина: ${t.note}</span>` : ''}</span>
              <span class="status ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></div>`)}</div>`
          : html`<p class="muted">Заявок пока нет</p>`}
      </div>

      <div class="card">
        <h2>Покупки</h2>
        ${w.purchases.length
          ? html`<div class="w-list">${w.purchases.map((p) => html`<a class="w-row" href="#/game/${p.game_id}"><span><b>${p.title}</b> <span class="muted">· ${fmt.date(p.created_at)}</span></span><span>${fmt.money(p.price)}</span></a>`)}</div>`
          : empty({ ic: 'store', title: 'Покупок пока нет' })}
      </div>
    </div>`);

  const steps = () => {
    const amount = Number($('#w-amount', el).value) || 0;
    mount($('#w-steps', el), method === 'lolz'
      ? html`<ol class="w-steps">
          <li>Откройте профиль <button class="link" data-open="${w.methods.lolz}">${w.methods.lolz}</button></li>
          <li>Сделайте перевод на <b>${fmt.money(amount)}</b></li>
          <li>В комментарии к переводу обязательно укажите логин: <code class="copy" data-copy="${login}" title="Нажмите, чтобы скопировать">${login}</code></li>
          <li>Нажмите «Я оплатил». Администратор проверит перевод и зачислит деньги — обычно в течение суток</li>
        </ol>`
      : html`<ol class="w-steps">
          <li>Откройте бота <button class="link" data-open="${w.methods.telegram}">${w.methods.telegram}</button></li>
          <li>Оплатите <b>${fmt.money(amount)}</b> и укажите логин <code class="copy" data-copy="${login}" title="Нажмите, чтобы скопировать">${login}</code></li>
          <li>Нажмите «Я оплатил» — заявку подтвердят сразу после поступления оплаты</li>
        </ol>`);
  };
  steps();

  $('#w-amount', el).addEventListener('input', steps);
  $('#w-method', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.disabled) return;
    method = b.dataset.m;
    $$('#w-method button', el).forEach((x) => x.classList.toggle('on', x === b));
    steps();
  });
  el.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openLink(open.dataset.open);
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast('Логин скопирован');
      } catch {
        /* буфер обмена недоступен */
      }
    }
  });
  $('#w-paid', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('/wallet/topup', { method: 'POST', body: { amount: Number($('#w-amount', el).value), method, note: $('#w-note', el).value.trim() } });
      toast('Заявка отправлена. Баланс пополнится после проверки');
      renderChrome();
      wallet(el);
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  });
}
