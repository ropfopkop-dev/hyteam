import { api, html, mount, $, $$, on, toast, toastError, promptBox, confirmBox, debounce, navigate, fmt } from './lib.js';
import { state, isMod } from './state.js';
import { icon, avatar, cover, gameAction, empty, spinner } from './components.js';
import { hy, isDesktop, initDesktop, activeJobs } from './desktop.js';
import downloads from './pages/downloads.js';
import home from './pages/home.js';
import store from './pages/store.js';
import game from './pages/game.js';
import library from './pages/library.js';
import community from './pages/community.js';
import post from './pages/post.js';
import profile from './pages/profile.js';
import friends from './pages/friends.js';
import wishlist from './pages/wishlist.js';
import publish from './pages/publish.js';
import mygames from './pages/mygames.js';
import moderation from './pages/moderation.js';
import settings from './pages/settings.js';
import wallet from './pages/wallet.js';
import { login, register, reset } from './pages/auth.js';

const routes = [
  { path: '/', page: home },
  { path: '/store', page: store },
  { path: '/game/:id', page: game },
  { path: '/library', page: library, auth: true },
  { path: '/community', page: community },
  { path: '/post/:id', page: post },
  { path: '/u/:username', page: profile },
  { path: '/friends', page: friends, auth: true },
  { path: '/wishlist', page: wishlist, auth: true },
  { path: '/publish', page: publish, auth: true },
  { path: '/publish/:id', page: publish, auth: true },
  { path: '/dev', page: mygames, auth: true },
  { path: '/mod', page: moderation, mod: true },
  { path: '/settings', page: settings, auth: true },
  { path: '/wallet', page: wallet, auth: true },
  { path: '/downloads', page: downloads },
  { path: '/login', page: login, guest: true },
  { path: '/register', page: register, guest: true },
  { path: '/reset', page: reset, guest: true },
];

const NAV = [
  { path: '/', label: 'Главная', ic: 'home' },
  { path: '/store', label: 'Магазин', ic: 'store' },
  { path: '/library', label: 'Библиотека', ic: 'layers', auth: true },
  { path: '/community', label: 'Сообщество', ic: 'users' },
  { path: '/u/me', label: 'Профиль', ic: 'user', auth: true, match: '/u/' },
  { path: '/friends', label: 'Друзья', ic: 'userPlus', auth: true },
  { path: '/wishlist', label: 'Избранное', ic: 'heart', auth: true },
  { path: '/downloads', label: 'Загрузки', ic: 'download', desktop: true, badge: () => activeJobs().length },
  { sep: 'Разработчикам', auth: true },
  { path: '/dev', label: 'Мои игры', ic: 'code', auth: true, match: '/publish' },
  { path: '/mod', label: 'Модерация', ic: 'shield', mod: true, badge: () => state.modPending },
];

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

function matchRoute(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of routes) {
    const rp = r.path.split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { def: r, params };
  }
  return null;
}

// ---------- Оболочка ----------

function renderShell() {
  mount($('#app'), html`<div class="shell">
    <header class="topbar" id="topbar"></header>
    <aside class="sidebar" id="sidebar"></aside>
    <div class="side-scrim" id="scrim"></div>
    <main class="view" id="view"></main>
  </div>`);
  renderTopbar();
  renderSidebar();
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
}

export function renderChrome() {
  renderTopbar();
  renderSidebar();
  markActive();
}

