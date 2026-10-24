// Игры и программы из GitHub: берём файл из последнего релиза репозитория и следим за новыми релизами.
// Проверка использует ETag — ответ «не изменилось» (304) не расходует лимит запросов GitHub API.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GITHUB_POLL_MIN, GITHUB_TOKEN, IMAGES_DIR } from './config.js';
import { one, all, run } from './db.js';
import { HttpError, fail, notify } from './util.js';
import { applyMain } from './versions.js';

const API = 'https://api.github.com';
// До какого времени GitHub ограничил запросы — фоновая проверка в это время молчит.
let limitedUntil = 0;

/** Все релизы репозитория (до 30 последних) — одним запросом. */
export const fetchReleases = (repo, etag = null) => gh(`/repos/${repo}/releases?per_page=30`, etag);

function headers(etag) {
  const h = {
    'User-Agent': 'HYTEAM-Store',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  if (etag) h['If-None-Match'] = etag;
  return h;
}

async function gh(apiPath, etag = null) {
  let res;
  try {
    res = await fetch(API + apiPath, { headers: headers(etag), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, 'Не удалось связаться с GitHub — проверьте интернет на сервере');
  }
  if (res.status === 304) return { notModified: true };
  if (res.status === 404) throw new HttpError(404, 'Репозиторий или релиз не найден на GitHub');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    limitedUntil = reset > Date.now() ? reset : Date.now() + 15 * 60e3;
    throw new HttpError(503, 'GitHub временно ограничил запросы. Попробуйте позже или задайте GITHUB_TOKEN на сервере');
  }
  if (!res.ok) throw new HttpError(502, `GitHub ответил ошибкой ${res.status}`);
  return { data: await res.json(), etag: res.headers.get('etag') };
}

export function parseRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/i, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/i)
    || s.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) fail(400, 'Укажите репозиторий GitHub: ссылку вида https://github.com/автор/проект');
  return `${m[1]}/${m[2]}`;
}

