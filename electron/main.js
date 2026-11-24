const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, screen } = require('electron');

// без стандартного меню Electron: его горячие клавиши (Ctrl+R, Ctrl+=, F11…) перехватывали наши
Menu.setApplicationMenu(null);
const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');

const BOOK_RE = /\.(fb2|epub|fb2\.zip)$/i;
const DEBUG = !!process.env.POLKA_DEBUG;
let win = null;
let quitting = false;

// путь из командной строки — относительно папки, откуда запущена программа (у второй копии — своя папка)
function fileFromArgs(argv, cwd) {
  const a = argv.slice(1).find((x) => !x.startsWith('-') && !/^polka:/i.test(x) && BOOK_RE.test(x) && fs.existsSync(path.resolve(cwd || process.cwd(), x)));
  return a ? path.resolve(cwd || process.cwd(), a) : null;
}
function urlFromArgs(argv) {
  return argv.find((a) => /^polka:/i.test(a)) || null;
}

// =====================================================================
//  Разрешённые места на диске.
//  Окно программы может читать и писать только там, куда пользователь сам
//  указал: папка книг, папка дневника, книги, открытые вручную. Даже если в окно
//  попадёт чужой код (например, из испорченной книги), остальной диск ему недоступен.
// =====================================================================
const allowedFile = () => path.join(app.getPath('userData'), 'allowed.json');
let allowed = { roots: [], files: [] };
let bootstrapOpen = false; // первый запуск новой версии: принять уже выбранные раньше папки
function loadAllowed() {
  try { allowed = Object.assign({ roots: [], files: [] }, JSON.parse(fs.readFileSync(allowedFile(), 'utf8'))); }
  catch (e) { bootstrapOpen = true; }
}
function saveAllowed() {
  try { fs.mkdirSync(path.dirname(allowedFile()), { recursive: true }); fs.writeFileSync(allowedFile(), JSON.stringify(allowed, null, 1)); } catch (e) { /* ок */ }
}
const norm = (p) => { const r = path.resolve(String(p || '')); return process.platform === 'win32' ? r.toLowerCase() : r; };
const under = (p, root) => { const a = norm(p), r = norm(root); return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep); };
function allowRoot(dir) { if (dir && !allowed.roots.some((r) => norm(r) === norm(dir))) { allowed.roots.push(path.resolve(dir)); saveAllowed(); } }
function allowFile(p) { if (p && !allowed.files.some((f) => norm(f) === norm(p))) { allowed.files.push(path.resolve(p)); allowed.files = allowed.files.slice(-500); saveAllowed(); } }
const inRoots = (p) => !!p && allowed.roots.some((r) => under(p, r));
const canRead = (p) => inRoots(p) || allowed.files.some((f) => norm(f) === norm(p));

// запросы принимаем только от нашего окна
const fromUs = (e) => { try { return !!win && e.sender === win.webContents && /^file:/.test(e.senderFrame.url); } catch (err) { return false; } };
function handle(ch, fn) {
  ipcMain.handle(ch, (e, ...args) => {
    if (!fromUs(e)) throw new Error('доступ запрещён');
    return fn(e, ...args);
  });
}

let pendingFile = fileFromArgs(process.argv);
let pendingUrl = urlFromArgs(process.argv);

// =====================================================================
//  Протокол polka:// (ссылки из файлов дневника).
//  Регистрирует установленная копия; другая (например, собранная для проверки) — только если установленной нет.
// =====================================================================
const MY_EXE = process.execPath;
try {
  if (process.defaultApp) app.setAsDefaultProtocolClient('polka', process.execPath, [path.resolve(process.argv[1] || '.')]);
  else {
    const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Polka', 'Polka.exe');
    if (process.platform !== 'win32' || norm(MY_EXE) === norm(installed) || !fs.existsSync(installed)) app.setAsDefaultProtocolClient('polka', MY_EXE, []);
  }
} catch (e) { /* не критично */ }