function renderTopbar() {
  const u = state.user;
  const roleLabel = u?.role === 'admin' ? 'Основатель' : u?.role === 'moderator' ? 'Модератор' : 'Игрок';
  mount($('#topbar'), html`
    <button class="icon-btn burger" id="burger" aria-label="Меню">${icon('menu')}</button>
    <a class="brand" href="#/">
      <img src="/assets/logo.webp" alt="HYTEAM">
      <span><b>HYTEAM</b><small>Game Store</small></span>
    </a>
    <div class="search" id="search">
      ${icon('search', 18)}
      <input id="search-input" type="search" placeholder="Поиск игр, жанров, тегов, разработчиков…" autocomplete="off">
      <div class="search-drop" id="search-drop" hidden></div>
    </div>
    <div class="top-right">
      ${u
        ? html`
          <a class="btn btn-soft btn-sm hide-sm" href="#/publish">${icon('upload', 16)}<span>Загрузить игру</span></a>
          <div class="pop-wrap">
            <button class="icon-btn" id="bell" aria-label="Уведомления">${icon('bell')}${state.unread ? html`<i class="badge-dot">${state.unread > 9 ? '9+' : state.unread}</i>` : ''}</button>
            <div class="pop notif-pop" id="notif-pop" hidden></div>
          </div>
          <div class="pop-wrap">
            <button class="user-chip" id="user-chip">
              ${avatar(u, 38)}
              <span class="user-chip-text"><b>${u.display_name}</b><small>${roleLabel}</small></span>
              ${icon('chevronDown', 16, 'muted')}
            </button>
            <div class="pop menu" id="user-menu" hidden>
              <a class="menu-balance" href="#/wallet">${icon('wallet', 16)} Баланс <b>${fmt.money(u.balance)}</b></a>
              <hr>
              <a href="#/u/${u.username}">${icon('user', 16)} Мой профиль</a>
              <a href="#/library">${icon('layers', 16)} Библиотека</a>
              <a href="#/dev">${icon('code', 16)} Мои игры</a>
              <a href="#/settings">${icon('sliders', 16)} Настройки</a>
              <hr>
              <div class="menu-label">Аккаунты на этом устройстве</div>
              <div id="acc-list"></div>
              <a href="#/login?add=1">${icon('userPlus', 16)} Добавить аккаунт</a>
              <hr>
              <button id="logout">${icon('logout', 16)} Выйти</button>
            </div>
          </div>`
        : html`<a class="btn btn-ghost btn-sm" href="#/login">Войти</a><a class="btn btn-primary btn-sm" href="#/register">Регистрация</a>`}
    </div>`);

  $('#burger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  setupSearch();
  if (!u) return;
  $('#user-chip').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop('#user-menu');
    if (!$('#user-menu').hidden) loadAccounts();
  });
  $('#acc-list').addEventListener('click', async (e) => {
    const forget = e.target.closest('[data-forget]');
    const sw = e.target.closest('[data-switch]');
    try {
      if (forget) {
        e.stopPropagation();
        await api('/auth/forget', { method: 'POST', body: { user_id: Number(forget.dataset.forget) } });
        loadAccounts();
      } else if (sw) {
        const res = await api('/auth/switch', { method: 'POST', body: { user_id: Number(sw.dataset.switch) } });
        await switchedTo(res.user);
      }
    } catch (err) {
      toastError(err);
    }
  });
  $('#bell').addEventListener('click', (e) => {
    e.stopPropagation();
    openNotifications();
  });
  $('#logout').addEventListener('click', async () => {
    const res = await api('/auth/logout', { method: 'POST' });
    if (res.switched) return switchedTo(res.switched);
    state.user = null;
    state.unread = 0;
    state.modPending = 0;
    renderChrome();
    navigate('/');
    toast('Вы вышли из аккаунта');
  });
}

async function loadAccounts() {
  const box = $('#acc-list');
  try {
    const list = (await api('/auth/accounts')).filter((a) => !a.current);
    mount(box, list.length
      ? html`${list.map((a) => html`<div class="acc-row"><button data-switch="${a.id}">${avatar(a, 24)}<span>${a.display_name} <small class="muted">@${a.username}</small></span></button>
          <button class="icon-btn sm" data-forget="${a.id}" title="Убрать с этого устройства">${icon('x', 14)}</button></div>`)}`
      : html`<p class="muted xs menu-note">Других аккаунтов нет</p>`);
  } catch {
    box.replaceChildren();
  }
}

