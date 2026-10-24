import { api, html, mount, $, debounce, toast, toastError, confirmBox } from '../lib.js';
import { icon, userCard, empty } from '../components.js';

export default async function friends(el) {
  const data = await api('/friends');
  const online = data.friends.filter((f) => f.online).length;

  mount(el, html`<div class="page-head">
      <h1>Друзья</h1>
      <p class="muted">${data.friends.length} в друзьях · ${online} в сети</p>
    </div>
    <div class="friends-grid">
      <div class="friends-main">
        ${data.incoming.length ? html`<section class="card pad">
          <h3 class="card-title">${icon('userPlus', 18, 'accent')} Заявки в друзья <span class="count-pill">${data.incoming.length}</span></h3>
          <div class="people">${data.incoming.map((u) => userCard(u, html`<button class="btn btn-primary btn-sm" data-accept="${u.id}">${icon('check', 14)} Принять</button><button class="btn btn-ghost btn-sm" data-decline="${u.id}">Отклонить</button>`))}</div>
        </section>` : ''}
        <section class="card pad">
          <h3 class="card-title">${icon('users', 18, 'accent')} Мои друзья</h3>
          ${data.friends.length
            ? html`<div class="people cols">${data.friends.map((u) => userCard(u, html`<button class="icon-btn sm" data-remove="${u.id}" data-name="${u.display_name}" title="Удалить из друзей">${icon('x', 15)}</button>`))}</div>`
            : empty({ ic: 'users', title: 'Пока нет друзей', text: 'Найдите игроков через поиск справа или в сообществе.' })}
        </section>
        ${data.outgoing.length ? html`<section class="card pad">
          <h3 class="card-title">${icon('clock', 18, 'accent')} Отправленные заявки</h3>
          <div class="people">${data.outgoing.map((u) => userCard(u, html`<button class="btn btn-ghost btn-sm" data-decline="${u.id}">Отменить</button>`))}</div>
        </section>` : ''}
      </div>
      <aside class="card pad friends-search">
        <h4 class="side-title">${icon('search', 16, 'accent')} Найти игроков</h4>
        <input class="input" id="fr-q" placeholder="Имя или логин">
        <div class="people" id="fr-results"></div>
      </aside>
    </div>`);

  const reload = () => friends(el);

  el.onclick = async (e) => {
    const accept = e.target.closest('[data-accept], [data-add]');
    const decline = e.target.closest('[data-decline]');
    const remove = e.target.closest('[data-remove]');
    try {
      if (accept) {
        const r = await api(`/friends/${accept.dataset.accept || accept.dataset.add}`, { method: 'POST' });
        toast(r.relation === 'friends' ? 'Теперь вы друзья!' : 'Заявка отправлена');
        reload();
      }
      if (decline) {
        await api(`/friends/${decline.dataset.decline}`, { method: 'DELETE' });
        reload();
      }
      if (remove) {
        if (!(await confirmBox(`Удалить ${remove.dataset.name} из друзей?`, { ok: 'Удалить', danger: true }))) return;
        await api(`/friends/${remove.dataset.remove}`, { method: 'DELETE' });
        toast('Удалено из друзей');
        reload();
      }
    } catch (err) {
      toastError(err);
    }
  };

  const LABEL = { none: null, outgoing: 'Заявка отправлена', friends: 'В друзьях', incoming: null, self: 'Это вы' };
  $('#fr-q', el).addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const box = $('#fr-results', el);
    if (q.length < 2) return mount(box, '');
    const list = await api(`/users?q=${encodeURIComponent(q)}`);
    mount(box, list.length
      ? html`${list.map((u) => userCard(u, LABEL[u.relation]
        ? html`<span class="muted xs">${LABEL[u.relation]}</span>`
        : html`<button class="btn btn-soft btn-sm btn-icon" data-add="${u.id}" title="${u.relation === 'incoming' ? 'Принять заявку' : 'Добавить в друзья'}">${icon('userPlus', 15)}</button>`))}`
      : html`<p class="muted xs">Никого не нашли</p>`);
  }, 250));
}
