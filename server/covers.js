// Обложки для программ каталога в едином стиле HYTEAM: иконка программы на фирменном фоне и название.
// Иконку берём с официального сайта (apple-touch-icon, иконка сайта) или аватар проекта на GitHub.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR } from './config.js';
import { esc } from './util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;

async function fetchImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (/\.ico(\?|$)/i.test(url) && !IMAGE_TYPES.test(type)) type = 'image/x-icon';
    if (/\.svg(\?|$)/i.test(url) && !IMAGE_TYPES.test(type)) type = 'image/svg+xml';
    if (!res.ok || !IMAGE_TYPES.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200 || buf.length > 1024 * 1024) return null;
    return { type, buf };
  } catch {
    return null;
  }
}

// Кандидаты в иконки со страницы сайта, лучшие — первыми.
async function siteIcons(home) {
  const list = [];
  try {
    const res = await fetch(home, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const page = await res.text();
    for (const tag of page.match(/<link\b[^>]*>/gi) || []) {
      const rel = (tag.match(/\brel=["']([^"']+)["']/i) || [])[1]?.toLowerCase() || '';
      const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
      if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
      const size = Number((tag.match(/\bsizes=["'](\d+)x\d+["']/i) || [])[1]) || 0;
      const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(tag);
      const score = (rel.includes('apple-touch') ? 400 : 0) + (svg ? 300 : 0) + Math.min(size, 512);
      list.push({ url: new URL(href.replace(/&amp;/g, '&'), res.url).href, score });
    }
    list.sort((a, b) => b.score - a.score);
    list.push({ url: new URL('/favicon.ico', res.url).href, score: 0 });
  } catch {
    try {
      list.push({ url: new URL('/favicon.ico', home).href, score: 0 });
    } catch {
      /* некорректный адрес */
    }
  }
  return list.map((x) => x.url);
}

async function findIcon({ icon, home, github }) {
  const candidates = icon ? [icon] : [];
  if (home) candidates.push(...(await siteIcons(home)));
  if (github) candidates.push(`https://github.com/${github.split('/')[0]}.png?size=256`);
  // Запасной вариант — иконка сайта через сервис Google.
  if (home) candidates.push(`https://www.google.com/s2/favicons?domain=${new URL(home).hostname}&sz=256`);
  for (const url of candidates.slice(0, 8)) {
    const img = await fetchImage(url);
    if (img) return img;
  }
  return null;
}

function hueOf(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// Длинные названия переносим на две строки и уменьшаем шрифт.
function titleLines(title) {
  // Место под текст — около 620 px справа от иконки.
  const words = String(title).split(/\s+/);
  if (title.length <= 12) return { lines: [title], size: 76 };
  if (title.length <= 15) return { lines: [title], size: 62 };
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur && `${cur} ${w}`.length > 16 && lines.length < 3) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  const longest = Math.max(...lines.map((l) => l.length));
  return { lines, size: Math.min(58, Math.floor(1000 / longest)) };
}

export function coverSvg({ title, group, icon }) {
  const h = hueOf(title);
  const { lines, size } = titleLines(title);
  const textX = 600;
  const startY = 360 - ((lines.length - 1) * size * 1.1) / 2 + size * 0.1;
  const iconTag = icon
    ? `<image href="data:${icon.type};base64,${icon.buf.toString('base64')}" x="202" y="222" width="236" height="236" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="320" y="390" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="150" font-weight="800" fill="#fff">${esc(String(title).trim()[0] || '?').toUpperCase()}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0624"/><stop offset="1" stop-color="hsl(${h},55%,16%)"/></linearGradient>
  <radialGradient id="glow" cx="0.25" cy="0.5" r="0.55"><stop offset="0" stop-color="hsl(${h},85%,55%)" stop-opacity="0.55"/><stop offset="1" stop-color="hsl(${h},85%,55%)" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow2" cx="0.92" cy="0.05" r="0.6"><stop offset="0" stop-color="#7c3aed" stop-opacity="0.45"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#bg)"/>
<rect width="1280" height="720" fill="url(#glow)"/>
<rect width="1280" height="720" fill="url(#glow2)"/>
<rect x="160" y="180" width="320" height="320" rx="72" fill="url(#tile)" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>
${iconTag}
<text x="${textX}" y="${startY - size * 0.95}" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="600" letter-spacing="3" fill="hsl(${h},80%,80%)" fill-opacity="0.85">${esc(String(group || 'ПРОГРАММА').toUpperCase())}</text>
${lines.map((l, i) => `<text x="${textX}" y="${startY + i * size * 1.1}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join('\n')}
<text x="1220" y="680" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="5" fill="#ffffff" fill-opacity="0.35">HYTEAM</text>
</svg>`;
}

/** Создать обложку и сохранить в картинки магазина. Возвращает { file, hasIcon }. */
export async function makeCover(item) {
  const icon = await findIcon(item);
  const file = `${crypto.randomBytes(16).toString('hex')}.svg`;
  fs.writeFileSync(path.join(IMAGES_DIR, file), coverSvg({ title: item.title, group: item.group, icon }));
  return { file, hasIcon: !!icon };
}
