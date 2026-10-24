import { api, html, raw, mount, $, $$, fmt, toast, toastError, confirmBox, navigate, modal, uploadLarge } from '../lib.js';
import { state, isMod } from '../state.js';
import { icon, cover, avatar, stars, ratingInline, gameAction, wishButton, statusBadge, miniGame, roleBadge, spinner, channelBadge, CHANNELS } from '../components.js';
import { hy, isDesktop, gameLocal } from '../desktop.js';
import { approveGame, rejectGame, toggleFeature, deleteGame } from '../modactions.js';
import { postCard, bindPosts } from '../posts.js';

export default async function gamePage(el, { params, query }) {
  const g = await api(`/games/${params.id}`);
  const media = [...(g.cover ? [g.cover] : []), ...g.screenshots.map((s) => s.url)];
  const me = state.user;
  const isDev = me && me.id === g.developer.id;

  mount(el, html`
    ${g.can_edit ? ownerBar(g) : ''}
    <section class="gp-hero">
      <div class="gp-hero-bg" style="${g.cover ? `--bg:url('${g.cover}')` : ''}"></div>
      <div class="gp-hero-in">
        <div class="crumbs"><a href="#/store">Магазин</a>${icon('chevronRight', 14)}<a href="#/store?genre=${encodeURIComponent(g.genre)}">${g.genre}</a></div>
        <h1>${g.title}</h1>
        <div class="gp-sub">
          <a class="dev-link" href="#/u/${g.developer.username}">${avatar(g.developer, 24)} ${g.developer.display_name}</a>
          ${ratingInline(g)}
          <span class="muted">${icon('users', 14)} ${fmt.num(g.owners)} в библиотеках</span>
          ${g.featured ? html`<span class="chip chip-hot">${icon('fire', 12)} Выбор HYTEAM</span>` : ''}
          ${channelBadge(g.channel, { hideStable: true })}
        </div>
        ${g.tags.length ? html`<div class="tags">${g.tags.map((t) => html`<a class="tag" href="#/store?tag=${encodeURIComponent(t)}">${t}</a>`)}</div>` : ''}
      </div>
    </section>

    <div class="gp-grid">
      <div class="gp-main">
        ${media.length ? html`<section class="gallery card">
          <div class="gallery-main">
            <img id="g-main" src="${media[media.length > 1 ? 1 : 0]}" alt="">
            ${media.length > 1 ? html`<button class="gal-nav prev" data-gal="-1" aria-label="Назад">${icon('chevronLeft')}</button><button class="gal-nav next" data-gal="1" aria-label="Вперёд">${icon('chevronRight')}</button>` : ''}
          </div>
          ${media.length > 1 ? html`<div class="gallery-thumbs">${media.map((m, i) => html`<button class="${i === (media.length > 1 ? 1 : 0) ? 'on' : ''}" data-idx="${i}"><img src="${m}" alt="" loading="lazy"></button>`)}</div>` : ''}
        </section>` : ''}

        <section class="card pad">
          <h3 class="card-title">Об игре</h3>
          <div class="prose">${g.description || g.short_desc || 'Описание пока не добавлено.'}</div>
        </section>
        ${g.github?.notes ? html`<section class="card pad">
          <h3 class="card-title">${icon('sparkles', 18, 'accent')} Что нового в версии ${g.version}</h3>
          <div class="prose gh-notes">${g.github.notes}</div>
          <a class="link sm" href="${g.github.url}/releases" target="_blank" rel="noopener">Все версии на GitHub ${icon('external', 13)}</a>
        </section>` : ''}
        ${g.requirements ? html`<section class="card pad"><h3 class="card-title">${icon('monitor', 18, 'accent')} Системные требования</h3><div class="prose">${g.requirements}</div></section>` : ''}
        <section class="card pad" id="versions">${spinner()}</section>
        <section class="card pad" id="reviews">${spinner()}</section>
        <section class="card pad" id="discuss">${spinner()}</section>
      </div>

      <aside class="gp-side">
        <div class="card pad buy">
          <div class="buy-cover">${cover(g)}</div>
          ${g.short_desc ? html`<p class="muted">${g.short_desc}</p>` : ''}
          ${g.status === 'approved'
            ? html`<div class="buy-actions">${gameAction(g, 'btn btn-primary btn-lg grow')}${wishButton(g)}</div>
              <div class="buy-note">${g.in_library ? html`${icon('check', 14)} Игра в вашей библиотеке` : g.price ? html`${icon('wallet', 14)} Цена: <b>${fmt.money(g.price)}</b> · на балансе ${fmt.money(state.user?.balance)}` : html`${icon('gamepad', 14)} Бесплатно`}</div>`
            : html`<div class="note">${icon('clock', 16)} Скачивание откроется после модерации${isDev || isMod() ? html` · <a href="/api/games/${g.id}/download">скачать для проверки</a>` : ''}</div>`}
          <dl class="info-list">
            <div><dt>Разработчик</dt><dd><a href="#/u/${g.developer.username}">${g.developer.display_name}</a></dd></div>
            <div><dt>Жанр</dt><dd><a href="#/store?genre=${encodeURIComponent(g.genre)}">${g.genre}</a></dd></div>
            ${g.category ? html`<div><dt>Категория</dt><dd><a href="#/store?category=${encodeURIComponent(g.category)}">${g.category}</a></dd></div>` : ''}
            <div><dt>Платформа</dt><dd>${g.platform}</dd></div>
            <div><dt>Версия</dt><dd>${g.version}</dd></div>
            ${g.github ? html`<div><dt>Источник</dt><dd><a href="${g.github.url}" target="_blank" rel="noopener">GitHub ${icon('external', 12)}</a></dd></div>
              <div><dt>Обновления</dt><dd>автоматически</dd></div>` : ''}
            <div><dt>Размер</dt><dd>${g.external ? 'Внешняя ссылка' : fmt.bytes(g.file_size)}</dd></div>
            <div><dt>Дата выхода</dt><dd>${fmt.date(g.published_at)}</dd></div>
            <div><dt>Обновлено</dt><dd>${fmt.date(g.updated_at)}</dd></div>
            <div><dt>Загрузок</dt><dd>${fmt.num(g.downloads)}</dd></div>
          </dl>
          ${!isDev ? html`<button class="link muted xs report-link" data-report="game:${g.id}">${icon('flag', 13)} Пожаловаться на игру</button>` : ''}
        </div>
        ${g.more_from_dev.length ? html`<div class="card pad"><h4 class="side-title">Ещё от ${g.developer.display_name}</h4>${g.more_from_dev.map((x) => miniGame(x))}</div>` : ''}
        ${g.similar.length ? html`<div class="card pad"><h4 class="side-title">Похожие игры</h4>${g.similar.map((x) => miniGame(x))}</div>` : ''}
      </aside>
    </div>`);

  setupGallery(el, media);
  setupOwnerBar(el, g);
  renderVersions($('#versions', el), g);
  renderReviews($('#reviews', el), g);
  renderDiscussions($('#discuss', el), g);
  if (query.tab === 'reviews' || query.tab === 'versions') setTimeout(() => $(`#${query.tab}`, el)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

function ownerBar(g) {
  const text = g.status === 'pending'
    ? 'Игра проверяется модераторами и пока не видна в магазине.'
    : g.status === 'rejected'
      ? html`Причина: <b>${g.reject_reason || 'не указана'}</b>`
      : 'Игра опубликована и доступна всем.';
  return html`<div class="owner-bar card">
    <div class="owner-info">${statusBadge(g.status)}<span>${text}</span>
      ${g.github ? html`<span class="gh-source muted">${icon('code', 14)} ${g.github.repo}${g.github.asset ? ` · файл «${g.github.asset}»` : ' · файл подбирается автоматически'} · проверено ${g.github.checked_at ? fmt.ago(g.github.checked_at) : 'ещё не проверялось'}</span>` : ''}
      ${g.github?.error ? html`<span class="reject-note">${icon('ban', 14)} ${g.github.error}</span>` : ''}
    </div>
    <div class="owner-actions">
      ${g.github ? html`<button class="btn btn-sm btn-soft" data-mod="sync">${icon('refresh', 14)} Проверить обновления</button>` : ''}
      ${isMod() && g.status !== 'approved' ? html`<button class="btn btn-sm btn-primary" data-mod="approve">${icon('check', 14)} Одобрить</button>` : ''}
      ${isMod() && g.status !== 'rejected' ? html`<button class="btn btn-sm btn-danger" data-mod="reject">${icon('ban', 14)} ${g.status === 'approved' ? 'Снять с публикации' : 'Отклонить'}</button>` : ''}
      ${isMod() && g.status === 'approved' ? html`<button class="btn btn-sm btn-soft" data-mod="feature">${icon('fire', 14)} ${g.featured ? 'Убрать из подборки' : 'В «Выбор HYTEAM»'}</button>` : ''}
      <a class="btn btn-sm btn-soft" href="#/publish/${g.id}">${icon('edit', 14)} Редактировать</a>
      <button class="btn btn-sm btn-ghost" data-mod="delete">${icon('trash', 14)} Удалить</button>
    </div>
  </div>`;
}

function setupOwnerBar(el, g) {
  $$('[data-mod]', el).forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.mod;
    let ok = false;
    if (act === 'approve') ok = await approveGame(g.id);
    if (act === 'reject') ok = await rejectGame(g.id, { unpublish: g.status === 'approved' });
    if (act === 'feature') ok = await toggleFeature(g.id);
    if (act === 'sync') {
      b.disabled = true;
      try {
        const r = await api(`/games/${g.id}/github/sync`, { method: 'POST' });
        toast(r.changed ? `Обновлено до версии ${r.version}` : `Новых релизов нет — актуальная версия ${r.version}`);
        ok = true;
      } catch (e) {
        toastError(e);
        b.disabled = false;
      }
    }
    if (act === 'delete') {
      if (await deleteGame(g.id, g.title)) navigate('/dev');
      return;
    }
    if (ok) navigate(`/game/${g.id}`);
  }));
}

