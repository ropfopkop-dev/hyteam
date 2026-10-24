import { api, html, mount, $, $$, fmt, setQuery, debounce, toast, toastError, confirmBox, promptBox } from '../lib.js';
import { state, isAdmin } from '../state.js';
import { icon, cover, avatar, statusBadge, roleBadge, empty, spinner, channelBadge } from '../components.js';
import { approveGame, rejectGame, toggleFeature, deleteGame } from '../modactions.js';
import { refreshMe, renderChrome } from '../app.js';

const TABS = [
  ['queue', 'Очередь', 'clock'],
  ['reports', 'Жалобы', 'flag'],
  ['games', 'Игры', 'gamepad'],
  ['users', 'Пользователи', 'users'],
  ['catalog', 'Каталог программ', 'grid'],
  ['topups', 'Пополнения', 'wallet'],
  ['mail', 'Почта', 'message', true],
  ['log', 'Журнал', 'layers'],
];

const ACTIONS = {
  approve: 'одобрил(а) игру', reject: 'отклонил(а) игру', delete: 'удалил(а)', feature: 'добавил(а) в подборку',
  unfeature: 'убрал(а) из подборки', remove: 'удалил(а) по жалобе', ban: 'заблокировал(а)', unban: 'разблокировал(а)', role: 'сменил(а) роль',
  catalog: 'добавил(а) из каталога', topup: 'пополнил(а) баланс', mail: 'изменил(а) настройки почты:',
};
const TYPES = { game: 'игра', review: 'отзыв', post: 'пост', comment: 'комментарий', user: 'пользователь', settings: 'настройки' };

let refreshOverview = async () => {};

export default async function moderation(el, { query }) {
  const tabs = TABS.filter(([, , , adminOnly]) => !adminOnly || isAdmin());
  let tab = tabs.some(([t]) => t === query.tab) ? query.tab : 'queue';

  mount(el, html`<div class="page-head">
      <h1>${icon('shield', 26, 'accent')} Модерация</h1>
      <p class="muted">Проверка новых игр, жалобы и управление пользователями</p>
    </div>
    <div class="prof-stats" id="m-stats"></div>
    <div class="tabs big" id="m-tabs"></div>
    <div id="m-body"></div>`);

  refreshOverview = async () => {
    const ov = await api('/mod/overview');
    mount($('#m-stats', el), html`
      <div class="stat card">${icon('clock', 20, 'accent')}<b>${ov.pending}</b><span>Ждут проверки</span></div>
      <div class="stat card">${icon('flag', 20, 'accent')}<b>${ov.reports}</b><span>Открытых жалоб</span></div>
      <div class="stat card">${icon('gamepad', 20, 'accent')}<b>${ov.games}</b><span>Опубликовано</span></div>
      <div class="stat card">${icon('users', 20, 'accent')}<b>${ov.users}</b><span>Пользователей</span></div>
      <div class="stat card">${icon('ban', 20, 'accent')}<b>${ov.banned}</b><span>Заблокировано</span></div>`);
    const badge = { queue: ov.pending, reports: ov.reports };
    mount($('#m-tabs', el), html`${tabs.map(([t, l, ic]) => html`<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${icon(ic, 15)} ${l}${badge[t] ? html`<i class="nav-badge">${badge[t]}</i>` : ''}</button>`)}`);
  };
  await refreshOverview();

  const body = $('#m-body', el);
  const show = () => {
    setQuery({ tab: tab === 'queue' ? '' : tab });
    $$('#m-tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    mount(body, spinner());
    body.onclick = null;
    ({ queue, reports, games, users, catalog, topups, mail, log })[tab](body).catch((e) => mount(body, empty({ ic: 'ban', title: e.message })));
  };
  $('#m-tabs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    show();
  });
  show();
}

async function syncBadge() {
  await Promise.all([refreshMe(), refreshOverview()]);
  renderChrome();
}

// ---------- Очередь ----------