export async function latestRelease(repo, prerelease, etag = null) {
  if (!prerelease) {
    try {
      return await gh(`/repos/${repo}/releases/latest`, etag);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  const r = await gh(`/repos/${repo}/releases?per_page=10`, prerelease ? etag : null);
  if (r.notModified) return r;
  const rel = r.data.find((x) => !x.draft && (prerelease || !x.prerelease)) || r.data.find((x) => !x.draft);
  if (!rel) throw new HttpError(404, 'У этого репозитория пока нет релизов на GitHub');
  return { data: rel, etag: r.etag };
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globToRe = (p) => new RegExp(`^${p.split('*').map(escapeRe).join('.*')}$`, 'i');

/** Шаблон имени файла без номера версии: zapret_zen_2.8_win_x64.zip → zapret_zen_*_win_x64.zip */
export function patternFromName(name, tag) {
  let p = String(name);
  const v = String(tag || '').replace(/^v/i, '');
  if (v) p = p.split(v).join('*');
  return p.replace(/v?\d+(?:\.\d+)+(?:[-.]?(?:alpha|beta|rc|pre|b|a)\.?\d*)?/gi, '*').replace(/\*+/g, '*');
}

function assetScore(a) {
  const n = a.name.toLowerCase();
  let s = 0;
  if (/\.zip$/.test(n)) s += 4;
  if (/\.(7z|rar)$/.test(n)) s += 3;
  if (/\.exe$/.test(n)) s += 2;
  if (/\.msi$/.test(n)) s += 1;
  if (/win|windows|x64|amd64|x86_64|portable/.test(n)) s += 3;
  if (/(^|[-_.])arm([-_.]|$)|linux|mac|darwin|osx|arm64|aarch64|\.apk$|\.deb$|\.rpm$|\.dmg$|\.appimage$|\.tar\.|sha\d*|\.sig$|\.asc$|checksum|\.txt$|\.md$|\.json$/.test(n)) s -= 10;
  return s;
}

/** Выбирает файл релиза: по шаблону, иначе лучший файл для Windows, иначе архив исходного кода. */
export function pickAsset(release, pattern, repo) {
  const assets = release.assets || [];
  if (pattern && pattern !== ':source') {
    const re = globToRe(pattern);
    const hit = assets.filter((a) => re.test(a.name)).sort((a, b) => assetScore(b) - assetScore(a))[0];
    if (hit) return hit;
  }
  if (pattern !== ':source') {
    const best = [...assets].sort((a, b) => assetScore(b) - assetScore(a))[0];
    if (best && assetScore(best) > 0) return best;
  }
  const tag = release.tag_name;
  return {
    name: `${repo.split('/')[1]}-${tag}.zip`,
    size: null,
    browser_download_url: `https://github.com/${repo}/archive/refs/tags/${encodeURIComponent(tag)}.zip`,
    fallback: true,
  };
}

const previewCache = new Map();

export async function githubPreview(input, prerelease = false) {
  const repo = parseRepo(input);
  const key = `${repo.toLowerCase()}|${prerelease ? 1 : 0}`;
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.v;
  const [{ data: info }, { data: release }] = await Promise.all([gh(`/repos/${repo}`), latestRelease(repo, prerelease)]);
  const auto = pickAsset(release, '', info.full_name);
  const v = {
    repo: info.full_name,
    url: info.html_url,
    description: info.description || '',
    stars: info.stargazers_count,
    topics: info.topics || [],
    license: info.license?.spdx_id || null,
    release: {
      tag: release.tag_name,
      name: release.name || release.tag_name,
      published_at: Date.parse(release.published_at || release.created_at),
      prerelease: !!release.prerelease,
    },
    assets: (release.assets || []).map((a) => ({
      name: a.name,
      size: a.size,
      downloads: a.download_count,
      pattern: patternFromName(a.name, release.tag_name),
    })),
    auto: auto.name,
  };
  previewCache.set(key, { t: Date.now(), v });
  return v;
}

/** Картинка-превью репозитория с GitHub — обложка по умолчанию. Возвращает имя файла или null. */
export async function fetchGithubCover(repo) {
  try {
    const res = await fetch(`https://opengraph.githubassets.com/1/${repo}`, {
      headers: { 'User-Agent': 'HYTEAM-Store' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok || !/^image\/png/.test(res.headers.get('content-type') || '')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    const name = `${crypto.randomBytes(16).toString('hex')}.png`;
    fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
    return name;
  } catch {
    return null;
  }
}

/**
 * Синхронизация с GitHub: каждый релиз становится версией игры (pre-release — «бета»),
 * основной становится самый новый рабочий релиз. force — без ETag (после смены репозитория или шаблона файла).
 * prefetched — уже полученный список релизов, чтобы не тратить лишний запрос к API.
 */
export async function syncGame(g, { force = false, prefetched = null } = {}) {
  const now = Date.now();
  let r = prefetched;
  try {
    r ??= await fetchReleases(g.github_repo, force ? null : g.github_etag);
  } catch (e) {
    run('UPDATE games SET github_checked_at = ?, github_error = ? WHERE id = ?', now, e.message, g.id);
    throw e;
  }
  if (r.notModified) {
    run('UPDATE games SET github_checked_at = ?, github_error = NULL WHERE id = ?', now, g.id);
    return { changed: false, version: g.version };
  }
  const releases = (r.data || []).filter((x) => !x.draft);
  if (!releases.length) {
    const msg = 'У этого репозитория пока нет релизов на GitHub';
    run('UPDATE games SET github_checked_at = ?, github_error = ? WHERE id = ?', now, msg, g.id);
    throw new HttpError(404, msg);
  }

  for (const rel of releases) {
    const asset = pickAsset(rel, g.github_asset, g.github_repo);
    const tag = String(rel.tag_name || rel.name || '').slice(0, 30);
    if (!tag) continue;
    // Релиз с файлами, но без сборки для Windows (ещё собирается или только Linux/Mac) — пропускаем.
    if (asset.fallback && (rel.assets || []).length && g.github_asset !== ':source') {
      run("DELETE FROM game_versions WHERE game_id = ? AND source = 'github' AND version = ?", g.id, tag);
      continue;
    }
    // Описание релиза показываем текстом: убираем HTML-теги и markdown-картинки.
    const notes = String(rel.body || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 20000);
    const existing = one("SELECT id FROM game_versions WHERE game_id = ? AND source = 'github' AND version = ?", g.id, tag);
    if (existing) {
      run(
        `UPDATE game_versions SET external_url = ?, file_name = ?, file_size = ?, notes = ?,
           channel = CASE WHEN channel_manual = 1 THEN channel ELSE ? END WHERE id = ?`,
        asset.browser_download_url, asset.name, asset.size, notes, rel.prerelease ? 'beta' : 'stable', existing.id,
      );
    } else {
      run(
        `INSERT INTO game_versions(game_id, version, channel, notes, file_name, file_size, external_url, source, status, created_at)
         VALUES(?,?,?,?,?,?,?,'github','approved',?)`,
        g.id, tag, rel.prerelease ? 'beta' : 'stable', notes, asset.name, asset.size, asset.browser_download_url,
        Date.parse(rel.published_at || rel.created_at) || now,
      );
    }
  }

  // Основная — самый новый релиз, не помеченный как нерабочий (стабильный, если пре-релизы не включены).
  const pick = (stableOnly) => one(
    `SELECT * FROM game_versions WHERE game_id = ? AND source = 'github' AND status = 'approved' AND channel <> 'broken'
     ${stableOnly ? "AND channel = 'stable'" : ''} ORDER BY created_at DESC, id DESC LIMIT 1`,
    g.id,
  );
  const main = pick(!g.github_prerelease) || pick(false);
  run('UPDATE games SET github_etag = ?, github_checked_at = ?, github_error = NULL WHERE id = ?', r.etag, now, g.id);
  if (!main) return { changed: false, version: g.version };
  const changed = main.version !== g.github_tag;
  if (main.id !== g.main_version_id || main.version !== g.version || main.external_url !== g.external_url) {
    applyMain(g.id, main.id);
  }
  run('UPDATE games SET github_tag = ?, github_notes = ? WHERE id = ?', main.version, main.notes, g.id);
  // Уведомляем игроков только о настоящем новом релизе опубликованной игры, а не о первой синхронизации.
  if (changed && g.github_tag && g.status === 'approved') {
    for (const o of all('SELECT user_id FROM library WHERE game_id = ? LIMIT 2000', g.id)) {
      notify(o.user_id, `Вышло обновление «${g.title}» — версия ${main.version}`, `/game/${g.id}?tab=versions`);
    }
  }
  return { changed, version: main.version };
}

let polling = false;

/**
 * Фоновая проверка релизов раз в минуту. Без токена GitHub даёт 60 запросов в час,
 * поэтому интервал растёт вместе с числом игр (например, 25 игр — раз в 30 минут).
 */
export function startGithubPoller() {
  const tick = async () => {
    if (polling || Date.now() < limitedUntil) return;
    polling = true;
    try {
      const count = one("SELECT COUNT(*) AS c FROM games WHERE source = 'github' AND status IN ('approved', 'pending')").c;
      const intervalMin = GITHUB_TOKEN ? GITHUB_POLL_MIN : Math.max(GITHUB_POLL_MIN, Math.ceil(count * 1.2));
      const due = all(
        `SELECT * FROM games WHERE source = 'github' AND status IN ('approved', 'pending')
         AND (github_checked_at IS NULL OR github_checked_at < ?) ORDER BY github_checked_at ASC LIMIT 50`,
        Date.now() - intervalMin * 60e3 + 30e3,
      );
      for (const g of due) {
        if (Date.now() < limitedUntil) break;
        try {
          const res = await syncGame(g);
          if (res.changed && g.github_tag) console.log(`GitHub: «${g.title}» обновлена до ${res.version}`);
        } catch (e) {
          console.warn(`GitHub ${g.github_repo}: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      polling = false;
    }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 60e3).unref();
}

export const getGameRow = (id) => one('SELECT * FROM games WHERE id = ?', id);