function setupGallery(el, media) {
  const main = $('#g-main', el);
  if (!main || media.length < 2) {
    main?.addEventListener('click', () => lightbox(media, 0));
    return;
  }
  let idx = 1;
  const show = (i) => {
    idx = (i + media.length) % media.length;
    main.src = media[idx];
    $$('.gallery-thumbs button', el).forEach((b) => b.classList.toggle('on', Number(b.dataset.idx) === idx));
    $(`.gallery-thumbs button[data-idx="${idx}"]`, el)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  $$('.gallery-thumbs button', el).forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.idx))));
  $$('[data-gal]', el).forEach((b) => b.addEventListener('click', () => show(idx + Number(b.dataset.gal))));
  main.addEventListener('click', () => lightbox(media, idx));
}

function lightbox(media, start) {
  let i = start;
  const m = modal(html`<div class="lightbox"><img src="${media[i]}" alt="">
    ${media.length > 1 ? html`<button class="gal-nav prev" data-lb="-1">${icon('chevronLeft')}</button><button class="gal-nav next" data-lb="1">${icon('chevronRight')}</button>` : ''}
    <button class="icon-btn lb-close" data-close>${icon('x')}</button></div>`, { wide: true });
  m.el.classList.add('modal-media');
  $$('[data-lb]', m.el).forEach((b) => b.addEventListener('click', () => {
    i = (i + Number(b.dataset.lb) + media.length) % media.length;
    $('img', m.el).src = media[i];
  }));
}