function gameReviewCard(g, { queueMode }) {
  return html`<article class="mod-card card" data-id="${g.id}">
    <div class="mod-card-head">
      <a class="mod-cover" href="#/game/${g.id}">${cover(g)}</a>
      <div class="grow">
        <div class="mod-title"><a href="#/game/${g.id}">${g.title}</a>${statusBadge(g.status)}${g.featured ? html`<span class="chip chip-hot">${icon('fire', 12)} Выбор</span>` : ''}</div>
        <div class="muted xs">от <a href="#/u/${g.developer.username}">${g.developer.display_name}</a> · ${g.genre} · ${g.platform} · v${g.version} · ${queueMode ? `отправлено ${fmt.ago(g.updated_at)}` : `обновлено ${fmt.ago(g.updated_at)}`}</div>
        ${g.tags.length ? html`<div class="tags sm">${g.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>` : ''}
      </div>
    </div>
    ${g.short_desc ? html`<p class="mod-short">${g.short_desc}</p>` : ''}
    ${g.description ? html`<details class="mod-details"><summary>Полное описание</summary><div class="prose">${g.description}</div></details>` : ''}
    ${g.screenshots?.length ? html`<div class="mod-shots">${g.screenshots.map((s) => html`<a href="${s.url}" target="_blank" rel="noopener"><img src="${s.url}" alt="" loading="lazy"></a>`)}</div>` : ''}
    <div class="mod-file">
      ${g.github ? html`<span>${icon('code', 16)} GitHub:</span><a class="link" href="${g.github.url}" target="_blank" rel="noopener noreferrer">${g.github.repo}</a>
        <span class="muted xs">релиз ${g.github.tag || '—'} · новые версии публикуются автоматически</span>` : ''}
      ${g.file_name ? html`<span>${icon('box', 16)} ${g.file_name} · ${fmt.bytes(g.file_size)}</span><a class="link" href="/api/games/${g.id}/download">${icon('download', 14)} Скачать для проверки</a>` : ''}
      ${g.external_url && !g.github ? html`<span>${icon('external', 16)} Внешняя ссылка:</span><a class="link break" href="${g.external_url}" target="_blank" rel="noopener noreferrer">${g.external_url}</a>` : ''}
    </div>
    ${g.status === 'rejected' && g.reject_reason ? html`<div class="reject-note">${icon('ban', 14)} ${g.reject_reason}</div>` : ''}
    <div class="mod-actions">
      ${g.status !== 'approved' ? html`<button class="btn btn-primary btn-sm" data-act="approve">${icon('check', 14)} Одобрить</button>` : ''}
      ${g.status !== 'rejected' ? html`<button class="btn btn-danger btn-sm" data-act="reject">${icon('ban', 14)} ${g.status === 'approved' ? 'Снять с публикации' : 'Отклонить'}</button>` : ''}
      ${g.status === 'approved' ? html`<button class="btn btn-soft btn-sm" data-act="feature">${icon('fire', 14)} ${g.featured ? 'Убрать из подборки' : 'В «Выбор HYTEAM»'}</button>` : ''}
      <a class="btn btn-ghost btn-sm" href="#/game/${g.id}">${icon('eye', 14)} Открыть</a>
      <button class="btn btn-ghost btn-sm" data-act="delete" data-title="${g.title}">${icon('trash', 14)} Удалить</button>
    </div>
  </article>`;
}

function bindGameActions(box, reload) {
  box.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const card = b.closest('[data-id]');
    const id = card.dataset.id;
    const status = card.querySelector('.status')?.classList.contains('st-approved') ? 'approved' : '';
    const fn = {
      approve: () => approveGame(id),
      reject: () => rejectGame(id, { unpublish: status === 'approved' }),
      feature: () => toggleFeature(id),
      delete: () => deleteGame(id, b.dataset.title),
    }[b.dataset.act];
    if (fn && (await fn())) {
      await reload();
      syncBadge();
    }
  };
}

