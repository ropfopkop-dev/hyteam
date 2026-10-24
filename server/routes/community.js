import { Router } from 'express';
import { one, all, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { postUpload, withCleanup, checkImageSizes } from '../upload.js';
import { fail, str, int, clamp, mediaUrl, isMod, notify, notifyMods, modLog, removeImage, author } from '../util.js';

const r = Router();
export default r;

const POSTS = `SELECT * FROM (SELECT p.*, u.username, u.display_name, u.avatar, u.role, u.last_seen,
  g.title AS game_title, g.cover AS game_cover, g.status AS game_status,
  (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
  FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN games g ON g.id = p.game_id) p`;

function postOut(p, viewer, liked) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    image: mediaUrl(p.image),
    created_at: p.created_at,
    likes: p.likes,
    comments_count: p.comments_count,
    liked: liked.has(p.id),
    user: author(p),
    game: p.game_id && p.game_status === 'approved' ? { id: p.game_id, title: p.game_title, cover: mediaUrl(p.game_cover) } : null,
    can_delete: !!viewer && (viewer.id === p.user_id || isMod(viewer)),
  };
}

const likedSet = (user) =>
  new Set(user ? all('SELECT post_id FROM post_likes WHERE user_id = ?', user.id).map((x) => x.post_id) : []);

r.get('/posts', (req, res) => {
  const where = ['1 = 1'];
  const p = [];
  if (req.query.game) {
    where.push('p.game_id = ?');
    p.push(int(req.query.game));
  }
  if (req.query.user) {
    where.push('p.username = ?');
    p.push(String(req.query.user));
  }
  if (req.query.feed === 'friends' && req.user) {
    where.push(`p.user_id IN (
      SELECT addressee_id FROM friends WHERE requester_id = ? AND status = 'accepted'
      UNION SELECT requester_id FROM friends WHERE addressee_id = ? AND status = 'accepted'
      UNION SELECT ?)`);
    p.push(req.user.id, req.user.id, req.user.id);
  }
  const order = req.query.sort === 'top' ? '(p.likes * 2 + p.comments_count) DESC, p.created_at DESC' : 'p.created_at DESC';
  const limit = clamp(int(req.query.limit, 15), 1, 50);
  const offset = Math.max(int(req.query.offset, 0), 0);
  const rows = all(`${POSTS} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...p, limit + 1, offset);
  const liked = likedSet(req.user);
  res.json({ items: rows.slice(0, limit).map((x) => postOut(x, req.user, liked)), has_more: rows.length > limit });
});

r.get('/posts/:id', (req, res) => {
  const row = one(`${POSTS} WHERE p.id = ?`, int(req.params.id));
  if (!row) fail(404, 'Пост не найден');
  res.json(postOut(row, req.user, likedSet(req.user)));
});

r.post('/posts', requireAuth, postUpload, withCleanup((req, res) => {
  checkImageSizes(req);
  const title = str(req.body.title, { name: 'Заголовок', max: 120 });
  const body = str(req.body.body, { name: 'Текст', required: true, max: 5000 });
  let gameId = int(req.body.game_id, 0) || null;
  if (gameId && !one("SELECT 1 FROM games WHERE id = ? AND status = 'approved'", gameId)) gameId = null;
  const info = run(
    'INSERT INTO posts(user_id, game_id, title, body, image, created_at) VALUES(?,?,?,?,?,?)',
    req.user.id, gameId, title, body, req.file?.filename, Date.now(),
  );
  res.json({ id: Number(info.lastInsertRowid) });
}));

export function deletePost(post) {
  run('DELETE FROM posts WHERE id = ?', post.id);
  removeImage(post.image);
}

r.delete('/posts/:id', requireAuth, (req, res) => {
  const post = one('SELECT * FROM posts WHERE id = ?', int(req.params.id));
  if (!post) fail(404, 'Пост не найден');
  if (post.user_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  deletePost(post);
  if (post.user_id !== req.user.id) modLog(req.user.id, 'delete', 'post', post.id, (post.title || post.body).slice(0, 120));
  res.json({ ok: true });
});

r.post('/posts/:id/like', requireAuth, (req, res) => {
  const post = one('SELECT id FROM posts WHERE id = ?', int(req.params.id));
  if (!post) fail(404, 'Пост не найден');
  const had = one('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?', post.id, req.user.id);
  if (had) run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', post.id, req.user.id);
  else run('INSERT INTO post_likes(post_id, user_id) VALUES(?,?)', post.id, req.user.id);
  const likes = one('SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?', post.id).c;
  res.json({ liked: !had, likes });
});

r.get('/posts/:id/comments', (req, res) => {
  const rows = all(
    `SELECT c.*, u.username, u.display_name, u.avatar, u.role, u.last_seen
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    int(req.params.id),
  );
  res.json(rows.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    user: author(c),
    can_delete: !!req.user && (req.user.id === c.user_id || isMod(req.user)),
  })));
});

r.post('/posts/:id/comments', requireAuth, (req, res) => {
  const post = one('SELECT * FROM posts WHERE id = ?', int(req.params.id));
  if (!post) fail(404, 'Пост не найден');
  const body = str(req.body.body, { name: 'Комментарий', required: true, max: 2000 });
  const info = run('INSERT INTO comments(post_id, user_id, body, created_at) VALUES(?,?,?,?)', post.id, req.user.id, body, Date.now());
  if (post.user_id !== req.user.id) notify(post.user_id, `${req.user.display_name} прокомментировал(а) ваш пост`, `/post/${post.id}`);
  res.json({ id: Number(info.lastInsertRowid) });
});

r.delete('/comments/:id', requireAuth, (req, res) => {
  const c = one('SELECT * FROM comments WHERE id = ?', int(req.params.id));
  if (!c) fail(404, 'Комментарий не найден');
  if (c.user_id !== req.user.id && !isMod(req.user)) fail(403, 'Нет доступа');
  run('DELETE FROM comments WHERE id = ?', c.id);
  if (c.user_id !== req.user.id) modLog(req.user.id, 'delete', 'comment', c.id, c.body.slice(0, 120));
  res.json({ ok: true });
});

// ---------- Жалобы ----------

const REPORT_TYPES = ['game', 'review', 'post', 'comment', 'user'];

r.post('/reports', requireAuth, (req, res) => {
  const type = String(req.body.target_type);
  if (!REPORT_TYPES.includes(type)) fail(400, 'Неизвестный тип жалобы');
  const targetId = int(req.body.target_id);
  const reason = str(req.body.reason, { name: 'Причина', required: true, max: 500 });
  const dup = one(
    "SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
    req.user.id, type, targetId,
  );
  if (!dup) {
    run(
      'INSERT INTO reports(reporter_id, target_type, target_id, reason, created_at) VALUES(?,?,?,?,?)',
      req.user.id, type, targetId, reason, Date.now(),
    );
    notifyMods('Новая жалоба ждёт рассмотрения', '/mod?tab=reports');
  }
  res.json({ ok: true });
});