// ---------- Версии ----------

const channelOptions = (current) => html`${Object.entries(CHANNELS).map(([k, [label]]) => html`<option value="${k}" ${k === current ? 'selected' : ''}>${label}</option>`)}`;

function versionButton(g, v) {
  if (g.price && !g.in_library && !g.can_edit) return html`<span class="muted xs">${icon('wallet', 13)} После покупки</span>`;
  const broken = v.channel === 'broken' ? '1' : '';
  if (isDesktop) {
    const inst = gameLocal(g.id).installed;
    if (inst && inst.version === v.version) return html`<span class="muted xs">${icon('check', 13)} Установлена</span>`;
    return html`<button class="btn btn-soft btn-sm" data-ver-install data-broken="${broken}">${icon('download', 14)} Установить</button>`;
  }
  const ext = v.external ? raw(' target="_blank" rel="noopener"') : '';
  return html`<a class="btn btn-soft btn-sm" href="/api/games/${g.id}/download?v=${v.id}" data-dl="${g.id}" data-ver-dl data-broken="${broken}"${ext}>${icon('download', 14)} Скачать</a>`;
}

function versionRow(g, v) {
  return html`<div class="ver-row ${v.channel}" data-vid="${v.id}">
    <div>
      <div class="ver-title"><span class="ver-name">${v.version}</span>${channelBadge(v.channel)}
        ${v.is_main ? html`<span class="chip">${icon('check', 11)} Основная</span>` : ''}
        ${v.status !== 'approved' ? statusBadge(v.status) : ''}</div>
      <div class="ver-meta">${fmt.date(v.created_at)} · ${v.external ? 'внешняя ссылка' : fmt.bytes(v.file_size)} · ${fmt.num(v.downloads)} загрузок${v.reject_reason ? ` · отклонена: ${v.reject_reason}` : ''}</div>
    </div>
    <div class="ver-actions">
      ${v.status === 'approved' || v.can_edit ? versionButton(g, v) : ''}
      ${v.can_edit ? html`
        <select class="input sm" data-ver-channel title="Метка версии">${channelOptions(v.channel)}</select>
        ${!v.is_main && v.status === 'approved' && v.channel !== 'broken' ? html`<button class="btn btn-ghost btn-sm" data-ver-main title="Сделать основной — её получают по умолчанию">${icon('check', 14)} Основная</button>` : ''}
        <button class="icon-btn sm" data-ver-del title="Удалить версию">${icon('trash', 14)}</button>` : ''}
    </div>
    ${v.notes ? html`<details class="ver-notes"><summary>Что нового</summary><div class="prose">${v.notes}</div></details>` : ''}
  </div>`;
}

