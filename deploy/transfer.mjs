// Переезд сервера на другой компьютер: node deploy/transfer.mjs
// Собирает hyteam-transfer.tar.gz — код сервера и копию данных (база, картинки, файлы игр).
// Копия базы снимается через VACUUM INTO, поэтому её можно делать, не останавливая магазин.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const STAGE = path.join(ROOT, 'transfer-tmp');
const OUT = path.join(ROOT, 'hyteam-transfer.tar.gz');

if (!fs.existsSync(path.join(DATA_DIR, 'hyteam.db'))) {
  console.error(`Не найдена база: ${path.join(DATA_DIR, 'hyteam.db')}`);
  process.exit(1);
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'data'), { recursive: true });

const src = new DatabaseSync(path.join(DATA_DIR, 'hyteam.db'), { readOnly: true });
src.exec(`VACUUM INTO '${path.join(STAGE, 'data', 'hyteam.db').replace(/'/g, "''")}'`);
src.close();

// Картинки и файлы игр; недокачанные загрузки (tmp) не нужны.
const uploads = path.join(DATA_DIR, 'uploads');
for (const sub of ['images', 'games']) {
  const from = path.join(uploads, sub);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(STAGE, 'data', 'uploads', sub), { recursive: true });
}

for (const item of ['server', 'public', 'deploy', 'package.json', 'package-lock.json']) {
  if (fs.existsSync(path.join(ROOT, item))) fs.cpSync(path.join(ROOT, item), path.join(STAGE, item), { recursive: true });
}

fs.rmSync(OUT, { force: true });
// Windows tar не понимает путь вида C:\… после -f, поэтому пишем относительный путь из папки проекта.
execFileSync('tar', ['-czf', path.relative(ROOT, OUT), '-C', 'transfer-tmp', '.'], { cwd: ROOT, stdio: 'inherit' });
fs.rmSync(STAGE, { recursive: true, force: true });

const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`\nГотово: ${OUT} (${mb} МБ)`);
console.log('Скопируйте файл на ноутбук и следуйте инструкции в deploy/home-server.sh');