// =====================================================================
//  Одна копия программы; более новая версия, запущенная поверх, забирает управление
// =====================================================================
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
if (!app.requestSingleInstanceLock({ version: app.getVersion(), exe: MY_EXE, args: process.argv.slice(1).filter((a) => /^polka:/i.test(a) || BOOK_RE.test(a)) })) { app.quit(); }
app.on('second-instance', (e, argv, cwd, data) => {
  if (data && data.version && data.exe && newer(data.version, app.getVersion())) {
    // штатное закрытие (окно успеет сохранить место чтения), затем запуск новой версии
    app.relaunch({ execPath: data.exe, args: data.args || [] });
    quitting = true;
    if (win && !win.isDestroyed()) win.close(); else app.quit();
    return;
  }
  const f = fileFromArgs(argv, cwd);
  const u = urlFromArgs(argv);
  if (f) allowFile(f);
  if (win) {
    // Windows не даёт фоновому окну просто «украсть» фокус — поднимаем через «поверх всех»
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
    win.moveTop();
    setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 300);
    if (f) win.webContents.send('open-file', f);
    if (u) win.webContents.send('open-url', u);
  }
});

// =====================================================================
//  Окно
// =====================================================================
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; } }
function writeJsonAtomic(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
}

function createWindow() {
  const st = loadState();
  // окно на видимом экране (после отключения второго монитора — не «за краем»)
  let { x, y } = st;
  if (x != null && y != null) {
    const area = screen.getDisplayMatching({ x, y, width: st.width || 1280, height: st.height || 860 }).workArea;
    const visible = x < area.x + area.width - 80 && x + (st.width || 1280) > area.x + 80 && y >= area.y - 10 && y < area.y + area.height - 80;
    if (!visible) { x = undefined; y = undefined; }
  }
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 860, x, y,
    minWidth: 480, minHeight: 420,
    backgroundColor: st.bg || '#ffffff',
    title: 'Полка',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: DEBUG },
  });
  win.setMenuBarVisibility(false);
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const indexUrl = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
  win.loadFile(path.join(__dirname, 'index.html'));
  const save = () => {
    if (!win || win.isDestroyed()) return;
    try { writeJsonAtomic(stateFile(), Object.assign(loadState(), win.getNormalBounds(), { maximized: win.isMaximized() })); } catch (e) { /* ок */ }
  };
  win.on('close', save);
  win.on('closed', () => { win = null; });
  win.on('enter-full-screen', () => win.webContents.send('fs-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fs-changed', false));
  // никаких новых окон и переходов: внешние ссылки — в браузере, всё остальное запрещено
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] === indexUrl) return;
    e.preventDefault();
    if (/^https:/.test(url)) shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  if (DEBUG) win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools(); });
}

async function scanDir(dir) {
  const out = [];
  async function walk(d, depth) {
    let items;
    try { items = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) { if (depth < 12 && !it.name.startsWith('.')) await walk(p, depth + 1); }
      else if (BOOK_RE.test(it.name)) {
        try { const s = await fs.promises.stat(p); out.push({ path: p, name: it.name, size: s.size, mtime: s.mtimeMs }); } catch (e) { /* skip */ }
      }
    }
  }
  if (!dir || !fs.existsSync(dir)) return { missing: true, files: [] };
  await walk(dir, 0);
  return { files: out };
}