async function queue(box) {
  const [list, versions] = await Promise.all([api('/mod/games?status=pending'), api('/mod/versions')]);
  mount(box, html`
    ${list.length ? html`<div class="mod-list">${list.map((g) => gameReviewCard(g, { queueMode: true }))}</div>` : ''}
    ${versions.length ? html`<h3 class="card-title" style="margin-top:22px">${icon('layers', 18, 'accent')} Новые версии на проверке</h3>
      <div class="mod-list" id="ver-queue">${versions.map((v) => html`<article class="report card" data-vid="${v.id}">
        <div class="report-head"><a class="name" href="#/game/${v.game.id}">${v.game.title}</a> <b>${v.version}</b> ${channelBadge(v.channel)}
          ${v.want_main ? html`<span class="chip">станет основной</span>` : ''}
          <span class="muted xs">от ${v.author?.display_name || '—'} · ${fmt.ago(v.created_at)}</span></div>
        ${v.notes ? html`<div class="report-target">${v.notes.slice(0, 600)}</div>` : ''}
        <div class="mod-file">
          ${v.file_name ? html`<span>${icon('box', 16)} ${v.file_name} · ${fmt.bytes(v.file_size)}</span>` : ''}
          ${v.external_url ? html`<span>${icon('external', 16)}</span><a class="link break" href="${v.external_url}" target="_blank" rel="noopener noreferrer">${v.external_url}</a>` : ''}
          <a class="link" href="/api/games/${v.game.id}/download?v=${v.id}">${icon('download', 14)} Скачать для проверки</a>
        </div>
        <div class="mod-actions">
          <button class="btn btn-primary btn-sm" data-vact="approve">${icon('check', 14)} Одобрить</button>
          <button class="btn btn-danger btn-sm" data-vact="reject">${icon('ban', 14)} Отклонить</button>
        </div>
      </article>`)}</div>` : ''}
    ${!list.length && !versions.length ? empty({ ic: 'check', title: 'Очередь пуста', text: 'Все игры и версии проверены — отличная работа!' }) : ''}`);
  bindGameActions(box, () => queue(box));
  $('#ver-queue', box)?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vact]');
    if (!b) return;
    const vid = b.closest('[data-vid]').dataset.vid;
    try {
      if (b.dataset.vact === 'approve') await api(`/mod/versions/${vid}/approve`, { method: 'POST' });
      else {
        const reason = await promptBox('Отклонить версию', { placeholder: 'Причина — её увидит разработчик', ok: 'Отклонить', danger: true });
        if (!reason) return;
        await api(`/mod/versions/${vid}/reject`, { method: 'POST', body: { reason } });
      }
      toast(b.dataset.vact === 'approve' ? 'Версия одобрена' : 'Версия отклонена');
      await queue(box);
      syncBadge();
    } catch (err) {
      toastError(err);
    }
  });
}

async function games(box, status = 'approved') {
  const list = await api(`/mod/games?status=${status}`);
  mount(box, html`
    <div class="seg mb" id="g-status">${[['approved', 'Опубликованные'], ['rejected', 'Отклонённые'], ['pending', 'На проверке']].map(([v, l]) => html`<button data-s="${v}" class="${v === status ? 'on' : ''}">${l}</button>`)}</div>
    ${list.length ? html`<div class="mod-list">${list.map((g) => gameReviewCard(g, { queueMode: false }))}</div>` : empty({ ic: 'gamepad', title: 'Игр нет' })}`);
  $('#g-status', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) games(box, b.dataset.s);
  });
  bindGameActions(box, () => games(box, status));
}

// ---------- Жалобы ----------

