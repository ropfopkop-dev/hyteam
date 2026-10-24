import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const IMAGES_DIR = path.join(DATA_DIR, 'uploads', 'images');
export const GAMES_DIR = path.join(DATA_DIR, 'uploads', 'games');
export const TMP_DIR = path.join(DATA_DIR, 'uploads', 'tmp');

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '0.0.0.0';
// Максимальный размер файла игры в МБ; 0 — без ограничений (по умолчанию).
export const MAX_GAME_MB = Math.max(Number(process.env.MAX_GAME_MB) || 0, 0);
export const MAX_IMAGE_MB = 15;
// Большие файлы грузятся кусками — так проходят через прокси и туннели с лимитом на запрос (Cloudflare: 100 МБ).
export const CHUNK_MB = 16;
// Игры из GitHub: как часто проверять новые релизы и необязательный токен (поднимает лимит API с 60 до 5000 запросов в час).
export const GITHUB_POLL_MIN = Math.max(Number(process.env.GITHUB_POLL_MIN) || 5, 1);
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
// Включите COOKIE_SECURE=1, если сайт работает через HTTPS.
export const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
