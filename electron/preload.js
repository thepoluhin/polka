const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('shelf', {
  bootstrap: call('bootstrap'),
  pickFolder: call('pick-folder'),
  pickFile: call('pick-file'),
  saveQuotePng: call('save-quote-png'),
  scan: call('scan'),
  read: call('read'),
  bookHash: call('book-hash'),
  stat: call('stat'),
  initialFile: call('initial-file'),
  openExternal: call('open-external'),
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('fullscreen', !!on),
  onFullscreen: (cb) => ipcRenderer.on('fs-changed', (e, on) => cb(on)),
  setTheme: call('set-theme'),
  setReadingKeepAwake: call('reading-keep-awake'),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, p) => cb(p)),
  version: call('version'),
  padClipboardRead: call('pad-clipboard-read'),
  padClipboardWrite: call('pad-clipboard-write'),
  guideStat: call('guide-stat'),
  guideRead: call('guide-read'),
  initialUrl: call('initial-url'),
  onOpenUrl: (cb) => ipcRenderer.on('open-url', (e, u) => cb(u)),
  netGet: call('net-get'),
  netImage: call('net-image'),
  quotesDefaultDir: call('quotes-default-dir'),
  diaryDir: call('diary-dir'),
  noteCreate: call('note-create'),
  noteRead: call('note-read'),
  noteWrite: call('note-write'),
  noteDelete: call('note-delete'),
  noteResolve: call('note-resolve'),
  noteRmdir: call('note-rmdir'),
  dataRead: call('data-read'),
  dataWrite: call('data-write'),
  obsidianGraph: call('obsidian-graph'),
  // путь к перетащенному в окно файлу: только для настоящих файлов с диска — и сразу разрешаем его чтение
  pathOf: (file) => {
    let p = null;
    try { p = webUtils.getPathForFile(file); } catch (e) { p = null; }
    if (p) ipcRenderer.invoke('allow-dropped', p);
    return p || null;
  },
});
