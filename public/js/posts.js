// Посты сообщества: карточка, лайки, комментарии, удаление.
import { api, html, mount, $, fmt, toast, toastError, confirmBox } from './lib.js';
import { state } from './state.js';
import { icon, avatar, roleBadge, spinner } from './components.js';

export function postCard(p, { open = false } = {}) {
  return html`<article class="post card" data-post="${p.id}">
    <header class="post-head">
      <a href="#/u/${p.user.username}">${avatar(p.user, 42, { online: true })}</a>
      <div class="grow">
        <div><a class="name" href="#/u/${p.user.username}">${p.user.display_name}</a> ${roleBadge(p.user.role)}</div>
        <div class="muted xs"><a href="#/post/${p.id}">${fmt.ago(p.created_at)}</a>${p.game ? html` · ${icon('gamepad', 12)} <a class="game-link" href="#/game/${p.game.id}">${p.game.title}</a>` : ''}</div>
      </div>
      <div class="post-tools">
        ${state.user && state.user.id !== p.user.id ? html`<button class="icon-btn sm" data-report="post:${p.id}" title="Пожаловаться">${icon('flag', 15)}</button>` : ''}
        ${p.can_delete ? html`<button class="icon-btn sm" data-del-post="${p.id}" title="Удалить">${icon('trash', 15)}</button>` : ''}
      </div>
    </header>
    ${p.title ? html`<h3 class="post-title"><a href="#/post/${p.id}">${p.title}</a></h3>` : ''}
    <div class="prose post-text">${p.body}</div>
    ${p.image ? html`<a class="post-img" href="${p.image}" target="_blank" rel="noopener"><img src="${p.image}" alt="" loading="lazy"></a>` : ''}
    <footer class="post-actions">
      <button class="pill ${p.liked ? 'on' : ''}" data-like="${p.id}">${icon('heart', 15)} <span>${p.likes}</span></button>
      <button class="pill" data-comments="${p.id}">${icon('message', 15)} <span>${p.comments_count}</span></button>
    </footer>
    <div class="comments" ${open ? '' : 'hidden'}></div>
  </article>`;
}

function commentItem(c) {
  return html`<div class="comment" data-comment="${c.id}">
    <a href="#/u/${c.user.username}">${avatar(c.user, 30)}</a>
    <div class="comment-body">
      <div><a class="name" href="#/u/${c.user.username}">${c.user.display_name}</a> ${roleBadge(c.user.role)} <span class="muted xs">${fmt.ago(c.created_at)}</span></div>
      <div class="prose">${c.body}</div>
    </div>
    <div class="post-tools">
      ${state.user && state.user.id !== c.user.id ? html`<button class="icon-btn xs" data-report="comment:${c.id}" title="Пожаловаться">${icon('flag', 13)}</button>` : ''}
      ${c.can_delete ? html`<button class="icon-btn xs" data-del-comment="${c.id}" title="Удалить">${icon('trash', 13)}</button>` : ''}
    </div>
  </div>`;
}

export async function loadComments(postEl) {
  const id = postEl.dataset.post;
  const box = $('.comments', postEl);
  box.hidden = false;
  mount(box, spinner());
  const list = await api(`/posts/${id}/comments`);
  mount(box, html`
    ${list.length ? list.map(commentItem) : html`<p class="muted xs">Комментариев пока нет</p>`}
    ${state.user
      ? html`<form class="comment-form">${avatar(state.user, 30)}<input class="input" name="body" maxlength="2000" placeholder="Написать комментарий…" required autocomplete="off"><button class="btn btn-primary btn-sm btn-icon" aria-label="Отправить">${icon('send', 15)}</button></form>`
      : html`<p class="muted xs"><a href="#/login">Войдите</a>, чтобы комментировать</p>`}`);
  $('[data-comments] span', postEl).textContent = list.length;
}

/** Подключает обработчики постов к контейнеру. onRemoved вызывается после удаления поста. */
export function bindPosts(root, onRemoved) {
  root.postsRemoved = onRemoved;
  if (root.postsBound) return;
  root.postsBound = true;

  root.addEventListener('click', async (e) => {
    const like = e.target.closest('[data-like]');
    const comments = e.target.closest('[data-comments]');
    const delPost = e.target.closest('[data-del-post]');
    const delComment = e.target.closest('[data-del-comment]');
    try {
      if (like) {
        if (!state.user) return toast('Войдите, чтобы ставить лайки', 'info');
        const r = await api(`/posts/${like.dataset.like}/like`, { method: 'POST' });
        like.classList.toggle('on', r.liked);
        $('span', like).textContent = r.likes;
      }
      if (comments) {
        const postEl = comments.closest('.post');
        const box = $('.comments', postEl);
        if (!box.hidden && box.childElementCount) box.hidden = true;
        else await loadComments(postEl);
      }
      if (delPost) {
        if (!(await confirmBox('Удалить пост?', { ok: 'Удалить', danger: true }))) return;
        await api(`/posts/${delPost.dataset.delPost}`, { method: 'DELETE' });
        toast('Пост удалён');
        delPost.closest('.post').remove();
        root.postsRemoved?.();
      }
      if (delComment) {
        if (!(await confirmBox('Удалить комментарий?', { ok: 'Удалить', danger: true }))) return;
        await api(`/comments/${delComment.dataset.delComment}`, { method: 'DELETE' });
        await loadComments(delComment.closest('.post'));
      }
    } catch (err) {
      toastError(err);
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.comment-form');
    if (!form) return;
    e.preventDefault();
    const postEl = form.closest('.post');
    const body = form.body.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true;
    try {
      await api(`/posts/${postEl.dataset.post}/comments`, { method: 'POST', body: { body } });
      await loadComments(postEl);
      $('.comment-form input', postEl)?.focus();
    } catch (err) {
      toastError(err);
      form.querySelector('button').disabled = false;
    }
  });
}
