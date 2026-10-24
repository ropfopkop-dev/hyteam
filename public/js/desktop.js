// Связь с десктоп-приложением HYTEAM (Electron). В обычном браузере window.hyteam нет — всё отключается.
import { api } from './lib.js';
import { state } from './state.js';

export const hy = window.hyteam || null;
export const isDesktop = !!hy;

const local = { installed: {}, jobs: {}, running: new Set() };
const listeners = new Set();

/** Подписка на изменения установленных игр (загрузка, установка, запуск, время в игре). */
export function onGamesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function gameLocal(id) {
  return { installed: local.installed[id] || null, job: local.jobs[id] || null, running: local.running.has(Number(id)) };
}

export const installedIds = () => Object.keys(local.installed).map(Number);

async function sendPlaytime(id, minutes) {
  try {
    const r = await api(`/games/${id}/playtime`, { method: 'POST', body: { minutes } });
    await hy.ackPlaytime(id, minutes);
    listeners.forEach((fn) => fn({ id: Number(id), playtime: r.playtime }));
  } catch {
    /* отправим при следующем запуске */
  }
}

const AUTO_KEY = 'hy-autoupdate';
export function autoUpdateEnabled() {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setAutoUpdate(on) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    /* хранилище недоступно */
  }
}

// Как в Steam: если у установленной игры вышла новая версия (например, новый релиз на GitHub) — ставим её сами.
async function checkUpdates(onMessage) {
  if (!autoUpdateEnabled() || !state.user) return;
  let list;
  try {
    list = await api('/library/versions');
  } catch {
    return;
  }
  for (const g of list) {
    const loc = gameLocal(g.id);
    if (!loc.installed || loc.installed.pinned || loc.job || loc.running || !g.version) continue;
    if (loc.installed.version === g.version) continue;
    try {
      await hy.install(g.id, { title: g.title, version: g.version, launch: g.launch });
      onMessage(`Обновляю «${g.title}» до версии ${g.version}`, 'info');
    } catch {
      /* попробуем при следующей проверке */
    }
  }
}

export async function initDesktop({ onChange, onMessage }) {
  if (!hy) return;
  setTimeout(() => checkUpdates(onMessage), 15000);
  setInterval(() => checkUpdates(onMessage), 3 * 60e3);
  document.documentElement.classList.add('desktop');
  hy.onWindowState((s) => document.documentElement.classList.toggle('maximized', !!s.maximized));
  try {
    const snap = await hy.games();
    local.installed = snap.installed;
    local.jobs = snap.jobs;
    local.running = new Set(snap.running);
    for (const [id, minutes] of Object.entries(snap.pendingPlaytime || {})) sendPlaytime(id, minutes);
  } catch {
    return;
  }
  hy.onGameState((ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.installed) local.installed[ev.id] = ev.installed;
    else delete local.installed[ev.id];
    if (ev.job) local.jobs[ev.id] = ev.job;
    else delete local.jobs[ev.id];
    if (ev.running) local.running.add(ev.id);
    else local.running.delete(ev.id);
    onChange(ev.id);
    listeners.forEach((fn) => fn(ev));
    if (ev.error) onMessage(ev.error, 'err');
    else if (ev.notice) onMessage(ev.notice, 'ok');
  });
  hy.onPlaytime((ev) => {
    if (ev.origin === location.origin) sendPlaytime(ev.id, ev.minutes);
  });
}

export const appInfo = () => (hy ? hy.info() : Promise.resolve(null));
