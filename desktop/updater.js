// Обновление самой программы HYTEAM из релизов GitHub (electron-updater).
// Новая версия скачивается в фоне; установка — по кнопке «Перезапустить» или при выходе из программы.
import { app } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

export function createUpdater({ send, notify }) {
  let state = { state: 'idle', version: null, percent: 0, error: null };
  const set = (patch) => {
    state = { ...state, ...patch };
    send('update:state', state);
  };

  // В режиме разработки (npm start) обновляться нечем — там нет установленной программы.
  if (!app.isPackaged) return { get: () => state, check: async () => state, install: () => {} };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => state.state !== 'ready' && set({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.floor(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version, percent: 100 });
    notify(`Обновление HYTEAM ${info.version} готово`, 'Нажмите «Перезапустить», чтобы установить его. Или оно установится само при выходе.');
  });
  autoUpdater.on('error', (err) => {
    if (state.state !== 'ready') set({ state: 'error', error: err?.message?.split('\n')[0] || 'Не удалось проверить обновления' });
  });

  async function check() {
    if (state.state === 'downloading' || state.state === 'ready') return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* ошибка уже пришла в событие error */
    }
    return state;
  }
  setTimeout(check, 15000);
  setInterval(check, 60 * 60e3);

  return {
    get: () => state,
    check,
    // Тихая установка поверх и автоматический запуск новой версии.
    install: () => state.state === 'ready' && autoUpdater.quitAndInstall(true, true),
  };
}
