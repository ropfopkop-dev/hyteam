import { api, html, mount, $, toast, toastError } from '../lib.js';
import { state } from '../state.js';
import { icon } from '../components.js';
import { refreshMe, renderChrome } from '../app.js';

function shell(title, subtitle, body) {
  return html`<div class="auth-wrap">
    <div class="auth-card card">
      <img class="auth-logo" src="/assets/logo.webp" alt="HYTEAM">
      <h1>${title}</h1>
      <p class="muted">${subtitle}</p>
      <div id="auth-body">${body}</div>
    </div>
    <div class="auth-perks">
      <div>${icon('store', 20, 'accent')}<span><b>Магазин игр</b> от HYTEAM и сообщества</span></div>
      <div>${icon('layers', 20, 'accent')}<span><b>Библиотека</b> — все ваши игры в одном месте</span></div>
      <div>${icon('upload', 20, 'accent')}<span><b>Публикуйте</b> собственные игры</span></div>
      <div>${icon('shield', 20, 'accent')}<span><b>Защита входа</b> кодом из почты</span></div>
    </div>
  </div>`;
}

async function finish(user, next) {
  state.user = user;
  await refreshMe();
  renderChrome();
  location.hash = next && next.startsWith('/') && !/^\/(login|register|reset)/.test(next) ? next : '/';
}

/**
 * Шаг «введите код из письма». submit(code) должен вернуть ответ сервера с user;
 * resend() — запросить письмо ещё раз.
 */
function codeStep(el, { title, text, remember = false, submit, resend, onDone }) {
  const body = $('#auth-body', el);
  mount(body, html`<form class="auth-form code-form" id="code-form">
    <div class="code-head">${icon('message', 22, 'accent')}<div><b>${title}</b><p class="muted sm">${text}</p></div></div>
    <input class="input code-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required>
    ${remember ? html`<label class="check"><input type="checkbox" id="remember" checked> Запомнить это устройство — не спрашивать код при следующих входах</label>` : ''}
    <button class="btn btn-primary btn-lg btn-block">Подтвердить</button>
    <p class="muted center sm">Письмо не пришло? Проверьте «Спам» или <button type="button" class="link" id="resend">отправьте код ещё раз</button></p>
  </form>`);
  const input = $('#code', body);
  input.focus();
  let busy = false;
  const go = async () => {
    if (busy) return;
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) return toast('Введите 6 цифр из письма', 'err');
    busy = true;
    try {
      const res = await submit(code, !!$('#remember', body)?.checked);
      await onDone(res.user);
    } catch (e) {
      toastError(e);
      input.select();
    } finally {
      busy = false;
    }
  };
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^\d]/g, '').slice(0, 6);
    if (input.value.length === 6) go();
  });
  $('#code-form', body).addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  $('#resend', body).addEventListener('click', async () => {
    try {
      const r = await resend();
      toast(r?.sent === false ? 'Код уже отправлен — проверьте почту, новый можно запросить через минуту' : 'Новый код отправлен');
    } catch (e) {
      toastError(e);
    }
  });
}

function verifyStep(el, login, email, next) {
  codeStep(el, {
    title: 'Подтвердите почту',
    text: `Мы отправили 6-значный код на ${email}.`,
    submit: (code) => api('/auth/verify', { method: 'POST', body: { login, code } }),
    resend: () => api('/auth/resend', { method: 'POST', body: { login } }),
    onDone: async (user) => {
      toast(user.role === 'admin' ? 'Почта подтверждена. Вы — владелец магазина HYTEAM!' : `Добро пожаловать, ${user.display_name}!`);
      await finish(user, next);
    },
  });
}

