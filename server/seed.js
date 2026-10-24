// Демо-данные, чтобы посмотреть магазин «вживую»: npm run seed
// Создаёт демо-разработчиков, игры с обложками, отзывы, посты и друзей.
// Ваш аккаунт-администратор при этом не создаётся и не меняется.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { IMAGES_DIR, GAMES_DIR } from './config.js';

if (one("SELECT 1 FROM users WHERE username = 'pixelfox'")) {
  console.log('Демо-данные уже добавлены.');
  process.exit(0);
}

const DEMO_PASSWORD = 'demo1234';
const rnd = (() => {
  let s = 42;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
})();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const DAY = 24 * 3600 * 1000;
const now = Date.now();

function svgArt(title, h1, h2, variant, label = true) {
  const shapes = [];
  if (variant % 3 === 0) {
    // горы
    for (let layer = 0; layer < 3; layer++) {
      let d = `M0 720 L0 ${420 + layer * 70}`;
      for (let x = 0; x <= 1280; x += 80) d += ` L${x} ${380 + layer * 80 + Math.round(rnd() * 120 - 60)}`;
      d += ' L1280 720 Z';
      shapes.push(`<path d="${d}" fill="hsl(${h1},60%,${8 + layer * 5}%)" opacity="${0.6 + layer * 0.15}"/>`);
    }
    shapes.unshift(`<circle cx="${900 + Math.round(rnd() * 200)}" cy="230" r="120" fill="hsl(${h2},90%,70%)" opacity=".85"/>`);
  } else if (variant % 3 === 1) {
    // неоновая сетка
    for (let i = 0; i < 16; i++) shapes.push(`<line x1="${640 + (i - 8) * 30}" y1="400" x2="${640 + (i - 8) * 220}" y2="720" stroke="hsl(${h2},90%,65%)" stroke-opacity=".5" stroke-width="2"/>`);
    for (let i = 0; i < 7; i++) shapes.push(`<line x1="0" y1="${400 + i * i * 7}" x2="1280" y2="${400 + i * i * 7}" stroke="hsl(${h2},90%,65%)" stroke-opacity=".45" stroke-width="2"/>`);
    shapes.unshift(`<circle cx="640" cy="330" r="170" fill="url(#sun)"/>`);
  } else {
    // кристаллы
    for (let i = 0; i < 14; i++) {
      const x = Math.round(rnd() * 1280);
      const y = Math.round(rnd() * 720);
      const s = 40 + Math.round(rnd() * 140);
      shapes.push(`<polygon points="${x},${y - s} ${x + s * 0.6},${y} ${x},${y + s} ${x - s * 0.6},${y}" fill="hsl(${pick([h1, h2])},80%,${45 + Math.round(rnd() * 25)}%)" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`);
    }
  }
  const text = label
    ? `<text x="70" y="640" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="88" fill="#fff" style="letter-spacing:-2px">${title}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},70%,14%)"/><stop offset="1" stop-color="hsl(${h2},75%,38%)"/></linearGradient>
<radialGradient id="r" cx=".78" cy=".25" r=".7"><stop offset="0" stop-color="hsl(${h2},95%,70%)" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h2},95%,70%)"/><stop offset="1" stop-color="hsl(${h1},90%,55%)"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#r)"/>
${shapes.join('\n')}
<rect width="1280" height="720" fill="url(#shade)"/>
${text}
</svg>`;
}

function saveSvg(svg) {
  const name = `${crypto.randomBytes(12).toString('hex')}.svg`;
  fs.writeFileSync(path.join(IMAGES_DIR, name), svg);
  return name;
}

const USERS = [
  ['pixelfox', 'Пиксельный Лис', 'Делаю инди-игры по вечерам. Люблю пиксель-арт и синтвейв.'],
  ['nightowl', 'Ночная Сова', 'Хоррор и атмосферные игры — моё всё.'],
  ['ironbyte', 'IronByte Studio', 'Маленькая студия из трёх человек. Стратегии и симуляторы.'],
  ['luna', 'Luna', 'Играю во всё подряд, пишу честные отзывы.'],
  ['darkknight', 'DarkKnight', 'Шутеры, гонки и соревновательные игры.'],
];

