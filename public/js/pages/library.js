import { api, html, raw, mount, $, $$, fmt, setQuery, toast, toastError, confirmBox } from '../lib.js';
import { icon, cover, empty, ratingInline, gameAction } from '../components.js';
import { hy, isDesktop, gameLocal, onGamesChange } from '../desktop.js';

export default async function library(el, { query }) {
  let games = await api('/library');
  if (!games.length) {
    mount(el, empty({
      ic: 'layers',
      title: 'Ваша библиотека пуста',
      text: 'Добавляйте игры из магазина — они появятся здесь, и их можно будет скачать в любой момент.',
      action: html`<a class="btn btn-primary" href="#/store">${icon('store', 16)} В магазин</a>`,
    }));
    return;
  }
  let selected = games.find((g) => String(g.id) === query.id) || games[0];
  let filter = '';
  let onlyInstalled = false;
  // Категории программ, которые есть в библиотеке; «Игры» — всё без категории.
  let cat = query.cat || '';
  const cats = [...new Set(games.map((g) => g.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const hasGames = games.some((g) => !g.category);
  const catCount = (c) => games.filter((g) => (c === '-' ? !g.category : g.category === c)).length;

  mount(el, html`<div class="lib">
    <aside class="lib-list card">
      <div class="input-ic">${icon('search', 16)}<input class="input" id="lib-q" type="search" placeholder="Поиск в библиотеке"></div>
      ${isDesktop ? html`<div class="seg lib-seg" id="lib-seg"><button class="on" data-only="0">Все</button><button data-only="1">Установленные</button></div>` : ''}
      ${cats.length ? html`<select class="input lib-cat" id="lib-cat" aria-label="Категория">
        <option value="">Все категории (${games.length})</option>
        ${hasGames ? html`<option value="-" ${cat === '-' ? 'selected' : ''}>Игры (${catCount('-')})</option>` : ''}
        ${cats.map((c) => html`<option value="${c}" ${cat === c ? 'selected' : ''}>${c} (${catCount(c)})</option>`)}
      </select>` : ''}
      <div class="lib-count" id="lib-count"></div>
      <div class="lib-items" id="lib-items"></div>
    </aside>
    <section class="lib-detail" id="lib-detail"></section>
  </div>`);

  const list = $('#lib-items', el);
  const detail = $('#lib-detail', el);

  function renderList() {
    const shown = games.filter((g) => g.title.toLowerCase().includes(filter) && (!onlyInstalled || gameLocal(g.id).installed)
      && (!cat || (cat === '-' ? !g.category : g.category === cat)));
    const label = cat === '-' ? 'ИГРЫ' : cat ? cat.toUpperCase() : 'ВСЁ';
    $('#lib-count', el).textContent = `${label}${onlyInstalled ? ' · УСТАНОВЛЕННЫЕ' : ''} (${shown.length})`;
    mount(list, html`${shown.map((g) => {
      const loc = isDesktop ? gameLocal(g.id) : {};
      const outdated = isDesktop ? !!loc.installed && !loc.installed.pinned && loc.installed.version !== g.version : g.update_available;
      const marker = loc.running
        ? html`<i class="lib-mark run" title="Запущена">${icon('gamepad', 12)}</i>`
        : loc.job
          ? html`<i class="lib-mark dl" title="Загружается">${icon('download', 12)}</i>`
          : outdated
            ? html`<i class="lib-upd" title="Доступно обновление"></i>`
            : '';
      return html`<button class="lib-item ${g.id === selected.id ? 'on' : ''} ${isDesktop && !loc.installed ? 'dim' : ''}" data-id="${g.id}">
        <span class="lib-thumb">${cover(g)}</span>
        <span class="lib-name">${g.title}</span>
        ${marker}
        ${!g.available ? html`<i class="lib-off" title="Недоступна">${icon('clock', 12)}</i>` : ''}
      </button>`;
    })}
    ${shown.length ? '' : html`<p class="muted xs pad">${onlyInstalled ? 'Нет установленных игр' : 'Ничего не найдено'}</p>`}`);
  }

  function webAction(g) {
    const ext = g.external ? raw(' target="_blank" rel="noopener"') : '';
    const label = g.update_available ? 'Обновить' : g.last_download_at ? 'Скачать снова' : 'Скачать';
    return html`<a class="btn btn-primary btn-lg" href="/api/games/${g.id}/download" data-dl="${g.id}" id="lib-dl"${ext}>${icon(g.update_available ? 'refresh' : 'download', 18)} ${label}</a>`;
  }

  function renderDetail() {
    const g = selected;
    const loc = isDesktop ? gameLocal(g.id) : {};
    const inst = loc.installed;
    mount(detail, html`
      <div class="lib-hero">
        <div class="lib-hero-bg" style="${g.cover ? `--bg:url('${g.cover}')` : ''}"></div>
        <div class="lib-hero-in">
          <span class="lib-hero-cover">${cover(g)}</span>
          <div>
            <h1>${g.title}</h1>
            <div class="muted">${g.developer.display_name} · ${g.genre} · ${g.platform}</div>
            ${ratingInline(g)}
          </div>
        </div>
      </div>
      <div class="lib-bar card">
        ${!g.available
          ? html`<span class="status st-pending">${icon('clock', 13)} Недоступна — игра на модерации</span>`
          : isDesktop ? gameAction(g, 'btn btn-primary btn-lg') : webAction(g)}
        ${isDesktop
          ? html`
            <div class="lib-stat"><span>Вы играли</span><b>${fmt.hours(g.playtime)}</b></div>
            <div class="lib-stat"><span>Последний запуск</span><b>${g.last_played_at ? fmt.ago(g.last_played_at) : 'Ещё не запускали'}</b></div>
            <div class="lib-stat"><span>${inst ? 'На диске' : 'Размер'}</span><b>${inst ? fmt.bytes(inst.size) : g.external ? 'Внешняя ссылка' : fmt.bytes(g.file_size)}</b></div>`
          : html`
            <div class="lib-stat"><span>Последняя загрузка</span><b>${g.last_download_at ? fmt.ago(g.last_download_at) : 'Ещё не скачивали'}</b></div>
            <div class="lib-stat"><span>Версия</span><b>${g.version}</b></div>
            <div class="lib-stat"><span>Размер</span><b>${g.external ? 'Внешняя ссылка' : fmt.bytes(g.file_size)}</b></div>`}
        ${inst && !inst.pinned && inst.version !== g.version ? html`<span class="chip chip-accent">${icon('sparkles', 12)} Вышла версия ${g.version}</span>` : ''}
        ${inst?.pinned ? html`<span class="chip" title="Выбрана вручную — автообновление выключено. Основную версию можно поставить на странице игры.">${icon('flag', 12)} Закреплена версия ${inst.version}</span>` : ''}
        ${!isDesktop && g.update_available ? html`<span class="chip chip-accent">${icon('sparkles', 12)} Вышло обновление</span>` : ''}
        <div class="grow"></div>
        ${inst ? html`
          <button class="icon-btn" data-act="folder" title="Открыть папку игры">${icon('layers', 18)}</button>
          <button class="icon-btn" data-act="exe" title="Указать файл запуска (.exe)">${icon('sliders', 18)}</button>
          <button class="icon-btn" data-act="uninstall" title="Удалить с компьютера">${icon('x', 18)}</button>` : ''}
        <a class="icon-btn" href="#/game/${g.id}" title="Страница в магазине">${icon('store', 18)}</a>
        <button class="icon-btn" data-act="remove" title="Убрать из библиотеки">${icon('trash', 18)}</button>
      </div>
      ${inst ? html`<div class="lib-install muted xs">${icon('check', 13)} Установлена версия ${inst.version || '—'} в <span class="path-text">${inst.dir}</span>${inst.exeName ? html` · запуск: <b>${inst.exeName}</b>` : html` · <b class="warn-text">файл запуска не найден</b>`}</div>` : ''}
      <div class="lib-cols">
        <div class="card pad">
          <h3 class="card-title">Об игре</h3>
          <p class="prose clamp-8">${g.description || g.short_desc || 'Описание пока не добавлено.'}</p>
          <a class="link" href="#/game/${g.id}">Открыть страницу игры ${icon('arrowRight', 14)}</a>
        </div>
        <div class="card pad">
          <h3 class="card-title">Быстрые действия</h3>
          <a class="side-link" href="#/game/${g.id}?tab=reviews">${icon('star', 18)} Оставить отзыв</a>
          <a class="side-link" href="#/community?game=${g.id}">${icon('message', 18)} Обсуждения игры</a>
          <a class="side-link" href="#/u/${g.developer.username}">${icon('code', 18)} Профиль разработчика</a>
          <div class="muted xs lib-added">В библиотеке с ${fmt.date(g.added_at)} · версия ${g.version}</div>
        </div>
      </div>`);

    $('#lib-dl', detail)?.addEventListener('click', () => {
      setTimeout(() => {
        g.last_download_at = Date.now();
        g.update_available = false;
        renderList();
        renderDetail();
      }, 600);
    });
  }

  detail.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const g = selected;
    try {
      if (b.dataset.act === 'folder') await hy.openFolder(g.id);
      if (b.dataset.act === 'exe') await hy.chooseExe(g.id);
      if (b.dataset.act === 'uninstall') {
        if (!(await confirmBox(`Удалить «${g.title}» с компьютера?`, { ok: 'Удалить файлы', danger: true, note: 'Игра останется в библиотеке, её можно будет установить снова. Сохранения внутри папки игры будут удалены.' }))) return;
        await hy.uninstall(g.id);
        toast('Игра удалена с компьютера');
      }
      if (b.dataset.act === 'remove') {
        if (!(await confirmBox(`Убрать «${g.title}» из библиотеки?`, { ok: 'Убрать', danger: true }))) return;
        await api(`/games/${g.id}/library`, { method: 'DELETE' });
        toast('Игра убрана из библиотеки');
        games = games.filter((x) => x.id !== g.id);
        if (!games.length) return library(el, { query: {} });
        selected = games[0];
        renderList();
        renderDetail();
      }
    } catch (err) {
      toastError(err);
    }
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    selected = games.find((g) => String(g.id) === b.dataset.id);
    setQuery({ id: selected.id, cat });
    $$('.lib-item', list).forEach((x) => x.classList.toggle('on', x === b));
    renderDetail();
  });
  $('#lib-q', el).addEventListener('input', (e) => {
    filter = e.target.value.trim().toLowerCase();
    renderList();
  });
  $('#lib-cat', el)?.addEventListener('change', (e) => {
    cat = e.target.value;
    setQuery({ id: selected.id, cat });
    renderList();
  });
  $('#lib-seg', el)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-only]');
    if (!b) return;
    onlyInstalled = b.dataset.only === '1';
    $$('#lib-seg button', el).forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });

  renderList();
  renderDetail();

  // Обновляем список и карточку, когда игра загружается, устанавливается или закрывается.
  return onGamesChange((ev) => {
    const g = games.find((x) => x.id === Number(ev.id));
    if (!g) return;
    if (ev.playtime != null) {
      g.playtime = ev.playtime;
      g.last_played_at = Date.now();
    }
    renderList();
    if (g.id === selected.id && !(ev.job?.state === 'downloading' && ev.playtime == null && $('[data-cancel]', detail))) renderDetail();
  });
}