async function renderVersions(box, g, showAll = false) {
  let list;
  try {
    list = await api(`/games/${g.id}/versions`);
  } catch (e) {
    mount(box, html`<p class="muted">${e.message}</p>`);
    return;
  }
  if (!list.length && !g.can_edit) {
    box.hidden = true;
    return;
  }
  const shown = showAll ? list : list.slice(0, 6);
  mount(box, html`
    <div class="sec-head"><h3 class="card-title">${icon('layers', 18, 'accent')} Версии <span class="muted">${list.length}</span></h3>
      ${g.can_edit && g.source !== 'github' ? html`<button class="btn btn-soft btn-sm" data-ver-add>${icon('plus', 14)} Добавить версию</button>` : ''}</div>
    ${g.source === 'github' ? html`<p class="muted sm">Версии приходят из релизов GitHub автоматически.${g.can_edit ? ' Метку можно поменять — например, отметить релиз как нерабочий.' : ''}</p>` : ''}
    <div class="ver-list">${shown.length ? shown.map((v) => versionRow(g, v)) : html`<p class="muted">Версий пока нет</p>`}</div>
    ${list.length > shown.length ? html`<button class="btn btn-ghost btn-sm ver-more" data-ver-all>Показать все версии (${list.length})</button>` : ''}`);
  box.verState = { g, list };
  if (!box.verBound) {
    box.verBound = true;
    box.addEventListener('click', (e) => onVersionClick(e, box));
    box.addEventListener('change', (e) => onVersionChange(e, box));
  }
}

const warnBroken = (b) => b.dataset.broken !== '1'
  || confirmBox('Эта версия помечена как нерабочая', { ok: 'Всё равно скачать', danger: true, note: 'Разработчик отметил, что она может не запускаться или работать с ошибками.' });

