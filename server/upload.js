import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { IMAGES_DIR, GAMES_DIR, MAX_GAME_MB, MAX_IMAGE_MB } from './config.js';
import { HttpError, fail, fixName } from './util.js';

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const isGameFile = (file) => file.fieldname === 'gamefile';

const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, isGameFile(file) ? GAMES_DIR : IMAGES_DIR),
  filename: (_req, file, cb) => {
    const ext = isGameFile(file)
      ? path.extname(fixName(file.originalname)).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12) || '.bin'
      : IMAGE_EXT[file.mimetype];
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

function fileFilter(_req, file, cb) {
  if (isGameFile(file) || IMAGE_EXT[file.mimetype]) return cb(null, true);
  cb(new HttpError(400, 'Изображения принимаются только в форматах JPG, PNG, WEBP или GIF'));
}

const make = (maxMb) => multer({
  storage,
  fileFilter,
  limits: { fileSize: maxMb * 1024 * 1024, files: 20, fields: 40, fieldSize: 256 * 1024 },
});

export const gameUpload = make(MAX_GAME_MB || Infinity).fields([
  { name: 'cover', maxCount: 1 },
  { name: 'screenshots', maxCount: 12 },
  { name: 'gamefile', maxCount: 1 },
]);
export const postUpload = make(MAX_IMAGE_MB).single('image');
export const profileUpload = make(MAX_IMAGE_MB).fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
]);

function uploadedFiles(req) {
  if (req.file) return [req.file];
  if (!req.files) return [];
  return Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
}

export function cleanupUploads(req) {
  for (const f of uploadedFiles(req)) fs.rm(f.path, { force: true }, () => {});
}

// Лимит размера у multer общий на запрос, поэтому картинки проверяем отдельно.
export function checkImageSizes(req) {
  for (const f of uploadedFiles(req)) {
    if (!isGameFile(f) && f.size > MAX_IMAGE_MB * 1024 * 1024) fail(413, `Изображение больше ${MAX_IMAGE_MB} МБ`);
  }
}

export const withCleanup = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (e) {
    cleanupUploads(req);
    throw e;
  }
};