/** После смены аккаунта перерисовываем всё: другая библиотека, роль и уведомления. */
async function switchedTo(user) {
  state.user = user;
  await refreshMe();
  renderChrome();
  toast(`Вы вошли как ${state.user?.display_name || user.display_name}`);
  if (parseHash().path === '/') route();
  else navigate('/');
}

function togglePop(sel) {
  const el = $(sel);
  const willOpen = el.hidden;
  closePops();
  el.hidden = !willOpen;
}
function closePops() {
  $$('.pop').forEach((p) => (p.hidden = true));
  const drop = $('#search-drop');
  if (drop) drop.hidden = true;
}

async function openNotifications() {
  const pop = $('#notif-pop');
  if (!pop.hidden) return closePops();
  closePops();
  pop.hidden = false;
  mount(pop, spinner());
  try {
    const data = await api('/notifications');
    mount(pop, html`<div class="pop-head"><b>Уведомления</b></div>
      ${data.items.length
        ? html`<div class="notif-list">${data.items.map((n) => html`<a class="notif ${n.is_read ? '' : 'unread'}" href="${n.link ? `#${n.link}` : '#/'}">
            <span class="notif-dot"></span><span><span class="notif-text">${n.text}</span><span class="muted xs">${fmt.ago(n.created_at)}</span></span></a>`)}</div>`
        : html`<p class="muted pad">Пока нет уведомлений</p>`}`);
    if (data.unread) {
      await api('/notifications/read', { method: 'POST' });
      state.unread = 0;
      const dot = $('#bell .badge-dot');
      if (dot) dot.remove();
    }
  } catch (e) {
    mount(pop, html`<p class="muted pad">${e.message}</p>`);
  }
}

function setupSearch() {
  const input = $('#search-input');
  const drop = $('#search-drop');
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      drop.hidden = true;
      return;
    }
    try {
      const res = await api(`/games?q=${encodeURIComponent(q)}&limit=6`);
      if (input.value.trim() !== q) return;
      mount(drop, res.items.length
        ? html`${res.items.map((g) => html`<a class="search-item" href="#/game/${g.id}"><span class="search-cover">${cover(g)}</span><span><b>${g.title}</b><span class="muted xs">${g.genre} · ${g.developer.display_name}</span></span></a>`)}
            <a class="search-all" href="#/store?q=${encodeURIComponent(q)}">Все результаты (${res.total}) ${icon('arrowRight', 14)}</a>`
        : html`<div class="muted pad">Ничего не найдено по запросу «${q}»</div>`);
      drop.hidden = false;
    } catch {
      drop.hidden = true;
    }
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => input.value.trim().length >= 2 && run());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      drop.hidden = true;
      navigate(`/store?q=${encodeURIComponent(input.value.trim())}`);
      input.blur();
    }
    if (e.key === 'Escape') {
      drop.hidden = true;
      input.blur();
    }
  });
  drop.addEventListener('click', () => {
    drop.hidden = true;
    input.value = '';
  });
}

function renderSidebar() {
  const items = NAV.filter((n) => (!n.auth || state.user) && (!n.mod || isMod()) && (!n.desktop || isDesktop));
  mount($('#sidebar'), html`
    <nav class="nav">
      ${items.map((n) => (n.sep
        ? html`<div class="nav-sep">${n.sep}</div>`
        : html`<a href="#${n.path}" data-path="${n.match || n.path}">${icon(n.ic)}<span>${n.label}</span>${n.badge?.() ? html`<i class="nav-badge">${n.badge()}</i>` : ''}</a>`))}
    </nav>
    <div class="side-cta">
      <img src="/assets/logo.webp" alt="">
      <b>Опубликуй свою игру</b>
      <p>Загрузи игру — после проверки модератором её увидят все игроки HYTEAM</p>
      <a class="btn btn-primary btn-sm btn-block" href="#/publish">${icon('upload', 16)} Загрузить</a>
    </div>`);
}

function markActive() {
  const { path } = parseHash();
  $$('#sidebar .nav a').forEach((a) => {
    const p = a.dataset.path;
    const active = p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`) || (p === '/u/' && path === `/u/${state.user?.username}`);
    a.classList.toggle('active', active);
  });
}