async function onVersionClick(e, box) {
  const { g, list } = box.verState;
  const b = e.target.closest('[data-ver-add], [data-ver-all], [data-ver-main], [data-ver-del], [data-ver-install], [data-ver-dl]');
  if (!b) return;
  const v = list.find((x) => String(x.id) === b.closest('[data-vid]')?.dataset.vid);
  try {
    if (b.matches('[data-ver-all]')) return renderVersions(box, g, true);
    if (b.matches('[data-ver-add]')) return addVersionDialog(box, g);
    if (b.matches('[data-ver-dl]')) {
      if (b.dataset.broken !== '1') return;
      e.preventDefault();
      if (await warnBroken(b)) window.open(b.href, b.target || '_self');
      return;
    }
    if (b.matches('[data-ver-install]')) {
      if (!state.user) return navigate(`/login?next=/game/${g.id}`);
      if (!(await warnBroken(b))) return;
      if (!g.in_library) await api(`/games/${g.id}/library`, { method: 'POST' });
      await hy.install(g.id, { title: g.title, version: v.version, launch: g.launch, versionId: v.id, pinned: !v.is_main });
      toast(v.is_main ? `Устанавливаю ${g.title} ${v.version}` : `Устанавливаю версию ${v.version} — автообновление для неё выключено`);
      return;
    }
    if (b.matches('[data-ver-main]')) {
      await api(`/versions/${v.id}/main`, { method: 'POST' });
      toast(`Версия ${v.version} теперь основная`);
      return navigate(`/game/${g.id}?tab=versions`);
    }
    if (b.matches('[data-ver-del]')) {
      if (!(await confirmBox(`Удалить версию ${v.version}?`, { ok: 'Удалить', danger: true, note: 'Файл версии будет удалён с сервера.' }))) return;
      await api(`/versions/${v.id}`, { method: 'DELETE' });
      toast('Версия удалена');
      return navigate(`/game/${g.id}?tab=versions`);
    }
  } catch (err) {
    toastError(err);
  }
}

async function onVersionChange(e, box) {
  const sel = e.target.closest('[data-ver-channel]');
  if (!sel) return;
  const { g } = box.verState;
  const vid = sel.closest('[data-vid]').dataset.vid;
  try {
    await api(`/versions/${vid}`, { method: 'PATCH', body: { channel: sel.value } });
    toast(`Метка изменена: ${CHANNELS[sel.value][0]}`);
    renderVersions(box, (await api(`/games/${g.id}`)));
  } catch (err) {
    toastError(err);
  }
}

function addVersionDialog(box, g) {
  let file = null;
  const m = modal(html`<form class="ver-form">
    <h3>Новая версия «${g.title}»</h3>
    <div class="form-row">
      <div class="field"><label for="nv-ver">Номер версии *</label><input class="input" id="nv-ver" maxlength="30" placeholder="например, 1.2.0" required></div>
      <div class="field"><label for="nv-ch">Метка</label><select class="input" id="nv-ch">${channelOptions('stable')}</select></div>
    </div>
    <div class="seg src-seg" id="nv-src"><button type="button" class="on" data-s="file">${icon('upload', 14)} Файл</button><button type="button" data-s="link">${icon('external', 14)} Ссылка</button></div>
    <label class="dropzone" id="nv-drop"><input type="file" id="nv-file" hidden>${icon('upload', 24, 'accent')}<b>Выберите файл версии</b><span class="muted xs">любого размера</span><span class="dz-file" id="nv-info"></span></label>
    <div class="field" id="nv-link" hidden><label for="nv-url">Прямая ссылка на файл</label><input class="input" id="nv-url" type="url" placeholder="https://…"></div>
    <div class="field"><label for="nv-notes">Что нового</label><textarea class="input" id="nv-notes" rows="4" maxlength="20000" placeholder="Исправления, новые функции, известные проблемы"></textarea></div>
    <label class="check"><input type="checkbox" id="nv-main" checked> Сделать основной — её получат все по умолчанию и через автообновление</label>
    <div class="progress" id="nv-progress" hidden><i></i><span></span></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" id="nv-submit">${icon('upload', 15)} Добавить</button></div>
  </form>`, { wide: false });
  const el = m.el;
  let src = 'file';
  $('#nv-src', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    src = b.dataset.s;
    $$('#nv-src button', el).forEach((x) => x.classList.toggle('on', x === b));
    $('#nv-drop', el).hidden = src !== 'file';
    $('#nv-link', el).hidden = src !== 'link';
  });
  $('#nv-ch', el).addEventListener('change', (e) => {
    const main = $('#nv-main', el);
    main.disabled = e.target.value === 'broken';
    if (main.disabled) main.checked = false;
  });
  $('#nv-file', el).addEventListener('change', (e) => {
    file = e.target.files[0] || null;
    $('#nv-info', el).textContent = file ? `${file.name} · ${fmt.bytes(file.size)}` : '';
  });
  $('form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const version = $('#nv-ver', el).value.trim();
    if (!version) return toast('Укажите номер версии', 'err');
    if (src === 'file' && !file) return toast('Выберите файл версии', 'err');
    const body = { version, channel: $('#nv-ch', el).value, notes: $('#nv-notes', el).value, make_main: $('#nv-main', el).checked };
    const bar = $('#nv-progress', el);
    $('#nv-submit', el).disabled = true;
    try {
      if (src === 'file') {
        bar.hidden = false;
        body.upload_id = await uploadLarge(file, {
          onProgress: (p, sent) => {
            $('i', bar).style.width = `${Math.round(p * 100)}%`;
            $('span', bar).textContent = `Загрузка: ${Math.floor(p * 100)}% · ${fmt.bytes(sent)} из ${fmt.bytes(file.size)}`;
          },
        });
      } else body.external_url = $('#nv-url', el).value.trim();
      const r = await api(`/games/${g.id}/versions`, { method: 'POST', body });
      m.close();
      toast(r.status === 'approved' ? `Версия ${version} добавлена` : `Версия ${version} отправлена на проверку`);
      navigate(`/game/${g.id}?tab=versions`);
    } catch (err) {
      toastError(err);
      $('#nv-submit', el).disabled = false;
      bar.hidden = true;
    }
  });
}

