import { api, html, mount, $, fmt, toast, toastError, confirmBox, navigate } from '../lib.js';
import { state, isMod, isAdmin } from '../state.js';
import { icon, avatar, cover, stars, gameCard, roleBadge, userCard, empty } from '../components.js';
import { postCard, bindPosts } from '../posts.js';

const BADGE_IC = { founder: 'shield', mod: 'shield', dev: 'code', collector: 'layers', critic: 'star', social: 'users', writer: 'message', veteran: 'trophy' };

export default async function profile(el, { params }) {
  if (params.username === 'me') {
    if (!state.user) return navigate('/login');
    location.replace(`#/u/${state.user.username}`);
    return;
  }
  const p = await api(`/users/${encodeURIComponent(params.username)}`);
  const u = p.user;
  const lv = p.level;
  const progress = Math.round(((lv.xp - lv.from) / (lv.to - lv.from)) * 100);
  const canBan = isMod() && p.relation !== 'self' && (isAdmin() || u.role === 'user');

  mount(el, html`
    <section class="prof-banner"><div class="prof-banner-bg" style="${u.banner ? `--bg:url('${u.banner}')` : ''}"></div></section>
    <section class="prof-head card">
      <div class="prof-avatar">${avatar(u, 132)}<i class="online-dot big ${u.online ? 'on' : ''}"></i></div>
      <div class="prof-main">
        <div class="prof-name"><h1>${u.display_name}</h1>${roleBadge(u.role)}${u.banned ? html`<span class="status st-rejected">${icon('ban', 13)} Заблокирован</span>` : ''}</div>
        <div class="muted">@${u.username} · ${u.online ? html`<span class="online-text">в сети</span>` : `был(а) ${fmt.ago(u.last_seen) || 'давно'}`} · с нами с ${fmt.date(u.created_at)}${p.playtime_total ? ` · наиграно ${fmt.hours(p.playtime_total)}` : ''}</div>
        ${u.bio ? html`<p class="prof-bio prose">${u.bio}</p>` : p.relation === 'self' ? html`<p class="prof-bio muted">Расскажите о себе в <a href="#/settings">настройках</a></p>` : ''}
      </div>
      <div class="prof-side">
        <div class="level">
          <div class="level-ring" style="--p:${progress}"><span>${lv.level}</span></div>
          <div><b>Уровень ${lv.level}</b><div class="muted xs">${lv.xp} / ${lv.to} XP</div><div class="xp-bar"><i style="width:${progress}%"></i></div></div>
        </div>
        <div class="prof-actions" id="prof-actions">${actions(p)}</div>
        ${canBan ? html`<button class="btn btn-ghost btn-sm" id="prof-ban">${icon('ban', 14)} ${u.banned ? 'Разблокировать' : 'Заблокировать'}</button>` : ''}
      </div>
    </section>

    <div class="prof-stats">
      ${[['Игр', p.stats.games, 'layers'], ['Опубликовано', p.stats.published, 'code'], ['Отзывов', p.stats.reviews, 'star'], ['Постов', p.stats.posts, 'message'], ['Друзей', p.stats.friends, 'users']]
        .map(([l, v, ic]) => html`<div class="stat card">${icon(ic, 20, 'accent')}<b>${fmt.num(v)}</b><span>${l}</span></div>`)}
    </div>

    <div class="prof-grid">
      <div class="prof-col">
        ${p.published.length ? html`<section class="card pad">
          <h3 class="card-title">${icon('code', 18, 'accent')} Игры разработчика</h3>
          <div class="grid-games sm">${p.published.map((g) => gameCard(g))}</div>
        </section>` : ''}
        <section class="card pad">
          <h3 class="card-title">${icon('clock', 18, 'accent')} Недавняя активность</h3>
          ${p.library.length
            ? html`<div class="activity">${p.library.map((g) => html`<a class="act-item" href="#/game/${g.id}"><span class="act-cover">${cover(g)}</span><span><b>${g.title}</b><span class="muted xs">${g.playtime ? `${fmt.hours(g.playtime)} в игре` : g.genre} · ${fmt.ago(g.last_activity)}</span></span></a>`)}</div>`
            : html`<p class="muted">Библиотека пока пуста</p>`}
        </section>
        ${p.reviews.length ? html`<section class="card pad">
          <h3 class="card-title">${icon('star', 18, 'accent')} Отзывы</h3>
          ${p.reviews.map((r) => html`<div class="prof-review"><a class="act-cover" href="#/game/${r.game.id}">${cover(r.game)}</a>
            <div><a class="name" href="#/game/${r.game.id}">${r.game.title}</a> ${stars(r.rating, 12)} <span class="muted xs">${fmt.ago(r.created_at)}</span>
            ${r.body ? html`<p class="prose clamp-3">${r.body}</p>` : ''}</div></div>`)}
        </section>` : ''}
        <section class="card pad">
          <h3 class="card-title">${icon('message', 18, 'accent')} Посты</h3>
          <div class="feed compact" id="prof-posts"></div>
        </section>
      </div>
      <div class="prof-col side">
        <section class="card pad">
          <h4 class="side-title">${icon('trophy', 16, 'accent')} Значки</h4>
          ${p.badges.length
            ? html`<div class="badges">${p.badges.map((b) => html`<div class="badge-item" title="${b.desc}"><span class="badge-ic b-${b.id}">${icon(BADGE_IC[b.id] || 'star', 18)}</span><span><b>${b.name}</b><span class="muted xs">${b.desc}</span></span></div>`)}</div>`
            : html`<p class="muted xs">Значков пока нет — играйте, пишите отзывы и публикуйте игры</p>`}
        </section>
        <section class="card pad">
          <h4 class="side-title">${icon('users', 16, 'accent')} Друзья <span class="muted">${p.stats.friends}</span></h4>
          ${p.friends.length ? html`<div class="people">${p.friends.map((f) => userCard(f))}</div>` : html`<p class="muted xs">Пока нет друзей</p>`}
        </section>
      </div>
    </div>`);

  bindActions(el, p);
  loadPosts(el, u.username);
  $('#prof-ban', el)?.addEventListener('click', async () => {
    const banned = !u.banned;
    if (!(await confirmBox(banned ? `Заблокировать ${u.display_name}?` : `Разблокировать ${u.display_name}?`, { danger: banned, ok: banned ? 'Заблокировать' : 'Разблокировать' }))) return;
    try {
      await api(`/mod/users/${u.id}/ban`, { method: 'POST', body: { banned } });
      toast(banned ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
      profile(el, { params });
    } catch (e) {
      toastError(e);
    }
  });
}

function actions(p) {
  switch (p.relation) {
    case 'self': return html`<a class="btn btn-soft btn-sm" href="#/settings">${icon('edit', 14)} Редактировать профиль</a>`;
    case 'none': return html`<button class="btn btn-primary btn-sm" data-friend="add">${icon('userPlus', 15)} Добавить в друзья</button>`;
    case 'outgoing': return html`<button class="btn btn-ghost btn-sm" data-friend="cancel">${icon('clock', 15)} Заявка отправлена</button>`;
    case 'incoming': return html`<button class="btn btn-primary btn-sm" data-friend="add">${icon('check', 15)} Принять заявку</button><button class="btn btn-ghost btn-sm" data-friend="cancel">Отклонить</button>`;
    case 'friends': return html`<button class="btn btn-soft btn-sm" data-friend="remove">${icon('userCheck', 15)} В друзьях</button>`;
    default: return html`<a class="btn btn-ghost btn-sm" href="#/login">Войдите, чтобы добавить в друзья</a>`;
  }
}

function bindActions(el, p) {
  const box = $('#prof-actions', el);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-friend]');
    if (!b) return;
    const act = b.dataset.friend;
    if (act === 'remove' && !(await confirmBox(`Удалить ${p.user.display_name} из друзей?`, { ok: 'Удалить', danger: true }))) return;
    try {
      const r = await api(`/friends/${p.user.id}`, { method: act === 'add' ? 'POST' : 'DELETE' });
      p.relation = r.relation;
      mount(box, actions(p));
      toast({ outgoing: 'Заявка отправлена', friends: 'Теперь вы друзья!', none: 'Готово' }[r.relation] || 'Готово');
    } catch (err) {
      toastError(err);
    }
  });
}

async function loadPosts(el, username) {
  const box = $('#prof-posts', el);
  try {
    const res = await api(`/posts?user=${encodeURIComponent(username)}&limit=5`);
    mount(box, res.items.length ? html`${res.items.map((x) => postCard(x))}` : html`<p class="muted">Постов пока нет</p>`);
    bindPosts(box);
  } catch (e) {
    mount(box, empty({ ic: 'message', title: e.message }));
  }
}