export async function login(el, { query }) {
  mount(el, shell(query.add ? 'Добавить аккаунт' : 'Вход в HYTEAM', query.add ? 'Войдите в ещё один аккаунт — переключаться между ними можно в меню профиля' : 'Рады видеть снова!', html`<form class="auth-form" id="f">
    <div class="field"><label for="a-login">Логин или email</label><input class="input" id="a-login" name="login" autocomplete="username" required></div>
    <div class="field"><label for="a-pass">Пароль</label><input class="input" id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
    ${state.meta.mailEnabled ? html`<a class="link sm forgot" href="#/reset">Забыли пароль?</a>` : ''}
    <button class="btn btn-primary btn-lg btn-block">Войти</button>
    <p class="muted center">Нет аккаунта? <a class="link" href="#/register${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}">Зарегистрироваться</a></p>
  </form>`));
  $('#f', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const res = await api('/auth/login', { method: 'POST', body: { login: f.login.value.trim(), password: f.password.value } });
      if (res.need_verify) return verifyStep(el, res.login, res.email, query.next);
      if (res.need_code) {
        let ticket = res.ticket;
        return codeStep(el, {
          title: 'Код для входа',
          text: `Аккаунт защищён: мы отправили код на ${res.email}.`,
          remember: true,
          submit: (code, remember) => api('/auth/login/code', { method: 'POST', body: { ticket, code, remember } }),
          resend: async () => {
            const r = await api('/auth/login/resend', { method: 'POST', body: { ticket } });
            ticket = r.ticket;
            return r;
          },
          onDone: async (user) => {
            toast(`С возвращением, ${user.display_name}!`);
            await finish(user, query.next);
          },
        });
      }
      toast(`С возвращением, ${res.user.display_name}!`);
      await finish(res.user, query.next);
    } catch (err) {
      toastError(err);
    }
  });
  $('#a-login', el).focus();
}

export async function register(el, { query }) {
  mount(el, shell('Создать аккаунт', 'Присоединяйтесь к сообществу HYTEAM', html`<form class="auth-form" id="f">
    <div class="field"><label for="r-user">Логин</label><input class="input" id="r-user" name="username" autocomplete="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]{3,24}" placeholder="латиница, цифры, _ . -"></div>
    <div class="field"><label for="r-name">Имя в профиле</label><input class="input" id="r-name" name="display_name" maxlength="40" placeholder="Как вас называть"></div>
    <div class="field"><label for="r-email">Email</label><input class="input" id="r-email" name="email" type="email" autocomplete="email" required>
      ${state.meta.mailEnabled ? html`<div class="field-hint">На эту почту придёт код подтверждения</div>` : ''}</div>
    <div class="field"><label for="r-pass">Пароль</label><input class="input" id="r-pass" name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="минимум 6 символов"></div>
    <button class="btn btn-primary btn-lg btn-block">Создать аккаунт</button>
    <p class="muted center">Уже есть аккаунт? <a class="link" href="#/login${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}">Войти</a></p>
  </form>`));
  $('#f', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const res = await api('/auth/register', {
        method: 'POST',
        body: { username: f.username.value.trim(), display_name: f.display_name.value.trim(), email: f.email.value.trim(), password: f.password.value },
      });
      if (res.need_verify) return verifyStep(el, res.login, res.email, query.next);
      toast(res.user.role === 'admin' ? 'Аккаунт создан. Вы — владелец магазина HYTEAM!' : `Добро пожаловать, ${res.user.display_name}!`);
      await finish(res.user, query.next);
    } catch (err) {
      toastError(err);
    }
  });
  $('#r-user', el).focus();
}

export async function reset(el) {
  mount(el, shell('Восстановление пароля', 'Пришлём код на почту аккаунта', html`<form class="auth-form" id="f">
    <div class="field"><label for="rs-login">Логин или email</label><input class="input" id="rs-login" name="login" autocomplete="username" required></div>
    <button class="btn btn-primary btn-lg btn-block">Отправить код</button>
    <p class="muted center"><a class="link" href="#/login">Вернуться ко входу</a></p>
  </form>`));
  $('#f', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginValue = e.target.login.value.trim();
    try {
      await api('/auth/reset/request', { method: 'POST', body: { login: loginValue } });
      const body = $('#auth-body', el);
      mount(body, html`<form class="auth-form" id="f2">
        <div class="code-head">${icon('message', 22, 'accent')}<div><b>Проверьте почту</b><p class="muted sm">Если такой аккаунт есть, мы отправили на его почту 6-значный код.</p></div></div>
        <div class="field"><label for="rs-code">Код из письма</label><input class="input code-input" id="rs-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required></div>
        <div class="field"><label for="rs-pass">Новый пароль</label><input class="input" id="rs-pass" type="password" autocomplete="new-password" minlength="6" required></div>
        <button class="btn btn-primary btn-lg btn-block">Сменить пароль и войти</button>
      </form>`);
      $('#rs-code', body).focus();
      $('#f2', body).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const res = await api('/auth/reset/confirm', {
            method: 'POST',
            body: { login: loginValue, code: $('#rs-code', body).value, password: $('#rs-pass', body).value },
          });
          toast('Пароль изменён');
          await finish(res.user, '/');
        } catch (err) {
          toastError(err);
        }
      });
    } catch (err) {
      toastError(err);
    }
  });
  $('#rs-login', el).focus();
}