// ---------- Отзывы ----------

async function renderReviews(box, g, sort = 'helpful') {
  let data;
  try {
    data = await api(`/games/${g.id}/reviews?sort=${sort}`);
  } catch (e) {
    mount(box, html`<p class="muted">${e.message}</p>`);
    return;
  }
  const me = state.user;
  const isDev = me && me.id === g.developer.id;
  const canReview = me && g.in_library && !isDev && g.status === 'approved';
  const { summary } = data;

  let hint = '';
  if (!me) hint = html`<div class="note"><a href="#/login?next=/game/${g.id}">Войдите</a>, чтобы оставить отзыв</div>`;
  else if (!isDev && !g.in_library && g.status === 'approved') hint = html`<div class="note">Добавьте игру в библиотеку, чтобы оставить отзыв</div>`;

  mount(box, html`
    <div class="sec-head"><h3 class="card-title">${icon('star', 18, 'accent')} Отзывы игроков</h3>
      <div class="seg">${[['helpful', 'Полезные'], ['new', 'Новые']].map(([v, l]) => html`<button class="${sort === v ? 'on' : ''}" data-rsort="${v}">${l}</button>`)}</div>
    </div>
    <div class="rev-summary">
      <div class="rev-avg"><b>${summary.avg ? summary.avg.toFixed(1).replace('.', ',') : '—'}</b>${stars(summary.avg, 16)}<span class="muted">${fmt.count(summary.count, 'отзыв', 'отзыва', 'отзывов')}</span></div>
      <div class="dist">${[5, 4, 3, 2, 1].map((n) => {
        const c = summary.dist[n] || 0;
        const pct = summary.count ? Math.round((c / summary.count) * 100) : 0;
        return html`<div class="dist-row"><span>${n}</span>${icon('star', 12, 'fill star-c')}<div class="bar"><i style="width:${pct}%"></i></div><span class="muted">${c}</span></div>`;
      })}</div>
    </div>
    ${canReview ? reviewForm(data.mine) : hint}
    <div class="reviews">${data.reviews.length ? data.reviews.map(reviewItem) : html`<p class="muted">Отзывов пока нет. Станьте первым!</p>`}</div>`);

  $$('[data-rsort]', box).forEach((b) => b.addEventListener('click', () => renderReviews(box, g, b.dataset.rsort)));

  const form = $('#rev-form', box);
  if (form) {
    let rating = data.mine?.rating || 0;
    const starsEls = $$('[data-star]', form);
    const paint = (n) => starsEls.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= n));
    starsEls.forEach((s) => {
      s.addEventListener('mouseenter', () => paint(Number(s.dataset.star)));
      s.addEventListener('click', () => {
        rating = Number(s.dataset.star);
        paint(rating);
      });
    });
    $('.star-pick', form).addEventListener('mouseleave', () => paint(rating));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!rating) return toast('Поставьте оценку от 1 до 5 звёзд', 'err');
      try {
        await api(`/games/${g.id}/reviews`, { method: 'POST', body: { rating, body: form.body.value } });
        toast(data.mine ? 'Отзыв обновлён' : 'Спасибо за отзыв!');
        renderReviews(box, g, sort);
      } catch (err) {
        toastError(err);
      }
    });
  }

  box.reviewState = { g, sort };
  if (!box.reviewBound) {
    box.reviewBound = true;
    box.addEventListener('click', (e) => onReviewClick(e, box));
  }
}

