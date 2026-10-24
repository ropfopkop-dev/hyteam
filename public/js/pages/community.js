import { api, upload, html, mount, $, $$, setQuery, debounce, toast, toastError } from '../lib.js';
import { state } from '../state.js';
import { icon, avatar, empty, spinner, userCard } from '../components.js';
import { postCard, bindPosts } from '../posts.js';

const PAGE = 15;

export default async function community(el, { query }) {
  const f = { tab: query.tab || 'new', game: query.game || '' };
  const [games, gameInfo] = await Promise.all([
    state.user ? api('/games?sort=title&limit=60').then((r) => r.items) : [],
    f.game ? api(`/games/${f.game}`).catch(() => null) : null,
  ]);

  const tabs = [['new', 'Новое', 'clock'], ['top', 'Популярное', 'fire']];
  if (state.user) tabs.push(['friends', 'Друзья', 'users']);

  mount(el, html`<div class="page-head">
      <h1>Сообщество</h1>
      <p class="muted">Обсуждения, скриншоты и новости от игроков и разработчиков</p>
    </div>
    <div class="comm">
      <div class="comm-main">
        ${state.user ? composer(games, f.game) : html`<div class="card pad note-card">${icon('users', 20, 'accent')}<span>Войдите, чтобы публиковать посты и комментировать.</span><a class="btn btn-primary btn-sm" href="#/login?next=/community">Войти</a></div>`}
        <div class="feed-bar">
          <div class="tabs" id="c-tabs">${tabs.map(([v, l, ic]) => html`<button class="${f.tab === v ? 'on' : ''}" data-tab="${v}">${icon(ic, 15)} ${l}</button>`)}</div>
          ${gameInfo ? html`<a class="chip chip-x" href="#/community">${icon('gamepad', 12)} ${gameInfo.title} ${icon('x', 12)}</a>` : ''}
        </div>
        <div class="feed" id="feed"></div>
        <div class="center"><button class="btn btn-soft" id="more" hidden>Показать ещё</button></div>
      </div>
      <aside class="comm-side">
        <div class="card pad">
          <h4 class="side-title">${icon('search', 16, 'accent')} Найти игроков</h4>
          <input class="input" id="people-q" placeholder="Имя или логин">
          <div id="people" class="people"></div>
        </div>
        <div class="card pad">
          <h4 class="side-title">${icon('shield', 16, 'accent')} Правила сообщества</h4>
          <ul class="rules">
            <li>Уважайте других участников</li>
            <li>Без спама, рекламы и флуда</li>
            <li>Не публикуйте вредоносные файлы и чужие игры</li>
            <li>Увидели нарушение — нажмите «Пожаловаться»</li>
          </ul>
        </div>
      </aside>
    </div>`);

  const feed = $('#feed', el);
  const more = $('#more', el);
  let offset = 0;
  let token = 0;

  async function load(reset = true) {
    const my = ++token;
    if (reset) {
      offset = 0;
      mount(feed, spinner());
    }
    setQuery({ tab: f.tab === 'new' ? '' : f.tab, game: f.game });
    const qs = new URLSearchParams({ limit: PAGE, offset });
    if (f.tab === 'top') qs.set('sort', 'top');
    if (f.tab === 'friends') qs.set('feed', 'friends');
    if (f.game) qs.set('game', f.game);
    const res = await api(`/posts?${qs}`);
    if (my !== token) return;
    const markup = res.items.map((p) => postCard(p).s).join('');
    if (reset) feed.innerHTML = markup;
    else feed.insertAdjacentHTML('beforeend', markup);
    offset += res.items.length;
    more.hidden = !res.has_more;
    if (reset && !res.items.length) {
      mount(feed, empty({
        ic: 'message',
        title: f.tab === 'friends' ? 'Друзья пока ничего не публиковали' : 'Здесь пока пусто',
        text: state.user ? 'Напишите первый пост!' : 'Войдите и начните обсуждение.',
      }));
    }
  }

  bindPosts(feed);
  $('#c-tabs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    f.tab = b.dataset.tab;
    $$('#c-tabs button', el).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  more.addEventListener('click', () => load(false));

  $('#people-q', el).addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $('#people', el);
    if (q.length < 2) return mount(box, '');
    const list = await api(`/users?q=${encodeURIComponent(q)}`);
    mount(box, list.length ? html`${list.slice(0, 6).map((u) => userCard(u))}` : html`<p class="muted xs">Никого не нашли</p>`);
  }, 250));

  if (state.user) setupComposer(el, () => load());
  await load();
}

function composer(games, gameId) {
  return html`<form class="composer card" id="composer">
    <div class="composer-top">
      ${avatar(state.user, 42)}
      <textarea class="input" name="body" rows="1" maxlength="5000" placeholder="Чем хотите поделиться, ${state.user.display_name}?" required></textarea>
    </div>
    <div class="composer-more" ${gameId ? '' : 'hidden'}>
      <input class="input" name="title" maxlength="120" placeholder="Заголовок (необязательно)">
      <div class="composer-row">
        <select class="input" name="game_id">
          <option value="">Без привязки к игре</option>
          ${games.map((g) => html`<option value="${g.id}" ${String(g.id) === String(gameId) ? 'selected' : ''}>${g.title}</option>`)}
        </select>
        <label class="btn btn-soft btn-sm">${icon('image', 16)} <span id="img-name">Картинка</span><input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        <div class="grow"></div>
        <button class="btn btn-primary btn-sm">${icon('send', 15)} Опубликовать</button>
      </div>
      <div class="composer-preview" hidden><img alt=""><button type="button" class="icon-btn xs" data-drop-img>${icon('x', 13)}</button></div>
    </div>
  </form>`;
}

function setupComposer(el, reload) {
  const form = $('#composer', el);
  const more = $('.composer-more', form);
  const ta = form.body;
  const file = form.image;
  const preview = $('.composer-preview', form);
  ta.addEventListener('focus', () => {
    more.hidden = false;
    ta.rows = 3;
  });
  file.addEventListener('change', () => {
    const f = file.files[0];
    $('#img-name', form).textContent = f ? f.name.slice(0, 18) : 'Картинка';
    preview.hidden = !f;
    if (f) $('img', preview).src = URL.createObjectURL(f);
  });
  $('[data-drop-img]', form).addEventListener('click', () => {
    file.value = '';
    file.dispatchEvent(new Event('change'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('body', ta.value.trim());
    fd.append('title', form.elements.namedItem('title').value.trim());
    fd.append('game_id', form.game_id.value);
    if (file.files[0]) fd.append('image', file.files[0]);
    const btn = $('button:not([type])', form);
    btn.disabled = true;
    try {
      await upload('/posts', fd);
      form.reset();
      file.dispatchEvent(new Event('change'));
      ta.rows = 1;
      more.hidden = true;
      toast('Пост опубликован');
      reload();
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
    }
  });
}
