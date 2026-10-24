import { html, raw, fmt, hue } from './lib.js';
import { state } from './state.js';
import { isDesktop, gameLocal } from './desktop.js';

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  store: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  thumbsUp: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  drive: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  gamepad: '<path d="M6 11h4M8 9v4"/><path d="M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.6-6.58-.7-7.41A4 4 0 0 0 17.32 5z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
};

export function icon(name, size = 20, cls = '') {
  return raw(
    `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`,
  );
}

const initials = (title) =>
  String(title || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function cover(g, cls = '') {
  if (g?.cover) return html`<img class="cover-img ${cls}" src="${g.cover}" alt="" loading="lazy">`;
  return html`<div class="cover-ph ${cls}" style="--h:${hue(g?.title || '')}"><span>${initials(g?.title)}</span></div>`;
}

export function avatar(u, size = 36, { online = false } = {}) {
  const st = `width:${size}px;height:${size}px`;
  const inner = u?.avatar
    ? html`<img class="avatar" src="${u.avatar}" style="${st}" alt="">`
    : html`<span class="avatar avatar-ph" style="${st};font-size:${Math.round(size * 0.42)}px;--h:${hue(u?.username || '')}">${(u?.display_name || u?.username || '?')[0].toUpperCase()}</span>`;
  if (!online) return inner;
  return html`<span class="av-wrap">${inner}<i class="online-dot ${u?.online ? 'on' : ''}"></i></span>`;
}

export function stars(rating, size = 14) {
  const r = Math.round(rating || 0);
  return html`<span class="stars">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= r ? 'on' : ''}">${icon('star', size, 'fill')}</i>`)}</span>`;
}

export function ratingInline(g) {
  if (!g.rating) return html`<span class="rating muted">Нет оценок</span>`;
  return html`<span class="rating">${icon('star', 14, 'fill star-c')}<b>${g.rating.toFixed(1).replace('.', ',')}</b><span class="muted">(${fmt.num(g.reviews_count)})</span></span>`;
}

export function gameAction(g, cls = 'btn btn-primary btn-block') {
  const meta = html`data-ver="${g.version ?? ''}" data-title="${g.title ?? ''}" data-launch="${g.launch ?? ''}" data-genre="${g.genre ?? ''}" data-external="${g.external ? 1 : 0}"`;
  // Платную игру сначала покупают; разработчику и модераторам она доступна и так.
  const free = !g.price || (state.user && (state.user.id === g.developer?.id || ['admin', 'moderator'].includes(state.user.role)));
  if (!g.in_library && !free) return html`<button class="${cls}" data-buy="${g.id}" data-price="${g.price}" ${meta}>${icon('wallet', 16)}<span>Купить за ${fmt.money(g.price)}</span></button>`;
  if (!g.in_library) return html`<button class="${cls}" data-get="${g.id}" ${meta}>${icon('plus', 16)}<span>В библиотеку</span></button>`;
  if (isDesktop) return desktopAction(g, cls, meta);
  const ext = g.external ? raw(' target="_blank" rel="noopener"') : '';
  return html`<a class="${cls}" href="/api/games/${g.id}/download" data-dl="${g.id}"${ext}>${icon('download', 16)}<span>Скачать</span></a>`;
}

// В приложении кнопка показывает состояние игры на компьютере: установить → загрузка → играть.
function desktopAction(g, cls, meta) {
  const base = html`data-gbtn="${g.id}" data-cls="${cls}" ${meta}`;
  const { installed, job, running } = gameLocal(g.id);
  if (job?.state === 'downloading') {
    const p = job.total ? Math.floor((job.received / job.total) * 100) : 0;
    return html`<button class="${cls} btn-progress" style="--p:${p}%" data-cancel="${g.id}" title="Нажмите, чтобы отменить загрузку" ${base}>${icon('download', 16)}<span>${job.total ? `${p}%` : fmt.bytes(job.received)}</span></button>`;
  }
  if (job) return html`<button class="${cls} btn-progress busy" disabled ${base}>${icon('box', 16)}<span>${job.state === 'installing' ? 'Установка…' : 'Подготовка…'}</span></button>`;
  if (running) return html`<button class="${cls} btn-running" disabled ${base}>${icon('gamepad', 16)}<span>В игре</span></button>`;
  if (installed) {
    if (!installed.pinned && g.version && installed.version && installed.version !== g.version) {
      return html`<button class="${cls}" data-install="${g.id}" ${base}>${icon('refresh', 16)}<span>Обновить</span></button>`;
    }
    if (installed.hasExe) {
      const name = installed.exeName || '';
      const label = /\.(iso|img|vhdx?)$/i.test(name) ? 'Открыть образ'
        : /\.msi$/i.test(name) ? 'Установить в Windows'
          : g.genre === 'Программа' ? 'Запустить' : 'Играть';
      return html`<button class="${cls} btn-play" data-play="${g.id}" ${base}>${icon('gamepad', 16)}<span>${label}</span></button>`;
    }
    // Установщик отработал, но окна у программы нет (библиотеки, драйверы) — просто отмечаем, что всё стоит.
    if (installed.installedApp) return html`<button class="${cls}" disabled ${base}>${icon('check', 16)}<span>Установлено</span></button>`;
    return html`<button class="${cls}" data-folder="${g.id}" ${base}>${icon('layers', 16)}<span>Открыть папку</span></button>`;
  }
  return html`<button class="${cls}" data-install="${g.id}" ${base}>${icon('download', 16)}<span>Установить</span></button>`;
}

export function wishButton(g, cls = 'btn btn-soft btn-icon') {
  return html`<button class="${cls} wish ${g.in_wishlist ? 'on' : ''}" data-wish="${g.id}" title="${g.in_wishlist ? 'В избранном' : 'В избранное'}">${icon('heart', 18)}</button>`;
}

export function gameCard(g, { reason = null } = {}) {
  return html`<article class="gcard">
    <a class="gcard-cover" href="#/game/${g.id}">${cover(g)}${g.featured ? html`<span class="chip chip-hot">${icon('fire', 12)} Выбор HYTEAM</span>` : ''}
      ${g.channel && g.channel !== 'stable' ? html`<span class="gcard-channel">${channelBadge(g.channel)}</span>` : ''}</a>
    <button class="gcard-wish wish ${g.in_wishlist ? 'on' : ''}" data-wish="${g.id}" title="В избранное">${icon('heart', 15)}</button>
    <div class="gcard-body">
      <a class="gcard-title" href="#/game/${g.id}" title="${g.title}">${g.title}</a>
      <div class="gcard-meta">${g.category || g.genre}${g.price ? html` · <b class="price">${fmt.money(g.price)}</b>` : ''}</div>
      <div class="gcard-rating">${ratingInline(g)}</div>
      ${reason ? html`<div class="gcard-reason">${icon('sparkles', 12)}<span>${reason}</span></div>` : ''}
      ${gameAction(g, 'btn btn-primary btn-sm btn-block')}
    </div>
  </article>`;
}

export function miniGame(g, extra = '') {
  return html`<a class="mini-game" href="#/game/${g.id}">
    <span class="mini-cover">${cover(g)}</span>
    <span class="mini-info"><b>${g.title}</b><span class="muted xs">${extra || g.genre}</span></span>
    ${g.rating ? html`<span class="mini-rate">${icon('star', 12, 'fill star-c')}${g.rating.toFixed(1).replace('.', ',')}</span>` : ''}
  </a>`;
}

const STATUS = {
  pending: ['На проверке', 'st-pending', 'clock'],
  approved: ['Опубликована', 'st-approved', 'check'],
  rejected: ['Отклонена', 'st-rejected', 'ban'],
};
export const CHANNELS = {
  stable: ['Стабильная', 'ch-stable', 'check'],
  beta: ['Бета', 'ch-beta', 'sparkles'],
  alpha: ['Альфа', 'ch-alpha', 'fire'],
  rc: ['Предрелиз', 'ch-rc', 'clock'],
  unstable: ['Нестабильная', 'ch-unstable', 'flag'],
  broken: ['Нерабочая', 'ch-broken', 'ban'],
};

export function channelBadge(channel, { hideStable = false } = {}) {
  if (hideStable && (!channel || channel === 'stable')) return '';
  const [label, cls, ic] = CHANNELS[channel] || CHANNELS.stable;
  return html`<span class="channel ${cls}">${icon(ic, 12)}${label}</span>`;
}

export function statusBadge(status) {
  const [label, cls, ic] = STATUS[status] || STATUS.pending;
  return html`<span class="status ${cls}">${icon(ic, 13)}${label}</span>`;
}

export function roleBadge(role) {
  if (role === 'admin') return html`<span class="role role-admin">Основатель</span>`;
  if (role === 'moderator') return html`<span class="role role-mod">Модератор</span>`;
  return '';
}

export function empty({ ic = 'gamepad', title, text = '', action = '' }) {
  return html`<div class="empty">
    <div class="empty-ic">${icon(ic, 30)}</div>
    <h3>${title}</h3>
    ${text ? html`<p class="muted">${text}</p>` : ''}
    ${action}
  </div>`;
}

export const spinner = () => html`<div class="loading"><div class="spinner"></div></div>`;

export function secHead(title, { link = '', linkText = 'Смотреть все', scroll = false, ic = '' } = {}) {
  return html`<div class="sec-head">
    <h2>${ic ? icon(ic, 20, 'accent') : ''}${title}</h2>
    <div class="sec-tools">
      ${link ? html`<a class="link" href="${link}">${linkText} ${icon('arrowRight', 14)}</a>` : ''}
      ${scroll ? html`<button class="icon-btn sm" data-scroll="-1" aria-label="Назад">${icon('chevronLeft', 16)}</button><button class="icon-btn sm" data-scroll="1" aria-label="Вперёд">${icon('chevronRight', 16)}</button>` : ''}
    </div>
  </div>`;
}

export function gameRow(title, games, opts = {}) {
  if (!games.length) return '';
  return html`<section class="sec">
    ${secHead(title, { ...opts, scroll: games.length > 4 })}
    <div class="row-scroll">${games.map((g) => gameCard(g, { reason: opts.reasons ? g.reason : null }))}</div>
  </section>`;
}

export function userCard(u, actions = '') {
  return html`<div class="ucard">
    <a href="#/u/${u.username}">${avatar(u, 48, { online: true })}</a>
    <div class="ucard-info">
      <a class="name" href="#/u/${u.username}">${u.display_name}</a> ${roleBadge(u.role)}
      <div class="muted xs">@${u.username} · ${u.online ? html`<span class="online-text">в сети</span>` : 'не в сети'}</div>
    </div>
    <div class="ucard-actions">${actions}</div>
  </div>`;
}
