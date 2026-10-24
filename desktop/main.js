// HYTEAM — десктоп-клиент для Windows.
// Подключается к серверу HYTEAM (или запускает свой сервер) и показывает магазин в окне в стиле HYTEAM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, net, screen, shell, utilityProcess } from 'electron';
import { createGames } from './games.js';
import { createTunnel } from './tunnel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ICON = path.join(HERE, 'assets', 'icon.png');
const UI_URL = pathToFileURL(path.join(HERE, 'ui')).href;

app.setAppUserModelId('com.hyteam.store');
// HTTP/3 (QUIC по UDP) до Cloudflare у многих провайдеров режется: файлы обрываются и магазин не загружается.
// Работаем только по TCP — так же надёжно, как обычный HTTPS.
app.commandLine.appendSwitch('disable-quic');
// Отдельный профиль для тестов и нескольких копий: HYTEAM_USER_DATA=путь
if (process.env.HYTEAM_USER_DATA) app.setPath('userData', path.resolve(process.env.HYTEAM_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- Настройки ----------

const configFile = () => path.join(app.getPath('userData'), 'config.json');
let config = {
  mode: null, // 'client' | 'host'
  serverUrl: '',
  recent: [],
  hostPort: 3000,
  hostDataDir: '',
  libraryDir: '',
  bounds: null,
  maximized: false,
  trayHintShown: false,
  tunnel: false,
};
function loadConfig() {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch {
    /* первый запуск */
  }
}
const saveConfig = () => fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));

// Адрес сервера, вшитый в установщик (npm run set-server). Пользователь подключается к нему сразу, без выбора.
const BUILT_IN_SERVER = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(HERE, 'server.json'), 'utf8')).url || '');
  } catch {
    return '';
  }
})();
const libraryDir = () => config.libraryDir || path.join(app.getPath('home'), 'HYTEAM Library');
const hostDataDir = () => config.hostDataDir || path.join(app.getPath('userData'), 'server-data');

let win = null;
let tray = null;
let quitting = false;
let currentOrigin = null;
let games = null;
let tunnel = null;

const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);

function openExternal(url) {
  try {
    if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {
    /* некорректная ссылка */
  }
}

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${port}`);
  }
  return out;
}

// Адрес без схемы: для IP, localhost и адресов с портом сначала пробуем http, для доменов — https.
function urlCandidates(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Введите адрес сервера');
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    throw new Error('Некорректный адрес сервера');
  }
  if (/^https?:\/\//i.test(s)) return [u.origin];
  const plain = u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || !!u.port;
  return plain ? [u.origin, `https://${u.host}`] : [`https://${u.host}`, u.origin];
}

async function ping(origin, timeout = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(`${origin}/api/meta`, { signal: ctrl.signal, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.genres)) throw new Error('bad');
  } catch {
    throw new Error(`Сервер HYTEAM по адресу ${origin} не отвечает`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Свой сервер (режим хоста) ----------

let server = null;
let serverLog = '';

function startServerProcess(port) {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    serverLog = '';
    const logFile = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'a' });
    server = utilityProcess.fork(path.join(ROOT, 'server', 'index.js'), [], {
      env: { ...process.env, PORT: String(port), HOST: '0.0.0.0', DATA_DIR: hostDataDir(), NODE_USE_ENV_PROXY: '1' },
      execArgv: ['--disable-warning=ExperimentalWarning'],
      stdio: 'pipe',
      serviceName: 'HYTEAM Server',
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      serverLog = (serverLog + text).slice(-4000);
      logFile.write(text);
    };
    server.stdout?.on('data', onData);
    server.stderr?.on('data', onData);
    let started = false;
    server.once('spawn', () => {
      started = true;
      resolve();
    });
    server.on('exit', (code) => {
      server = null;
      logFile.end();
      if (!started) return reject(new Error('Не удалось запустить сервер'));
      if (!quitting && config.mode === 'host') {
        const busy = /EADDRINUSE/.test(serverLog);
        showConnect(busy
          ? `Порт ${port} уже занят — возможно, сервер HYTEAM уже запущен. Подключитесь к http://localhost:${port} или выберите другой порт.`
          : `Сервер остановился (код ${code}). Подробности в server.log`);
      }
    });
  });
}

function stopServer() {
  tunnel?.stop();
  if (server) {
    server.kill();
    server = null;
  }
  tray?.destroy();
  tray = null;
}

