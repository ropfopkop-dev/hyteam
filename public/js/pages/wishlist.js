import { api, html, mount } from '../lib.js';
import { icon, gameCard, empty } from '../components.js';

export default async function wishlist(el) {
  const games = await api('/wishlist');
  mount(el, html`<div class="page-head">
      <h1>Избранное</h1>
      <p class="muted">Игры, которые вы отметили сердечком</p>
    </div>
    ${games.length
      ? html`<div class="grid-games">${games.map((g) => gameCard(g))}</div>`
      : empty({
        ic: 'heart',
        title: 'В избранном пока пусто',
        text: 'Нажмите на сердечко у любой игры, чтобы не потерять её.',
        action: html`<a class="btn btn-primary" href="#/store">${icon('store', 16)} В магазин</a>`,
      })}`);
}