// первый запуск новой версии: разрешить папки, выбранные раньше (одноразово, до открытия любой книги)
handle('bootstrap', (e, { folder, quotesDir, extra } = {}) => {
  if (!bootstrapOpen) return false;
  bootstrapOpen = false;
  if (folder) allowRoot(folder);
  if (quotesDir) allowRoot(quotesDir);
  for (const f of extra || []) allowFile(f);
  saveAllowed();
  return true;
});
handle('pick-folder', async (e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Папка с книгами', properties: ['openDirectory'] });
  if (r.canceled) return null;
  allowRoot(r.filePaths[0]);
  return r.filePaths[0];
});
handle('pick-file', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Открыть книгу', properties: ['openFile'], filters: [{ name: 'Книги', extensions: ['fb2', 'epub', 'zip'] }] });
  if (r.canceled) return null;
  allowFile(r.filePaths[0]);
  return r.filePaths[0];
});
handle('allow-dropped', (e, p) => { if (p && BOOK_RE.test(p)) allowFile(p); });
handle('scan', (e, dir) => (inRoots(dir) ? scanDir(dir) : { missing: !fs.existsSync(String(dir || '')), files: [], denied: true }));
handle('read', (e, p) => { if (!canRead(p)) throw new Error('нет доступа к файлу'); return fs.promises.readFile(p); });
handle('book-hash', async (e, p) => {
  if (!canRead(p)) throw new Error('нет доступа к файлу');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(p)) hash.update(chunk);
  return hash.digest('hex');
});
handle('stat', async (e, p) => {
  if (!canRead(p)) return null;
  try { const s = await fs.promises.stat(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (err) { return null; }
});
handle('initial-file', () => { const f = pendingFile; pendingFile = null; if (f) allowFile(f); return f; });
handle('version', () => app.getVersion());
// встроенная книга-путеводитель (лежит рядом с программой)
const guideFile = () => path.join(__dirname, 'guide.fb2');
handle('guide-stat', async () => { try { const s = await fs.promises.stat(guideFile()); return { size: s.size }; } catch (err) { return null; } });
handle('guide-read', () => fs.promises.readFile(guideFile()));
handle('initial-url', () => { const u = pendingUrl; pendingUrl = null; return u; });
handle('open-external', (e, url) => { if (/^https:/.test(String(url))) shell.openExternal(url); });

// ---------- сеть: только переводчик и Википедия/Викисловарь ----------
const NET_OK = /^https:\/\/(translate\.googleapis\.com|[a-z-]+\.(wikipedia|wiktionary)\.org)\//;
// картинки статей Википедии — только с её файлового сервера
const IMG_OK = /^https:\/\/upload\.wikimedia\.org\//;
const IMG_TYPES = /^image\/(jpeg|png|gif|webp)$/;
const IMG_MAX = 3 * 1024 * 1024;
const NET_TIMEOUT = 12000;
// Викимедиа требует понятный User-Agent (без него или с «безымянным» отвечает 403)
const NET_UA = () => 'PolkaReader/' + app.getVersion() + ' (personal offline e-book reader for Windows; Electron)';
handle('net-get', async (e, url) => {
  if (typeof url !== 'string' || !NET_OK.test(url)) return { ok: false, status: 0, text: '' };
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': NET_UA(), 'Accept': 'application/json' }, signal: AbortSignal.timeout(NET_TIMEOUT) });
    // после перенаправления — тоже только разрешённые адреса
    if (r.url && !NET_OK.test(r.url)) return { ok: false, status: 0, text: '' };
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (err) {
    const timeout = !!err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, timeout, text: String(err && err.message || err) };
  }
});
// картинка → data: URL (окно само в сеть за картинками не ходит: так не мешают ни CSP,
// ни прокси, ни требования Викимедиа к User-Agent и Referer)
handle('net-image', async (e, url) => {
  if (typeof url !== 'string' || !IMG_OK.test(url)) return null;
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': NET_UA(), 'Accept': 'image/webp,image/png,image/jpeg,image/gif;q=0.9' }, signal: AbortSignal.timeout(NET_TIMEOUT) });
    if (!r.ok || (r.url && !IMG_OK.test(r.url))) return null;
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMG_TYPES.test(type) || Number(r.headers.get('content-length') || 0) > IMG_MAX) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > IMG_MAX) return null;
    return 'data:' + type + ';base64,' + buf.toString('base64');
  } catch (err) { return null; }
});

