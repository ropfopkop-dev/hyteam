// Версии игр: стабильные, бета, альфа и т. д. Основная версия дублируется в games.* —
// её получают по умолчанию, к ней идут автообновления.
import { one, all, run } from './db.js';
import { isMod, removeGameFile } from './util.js';

export const CHANNELS = ['stable', 'beta', 'alpha', 'rc', 'unstable', 'broken'];

/** Скопировать версию в поля игры и сделать её основной. */
export function applyMain(gameId, versionId) {
  const v = one('SELECT * FROM game_versions WHERE id = ? AND game_id = ?', versionId, gameId);
  if (!v) return;
  run(
    `UPDATE games SET main_version_id = ?, version = ?, channel = ?, file_path = ?, file_name = ?, file_size = ?,
       external_url = ?, updated_at = ? WHERE id = ?`,
    v.id, v.version, v.channel, v.file_path, v.file_name, v.file_size, v.external_url, Date.now(), gameId,
  );
}

/**
 * Привести основную версию в соответствие с полями игры (после публикации или редактирования).
 * Если основной версии ещё нет — создать её.
 */
export function syncMainFromGame(gameId, userId = null) {
  const g = one('SELECT * FROM games WHERE id = ?', gameId);
  if (!g || g.source === 'github' || (!g.file_path && !g.external_url)) return;
  const main = g.main_version_id && one('SELECT * FROM game_versions WHERE id = ? AND game_id = ?', g.main_version_id, g.id);
  if (main) {
    run(
      'UPDATE game_versions SET version = ?, file_path = ?, file_name = ?, file_size = ?, external_url = ?, status = ? WHERE id = ?',
      g.version, g.file_path, g.file_name, g.file_size, g.external_url, g.status === 'approved' ? 'approved' : main.status, main.id,
    );
    return;
  }
  const info = run(
    `INSERT INTO game_versions(game_id, version, channel, file_path, file_name, file_size, external_url, source, status, created_by, created_at)
     VALUES(?,?,?,?,?,?,?,'file','approved',?,?)`,
    g.id, g.version, g.channel || 'stable', g.file_path, g.file_name, g.file_size, g.external_url, userId ?? g.developer_id, g.published_at || g.created_at,
  );
  run('UPDATE games SET main_version_id = ? WHERE id = ?', Number(info.lastInsertRowid), g.id);
}

/** Для игр, созданных до появления версий, заводим основную версию из текущего файла. */
export function migrateVersions() {
  for (const g of all("SELECT id FROM games WHERE main_version_id IS NULL AND source <> 'github' AND (file_path IS NOT NULL OR external_url IS NOT NULL)")) {
    syncMainFromGame(g.id);
  }
}

/** Файлы версий, которые больше нигде не используются. */
export function removeVersionFile(v) {
  if (!v.file_path) return;
  const used = one(
    'SELECT 1 FROM game_versions WHERE file_path = ? AND id <> ? UNION SELECT 1 FROM games WHERE file_path = ?',
    v.file_path, v.id, v.file_path,
  );
  if (!used) removeGameFile(v.file_path);
}

export function versionOut(v, g, viewer) {
  const canEdit = !!viewer && (viewer.id === g.developer_id || isMod(viewer));
  return {
    id: v.id,
    version: v.version,
    channel: v.channel,
    notes: v.notes,
    file_name: v.file_name,
    file_size: v.file_size,
    external: !v.file_path && !!v.external_url && v.source !== 'github',
    source: v.source,
    status: v.status,
    reject_reason: canEdit ? v.reject_reason : undefined,
    downloads: v.downloads,
    created_at: v.created_at,
    is_main: v.id === g.main_version_id,
    can_edit: canEdit,
  };
}

/** Видимые пользователю версии: одобренные всем, остальные — разработчику и модераторам. */
export function listVersions(g, viewer) {
  const canEdit = !!viewer && (viewer.id === g.developer_id || isMod(viewer));
  const rows = all(
    `SELECT * FROM game_versions WHERE game_id = ? ${canEdit ? '' : "AND status = 'approved'"} ORDER BY created_at DESC, id DESC`,
    g.id,
  );
  return rows.map((v) => versionOut(v, g, viewer));
}
