import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { PORT, HOST, IMAGES_DIR, ROOT, MAX_GAME_MB, DATA_DIR } from './config.js';
import { loadUser } from './auth.js';
import { GENRES, PLATFORMS, esc } from './util.js';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/games.js';
import communityRoutes from './routes/community.js';
import userRoutes from './routes/users.js';
import modRoutes from './routes/moderation.js';
import uploadRoutes, { cleanupStaleUploads } from './routes/uploads.js';
import versionRoutes from './routes/versions.js';
import paymentRoutes from './routes/payments.js';
import { migrateVersions } from './versions.js';
import { startGithubPoller } from './github.js';
import { mailEnabled } from './mail.js';
import { GROUPS, fillCatalogCategories } from './catalog.js';

const app = express();
app.disable('x-powered-by');
// За Caddy/nginx или туннелем Cloudflare настоящий IP и https берём из заголовков,
// но верим им только от локального прокси.
app.set('trust proxy', 'loopback');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  req.body ??= {};
  next();
});
app.use(loadUser);

app.get('/api/meta', (_req, res) => res.json({ genres: GENRES, platforms: PLATFORMS, maxGameMb: MAX_GAME_MB, mailEnabled: mailEnabled(), categories: GROUPS }));
app.use('/api/auth', authRoutes);
app.use('/api/mod', modRoutes);
app.use('/api', uploadRoutes);
app.use('/api', versionRoutes);
app.use('/api', paymentRoutes);
app.use('/api', gameRoutes);
app.use('/api', communityRoutes);
app.use('/api', userRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));

app.use('/media', express.static(IMAGES_DIR, { maxAge: '7d', index: false }));
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `Файл слишком большой${MAX_GAME_MB ? ` (максимум ${MAX_GAME_MB} МБ)` : ''}` : `Ошибка загрузки: ${err.message}`;
  }
  if (status >= 500) {
    console.error(err);
    message = 'Внутренняя ошибка сервера';
  }
  // Скачивание открывается обычным переходом по ссылке — показываем понятную страницу, а не JSON.
  if (req.path.endsWith('/download') && req.accepts(['json', 'html']) === 'html') {
    return res.status(status).type('html').send(
      `<!doctype html><meta charset="utf-8"><title>HYTEAM</title>
       <body style="background:#07051a;color:#f4f2ff;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
       <div style="text-align:center"><h2>${esc(message)}</h2><p><a style="color:#c084fc" href="/">Вернуться в HYTEAM</a></p></div>`,
    );
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  HYTEAM запущен`);
  console.log(`  Локально:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`  В сети:     http://${ni.address}:${PORT}`);
    }
  }
  console.log(`  Данные:     ${DATA_DIR}\n`);
  migrateVersions();
  fillCatalogCategories();
  cleanupStaleUploads();
  setInterval(cleanupStaleUploads, 3600e3).unref();
  startGithubPoller();
});
