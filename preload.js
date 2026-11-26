const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  loadDB: () => inv('db:load'),
  saveDB: (o) => inv('db:save', o),
  savePhoto: (id, d) => inv('photo:save', id, d),
  getPhoto: (id) => inv('photo:get', id),
  deletePhoto: (id) => inv('photo:delete', id),
  hash: (t) => inv('hash', t),
  showAlert: (o) => inv('alert:show', o),
  closeAlert: () => inv('alert:close'),
  alertAction: (a) => inv('alert:action', a),
  notify: (t, b) => inv('notify', t, b),
  quit: () => inv('app:quit'),
  hide: () => inv('app:hide'),
  info: () => inv('app:info'),
  setAutostart: (on) => inv('app:autostart', on),
  openExternal: (u) => inv('open:external', u),
  openDataDir: () => inv('open:dataDir'),
  makeQR: (t) => inv('qr:make', t),
  copy: (t) => inv('clipboard:write', t),
  exportExcel: (p) => inv('excel:export', p),
  exportBackup: (o) => inv('backup:export', o),
  importBackup: () => inv('backup:import'),
  on: (ch, fn) => { const ok = ['navigate', 'request-quit', 'quick-punch']; if (ok.includes(ch)) ipcRenderer.on(ch, (e, d) => fn(d)); }
});
