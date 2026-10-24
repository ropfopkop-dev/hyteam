import { all } from './db.js';
import { GAMES, SORTS } from './games.js';
import { splitTags, plural } from './util.js';

const tagsOf = (g) => splitTags(g.tags).map((t) => t.toLowerCase());

function overlap(a, b) {
  const set = new Set(tagsOf(a));
  return tagsOf(b).filter((t) => set.has(t)).length;
}

const popular = (limit, exclude = new Set()) =>
  all(`${GAMES} WHERE g.status = 'approved' ORDER BY ${SORTS.popular} LIMIT ?`, limit + exclude.size)
    .filter((g) => !exclude.has(g.id))
    .slice(0, limit)
    .map((game) => ({ game, reason: 'Популярно в HYTEAM' }));

/**
 * Рекомендации: веса тегов и жанров из библиотеки, избранного и оценок пользователя,
 * плюс игры друзей, рейтинг и популярность.
 */
export function recommendFor(user, limit = 12) {
  if (!user) return popular(limit);

  const games = all(`${GAMES} WHERE g.status = 'approved'`);
  const byId = new Map(games.map((g) => [g.id, g]));
  const owned = new Set(all('SELECT game_id FROM library WHERE user_id = ?', user.id).map((r) => r.game_id));
  const wish = new Set(all('SELECT game_id FROM wishlist WHERE user_id = ?', user.id).map((r) => r.game_id));
  const myRatings = new Map(all('SELECT game_id, rating FROM reviews WHERE user_id = ?', user.id).map((r) => [r.game_id, r.rating]));
  const friendOwners = new Map(
    all(
      `SELECT l.game_id, COUNT(*) AS c FROM library l WHERE l.user_id IN (
         SELECT addressee_id FROM friends WHERE requester_id = ? AND status = 'accepted'
         UNION SELECT requester_id FROM friends WHERE addressee_id = ? AND status = 'accepted'
       ) GROUP BY l.game_id`,
      user.id, user.id,
    ).map((r) => [r.game_id, r.c]),
  );

  const weights = new Map();
  const add = (key, w) => weights.set(key, (weights.get(key) || 0) + w);
  const learn = (g, w) => {
    for (const t of tagsOf(g)) add(t, w);
    add(`genre:${g.genre}`, w * 1.5);
  };
  const liked = [];
  for (const id of owned) {
    const g = byId.get(id);
    if (!g || g.developer_id === user.id) continue;
    const r = myRatings.get(id);
    const w = r == null ? 1 : r >= 4 ? 2 : r <= 2 ? -1 : 0.5;
    learn(g, w);
    if (w > 0) liked.push(g);
  }
  for (const id of wish) {
    const g = byId.get(id);
    if (g) {
      learn(g, 1.5);
      liked.push(g);
    }
  }

  if (!weights.size && !friendOwners.size) return popular(limit, owned);

  const scored = [];
  for (const g of games) {
    if (owned.has(g.id) || g.developer_id === user.id) continue;
    let score = 0;
    let topTag = null;
    let topW = 0;
    for (const t of tagsOf(g)) {
      const w = weights.get(t) || 0;
      score += w;
      if (w > topW) {
        topW = w;
        topTag = t;
      }
    }
    const genreW = weights.get(`genre:${g.genre}`) || 0;
    score += genreW;
    const friends = friendOwners.get(g.id) || 0;
    score += friends * 3;
    score += (g.rating ?? 3) * 0.6 + Math.log1p(g.owners + g.downloads) * 0.8;

    let reason = 'Популярно в HYTEAM';
    let best = null;
    let bestOverlap = 0;
    for (const l of liked) {
      const o = overlap(l, g) + (l.genre === g.genre ? 1 : 0);
      if (o > bestOverlap) {
        bestOverlap = o;
        best = l;
      }
    }
    if (friends > 0) reason = `${friends} ${plural(friends, 'друг', 'друга', 'друзей')} уже в игре`;
    else if (best && bestOverlap >= 2) reason = `Похоже на «${best.title}»`;
    else if (topTag) reason = `Вам нравится: ${topTag}`;
    else if (genreW > 0) reason = `Ваш жанр: ${g.genre}`;

    scored.push({ game: g, score, reason });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function similarTo(game, limit = 6) {
  const others = all(`${GAMES} WHERE g.status = 'approved' AND g.id <> ?`, game.id);
  return others
    .map((g) => ({ g, s: overlap(game, g) * 2 + (g.genre === game.genre ? 2 : 0) + (g.rating ?? 0) * 0.2 }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.g);
}