// ---------- читательский дневник (Obsidian) ----------
// имя файла: без запрещённых символов, без «..» и без зарезервированных имён Windows (CON, NUL…)
const safeName = (s) => {
  let n = String(s).replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n += '_';
  return n || 'Без названия';
};
const diaryPath = (dir, sub, name) => path.join(dir, ...(sub || []).map(safeName), ...(name != null ? [safeName(name) + '.md'] : []));
handle('quotes-default-dir', (e, booksDir) => (booksDir && inRoots(booksDir) ? path.join(booksDir, 'Читательский дневник') : null));
// папка дневника рядом с книгами; старая «Цитаты» переименовывается (если Windows позволит)
handle('diary-dir', async (e, booksDir) => {
  if (!inRoots(booksDir)) return { dir: null };
  const dir = path.join(booksDir, 'Читательский дневник'), old = path.join(booksDir, 'Цитаты');
  if (fs.existsSync(dir) || !fs.existsSync(old)) return { dir };
  try { await fs.promises.rename(old, dir); return { dir, renamed: true, old }; }
  catch (err) { return { dir: old, kept: true }; }
});
// атомарная запись: во временный файл, затем переименование — файл не останется «наполовину»
// у каждой записи свой временный файл: две одновременные записи одного файла не смешиваются
let tmpSeq = 0;
async function writeAtomic(p, content) {
  const tmp = p + '.' + process.pid + '-' + (++tmpSeq) + '.polka-tmp';
  try {
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, p);
  } catch (err) { fs.promises.unlink(tmp).catch(() => {}); throw err; }
}
// создаёт файл; если имя занято — добавляет (2), (3)…; возвращает полный путь
handle('note-create', async (e, { dir, sub, name, content, onlyIfMissing }) => {
  if (!inRoots(dir)) throw new Error('папка дневника не разрешена');
  const folder = diaryPath(dir, sub);
  await fs.promises.mkdir(folder, { recursive: true });
  const base = safeName(name);
  let p = path.join(folder, base + '.md');
  if (onlyIfMissing) {
    try { await fs.promises.writeFile(p, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
    return p;
  }
  for (let i = 2; fs.existsSync(p); i++) p = path.join(folder, base + ' (' + i + ').md');
  await writeAtomic(p, content);
  return p;
});
handle('note-resolve', (e, { dir, sub, name }) => diaryPath(dir, sub, name));
handle('note-rmdir', async (e, { dir, sub }) => {
  if (!sub || !sub.length) return false;
  const d = diaryPath(dir, sub);
  if (!inRoots(dir) || !inRoots(d)) return false;
  try { await fs.promises.rmdir(d); return true; } catch (err) { return false; }
});
const mdOk = (p) => /\.md$/i.test(String(p)) && inRoots(p);
handle('note-read', async (e, p) => {
  if (!mdOk(p)) throw new Error('файл вне дневника');
  try { return (await fs.promises.readFile(p, 'utf8')).replace(/\r\n/g, '\n'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
});
handle('note-write', async (e, p, content) => { if (!mdOk(p)) throw new Error('файл вне дневника'); await writeAtomic(p, content); return true; });
handle('note-delete', async (e, p) => { if (!mdOk(p)) return false; try { await fs.promises.unlink(p); return true; } catch (err) { return false; } });
// служебный файл «Полки» в папке дневника (.polka/…json): место чтения, закладки, копия записей
const dataPath = (dir, name) => (inRoots(dir) && /^[a-z0-9-]+\.json$/.test(name) ? path.join(dir, '.polka', name) : null);
handle('data-read', async (e, dir, name) => { const p = dataPath(dir, name); if (!p) return null; try { return await fs.promises.readFile(p, 'utf8'); } catch (err) { return null; } });
handle('data-write', async (e, dir, name, content) => {
  const p = dataPath(dir, name);
  if (!p) throw new Error('файл вне дневника');
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await writeAtomic(p, content);
  return true;
});
// граф Obsidian: включить показ тегов и раскрасить «Авторы»/«Книги» в хранилище, где лежит дневник
handle('obsidian-graph', async (e, dir, done) => {
  if (!inRoots(dir)) return { vault: null };
  let d = dir;
  for (let i = 0; i < 6 && d; i++) {
    if (fs.existsSync(path.join(d, '.obsidian'))) break;
    const up = path.dirname(d); d = up === d ? null : up;
  }
  if (!d || !fs.existsSync(path.join(d, '.obsidian'))) return { vault: null };
  if ((done || []).includes(d)) return { vault: d, stuck: true };
  const gp = path.join(d, '.obsidian', 'graph.json');
  let g = {};
  if (fs.existsSync(gp)) {
    // файл есть, но не читается (Obsidian как раз пишет его) — не трогаем, попробуем в другой раз
    try { g = JSON.parse(fs.readFileSync(gp, 'utf8')); } catch (err) { return { vault: d, stuck: false }; }
  }
  const stuck = g.showTags === true && Array.isArray(g.colorGroups) && g.colorGroups.some((c) => /path:Книги/.test(c.query));
  if (!stuck) {
    g.showTags = true;
    const groups = Array.isArray(g.colorGroups) ? g.colorGroups.filter((c) => !/path:(Книги|Авторы)/.test(c.query)) : [];
    g.colorGroups = [{ query: 'path:Авторы', color: { a: 1, rgb: 0xE8603C } }, { query: 'path:Книги', color: { a: 1, rgb: 0x4A7FC4 } }].concat(groups);
    await writeAtomic(gp, JSON.stringify(g, null, 2));
  }
  return { vault: d, stuck };
});
handle('fullscreen', (e, on) => { if (!win) return false; win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on); return win.isFullScreen(); });
handle('set-theme', (e, bg) => {
  if (!win || !/^#[0-9a-f]{6}$/i.test(String(bg))) return;
  win.setBackgroundColor(bg);
  try { const st = loadState(); st.bg = bg; writeJsonAtomic(stateFile(), st); } catch (err) { /* ok */ }
});

app.whenReady().then(() => { loadAllowed(); if (pendingFile) allowFile(pendingFile); createWindow(); });
app.on('window-all-closed', () => app.quit());
