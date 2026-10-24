// Доступ к своему серверу из интернета через бесплатный туннель Cloudflare (trycloudflare.com).
// cloudflared.exe скачивается с официального GitHub Cloudflare при первом включении.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { net } from 'electron';

const DOWNLOAD_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const READY_RE = /Registered tunnel connection/i;

export function createTunnel({ binDir, logFile, send }) {
  const exe = path.join(binDir, 'cloudflared.exe');
  const writeLog = (text) => fs.appendFile(logFile, text, () => {});
  let proc = null;
  let state = { state: 'off', url: null, progress: 0, error: null };

  const set = (patch) => {
    state = { ...state, ...patch };
    send('tunnel:state', state);
  };

  async function download() {
    fs.mkdirSync(binDir, { recursive: true });
    set({ state: 'downloading', progress: 0, error: null });
    const res = await net.fetch(DOWNLOAD_URL);
    if (!res.ok) throw new Error(`Не удалось скачать cloudflared (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${exe}.part`;
    const out = fs.createWriteStream(tmp);
    let received = 0;
    let last = 0;
    try {
      for await (const chunk of res.body) {
        out.write(chunk);
        received += chunk.length;
        if (total && Date.now() - last > 300) {
          last = Date.now();
          set({ progress: received / total });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (received < 1024 * 1024) throw new Error('Скачанный cloudflared повреждён');
    fs.renameSync(tmp, exe);
  }

  async function start(port) {
    if (proc) return state;
    try {
      if (!fs.existsSync(exe)) await download();
    } catch (err) {
      set({ state: 'error', error: err.message || 'Не удалось скачать cloudflared' });
      throw err;
    }
    set({ state: 'starting', url: null, error: null });
    return new Promise((resolve, reject) => {
      let log = '';
      let url = null;
      let ready = false;
      // HTTP/2 поверх TCP 443: QUIC (UDP) до Cloudflare часто режут провайдеры, и туннель тогда отваливается.
      const child = spawn(exe, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${port}`], { windowsHide: true });
      proc = child;
      const mine = () => proc === child;
      const timer = setTimeout(() => {
        if (mine() && state.state === 'starting') fail('Туннель не запустился за 40 секунд. Проверьте интернет и попробуйте ещё раз.');
      }, 40000);
      function fail(message) {
        clearTimeout(timer);
        child.kill();
        proc = null;
        set({ state: 'error', url: null, error: message });
        reject(new Error(message));
      }
      writeLog(`\n=== ${new Date().toISOString()} start, port ${port}\n`);
      const onData = (chunk) => {
        writeLog(chunk.toString());
        log = (log + chunk.toString()).slice(-4000);
        url ??= log.match(URL_RE)?.[0] ?? null;
        ready ||= READY_RE.test(log);
        // Адрес печатается раньше, чем туннель реально подключится, — ждём регистрации соединения.
        if (url && ready && mine() && state.state === 'starting') {
          clearTimeout(timer);
          set({ state: 'on', url });
          resolve(state);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => mine() && fail(`Не удалось запустить cloudflared: ${err.message}`));
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        writeLog(`\n=== exit code=${code} signal=${signal}\n`);
        if (!mine()) return;
        if (state.state === 'starting') return fail('cloudflared завершился с ошибкой. Попробуйте ещё раз.');
        proc = null;
        set({ state: 'error', url: null, error: 'Туннель отключился. Включите доступ снова.' });
      });
    });
  }

  function stop() {
    if (proc) {
      const p = proc;
      proc = null;
      p.kill();
    }
    set({ state: 'off', url: null, error: null, progress: 0 });
  }

  return { start, stop, get: () => state, isOn: () => !!proc };
}
