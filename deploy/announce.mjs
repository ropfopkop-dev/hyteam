// Служба hyteam-announce: следит за адресом быстрого туннеля (журнал hyteam-tunnel)
// и публикует его в GitHub, когда он меняется. Настройки — в /etc/hyteam.env:
//   PUBLISH_REPO=владелец/репозиторий   PUBLISH_TOKEN=github_pat_…
import { execFileSync } from 'node:child_process';
import { publishAddress } from '../server/publish-address.js';

const { PUBLISH_REPO: repo, PUBLISH_TOKEN: token } = process.env;
if (!repo || !token) {
  console.log('Публикация адреса не настроена (PUBLISH_REPO / PUBLISH_TOKEN) — выхожу');
  process.exit(0);
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;
let published = '';

function currentUrl() {
  try {
    const log = execFileSync('journalctl', ['-u', 'hyteam-tunnel', '-b', '--no-pager', '-o', 'cat'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return (log.match(URL_RE) || []).pop() || '';
  } catch {
    return '';
  }
}

async function tick() {
  const url = currentUrl();
  if (!url || url === published) return;
  try {
    const r = await publishAddress(repo, token, url);
    published = url;
    console.log(r === 'same' ? `Адрес не изменился: ${url}` : `Опубликован адрес: ${url}`);
  } catch (e) {
    console.error(`Не удалось опубликовать адрес: ${e.message}`);
  }
}

await tick();
setInterval(tick, 20000);
