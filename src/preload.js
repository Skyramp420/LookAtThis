const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state'),
  action: async (type, payload) => {
    const r = await ipcRenderer.invoke('action', { type, payload });
    if (!r.ok) throw new Error(r.error);
    return r.result;
  },
  on: (channel, cb) => {
    if (!['state', 'levels', 'event'].includes(channel)) return;
    ipcRenderer.on(channel, (e, data) => cb(data));
  },
  drag: file => ipcRenderer.send('drag', String(file)),
  // cesta k súboru pretiahnutému z Prieskumníka (import klipov)
  pathFor: f => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  log: (level, msg) => ipcRenderer.send('log', { level: ['info', 'warn', 'error'].includes(level) ? level : 'info', msg: String(msg) })
});
