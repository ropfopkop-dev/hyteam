import { api, html, mount, $, $$, setQuery, debounce, plural } from '../lib.js';
import { state } from '../state.js';
import { icon, gameCard, empty, spinner } from '../components.js';

const SORTS = [
  ['popular', 'Популярные'],
  ['new', 'Новые'],
  ['rating', 'По рейтингу'],
  ['title', 'По названию'],
];
const PAGE = 24;

export default async function store(el, { query }) {
  const f = { q: query.q || '', genre: query.genre || '', category: query.category || '', tag: query.tag || '', sort: query.sort || 'popular' };
  const [genres, cats] = await Promise.all([api('/genres'), api('/categories')]);
  const catCount = Object.fromEntries(cats.map((c) => [c.category, c.count]));
  const counts = Object.fromEntries(genres.map((g) => [g.genre, g.count]));
  const total = genres.reduce((s, g) => s + g.count, 0);

  mount(el, html`<div class="page-head">
      <h1>Магазин</h1>
      <p class="muted">Все игры, прошедшие модерацию HYTEAM</p>
    </div>
    <div class="store">
      <aside class="filters card">
        <div class="field">
          <label>Поиск</label>
          <div class="input-ic">${icon('search', 16)}<input class="input" id="f-q" type="search" placeholder="Название или тег" value="${f.q}"></div>
        </div>
        <div class="field">
          <label>Сортировка</label>
          <div class="seg seg-col" id="f-sort">${SORTS.map(([v, l]) => html`<button data-sort="${v}" class="${f.sort === v ? 'on' : ''}">${l}</button>`)}</div>
        </div>
        <div class="field">
          <label>Жанры</label>
          <div class="genre-list" id="f-genre">
            <button data-genre="" class="${!f.genre ? 'on' : ''}"><span>Все жанры</span><i>${total}</i></button>
            ${state.meta.genres.filter((g) => counts[g]).map((g) => html`<button data-genre="${g}" class="${f.genre === g ? 'on' : ''}"><span>${g}</span><i>${counts[g]}</i></button>`)}
          </div>
        </div>
        ${cats.length ? html`<div class="field">
          <label>Категории программ</label>
          <div class="genre-list" id="f-cat">
            <button data-cat="" class="${!f.category ? 'on' : ''}"><span>Все категории</span></button>
            ${state.meta.categories.filter((c) => catCount[c]).map((c) => html`<button data-cat="${c}" class="${f.category === c ? 'on' : ''}"><span>${c}</span><i>${catCount[c]}</i></button>`)}
          </div>
        </div>` : ''}
      </aside>
      <div class="store-results">
        <div class="store-bar">
          <div id="f-summary" class="muted"></div>
          <div id="f-chips" class="chips"></div>
        </div>
        <div class="grid-games" id="results"></div>
        <div class="center"><button class="btn btn-soft" id="more" hidden>Показать ещё</button></div>
      </div>
    </div>`);

  const results = $('#results', el);
  const more = $('#more', el);
  let offset = 0;
  let token = 0;

  async function load(reset = true) {
    const my = ++token;
    if (reset) {
      offset = 0;
      mount(results, spinner());
    }
    setQuery(f);
    renderChips();
    const qs = new URLSearchParams({ ...f, limit: PAGE, offset });
    const res = await api(`/games?${qs}`);
    if (my !== token) return;
    const cards = res.items.map((g) => gameCard(g).s).join('');
    if (reset) results.innerHTML = cards;
    else results.insertAdjacentHTML('beforeend', cards);
    offset += res.items.length;
    more.hidden = offset >= res.total;
    $('#f-summary', el).textContent = `Найдено: ${res.total} ${plural(res.total, 'игра', 'игры', 'игр')}`;
    if (!res.total) {
      mount(results, empty({
        ic: 'search',
        title: 'Ничего не найдено',
        text: 'Попробуйте изменить запрос или сбросить фильтры.',
      }));
    }
  }

  function renderChips() {
    const chips = [];
    if (f.q) chips.push(['q', `«${f.q}»`]);
    if (f.genre) chips.push(['genre', f.genre]);
    if (f.category) chips.push(['category', f.category]);
    if (f.tag) chips.push(['tag', `#${f.tag}`]);
    mount($('#f-chips', el), html`${chips.map(([k, l]) => html`<button class="chip chip-x" data-clear="${k}">${l} ${icon('x', 12)}</button>`)}`);
  }

  $('#f-q', el).addEventListener('input', debounce((e) => {
    f.q = e.target.value.trim();
    load();
  }, 300));
  $('#f-sort', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    f.sort = b.dataset.sort;
    $$('#f-sort button', el).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#f-genre', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-genre]');
    if (!b) return;
    f.genre = b.dataset.genre;
    $$('#f-genre button', el).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#f-cat', el)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    f.category = b.dataset.cat;
    $$('#f-cat button', el).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#f-chips', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    f[b.dataset.clear] = '';
    if (b.dataset.clear === 'q') $('#f-q', el).value = '';
    if (b.dataset.clear === 'genre') $$('#f-genre button', el).forEach((x) => x.classList.toggle('on', !x.dataset.genre));
    if (b.dataset.clear === 'category') $$('#f-cat button', el).forEach((x) => x.classList.toggle('on', !x.dataset.cat));
    load();
  });
  more.addEventListener('click', () => load(false));

  await load();
}
