const hy = window.hyteam;
const $ = (s) => document.querySelector(s);

function showError(text) {
  const el = $('#error');
  el.textContent = text || '';
  el.hidden = !text;
}

function setTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const id of ['client', 'host', 'offline']) $(`#${id}`).hidden = name !== id;
}

// ---------- Без сервера: бесплатные программы из сохранённого каталога ----------

let offline = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function offlineButton(g) {
  const job = offline.jobs[g.id];
  const inst = offline.installed[g.id];
  if (job?.state === 'downloading') {
    const p = job.total ? `${Math.floor((job.received / job.total) * 100)}%` : `${Math.round(job.received / 1048576)} МБ`;
    return el('button', { textContent: `${p} · отмена`, onclick: () => hy.offline.cancel(g.id) });
  }
  if (job) return el('button', { textContent: 'Установка…', disabled: true });
  if (offline.running.includes(g.id)) return el('button', { textContent: 'Запущено', disabled: true });
  if (inst?.hasExe) return el('button', { className: 'play', textContent: 'Запустить', onclick: () => run(() => hy.offline.play(g.id)) });
  if (inst) return el('button', { textContent: 'Папка', onclick: () => run(() => hy.offline.openFolder(g.id)) });
  return el('button', { textContent: 'Установить', onclick: () => run(() => hy.offline.install(g.id)) });
}

async function run(fn) {
  showError('');
  try {
    await fn();
  } catch (e) {
    showError(e.message);
  }
}

function renderOffline() {
  const q = $('#offline-q').value.trim().toLowerCase();
  const list = $('#offline-list');
  list.replaceChildren();
  let lastCat = null;
  const items = offline.items.filter((g) => !q || `${g.title} ${g.short_desc} ${g.category}`.toLowerCase().includes(q));
  for (const g of items) {
    const cat = g.category || 'Другое';
    if (cat !== lastCat) list.append(el('div', { className: 'off-cat', textContent: cat }));
    lastCat = cat;
    list.append(el('div', { className: 'off-row' },
      el('div', {}, el('b', { textContent: g.title, title: g.title }), el('small', { textContent: offline.installed[g.id] ? `Установлена · ${offline.installed[g.id].version || g.version}` : g.version || '' })),
      offlineButton(g)));
  }
  if (!items.length) list.append(el('div', { className: 'offline-empty', textContent: 'Ничего не найдено' }));
}

async function initOffline() {
  try {
    offline = await hy.offline.list();
  } catch {
    return;
  }
  if (!offline.items.length) return;
  $('#offline-tab').hidden = false;
  $('#offline-saved').textContent = `Список сохранён ${new Date(offline.savedAt).toLocaleString('ru-RU')} с сервера ${offline.origin.replace(/^https?:\/\//, '')}. Он обновляется при каждом подключении.`;
  $('#offline-q').addEventListener('input', renderOffline);
  renderOffline();
  hy.onGameState((ev) => {
    if (ev.origin !== offline.origin) return;
    if (ev.installed) offline.installed[ev.id] = ev.installed;
    else delete offline.installed[ev.id];
    if (ev.job) offline.jobs[ev.id] = ev.job;
    else delete offline.jobs[ev.id];
    offline.running = offline.running.filter((id) => id !== ev.id);
    if (ev.running) offline.running.push(ev.id);
    if (ev.error) showError(ev.error);
    renderOffline();
  });
  // Сервер не ответил — сразу показываем то, что работает без него.
  if (new URLSearchParams(location.search).get('error')) setTab('offline');
}

async function busy(form, fn) {
  const btn = form.querySelector('.btn');
  btn.disabled = true;
  btn.classList.add('busy');
  showError('');
  try {
    await fn();
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

async function init() {
  showError(new URLSearchParams(location.search).get('error'));
  const info = await hy.info();
  $('#version').textContent = `HYTEAM ${info.version}`;
  $('#url').value = info.mode === 'client' || info.builtInServer || info.discovered ? info.serverUrl : '';
  $('#port').value = info.hostPort || 3000;
  $('#datadir').textContent = info.hostDataDir;
  $('#datadir').title = info.hostDataDir;
  if (info.mode === 'host') setTab('host');

  const recent = $('#recent');
  for (const url of info.recent || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = url.replace(/^https?:\/\//, '');
    b.addEventListener('click', () => {
      $('#url').value = url;
      $('#client').requestSubmit();
    });
    recent.appendChild(b);
  }

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#local').addEventListener('click', (e) => {
    e.preventDefault();
    $('#url').value = 'localhost:3000';
  });
  $('#pick').addEventListener('click', async () => {
    const dir = await hy.chooseDataDir();
    $('#datadir').textContent = dir;
    $('#datadir').title = dir;
  });
  $('#client').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, () => hy.connect($('#url').value));
  });
  $('#host').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, () => hy.host({ port: $('#port').value }));
  });
  $('#url').focus();
  initOffline();
}

init();
