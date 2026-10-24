import { api, html, mount, $, $$, fmt } from '../lib.js';
import { state } from '../state.js';
import { icon, cover, gameAction, wishButton, ratingInline, gameRow, avatar, stars, secHead, empty } from '../components.js';

export default async function home(el) {
  const data = await api('/home');
  const spotList = (data.recommended.length ? data.recommended : data.popular).slice(0, 8);
  const hasGames = data.popular.length > 0;

  mount(el, html`<div class="home ${spotList.length ? '' : 'no-side'}">
    <div class="home-main">
      ${hero(data.featured)}
      ${hasGames ? '' : empty({
        ic: 'gamepad',
        title: 'В магазине пока нет игр',
        text: 'Опубликуйте первую игру — она появится здесь после проверки.',
        action: html`<a class="btn btn-primary" href="#/publish">${icon('upload', 16)} Опубликовать игру</a>`,
      })}
      ${gameRow('Рекомендовано для вас', data.recommended, { link: '#/store', ic: 'sparkles', reasons: true })}
      ${gameRow('Популярные игры', data.popular, { link: '#/store?sort=popular', ic: 'fire' })}
      ${gameRow('Новинки', data.fresh, { link: '#/store?sort=new', ic: 'clock' })}
      ${gameRow('Лучшие по отзывам', data.top, { link: '#/store?sort=rating', ic: 'trophy' })}
      <section class="sec">
        ${secHead('Категории', { ic: 'grid' })}
        <div class="genre-grid">${state.meta.genres.map((g) => html`<a class="genre-tile" href="#/store?genre=${encodeURIComponent(g)}">${g}</a>`)}</div>
      </section>
      <div class="home-stats">
        <div><b>${fmt.num(data.stats.games)}</b><span>игр в магазине</span></div>
        <div><b>${fmt.num(data.stats.users)}</b><span>игроков</span></div>
        <a class="btn btn-soft" href="#/community">${icon('users', 16)} Перейти в сообщество</a>
      </div>
    </div>
    ${spotList.length ? html`<aside class="home-side"><div class="spot card" id="spot"></div></aside>` : ''}
  </div>`);

  const stopHero = setupHero($('#hero', el));
  if (spotList.length) setupSpot($('#spot', el), spotList);
  return stopHero;
}

function hero(games) {
  const slides = [brandSlide(), ...games.map(gameSlide)];
  return html`<section class="hero" id="hero">
    ${slides}
    ${slides.length > 1 ? html`<div class="hero-dots">${slides.map((_, i) => html`<button class="${i === 0 ? 'on' : ''}" data-slide="${i}" aria-label="Слайд ${i + 1}"></button>`)}</div>` : ''}
  </section>`;
}

function brandSlide() {
  return html`<div class="hero-slide brand-slide on">
    <div class="hero-content">
      <h1>Лучшие игры<br><span class="grad-text">для твоего ПК</span></h1>
      <p>Игры от HYTEAM и сообщества: публикуй свои проекты, собирай библиотеку и общайся с игроками.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#/store">Перейти в каталог ${icon('arrowRight', 16)}</a>
        <a class="btn btn-ghost" href="#/publish">${icon('upload', 16)} Опубликовать игру</a>
      </div>
    </div>
    <div class="hero-brand-art" aria-hidden="true">
      <span class="orb o1"></span><span class="orb o2"></span>
      <span class="float f1">${icon('gamepad', 30)}</span>
      <span class="float f2">${icon('trophy', 26)}</span>
      <span class="float f3">${icon('users', 26)}</span>
      <img src="/assets/logo.webp" alt="">
    </div>
  </div>`;
}

function gameSlide(g) {
  return html`<div class="hero-slide">
    <div class="hero-bg" style="${g.cover ? `--bg:url('${g.cover}')` : ''}"></div>
    <div class="hero-content">
      <span class="chip chip-hot">${icon('fire', 12)} ${g.featured ? 'Выбор HYTEAM' : 'Популярное'}</span>
      <h1>${g.title}</h1>
      <p>${g.short_desc}</p>
      <div class="hero-meta">${ratingInline(g)}<span class="muted">${g.genre}</span><span class="muted">от ${g.developer.display_name}</span></div>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#/game/${g.id}">Подробнее ${icon('arrowRight', 16)}</a>
        ${gameAction(g, 'btn btn-ghost')}
      </div>
    </div>
    <a class="hero-art" href="#/game/${g.id}">${cover(g)}</a>
  </div>`;
}