// ---------- Роутер ----------

let routeToken = 0;
let cleanup = null;

async function route() {
  const { path, query } = parseHash();
  closePops();
  document.body.classList.remove('nav-open');
  markActive();
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* страница уже закрыта */
    }
    cleanup = null;
  }

  const view = $('#view');
  const box = document.createElement('div');
  box.className = 'page';
  mount(box, spinner());
  view.replaceChildren(box);
  view.scrollTop = 0;

  const m = matchRoute(path);
  if (!m) return mount(box, empty({ ic: 'x', title: 'Страница не найдена', action: html`<a class="btn btn-primary" href="#/">На главную</a>` }));
  if (m.def.auth && !state.user) return location.replace(`#/login?next=${encodeURIComponent(location.hash.slice(1))}`);
  if (m.def.mod && !isMod()) return mount(box, empty({ ic: 'shield', title: 'Доступ только для модераторов' }));
  if (m.def.guest && state.user && !query.add) return location.replace('#/');

  const token = ++routeToken;
  try {
    const res = await m.def.page(box, { params: m.params, query });
    if (token === routeToken && typeof res === 'function') cleanup = res;
    else if (typeof res === 'function') res();
  } catch (e) {
    if (token !== routeToken) return;
    console.error(e);
    mount(box, empty({
      ic: e.status === 404 ? 'x' : 'ban',
      title: e.status === 404 ? 'Не найдено' : 'Что-то пошло не так',
      text: e.message,
      action: html`<a class="btn btn-primary" href="#/">На главную</a>`,
    }));
  }
}

// ---------- Общие действия (делегирование) ----------

function requireLogin() {
  if (state.user) return true;
  toast('Войдите, чтобы продолжить', 'info');
  navigate(`/login?next=${encodeURIComponent(location.hash.slice(1))}`);
  return false;
}

function setupGlobalActions() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop-wrap, .search')) closePops();
  });

  on(document, 'click', '[data-get]', async (e, btn) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const id = Number(btn.dataset.get);
    btn.disabled = true;
    try {
      await api(`/games/${id}/library`, { method: 'POST' });
      toast('Игра добавлена в библиотеку');
      $$(`[data-get="${id}"]`).forEach((b) => swap(b, gameAction(gameFromButton(b, id), b.className)));
      $$(`.wish[data-wish="${id}"]`).forEach((w) => w.classList.remove('on'));
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  });

  on(document, 'click', '[data-buy]', async (e, btn) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const id = Number(btn.dataset.buy);
    const price = Number(btn.dataset.price);
    if (state.user.balance < price) {
      toast(`Не хватает ${fmt.money(price - state.user.balance)} — пополните баланс`, 'info');
      return navigate('/wallet');
    }
    if (!(await confirmBox(`Купить «${btn.dataset.title}» за ${fmt.money(price)}? Деньги спишутся с баланса HYTEAM.`, { ok: 'Купить' }))) return;
    btn.disabled = true;
    try {
      const res = await api(`/games/${id}/buy`, { method: 'POST' });
      state.user.balance = res.balance;
      renderTopbar();
      toast('Покупка совершена — игра в вашей библиотеке');
      $$(`[data-buy="${id}"]`).forEach((b) => swap(b, gameAction(gameFromButton(b, id), b.className)));
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  });

  on(document, 'click', '[data-wish]', async (e, btn) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const id = btn.dataset.wish;
    const onNow = btn.classList.contains('on');
    try {
      await api(`/games/${id}/wishlist`, { method: onNow ? 'DELETE' : 'POST' });
      $$(`[data-wish="${id}"]`).forEach((b) => b.classList.toggle('on', !onNow));
      toast(onNow ? 'Удалено из избранного' : 'Добавлено в избранное');
    } catch (err) {
      toastError(err);
    }
  });

  on(document, 'click', '[data-dl]', (e) => {
    if (!state.user) {
      e.preventDefault();
      requireLogin();
    }
  });

  on(document, 'click', '[data-report]', async (e, btn) => {
    e.preventDefault();
    if (!requireLogin()) return;
    const [type, id] = btn.dataset.report.split(':');
    const reason = await promptBox('Пожаловаться', { placeholder: 'Опишите, что не так: спам, оскорбления, вредоносный файл…' });
    if (!reason) return;
    try {
      await api('/reports', { method: 'POST', body: { target_type: type, target_id: Number(id), reason } });
      toast('Жалоба отправлена модераторам');
    } catch (err) {
      toastError(err);
    }
  });

  if (isDesktop) {
    const run = (sel, fn) => on(document, 'click', sel, async (e, btn) => {
      e.preventDefault();
      try {
        await fn(btn);
      } catch (err) {
        toastError(err);
      }
    });
    run('[data-install]', (b) => hy.install(b.dataset.install, { title: b.dataset.title, version: b.dataset.ver, launch: b.dataset.launch }));
    run('[data-cancel]', (b) => hy.cancel(b.dataset.cancel));
    run('[data-play]', (b) => hy.play(b.dataset.play));
    run('[data-folder]', (b) => hy.openFolder(b.dataset.folder));
    run('[data-ext-dl]', async (b) => {
      await hy.openExternalGame(b.dataset.extDl);
      toast('Ссылка на игру открыта в браузере');
    });
  }

  on(document, 'click', '[data-scroll]', (_e, btn) => {
    const row = btn.closest('.sec')?.querySelector('.row-scroll');
    if (row) row.scrollBy({ left: Number(btn.dataset.scroll) * row.clientWidth * 0.85, behavior: 'smooth' });
  });
}

