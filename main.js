// بصمة IBRA — العملية الرئيسية
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, Notification, screen, shell, session, protocol, net, clipboard } = require('electron');
const { pathToFileURL } = require('url');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_ID = 'com.ibraprogram.attendance';
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, quitting = false;
const alertWins = new Set();
const DATA_DIR = () => app.getPath('userData');
const DB_FILE = () => path.join(DATA_DIR(), 'data.json');
const PHOTO_DIR = () => path.join(DATA_DIR(), 'photos');
const BACKUP_DIR = () => path.join(DATA_DIR(), 'backups');
const ICON = path.join(__dirname, 'app', 'icon.png');
const startHidden = process.argv.includes('--hidden');

function ensureDirs() {
  for (const d of [DATA_DIR(), PHOTO_DIR(), BACKUP_DIR()]) fs.mkdirSync(d, { recursive: true });
}

// ---------- قاعدة البيانات المحلية (ملف JSON مع كتابة آمنة) ----------
function readDB() {
  for (const f of [DB_FILE(), DB_FILE() + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* try next */ }
  }
  return null;
}
function writeDB(obj) {
  const tmp = DB_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  if (fs.existsSync(DB_FILE())) { try { fs.copyFileSync(DB_FILE(), DB_FILE() + '.bak'); } catch (e) {} }
  fs.renameSync(tmp, DB_FILE());
  dailyBackup();
}
function dailyBackup() {
  try {
    const d = new Date(); const name = `backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const target = path.join(BACKUP_DIR(), name);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(DB_FILE(), target);
      const files = fs.readdirSync(BACKUP_DIR()).filter(f => f.startsWith('backup-')).sort();
      while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR(), files.shift()));
    }
  } catch (e) {}
}

// ---------- النافذة الرئيسية ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 680,
    backgroundColor: '#0b0b0d', icon: ICON, show: false, autoHideMenuBar: true,
    title: 'بصمة IBRA',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenu(null);
  win.loadURL('app://ibra/index.html');
  win.once('ready-to-show', () => { if (!startHidden) { win.show(); win.focus(); } });
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); trayHint(); }
  });
}
let hinted = false;
function trayHint() {
  if (hinted || !Notification.isSupported()) return; hinted = true;
  new Notification({ title: 'بصمة IBRA', body: 'البرنامج يعمل بجانب الساعة. اضغط على الأيقونة لفتح شاشة البصمة.', icon: ICON }).show();
}
function showMain(route) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (route) win.webContents.send('navigate', route);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('بصمة IBRA — حضور وانصراف الموظفين');
  const menu = Menu.buildFromTemplate([
    { label: 'فتح شاشة البصمة', click: () => showMain('punch') },
    { label: 'التقارير 🔒', click: () => showMain('reports') },
    { label: 'الإعدادات 🔒', click: () => showMain('settings') },
    { type: 'separator' },
    { label: 'خروج من البرنامج 🔒', click: () => { showMain(); win.webContents.send('request-quit'); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMain('punch'));
}

// ---------- نافذة التنبيه الكبيرة ----------
function showAlert(opts) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(760, width - 40), h = 430;
  const a = new BrowserWindow({
    width: w, height: h, x: Math.round((width - w) / 2), y: Math.round((height - h) / 2),
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: false, show: false,
    backgroundColor: '#0b0b0d', icon: ICON, title: 'تنبيه — بصمة IBRA',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  a.setAlwaysOnTop(true, 'screen-saver');
  a.loadURL('app://ibra/alert.html?d=' + encodeURIComponent(Buffer.from(JSON.stringify(opts)).toString('base64')));
  a.once('ready-to-show', () => { a.show(); a.focus(); a.flashFrame(true); });
  alertWins.add(a);
  a.on('closed', () => alertWins.delete(a));
}

// ---------- IPC ----------
ipcMain.handle('db:load', () => readDB());
ipcMain.handle('db:save', (e, obj) => { writeDB(obj); return true; });
ipcMain.handle('photo:save', (e, id, dataUrl) => {
  const b64 = String(dataUrl).split(',')[1] || '';
  const file = path.join(PHOTO_DIR(), id.replace(/[^\w-]/g, '') + '.jpg');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return true;
});
ipcMain.handle('photo:get', (e, id) => {
  const file = path.join(PHOTO_DIR(), String(id).replace(/[^\w-]/g, '') + '.jpg');
  if (!fs.existsSync(file)) return null;
  return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
});
ipcMain.handle('photo:delete', (e, id) => {
  const file = path.join(PHOTO_DIR(), String(id).replace(/[^\w-]/g, '') + '.jpg');
  try { fs.unlinkSync(file); } catch (er) {}
  return true;
});
ipcMain.handle('hash', (e, text) => crypto.createHash('sha256').update('ibra-att::' + text).digest('hex'));
ipcMain.handle('alert:show', (e, opts) => { showAlert(opts); return true; });
ipcMain.handle('alert:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); return true; });
ipcMain.handle('alert:action', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close();
  if (action && action.startsWith('punch-out:')) { showMain(); win.webContents.send('quick-punch', { type: 'out', empId: action.slice(10) }); }
  return true;
});
ipcMain.handle('notify', (e, title, body) => {
  if (Notification.isSupported()) { const n = new Notification({ title, body, icon: ICON }); n.on('click', () => showMain('punch')); n.show(); }
  return true;
});
ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return true; });
ipcMain.handle('app:hide', () => { if (win) win.hide(); return true; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA_DIR(), autostart: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin }));
ipcMain.handle('app:autostart', (e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  return true;
});
ipcMain.handle('open:external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
ipcMain.handle('clipboard:write', (e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('qr:make', async (e, text) => require('qrcode').toDataURL(String(text), { errorCorrectionLevel: 'M', margin: 2, width: 420, color: { dark: '#000000', light: '#ffffff' } }));
ipcMain.handle('open:dataDir', () => { shell.openPath(DATA_DIR()); return true; });

// تصدير Excel
ipcMain.handle('excel:export', async (e, payload) => {
  const { filename, sheets } = payload;
  const res = await dialog.showSaveDialog(win, {
    title: 'حفظ التقرير', defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'بصمة IBRA';
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: (sh.title ? 2 : 0) + 1 }] });
    let r = 1;
    if (sh.title) {
      ws.mergeCells(1, 1, 1, sh.headers.length);
      const c = ws.getCell(1, 1); c.value = sh.title;
      c.font = { bold: true, size: 14, color: { argb: 'FFC9A84C' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 26; r = 3;
    }
    const hr = ws.getRow(r); hr.values = sh.headers;
    hr.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FF111111' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9A84C' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    hr.height = 22;
    for (const row0 of sh.rows) {
      const imgs = [];
      const row = row0.map((v, i) => { if (v && typeof v === 'object' && v.image) { imgs.push([i, v.image]); return ''; } return v; });
      const rr = ws.addRow(row);
      for (const [ci, data] of imgs) {
        const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(data); if (!m) continue;
        const id = wb.addImage({ base64: m[2], extension: m[1] === 'png' ? 'png' : 'jpeg' });
        ws.addImage(id, { tl: { col: ci + 0.1, row: rr.number - 1 + 0.08 }, ext: { width: 52, height: 52 } });
        rr.height = 44;
      }
      rr.eachCell({ includeEmpty: true }, c => {
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = { top: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } }, left: { style: 'thin', color: { argb: 'FFDDDDDD' } }, right: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
        if (typeof c.value === 'number' && Math.abs(c.value) >= 1000) c.numFmt = '#,##0';
      });
    }
    sh.headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(12, String(h).length + 6, ...(sh.widths ? [sh.widths[i] || 0] : [])); });
  }
  await wb.xlsx.writeFile(res.filePath);
  shell.showItemInFolder(res.filePath);
  return { ok: true, path: res.filePath };
});

// نسخ احتياطي يدوي واستيراد
ipcMain.handle('backup:export', async (e, obj) => {
  const d = new Date();
  const res = await dialog.showSaveDialog(win, { title: 'حفظ نسخة احتياطية', defaultPath: path.join(app.getPath('documents'), `بصمة-IBRA-نسخة-${d.toISOString().slice(0, 10)}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (res.canceled) return false;
  fs.writeFileSync(res.filePath, JSON.stringify(obj, null, 1)); return true;
});
ipcMain.handle('backup:import', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'استرجاع نسخة احتياطية', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  try { return JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')); } catch (er) { return { __error: true }; }
});

// ---------- التشغيل ----------
app.on('second-instance', () => showMain('punch'));
app.whenReady().then(() => {
  ensureDirs();
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const full = path.normalize(path.join(__dirname, 'app', rel));
    if (!full.startsWith(path.join(__dirname, 'app'))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'notifications'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'notifications'].includes(perm));
  // تشغيل تلقائي مع ويندوز بشكل افتراضي في أول تشغيل
  const flag = path.join(DATA_DIR(), '.autostart-set');
  if (!fs.existsSync(flag)) { app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); fs.writeFileSync(flag, '1'); }
  createWindow();
  createTray();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => { /* يبقى يعمل في شريط المهام */ });
