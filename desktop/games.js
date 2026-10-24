// Установка, запуск и удаление игр на компьютере пользователя.
// Рендерер передаёт только id игры: адрес загрузки, пути и исполняемые файлы определяет главный процесс.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { shell } from 'electron';
import { installerKind, systemSnapshot, detectInstalled, runInstaller, runUninstaller, unblock } from './installer.js';

const ARCHIVE_RE = /\.(zip|rar|7z|tar|tgz|gz|bz2|xz)$/i;
const SKIP_EXE_RE = /(unins|setup|install|redist|vc_?redist|dxsetup|directx|dotnet|crash|report|helper|updater|prereq)/i;
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
// Если .exe нет — открываем образ диска (Windows подключит его) или установщик MSI.
const OPENABLE_RE = /\.(iso|img|msi|vhdx?)$/i;

export function safeName(name, fallback = 'game') {
  const s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) || !s ? fallback : s;
}

const isInside = (parent, child) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

function untar(archive, dest) {
  return new Promise((resolve, reject) => {
    execFile(TAR, ['-xf', archive, '-C', dest], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`Не удалось распаковать архив: ${(stderr || err.message).trim().slice(0, 200)}`));
      else resolve();
    });
  });
}

async function findExe(dir, title) {
  const found = [];
  async function walk(d, depth) {
    if (depth > 4) return;
    for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else if (/\.exe$/i.test(ent.name)) found.push({ p, depth, name: ent.name, size: (await fsp.stat(p)).size });
    }
  }
  await walk(dir, 0);
  if (!found.length) {
    const top = (await fsp.readdir(dir)).find((n) => OPENABLE_RE.test(n));
    return top ? path.join(dir, top) : null;
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  const t = norm(title || '');
  const score = (f) => {
    const n = norm(path.parse(f.name).name);
    let s = Math.log10(f.size + 1) * 2 - f.depth * 5;
    if (SKIP_EXE_RE.test(f.name)) s -= 50;
    if (t && n && (n.includes(t) || t.includes(n))) s += 30;
    return s;
  };
  found.sort((a, b) => score(b) - score(a));
  return found[0].p;
}

/** Файл запуска, указанный разработчиком (game.exe, bin/start.bat). Ищем и внутри вложенной папки архива. */
async function findLaunch(dir, launch) {
  const rel = String(launch || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').includes('..')) return null;
  const direct = path.join(dir, rel);
  if (isInside(dir, direct) && fs.existsSync(direct)) return direct;
  const tail = rel.toLowerCase();
  let found = null;
  async function walk(d, depth) {
    if (found || depth > 5) return;
    for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else {
        const r = path.relative(dir, p).replace(/\\/g, '/').toLowerCase();
        if (r === tail || r.endsWith(`/${tail}`)) found ||= p;
      }
    }
  }
  await walk(dir, 0);
  return found;
}

/** Архив, внутри которого только установщик (как у Paint.NET), — его тоже запускаем сами. */
async function lonelyInstaller(dir) {
  const exes = [];
  async function walk(d, depth) {
    if (depth > 1) return;
    for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else if (/\.(exe|msi)$/i.test(ent.name)) exes.push(p);
    }
  }
  await walk(dir, 0);
  return exes.length === 1 && /setup|install/i.test(path.basename(exes[0])) ? exes[0] : null;
}

