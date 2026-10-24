import { html, mount, $, fmt, toastError } from '../lib.js';
import { icon, empty } from '../components.js';
import { hy, isDesktop, activeJobs, installedList, onGamesChange } from '../desktop.js';

// Скорость считаем по последним ~5 секундам, чтобы цифра не прыгала.
const samples = new Map();
function speedOf(id, received) {
  const now = Date.now();
  const list = (samples.get(id) || []).filter((s) => now - s.t < 5000);
  list.push({ t: now, r: received });
  samples.set(id, list);
  const first = list[0];
  return now - first.t > 500 ? ((received - first.r) * 1000) / (now - first.t) : 0;
}

function eta(left, speed) {
  if (!speed || left <= 0) return '';
  const s = Math.round(left / speed);
  if (s < 60) return `${s} с`;
  if (s < 3600) return `${Math.round(s / 60)} мин`;
  return `${Math.floor(s / 3600)} ч ${Math.round((s % 3600) / 60)} мин`;
}

export default async function downloads(el) {
  if (!isDesktop) {
    mount(el, empty({ ic: 'download', title: 'Загрузки доступны в программе HYTEAM для Windows' }));
    return;
  }

  mount(el, html`<div class="page-head">
      <h1>${icon('download', 26, 'accent')} Загрузки</h1>
      <p class="muted">Что сейчас скачивается и устанавливается. Программу можно свернуть — загрузки продолжатся в фоне.</p>
    </div>
    <section class="card pad dl-sec"><h3 class="card-title">Сейчас</h3><div id="dl-active"></div></section>
    <section class="card pad dl-sec"><h3 class="card-title">Недавно установлено</h3><div id="dl-done"></div></section>`);

  function render() {
    const jobs = activeJobs();
    mount($('#dl-active', el), jobs.length
      ? html`${jobs.map(({ id, job }) => {
          const p = job.total ? Math.floor((job.received / job.total) * 100) : 0;
          const speed = job.state === 'downloading' ? speedOf(id, job.received) : 0;
          const status = job.state === 'downloading'
            ? html`${fmt.bytes(job.received)}${job.total ? html` из ${fmt.bytes(job.total)}` : ''}${speed ? html` · ${fmt.bytes(speed)}/с` : ''}${job.total && speed ? html` · осталось ${eta(job.total - job.received, speed)}` : ''}`
            : job.state === 'installing' ? 'Установка… окно установщика может появиться поверх' : 'Подготовка…';
          return html`<div class="dl-row">
            <div class="dl-info"><a class="name" href="#/game/${id}">${job.title || `Игра #${id}`}</a><span class="muted xs">${status}</span>
              <div class="dl-bar ${job.state !== 'downloading' ? 'busy' : ''}"><i style="width:${job.state === 'downloading' ? p : 100}%"></i></div></div>
            ${job.state === 'downloading' ? html`<b class="dl-pct">${job.total ? `${p}%` : ''}</b>
              <button class="btn btn-ghost btn-sm" data-cancel-dl="${id}">${icon('x', 14)} Отменить</button>` : ''}
          </div>`;
        })}`
      : html`<p class="muted">Ничего не скачивается. Установить игру или программу можно в <a class="link" href="#/store">магазине</a> или <a class="link" href="#/library">библиотеке</a>.</p>`);

    const done = installedList().slice(0, 12);
    mount($('#dl-done', el), done.length
      ? html`${done.map(({ id, installed }) => html`<div class="dl-row">
          <div class="dl-info"><a class="name" href="#/library?id=${id}">${installed.title}</a>
            <span class="muted xs">${installed.version ? `версия ${installed.version} · ` : ''}${fmt.bytes(installed.size)} · ${fmt.ago(installed.installedAt)}</span></div>
          ${installed.hasExe ? html`<button class="btn btn-primary btn-sm" data-play="${id}">${icon('gamepad', 14)} Запустить</button>` : ''}
        </div>`)}`
      : html`<p class="muted">Пока ничего не установлено.</p>`);
  }

  render();
  const stop = onGamesChange(render);
  // Пока что-то качается, обновляем скорость и раз в секунду, даже без новых событий.
  const timer = setInterval(() => activeJobs().length && render(), 1000);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel-dl]');
    if (!b) return;
    try {
      await hy.cancel(b.dataset.cancelDl);
    } catch (err) {
      toastError(err);
    }
  });
  return () => {
    stop();
    clearInterval(timer);
  };
}
