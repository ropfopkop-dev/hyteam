// Вшить адрес сервера в программу: npm run set-server -- https://адрес
// После этого соберите установщик (npm run dist): все, кто его установит, сразу подключатся к этому серверу.
// Убрать адрес: npm run set-server -- none
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.json');
const arg = (process.argv[2] || '').trim();

if (!arg) {
  const current = JSON.parse(fs.readFileSync(file, 'utf8')).url;
  console.log(current ? `Сейчас вшит сервер: ${current}` : 'Сервер не вшит — программа спрашивает адрес при первом запуске.');
  console.log('Использование: npm run set-server -- https://адрес   (или none, чтобы убрать)');
  process.exit(0);
}

let url = '';
if (arg !== 'none') {
  try {
    const u = new URL(/^https?:\/\//i.test(arg) ? arg : `https://${arg}`);
    url = u.origin;
  } catch {
    console.error(`Некорректный адрес: ${arg}`);
    process.exit(1);
  }
  if (/trycloudflare\.com$/i.test(new URL(url).hostname)) {
    console.warn('Внимание: адрес trycloudflare.com меняется после каждого перезапуска туннеля — вшивать его не стоит.');
  }
}
// Остальные поля (discover — репозиторий с адресом сервера) сохраняем.
fs.writeFileSync(file, `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), url }, null, 2)}\n`);
console.log(url ? `Готово: вшит сервер ${url}. Теперь соберите установщик: npm run dist` : 'Вшитый сервер убран.');