async function reports(box) {
  const list = await api('/mod/reports');
  mount(box, list.length
    ? html`<div class="mod-list">${list.map((r) => html`<article class="report card" data-id="${r.id}">
        <div class="report-head"><span class="chip">${TYPES[r.target_type] || r.target_type}</span>
          <span class="muted xs">от <a href="#/u/${r.reporter.username}">${r.reporter.display_name}</a> · ${fmt.ago(r.created_at)}</span></div>
        <div class="report-reason">${icon('flag', 14, 'accent')} ${r.reason}</div>
        <div class="report-target">${r.target
          ? html`<a href="#${r.target.link}">${r.target.text.length > 300 ? `${r.target.text.slice(0, 300)}…` : r.target.text}</a>`
          : html`<span class="muted">Объект уже удалён</span>`}</div>
        <div class="mod-actions">
          ${r.target ? html`<button class="btn btn-danger btn-sm" data-res="remove">${icon('trash', 14)} ${r.target_type === 'user' ? 'Заблокировать' : r.target_type === 'game' ? 'Снять игру' : 'Удалить'}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-res="dismiss">${icon('x', 14)} Отклонить жалобу</button>
        </div>
      </article>`)}</div>`
    : empty({ ic: 'flag', title: 'Открытых жалоб нет', text: 'Сообщество ведёт себя хорошо.' }));
  box.onclick = async (e) => {
    const b = e.target.closest('[data-res]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.res === 'remove' && !(await confirmBox('Применить меры к объекту жалобы?', { ok: 'Да', danger: true }))) return;
    try {
      await api(`/mod/reports/${id}/resolve`, { method: 'POST', body: { action: b.dataset.res } });
      toast(b.dataset.res === 'remove' ? 'Меры применены' : 'Жалоба отклонена');
      await reports(box);
      syncBadge();
    } catch (err) {
      toastError(err);
    }
  };
}

// ---------- Пользователи ----------

async function users(box) {
  mount(box, html`<div class="input-ic mb">${icon('search', 16)}<input class="input" id="u-q" placeholder="Поиск по логину, имени${isAdmin() ? ' или email' : ''}"></div><div id="u-list"></div>`);
  const listBox = $('#u-list', box);
  const load = async (q = '') => {
    const list = await api(`/mod/users?q=${encodeURIComponent(q)}`);
    mount(listBox, list.length ? html`<div class="table card"><table>
      <thead><tr><th>Пользователь</th><th>Роль</th><th>Игр</th><th>Регистрация</th><th>Активность</th><th></th></tr></thead>
      <tbody>${list.map((u) => html`<tr data-id="${u.id}" class="${u.banned ? 'banned' : ''}">
        <td><a class="u-cell" href="#/u/${u.username}">${avatar(u, 32)}<span><b>${u.display_name}</b><span class="muted xs">@${u.username}${u.email ? ` · ${u.email}` : ''}</span></span></a></td>
        <td>${isAdmin() && u.id !== state.user.id
          ? html`<select class="input sm" data-role>${[['user', 'Игрок'], ['moderator', 'Модератор'], ['admin', 'Администратор']].map(([v, l]) => html`<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`)}</select>`
          : roleBadge(u.role) || html`<span class="muted xs">Игрок</span>`}</td>
        <td>${u.games_count}</td>
        <td class="muted xs">${fmt.short(u.created_at)}</td>
        <td class="muted xs">${u.online ? html`<span class="online-text">в сети</span>` : fmt.ago(u.last_seen)}</td>
        <td>${u.id !== state.user.id && (isAdmin() || u.role === 'user')
          ? html`<button class="btn btn-sm ${u.banned ? 'btn-soft' : 'btn-ghost'}" data-ban="${u.banned ? 0 : 1}">${icon('ban', 14)} ${u.banned ? 'Разблокировать' : 'Заблокировать'}</button>`
          : ''}</td>
      </tr>`)}</tbody></table></div>` : empty({ ic: 'users', title: 'Никого не найдено' }));
  };
  $('#u-q', box).addEventListener('input', debounce((e) => load(e.target.value.trim()), 250));
  listBox.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ban]');
    if (!b) return;
    const banned = b.dataset.ban === '1';
    const row = b.closest('tr');
    if (banned && !(await confirmBox('Заблокировать пользователя?', { ok: 'Заблокировать', danger: true, note: 'Он будет разлогинен и не сможет войти.' }))) return;
    try {
      await api(`/mod/users/${row.dataset.id}/ban`, { method: 'POST', body: { banned } });
      toast(banned ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
      load($('#u-q', box).value.trim());
      refreshOverview();
    } catch (err) {
      toastError(err);
    }
  });
  listBox.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-role]');
    if (!sel) return;
    try {
      await api(`/mod/users/${sel.closest('tr').dataset.id}/role`, { method: 'POST', body: { role: sel.value } });
      toast('Роль изменена');
    } catch (err) {
      toastError(err);
    }
  });
  await load();
}

// ---------- Каталог программ ----------

async function catalog(box) {
  const list = await api('/mod/catalog');
  mount(box, html`
    <p class="muted mb">Популярные программы из официальных источников. Добавленные с GitHub обновляются сами,
      по прямой ссылке — скачиваются внутри программы HYTEAM. Ссылку можно заменить своей прямой ссылкой на файл
      (подойдёт и ссылка-переходник вида vk.ru/away.php?to=…).</p>
    <div class="row-between mb"><span class="muted">${list.filter((c) => c.game_id).length} из ${list.length} уже в магазине</span>
      <button class="btn btn-primary btn-sm" data-add-all>${icon('plus', 14)} Добавить все</button></div>
    ${[...new Set(list.map((c) => c.group))].map((group) => html`<h3 class="card-title" style="margin-top:18px">${group}</h3>
    <div class="catalog">${list.filter((c) => c.group === group).map((c) => html`<article class="cat-item card" data-key="${c.key}">
      <div class="cat-head">
        <span class="gh-ic">${icon(c.source === 'github' ? 'code' : 'download', 18)}</span>
        <div class="grow"><b>${c.title}</b><div class="muted xs">${c.source === 'github' ? html`GitHub · ${c.github} · обновляется автоматически` : 'Прямая ссылка на файл'}</div></div>
        ${c.game_id ? html`<a class="status st-approved" href="#/game/${c.game_id}">${icon('check', 13)} В магазине</a>` : ''}
      </div>
      <p class="muted sm">${c.short_desc}</p>
      ${c.game_id ? '' : html`
        ${c.source === 'link' ? html`<input class="input sm-input" data-url value="${c.url}" placeholder="${c.hint || 'https://… прямая ссылка на файл'}" spellcheck="false">` : ''}
        <button class="btn btn-primary btn-sm" data-add>${icon('plus', 14)} Добавить в магазин</button>`}
    </article>`)}</div>`)}`);
  box.onclick = async (e) => {
    const all = e.target.closest('[data-add-all]');
    if (all) {
      const todo = list.filter((c) => !c.game_id && (c.source !== 'link' || c.url));
      all.disabled = true;
      let done = 0;
      const failed = [];
      for (const c of todo) {
        all.textContent = `Добавляю ${++done} из ${todo.length}: ${c.title}…`;
        try {
          await api(`/mod/catalog/${c.key}`, { method: 'POST', body: {} });
        } catch (err) {
          failed.push(`${c.title}: ${err.message}`);
        }
      }
      toast(failed.length ? `Добавлено ${todo.length - failed.length} из ${todo.length}. Не вышло: ${failed.join('; ')}` : `Добавлено программ: ${todo.length}`, failed.length ? 'err' : 'ok');
      await catalog(box);
      return;
    }
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const card = b.closest('[data-key]');
    b.disabled = true;
    try {
      await api(`/mod/catalog/${card.dataset.key}`, { method: 'POST', body: { url: $('[data-url]', card)?.value.trim() || '' } });
      toast('Добавлено в магазин');
      await catalog(box);
      syncBadge();
    } catch (err) {
      toastError(err);
      b.disabled = false;
    }
  };
}

// ---------- Почта ----------

const MAIL_PRESETS = [
  ['Яндекс', 'smtp.yandex.ru', 465],
  ['Mail.ru', 'smtp.mail.ru', 465],
  ['Gmail', 'smtp.gmail.com', 465],
];

// ---------- Пополнения баланса ----------

const PAY_METHOD = { lolz: 'Lolz', telegram: 'Telegram' };

async function topups(box, status = 'pending') {
  const data = await api(`/mod/topups?status=${status}`);
  const admin = isAdmin();
  mount(box, html`<div class="tabs" id="t-status">
      ${[['pending', 'Ждут проверки'], ['approved', 'Зачислены'], ['rejected', 'Отклонены']].map(([s, l]) => html`<button data-s="${s}" class="${s === status ? 'on' : ''}">${l}</button>`)}
    </div>
    ${data.items.length
      ? html`<div class="mod-list">${data.items.map((t) => html`<article class="report card" data-tid="${t.id}">
          <div class="report-head"><a class="name" href="#/u/${t.username}">${t.display_name}</a> <span class="muted">@${t.username}</span>
            <b>${fmt.money(t.amount)}</b> <span class="chip">${PAY_METHOD[t.method] || t.method}</span>
            <span class="muted xs">${fmt.ago(t.created_at)} · баланс сейчас ${fmt.money(t.balance)}</span></div>
          ${t.note ? html`<div class="report-target">${t.note}</div>` : ''}
          ${status === 'pending' && admin ? html`<div class="mod-actions">
            <input class="input input-sm" type="number" min="1" value="${t.amount}" data-amount style="width:120px" title="Сколько реально пришло">
            <button class="btn btn-primary btn-sm" data-t="approve">${icon('check', 14)} Зачислить</button>
            <button class="btn btn-danger btn-sm" data-t="reject">${icon('ban', 14)} Отклонить</button>
          </div>` : ''}
        </article>`)}</div>`
      : empty({ ic: 'wallet', title: status === 'pending' ? 'Новых заявок нет' : 'Пусто' })}
    ${admin ? html`<form class="card pad" id="pay-form" style="margin-top:22px">
      <h3 class="card-title">${icon('sliders', 18, 'accent')} Реквизиты для пополнения</h3>
      <p class="muted sm mb">Перед зачислением проверьте, что перевод с логином игрока в комментарии действительно пришёл.</p>
      <div class="field"><label for="pay-lolz">Профиль Lolz для переводов</label><input class="input" id="pay-lolz" value="${data.methods.lolz}" placeholder="https://lolz.team/members/…"></div>
      <div class="field"><label for="pay-tg">Ссылка на Telegram-бота</label><input class="input" id="pay-tg" value="${data.methods.telegram}" placeholder="https://t.me/имя_бота"></div>
      <div class="row-end"><button class="btn btn-primary">${icon('check', 15)} Сохранить</button></div>
    </form>` : ''}`);

  $('#t-status', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) topups(box, b.dataset.s);
  });
  box.onclick = async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const card = b.closest('[data-tid]');
    const id = card.dataset.tid;
    try {
      if (b.dataset.t === 'approve') {
        const amount = Number($('[data-amount]', card).value);
        if (!(await confirmBox(`Зачислить ${fmt.money(amount)} на баланс игрока?`, { ok: 'Зачислить' }))) return;
        await api(`/mod/topups/${id}/approve`, { method: 'POST', body: { amount } });
        toast('Баланс пополнен');
      } else {
        const reason = await promptBox('Причина отказа', { placeholder: 'Например: перевод не найден', danger: true, ok: 'Отклонить' });
        if (reason === null) return;
        await api(`/mod/topups/${id}/reject`, { method: 'POST', body: { reason } });
        toast('Заявка отклонена');
      }
      topups(box, status);
    } catch (err) {
      toastError(err);
    }
  };
  $('#pay-form', box)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/mod/payments', { method: 'PUT', body: { lolz: $('#pay-lolz', box).value.trim(), telegram: $('#pay-tg', box).value.trim() } });
      toast('Реквизиты сохранены');
    } catch (err) {
      toastError(err);
    }
  });
}

async function mail(box) {
  const m = await api('/mod/mail');
  mount(box, html`<div class="mail-grid">
    <form class="card pad" id="mail-form">
      <h3 class="card-title">${icon('message', 18, 'accent')} Почтовый сервер (SMTP)</h3>
      <p class="muted sm mb">С этой почты игроки получают коды: подтверждение регистрации, вход с нового устройства, восстановление пароля.
        Пока почта не настроена, регистрация и вход работают без кода — после настройки вход с нового устройства всегда требует код из письма.</p>
      ${m.env ? html`<div class="note">${icon('sliders', 16)}<span>Почта задана переменными окружения SMTP_* на сервере — меняйте её там.</span></div>` : ''}
      <div class="chips mb">${MAIL_PRESETS.map(([n, h, p]) => html`<button type="button" class="chip chip-x" data-preset="${h}" data-port="${p}">${n}</button>`)}</div>
      <div class="form-row">
        <div class="field" style="grid-column: span 2"><label for="m-host">Сервер</label><input class="input" id="m-host" name="host" value="${m.host}" placeholder="smtp.yandex.ru"></div>
        <div class="field"><label for="m-port">Порт</label><input class="input" id="m-port" name="port" type="number" value="${m.port}"></div>
      </div>
      <label class="check mb"><input type="checkbox" id="m-secure" ${m.secure ? 'checked' : ''}> Защищённое соединение SSL/TLS (порт 465)</label>
      <div class="field"><label for="m-user">Логин (адрес почты)</label><input class="input" id="m-user" name="user" value="${m.user}" placeholder="hyteam@yandex.ru" autocomplete="off"></div>
      <div class="field"><label for="m-pass">Пароль приложения</label><input class="input" id="m-pass" name="pass" type="password" placeholder="${m.has_pass ? '•••••••• (сохранён — оставьте пустым, чтобы не менять)' : 'пароль приложения из настроек почты'}" autocomplete="new-password">
        <div class="field-hint">У Яндекса, Mail.ru и Gmail нужен не обычный пароль, а «пароль приложения» — создаётся в настройках безопасности почты.</div></div>
      <div class="field"><label for="m-from">Отправитель</label><input class="input" id="m-from" name="from" value="${m.from}" placeholder="HYTEAM <hyteam@yandex.ru>"></div>
      <div class="row-end">
        <button type="button" class="btn btn-ghost" id="m-off">Выключить почту</button>
        <button class="btn btn-primary" ${m.env ? 'disabled' : ''}>${icon('check', 15)} Сохранить</button>
      </div>
    </form>
    <div class="card pad">
      <h3 class="card-title">${icon('send', 18, 'accent')} Проверка</h3>
      <p class="muted sm mb">Статус: ${m.enabled ? html`<span class="status st-approved">${icon('check', 13)} включена</span>` : html`<span class="status st-pending">${icon('clock', 13)} не настроена</span>`}</p>
      <div class="field"><label for="m-to">Отправить тестовое письмо на</label><input class="input" id="m-to" value="${state.user.email}"></div>
      <button class="btn btn-soft btn-block" id="m-test" ${m.enabled ? '' : 'disabled'}>${icon('send', 15)} Отправить тест</button>
    </div>
  </div>`);

  const form = $('#mail-form', box);
  $$('[data-preset]', box).forEach((b) => b.addEventListener('click', () => {
    $('#m-host', box).value = b.dataset.preset;
    $('#m-port', box).value = b.dataset.port;
    $('#m-secure', box).checked = true;
  }));
  const save = async (body) => {
    try {
      await api('/mod/mail', { method: 'PUT', body });
      toast(body.host ? 'Почта сохранена — отправьте тестовое письмо' : 'Почта выключена');
      state.meta.mailEnabled = !!(body.host && body.from);
      await mail(box);
    } catch (err) {
      toastError(err);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = $('#m-user', box).value.trim();
    save({
      host: $('#m-host', box).value.trim(),
      port: Number($('#m-port', box).value),
      secure: $('#m-secure', box).checked,
      user,
      pass: $('#m-pass', box).value,
      from: $('#m-from', box).value.trim() || user,
    });
  });
  $('#m-off', box).addEventListener('click', async () => {
    if (await confirmBox('Выключить почту?', { ok: 'Выключить', danger: true, note: 'Коды перестанут приходить: регистрация и вход будут работать без них.' })) {
      save({ host: '', port: 465, secure: true, user: '', pass: '', from: '' });
    }
  });
  $('#m-test', box).addEventListener('click', async () => {
    try {
      const r = await api('/mod/mail/test', { method: 'POST', body: { to: $('#m-to', box).value.trim() } });
      toast(`Письмо отправлено на ${r.to}`);
    } catch (err) {
      toastError(err);
    }
  });
}

// ---------- Журнал ----------

async function log(box) {
  const list = await api('/mod/log');
  mount(box, list.length
    ? html`<div class="card log">${list.map((x) => html`<div class="log-row">
        <span class="muted xs">${fmt.short(x.created_at)} ${new Date(x.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        <span><b>${x.display_name}</b> ${ACTIONS[x.action] || x.action} <span class="chip">${TYPES[x.target_type] || x.target_type}</span> ${x.note}</span>
      </div>`)}</div>`
    : empty({ ic: 'layers', title: 'Журнал пуст' }));
}
