// Каталог полезных программ для Windows: администратор добавляет их в магазин одной кнопкой.
// Источники только официальные:
//   github  — релизы проекта на GitHub (версии и обновления подтягиваются сами);
//   url     — прямая ссылка производителя «на последнюю версию»;
//   resolve — ссылка с номером версии, которую находим на сайте производителя в момент добавления.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR } from './config.js';
import { one, run, tx } from './db.js';
import { fail } from './util.js';
import { fetchReleases, syncGame, fetchGithubCover, getGameRow } from './github.js';
import { syncMainFromGame } from './versions.js';
import { makeCover } from './covers.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const byVersion = (a, b) => {
  const pa = a.split(/[._-]/).map(Number);
  const pb = b.split(/[._-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};
const newest = (list) => [...new Set(list)].sort(byVersion).pop();
const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

// Найти последнюю версию в каталоге файлов сайта производителя.
async function fromIndex(index, re, build) {
  const v = newest(all(await fetchText(index), re));
  if (!v) throw new Error('Не нашёл файл на сайте производителя');
  return { url: build(v), version: v };
}

export const GROUPS = [
  'Веб-браузеры', 'Коммуникации и мессенджеры', 'Медиаплееры и кодеки', 'Графика, видео и 3D', 'Офис и продуктивность', 'Системные утилиты и оптимизация', 'Мониторинг и диагностика железа', 'Бенчмарки и стресс-тесты', 'Разгон и андервольтинг', 'Runtime-библиотеки и компоненты', 'Игровые платформы', 'Инструменты разработчика', 'Администрирование и удалённый доступ', 'Сеть, VPN и безопасность',
];

export const CATALOG = [
  // ---------- Браузеры ----------
  { key: 'chrome', group: 'Веб-браузеры', title: 'Google Chrome', short_desc: 'Быстрый браузер от Google.', tags: 'браузер,google', home: 'https://www.google.com/chrome/', url: 'https://dl.google.com/chrome/install/latest/chrome_installer.exe' },
  { key: 'firefox', group: 'Веб-браузеры', title: 'Mozilla Firefox', short_desc: 'Свободный браузер с упором на приватность.', tags: 'браузер,mozilla', home: 'https://www.mozilla.org/ru/firefox/', url: 'https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=ru' },
  { key: 'yandex', group: 'Веб-браузеры', title: 'Яндекс Браузер', short_desc: 'Браузер Яндекса с Алисой и защитой Protect.', tags: 'браузер,яндекс', home: 'https://browser.yandex.ru/', url: 'https://browser.yandex.ru/download?os=win&x64=1' },
  { key: 'brave', group: 'Веб-браузеры', title: 'Brave', short_desc: 'Браузер со встроенной блокировкой рекламы и трекеров.', tags: 'браузер,приватность', home: 'https://brave.com/', url: 'https://laptop-updates.brave.com/latest/winx64' },
  { key: 'opera', group: 'Веб-браузеры', title: 'Opera', short_desc: 'Браузер со встроенным VPN и мессенджерами.', tags: 'браузер,vpn', home: 'https://www.opera.com/', url: 'https://net.geo.opera.com/opera/stable/windows' },

  // ---------- Общение ----------
  { key: 'telegram', group: 'Коммуникации и мессенджеры', title: 'Telegram Desktop', short_desc: 'Официальный клиент Telegram для компьютера.', tags: 'мессенджер,telegram', home: 'https://desktop.telegram.org/', github: 'telegramdesktop/tdesktop', asset: 'td-setup-win-x64-*.exe' },
  { key: 'discord', group: 'Коммуникации и мессенджеры', title: 'Discord', short_desc: 'Голосовой и текстовый чат для игроков и сообществ.', tags: 'чат,голос,игры', home: 'https://discord.com/', url: 'https://discord.com/api/downloads/distributions/app/installers/latest?channel=stable&platform=win&arch=x64' },
  { key: 'zoom', group: 'Коммуникации и мессенджеры', title: 'Zoom', short_desc: 'Видеозвонки и конференции.', tags: 'видеозвонки', home: 'https://zoom.us/', url: 'https://zoom.us/client/latest/ZoomInstallerFull.exe?archType=x64' },
  { key: 'viber', group: 'Коммуникации и мессенджеры', title: 'Viber', short_desc: 'Мессенджер и звонки.', tags: 'мессенджер,звонки', home: 'https://www.viber.com/ru/', url: 'https://download.cdn.viber.com/desktop/windows/ViberSetup.exe' },

  // ---------- Мультимедиа ----------
  { key: 'vlc', group: 'Медиаплееры и кодеки', title: 'VLC media player', short_desc: 'Проигрыватель, который открывает почти любое видео и аудио.', tags: 'видео,плеер,бесплатно', home: 'https://www.videolan.org/vlc/',
    resolve: () => fromIndex('https://download.videolan.org/pub/videolan/vlc/last/win64/', /vlc-(\d+\.\d+\.\d+(?:\.\d+)?)-win64\.exe"/g, (v) => `https://download.videolan.org/pub/videolan/vlc/last/win64/vlc-${v}-win64.exe`) },
  { key: 'mpchc', group: 'Медиаплееры и кодеки', title: 'MPC-HC', short_desc: 'Лёгкий классический видеоплеер для Windows.', tags: 'видео,плеер,бесплатно', github: 'clsid2/mpc-hc', asset: 'MPC-HC.*.x64.exe' },
  { key: 'klite', group: 'Медиаплееры и кодеки', title: 'K-Lite Codec Pack Standard', short_desc: 'Набор кодеков, чтобы открывались все форматы видео.', tags: 'кодеки,видео', home: 'https://codecguide.com/',
    resolve: () => fromIndex('https://codecguide.com/download_k-lite_codec_pack_standard.htm', /K-Lite_Codec_Pack_(\d+)_Standard\.exe/g, (v) => `https://files2.codecguide.com/K-Lite_Codec_Pack_${v}_Standard.exe`) },
  { key: 'spotify', group: 'Медиаплееры и кодеки', title: 'Spotify', short_desc: 'Музыка и подкасты.', tags: 'музыка', home: 'https://www.spotify.com/', url: 'https://download.scdn.co/SpotifySetup.exe' },
  { key: 'audacity', group: 'Медиаплееры и кодеки', title: 'Audacity', short_desc: 'Бесплатный редактор звука.', tags: 'аудио,редактор,бесплатно', home: 'https://www.audacityteam.org/', github: 'audacity/audacity', asset: 'audacity-win-*-x86_64.msi' },

  // ---------- Графика и видео ----------
  { key: 'blender', group: 'Графика, видео и 3D', title: 'Blender', short_desc: 'Бесплатный 3D-редактор: моделирование, анимация, рендер, монтаж.', tags: '3d,анимация,бесплатно', home: 'https://www.blender.org/', launch: 'blender.exe',
    resolve: async () => {
      const series = newest(all(await fetchText('https://download.blender.org/release/'), /href="Blender(\d+\.\d+)\/"/g));
      return fromIndex(`https://download.blender.org/release/Blender${series}/`, /blender-(\d+\.\d+\.\d+)-windows-x64\.zip"/g,
        (v) => `https://download.blender.org/release/Blender${series}/blender-${v}-windows-x64.zip`);
    } },
  { key: 'photoshop', group: 'Графика, видео и 3D', title: 'Adobe Photoshop', short_desc: 'Официальный установщик Photoshop. Нужна подписка Adobe (есть пробный период).', tags: 'графика,фото,adobe', home: 'https://www.adobe.com/products/photoshop.html', version: 'последняя',
    url: 'https://prod-rel-ffc-ccm.oobesaas.adobe.com/adobe-ffc-external/core/v1/wam/download?sapCode=PHSP&productName=Photoshop&os=win' },
  { key: 'aftereffects', group: 'Графика, видео и 3D', title: 'Adobe After Effects', short_desc: 'Официальный установщик After Effects. Нужна подписка Adobe (есть пробный период).', tags: 'видео,эффекты,adobe', home: 'https://www.adobe.com/products/aftereffects.html', version: 'последняя',
    url: 'https://prod-rel-ffc-ccm.oobesaas.adobe.com/adobe-ffc-external/core/v1/wam/download?sapCode=AEFT&productName=After%20Effects&os=win' },
  { key: 'gimp', group: 'Графика, видео и 3D', title: 'GIMP', short_desc: 'Бесплатный редактор изображений — альтернатива Photoshop.', tags: 'графика,фото,бесплатно', home: 'https://www.gimp.org/',
    resolve: async () => {
      const series = newest(all(await fetchText('https://download.gimp.org/gimp/'), /href="v(\d+\.\d+)\/"/g));
      return fromIndex(`https://download.gimp.org/gimp/v${series}/windows/`, /gimp-(\d+\.\d+\.\d+(?:-\d+)?)-setup(?:-\d+)?\.exe"/g,
        (v) => `https://download.gimp.org/gimp/v${series}/windows/gimp-${v}-setup.exe`);
    } },
  { key: 'krita', group: 'Графика, видео и 3D', title: 'Krita', short_desc: 'Бесплатная программа для цифрового рисования.', tags: 'рисование,графика,бесплатно', home: 'https://krita.org/',
    resolve: async () => {
      const v = newest(all(await fetchText('https://download.kde.org/stable/krita/'), /href="(\d+\.\d+\.\d+)\/"/g));
      return { url: `https://download.kde.org/stable/krita/${v}/krita-x64-${v}-setup.exe`, version: v };
    } },
  { key: 'paintnet', group: 'Графика, видео и 3D', title: 'Paint.NET', short_desc: 'Простой и быстрый редактор изображений.', tags: 'графика,бесплатно', home: 'https://www.getpaint.net/', github: 'paintdotnet/release', asset: 'paint.net.*.install.x64.zip' },
  { key: 'obs', group: 'Графика, видео и 3D', title: 'OBS Studio', short_desc: 'Запись экрана и стримы.', tags: 'стрим,запись экрана,бесплатно', home: 'https://obsproject.com/', github: 'obsproject/obs-studio', asset: 'OBS-Studio-*-Windows-x64-Installer.exe' },
  { key: 'handbrake', group: 'Графика, видео и 3D', title: 'HandBrake', short_desc: 'Конвертер и сжатие видео.', tags: 'видео,конвертер,бесплатно', home: 'https://handbrake.fr/', github: 'HandBrake/HandBrake', asset: 'HandBrake-*-x86_64-Win_GUI.exe' },
  { key: 'sharex', group: 'Графика, видео и 3D', title: 'ShareX', short_desc: 'Скриншоты, запись экрана и быстрая загрузка картинок.', tags: 'скриншоты,бесплатно', home: 'https://getsharex.com/', github: 'ShareX/ShareX', asset: 'ShareX-*-setup-x64.exe' },
  { key: 'lightshot', group: 'Графика, видео и 3D', title: 'Lightshot', short_desc: 'Простые скриншоты по клавише Print Screen.', tags: 'скриншоты', home: 'https://app.prntscr.com/ru/', url: 'https://app.prntscr.com/build/setup-lightshot.exe' },

  // ---------- Офис и документы ----------
  { key: 'office2024', group: 'Офис и продуктивность', icon: 'https://www.microsoft.com/favicon.ico', title: 'Microsoft Office 2024 профессиональный плюс', short_desc: 'Официальный образ Office 2024 с сервера Microsoft. Активация — вашим ключом.', tags: 'офис,word,excel,microsoft', version: '2024',
    description: 'Официальный образ Office LTSC 2024 профессиональный плюс (русский) с CDN Microsoft: Word, Excel, PowerPoint, Outlook, Access.\n\nПосле загрузки нажмите «Открыть образ» — Windows подключит его как диск, затем запустите Setup.exe.\n\nДля активации нужна ваша лицензия (ключ продукта Office 2024).',
    url: 'https://officecdn.microsoft.com/db/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/ru-RU/ProPlus2024Retail.img' },
  { key: 'libreoffice', group: 'Офис и продуктивность', title: 'LibreOffice', short_desc: 'Бесплатный офисный пакет: тексты, таблицы, презентации.', tags: 'офис,бесплатно', home: 'https://ru.libreoffice.org/',
    resolve: async () => {
      const v = newest(all(await fetchText('https://download.documentfoundation.org/libreoffice/stable/'), /href="(\d+\.\d+\.\d+)\/"/g));
      return { url: `https://download.documentfoundation.org/libreoffice/stable/${v}/win/x86_64/LibreOffice_${v}_Win_x86-64.msi`, version: v };
    } },
  { key: 'onlyoffice', group: 'Офис и продуктивность', title: 'ONLYOFFICE', short_desc: 'Бесплатный офис, хорошо совместимый с форматами Microsoft.', tags: 'офис,бесплатно', home: 'https://www.onlyoffice.com/ru/', github: 'ONLYOFFICE/DesktopEditors', asset: 'DesktopEditors_x64.exe' },
  { key: 'notepadpp', group: 'Офис и продуктивность', title: 'Notepad++', short_desc: 'Удобный текстовый редактор с подсветкой кода.', tags: 'редактор,текст,бесплатно', home: 'https://notepad-plus-plus.org/', github: 'notepad-plus-plus/notepad-plus-plus', asset: 'npp.*.Installer.x64.exe' },
  { key: 'sumatra', group: 'Офис и продуктивность', title: 'SumatraPDF', short_desc: 'Лёгкая читалка PDF, DjVu, EPUB и комиксов.', tags: 'pdf,читалка,бесплатно', home: 'https://www.sumatrapdfreader.org/',
    resolve: () => fromIndex('https://www.sumatrapdfreader.org/download-free-pdf-viewer', /SumatraPDF-(\d+\.\d+(?:\.\d+)?)-64-install\.exe/g,
      (v) => `https://www.sumatrapdfreader.org/dl/rel/${v}/SumatraPDF-${v}-64-install.exe`) },
  { key: 'obsidian', group: 'Офис и продуктивность', title: 'Obsidian', short_desc: 'Заметки и база знаний в markdown.', tags: 'заметки', home: 'https://obsidian.md/', github: 'obsidianmd/obsidian-releases', asset: 'Obsidian-*.exe' },

  // ---------- Утилиты ----------
  { key: '7zip', group: 'Системные утилиты и оптимизация', title: '7-Zip', short_desc: 'Бесплатный архиватор: 7z, zip, rar и другие.', tags: 'архиватор,бесплатно', home: 'https://www.7-zip.org/', github: 'ip7z/7zip', asset: '7z*-x64.exe' },
  { key: 'winrar', group: 'Системные утилиты и оптимизация', title: 'WinRAR', short_desc: 'Популярный архиватор (пробная версия, русский язык).', tags: 'архиватор', home: 'https://www.rarlab.com/',
    resolve: () => fromIndex('https://www.rarlab.com/download.htm', /winrar-x64-(\d+)ru\.exe/g, (v) => `https://www.rarlab.com/rar/winrar-x64-${v}ru.exe`) },
  { key: 'everything', group: 'Системные утилиты и оптимизация', title: 'Everything', short_desc: 'Мгновенный поиск файлов на компьютере.', tags: 'поиск,бесплатно', home: 'https://www.voidtools.com/ru-ru/',
    resolve: () => fromIndex('https://www.voidtools.com/downloads/', /Everything-(\d+\.\d+\.\d+\.\d+)\.x64-Setup\.exe/g, (v) => `https://www.voidtools.com/Everything-${v}.x64-Setup.exe`) },
  { key: 'powertoys', group: 'Системные утилиты и оптимизация', title: 'Microsoft PowerToys', short_desc: 'Полезные инструменты Windows от Microsoft.', tags: 'windows,microsoft,бесплатно', home: 'https://learn.microsoft.com/windows/powertoys/', github: 'microsoft/PowerToys', asset: 'PowerToysUserSetup-*-x64.exe' },
  { key: 'revo', group: 'Системные утилиты и оптимизация', title: 'Revo Uninstaller', short_desc: 'Полное удаление программ вместе с хвостами.', tags: 'удаление программ', home: 'https://www.revouninstaller.com/', url: 'https://download.revouninstaller.com/download/revosetup.exe' },
  { key: 'rufus', group: 'Системные утилиты и оптимизация', title: 'Rufus', short_desc: 'Загрузочная флешка с Windows за пару минут.', tags: 'флешка,windows,бесплатно', home: 'https://rufus.ie/ru/', github: 'pbatard/rufus', asset: 'rufus-*.exe' },
  { key: 'ventoy', group: 'Системные утилиты и оптимизация', title: 'Ventoy', short_desc: 'Мультизагрузочная флешка: просто скопируйте ISO-образы.', tags: 'флешка,iso,бесплатно', home: 'https://www.ventoy.net/', github: 'ventoy/Ventoy', asset: 'ventoy-*-windows.zip' },
  { key: 'cpuz', group: 'Мониторинг и диагностика железа', title: 'CPU-Z', short_desc: 'Подробные сведения о процессоре, памяти и плате.', tags: 'железо,диагностика,бесплатно', home: 'https://www.cpuid.com/softwares/cpu-z.html',
    resolve: () => fromIndex('https://www.cpuid.com/softwares/cpu-z.html', /cpu-z_(\d+\.\d+)-en\.exe/g, (v) => `https://download.cpuid.com/cpu-z/cpu-z_${v}-en.exe`) },

  { key: 'wiztree', group: 'Системные утилиты и оптимизация', title: 'WizTree', short_desc: 'Мгновенно показывает, чем занят диск.', tags: 'диски,место,бесплатно', home: 'https://diskanalyzer.com/',
    resolve: async () => {
      const r = await fromIndex('https://diskanalyzer.com/download', /wiztree_(\d+_\d+)_setup\.exe/g, (v) => `https://diskanalyzer.com/files/wiztree_${v}_setup.exe`);
      return { ...r, version: r.version.replace('_', '.') };
    } },
  { key: 'windirstat', group: 'Системные утилиты и оптимизация', title: 'WinDirStat', short_desc: 'Наглядная карта занятого места на диске.', tags: 'диски,место,бесплатно', home: 'https://windirstat.net/', github: 'windirstat/windirstat', asset: 'WinDirStat-x64.msi' },
  { key: 'bcu', group: 'Системные утилиты и оптимизация', title: 'Bulk Crap Uninstaller', short_desc: 'Удаляет много программ сразу и чистит остатки.', tags: 'удаление программ,бесплатно', home: 'https://www.bcuninstaller.com/', github: 'Klocman/Bulk-Crap-Uninstaller', asset: 'BCUninstaller_*_setup.exe' },
  { key: 'ccleaner', group: 'Системные утилиты и оптимизация', title: 'CCleaner', short_desc: 'Очистка мусора и временных файлов.', tags: 'очистка', home: 'https://www.ccleaner.com/ru-ru', url: 'https://bits.avcdn.net/productfamily_CCLEANER/insttype_FREE/platform_WIN_PIR/installertype_ONLINE/build_RELEASE' },
  { key: 'procexp', group: 'Системные утилиты и оптимизация', title: 'Process Explorer', short_desc: 'Продвинутый диспетчер задач от Microsoft Sysinternals.', tags: 'процессы,microsoft,бесплатно', home: 'https://learn.microsoft.com/sysinternals/', url: 'https://download.sysinternals.com/files/ProcessExplorer.zip', launch: 'procexp64.exe' },
  { key: 'autoruns', group: 'Системные утилиты и оптимизация', title: 'Autoruns', short_desc: 'Всё, что запускается вместе с Windows, — и как это отключить.', tags: 'автозагрузка,microsoft,бесплатно', home: 'https://learn.microsoft.com/sysinternals/', url: 'https://download.sysinternals.com/files/Autoruns.zip', launch: 'Autoruns64.exe' },
  { key: 'memreduct', group: 'Системные утилиты и оптимизация', title: 'Mem Reduct', short_desc: 'Освобождает оперативную память одной кнопкой.', tags: 'память,бесплатно', home: 'https://www.henrypp.org/product/memreduct', github: 'henrypp/memreduct', asset: 'memreduct-*-setup.exe' },
  { key: 'ditto', group: 'Системные утилиты и оптимизация', title: 'Ditto', short_desc: 'История буфера обмена: всё, что вы копировали.', tags: 'буфер обмена,бесплатно', home: 'https://ditto-cp.sourceforge.io/', github: 'sabrogden/Ditto', asset: 'DittoSetup_64bit_*.exe' },
  { key: 'flowlauncher', group: 'Системные утилиты и оптимизация', title: 'Flow Launcher', short_desc: 'Быстрый запуск программ и поиск по Alt+Пробел.', tags: 'поиск,запуск,бесплатно', home: 'https://www.flowlauncher.com/', github: 'Flow-Launcher/Flow.Launcher', asset: 'Flow-Launcher-Setup.exe' },
  { key: 'potplayer', group: 'Медиаплееры и кодеки', title: 'PotPlayer', short_desc: 'Мощный видеоплеер со встроенными кодеками.', tags: 'видео,плеер,бесплатно', home: 'https://potplayer.daum.net/', url: 'https://t1.daumcdn.net/potplayer/PotPlayer/Version/Latest/PotPlayerSetup64.exe' },
  { key: 'xnview', group: 'Графика, видео и 3D', title: 'XnView MP', short_desc: 'Просмотр и пакетная обработка фотографий.', tags: 'фото,просмотр,бесплатно', home: 'https://www.xnview.com/ru/xnviewmp/', url: 'https://download.xnview.com/XnViewMP-win-x64.exe' },
  { key: 'shotcut', group: 'Графика, видео и 3D', title: 'Shotcut', short_desc: 'Бесплатный видеоредактор для монтажа роликов.', tags: 'видео,монтаж,бесплатно', home: 'https://shotcut.org/', github: 'mltframework/shotcut', asset: 'shotcut-win64-*.exe' },
  { key: 'thunderbird', group: 'Коммуникации и мессенджеры', title: 'Thunderbird', short_desc: 'Почтовый клиент от Mozilla.', tags: 'почта,mozilla,бесплатно', home: 'https://www.thunderbird.net/ru/', url: 'https://download.mozilla.org/?product=thunderbird-latest-SSL&os=win64&lang=ru' },
  { key: 'gdrive', group: 'Офис и продуктивность', title: 'Google Диск', short_desc: 'Синхронизация файлов с Google Диском.', tags: 'облако,google', home: 'https://www.google.com/drive/', url: 'https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe' },
  { key: 'dropbox', group: 'Офис и продуктивность', title: 'Dropbox', short_desc: 'Облачное хранилище и синхронизация файлов.', tags: 'облако', home: 'https://www.dropbox.com/', url: 'https://www.dropbox.com/download?plat=win&type=full' },

  // ---------- Диагностика и разгон ----------
  { key: 'hwmonitor', group: 'Мониторинг и диагностика железа', title: 'HWMonitor', short_desc: 'Температуры, напряжения и обороты вентиляторов.', tags: 'температура,диагностика,бесплатно', home: 'https://www.cpuid.com/softwares/hwmonitor.html',
    resolve: () => fromIndex('https://www.cpuid.com/softwares/hwmonitor.html', /hwmonitor_(\d+\.\d+(?:\.\d+)?)\.exe/g, (v) => `https://download.cpuid.com/hwmonitor/hwmonitor_${v}.exe`) },
  { key: 'aida64', group: 'Мониторинг и диагностика железа', title: 'AIDA64 Extreme', short_desc: 'Полная информация о железе, тесты и стресс-тест (пробный период).', tags: 'диагностика,тесты,железо', home: 'https://www.aida64.com/',
    resolve: () => fromIndex('https://www.aida64.com/downloads/latesta64xe', /aida64extreme(\d+)\.exe/g, (v) => `https://download2.aida64.com/aida64extreme${v}.exe`) },
  { key: 'occt', group: 'Бенчмарки и стресс-тесты', title: 'OCCT', short_desc: 'Стресс-тест процессора, видеокарты, памяти и блока питания — проверка стабильности разгона.', tags: 'стресс-тест,разгон,стабильность', home: 'https://www.ocbase.com/', url: 'https://www.ocbase.com/download/edition:Personal/os:Windows' },
  { key: 'prime95', group: 'Бенчмарки и стресс-тесты', title: 'Prime95', short_desc: 'Классический стресс-тест процессора и памяти.', tags: 'стресс-тест,процессор,разгон', home: 'https://www.mersenne.org/', launch: 'prime95.exe',
    resolve: async () => {
      const name = newest(all(await fetchText('https://www.mersenne.org/download/'), /(p95v\d+b\d+)\.win64\.zip/g));
      const m = name.match(/^p95v(\d\d)(\d+)b/);
      return { url: `https://www.mersenne.org/download/software/v${m[1]}/${m[1]}.${m[2]}/${name}.win64.zip`, version: `${m[1]}.${m[2]}` };
    } },
  { key: 'memtest86', group: 'Мониторинг и диагностика железа', title: 'MemTest86', short_desc: 'Проверка оперативной памяти на ошибки с загрузочной флешки.', tags: 'память,тест,бесплатно', home: 'https://www.memtest86.com/', version: 'последняя', url: 'https://www.memtest86.com/downloads/memtest86-usb.zip' },
  { key: 'victoria', group: 'Мониторинг и диагностика железа', title: 'Victoria', short_desc: 'Проверка жёстких дисков и SSD на битые сектора.', tags: 'диски,проверка,бесплатно', home: 'https://hdd.by/victoria/',
    resolve: async () => {
      const v = newest(all(await fetchText('https://hdd.by/victoria/'), /Victoria(\d{3})\.zip/gi));
      return { url: `https://hdd.by/Victoria/Victoria${v}.zip`, version: `${v[0]}.${v.slice(1)}` };
    } },
  { key: 'ryzenmaster', group: 'Разгон и андервольтинг', title: 'AMD Ryzen Master', short_desc: 'Официальный разгон и андервольт процессоров AMD Ryzen.', tags: 'разгон,андервольт,amd', home: 'https://www.amd.com/', version: 'последняя', url: 'https://download.amd.com/Desktop/amd-ryzen-master.exe' },
  { key: 'lhm', group: 'Мониторинг и диагностика железа', title: 'Libre Hardware Monitor', short_desc: 'Датчики температуры и нагрузки с открытым кодом.', tags: 'температура,диагностика,бесплатно', github: 'LibreHardwareMonitor/LibreHardwareMonitor', launch: 'LibreHardwareMonitor.exe' },
  { key: 'fancontrol', group: 'Разгон и андервольтинг', title: 'FanControl', short_desc: 'Тонкая настройка кривых вентиляторов.', tags: 'вентиляторы,охлаждение,бесплатно', home: 'https://getfancontrol.com/', github: 'Rem0o/FanControl.Releases', launch: 'FanControl.exe' },

  // ---------- Системные компоненты ----------
  { key: 'vcredist64', group: 'Runtime-библиотеки и компоненты', icon: 'https://www.microsoft.com/favicon.ico', title: 'Microsoft Visual C++ Redistributable (x64)', short_desc: 'Библиотеки, без которых не запускаются многие игры и программы.', tags: 'microsoft,библиотеки,игры', version: 'последняя', url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe' },
  { key: 'vcredist86', group: 'Runtime-библиотеки и компоненты', icon: 'https://www.microsoft.com/favicon.ico', title: 'Microsoft Visual C++ Redistributable (x86)', short_desc: '32-битные библиотеки Visual C++ — нужны старым играм.', tags: 'microsoft,библиотеки,игры', version: 'последняя', url: 'https://aka.ms/vs/17/release/vc_redist.x86.exe' },
  { key: 'directx', group: 'Runtime-библиотеки и компоненты', icon: 'https://www.microsoft.com/favicon.ico', title: 'DirectX (веб-установщик)', short_desc: 'Компоненты DirectX 9–11 для старых игр.', tags: 'microsoft,directx,игры', version: 'June 2010', url: 'https://download.microsoft.com/download/1/7/1/1718CCC4-6315-4D8E-9543-8E28A4E18C4C/dxwebsetup.exe' },
  { key: 'dotnet8', group: 'Runtime-библиотеки и компоненты', icon: 'https://www.microsoft.com/favicon.ico', title: '.NET Desktop Runtime 8', short_desc: 'Среда .NET 8 для программ на C#.', tags: 'microsoft,.net', version: '8', url: 'https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe' },
  { key: 'dotnet10', group: 'Runtime-библиотеки и компоненты', icon: 'https://www.microsoft.com/favicon.ico', title: '.NET Desktop Runtime 10', short_desc: 'Среда .NET 10 для новых программ на C#.', tags: 'microsoft,.net', version: '10', url: 'https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe' },
  { key: 'java', group: 'Runtime-библиотеки и компоненты', title: 'Java 21 (Eclipse Temurin)', short_desc: 'Java для Minecraft и других Java-программ.', tags: 'java,minecraft', home: 'https://adoptium.net/', github: 'adoptium/temurin21-binaries', asset: 'OpenJDK21U-jre_x64_windows_hotspot_*.msi' },

  // ---------- Игровые лаунчеры ----------
  { key: 'steam', group: 'Игровые платформы', title: 'Steam', short_desc: 'Крупнейший магазин игр для ПК.', tags: 'игры,магазин', home: 'https://store.steampowered.com/about/', url: 'https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe' },
  { key: 'epic', group: 'Игровые платформы', icon: 'https://github.com/EpicGames.png?size=256', title: 'Epic Games Launcher', short_desc: 'Магазин Epic Games с бесплатными играми каждую неделю.', tags: 'игры,магазин', home: 'https://store.epicgames.com/', url: 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi' },
  { key: 'battlenet', group: 'Игровые платформы', title: 'Battle.net', short_desc: 'Лаунчер игр Blizzard.', tags: 'игры,blizzard', home: 'https://battle.net/', url: 'https://www.battle.net/download/getInstallerForGame?os=win&gameProgram=BATTLENET_APP&version=Live' },
  { key: 'eaapp', group: 'Игровые платформы', title: 'EA app', short_desc: 'Лаунчер игр Electronic Arts.', tags: 'игры,ea', home: 'https://www.ea.com/ea-app', url: 'https://origin-a.akamaihd.net/EA-Desktop-Client-Download/installer-releases/EAappInstaller.exe' },
  { key: 'ubisoft', group: 'Игровые платформы', title: 'Ubisoft Connect', short_desc: 'Лаунчер игр Ubisoft.', tags: 'игры,ubisoft', home: 'https://www.ubisoft.com/ubisoft-connect', url: 'https://static3.cdn.ubi.com/orbit/launcher_installer/UbisoftConnectInstaller.exe' },
  { key: 'gog', group: 'Игровые платформы', title: 'GOG Galaxy', short_desc: 'Лаунчер GOG — игры без DRM.', tags: 'игры,gog', home: 'https://www.gog.com/galaxy', url: 'https://webinstallers.gog-statics.com/download/GOG_Galaxy_2.0.exe' },

  // ---------- Разработка ----------
  { key: 'vscode', group: 'Инструменты разработчика', title: 'Visual Studio Code', short_desc: 'Редактор кода от Microsoft.', tags: 'код,редактор,бесплатно', home: 'https://code.visualstudio.com/', url: 'https://update.code.visualstudio.com/latest/win32-x64-user/stable' },
  { key: 'git', group: 'Инструменты разработчика', title: 'Git для Windows', short_desc: 'Система контроля версий Git с Git Bash.', tags: 'git,код,бесплатно', home: 'https://gitforwindows.org/', github: 'git-for-windows/git', asset: 'Git-*-64-bit.exe' },
  { key: 'python', group: 'Инструменты разработчика', title: 'Python', short_desc: 'Язык программирования Python 3.', tags: 'python,код,бесплатно', home: 'https://www.python.org/',
    resolve: async () => {
      const text = await fetchText('https://www.python.org/downloads/windows/');
      const v = (text.match(/Latest Python 3 Release - Python (\d+\.\d+\.\d+)/) || [])[1];
      if (!v) throw new Error('Не нашёл версию Python');
      return { url: `https://www.python.org/ftp/python/${v}/python-${v}-amd64.exe`, version: v };
    } },
  { key: 'nodejs', group: 'Инструменты разработчика', title: 'Node.js LTS', short_desc: 'JavaScript вне браузера — долгосрочная версия.', tags: 'javascript,код,бесплатно', home: 'https://nodejs.org/ru',
    resolve: async () => {
      const lts = JSON.parse(await fetchText('https://nodejs.org/dist/index.json')).find((x) => x.lts);
      return { url: `https://nodejs.org/dist/${lts.version}/node-${lts.version}-x64.msi`, version: lts.version.replace(/^v/, '') };
    } },
  { key: 'claude', group: 'Инструменты разработчика', title: 'Claude', short_desc: 'Приложение ИИ-ассистента Claude от Anthropic.', tags: 'ии,ассистент', version: 'последняя', url: '',
    hint: 'Прямая ссылка на установщик с claude.ai/download (из России сайт может не отдавать файл)' },

  { key: 'docker', group: 'Инструменты разработчика', title: 'Docker Desktop', short_desc: 'Контейнеры Docker на Windows: сборка и запуск сервисов.', tags: 'docker,контейнеры,devops', home: 'https://www.docker.com/products/docker-desktop/', version: 'последняя', url: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' },
  { key: 'postman', group: 'Инструменты разработчика', title: 'Postman', short_desc: 'Тестирование и документация API.', tags: 'api,http,тестирование', home: 'https://www.postman.com/', version: 'последняя', url: 'https://dl.pstmn.io/download/latest/win64' },
  { key: 'bruno', group: 'Инструменты разработчика', title: 'Bruno', short_desc: 'Лёгкий клиент для API с открытым кодом — коллекции хранятся в git.', tags: 'api,http,бесплатно', home: 'https://www.usebruno.com/', github: 'usebruno/bruno', asset: 'bruno_*_x64_win.exe' },
  { key: 'githubdesktop', group: 'Инструменты разработчика', title: 'GitHub Desktop', short_desc: 'Git и GitHub в удобном окне — без командной строки.', tags: 'git,github,бесплатно', home: 'https://desktop.github.com/', version: 'последняя', url: 'https://central.github.com/deployments/desktop/desktop/latest/win32' },
  { key: 'jetbrains', group: 'Инструменты разработчика', title: 'JetBrains Toolbox', short_desc: 'Установка и обновление IntelliJ IDEA, PyCharm, WebStorm, Rider и других IDE.', tags: 'ide,jetbrains,код', home: 'https://www.jetbrains.com/toolbox-app/',
    resolve: async () => {
      const r = JSON.parse(await fetchText('https://data.services.jetbrains.com/products/releases?code=TBA&latest=true&type=release')).TBA[0];
      return { url: r.downloads.windows.link, version: r.version };
    } },
  { key: 'vscommunity', group: 'Инструменты разработчика', title: 'Visual Studio Community', short_desc: 'Полноценная IDE от Microsoft для C#, C++ и .NET (бесплатная редакция).', tags: 'ide,c#,c++,microsoft', home: 'https://visualstudio.microsoft.com/ru/vs/community/', version: 'последняя', url: 'https://aka.ms/vs/17/release/vs_community.exe' },
  { key: 'sublime', group: 'Инструменты разработчика', title: 'Sublime Text', short_desc: 'Быстрый текстовый редактор для кода.', tags: 'редактор,код', home: 'https://www.sublimetext.com/',
    resolve: () => fromIndex('https://www.sublimetext.com/download_thanks?target=win-x64', /sublime_text_build_(\d+)_x64_setup\.exe/g, (v) => `https://download.sublimetext.com/sublime_text_build_${v}_x64_setup.exe`) },
  { key: 'neovim', group: 'Инструменты разработчика', title: 'Neovim', short_desc: 'Современный Vim: редактор для работы с клавиатуры.', tags: 'vim,редактор,бесплатно', home: 'https://neovim.io/', github: 'neovim/neovim', asset: 'nvim-win64.msi' },
  { key: 'winmerge', group: 'Инструменты разработчика', title: 'WinMerge', short_desc: 'Сравнение и слияние файлов и папок.', tags: 'diff,сравнение,бесплатно', home: 'https://winmerge.org/', github: 'WinMerge/winmerge', asset: 'WinMerge-*-x64-Setup.exe' },
  { key: 'dbeaver', group: 'Инструменты разработчика', title: 'DBeaver Community', short_desc: 'Универсальный клиент баз данных: PostgreSQL, MySQL, SQLite и др.', tags: 'sql,базы данных,бесплатно', home: 'https://dbeaver.io/', github: 'dbeaver/dbeaver', asset: 'dbeaver-ce-*-windows-x86_64.exe' },
  { key: 'heidisql', group: 'Инструменты разработчика', title: 'HeidiSQL', short_desc: 'Лёгкий клиент для MySQL, MariaDB, PostgreSQL и SQL Server.', tags: 'sql,mysql,бесплатно', home: 'https://www.heidisql.com/',
    resolve: () => fromIndex('https://www.heidisql.com/download.php', /HeidiSQL_(\d+\.\d+\.\d+\.\d+)_Setup\.exe/g, (v) => `https://www.heidisql.com/installers/HeidiSQL_${v}_Setup.exe`) },
  { key: 'pwsh', group: 'Инструменты разработчика', title: 'PowerShell 7', short_desc: 'Новая кроссплатформенная оболочка PowerShell.', tags: 'powershell,консоль,microsoft', home: 'https://learn.microsoft.com/powershell/', github: 'PowerShell/PowerShell', asset: 'PowerShell-*-win-x64.msi' },
  { key: 'cmake', group: 'Инструменты разработчика', title: 'CMake', short_desc: 'Система сборки проектов на C и C++.', tags: 'c++,сборка,бесплатно', home: 'https://cmake.org/', github: 'Kitware/CMake', asset: 'cmake-*-windows-x86_64.msi' },
  { key: 'golang', group: 'Инструменты разработчика', title: 'Go', short_desc: 'Язык программирования Go от Google.', tags: 'go,код,бесплатно', home: 'https://go.dev/',
    resolve: async () => {
      const rel = JSON.parse(await fetchText('https://go.dev/dl/?mode=json'))[0];
      const f = rel.files.find((x) => x.os === 'windows' && x.arch === 'amd64' && x.kind === 'installer');
      return { url: `https://go.dev/dl/${f.filename}`, version: rel.version.replace(/^go/, '') };
    } },
  { key: 'rustup', group: 'Инструменты разработчика', title: 'Rust (rustup)', short_desc: 'Установщик языка Rust и его инструментов.', tags: 'rust,код,бесплатно', home: 'https://www.rust-lang.org/ru', version: 'последняя', url: 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' },
  { key: 'jdk', group: 'Инструменты разработчика', title: 'Java JDK 21 (Eclipse Temurin)', short_desc: 'Комплект разработчика Java LTS.', tags: 'java,jdk,бесплатно', home: 'https://adoptium.net/', github: 'adoptium/temurin21-binaries', asset: 'OpenJDK21U-jdk_x64_windows_hotspot_*.msi' },
  { key: 'arduino', group: 'Инструменты разработчика', title: 'Arduino IDE', short_desc: 'Программирование плат Arduino и ESP.', tags: 'arduino,микроконтроллеры,бесплатно', home: 'https://www.arduino.cc/', github: 'arduino/arduino-ide', asset: 'arduino-ide_*_Windows_64bit.exe' },
  { key: 'godot', group: 'Инструменты разработчика', title: 'Godot Engine', short_desc: 'Бесплатный движок для 2D и 3D игр.', tags: 'игровой движок,gamedev,бесплатно', home: 'https://godotengine.org/',
    // В релизах GitHub вперемешку ветки 3.x и 4.x — берём самую новую версию, а не самый свежий релиз.
    resolve: async () => {
      const rels = JSON.parse(await fetchText('https://api.github.com/repos/godotengine/godot/releases?per_page=20'));
      const v = newest(rels.map((r) => r.tag_name).filter((t) => /^\d+(\.\d+)*-stable$/.test(t)).map((t) => t.replace('-stable', '')));
      return { url: `https://github.com/godotengine/godot/releases/download/${v}-stable/Godot_v${v}-stable_win64.exe.zip`, version: v };
    } },
  { key: 'unityhub', group: 'Инструменты разработчика', title: 'Unity Hub', short_desc: 'Установка редакторов Unity и управление проектами.', tags: 'unity,gamedev', home: 'https://unity.com/', version: 'последняя', url: 'https://public-cdn.cloud.unity3d.com/hub/prod/UnityHubSetup-x64.exe' },
  { key: 'ollama', group: 'Инструменты разработчика', title: 'Ollama', short_desc: 'Запуск языковых моделей (Llama, Qwen, Gemma) на своём компьютере.', tags: 'ии,llm,бесплатно', home: 'https://ollama.com/', version: 'последняя', url: 'https://ollama.com/download/OllamaSetup.exe' },

  // ---------- Администрирование ----------
  { key: 'putty', group: 'Администрирование и удалённый доступ', title: 'PuTTY', short_desc: 'Классический SSH- и Telnet-клиент.', tags: 'ssh,telnet,бесплатно', home: 'https://www.chiark.greenend.org.uk/~sgtatham/putty/',
    resolve: () => fromIndex('https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html', /putty-64bit-(\d+\.\d+)-installer\.msi/g, (v) => `https://the.earth.li/~sgtatham/putty/${v}/w64/putty-64bit-${v}-installer.msi`) },
  { key: 'mobaxterm', group: 'Администрирование и удалённый доступ', title: 'MobaXterm', short_desc: 'Терминал «всё в одном»: SSH, RDP, VNC, SFTP и X-сервер.', tags: 'ssh,rdp,терминал', home: 'https://mobaxterm.mobatek.net/',
    resolve: async () => {
      const m = (await fetchText('https://mobaxterm.mobatek.net/download-home-edition.html')).match(/https:\/\/download\.mobatek\.net\/[^"']+MobaXterm_Portable_v(\d+\.\d+)\.zip/);
      if (!m) throw new Error('Не нашёл архив MobaXterm');
      return { url: m[0], version: m[1] };
    } },
  { key: 'mremoteng', group: 'Администрирование и удалённый доступ', title: 'mRemoteNG', short_desc: 'Все подключения RDP, SSH, VNC и HTTP во вкладках одного окна.', tags: 'rdp,ssh,vnc,бесплатно', home: 'https://mremoteng.org/', github: 'mRemoteNG/mRemoteNG', asset: 'mRemoteNG-Installer-*.msi' },
  { key: 'rdcman', group: 'Администрирование и удалённый доступ', title: 'Remote Desktop Connection Manager', short_desc: 'Менеджер RDP-подключений от Microsoft Sysinternals.', tags: 'rdp,microsoft,бесплатно', home: 'https://learn.microsoft.com/sysinternals/downloads/rdcman', version: 'последняя', url: 'https://download.sysinternals.com/files/RDCMan.zip', launch: 'RDCMan.exe' },
  { key: 'tightvnc', group: 'Администрирование и удалённый доступ', title: 'TightVNC', short_desc: 'VNC-сервер и клиент для удалённого управления.', tags: 'vnc,удалённый доступ,бесплатно', home: 'https://www.tightvnc.com/',
    resolve: () => fromIndex('https://www.tightvnc.com/download.php', /tightvnc-(\d+\.\d+\.\d+)-gpl-setup-64bit\.msi/g, (v) => `https://www.tightvnc.com/download/${v}/tightvnc-${v}-gpl-setup-64bit.msi`) },
  { key: 'sysinternals', group: 'Администрирование и удалённый доступ', title: 'Sysinternals Suite', short_desc: 'Весь набор утилит Sysinternals: Process Monitor, PsExec, TCPView и ещё 70.', tags: 'microsoft,диагностика,бесплатно', home: 'https://learn.microsoft.com/sysinternals/', version: 'последняя', url: 'https://download.sysinternals.com/files/SysinternalsSuite.zip', launch: 'procexp64.exe' },
  { key: 'procmon', group: 'Администрирование и удалённый доступ', title: 'Process Monitor', short_desc: 'Что программы делают с файлами, реестром и сетью — в реальном времени.', tags: 'microsoft,диагностика,бесплатно', home: 'https://learn.microsoft.com/sysinternals/downloads/procmon', version: 'последняя', url: 'https://download.sysinternals.com/files/ProcessMonitor.zip', launch: 'Procmon64.exe' },
  { key: 'tcpview', group: 'Администрирование и удалённый доступ', title: 'TCPView', short_desc: 'Все сетевые соединения и порты компьютера.', tags: 'сеть,порты,microsoft', home: 'https://learn.microsoft.com/sysinternals/downloads/tcpview', version: 'последняя', url: 'https://download.sysinternals.com/files/TCPView.zip', launch: 'tcpview64.exe' },
  { key: 'bginfo', group: 'Администрирование и удалённый доступ', title: 'BGInfo', short_desc: 'Имя ПК, IP и сведения о системе прямо на обоях рабочего стола.', tags: 'microsoft,администрирование', home: 'https://learn.microsoft.com/sysinternals/downloads/bginfo', version: 'последняя', url: 'https://download.sysinternals.com/files/BGInfo.zip', launch: 'Bginfo64.exe' },
  { key: 'virtualbox', group: 'Администрирование и удалённый доступ', title: 'VirtualBox', short_desc: 'Виртуальные машины: Windows, Linux и другие системы внутри вашей.', tags: 'виртуализация,бесплатно', home: 'https://www.virtualbox.org/',
    resolve: async () => {
      const v = (await fetchText('https://download.virtualbox.org/virtualbox/LATEST-STABLE.TXT')).trim();
      const file = all(await fetchText(`https://download.virtualbox.org/virtualbox/${v}/`), /href="(VirtualBox-[\d.]+-\d+-Win\.exe)"/g)[0];
      if (!file) throw new Error('Не нашёл установщик VirtualBox');
      return { url: `https://download.virtualbox.org/virtualbox/${v}/${file}`, version: v };
    } },
  { key: 'totalcmd', group: 'Администрирование и удалённый доступ', title: 'Total Commander', short_desc: 'Двухпанельный файловый менеджер (условно-бесплатный).', tags: 'файлы,менеджер', home: 'https://www.ghisler.com/',
    resolve: async () => {
      const m = (await fetchText('https://www.ghisler.com/download.htm')).match(/https?:\/\/[^"']+\/tcmd(\d+)x64\.exe/);
      if (!m) throw new Error('Не нашёл установщик Total Commander');
      return { url: m[0], version: m[1].replace(/^(\d+)(\d)(\d)$/, '$1.$2$3') };
    } },
  { key: 'doublecmd', group: 'Администрирование и удалённый доступ', title: 'Double Commander', short_desc: 'Бесплатный двухпанельный файловый менеджер.', tags: 'файлы,менеджер,бесплатно', home: 'https://doublecmd.sourceforge.io/', github: 'doublecmd/doublecmd', asset: 'doublecmd-*.x86_64-win64.msi' },
  { key: 'shutup10', group: 'Администрирование и удалённый доступ', title: 'O&O ShutUp10++', short_desc: 'Отключение телеметрии и настройка приватности Windows.', tags: 'приватность,windows,бесплатно', home: 'https://www.oo-software.com/ru/shutup10', version: 'последняя', url: 'https://dl5.oo-software.com/files/ooshutup10/OOSU10.exe' },

  // ---------- Сеть ----------
  { key: 'wireshark', group: 'Сеть, VPN и безопасность', title: 'Wireshark', short_desc: 'Анализатор сетевого трафика.', tags: 'сеть,трафик,бесплатно', home: 'https://www.wireshark.org/', version: 'последняя', url: 'https://www.wireshark.org/download/win64/Wireshark-latest-x64.exe' },
  { key: 'nmap', group: 'Сеть, VPN и безопасность', title: 'Nmap + Zenmap', short_desc: 'Сканер сети и открытых портов.', tags: 'сеть,порты,сканер', home: 'https://nmap.org/',
    resolve: () => fromIndex('https://nmap.org/download.html', /nmap-(\d+\.\d+)-setup\.exe/g, (v) => `https://nmap.org/dist/nmap-${v}-setup.exe`) },
  { key: 'angryip', group: 'Сеть, VPN и безопасность', title: 'Angry IP Scanner', short_desc: 'Быстрый поиск устройств в локальной сети.', tags: 'сеть,сканер,бесплатно', home: 'https://angryip.org/', github: 'angryip/ipscan', asset: 'ipscan-*-setup.exe' },
  { key: 'wireguard', group: 'Сеть, VPN и безопасность', title: 'WireGuard', short_desc: 'Официальный клиент быстрого VPN-протокола WireGuard.', tags: 'vpn,wireguard,бесплатно', home: 'https://www.wireguard.com/', version: 'последняя', url: 'https://download.wireguard.com/windows-client/wireguard-installer.exe' },
  { key: 'openvpn', group: 'Сеть, VPN и безопасность', title: 'OpenVPN', short_desc: 'Официальный клиент OpenVPN Community.', tags: 'vpn,openvpn,бесплатно', home: 'https://openvpn.net/community-downloads/',
    resolve: () => fromIndex('https://openvpn.net/community-downloads/', /OpenVPN-(\d+\.\d+\.\d+-I\d+)-amd64\.msi/g, (v) => `https://swupdate.openvpn.org/community/releases/OpenVPN-${v}-amd64.msi`) },
  { key: 'tailscale', group: 'Сеть, VPN и безопасность', title: 'Tailscale', short_desc: 'Своя приватная сеть между вашими устройствами за минуту.', tags: 'vpn,сеть', home: 'https://tailscale.com/', version: 'последняя', url: 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' },
  { key: 'zerotier', group: 'Сеть, VPN и безопасность', title: 'ZeroTier One', short_desc: 'Виртуальная локальная сеть через интернет — для игр и доступа к ПК.', tags: 'vpn,локальная сеть', home: 'https://www.zerotier.com/', version: 'последняя', url: 'https://download.zerotier.com/dist/ZeroTier%20One.msi' },
  { key: 'radmin', group: 'Сеть, VPN и безопасность', title: 'Radmin VPN', short_desc: 'Бесплатная виртуальная локальная сеть для игр по сети.', tags: 'vpn,локальная сеть,игры', home: 'https://www.radmin-vpn.com/ru/',
    resolve: () => fromIndex('https://www.radmin-vpn.com/ru/', /Radmin_VPN_(\d+\.\d+\.\d+\.\d+)\.exe/g, (v) => `https://download.radmin-vpn.com/download/files/Radmin_VPN_${v}.exe`) },

  // ---------- Сеть и безопасность ----------
  { key: 'happ', group: 'Сеть, VPN и безопасность', title: 'Happ', short_desc: 'Клиент для прокси и VPN-подписок (Xray, V2Ray).', tags: 'vpn,прокси,xray', github: 'Happ-proxy/happ-desktop' },
  { key: 'v2rayn', group: 'Сеть, VPN и безопасность', title: 'v2rayN', short_desc: 'Клиент Xray / V2Ray / sing-box с открытым кодом.', tags: 'vpn,прокси,xray', github: '2dust/v2rayN' },
  { key: 'zapretzen', group: 'Сеть, VPN и безопасность', title: 'Zapret Zen', short_desc: 'Приложение для лёгкого обхода замедлений сервисов.', tags: 'zapret,обход,discord,youtube', github: 'peshk0v/Zapret-Zen' },
  { key: 'zapretdy', group: 'Сеть, VPN и безопасность', title: 'zapret-discord-youtube', short_desc: 'Обход замедления Discord и YouTube (запуск — general.bat).', tags: 'zapret,обход,discord,youtube', github: 'Flowseal/zapret-discord-youtube', launch: 'general.bat' },
  { key: 'keepassxc', group: 'Сеть, VPN и безопасность', title: 'KeePassXC', short_desc: 'Менеджер паролей, всё хранится у вас.', tags: 'пароли,безопасность,бесплатно', home: 'https://keepassxc.org/', github: 'keepassxreboot/keepassxc', asset: 'KeePassXC-*-x64.msi' },
  { key: 'anydesk', group: 'Сеть, VPN и безопасность', icon: 'https://anydesk.com/favicon.ico', title: 'AnyDesk', short_desc: 'Удалённый доступ к компьютеру.', tags: 'удалённый доступ', home: 'https://anydesk.com/ru', url: 'https://download.anydesk.com/AnyDesk.exe' },
  { key: 'rustdesk', group: 'Сеть, VPN и безопасность', title: 'RustDesk', short_desc: 'Бесплатный удалённый доступ с открытым кодом.', tags: 'удалённый доступ,бесплатно', home: 'https://rustdesk.com/', github: 'rustdesk/rustdesk', asset: 'rustdesk-*-x86_64.exe' },
  { key: 'malwarebytes', group: 'Сеть, VPN и безопасность', title: 'Malwarebytes', short_desc: 'Поиск и удаление вредоносных программ.', tags: 'антивирус,безопасность', home: 'https://www.malwarebytes.com/', url: 'https://downloads.malwarebytes.com/file/mb-windows' },
];

// ---------- Обложки: картинка-превью с официального сайта ----------

async function fetchSiteCover(home) {
  try {
    const htmlText = await fetchText(home);
    const m = htmlText.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i)
      || htmlText.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!m) return null;
    const imgUrl = new URL(m[1].replace(/&amp;/g, '&'), home).href;
    const res = await fetch(imgUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type.split(';')[0]];
    if (!res.ok || !ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000 || buf.length > 5 * 1024 * 1024) return null;
    const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
    return name;
  } catch {
    return null;
  }
}

function existing(item) {
  if (item.github) return one("SELECT id FROM games WHERE source = 'github' AND lower(github_repo) = lower(?)", item.github);
  return one('SELECT id FROM games WHERE title = ?', item.title);
}

export function catalogList() {
  return CATALOG.map((item) => ({
    key: item.key,
    group: item.group,
    title: item.title,
    short_desc: item.short_desc,
    source: item.github ? 'github' : item.resolve ? 'resolve' : 'link',
    github: item.github || null,
    url: item.url || '',
    hint: item.hint || (item.resolve ? 'Свежая ссылка найдётся на сайте производителя автоматически — или вставьте свою' : ''),
    game_id: existing(item)?.id || null,
  }));
}

export async function addFromCatalog(key, user, url = '') {
  const item = CATALOG.find((x) => x.key === key);
  if (!item) fail(404, 'Нет такой программы в каталоге');
  if (existing(item)) fail(409, 'Эта программа уже есть в магазине');
  const t = Date.now();
  let releases = null;
  let version = item.version || 'последняя';
  let link = url || item.url || '';

  if (item.github) {
    releases = await fetchReleases(item.github); // один запрос к API на программу
    const first = (releases.data || []).find((r) => !r.draft && !r.prerelease) || (releases.data || [])[0];
    if (!first) fail(404, 'У проекта нет релизов на GitHub');
    version = String(first.tag_name).slice(0, 30);
  } else if (!url && item.resolve) {
    try {
      const found = await item.resolve();
      link = found.url;
      version = found.version;
    } catch (e) {
      fail(502, `Не удалось найти свежую ссылку на сайте производителя (${e.message}) — вставьте прямую ссылку вручную`);
    }
  }
  if (!item.github && !/^https?:\/\//i.test(link)) fail(400, 'Укажите прямую ссылку на файл (https://…)');

  const cover = (await makeCover(item)).file;
  const homeLine = item.home ? `\n\nОфициальный сайт: ${item.home}` : item.github ? `\n\nИсходный код и история версий: https://github.com/${item.github}` : '';
  const description = item.description || `${item.short_desc}${homeLine}`;

  const id = tx(() => {
    const info = run(
      `INSERT INTO games(title, short_desc, description, genre, tags, developer_id, cover, version, platform, launch_path,
        external_url, source, github_repo, github_asset, category, status, created_at, updated_at, published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?)`,
      item.title, item.short_desc, description, 'Программа', `${item.group.toLowerCase()},${item.tags}`, user.id, cover,
      version, 'Windows', item.launch || '', item.github ? null : link, item.github ? 'github' : 'file',
      item.github || null, item.asset || '', item.group, t, t, t,
    );
    const gid = Number(info.lastInsertRowid);
    run('INSERT OR IGNORE INTO library(user_id, game_id, added_at) VALUES(?,?,?)', user.id, gid, t);
    return gid;
  });
  try {
    if (item.github) await syncGame(getGameRow(id), { prefetched: releases });
    else syncMainFromGame(id, user.id);
  } catch (e) {
    run('DELETE FROM games WHERE id = ?', id);
    throw e;
  }
  return id;
}

/** Программам, добавленным из каталога до появления категорий, проставляем категорию по названию. */
export function fillCatalogCategories() {
  tx(() => {
    for (const item of CATALOG) run("UPDATE games SET category = ? WHERE category = '' AND title = ?", item.group, item.title);
  });
}
