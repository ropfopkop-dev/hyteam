import { api, upload, html, raw, mount, $, fmt, modal, toast, toastError, confirmBox } from '../lib.js';
import { state } from '../state.js';
import { icon, avatar } from '../components.js';
import { renderChrome } from '../app.js';
import { hy, appInfo, autoUpdateEnabled, setAutoUpdate } from '../desktop.js';

export default async function settings(el) {
  const u = state.user;
  const app = await appInfo();
  mount(el, html`<div class="page-head"><h1>Настройки</h1><p class="muted">Профиль, аватар и безопасность аккаунта</p></div>
    <div class="settings">
      <form class="card pad" id="s-profile">
        <h3 class="card-title">${icon('user', 18, 'accent')} Профиль</h3>
        <div class="s-banner" id="s-banner" style="${u.banner ? `--bg:url('${u.banner}')` : ''}">
          <label class="btn btn-soft btn-sm">${icon('image', 15)} Сменить фон профиля<input type="file" name="banner" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        </div>
        <div class="s-avatar">
          <span id="s-av">${avatar(u, 96)}</span>
          <label class="btn btn-soft btn-sm">${icon('upload', 15)} Загрузить аватар<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        </div>
        <div class="field"><label for="s-name">Отображаемое имя</label><input class="input" id="s-name" name="display_name" maxlength="40" required value="${u.display_name}"></div>
        <div class="field"><label for="s-bio">О себе</label><textarea class="input" id="s-bio" name="bio" rows="4" maxlength="600" placeholder="Во что играете, что разрабатываете…">${u.bio}</textarea></div>
        <div class="field"><label>Логин и email</label><div class="muted">@${u.username} · ${u.email}</div></div>
        <button class="btn btn-primary">${icon('check', 16)} Сохранить профиль</button>
      </form>
      <form class="card pad" id="s-pass">
        <h3 class="card-title">${icon('shield', 18, 'accent')} Смена пароля</h3>
        <div class="field"><label for="s-cur">Текущий пароль</label><input class="input" id="s-cur" type="password" name="current" autocomplete="current-password" required></div>
        <div class="field"><label for="s-new">Новый пароль</label><input class="input" id="s-new" type="password" name="password" autocomplete="new-password" minlength="6" required></div>
        <p class="muted xs">После смены пароля вы выйдете на всех других устройствах.</p>
        <button class="btn btn-soft">${icon('refresh', 16)} Сменить пароль</button>
      </form>
      <section class="card pad s-sec" id="s-sec"><h3 class="card-title">${icon('shield', 18, 'accent')} Защита аккаунта</h3><div class="loading"><div class="spinner sm"></div></div></section>
      ${app ? html`<section class="card pad s-app">
        <h3 class="card-title">${icon('monitor', 18, 'accent')} Приложение HYTEAM</h3>
        <div class="field"><label>Сервер</label>
          <div class="s-row"><span class="path-text">${app.serverUrl}</span><button type="button" class="btn btn-soft btn-sm" id="s-server">Сменить сервер</button></div></div>
        ${app.hostRunning ? html`<div class="note">${icon('users', 16)}<span>Сервер работает на этом компьютере. Друзья в вашей сети подключаются по адресу:
          ${app.lan.length ? app.lan.map((a, i) => html`${i ? ', ' : ''}<b>${a}</b>`) : html`<b>http://localhost:${app.hostPort}</b>`}</span></div>
          <div class="field"><label>Доступ из интернета</label><div class="tunnel" id="s-tunnel"></div></div>` : ''}
        <div class="field"><label>Папка для установки игр</label>
          <div class="s-row"><span class="path-text" id="s-libdir">${app.libraryDir}</span><button type="button" class="btn btn-soft btn-sm" id="s-lib">Изменить</button></div>
          <div class="field-hint">Уже установленные игры останутся на своих местах</div></div>
        <div class="field"><label class="check"><input type="checkbox" id="s-auto" ${autoUpdateEnabled() ? 'checked' : ''}> Автоматически обновлять установленные игры</label>
          <div class="field-hint">Когда разработчик выпускает новую версию (в том числе новый релиз на GitHub), программа скачает и установит её сама. Запущенные игры обновятся после закрытия.</div></div>
        <div class="muted xs">HYTEAM для Windows, версия ${app.version}</div>
      </section>` : ''}
    </div>`);

  $('#s-auto', el)?.addEventListener('change', (e) => {
    setAutoUpdate(e.target.checked);
    toast(e.target.checked ? 'Автообновление включено' : 'Автообновление выключено');
  });

  const tunnelBox = $('#s-tunnel', el);
  let stopTunnelWatch = () => {};
  if (tunnelBox) {
    const render = (t) => mount(tunnelBox, tunnelView(t));
    render(app.tunnel);
    stopTunnelWatch = hy.onTunnelState(render);
    tunnelBox.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tunnel]');
      if (!b) return;
      try {
        if (b.dataset.tunnel === 'start') {
          b.disabled = true;
          const t = await hy.tunnelStart();
          toast('Магазин доступен из интернета');
          render(t);
        }
        if (b.dataset.tunnel === 'stop') await hy.tunnelStop();
        if (b.dataset.tunnel === 'copy') {
          await hy.copy(b.dataset.url);
          toast('Адрес скопирован — отправьте его друзьям');
        }
      } catch (err) {
        toastError(err);
      }
    });
  }

  $('#s-server', el)?.addEventListener('click', async () => {
    const note = app.hostRunning ? 'Сервер на этом компьютере продолжит работать, пока вы не подключитесь к другому.' : '';
    if (await confirmBox('Сменить сервер HYTEAM?', { ok: 'Сменить', note })) hy.changeServer();
  });
  $('#s-lib', el)?.addEventListener('click', async () => {
    try {
      $('#s-libdir', el).textContent = await hy.chooseLibraryDir();
    } catch (e) {
      toastError(e);
    }
  });

  const pf = $('#s-profile', el);
  const files = {};
  for (const name of ['avatar', 'banner']) {
    pf.elements.namedItem(name).addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      files[name] = f;
      const url = URL.createObjectURL(f);
      if (name === 'avatar') mount($('#s-av', el), html`<img class="avatar" src="${url}" style="width:96px;height:96px" alt="">`);
      else $('#s-banner', el).style.setProperty('--bg', `url('${url}')`);
    });
  }
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('display_name', $('#s-name', el).value.trim());
    fd.append('bio', $('#s-bio', el).value.trim());
    for (const [k, f] of Object.entries(files)) fd.append(k, f);
    try {
      const res = await upload('/me/profile', fd, { method: 'PUT' });
      state.user = res.user;
      renderChrome();
      toast('Профиль сохранён');
    } catch (err) {
      toastError(err);
    }
  });

  $('#s-pass', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/me/password', { method: 'PUT', body: { current: f.current.value, password: f.password.value } });
      f.reset();
      toast('Пароль изменён');
    } catch (err) {
      toastError(err);
    }
  });

  renderSecurity($('#s-sec', el));
  return stopTunnelWatch;
}

// Модальное окно с одним полем: код из письма или пароль.
function askField(title, { text = '', type = 'text', placeholder = '', ok = 'Подтвердить', danger = false } = {}) {
  return new Promise((resolve) => {
    let value = null;
    const m = modal(html`<form class="prompt-form"><h3>${title}</h3>${text ? html`<p class="muted">${text}</p>` : ''}
      <input class="input ${type === 'code' ? 'code-input' : ''}" type="${type === 'code' ? 'text' : type}" ${type === 'code' ? raw('inputmode="numeric" maxlength="6" autocomplete="one-time-code"') : ''} placeholder="${placeholder}" required>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${ok}</button></div></form>`, { onClose: () => resolve(value) });
    $('form', m.el).addEventListener('submit', (e) => {
      e.preventDefault();
      value = $('input', m.el).value.trim();
      if (value) m.close();
    });
  });
}

async function renderSecurity(box) {
  let s;
  try {
    s = await api('/me/security');
  } catch (e) {
    mount(box, html`<p class="muted">${e.message}</p>`);
    return;
  }
  mount(box, html`<h3 class="card-title">${icon('shield', 18, 'accent')} Защита аккаунта</h3>
    <div class="sec-row">
      <div><b>Почта</b><div class="muted sm">${s.email}</div></div>
      ${s.email_verified
        ? html`<span class="status st-approved">${icon('check', 13)} Подтверждена</span>`
        : html`<span class="status st-pending">${icon('clock', 13)} Не подтверждена</span>${s.mail_enabled ? html`<button type="button" class="btn btn-soft btn-sm" data-sec="verify">Подтвердить</button>` : ''}`}
    </div>
    <div class="sec-row">
      <div><b>Двухфакторный вход: пароль + код из почты</b><div class="muted sm">Как Steam Guard: после пароля на новом устройстве на почту всегда приходит код. Отключить нельзя.</div></div>
      ${s.mail_enabled
        ? html`<span class="status st-approved">${icon('shield', 13)} Всегда включён</span>`
        : html`<span class="status st-pending">${icon('clock', 13)} Ждёт настройки почты</span>`}
    </div>
    ${!s.mail_enabled ? html`<div class="note">${icon('message', 16)}<span>Почта на сервере не настроена — коды отправлять некуда. Администратор может настроить её в «Модерация → Почта».</span></div>` : ''}
    ${s.mail_enabled ? html`<div class="sec-devices">
      <b>Доверенные устройства</b> <span class="muted sm">— здесь код не спрашивается</span>
      ${s.devices.length
        ? html`<ul>${s.devices.map((d) => html`<li>${icon('monitor', 14)} ${d.label}${d.current ? html` <span class="chip">это устройство</span>` : ''} <span class="muted xs">· вход ${fmt.ago(d.last_used)}</span></li>`)}</ul>`
        : html`<p class="muted sm">Пока нет</p>`}
      <button type="button" class="btn btn-ghost btn-sm" data-sec="forget">${icon('logout', 14)} Забыть все устройства и выйти на других</button>
    </div>` : ''}`);

  box.onclick = async (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b) return;
    try {
      if (b.dataset.sec === 'verify') {
        const r = await api('/me/email/start', { method: 'POST' });
        const code = await askField('Подтвердите почту', { text: `Введите код из письма, отправленного на ${r.email}.`, type: 'code', placeholder: '000000' });
        if (!code) return;
        await api('/me/email/confirm', { method: 'POST', body: { code } });
        toast('Почта подтверждена');
      }
      if (b.dataset.sec === 'on') {
        const r = await api('/me/2fa/start', { method: 'POST' });
        const code = await askField('Включить вход по коду', { text: `Введите код из письма, отправленного на ${r.email}.`, type: 'code', placeholder: '000000', ok: 'Включить' });
        if (!code) return;
        await api('/me/2fa/confirm', { method: 'POST', body: { code } });
        toast('Защита входа включена');
      }
      if (b.dataset.sec === 'off') {
        const password = await askField('Выключить вход по коду', { text: 'Введите пароль от аккаунта.', type: 'password', ok: 'Выключить', danger: true });
        if (!password) return;
        await api('/me/2fa/disable', { method: 'POST', body: { password } });
        toast('Защита входа выключена');
      }
      if (b.dataset.sec === 'forget') {
        if (!(await confirmBox('Забыть все устройства?', { ok: 'Забыть', danger: true, note: 'На других устройствах вы выйдете из аккаунта, при следующем входе понадобится код из почты.' }))) return;
        await api('/me/devices', { method: 'DELETE' });
        toast('Готово');
      }
      renderSecurity(box);
    } catch (err) {
      toastError(err);
    }
  };
}

function tunnelView(t) {
  if (t.state === 'downloading') {
    return html`<div class="tunnel-row"><div class="spinner sm"></div><span>Скачиваю cloudflared от Cloudflare… ${Math.round((t.progress || 0) * 100)}%</span></div>`;
  }
  if (t.state === 'starting') return html`<div class="tunnel-row"><div class="spinner sm"></div><span>Подключаюсь к Cloudflare…</span></div>`;
  if (t.state === 'on') {
    return html`<div class="s-row"><span class="path-text tunnel-url">${t.url}</span>
        <button type="button" class="btn btn-primary btn-sm" data-tunnel="copy" data-url="${t.url}">${icon('check', 14)} Копировать</button>
        <button type="button" class="btn btn-ghost btn-sm" data-tunnel="stop">Закрыть доступ</button></div>
      <div class="field-hint">Друзья вводят этот адрес в программе HYTEAM на экране «Подключиться». Адрес меняется после каждого перезапуска — отправляйте новый.
        Игры любого размера загружаются через туннель по частям.</div>`;
  }
  return html`${t.error ? html`<div class="reject-note">${icon('ban', 14)} ${t.error}</div>` : ''}
    <div class="s-row"><span class="grow muted">Бесплатный туннель Cloudflare: друзья из любой точки подключатся по адресу вида https://….trycloudflare.com, пока этот компьютер включён.</span>
      <button type="button" class="btn btn-primary btn-sm" data-tunnel="start">${icon('external', 14)} Открыть доступ</button></div>`;
}
