// Резервная копия базы: node server/backup.js
// Сохраняет согласованную копию в DATA_DIR/backups и оставляет 7 последних.
// Файлы игр и картинки (DATA_DIR/uploads) не копируются — их бэкапьте отдельно.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { DATA_DIR } from './config.js';

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `hyteam-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(file, { force: true });
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

const old = fs.readdirSync(dir).filter((f) => /^hyteam-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7);
for (const f of old) fs.rmSync(path.join(dir, f));
console.log(`Резервная копия: ${file}`);