function bytes(n) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i ? n.toFixed(1).replace('.', ',') : Math.round(n)} ${units[i]}`;
}

async function dirSize(dir) {
  let total = 0;
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    total += ent.isDirectory() ? await dirSize(p) : (await fsp.stat(p)).size;
  }
  return total;
}

export function createGames({ manifestFile, libraryDir, send, openExternal }) {
  let manifest = { installed: {}, pendingPlaytime: {} };
  try {
    manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestFile, 'utf8')) };
  } catch {
    /* первый запуск */
  }
  const save = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const jobs = new Map();
  const running = new Map();
  const key = (origin, id) => `${origin}|${id}`;
  const entry = (origin, id) => manifest.installed[origin]?.[id] || null;
  // Установщики запускаем по одному: Windows Installer не умеет ставить две программы сразу.
  let installQueue = Promise.resolve();
  const queued = (fn) => {
    const p = installQueue.then(fn);
    installQueue = p.catch(() => {});
    return p;
  };

  function publicEntry(e) {
    return e && { version: e.version, title: e.title, dir: e.dir, hasExe: !!e.exe, installedApp: !!e.kind, exeName: e.exe ? path.basename(e.exe) : null, size: e.size, installedAt: e.installedAt, lastPlayed: e.lastPlayed || null, versionId: e.versionId || null, pinned: !!e.pinned };
  }

  function emit(origin, id, extra = {}) {
    const job = jobs.get(key(origin, id));
    send('games:state', {
      origin,
      id,
      job: job ? { state: job.state, received: job.received, total: job.total, title: job.title } : null,
      title: job?.title || entry(origin, id)?.title || '',
      running: running.has(key(origin, id)),
      installed: publicEntry(entry(origin, id)),
      ...extra,
    });
  }

  function snapshot(origin) {
    const installed = {};
    for (const [id, e] of Object.entries(manifest.installed[origin] || {})) installed[id] = publicEntry(e);
    const active = {};
    for (const j of jobs.values()) if (j.origin === origin) active[j.id] = { state: j.state, received: j.received, total: j.total, title: j.title };
    const runningIds = [...running.keys()].filter((k) => k.startsWith(`${origin}|`)).map((k) => Number(k.split('|')[1]));
    return { installed, jobs: active, running: runningIds, pendingPlaytime: manifest.pendingPlaytime[origin] || {} };
  }

  function install(ses, origin, id, meta) {
    const k = key(origin, id);
    if (jobs.has(k)) return;
    const versionId = Number.isInteger(meta.versionId) && meta.versionId > 0 ? meta.versionId : 0;
    // directUrl — прямая ссылка из сохранённого каталога: так бесплатные программы ставятся и без сервера.
    const url = meta.directUrl || `${origin}/api/games/${id}/download${versionId ? `?v=${versionId}` : ''}`;
    jobs.set(k, {
      origin, id, url, versionId, pinned: !!meta.pinned && !!versionId,
      title: safeName(meta.title, `game-${id}`), version: String(meta.version || '').slice(0, 30),
      launch: String(meta.launch || '').slice(0, 200),
      state: 'starting', received: 0, total: 0, item: null,
    });
    emit(origin, id);
    ses.downloadURL(url);
  }

  async function finish(job, file, filename) {
    await unblock(file);
    const lib = libraryDir();
    const prev = entry(job.origin, job.id);
    let folder = prev?.dir || path.join(lib, job.title);
    if (!prev && fs.existsSync(folder)) folder = path.join(lib, `${job.title}-${job.id}`);
    const staging = `${folder}.installing`;
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true });
    if (ARCHIVE_RE.test(filename)) {
      try {
        await untar(file, staging);
        if (!(await fsp.readdir(staging)).length) throw new Error('Архив игры пуст или повреждён');
      } catch (err) {
        await fsp.rm(staging, { recursive: true, force: true });
        throw err;
      }
      await fsp.rm(file, { force: true });
    } else {
      await fsp.rename(file, path.join(staging, safeName(filename, 'game.bin')));
    }
    if (fs.existsSync(folder)) await fsp.rm(folder, { recursive: true, force: true });
    await fsp.rename(staging, folder);

    // Скачан установщик — ставим программу сами, в папку библиотеки HYTEAM, и запоминаем её главный .exe.
    let installed = null;
    const single = ARCHIVE_RE.test(filename) ? await lonelyInstaller(folder) : path.join(folder, safeName(filename, 'game.bin'));
    const kind = single && (await installerKind(single));
    if (kind) {
      const appDir = path.join(folder, 'app');
      try {
        installed = await queued(async () => {
          const before = await systemSnapshot();
          await runInstaller(single, kind, appDir);
          return detectInstalled(before, job.title);
        });
      } catch (err) {
        if (!prev) await fsp.rm(folder, { recursive: true, force: true });
        throw err;
      }
      await fsp.rm(single, { force: true });
      installed.exe = (await findLaunch(appDir, job.launch)) || installed.exe
        || (fs.existsSync(appDir) && (await findExe(appDir, job.title)))
        || (installed.location && fs.existsSync(installed.location) && (await findExe(installed.location, job.title))) || null;
    }

    const e = {
      dir: folder,
      exe: installed ? installed.exe : (await findLaunch(folder, job.launch)) || (await findExe(folder, job.title)),
      kind: kind || null,
      uninstall: installed?.uninstall || '',
      version: job.version,
      title: job.title,
      installedAt: Date.now(),
      size: await dirSize(folder),
      lastPlayed: prev?.lastPlayed || null,
      // Выбранная вручную не-основная версия «закреплена»: автообновление её не трогает.
      versionId: job.versionId || null,
      pinned: job.pinned,
    };
    (manifest.installed[job.origin] ||= {})[job.id] = e;
    save();
  }

  /** Обработчик session 'will-download'. Возвращает false, если загрузка не наша. */
  function handleDownload(item) {
    const chain = item.getURLChain();
    const job = [...jobs.values()].find((j) => j.url === chain[0] && !j.item);
    if (!job) return false;
    const k = key(job.origin, job.id);
    const finalUrl = new URL(chain[chain.length - 1]);
    // Прямые ссылки (GitHub, CDN производителя и т. п.) качаем прямо в программе.
    // Если по ссылке открывается веб-страница, а не файл (Google Диск, сайт игры) — показываем её в браузере.
    if (finalUrl.origin !== job.origin && /^text\/html/i.test(item.getMimeType() || '')) {
      item.cancel();
      jobs.delete(k);
      openExternal(finalUrl.href);
      emit(job.origin, job.id, { notice: 'По ссылке страница сайта, а не файл — открыл её в браузере' });
      return true;
    }
    job.item = item;
    const tmp = path.join(libraryDir(), '.downloads');
    fs.mkdirSync(tmp, { recursive: true });
    const filename = item.getFilename() || `game-${job.id}.bin`;
    const file = path.join(tmp, `${job.id}-${Date.now()}-${safeName(filename, 'game.bin')}`);
    item.setSavePath(file);
    job.state = 'downloading';
    job.total = item.getTotalBytes();
    // Места на диске должно хватить на файл и на распаковку/установку — иначе не начинаем.
    if (job.total) {
      fsp.statfs(tmp).then((st) => {
        const free = st.bavail * st.bsize;
        const need = job.total * (ARCHIVE_RE.test(filename) ? 2.5 : 1.5);
        if (free < need) {
          job.noSpace = `Недостаточно места на диске: нужно около ${bytes(need)}, свободно ${bytes(free)}. Освободите место или выберите другую папку в настройках.`;
          item.cancel();
        }
      }).catch(() => {});
    }
    let last = 0;
    item.on('updated', (_e, st) => {
      job.received = item.getReceivedBytes();
      job.total = item.getTotalBytes();
      if (st === 'progressing' && Date.now() - last > 250) {
        last = Date.now();
        emit(job.origin, job.id);
      }
    });
    item.once('done', async (_e, st) => {
      if (st !== 'completed') {
        jobs.delete(k);
        fs.rm(file, { force: true }, () => {});
        emit(job.origin, job.id, job.noSpace ? { error: job.noSpace } : st === 'cancelled' ? {} : { error: 'Загрузка прервалась. Попробуйте ещё раз.' });
        return;
      }
      job.state = 'installing';
      emit(job.origin, job.id);
      try {
        await finish(job, file, filename);
        jobs.delete(k);
        emit(job.origin, job.id, { notice: `«${job.title}» установлена` });
        openAfterInstall(job.origin, job.id);
      } catch (err) {
        jobs.delete(k);
        fs.rm(file, { force: true }, () => {});
        emit(job.origin, job.id, { error: err.message });
      }
    });
    return true;
  }

  function cancel(origin, id) {
    const job = jobs.get(key(origin, id));
    if (job?.item) job.item.cancel();
    else if (job) {
      jobs.delete(key(origin, id));
      emit(origin, id);
    }
  }

  function addPlaytime(origin, id, minutes) {
    const bucket = (manifest.pendingPlaytime[origin] ||= {});
    bucket[id] = (bucket[id] || 0) + minutes;
    save();
    send('games:playtime', { origin, id, minutes: bucket[id] });
  }

  function ackPlaytime(origin, id, minutes) {
    const bucket = manifest.pendingPlaytime[origin];
    if (!bucket?.[id]) return;
    bucket[id] = Math.max(0, bucket[id] - minutes);
    if (!bucket[id]) delete bucket[id];
    save();
  }

  /** Программа, скачанная старой версией HYTEAM как голый установщик: доустанавливаем её из уже скачанного файла. */
  async function installDownloaded(origin, id, e) {
    const k = key(origin, id);
    if (jobs.has(k)) return;
    const job = { origin, id, title: e.title, version: e.version, launch: '', versionId: e.versionId, pinned: e.pinned, state: 'installing', received: 0, total: 0 };
    jobs.set(k, job);
    emit(origin, id);
    try {
      const tmp = path.join(libraryDir(), '.downloads');
      await fsp.mkdir(tmp, { recursive: true });
      const copy = path.join(tmp, `${id}-${Date.now()}-${path.basename(e.exe)}`);
      await fsp.copyFile(e.exe, copy);
      await finish(job, copy, path.basename(e.exe));
      jobs.delete(k);
      emit(origin, id, { notice: `«${e.title}» установлена` });
      openAfterInstall(origin, id);
    } catch (err) {
      jobs.delete(k);
      emit(origin, id, { error: err.message });
    }
  }

  /** Программа, которую поставил установщик, сразу открывается — как будто нажали «Запустить». */
  function openAfterInstall(origin, id) {
    const e = entry(origin, id);
    if (!e?.kind || !e.exe) return;
    play(origin, id).catch((err) => emit(origin, id, { error: err.message }));
  }

  async function play(origin, id) {
    const e = entry(origin, id);
    if (!e) throw new Error('Игра не установлена');
    if (!e.exe || !fs.existsSync(e.exe)) throw new Error('Не найден файл запуска — укажите .exe вручную');
    if (!e.kind && path.dirname(e.exe) === e.dir && (await installerKind(e.exe))) return installDownloaded(origin, id, e);
    const k = key(origin, id);
    if (running.has(k)) return;
    if (!/\.exe$/i.test(e.exe)) {
      shell.openPath(e.exe);
      return;
    }
    const started = Date.now();
    const child = spawn(e.exe, [], { cwd: path.dirname(e.exe), detached: true, stdio: 'ignore' });
    running.set(k, child);
    e.lastPlayed = started;
    save();
    emit(origin, id);
    child.on('error', (err) => {
      running.delete(k);
      // Игре нужны права администратора — запускаем через оболочку Windows (появится запрос UAC).
      if (err.code === 'EACCES' || err.errno === 740 || /740|elevation/i.test(err.message)) shell.openPath(e.exe);
      else emit(origin, id, { error: `Не удалось запустить: ${err.message}` });
      emit(origin, id);
    });
    child.on('exit', () => {
      running.delete(k);
      emit(origin, id);
      const minutes = Math.round((Date.now() - started) / 60000);
      if (minutes > 0) addPlaytime(origin, id, minutes);
    });
    child.unref();
  }

  async function uninstall(origin, id) {
    const e = entry(origin, id);
    if (!e) return;
    if (running.has(key(origin, id))) throw new Error('Сначала закройте игру');
    const dir = path.resolve(e.dir);
    // Защита: удаляем только папку игры, а не корень диска или папку библиотеки целиком.
    if (dir === path.parse(dir).root || dir === path.resolve(libraryDir())) throw new Error('Некорректная папка игры');
    // Программу, поставленную установщиком, удаляем её же деинсталлятором — чтобы не осталось следов в Windows.
    if (e.uninstall) await queued(() => runUninstaller(e.uninstall, e.kind));
    await fsp.rm(dir, { recursive: true, force: true });
    delete manifest.installed[origin][id];
    save();
    emit(origin, id);
  }

  function setExe(origin, id, exe) {
    const e = entry(origin, id);
    if (!e) throw new Error('Игра не установлена');
    e.exe = exe;
    save();
    emit(origin, id);
  }

  return {
    snapshot,
    install,
    handleDownload,
    cancel,
    play,
    uninstall,
    setExe,
    ackPlaytime,
    entry,
    isInside,
    hasRunning: () => running.size > 0,
    activeJobs: () => jobs.size,
    /** Ярлык программы на рабочем столе. */
    shortcut(origin, id, desktopDir) {
      const e = entry(origin, id);
      if (!e?.exe || !fs.existsSync(e.exe)) throw new Error('Не найден файл запуска — сначала установите программу');
      const file = path.join(desktopDir, `${safeName(e.title, 'HYTEAM')}.lnk`);
      const ok = shell.writeShortcutLink(file, 'create', { target: e.exe, cwd: path.dirname(e.exe), icon: e.exe, iconIndex: 0, description: e.title });
      if (!ok) throw new Error('Не удалось создать ярлык');
      return file;
    },
  };
}
