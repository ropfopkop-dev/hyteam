import { api, html, mount, fmt, navigate } from '../lib.js';
import { icon, cover, statusBadge, ratingInline, empty } from '../components.js';
import { deleteGame } from '../modactions.js';

export default async function mygames(el) {
  const games = await api('/me/games');
  const sum = (k) => games.reduce((s, g) => s + (g[k] || 0), 0);
  const rated = games.filter((g) => g.rating);
  const avg = rated.length ? rated.reduce((s, g) => s + g.rating, 0) / rated.length : 0;

  mount(el, html`<div class="page-head row-between">
      <div><h1>Мои игры</h1><p class="muted">Панель разработчика: статусы модерации, загрузки и отзывы</p></div>
      <a class="btn btn-primary" href="#/publish">${icon('upload', 16)} Опубликовать игру</a>
    </div>
    <div class="prof-stats">
      <div class="stat card">${icon('gamepad', 20, 'accent')}<b>${games.length}</b><span>Всего игр</span></div>
      <div class="stat card">${icon('check', 20, 'accent')}<b>${games.filter((g) => g.status === 'approved').length}</b><span>Опубликовано</span></div>
      <div class="stat card">${icon('download', 20, 'accent')}<b>${fmt.num(sum('downloads'))}</b><span>Загрузок</span></div>
      <div class="stat card">${icon('users', 20, 'accent')}<b>${fmt.num(sum('owners'))}</b><span>В библиотеках</span></div>
      <div class="stat card">${icon('star', 20, 'accent')}<b>${avg ? avg.toFixed(1).replace('.', ',') : '—'}</b><span>Средняя оценка</span></div>
    </div>
    ${games.length
      ? html`<div class="dev-list">${games.map((g) => html`<div class="dev-row card" data-id="${g.id}">
          <a class="dev-cover" href="#/game/${g.id}">${cover(g)}</a>
          <div class="dev-info">
            <a class="name" href="#/game/${g.id}">${g.title}</a>
            <div class="dev-meta">${statusBadge(g.status)}<span class="muted xs">${g.genre} · v${g.version} · обновлено ${fmt.ago(g.updated_at)}</span></div>
            ${g.status === 'rejected' && g.reject_reason ? html`<div class="reject-note">${icon('ban', 14)} ${g.reject_reason}</div>` : ''}
          </div>
          <div class="dev-nums">
            <div><b>${fmt.num(g.downloads)}</b><span>загрузок</span></div>
            <div><b>${fmt.num(g.owners)}</b><span>игроков</span></div>
            <div>${ratingInline(g)}</div>
          </div>
          <div class="dev-actions">
            <a class="btn btn-soft btn-sm" href="#/publish/${g.id}">${icon('edit', 14)} Изменить</a>
            <button class="icon-btn sm" data-del="${g.id}" data-title="${g.title}" title="Удалить">${icon('trash', 15)}</button>
          </div>
        </div>`)}</div>`
      : empty({
        ic: 'code',
        title: 'Вы ещё не публиковали игры',
        text: 'Загрузите свою первую игру — после проверки модератором она появится в магазине.',
        action: html`<a class="btn btn-primary" href="#/publish">${icon('upload', 16)} Опубликовать игру</a>`,
      })}`);

  el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (await deleteGame(del.dataset.del, del.dataset.title)) navigate('/dev');
  });
}
