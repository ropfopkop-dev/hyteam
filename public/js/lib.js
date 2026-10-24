// Мини-библиотека: безопасные HTML-шаблоны, запросы к API, тосты, модальные окна, форматирование.

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

/** Шаблон, который экранирует все подстановки (кроме html`` и raw()). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += val(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function mount(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : esc(content ?? '');
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new Error('Нет связи с сервером');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Ошибка ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Загрузка файлов с прогрессом (fetch не умеет показывать прогресс отправки). */
export function upload(path, form, { method = 'POST', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.responseType = 'json';
    if (form instanceof Blob) xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (xhr.status === 413 && !data?.error) {
        // Ответ не от нашего сервера, а от прокси/туннеля с лимитом размера запроса.
        reject(Object.assign(new Error('Файл слишком большой для загрузки через этот адрес. Разместите игру по ссылке или попросите владельца сервера загрузить её.'), { status: 413 }));
      } else reject(Object.assign(new Error(data?.error || `Ошибка ${xhr.status}`), { status: xhr.status, data }));
    };
    xhr.onerror = () => reject(new Error('Нет связи с сервером'));
    xhr.send(form);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Загрузка файла любого размера кусками с докачкой после обрывов связи.
 * Возвращает id загрузки, который передаётся вместе с формой игры (upload_id).
 */
export async function uploadLarge(file, { onProgress } = {}) {
  const init = await api('/uploads', { method: 'POST', body: { name: file.name, size: file.size } });
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const part = file.slice(offset, Math.min(offset + init.chunk, file.size));
    const start = offset;
    try {
      const r = await upload(`/uploads/${init.id}?offset=${start}`, part, {
        method: 'PUT',
        onProgress: (p) => onProgress?.((start + p * part.size) / file.size, start + p * part.size),
      });
      offset = r.received;
      failures = 0;
    } catch (e) {
      if (e.status === 409 && Number.isFinite(e.data?.received)) {
        offset = e.data.received;
        continue;
      }
      if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      if (++failures > 8) throw new Error('Связь с сервером постоянно обрывается — загрузка остановлена');
      await sleep(Math.min(1500 * failures, 10000));
      try {
        offset = (await api(`/uploads/${init.id}`)).received;
      } catch {
        /* попробуем ещё раз с того же места */
      }
    }
    onProgress?.(offset / file.size, offset);
  }
  return init.id;
}

// ---------- Тосты ----------
let toastWrap;
export function toast(text, type = 'ok') {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toasts';
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = text;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3400);
}
export const toastError = (e) => toast(e?.message || String(e), 'err');

// ---------- Модальные окна ----------
export function modal(content, { wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${val(content)}</div>`;
  document.body.appendChild(back);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.classList.add('out');
    setTimeout(() => back.remove(), 160);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => e.target === back && close());
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  const first = $('input, textarea, select', back);
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back.firstElementChild, close };
}

export function confirmBox(text, { ok = 'Подтвердить', danger = false, note = '' } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const m = modal(
      html`<h3>${text}</h3>${note ? html`<p class="muted">${note}</p>` : ''}
        <div class="modal-actions"><button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button></div>`,
      { onClose: () => resolve(answer) },
    );
    $('[data-ok]', m.el).addEventListener('click', () => {
      answer = true;
      m.close();
    });
  });
}

export function promptBox(title, { placeholder = '', ok = 'Отправить', value = '', multiline = true, danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = null;
    const m = modal(
      html`<form class="prompt-form"><h3>${title}</h3>
        ${multiline
          ? html`<textarea class="input" rows="4" maxlength="500" placeholder="${placeholder}" required>${value}</textarea>`
          : html`<input class="input" maxlength="500" placeholder="${placeholder}" value="${value}" required>`}
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${ok}</button></div></form>`,
      { onClose: () => resolve(answer) },
    );
    $('form', m.el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('textarea, input', m.el).value.trim();
      if (!v) return;
      answer = v;
      m.close();
    });
  });
}

// ---------- Форматирование ----------
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const fmt = {
  date: (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'),
  short: (ts) => (ts ? new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'),
  ago(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'только что';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
    return fmt.short(ts);
  },
  bytes(n) {
    if (!n) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i ? n.toFixed(1).replace('.', ',') : Math.round(n)} ${units[i]}`;
  },
  num(n) {
    n = n || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace('.0', '').replace('.', ',')}k`;
    return `${(n / 1e6).toFixed(1).replace('.0', '').replace('.', ',')}M`;
  },
  money: (n) => `${(n || 0).toLocaleString('ru-RU')} ₽`,
  count: (n, one, few, many) => `${n} ${plural(n, one, few, many)}`,
  hours(minutes) {
    if (!minutes) return '0 ч';
    if (minutes < 60) return `${minutes} мин`;
    const h = minutes / 60;
    return `${h < 10 ? h.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(h)} ч`;
  },
};

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function navigate(path) {
  if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
}

/** Обновить query-параметры текущей страницы без перерисовки. */
export function setQuery(params) {
  const [path] = location.hash.slice(1).split('?');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) qs.set(k, v);
  const s = qs.toString();
  history.replaceState(null, '', `#${path || '/'}${s ? `?${s}` : ''}`);
}

export function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return (h + 250) % 360;
}
