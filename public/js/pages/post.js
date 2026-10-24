import { api, html, mount, $, navigate } from '../lib.js';
import { icon } from '../components.js';
import { postCard, bindPosts, loadComments } from '../posts.js';

export default async function post(el, { params }) {
  const p = await api(`/posts/${params.id}`);
  mount(el, html`<div class="narrow">
    <a class="back-link" href="#/community">${icon('chevronLeft', 16)} Сообщество</a>
    <div class="feed" id="single">${postCard(p, { open: true })}</div>
  </div>`);
  const root = $('#single', el);
  bindPosts(root, () => navigate('/community'));
  await loadComments($('.post', root));
}