const GAMES = [
  ['Neon Drift', 'Гонки', 'киберпанк,неон,аркада,синтвейв', 'Аркадные гонки по ночному неоновому мегаполису под синтвейв.', 0, 280, 320, 1],
  ['Тени Севера', 'RPG', 'тёмное фэнтези,открытый мир,сюжет,викинги', 'Мрачная ролевая игра в северных землях, где каждый выбор имеет цену.', 0, 210, 260, 0],
  ['Pixel Dungeon Run', 'Экшен', 'рогалик,пиксель-арт,подземелья,хардкор', 'Быстрый рогалик: каждый забег — новое подземелье, новые боссы и предметы.', 0, 20, 330, 2],
  ['Звёздный Архитектор', 'Стратегия', 'космос,строительство,экономика,песочница', 'Стройте орбитальные станции и управляйте экономикой целой системы.', 2, 230, 190, 0],
  ['Last Signal', 'Хоррор', 'выживание,атмосфера,психологический,одиночка', 'Вы — единственный оператор на заброшенной радиостанции. Кто-то отвечает.', 1, 260, 340, 1],
  ['Sky Islands', 'Песочница', 'крафт,кооператив,исследование,выживание', 'Исследуйте парящие острова, стройте дирижабли и выживайте вместе с друзьями.', 0, 190, 150, 2],
  ['Ритм Улиц', 'Аркада', 'ритм,музыка,неон,аркада', 'Танцевальная ритм-игра с уличной музыкой и неоновыми битвами.', 0, 300, 330, 1],
  ['Mecha Arena', 'Шутер', 'мультиплеер,роботы,PvP,киберпанк', 'Командные бои гигантских роботов на разрушаемых аренах.', 2, 200, 280, 0],
  ['Тихая Гавань', 'Казуальная', 'уют,фермерство,релакс,пиксель-арт', 'Уютная ферма у моря: рыбалка, огород и тёплые вечера с соседями.', 1, 150, 40, 0],
  ['Quantum Puzzle', 'Головоломка', 'логика,физика,минимализм,сюжет', 'Головоломки с квантовыми частицами: находитесь в двух местах одновременно.', 2, 240, 200, 2],
  ['Forest Spirit', 'Платформер', 'пиксель-арт,сказка,приключение,одиночка', 'Сказочный платформер о лесном духе, который возвращает краски миру.', 0, 120, 90, 0],
  ['Drone Racers', 'Гонки', 'дроны,скорость,мультиплеер,киберпанк', 'Скоростные гонки на дронах сквозь заброшенные промзоны.', 4, 270, 210, 1],
];

const REVIEW_TEXTS = {
  5: ['Отличная игра! Всем рекомендую.', 'Затянуло на всю ночь, шедевр.', 'Лучшее, во что я играл в этом году.', 'Атмосфера и музыка — на высоте!'],
  4: ['Очень достойно, есть мелкие баги, но в целом супер.', 'Понравилось, жду обновлений.', 'Хорошая игра, но хотелось бы больше контента.'],
  3: ['Неплохо, но на один раз.', 'Идея классная, реализация пока сыровата.'],
  2: ['Слишком сложно и мало объяснений.', 'Ожидал большего.'],
};

