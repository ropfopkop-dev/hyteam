// Мост между страницей и приложением. Страница получает только этот узкий набор функций.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const subscribe = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('hyteam', {
  isDesktop: true,
  info: () => call('app:info'),
  connect: (url) => call('app:connect', String(url ?? '')),
  host: (opts) => call('app:host', { port: Number(opts?.port) || 0 }),
  changeServer: () => call('app:change-server'),
  chooseDataDir: () => call('app:choose-data-dir'),
  chooseLibraryDir: () => call('app:choose-library-dir'),
  copy: (text) => call('app:copy', String(text ?? '')),
  tunnelStart: () => call('tunnel:start'),
  tunnelStop: () => call('tunnel:stop'),
  onTunnelState: subscribe('tunnel:state'),

  games: () => call('games:snapshot'),
  install: (id, meta) => call('games:install', Number(id), {
    title: String(meta?.title ?? ''),
    version: String(meta?.version ?? ''),
    launch: String(meta?.launch ?? ''),
    versionId: Number(meta?.versionId) || 0,
    pinned: !!meta?.pinned,
  }),
  cancel: (id) => call('games:cancel', Number(id)),
  play: (id) => call('games:play', Number(id)),
  uninstall: (id) => call('games:uninstall', Number(id)),
  openFolder: (id) => call('games:open-folder', Number(id)),
  chooseExe: (id) => call('games:choose-exe', Number(id)),
  openExternalGame: (id) => call('games:open-external', Number(id)),
  ackPlaytime: (id, minutes) => call('games:ack-playtime', Number(id), Number(minutes)),

  offline: {
    list: () => call('offline:list'),
    install: (id) => call('offline:install', Number(id)),
    play: (id) => call('offline:play', Number(id)),
    cancel: (id) => call('offline:cancel', Number(id)),
    openFolder: (id) => call('offline:folder', Number(id)),
  },

  onGameState: subscribe('games:state'),
  onPlaytime: subscribe('games:playtime'),
  onWindowState: subscribe('window:state'),
});