async function onReviewClick(e, box) {
  const { g, sort } = box.reviewState;
  const del = e.target.closest('[data-del-review]');
  const help = e.target.closest('[data-helpful]');
  if (del) {
    if (!(await confirmBox('Удалить отзыв?', { ok: 'Удалить', danger: true }))) return;
    try {
      await api(`/reviews/${del.dataset.delReview}`, { method: 'DELETE' });
      toast('Отзыв удалён');
      renderReviews(box, g, sort);
    } catch (err) {
      toastError(err);
    }
  }
  if (help) {
    if (!state.user) return toast('Войдите, чтобы голосовать', 'info');
    try {
      const r = await api(`/reviews/${help.dataset.helpful}/helpful`, { method: 'POST' });
      help.classList.toggle('on', r.voted);
      $('span', help).textContent = r.helpful;
    } catch (err) {
      toastError(err);
    }
  }
}

function reviewForm(mine) {
  return html`<form class="rev-form" id="rev-form">
    <div class="rev-form-head"><b>${mine ? 'Ваш отзыв' : 'Напишите отзыв'}</b>
      <div class="star-pick">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" class="${mine && n <= mine.rating ? 'on' : ''}" aria-label="${n} из 5">${icon('star', 24, 'fill')}</button>`)}</div>
    </div>
    <textarea class="input" name="body" rows="3" maxlength="5000" placeholder="Что понравилось, а что нет? Расскажите другим игрокам">${mine?.body || ''}</textarea>
    <div class="row-end">
      ${mine ? html`<button type="button" class="btn btn-ghost btn-sm" data-del-review="${mine.id}">Удалить</button>` : ''}
      <button class="btn btn-primary btn-sm">${mine ? 'Обновить отзыв' : 'Опубликовать'}</button>
    </div>
  </form>`;
}

function reviewItem(r) {
  return html`<article class="review">
    <a href="#/u/${r.user.username}">${avatar(r.user, 42)}</a>
    <div class="review-body">
      <div class="review-head">
        <a class="name" href="#/u/${r.user.username}">${r.user.display_name}</a>${roleBadge(r.user.role)}
        ${stars(r.rating, 13)}
        <span class="muted xs">${fmt.ago(r.created_at)}${r.updated_at > r.created_at + 60000 ? ' · изменён' : ''}</span>
      </div>
      <div class="muted xs">${fmt.count(r.user_games, 'игра', 'игры', 'игр')} в библиотеке</div>
      ${r.body ? html`<p class="prose">${r.body}</p>` : ''}
      <div class="review-foot">
        <button class="pill ${r.voted ? 'on' : ''}" data-helpful="${r.id}">${icon('thumbsUp', 14)} Полезно · <span>${r.helpful}</span></button>
        ${state.user && state.user.id !== r.user.id ? html`<button class="link muted xs" data-report="review:${r.id}">Пожаловаться</button>` : ''}
        ${r.can_delete ? html`<button class="link muted xs" data-del-review="${r.id}">Удалить</button>` : ''}
      </div>
    </div>
  </article>`;
}

// ---------- Обсуждения ----------

async function renderDiscussions(box, g) {
  let res;
  try {
    res = await api(`/posts?game=${g.id}&limit=3`);
  } catch (e) {
    mount(box, html`<p class="muted">${e.message}</p>`);
    return;
  }
  mount(box, html`
    <div class="sec-head"><h3 class="card-title">${icon('message', 18, 'accent')} Обсуждения</h3>
      <a class="btn btn-soft btn-sm" href="#/community?game=${g.id}">${icon('plus', 14)} Новое обсуждение</a></div>
    ${res.items.length
      ? html`<div class="feed compact">${res.items.map((p) => postCard(p))}</div>
        <a class="link" href="#/community?game=${g.id}">Все обсуждения игры ${icon('arrowRight', 14)}</a>`
      : html`<p class="muted">Пока никто ничего не написал об этой игре.</p>`}`);
  bindPosts(box, () => renderDiscussions(box, g));
}