function setupHero(root) {
  const slides = $$('.hero-slide', root);
  const dots = $$('.hero-dots button', root);
  if (slides.length < 2) return () => {};
  let i = 0;
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  };
  let timer = setInterval(() => show(i + 1), 7000);
  dots.forEach((d) => d.addEventListener('click', () => {
    clearInterval(timer);
    show(Number(d.dataset.slide));
    timer = setInterval(() => show(i + 1), 7000);
  }));
  return () => clearInterval(timer);
}

function setupSpot(box, list) {
  let i = 0;
  let token = 0;
  const render = async () => {
    const my = ++token;
    const g = list[i];
    box.classList.add('busy');
    let detail;
    let rev;
    try {
      [detail, rev] = await Promise.all([api(`/games/${g.id}`), api(`/games/${g.id}/reviews`)]);
    } catch {
      box.classList.remove('busy');
      return;
    }
    if (my !== token) return;
    box.classList.remove('busy');
    const media = [...(detail.cover ? [detail.cover] : []), ...detail.screenshots.map((s) => s.url)];
    mount(box, html`
      <div class="spot-head">
        <a class="spot-icon" href="#/game/${g.id}">${cover(detail)}</a>
        <div class="spot-titles">
          <a class="spot-title" href="#/game/${g.id}">${detail.title}</a>
          <div class="muted">${detail.genre}</div>
          ${ratingInline(detail)}
        </div>
      </div>
      ${g.reason ? html`<div class="spot-reason">${icon('sparkles', 14)} ${g.reason}</div>` : ''}
      <div class="spot-actions">${gameAction(detail, 'btn btn-primary grow')}${wishButton(detail)}</div>
      <div class="spot-stats">
        <div>${icon('drive', 16)}<span>Размер</span><b>${detail.external ? 'Ссылка' : fmt.bytes(detail.file_size)}</b></div>
        <div>${icon('box', 16)}<span>Версия</span><b>${detail.version}</b></div>
        <div>${icon('code', 16)}<span>Разработчик</span><b>${detail.developer.display_name}</b></div>
      </div>
      ${media.length ? html`<div class="spot-media">
        <a class="spot-shot" href="#/game/${g.id}"><img src="${media[Math.min(1, media.length - 1)]}" alt=""></a>
        ${media.length > 1 ? html`<div class="spot-thumbs">${media.slice(0, 4).map((m) => html`<img src="${m}" alt="">`)}</div>` : ''}
      </div>` : ''}
      <h4>Описание</h4>
      <p class="muted clamp-5">${detail.short_desc || detail.description || 'Описание пока не добавлено.'}</p>
      <a class="link sm" href="#/game/${g.id}">Подробнее</a>
      <div class="sec-head sm"><h4>Отзывы</h4><a class="link sm" href="#/game/${g.id}?tab=reviews">Все отзывы ${icon('arrowRight', 12)}</a></div>
      ${rev.reviews.length
        ? rev.reviews.slice(0, 2).map((r) => html`<div class="mini-review">
            ${avatar(r.user, 34)}
            <div><div class="mini-review-head"><b>${r.user.display_name}</b>${stars(r.rating, 11)}<span class="muted xs">${fmt.short(r.created_at)}</span></div>
            <p class="clamp-2">${r.body || 'Без текста'}</p>
            <span class="muted xs">${icon('thumbsUp', 12)} ${r.helpful}</span></div></div>`)
        : html`<p class="muted sm">Отзывов пока нет</p>`}
      ${list.length > 1 ? html`<div class="spot-nav">
        <button class="icon-btn sm" data-spot="-1" aria-label="Предыдущая">${icon('chevronLeft', 16)}</button>
        <span class="muted xs">${i + 1} из ${list.length}</span>
        <button class="icon-btn sm" data-spot="1" aria-label="Следующая">${icon('chevronRight', 16)}</button></div>` : ''}
    `);
    $$('.spot-thumbs img', box).forEach((t) => t.addEventListener('mouseenter', () => {
      $('.spot-shot img', box).src = t.src;
    }));
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-spot]');
    if (!b) return;
    i = (i + Number(b.dataset.spot) + list.length) % list.length;
    render();
  });
  render();
}
