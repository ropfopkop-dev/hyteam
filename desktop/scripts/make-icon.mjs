// Делает иконку приложения из public/assets/logo.webp: npm run icon
// Вырезает скруглённый квадрат логотипа с прозрачным фоном и сохраняет PNG 512 и 256 px.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'logo.webp')).toString('base64');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const render = (size) => win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/webp;base64,${src}';
    await img.decode();
    const k = img.width / 1254;
    // Положение скруглённого квадрата на исходном логотипе (1254×1254).
    const sx = 104 * k, sy = 98 * k, side = 1048 * k;
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const x = c.getContext('2d');
    const r = ${size} * 0.2;
    x.beginPath();
    x.roundRect(0, 0, ${size}, ${size}, r);
    x.clip();
    x.drawImage(img, sx, sy, side, side, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png');
  })()`);
  for (const [size, out] of [[512, 'build/icon.png'], [256, 'assets/icon.png']]) {
    const data = await render(size);
    const file = path.join(ROOT, 'desktop', out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('saved', file);
  }
  app.quit();
});