function swap(el, content) {
  const tmp = document.createElement('div');
  tmp.innerHTML = content.s;
  el.replaceWith(tmp.firstElementChild);
}

const gameFromButton = (b, id) => ({
  id,
  in_library: true,
  version: b.dataset.ver,
  title: b.dataset.title,
  launch: b.dataset.launch,
  genre: b.dataset.genre,
  external: b.dataset.external === '1',
});

/** Перерисовать все кнопки игры на странице после смены её состояния в приложении. */
let shownJobs = 0;
function rerenderGameButtons(id) {
  $$(`[data-gbtn="${id}"]`).forEach((el) => swap(el, gameAction(gameFromButton(el, id), el.dataset.cls)));
  // Счётчик загрузок в меню слева.
  if (activeJobs().length !== shownJobs) {
    shownJobs = activeJobs().length;
    renderSidebar();
    markActive();
  }
}

export async function refreshMe() {
  try {
    const me = await api('/auth/me');
    state.user = me.user;
    state.unread = me.unread;
    state.modPending = me.mod_pending;
  } catch {
    /* сервер недоступен — оставляем как есть */
  }
}

async function pollMe() {
  if (!state.user || document.hidden) return;
  const before = `${state.unread}:${state.modPending}`;
  await refreshMe();
  if (before !== `${state.unread}:${state.modPending}`) {
    const searchValue = $('#search-input')?.value;
    renderChrome();
    if (searchValue) $('#search-input').value = searchValue;
  }
}

async function boot() {
  try {
    state.meta = await api('/meta');
  } catch (e) {
    document.documentElement.dataset.booted = '1';
    mount($('#app'), empty({ ic: 'ban', title: 'Сервер недоступен', text: e.message }));
    return;
  }
  await refreshMe();
  await initDesktop({ onChange: rerenderGameButtons, onMessage: toast });
  renderShell();
  document.documentElement.dataset.booted = '1';
  try {
    sessionStorage.removeItem('hy-boot-retry');
  } catch {
    /* хранилище недоступно */
  }
  setupGlobalActions();
  window.addEventListener('hashchange', route);
  setInterval(pollMe, 45000);
  route();
}

boot();