async function startHost(port) {
  port = Number(port) || config.hostPort || 3000;
  if (port < 1 || port > 65535) throw new Error('Некорректный порт');
  if (config.hostPort !== port) stopServer();
  config.hostPort = port;
  await startServerProcess(port);
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      await ping(origin, 1500);
      break;
    } catch (e) {
      if (!server) throw new Error(/EADDRINUSE/.test(serverLog) ? `Порт ${port} уже занят. Выберите другой порт.` : 'Сервер не запустился');
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  config.mode = 'host';
  saveConfig();
  ensureTray();
  await loadServer(origin);
  if (config.tunnel && !tunnel.isOn()) tunnel.start(port).catch(() => {});
}

function ensureTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('HYTEAM — сервер работает');
    tray.on('click', showWindow);
  }
  const lan = lanAddresses(config.hostPort)[0] || `http://localhost:${config.hostPort}`;
  const web = tunnel?.get().url;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть HYTEAM', click: showWindow },
    { type: 'separator' },
    { label: `В сети: ${lan}`, enabled: false },
    { label: web ? `Интернет: ${web}` : 'Интернет: доступ закрыт', enabled: false },
    ...(web ? [{ label: 'Скопировать адрес для друзей', click: () => clipboard.writeText(web) }] : []),
    { type: 'separator' },
    { label: 'Остановить сервер и выйти', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- Окно ----------

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function validBounds(b) {
  if (!b || b.x == null) return b ? { width: b.width, height: b.height } : {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100);
  return visible ? b : { width: b.width, height: b.height };
}

function isAllowedPage(url) {
  if (url.startsWith(UI_URL)) return true;
  try {
    return !!currentOrigin && new URL(url).origin === currentOrigin;
  } catch {
    return false;
  }
}

function createWindow() {
  const b = validBounds(config.bounds);
  win = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    x: b.x,
    y: b.y,
    minWidth: 1024,
    minHeight: 640,
    title: 'HYTEAM',
    icon: ICON,
    show: false,
    backgroundColor: '#06041a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#d6ccff', height: 40 },
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (config.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  const sendState = () => send('window:state', { maximized: win.isMaximized() });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  wc.on('did-finish-load', sendState);

  // Никаких переходов на чужие сайты внутри окна — внешние ссылки открываются в браузере.
  const guard = (e, url) => {
    if (!isAllowedPage(url)) {
      e.preventDefault();
      openExternal(url);
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith(UI_URL)) showConnect(`Соединение с сервером потеряно (${desc})`);
  });

  // Сочетания клавиш по физическим клавишам (input.code) — работают в любой раскладке, в том числе русской.
  // Меню окна отключено, поэтому правку текста (копировать, вставить…) выполняем сами.
  const EDIT = { KeyC: 'copy', KeyV: 'paste', KeyX: 'cut', KeyA: 'selectAll', KeyZ: 'undo', KeyY: 'redo' };
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const run = (fn) => {
      e.preventDefault();
      fn();
    };
    if (input.code === 'F5' || (ctrl && input.code === 'KeyR')) run(() => wc.reload());
    else if (input.code === 'F12' || (ctrl && input.shift && input.code === 'KeyI')) run(() => wc.toggleDevTools());
    else if (ctrl && !input.alt && input.shift && input.code === 'KeyZ') run(() => wc.redo());
    else if (ctrl && !input.alt && !input.shift && EDIT[input.code]) run(() => wc[EDIT[input.code]]());
    else if (ctrl && input.shift && input.code === 'KeyV') run(() => wc.pasteAndMatchStyle());
    else if (ctrl && (input.code === 'Equal' || input.code === 'NumpadAdd')) run(() => wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 3)));
    else if (ctrl && (input.code === 'Minus' || input.code === 'NumpadSubtract')) run(() => wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)));
    else if (ctrl && (input.code === 'Digit0' || input.code === 'Numpad0')) run(() => wc.setZoomLevel(0));
    else if (input.alt && input.code === 'ArrowLeft' && wc.navigationHistory.canGoBack()) run(() => wc.navigationHistory.goBack());
    else if (input.alt && input.code === 'ArrowRight' && wc.navigationHistory.canGoForward()) run(() => wc.navigationHistory.goForward());
    else if (ctrl && input.code === 'KeyF') run(() => wc.executeJavaScript("document.querySelector('#search-input')?.focus()"));
  });
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (cmd === 'browser-forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  });

  win.on('close', (e) => {
    config.bounds = win.getNormalBounds();
    config.maximized = win.isMaximized();
    saveConfig();
    // В режиме хоста сервер должен работать и при закрытом окне — прячемся в трей.
    if (!quitting && server && config.mode === 'host') {
      e.preventDefault();
      win.hide();
      if (!config.trayHintShown && tray) {
        tray.displayBalloon({
          title: 'HYTEAM работает в фоне',
          content: 'Сервер продолжает работать для ваших друзей. Выйти можно через значок в трее.',
          iconType: 'info',
        });
        config.trayHintShown = true;
        saveConfig();
      }
    }
  });
  win.on('closed', () => {
    win = null;
  });

  wc.session.on('will-download', (_e, item) => {
    games.handleDownload(item);
  });
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function showConnect(error = '') {
  currentOrigin = null;
  if (win) win.loadFile(path.join(HERE, 'ui', 'connect.html'), { query: { error } });
}

async function loadServer(origin) {
  currentOrigin = origin;
  await win.loadURL(origin);
  saveOfflineCatalog(origin);
}

// ---------- Работа без сервера ----------
// Бесплатные программы с GitHub и сайтов производителей качаются не с нашего сервера.
// Запоминаем их список, чтобы ставить и запускать их, даже когда сервер магазина выключен.

const offlineFile = () => path.join(app.getPath('userData'), 'offline.json');

async function saveOfflineCatalog(origin) {
  try {
    const res = await net.fetch(`${origin}/api/offline-catalog`, { cache: 'no-store' });
    if (!res.ok) return;
    const items = (await res.json()).filter((g) => /^https:\/\//i.test(g.url || ''));
    fs.writeFileSync(offlineFile(), JSON.stringify({ origin, savedAt: Date.now(), items }));
  } catch {
    /* старый сервер без этого списка или нет сети — оставляем прошлый снимок */
  }
}

function loadOfflineCatalog() {
  try {
    return JSON.parse(fs.readFileSync(offlineFile(), 'utf8'));
  } catch {
    return { origin: '', savedAt: 0, items: [] };
  }
}

function offlineItem(id) {
  const cat = loadOfflineCatalog();
  const item = cat.items.find((g) => g.id === gameId(id));
  if (!item) throw new Error('Программа не найдена в сохранённом каталоге');
  return { cat, item };
}

async function connectTo(input) {
  let origin = null;
  let firstError = null;
  for (const candidate of urlCandidates(input)) {
    try {
      await ping(candidate);
      origin = candidate;
      break;
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!origin) throw firstError;
  if (config.mode === 'host' && !origin.startsWith('http://localhost')) stopServer();
  config.mode = /^http:\/\/localhost:/.test(origin) && server ? 'host' : 'client';
  config.serverUrl = origin;
  config.recent = [origin, ...config.recent.filter((r) => r !== origin)].slice(0, 5);
  saveConfig();
  await loadServer(origin);
}

async function boot() {
  try {
    if (config.mode === 'host') await startHost(config.hostPort);
    else if (config.mode === 'client' && config.serverUrl) await connectTo(config.serverUrl);
    else if (BUILT_IN_SERVER) await connectTo(BUILT_IN_SERVER);
    else showConnect();
  } catch (e) {
    showConnect(e.message);
  }
}

// ---------- IPC ----------

const fromApp = (e) => e.senderFrame?.url.startsWith(UI_URL);
const fromServer = (e) => {
  try {
    return !!currentOrigin && new URL(e.senderFrame.url).origin === currentOrigin;
  } catch {
    return false;
  }
};
const anyTrusted = (e) => fromApp(e) || fromServer(e);

function handle(channel, guard, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!guard(e)) return { ok: false, error: 'Недоступно для этой страницы' };
    try {
      return { ok: true, data: await fn(e, ...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

const gameId = (id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Некорректная игра');
  return n;
};

function registerIpc() {
  handle('app:info', anyTrusted, () => ({
    version: app.getVersion(),
    mode: config.mode,
    serverUrl: currentOrigin || config.serverUrl || BUILT_IN_SERVER,
    builtInServer: BUILT_IN_SERVER,
    recent: config.recent,
    hostPort: config.hostPort,
    hostDataDir: hostDataDir(),
    hostRunning: !!server,
    lan: server ? lanAddresses(config.hostPort) : [],
    libraryDir: libraryDir(),
    tunnel: tunnel.get(),
  }));
  handle('app:copy', anyTrusted, (_e, text) => clipboard.writeText(String(text ?? '').slice(0, 2000)));
  handle('tunnel:start', fromServer, async () => {
    if (!server) throw new Error('Доступ из интернета работает только для своего сервера');
    config.tunnel = true;
    saveConfig();
    return tunnel.start(config.hostPort);
  });
  handle('tunnel:stop', fromServer, () => {
    config.tunnel = false;
    saveConfig();
    tunnel.stop();
  });
  handle('app:connect', anyTrusted, (_e, url) => connectTo(url));
  handle('app:host', anyTrusted, (_e, opts) => startHost(opts?.port));
  handle('app:change-server', fromServer, () => showConnect());
  handle('app:choose-data-dir', fromApp, async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Папка для данных сервера', defaultPath: hostDataDir(), properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) {
      config.hostDataDir = r.filePaths[0];
      saveConfig();
    }
    return hostDataDir();
  });
  handle('app:choose-library-dir', fromServer, async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Папка для установки игр', defaultPath: libraryDir(), properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) {
      config.libraryDir = r.filePaths[0];
      saveConfig();
    }
    return libraryDir();
  });

  handle('offline:list', fromApp, () => {
    const cat = loadOfflineCatalog();
    return { ...cat, ...(cat.origin ? games.snapshot(cat.origin) : { installed: {}, jobs: {}, running: [] }) };
  });
  handle('offline:install', fromApp, (_e, id) => {
    const { cat, item } = offlineItem(id);
    return games.install(win.webContents.session, cat.origin, item.id, { title: item.title, version: item.version, launch: item.launch, directUrl: item.url });
  });
  handle('offline:play', fromApp, (_e, id) => games.play(loadOfflineCatalog().origin, gameId(id)));
  handle('offline:cancel', fromApp, (_e, id) => games.cancel(loadOfflineCatalog().origin, gameId(id)));
  handle('offline:folder', fromApp, (_e, id) => {
    const entry = games.entry(loadOfflineCatalog().origin, gameId(id));
    if (entry) shell.openPath(entry.dir);
  });

  handle('games:snapshot', fromServer, () => games.snapshot(currentOrigin));
  handle('games:install', fromServer, (e, id, meta) => games.install(e.sender.session, currentOrigin, gameId(id), meta || {}));
  handle('games:cancel', fromServer, (_e, id) => games.cancel(currentOrigin, gameId(id)));
  handle('games:play', fromServer, (_e, id) => games.play(currentOrigin, gameId(id)));
  handle('games:uninstall', fromServer, (_e, id) => games.uninstall(currentOrigin, gameId(id)));
  handle('games:ack-playtime', fromServer, (_e, id, minutes) => games.ackPlaytime(currentOrigin, gameId(id), Number(minutes) || 0));
  handle('games:open-folder', fromServer, (_e, id) => {
    const entry = games.entry(currentOrigin, gameId(id));
    if (entry) shell.openPath(entry.dir);
  });
  handle('games:choose-exe', fromServer, async (_e, id) => {
    const entry = games.entry(currentOrigin, gameId(id));
    if (!entry) throw new Error('Игра не установлена');
    const r = await dialog.showOpenDialog(win, {
      title: 'Файл запуска игры',
      defaultPath: entry.dir,
      properties: ['openFile'],
      filters: [{ name: 'Программы', extensions: ['exe', 'bat', 'cmd', 'lnk'] }],
    });
    if (!r.canceled && r.filePaths[0]) games.setExe(currentOrigin, gameId(id), r.filePaths[0]);
  });
  // Игры по внешней ссылке: узнаём адрес редиректа (с куками сессии) и открываем его в браузере.
  handle('games:open-external', fromServer, (e, id) => new Promise((resolve, reject) => {
    const req = net.request({
      url: `${currentOrigin}/api/games/${gameId(id)}/download`,
      session: e.sender.session,
      useSessionCookies: true,
      redirect: 'manual',
    });
    req.on('redirect', (_status, _method, url) => {
      req.abort();
      openExternal(url);
      resolve();
    });
    req.on('response', (res) => {
      req.abort();
      reject(new Error(res.statusCode === 401 ? 'Войдите в аккаунт' : 'Ссылка на игру недоступна'));
    });
    req.on('error', (err) => reject(err));
    req.end();
  }));
}

// ---------- Жизненный цикл ----------

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  stopServer();
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  loadConfig();
  Menu.setApplicationMenu(null);
  games = createGames({
    manifestFile: path.join(app.getPath('userData'), 'installed.json'),
    libraryDir,
    send,
    openExternal,
  });
  tunnel = createTunnel({
    binDir: path.join(app.getPath('userData'), 'bin'),
    logFile: path.join(app.getPath('userData'), 'tunnel.log'),
    send: (channel, data) => {
      send(channel, data);
      if (tray) ensureTray();
    },
  });
  registerIpc();
  createWindow();
  boot();
});
