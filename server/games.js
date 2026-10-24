import { one, all } from './db.js';
import { mediaUrl, isMod, splitTags } from './util.js';

const GAME_SELECT = `SELECT g.*, u.username AS dev_username, u.display_name AS dev_name, u.avatar AS dev_avatar,
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.game_id = g.id) AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS reviews_count,
  (SELECT COUNT(*) FROM library l WHERE l.game_id = g.id) AS owners
  FROM games g JOIN users u ON u.id = g.developer_id`;

// Обёртка, чтобы вычисляемые поля (rating, owners…) были доступны в WHERE и ORDER BY.
export const GAMES = `SELECT * FROM (${GAME_SELECT}) g`;

export const SORTS = {
  popular: '(g.owners + g.downloads) DESC, g.published_at DESC',
  new: 'g.published_at DESC, g.id DESC',
  rating: 'COALESCE(g.rating, 0) DESC, g.reviews_count DESC',
  title: 'g.title COLLATE NOCASE ASC',
};

const NO_SETS = { lib: new Set(), wish: new Set() };

export function userSets(user) {
  if (!user) return NO_SETS;
  return {
    lib: new Set(all('SELECT game_id FROM library WHERE user_id = ?', user.id).map((r) => r.game_id)),
    wish: new Set(all('SELECT game_id FROM wishlist WHERE user_id = ?', user.id).map((r) => r.game_id)),
  };
}

export const getGame = (id) => one(`${GAMES} WHERE g.id = ?`, Number(id) || 0);

export const canSee = (g, user) => g.status === 'approved' || (!!user && (user.id === g.developer_id || isMod(user)));

export function gameOut(g, sets = NO_SETS, { full = false, viewer = null } = {}) {
  const out = {
    id: g.id,
    title: g.title,
    short_desc: g.short_desc,
    genre: g.genre,
    tags: splitTags(g.tags),
    cover: mediaUrl(g.cover),
    version: g.version,
    platform: g.platform,
    status: g.status,
    featured: !!g.featured,
    downloads: g.downloads,
    owners: g.owners ?? 0,
    rating: g.rating == null ? null : Number(g.rating),
    reviews_count: g.reviews_count ?? 0,
    file_size: g.file_size,
    has_file: !!(g.file_path || g.external_url),
    // «Внешняя» — ссылка, которую открываем в браузере. Релизы GitHub программа HYTEAM ставит сама.
    external: !g.file_path && !!g.external_url && g.source !== 'github',
    source: g.source || 'file',
    channel: g.channel || 'stable',
    category: g.category || '',
    price: g.price || 0,
    github: g.source === 'github'
      ? { repo: g.github_repo, url: `https://github.com/${g.github_repo}`, tag: g.github_tag, checked_at: g.github_checked_at }
      : null,
    launch: g.launch_path || '',
    developer: { id: g.developer_id, username: g.dev_username, display_name: g.dev_name, avatar: mediaUrl(g.dev_avatar) },
    created_at: g.created_at,
    updated_at: g.updated_at,
    published_at: g.published_at,
    in_library: sets.lib.has(g.id),
    in_wishlist: sets.wish.has(g.id),
  };
  if (full) {
    out.description = g.description;
    out.requirements = g.requirements;
    out.file_name = g.file_name;
    if (out.github) out.github.notes = g.github_notes;
    if (viewer && (viewer.id === g.developer_id || isMod(viewer))) {
      out.can_edit = true;
      out.reject_reason = g.reject_reason;
      out.external_url = g.external_url;
      if (out.github) Object.assign(out.github, { asset: g.github_asset, prerelease: !!g.github_prerelease, error: g.github_error });
    }
  }
  return out;
}