tx(() => {
  const ids = USERS.map(([username, name, bio], i) => {
    const info = run(
      'INSERT INTO users(username, email, password_hash, display_name, bio, role, created_at, last_seen) VALUES(?,?,?,?,?,?,?,?)',
      username, `${username}@demo.local`, hashPassword(DEMO_PASSWORD), name, bio, i === 3 ? 'moderator' : 'user',
      now - (200 - i * 30) * DAY, now - Math.round(rnd() * 3) * 3600e3,
    );
    return Number(info.lastInsertRowid);
  });

  const gameIds = GAMES.map(([title, genre, tags, short, devIdx, h1, h2, variant], i) => {
    const published = now - (90 - i * 7) * DAY;
    const file = `${crypto.randomBytes(12).toString('hex')}.txt`;
    const content = `${title}\n\nЭто демо-файл игры из HYTEAM. Здесь будет ваш архив с игрой.\n`;
    fs.writeFileSync(path.join(GAMES_DIR, file), content);
    const desc = `${short}\n\nОсобенности:\n• Уникальный визуальный стиль\n• ${pick(['10+ часов контента', 'Бесконечная реиграбельность', 'Кооператив до 4 игроков', 'Нелинейный сюжет'])}\n• ${pick(['Оригинальный саундтрек', 'Поддержка геймпада', 'Русская озвучка', 'Регулярные обновления'])}\n\nУправление: WASD — движение, мышь — камера, Esc — меню.`;
    const info = run(
      `INSERT INTO games(title, short_desc, description, genre, tags, developer_id, cover, version, platform, requirements,
        file_path, file_name, file_size, status, featured, downloads, created_at, updated_at, published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      title, short, desc, genre, tags, ids[devIdx], saveSvg(svgArt(title, h1, h2, variant)),
      `1.${Math.floor(rnd() * 9)}.${Math.floor(rnd() * 20)}`, 'Windows',
      'ОС: Windows 10 64-bit\nПроцессор: Intel Core i3 / AMD Ryzen 3\nПамять: 4 ГБ ОЗУ\nВидеокарта: GTX 750 Ti\nМесто на диске: 2 ГБ',
      file, `${title.replace(/\s+/g, '_')}_demo.txt`, 150 * 1024 * 1024 + Math.round(rnd() * 900 * 1024 * 1024),
      'approved', [0, 4, 7].includes(i) ? 1 : 0, Math.round(rnd() * 400), published - DAY, published, published,
    );
    const gid = Number(info.lastInsertRowid);
    for (let s = 0; s < 3; s++) {
      run('INSERT INTO screenshots(game_id, path, sort) VALUES(?,?,?)', gid, saveSvg(svgArt(title, h1 + s * 15, h2 - s * 20, variant + s + 1, false)), s);
    }
    run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', ids[devIdx], gid, published);
    return gid;
  });

  // Библиотеки и отзывы
  ids.forEach((uid, ui) => {
    gameIds.forEach((gid, gi) => {
      if (GAMES[gi][4] === ui || rnd() > 0.55) return;
      const added = now - Math.round(rnd() * 60) * DAY;
      run('INSERT OR IGNORE INTO library(user_id, game_id, added_at, last_download_at) VALUES(?,?,?,?)', uid, gid, added, added + DAY);
      if (rnd() > 0.35) {
        const rating = pick([5, 5, 4, 4, 4, 3, 2]);
        run(
          'INSERT OR IGNORE INTO reviews(game_id, user_id, rating, body, created_at, updated_at) VALUES(?,?,?,?,?,?)',
          gid, uid, rating, pick(REVIEW_TEXTS[rating]), added + 2 * DAY, added + 2 * DAY,
        );
      }
    });
  });

  // Друзья
  const fr = (a, b, status = 'accepted') => run('INSERT INTO friends(requester_id, addressee_id, status, created_at) VALUES(?,?,?,?)', ids[a], ids[b], status, now - 20 * DAY);
  fr(0, 1);
  fr(0, 2);
  fr(3, 4);
  fr(1, 3);
  fr(4, 0, 'pending');

  // Посты
  const posts = [
    [0, 0, 'Обновление 1.2 для Neon Drift', 'Добавили три новые трассы, ночной режим и фоторежим. Спасибо всем за отзывы!'],
    [1, 4, 'Кто дошёл до третьей ночи?', 'Last Signal пугает до мурашек. Делитесь, на каком моменте вы выключили свет 😅'],
    [3, null, 'Ищу компанию для кооператива', 'Хочу пройти Sky Islands вчетвером. Пишите в друзья!'],
    [2, 3, 'Дневник разработки: экономика станций', 'Рассказываем, как устроены торговые маршруты и почему мы переписали систему ресурсов с нуля.'],
    [4, 7, 'Турнир по Mecha Arena в субботу', 'Собираем команды 3 на 3. Победители получат значок в профиле (шутка, но было бы круто).'],
  ];
  posts.forEach(([u, g, title, body], i) => {
    const info = run(
      'INSERT INTO posts(user_id, game_id, title, body, created_at) VALUES(?,?,?,?,?)',
      ids[u], g == null ? null : gameIds[g], title, body, now - (10 - i * 2) * DAY,
    );
    const pid = Number(info.lastInsertRowid);
    ids.forEach((uid) => rnd() > 0.5 && run('INSERT OR IGNORE INTO post_likes(post_id, user_id) VALUES(?,?)', pid, uid));
    run('INSERT INTO comments(post_id, user_id, body, created_at) VALUES(?,?,?,?)', pid, ids[(u + 1) % ids.length], pick(['Круто!', 'Жду с нетерпением', 'Я в деле!', 'Спасибо за новости 🔥']), now - (9 - i * 2) * DAY);
  });
});

console.log(`Готово! Добавлено ${USERS.length} демо-пользователей и ${GAMES.length} игр.`);
console.log(`Войти можно, например, как pixelfox / ${DEMO_PASSWORD}`);
