/* Полка — домашняя читалка FB2/EPUB */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = BookParser.esc;
  const { BOOK_SEC, PAD_SEC, PAD_END, bookThoughtsRange, padRange, sectionStart } = DiaryMarkdown;
  const BUILD_DATE = '__BUILD_DATE__';
  const native = window.shelf || null;
  const LS = {
    mem: {},
    cached: new Set(['quotes', 'notes']),
    // испорченные элементы внутри списков (null, числа) — отбрасываем, а не падаем на них
    clean: (() => {
      const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
      const lists = (o) => { if (!obj(o)) return null; for (const k of Object.keys(o)) { if (Array.isArray(o[k])) o[k] = o[k].filter(obj); else delete o[k]; } return o; };
      const records = (o, valid) => { for (const k of Object.keys(o)) if (!valid(o[k])) delete o[k]; return o; };
      return { quotes: lists, notes: lists, bookmarks: lists,
        progress: (o) => records(o, obj),
        pads: (o) => records(o, (x) => obj(x) && Array.isArray(x.pages) && x.pages.length > 0 && x.pages.every((pg) => typeof pg === 'string')),
        shelves: (l) => l.filter((x) => obj(x) && typeof x.id === 'string' && Array.isArray(x.books)).map((x) => (typeof x.name === 'string' ? x : Object.assign(x, { name: String(x.name == null ? 'Полка' : x.name) }))) };
    })(),
    get(k, d) {
      if (k in this.mem) return this.mem[k] == null ? d : this.mem[k];
      let v;
      try { const raw = localStorage.getItem('polka.' + k); v = raw == null ? null : JSON.parse(raw); } catch (e) { v = null; }
      // испорченное значение другого типа (число вместо списка и т.п.) — как будто его нет
      if (v != null && d != null && (typeof v !== typeof d || Array.isArray(v) !== Array.isArray(d))) v = null;
      if (v != null && this.clean[k]) { try { v = this.clean[k](v); } catch (e) { v = null; } }
      if (this.cached.has(k)) this.mem[k] = v;
      return v == null ? d : v;
    },
    set(k, v) {
      if (this.cached.has(k)) this.mem[k] = v;
      try { localStorage.setItem('polka.' + k, JSON.stringify(v)); return true; }
      catch (e) {
        console.error(e);
        if (!LS.warned) { LS.warned = true; setTimeout(() => { LS.warned = false; }, 15000); try { window.__toast && window.__toast('Не удалось сохранить данные программы: ' + (e.name === 'QuotaExceededError' ? 'хранилище переполнено' : e.message), 6000); } catch (x) { /* ок */ } }
        return false;
      }
    },
  };
  let idSequence = 0;
  const newId = (prefix) => {
    const sequence = (idSequence++).toString(36).padStart(6, '0');
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, '0');
    return prefix + Date.now().toString(36) + sequence + random;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; };

  // ============================================================
  //                      Хранилище (IndexedDB)
  // ============================================================
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('polka', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('meta', { keyPath: 'id' });
          r.result.createObjectStore('kv');
        };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    },
    get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
    put(store, val, key) { return this.tx(store, 'readwrite', (s) => key === undefined ? s.put(val) : s.put(val, key)); },
    del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
    all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
  };

  // ============================================================
  //                         Настройки
  // ============================================================
  const THEMES = [
    { id: 'light', name: 'Белая', bg: '#ffffff', fg: '#1d1d1f' },
    { id: 'sepia', name: 'Сепия', bg: '#f7f0e3', fg: '#3a2e22' },
    { id: 'dusk', name: 'Сумерки', bg: '#3b3b3e', fg: '#e4e2de' },
    { id: 'night', name: 'Ночь', bg: '#1b1b1d', fg: '#cfcac2' },
    { id: 'black', name: 'Чёрная', bg: '#000000', fg: '#a9a59e' },
  ];
  const FONTS = [
    { id: 'Literata', name: 'Literata' },
    { id: 'PT Serif', name: 'PT Serif' },
    { id: 'Lora', name: 'Lora' },
    { id: 'IBM Plex Serif', name: 'Plex Serif' },
    { id: 'Georgia', name: 'Georgia' },
    { id: 'Palatino Linotype', name: 'Palatino' },
    { id: 'PT Sans', name: 'PT Sans' },
    { id: 'Segoe UI', name: 'Segoe UI' },
  ];
  const S = Object.assign({
    theme: 'light', font: 'Literata', size: 20, lh: 1.55, width: 680, cols: 'auto',
    justify: true, hyph: true, anim: true, sort: 'recent', focus: 'off', typo: true, remember: true, keepAwake: false,
  }, LS.get('settings', {}));
  // испорченные настройки: неизвестная тема и нечисловые размеры — значения по умолчанию
  if (!THEMES.some((t) => t.id === S.theme)) S.theme = 'light';
  for (const [k, d] of [['size', 20], ['lh', 1.55], ['width', 680]]) if (typeof S[k] !== 'number' || !isFinite(S[k])) S[k] = d;
  if (S.focus === 'shade') S.focus = 'sheet'; // «Полутень» 1.9.0 стала «Листом»
  if (!S.flip) S.flip = S.anim === false ? 'off' : 'turn'; // листание: off | slide | turn | curl
  S.anim = S.flip !== 'off';
  if (!S.sound) S.sound = 'soft'; // звук листания: off | soft | loud
  if (!S.auto) S.auto = 'off'; // автопрокрутка: off | слов в минуту
  if (!S.setTab) S.setTab = 'text';
  const saveSettings = () => LS.set('settings', S);

  function applyTheme() {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.classList.toggle('typo', S.typo !== false);
    const r = document.documentElement.style;
    r.setProperty('--book-font', '"' + S.font + '"');
    r.setProperty('--book-size', S.size + 'px');
    r.setProperty('--book-lh', S.lh);
    r.setProperty('--book-align', S.justify ? 'justify' : 'left');
    r.setProperty('--book-hyph', S.hyph ? 'manual' : 'none');
    if (native && native.setTheme) native.setTheme(THEMES.find((t) => t.id === S.theme).bg);
  }
  applyTheme();

  // ============================================================
  //                       Источник книг
  // ============================================================
  const BOOK_RE = /\.(fb2|epub|fb2\.zip)$/i;
  const GUIDE_ID = 'polka-guide', GUIDE_NAME = 'Полка — как здесь всё устроено.fb2';
  const Src = {
    kind: native ? 'native' : ('showDirectoryPicker' in window ? 'fsa' : 'input'),
    handle: null, // FSA
    files: null,  // input
    folderName() {
      if (this.kind === 'native') { const p = LS.get('folder', ''); return p ? p.split(/[\\/]/).filter(Boolean).pop() : ''; }
      if (this.kind === 'fsa') return this.handle ? this.handle.name : '';
      return this.files ? 'выбранная папка' : '';
    },
    async restore() {
      if (this.kind === 'native') {
        // первый запуск 1.8: сообщить программе уже выбранные раньше папки (дальше доступ только к ним)
        if (native.bootstrap) { try { await native.bootstrap({ folder: LS.get('folder', ''), quotesDir: S.quotesDir || '', extra: LS.get('extra', []) }); } catch (e) { /* ок */ } }
        return LS.get('folder', '') ? 'ok' : 'none';
      }
      if (this.kind === 'fsa') {
        try { this.handle = await DB.get('kv', 'dir'); } catch (e) { this.handle = null; }
        if (!this.handle) return 'none';
        const p = await this.handle.queryPermission({ mode: 'read' });
        return p === 'granted' ? 'ok' : 'need-permission';
      }
      return 'none';
    },
    async reconnect() {
      const p = await this.handle.requestPermission({ mode: 'read' });
      return p === 'granted';
    },
    async pick() {
      if (this.kind === 'native') {
        const p = await native.pickFolder();
        if (!p) return false;
        LS.set('folder', p); return true;
      }
      if (this.kind === 'fsa') {
        try {
          const h = await window.showDirectoryPicker({ id: 'polka-books', mode: 'read' });
          this.handle = h; await DB.put('kv', h, 'dir'); return true;
        } catch (e) { return false; }
      }
      return new Promise((res) => {
        const inp = $('dir-input');
        inp.onchange = () => { this.files = Array.from(inp.files); res(this.files.length > 0); inp.value = ''; };
        inp.click();
      });
    },
    async list() {
      let out = [];
      if (this.kind === 'native') {
        const res = await native.scan(LS.get('folder', ''));
        const files = Array.isArray(res) ? res : (res.files || []);
        this.missing = !Array.isArray(res) && (res.missing || res.denied);
        out = files.map((f) => ({ name: f.name, size: f.size, mtime: f.mtime, path: f.path }));
      } else if (this.kind === 'fsa' && this.handle) {
        const walk = async (dir, depth) => {
          for await (const h of dir.values()) {
            if (h.kind === 'directory' && depth < 12) await walk(h, depth + 1);
            else if (h.kind === 'file' && BOOK_RE.test(h.name)) {
              const f = await h.getFile();
              out.push({ name: h.name, size: f.size, mtime: f.lastModified, handle: h });
            }
          }
        };
        await walk(this.handle, 0);
      } else if (this.files) {
        out = this.files.filter((f) => BOOK_RE.test(f.name)).map((f) => ({ name: f.name, size: f.size, mtime: f.lastModified, file: f }));
      }
      // книги, открытые вручную (только в приложении)
      if (native) {
        for (const p of LS.get('extra', [])) {
          if (out.some((o) => o.path === p)) continue;
          const st = await native.stat(p);
          if (st) out.push({ name: st.name, size: st.size, mtime: st.mtime, path: p, extra: true });
        }
      }
      // встроенная книга-путеводитель: не файл в папке, а часть программы (можно убрать с полки)
      if (native && native.guideStat && !this.missing && LS.get('folder', '') && !LS.get('guideHidden', false)) {
        const st = await native.guideStat().catch(() => null);
        if (st && st.size) out.push({ name: GUIDE_NAME, size: st.size, mtime: Date.now(), builtin: true });
      }
      const cache = new Map(await DB.get('kv', 'bookHashes').catch(() => null) || []);
      for (const e of out) {
        try { await identifyBook(e, cache); }
        catch (err) { console.warn(e.name, err); }
      }
      const paths = new Set(out.filter((e) => e.path).map((e) => e.path));
      if (!this.missing && paths.size) {
        DB.put('kv', Array.from(cache).filter(([p]) => paths.has(p)), 'bookHashes').catch(console.warn);
      }
      migrateBookKeys(out);
      return [...new Map(out.filter((e) => e.id).map((e) => [e.id, e])).values()];
    },
    async read(e) {
      if (e.bytes) return e.bytes;
      if (e.builtin) return new Uint8Array(await native.guideRead());
      if (e.path) return new Uint8Array(await native.read(e.path));
      const f = e.file || await e.handle.getFile();
      return new Uint8Array(await f.arrayBuffer());
    },
  };

  const legacyBookKey = (e) => e.name + '|' + e.size;
  async function identifyBook(e, cache = new Map()) {
    if (e.builtin) { e.id = GUIDE_ID; return; }
    const cached = e.path && cache.get(e.path);
    let hash;
    if (cached && cached.size === e.size && cached.mtime === e.mtime) hash = cached.hash;
    else {
      if (e.path && native.bookHash) hash = await native.bookHash(e.path);
      else {
        const digest = await crypto.subtle.digest('SHA-256', await Src.read(e));
        hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      }
      if (e.path) cache.set(e.path, { size: e.size, mtime: e.mtime, hash });
    }
    e.id = 'sha256-' + hash;
  }

  function migrateBookKeys(entries) {
    const aliases = LS.get('bookAliases', {});
    const groups = new Map();
    for (const e of entries) {
      if (e.builtin) continue;
      const key = legacyBookKey(e);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(e.id || null);
    }
    for (const [key, ids] of groups) {
      if (ids.has(null)) continue;
      const id = ids.values().next().value;
      aliases[key] = ids.size === 1 && (!Object.hasOwn(aliases, key) || aliases[key] === id) ? id : null;
    }
    LS.set('bookAliases', aliases);
    for (const store of ['progress', 'bookmarks', 'bookmarksT', 'quotes', 'notes', 'bookNotes', 'pads', 'padOptions', 'notePaths']) {
      const records = LS.get(store, {});
      let changed = false;
      for (const key of Object.keys(records)) {
      const id = Object.hasOwn(aliases, key) && aliases[key];
        if (!id) continue;
        if (Object.hasOwn(records, id)) continue;
        records[id] = records[key];
        delete records[key];
        changed = true;
      }
      if (changed) LS.set(store, records);
    }
    const list = shelves();
    let changed = false;
    for (const shelf of list) {
      if (!Array.isArray(shelf.books) || !shelf.books.some((id) => aliases[id])) continue;
      shelf.books = [...new Set(shelf.books.map((id) => aliases[id] || id))];
      changed = true;
    }
    if (changed) saveShelves(list);
  }

  async function identifyOpenedBook(e) {
    try { await identifyBook(e); }
    catch (err) { console.warn(err); toast('Не удалось прочитать файл книги'); return false; }
    migrateBookKeys([...L.entries, e]);
    return true;
  }

  // ============================================================
  //                          Библиотека
  // ============================================================
  const L = { entries: [], metas: {}, scanning: false, query: '' };
  const progress = () => LS.get('progress', {});

  const PALETTE = [
    ['#e8603c', '#b8432a'], ['#3d6e94', '#244a68'], ['#5d8a58', '#3b6138'], ['#8e5a9b', '#5f3a6b'],
    ['#c79a3b', '#946f22'], ['#2f7f7a', '#1d5653'], ['#a8455a', '#76293a'], ['#56607a', '#353c50'],
    ['#b5734a', '#82502f'], ['#4d7fbf', '#30598f'],
  ];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  function coverHtml(meta, name, stk) {
    stk = stk || '';
    if (meta && meta.cover) {
      // обложка в своих настоящих пропорциях: узкая — ниже и уже, широкая — ниже; стоит «на полке» по нижнему краю
      const r = meta.ratio ? Math.max(0.45, Math.min(1, meta.ratio)) : 2 / 3;
      return '<div class="cover cover-img"><span class="ci" data-mid="' + esc(meta.id || '') + '" data-fit="' + (r < 2 / 3 ? 'tall' : 'wide') + '" style="aspect-ratio:' + r.toFixed(3) + '">' + stk + '<img src="' + meta.cover + '" alt="" loading="lazy" decoding="async"></span></div>';
    }
    const title = (meta && meta.title) || name.replace(BOOK_RE, '');
    const author = meta && meta.authors && meta.authors[0] || '';
    const [a, b] = PALETTE[hash(title) % PALETTE.length];
    return '<div class="cover' + (stk ? ' has-stk' : '') + '">' + stk + '<div class="gen-cover" style="background:linear-gradient(155deg,' + a + ',' + b + ')">' +
      '<div class="gc-author">' + esc(author) + '</div><div class="gc-title">' + esc(title) + '</div><div class="gc-rule"></div></div></div>';
  }

  // пропорции обложки узнаём, когда картинка загрузилась, и запоминаем
  document.addEventListener('load', (ev) => {
    const img = ev.target;
    if (!img || img.localName !== 'img' || !img.parentNode || !img.parentNode.classList || !img.parentNode.classList.contains('ci')) return;
    const ci = img.parentNode, r = img.naturalWidth / img.naturalHeight;
    if (!r || !isFinite(r)) return;
    const rr = Math.max(0.45, Math.min(1, r));
    ci.style.aspectRatio = rr.toFixed(3); ci.dataset.fit = rr < 2 / 3 ? 'tall' : 'wide';
    const m = L.metas[ci.dataset.mid];
    if (m && Math.abs((m.ratio || 0) - r) > 0.005) { m.ratio = r; DB.put('meta', m).catch(() => {}); }
  }, true);

  // средний цвет картинки — для корешка книги на полке (чуть темнее, чтобы светлые обложки не терялись)
  function avgColor(source, w, h) {
    try {
      const c = document.createElement('canvas'); c.width = 6; c.height = 9;
      const x = c.getContext('2d'); x.drawImage(source, 0, 0, w, h, 0, 0, 6, 9);
      const d = x.getImageData(0, 0, 6, 9).data; let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4, k = 0.82;
      return '#' + [r, g, b].map((v) => Math.round(v / n * k).toString(16).padStart(2, '0')).join('');
    } catch (e) { return null; }
  }
  function colorOfDataUrl(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(avgColor(i, i.naturalWidth, i.naturalHeight)); i.onerror = () => res(null); i.src = src; });
  }
  const genColor = (title) => PALETTE[hash(title) % PALETTE.length][1];
  const htmlToText = (html, max) => { const d = document.createElement('template'); d.innerHTML = String(html || ''); return (d.content.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max || 700); };
  // описание и цвет корешка (версия метаданных 2)
  async function metaExtras(m, raw, bytes, e) {
    m.annot = htmlToText(raw.annotation, 700);
    m.open = m.annot ? '' : BookParser.opening(e.name, bytes);
    m.color = (m.cover && await colorOfDataUrl(m.cover)) || genColor(m.title || e.name);
    m.mv = 2;
  }

  async function makeThumb(bytes, type) {
    try {
      const blob = new Blob([bytes], { type: type || 'image/jpeg' });
      let img;
      try { img = await createImageBitmap(blob); }
      catch (e) {
        img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
      }
      const w = 320, h = Math.round(img.height * w / img.width);
      if (!h || h > 2000) return null;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      if (img.close) img.close(); else URL.revokeObjectURL(img.src); // память картинки — сразу, не ждать сборщика
      return c.toDataURL('image/jpeg', 0.86);
    } catch (e) { return null; }
  }

  async function ensureMeta(e) {
    if (L.metas[e.id]) return L.metas[e.id];
    let m;
    try {
      const bytes = await Src.read(e);
      const raw = BookParser.meta(e.name, bytes);
      m = { id: e.id, title: raw.title, authors: raw.authors, series: raw.series, format: raw.format, lang: raw.lang,
        cover: raw.coverBytes ? await makeThumb(raw.coverBytes, raw.coverType) : null, added: Date.now() };
      if (e.builtin) m.gsize = e.size;
      await metaExtras(m, raw, bytes, e);
    } catch (err) {
      console.warn('meta', e.name, err);
      m = { id: e.id, title: e.name.replace(BOOK_RE, ''), authors: [], format: /epub$/i.test(e.name) ? 'epub' : 'fb2', cover: null, broken: true, added: Date.now(), mv: 2 };
      m.color = genColor(m.title);
    }
    L.metas[e.id] = m;
    DB.put('meta', m).catch(() => {});
    return m;
  }

  async function loadLibrary() {
    const state = await Src.restore();
    $('folder-name').textContent = Src.folderName() || 'Выбрать папку';
    if (state === 'none') { renderLibrary(); return; }
    if (state === 'need-permission') {
      $('reconnect-name').textContent = '«' + Src.folderName() + '»';
      showOnly('reconnect');
      return;
    }
    // место чтения и закладки из дневника (свежее — например, с другого компьютера через OneDrive)
    if (window.__loadState) { try { await window.__loadState(); } catch (e) { console.warn(e); } }
    await scan();
  }

  async function scan(quiet) {
    if (L.scanning) return;
    L.scanning = true; L.lastScan = Date.now();
    const st = $('scan-status');
    const before = new Set(L.entries.map((e) => e.id));
    if (!quiet) { st.hidden = false; st.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Ищу книги…'; }
    try {
      // сведения о книгах из базы читаем один раз за запуск (дальше L.metas — их точная копия),
      // и параллельно с обходом папки: на 1000+ книг с обложками это заметные доли секунды
      const [metas, list] = await Promise.all([L.metasLoaded ? null : DB.all('meta').catch(() => null), Src.list()]);
      if (metas) { for (const m of metas) if (!L.metas[m.id]) L.metas[m.id] = m; L.metasLoaded = true; }
      L.entries = list;
      // путеводитель обновляется вместе с программой — обложку и название перечитываем
      const g = L.entries.find((e) => e.builtin);
      if (g && L.metas[GUIDE_ID] && L.metas[GUIDE_ID].gsize !== g.size) delete L.metas[GUIDE_ID];
      if (Src.missing) {
        // папки нет (отключён диск, флешка, сеть) — не путаем это с «новой установкой»
        L.scanning = false; st.hidden = true;
        showFolderMissing();
        return;
      }
      renderLibrary();
      const todo = L.entries.filter((e) => !L.metas[e.id]);
      let done = 0, last = Date.now();
      for (const e of todo) {
        st.innerHTML = 'Добавляю книги: ' + (done + 1) + ' из ' + todo.length + ' <div class="bar"><i style="width:' + Math.round(done / todo.length * 100) + '%"></i></div>';
        await ensureMeta(e);
        done++;
        if (Date.now() - last > 700) { renderLibrary(); last = Date.now(); await sleep(0); }
      }
    } catch (err) {
      console.error(err);
      toast('Не удалось прочитать папку: ' + (err.message || err));
    }
    st.hidden = true;
    L.scanning = false;
    renderLibrary();
    upgradeMetas();
    if (quiet && before.size) { const n = L.entries.filter((e) => !before.has(e.id) && !e.builtin).length; if (n) toast('В папке ' + plural(n, 'появилась', 'появились', 'появилось') + ' ' + n + ' ' + plural(n, 'новая книга', 'новые книги', 'новых книг')); }
  }
  // книги, добавленные до 1.13: тихо дочитываем описание и цвет корешка
  let upgrading = false;
  async function upgradeMetas() {
    if (upgrading) return; upgrading = true;
    let last = Date.now(), n = 0;
    try {
      for (const e of L.entries.slice()) {
        const m = L.metas[e.id];
        if (!m || (m.mv || 0) >= 2) continue;
        if (m.broken) { m.mv = 2; m.color = genColor(m.title || e.name); DB.put('meta', m).catch(() => {}); continue; }
        try { const bytes = await Src.read(e); await metaExtras(m, BookParser.meta(e.name, bytes), bytes, e); }
        catch (err) { m.mv = 2; m.color = m.color || genColor(m.title || e.name); }
        DB.put('meta', m).catch(() => {}); n++;
        if (Date.now() - last > 1500) { if (reader.hidden) renderLibrary(); last = Date.now(); }
        await sleep(0);
      }
    } finally { upgrading = false; }
    if (n && reader.hidden) renderLibrary();
  }
  window.__upgradeMetas = upgradeMetas;
  // папку пересматриваем сами: при возвращении в окно и при выходе из книги
  const quietRescan = (minAge) => { if (Src.kind === 'native' && Src.folderName() && !L.scanning && !Src.missing && Date.now() - (L.lastScan || 0) > minAge) scan(true); };
  window.addEventListener('focus', () => { if (reader.hidden) quietRescan(10000); });

  function showFolderMissing() {
    showOnly('reconnect');
    document.querySelector('#reconnect h1').textContent = 'Папка с книгами недоступна';
    document.querySelector('#reconnect p').innerHTML = 'Не получается открыть <b>' + esc(LS.get('folder', '')) + '</b>.<br>Возможно, отключён диск, флешка или сетевая папка.';
    $('btn-reconnect').textContent = 'Повторить';
  }
  function showOnly(which) {
    for (const id of ['empty', 'reconnect', 'shelves', 'remember', 'notebook', 'pads']) $(id).hidden = true;
    if (which) $(which).hidden = false;
  }

  function bookInfo(e) {
    const m = L.metas[e.id] || {};
    return {
      e, m,
      title: m.title || e.name.replace(BOOK_RE, ''),
      author: (m.authors || []).join(', '),
      fmt: m.format || (/epub$/i.test(e.name) ? 'epub' : 'fb2'),
    };
  }

  function renderLibrary() {
    syncLibTabs();
    if (NB.view === 'notebook') { showOnly('notebook'); renderNotebook(); return; }
    if (NB.view === 'pads') { showOnly('pads'); renderPads(); return; }
    if (!L.entries.length) {
      if (L.scanning) { showOnly(null); return; }
      if (Src.missing) { showFolderMissing(); return; }
      showOnly('empty');
      return;
    }
    showOnly('shelves');
    renderRemember();
    renderShelves();
  }

  // ---------- полки: «Читаю сейчас», «Отложенные», «Прочитано» и свои ----------
  // Три основные заполняются сами по месту чтения; свои полки — ярлыки (книга может стоять на нескольких).
  const SH = { tab: null, page: 0, pages: 1, edit: null };
  const AUTO_SHELVES = [['reading', 'Читаю сейчас'], ['later', 'Отложенные'], ['done', 'Прочитано']];
  const shelves = () => LS.get('shelves', []);
  const saveShelves = (list) => { LS.set('shelves', list); LS.set('shelvesT', Date.now()); if (window.__saveStateSoon) window.__saveStateSoon(); };
  const bookStatus = (p) => (!p ? 'later' : p.later ? 'later' : (p.done || p.pct >= 0.995) ? 'done' : p.pct > 0.001 ? 'reading' : 'later');
  function setBookStatus(id, st) {
    const all = progress(), p = Object.assign({ ch: 0, off: 0, pct: 0 }, all[id]);
    p.t = Date.now();
    if (st === 'later') { p.later = true; delete p.done; } else { delete p.later; p.done = Date.now(); }
    all[id] = p; LS.set('progress', all);
    if (window.__saveStateSoon) window.__saveStateSoon();
  }

  // вид полки: «обложки» или «с описанием»; запоминается для каждой полки
  const shelfView = (id) => { const v = S.shelfView || {}; return v[id] || (id === 'reading' ? 'list' : 'grid'); };
  function setShelfView(id, mode) { S.shelfView = Object.assign({}, S.shelfView, { [id]: mode }); saveSettings(); SH.page = 0; renderShelves(); }

  // сколько книг помещается на странице полки без прокрутки
  function shelfPerPage(mode) {
    const grid = $('grid'), main = $('lib-main');
    const cs = getComputedStyle(grid), gapX = parseFloat(cs.columnGap) || 30, gapY = parseFloat(cs.rowGap) || 30;
    const w = grid.clientWidth || main.clientWidth - 80;
    const top = grid.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    const avail = main.clientHeight - top - 78;
    if (mode === 'list') {
      const cols = w >= 760 ? 2 : 1, rowH = 156;
      return cols * Math.max(1, Math.floor((avail + gapY) / (rowH + gapY)));
    }
    const cols = Math.max(1, Math.floor((w + gapX) / (118 + gapX)));
    const colW = (w - (cols - 1) * gapX) / cols;
    const cardH = colW * 1.5 + 92;
    const rows = Math.max(1, Math.floor((avail + gapY) / (cardH + gapY)));
    return cols * rows;
  }

  function folioHtml(pages, cur) {
    let nums = [];
    if (pages <= 9) nums = Array.from({ length: pages }, (_, i) => i);
    else {
      const set = new Set([0, pages - 1, cur - 1, cur, cur + 1].filter((i) => i >= 0 && i < pages));
      let prev = -1;
      for (const i of [...set].sort((a, b) => a - b)) { if (i - prev > 1) nums.push(-1); nums.push(i); prev = i; }
    }
    return nums.map((i) => i < 0 ? '<span class="fo-gap">…</span>' : i === cur ? '<b>— ' + (i + 1) + ' —</b>' : '<button data-shpage="' + i + '">' + (i + 1) + '</button>').join('');
  }

  // корешки полки: цвета обложек, высота и толщина чуть разные у каждой книги
  function spinesHtml(list, total) {
    const max = 14, shown = list.slice(0, max);
    return '<span class="spines">' + shown.map((b) => {
      const h = hash(b.e.id), color = b.m.color || genColor(b.title);
      return '<i style="width:' + (9 + (h % 4) * 2) + 'px;height:' + (44 + ((h >> 3) % 4) * 4) + 'px;background:' + color + '"></i>';
    }).join('') + (total > shown.length ? '<em>+' + (total - shown.length) + '</em>' : '') + '</span>';
  }

  const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : d < 7 ? d + ' ' + plural(d, 'день', 'дня', 'дней') + ' назад' : ruDay(t); };
  const ruDay = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  // «I» или «3» — это номер главы, добавим слово
  const chapLabel = (c) => !c ? '' : /^[IVXLCDM\d]+\.?$/i.test(String(c).trim()) ? 'глава ' + String(c).trim() : c;
  // что написать о книге: начатая — «где вы остановились»;
  // не начатая — аннотация, иначе начало текста
  function bookBlurb(b, p) {
    if (bookStatus(p) === 'reading') {
      // цитаты и мысли начатой книги — стикерами на обложке, в тексте только место чтения
      if (p && p.snip) return { kind: 'Где вы остановились', text: p.snip, serif: true, meta: (p.chap ? chapLabel(p.chap) + ', ' : '') + ago(p.t || Date.now()) };
      return b.m.annot ? { kind: 'О книге', text: b.m.annot } : null;
    }
    if (b.m.annot) return { kind: 'О книге', text: b.m.annot };
    if (b.m.open) return { kind: 'Начало книги', text: b.m.open };
    return null;
  }
  // ---------- стикеры: цитаты и мысли торчат из книги, высота — место в книге ----------
  const STK = {};
  function stickers(id) {
    const items = [].concat(((LS.get('quotes', {}) || {})[id] || []).map((x) => Object.assign({ kind: 'quote' }, x)), ((LS.get('notes', {}) || {})[id] || []).map((x) => Object.assign({ kind: 'note' }, x)))
      .filter((x) => typeof x.pct === 'number').sort((a, b) => a.pct - b.pct);
    if (!items.length) return '';
    // близкие склеиваются в один стикер; больше 12 на книгу не показываем
    // расстояние считаем от первой записи стикера, чтобы склейка не тянулась цепочкой через всю книгу
    let gap = 0.045, groups;
    do {
      groups = [];
      for (const it of items) { const g = groups[groups.length - 1]; if (g && it.pct - g[0].pct < gap) g.push(it); else groups.push([it]); }
      gap += 0.015;
    } while (groups.length > 12);
    STK[id] = groups;
    return '<span class="stk">' + groups.map((g, i) => {
      const p = Math.max(0, Math.min(1, g[0].pct));
      return '<i data-stk="' + esc(id) + '" data-g="' + i + '" style="top:calc(4% + ' + (p * 86).toFixed(2) + '%);--sx:' + ((hash(g[0].id || String(i)) % 3) * 3) + 'px;background:' + itemColor(g[0]) + '"></i>';
    }).join('') + '</span>';
  }
  const stkTip = () => $('stk-tip');
  let stkHide = null, stkHot = null;
  function showStkTip(el) {
    clearTimeout(stkHide);
    const id = el.dataset.stk, g = (STK[id] || [])[+el.dataset.g];
    if (!g) return;
    if (stkHot) stkHot.classList.remove('hot');
    stkHot = el; el.classList.add('hot');
    const tip = stkTip();
    tip.innerHTML = g.slice(0, 3).map((it) => {
      const text = it.kind === 'note' ? (it.body || it.text || '') : it.text || '';
      const tags = (it.tags || []).slice(0, 2).map((t) => '<span style="background:' + tagColor(t) + '">#' + esc(t) + '</span>').join('');
      return '<button class="st-item" data-stkopen="' + esc(id) + '" data-item="' + esc(it.id) + '"><span class="st-q' + (it.kind === 'note' ? ' st-note' : '') + '">' + (it.kind === 'note' ? '' : '«') + esc(text.slice(0, 220)) + (text.length > 220 ? '…' : '') + (it.kind === 'note' ? '' : '»') + '</span>' +
        '<span class="st-m">' + tags + esc((it.chapter ? chapLabel(it.chapter) + ' · ' : '') + Math.round(it.pct * 100) + '% книги') + '</span></button>';
    }).join('') + (g.length > 3 ? '<div class="st-more">и ещё ' + (g.length - 3) + '</div>' : '') + '<div class="st-go">Открыть на этом месте →</div>';
    tip.hidden = false;
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let x = r.right + 10, side = 'r';
    if (x + tr.width > innerWidth - 8) { x = r.left - tr.width - 10; side = 'l'; }
    tip.dataset.side = side;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - tr.height - 8, r.top + r.height / 2 - 26)) + 'px';
  }
  function hideStkTip(now) {
    clearTimeout(stkHide);
    const go = () => { stkTip().hidden = true; if (stkHot) { stkHot.classList.remove('hot'); stkHot = null; } };
    if (now) go(); else stkHide = setTimeout(go, 260);
  }
  function openSticker(id, itemId) {
    const it = [].concat((LS.get('quotes', {}) || {})[id] || [], (LS.get('notes', {}) || {})[id] || []).find((x) => x.id === itemId);
    hideStkTip(true);
    if (it) openLibraryItem(id, it);
  }

  // большая карточка книги, которую читаете (1–2 книги в «Читаю сейчас», вид «с описанием»).
  // Строки сетки — название, автор, текст, кнопка — общие у соседних карточек, поэтому всё стоит ровно.
  function heroHtml(b, p, size) {
    const pct = Math.round((p.pct || 0) * 100), bl = bookBlurb(b, p);
    const tags = bl && bl.tags && bl.tags.length ? '<div class="hb-tags">' + bl.tags.map((t) => '<span style="background:' + tagColor(t) + '">#' + esc(t) + '</span>').join('') + '</div>' : '';
    return '<div class="hb' + (size === 1 ? ' big' : '') + '" data-id="' + esc(b.e.id) + '">' +
      '<div class="hb-cover">' + coverHtml(b.m, b.e.name, stickers(b.e.id)) + '</div>' +
      '<div class="hb-t">' + esc(b.title) + '</div>' +
      '<div class="hb-a">' + esc(b.author || ' ') + (p.chap ? '<span class="hb-ch"> · ' + esc(chapLabel(p.chap)) + '</span>' : '') + '</div>' +
      '<div class="hb-sec">' + (bl ? '<div class="hb-k">' + bl.kind + '</div><div class="' + (bl.serif ? 'hb-q' : 'hb-anno') + '"' + (bl.color ? ' style="border-color:' + bl.color + '"' : '') + '>' + esc(bl.text) + '</div>' +
        (bl.meta ? '<div class="hb-meta">' + esc(bl.meta) + '</div>' : '') + tags : '') + '</div>' +
      '<button type="button" class="hb-go" title="Продолжить чтение"><i style="width:' + Math.max(pct, 2) + '%"></i><b>Продолжить</b><em>' + pct + '%</em></button>' +
      '</div>';
  }

  function renderShelves() {
    const prog = progress();
    const q = L.query.trim().toLowerCase().replace(/ё/g, 'е');
    const all = L.entries.map(bookInfo);
    const mine = shelves();
    // «Отложенные» — только неразложенное: книга, поставленная на свою полку, живёт там
    const placed = new Set([].concat(...mine.map((x) => x.books)));
    // книги с «тихих» полок (стихи и всё, к чему возвращаются всю жизнь) живут только на своей полке
    const quiet = quietBooks(mine);
    const by = { reading: [], later: [], done: [] };
    for (const b of all) { const st = bookStatus(prog[b.e.id]); if (st === 'later' ? !placed.has(b.e.id) : !quiet.has(b.e.id)) by[st].push(b); }

    // какая полка открыта: при запуске — «Читаю сейчас», если на ней что-то есть
    const valid = (t) => t === 'later' || (by[t] && by[t].length) || mine.some((x) => x.id === t);
    if (!SH.tab || !valid(SH.tab)) { SH.tab = by.reading.length ? 'reading' : 'later'; SH.page = 0; }

    const coll = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
    const surname = (a) => { const parts = a.split(',')[0].trim().split(/\s+/); return parts[parts.length - 1] || ''; };
    const recent = (a, b) => ((prog[b.e.id] || {}).t || 0) - ((prog[a.e.id] || {}).t || 0) || (b.e.mtime || 0) - (a.e.mtime || 0);
    const sorted = (list, id) => {
      list = list.slice();
      if (id === 'reading') list.sort(recent);
      else if (S.sort === 'title') list.sort((a, b) => coll.compare(a.title, b.title));
      else if (S.sort === 'author') list.sort((a, b) => coll.compare(surname(a.author) || 'я', surname(b.author) || 'я') || coll.compare(a.title, b.title));
      else list.sort(recent);
      if (id === 'later') list.sort((a, b) => (b.e.builtin ? 1 : 0) - (a.e.builtin ? 1 : 0)); // путеводитель — первым
      return list;
    };
    const shelfBooks = (id) => by[id] ? by[id] : (() => { const sh = mine.find((x) => x.id === id), ids = new Set(sh ? sh.books : []); return all.filter((b) => ids.has(b.e.id)); })();

    // колонка полок справа
    const side = (id, name, custom) => {
      const list = sorted(shelfBooks(id), id);
      if (SH.edit === id) return '<div class="sh-tab editing"><input class="sh-input" id="sh-input" data-shelf="' + esc(id) + '" value="' + esc(name) + '" maxlength="40" spellcheck="false"></div>';
      return '<button class="sh-tab' + (!q && SH.tab === id ? ' on' : '') + '" data-shelf="' + esc(id) + '"' + (custom ? ' data-custom="1"' : '') + '>' +
        '<span class="st-name">' + esc(name) + '</span><small>' + list.length + '</small>' + spinesHtml(list, list.length) + '</button>';
    };
    let col = '';
    for (const [id, name] of AUTO_SHELVES) if (id === 'later' || by[id].length) col += side(id, name);
    if (mine.length) col += '<div class="sh-sep"></div>';
    for (const x of mine) col += side(x.id, x.name, true);
    col += SH.edit === 'new' ? '<input class="sh-input sh-input-new" id="sh-input" data-shelf="new" placeholder="Название полки" maxlength="40" spellcheck="false">'
      : '<button class="sh-new" id="sh-new">+ Новая полка</button>';
    $('sh-tabs').innerHTML = col;
    $('shelves').hidden = false;
    if (SH.edit) { const inp = $('sh-input'); if (inp) { inp.focus(); inp.select(); } }

    // открытая полка слева
    let items, title, emptyText = 'Ничего не найдено', viewKey;
    if (q) {
      items = sorted(all.filter((b) => (b.title + ' ' + b.author + ' ' + (b.m.series || '') + ' ' + b.e.name).toLowerCase().replace(/ё/g, 'е').includes(q)), '');
      title = 'Найдено'; viewKey = 'search';
    } else {
      items = sorted(shelfBooks(SH.tab), SH.tab); viewKey = SH.tab;
      title = (AUTO_SHELVES.find((x) => x[0] === SH.tab) || [0, (mine.find((x) => x.id === SH.tab) || {}).name || ''])[1];
      emptyText = SH.tab === 'later' ? 'Здесь пусто: все книги уже начаты, прочитаны или разложены по вашим полкам' : by[SH.tab] ? 'На этой полке пока пусто' : 'На этой полке пока пусто. Правый клик по книге → «На полку».';
    }
    const mode = shelfView(viewKey);
    $('sh-title').innerHTML = esc(title) + '<span>' + items.length + '</span>';
    $('sh-view').dataset.key = viewKey;
    $('sh-view').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.shview === mode));
    const heroMode = !q && SH.tab === 'reading' && mode === 'list' && items.length && items.length <= 2;
    const grid = $('grid');
    grid.className = heroMode ? 'grid hb-list n' + items.length : mode === 'list' ? 'grid rows' : 'grid';

    const per = heroMode ? 2 : shelfPerPage(mode);
    SH.pages = Math.max(1, Math.ceil(items.length / per));
    SH.page = Math.max(0, Math.min(SH.page, SH.pages - 1));
    const pageItems = items.slice(SH.page * per, SH.page * per + per);
    $('nothing-found').hidden = items.length > 0;
    $('nothing-found').textContent = emptyText;
    const more = '<span class="bc-more" data-more="1" title="На полку, отложить, прочитано">⋯</span>';
    grid.innerHTML = heroMode ? pageItems.map((b) => heroHtml(b, prog[b.e.id] || {}, items.length)).join('') : pageItems.map((b) => {
      const p = prog[b.e.id], st = bookStatus(p);
      let metaLine = '';
      if (st === 'reading') metaLine = '<div class="progress"><i style="width:' + (p.pct * 100).toFixed(1) + '%"></i></div><span>' + Math.round(p.pct * 100) + '%</span>';
      else if (st === 'done' && (q || !by[SH.tab])) metaLine = '<span class="done">Прочитано</span>';
      if (mode === 'list') {
        const bl = bookBlurb(b, p);
        const text = bl ? '<div class="br-text' + (bl.serif ? ' br-snip' : '') + '"><span class="br-label">' + bl.kind + ' · </span>' + esc(bl.text) + '</div>' : '';
        return '<button class="book-row" data-id="' + esc(b.e.id) + '" data-book-name="' + esc(b.e.name) + '"><div class="br-cover">' + coverHtml(b.m, b.e.name, stickers(b.e.id)) + more + '</div><div class="br-info">' +
          '<div class="br-title">' + esc(b.title) + '</div><div class="br-author">' + esc(b.author || ' ') + '</div>' +
          (metaLine ? '<div class="bc-meta">' + metaLine + '</div>' : '') + text + '</div></button>';
      }
      return '<button class="book-card" data-id="' + esc(b.e.id) + '" data-book-name="' + esc(b.e.name) + '" title="' + esc(b.title + (b.author ? ' — ' + b.author : '')) + '">' + coverHtml(b.m, b.e.name, stickers(b.e.id)) + more +
        '<div class="bc-title">' + esc(b.title) + '</div><div class="bc-author">' + esc(b.author || ' ') + '</div>' +
        '<div class="bc-meta">' + metaLine + '</div></button>';
    }).join('');
    $('sh-folio').hidden = SH.pages < 2;
    $('sh-folio').innerHTML = SH.pages < 2 ? '' : folioHtml(SH.pages, SH.page);
  }
  function shelfTurn(d) {
    const n = Math.max(0, Math.min(SH.pages - 1, SH.page + d));
    if (n === SH.page) return false;
    SH.page = n; renderShelves(); return true;
  }

  // меню книги и меню полки
  function closeCtx() { $('ctx-menu').hidden = true; $('ctx-menu').innerHTML = ''; }
  function openCtx(html, x, y) {
    const m = $('ctx-menu');
    m.innerHTML = html; m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  function bookMenu(id, x, y) {
    const st = bookStatus(progress()[id]);
    let h = '';
    if (st !== 'later') h += '<button data-act="later" data-book="' + esc(id) + '">Отложить</button>';
    if (st !== 'done') h += '<button data-act="done" data-book="' + esc(id) + '">Прочитано</button>';
    if (id === GUIDE_ID) h += '<button data-act="hideguide">Убрать с полки</button>';
    h += '<div class="cx-label">На полку</div>';
    for (const x2 of shelves()) h += '<button class="cx-check' + (x2.books.includes(id) ? ' on' : '') + '" data-act="toggle" data-shelf="' + esc(x2.id) + '" data-book="' + esc(id) + '">' + esc(x2.name) + '</button>';
    h += '<input class="cx-input" id="cx-new" data-book="' + esc(id) + '" placeholder="+ Новая полка" maxlength="40" spellcheck="false">';
    openCtx(h, x, y);
  }
  const quietBooks = (list) => new Set([].concat(...(list || shelves()).filter((x) => x.quiet).map((x) => x.books)));
  function shelfMenu(id, x, y) {
    const sh = shelves().find((s2) => s2.id === id);
    openCtx('<button class="cx-check cx-quiet' + (sh && sh.quiet ? ' on' : '') + '" data-act="quiet" data-shelf="' + esc(id) + '">Не показывать в «Читаю сейчас»<small>для книг, к которым возвращаетесь всю жизнь</small></button><div class="cx-sep"></div>' +
      '<button data-act="rename" data-shelf="' + esc(id) + '">Переименовать</button><button data-act="remove" data-shelf="' + esc(id) + '">Убрать полку</button>', x, y);
  }
  function newShelf(name, bookId) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return null;
    const list = shelves();
    let sh = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!sh) { sh = { id: newId('s'), name, books: [] }; list.push(sh); }
    if (bookId && !sh.books.includes(bookId)) sh.books.push(bookId);
    saveShelves(list);
    return sh;
  }
  function shelfAct(el) {
    const act = el.dataset.act, list = shelves();
    if (act === 'later' || act === 'done') setBookStatus(el.dataset.book, act);
    else if (act === 'toggle') {
      const sh = list.find((x) => x.id === el.dataset.shelf); if (!sh) return;
      const i = sh.books.indexOf(el.dataset.book);
      if (i >= 0) sh.books.splice(i, 1); else sh.books.push(el.dataset.book);
      saveShelves(list);
    } else if (act === 'quiet') {
      const sh = list.find((x) => x.id === el.dataset.shelf); if (!sh) return;
      if (sh.quiet) delete sh.quiet; else sh.quiet = true;
      saveShelves(list);
    } else if (act === 'rename') { SH.edit = el.dataset.shelf; }
    else if (act === 'hideguide') { closeCtx(); setGuide(false); toastAction('Книга о Полке убрана с полки', 'Вернуть', () => setGuide(true), 6000); return; }
    else if (act === 'remove') {
      const sh = list.find((x) => x.id === el.dataset.shelf); if (!sh) return;
      saveShelves(list.filter((x) => x !== sh));
      if (SH.tab === sh.id) SH.tab = null;
      toastAction('Полка «' + sh.name + '» убрана, книги остались', 'Вернуть', () => { const l = shelves(); l.push(sh); saveShelves(l); renderLibrary(); }, 6000);
    }
    closeCtx(); renderLibrary();
  }
  function setGuide(on) { LS.set('guideHidden', !on); L.lastScan = 0; scan(true); }
  function shelfInputDone(inp, ok) {
    const id = inp.dataset.shelf, name = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    SH.edit = null;
    if (ok && name) {
      if (id === 'new') { const sh = newShelf(name); if (sh) { SH.tab = sh.id; SH.page = 0; } }
      else { const list = shelves(), sh = list.find((x) => x.id === id); if (sh) { sh.name = name; saveShelves(list); } }
    }
    renderLibrary();
  }

  // ============================================================
  //                            Читалка
  // ============================================================
  const R = {
    book: null, entry: null, id: null,
    ch: 0, page: 0, pages: 1, off: 0,
    geo: null, nodes: null, domLen: 1, rendering: false, renderToken: 0,
    history: [], previewReturn: null,
  };
  const flow = $('flow'), viewport = $('viewport'), stage = $('stage'), reader = $('reader');

  async function openEntry(e, at) {
    if (R.opening) return; // двойной клик не разбирает книгу дважды
    const opening = R.opening = Symbol();
    try { await openEntryInner(e, at, opening); }
    finally {
      if (R.opening === opening) {
        document.body.style.cursor = '';
        R.opening = false;
      }
    }
  }
  async function openEntryInner(e, at, opening) {
    const lib = $('library');
    document.body.style.cursor = 'progress';
    try {
      const bytes = await Src.read(e);
      if (R.opening !== opening) return;
      const book = BookParser.parse(e.name, bytes);
      if (!book.chapters.length) { for (const u of book.urls || []) URL.revokeObjectURL(u); throw new Error('В книге нет текста'); }
      if (R.book) closeBook(true);
      R.book = book; R.entry = e; R.id = e.id; R.history = [];
      if (!L.metas[e.id]) ensureMeta(e);
      const pos = progress()[e.id];
      lib.hidden = true; reader.hidden = false;
      syncReadingPower();
      document.title = (book.title || e.name) + ' — Полка';
      $('r-book-title').textContent = book.title || e.name;
      $('r-book-author').textContent = book.authors.join(', ');
      flow.lang = book.lang || 'ru';
      buildToc();
      soundWarm();
      const renderToken = R.renderToken;
      if (document.fonts && document.fonts.load) await document.fonts.load(S.size + 'px "' + S.font + '"').catch(() => {});
      if (R.book !== book || R.renderToken !== renderToken) return;
      if (at && at.ch < book.chapters.length) {
        const resume = pos && pos.ch < book.chapters.length ? pos : { ch: 0, off: 0 };
        startLinkedPreview(at.libraryReturn || { ch: resume.ch, off: resume.off });
        if (!await renderChapter(at.ch, { off: at.off || 0, keepOff: true })) return;
      }
      else {
        const ch = pos && pos.ch < book.chapters.length ? pos.ch : 0;
        if (!await renderChapter(ch, pos ? { off: pos.off || 0, keepOff: true } : { page: 0 })) return;
      }
      showUi(true);
      hideUiSoon();
      if (window.__migrateQuotes) window.__migrateQuotes().catch((err) => console.warn(err));
    } catch (err) {
      if (R.opening !== opening) return;
      console.error(err);
      const msg = String((err && err.message) || err);
      // файл исчез, пока программа была открыта (удалили, переименовали, отключили флешку)
      toast('Не получилось открыть книгу: ' + (/ENOENT|no such file/i.test(msg) ? 'файл не найден — его переместили, переименовали или удалили' : msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')));
    }
  }

  function closeBook(silent) {
    if (!silent && R.opening) {
      R.opening = false;
      document.body.style.cursor = '';
    }
    if (!R.book) return;
    const libraryScroll = R.previewReturn?.scrollTop;
    if (typeof PADE !== 'undefined' && PADE) { PADE.save(); PADE = null; $('pad').hidden = true; reader.classList.remove('pad-on'); $('btn-pad').classList.remove('active'); }
    dropClones(); autoStop();
    savePos.flush();
    if (R.endShown) hideBookEnd(true);
    R.renderToken++; R.rendering = false;
    // из книги возвращаемся туда, где она теперь стоит: начатая — в «Читаю сейчас»
    if (!silent && libraryScroll == null && !shelves().some((x) => x.id === SH.tab)) {
      const qs = shelves().find((x) => x.quiet && x.books.includes(R.id)); // книга с «тихой» полки — обратно на неё
      if (qs) { SH.tab = qs.id; SH.page = 0; }
      else if (bookStatus(progress()[R.id]) === 'reading' && SH.tab !== 'reading') { SH.tab = 'reading'; SH.page = 0; }
    }
    for (const u of R.book.urls) URL.revokeObjectURL(u);
    R.book = null; R.nodes = null; R.texts = null; R.noteCache = null; R.normCache = null;
    syncReadingPower();
    flow.innerHTML = '';
    R.previewReturn = null;
    dropBackPill();
    if ($('pins')) $('pins').innerHTML = '';
    if (CSS.highlights) CSS.highlights.clear();
    if (!silent) {
      reader.hidden = true; $('library').hidden = false;
      document.title = 'Полка';
      closePanels();
      renderLibrary();
      if (libraryScroll != null) $('lib-main').scrollTop = libraryScroll;
      quietRescan(60000);
    }
  }

  // ---------- геометрия ----------
  function computeGeo() {
    // «Лист»: у страницы поля сверху и снизу, как в книге (снизу чуть больше)
    const sheet = S.focus === 'sheet';
    let insT = sheet ? 54 : 0, insB = sheet ? 58 : 0;
    const W = stage.clientWidth;
    let H = stage.clientHeight - insT - insB;
    if (sheet) {
      // высота — ровно под целое число строк, остаток поровну сверху и снизу (иначе внизу пусто на полстроки)
      const lh = S.size * S.lh, lines = Math.max(1, Math.floor(H / lh)), rem = H - lines * lh;
      insT += Math.floor(rem / 2); insB += Math.ceil(rem / 2) - 1;
      H = Math.ceil(lines * lh) + 1;
    }
    // у «Листа» поля стола по бокам шире, чтобы лист не уходил под кнопки панели
    const side = W < 700 ? 22 : sheet && W >= 900 ? 150 : 56;
    let cols = S.cols === 'auto' ? (W >= 1180 ? 2 : 1) : S.cols === 'scroll' ? 1 : +S.cols;
    if (W < 820 || S.focus === 'sheet') cols = 1;
    const gap = cols === 2 ? Math.round(Math.max(72, Math.min(120, W * 0.07))) : 60;
    const maxCol = S.width * Math.max(1, S.size / 20) ** 0.5;
    const colW = Math.floor(Math.min(maxCol, (W - side * 2 - gap * (cols - 1)) / cols));
    const vw = colW * cols + gap * (cols - 1);
    return { W, H, cols, gap, colW, vw, step: vw + gap, insT, insB };
  }

  const isScroll = () => S.cols === 'scroll';
  const HANG_PAD = 28;
  // прямоугольник колонки текста (в ленте у области прокрутки есть поля)
  function textRect() {
    const r = viewport.getBoundingClientRect();
    if (!isScroll()) return r;
    return { left: r.left + HANG_PAD, right: r.right - HANG_PAD, top: r.top, bottom: r.bottom, width: r.width - HANG_PAD * 2, height: r.height };
  }
  function applyGeo() {
    const g = R.geo = computeGeo();
    R.cpp = null;
    const sc = isScroll();
    reader.classList.toggle('scroll-mode', sc);
    // в ленте у прокрутки свои края — даём полям место для висячих кавычек
    const hp = sc ? HANG_PAD : 0;
    viewport.style.width = g.vw + hp * 2 + 'px';
    viewport.style.marginLeft = -Math.round(g.vw / 2) - hp + 'px';
    viewport.style.paddingLeft = viewport.style.paddingRight = hp ? hp + 'px' : '';
    // «Лист»: светлый лист под колонкой текста
    const sw = g.vw + 2 * Math.round(Math.max(48, Math.min(84, g.vw * 0.11)));
    $('sheet').style.width = sw + 'px'; $('sheet').style.marginLeft = -Math.round(sw / 2) + 'px';
    reader.style.setProperty('--sheet-w', sw + 'px');
    reader.style.setProperty('--text-w', g.vw + 'px'); // строка состояния — по ширине текста
    viewport.style.top = g.insT ? g.insT + 'px' : ''; viewport.style.bottom = g.insB ? g.insB + 'px' : '';
    flow.style.width = g.vw + 'px';
    flow.style.height = sc ? '' : g.H + 'px';
    flow.style.columnWidth = sc ? '' : g.colW + 'px';
    flow.style.columnCount = sc ? '' : g.cols;
    flow.style.columnGap = sc ? '' : g.gap + 'px';
    if (sc) { flow.style.left = '0px'; flow.style.transform = ''; R.x = 0; }
    flow.style.setProperty('--page-h', g.H + 'px');
  }

  function countPages() {
    if (isScroll()) { R.pages = 1; R.page = 0; return; }
    const m = flow.querySelector('.end-marker');
    const fr = flow.getBoundingClientRect();
    const r = m.getBoundingClientRect();
    const col = Math.max(0, Math.floor((r.left - fr.left + 2) / (R.geo.colW + R.geo.gap)));
    // если маркер — первая строка новой колонки, а колонка пустая, не считаем её
    R.pages = Math.floor(col / R.geo.cols) + 1;
  }

  const pageOfX = (x) => Math.max(0, Math.floor((x + 2) / R.geo.step));

  // Страница в покое стоит через left на целых пикселях (без слоя видеокарты),
  // поэтому Windows рисует текст с ClearType. Слой нужен только на время анимации.
  function setPage(p, animate) {
    if (isScroll()) { R.page = 0; return; }
    const prevX = R.x || 0;
    const np = Math.max(0, Math.min(R.pages - 1, p));
    const fancy = animate && Math.round(np * R.geo.step) !== prevX && fancyFlip();
    // копия должна показать ещё старую страницу
    const flip = fancy ? flipStart(np > R.page ? 1 : -1) : null;
    R.page = np;
    const x = Math.round(R.page * R.geo.step);
    R.x = x;
    clearTimeout(R.animT);
    const settle = () => {
      flow.classList.remove('anim');
      flow.style.transform = '';
      flow.style.left = -x + 'px';
    };
    if (flip) {
      // «Поворот» и «Загиб»: старая страница уходит копией, под ней сразу новая
      settle();
      flip.play();
      return;
    }
    if (animate && x !== prevX) turnSound('slide', 0.44);
    if (animate && S.anim && x !== prevX) {
      flow.classList.remove('anim');
      flow.style.left = -prevX + 'px';
      flow.style.transform = 'translateX(0px)';
      void flow.offsetWidth;
      flow.classList.add('anim');
      flow.style.transform = 'translateX(' + (prevX - x) + 'px)';
      R.animT = setTimeout(settle, 440);
    } else settle();
  }

  // ---------- текстовые узлы и смещения ----------
  // Смещения считаются в «чистом» тексте, без мягких переносов (U+00AD),
  // поэтому сохранённые позиции, закладки и поиск не зависят от расстановки переносов.
  const SHY = /­/g;
  const logLen = (v) => v.indexOf('­') < 0 ? v.length : v.replace(SHY, '').length;
  function rawToLog(node, i) {
    const v = node.nodeValue;
    if (v.indexOf('­') < 0) return i;
    let c = 0; for (let k = 0; k < i && k < v.length; k++) if (v.charCodeAt(k) !== 173) c++;
    return c;
  }
  function logToRaw(node, j) {
    const v = node.nodeValue;
    if (v.indexOf('­') < 0) return Math.min(j, v.length);
    let c = 0;
    for (let k = 0; k < v.length; k++) { if (v.charCodeAt(k) === 173) continue; if (c === j) return k; c++; }
    return v.length;
  }

  function buildNodes() {
    const nodes = [], starts = [], lens = [];
    let total = 0;
    const tw = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const l = logLen(n.nodeValue);
      if (/\S/.test(n.nodeValue)) { nodes.push(n); starts.push(total); lens.push(l); }
      total += l;
    }
    R.nodes = { nodes, starts, lens };
    R.domLen = Math.max(1, total);
  }

  const range = document.createRange();
  function pageOfChar(node, i) {
    const len = node.nodeValue.length;
    i = Math.max(0, Math.min(len - 1, i));
    range.setStart(node, i); range.setEnd(node, i + 1);
    let r = range.getClientRects()[0];
    if (!r || (!r.width && !r.height)) r = range.getBoundingClientRect();
    if (!r || (!r.width && !r.height && !r.left)) return null;
    const fr = flow.getBoundingClientRect();
    return pageOfX(r.left - fr.left);
  }

  // первое смещение (в символах главы), попадающее на страницу p
  function offsetOfPage(p) {
    const { nodes, starts } = R.nodes;
    if (!nodes.length || p <= 0) return 0;
    let lo = 0, hi = nodes.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const pg = pageOfChar(nodes[mid], nodes[mid].nodeValue.length - 1);
      if (pg !== null && pg >= p) { k = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (k < 0) return R.domLen;
    const node = nodes[k];
    let a = 0, b = node.nodeValue.length - 1, idx = b;
    while (a <= b) {
      const mid = (a + b) >> 1;
      const pg = pageOfChar(node, mid);
      if (pg !== null && pg >= p) { idx = mid; b = mid - 1; } else a = mid + 1;
    }
    // начало слова (мягкий перенос — часть слова)
    while (idx > 0 && /\S/.test(node.nodeValue[idx - 1]) && pageOfChar(node, idx - 1) >= p) idx--;
    return starts[k] + rawToLog(node, idx);
  }

  function nodeIndexAt(off) {
    const { starts } = R.nodes;
    let lo = 0, hi = starts.length - 1, k = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= off) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k;
  }

  function pageOfOffset(off) {
    const { nodes, starts } = R.nodes;
    if (!nodes.length) return 0;
    const k = nodeIndexAt(off);
    const node = nodes[k];
    const i = Math.min(logToRaw(node, Math.max(0, off - starts[k])), node.nodeValue.length - 1);
    let pg = pageOfChar(node, i);
    if (pg === null) pg = pageOfChar(node, 0);
    return pg || 0;
  }

  // ---------- лента (прокрутка сверху вниз) ----------
  function yOfChar(node, i) {
    const len = node.nodeValue.length;
    i = Math.max(0, Math.min(len - 1, i));
    range.setStart(node, i); range.setEnd(node, i + 1);
    let r = range.getClientRects()[0];
    if (!r || (!r.width && !r.height)) r = range.getBoundingClientRect();
    if (!r || (!r.width && !r.height && !r.top)) return null;
    return { top: r.top - flow.getBoundingClientRect().top, bottom: r.bottom - flow.getBoundingClientRect().top };
  }
  // первое смещение, чья строка видна ниже отметки y (в координатах ленты)
  function offsetAtY(y) {
    const { nodes, starts } = R.nodes;
    if (!nodes.length || y <= 0) return 0;
    let lo = 0, hi = nodes.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = yOfChar(nodes[mid], nodes[mid].nodeValue.length - 1);
      if (r && r.bottom > y + 2) { k = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (k < 0) return R.domLen;
    const node = nodes[k];
    let a = 0, b = node.nodeValue.length - 1, idx = b;
    while (a <= b) {
      const mid = (a + b) >> 1;
      const r = yOfChar(node, mid);
      if (r && r.bottom > y + 2) { idx = mid; b = mid - 1; } else a = mid + 1;
    }
    while (idx > 0 && /\S/.test(node.nodeValue[idx - 1])) { const r = yOfChar(node, idx - 1); if (r && r.bottom > y + 2) idx--; else break; }
    return starts[k] + rawToLog(node, idx);
  }
  function yOfOffset(off) {
    const { nodes, starts } = R.nodes;
    if (!nodes.length) return 0;
    const k = nodeIndexAt(off);
    const r = yOfChar(nodes[k], Math.min(logToRaw(nodes[k], Math.max(0, off - starts[k])), nodes[k].nodeValue.length - 1));
    return r ? r.top : 0;
  }
  const elRect = (el) => el.getClientRects()[0] || el.getBoundingClientRect();
  // показать место по смещению — в любом режиме
  function showOffset(off) {
    if (isScroll()) viewport.scrollTop = off <= 0 ? 0 : Math.max(0, yOfOffset(off) - 6);
    else setPage(pageOfOffset(off), false);
  }
  function showElement(el) {
    if (isScroll()) viewport.scrollTop = Math.max(0, elRect(el).top - flow.getBoundingClientRect().top - 6);
    else setPage(pageOfX(elRect(el).left - flow.getBoundingClientRect().left), false);
  }
  function currentOffset() { return isScroll() ? offsetAtY(viewport.scrollTop) : offsetOfPage(R.page); }
  const atEnd = () => isScroll() ? viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4 : R.page >= R.pages - 1;
  const atStart = () => isScroll() ? viewport.scrollTop <= 2 : R.page <= 0;
  function elPassed(el) {
    if (isScroll()) return elRect(el).top - viewport.getBoundingClientRect().top <= 48;
    return pageOfX(elRect(el).left - flow.getBoundingClientRect().left) <= R.page;
  }

  function rangeAt(off, len) {
    const { nodes, starts, lens } = R.nodes;
    const k = nodeIndexAt(off);
    const r = document.createRange();
    r.setStart(nodes[k], logToRaw(nodes[k], Math.max(0, off - starts[k])));
    const end = off + len;
    const m = Math.max(k, nodeIndexAt(Math.max(off, end - 1)));
    r.setEnd(nodes[m], logToRaw(nodes[m], Math.min(lens[m], end - starts[m])));
    return r;
  }

  function textAt(off, n) {
    const { nodes, starts, lens } = R.nodes;
    let out = '';
    for (let i = 0; i < nodes.length && out.length < n; i++) {
      if (starts[i] + lens[i] <= off) continue;
      const from = logToRaw(nodes[i], Math.max(0, off - starts[i]));
      out += (out ? ' ' : '') + nodes[i].nodeValue.slice(from).replace(SHY, '');
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, n);
  }

  // ---------- переносы слов (свои словари: в Windows-версии Chromium их нет) ----------
  const hyphCache = new Map();
  function hyphWord(w) {
    let h = hyphCache.get(w);
    if (h === undefined) {
      h = /[a-z]/i.test(w[0]) ? window.Hyph.en(w) : window.Hyph.ru(w);
      if (hyphCache.size < 200000) hyphCache.set(w, h);
    }
    return h;
  }
  function hyphenateHtml(html) {
    const d = document.implementation.createHTMLDocument('');
    const div = d.createElement('div');
    div.innerHTML = html;
    const tw = d.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const p = n.parentNode;
      if (p && p.closest && p.closest('pre,code,h1,h2,h3,h4,h5,h6,.title,.subtitle,.btp-title')) continue;
      if (n.nodeValue.length < 5) continue;
      n.nodeValue = n.nodeValue.replace(/[A-Za-z]{5,}|[А-Яа-яЁё]{5,}/g, hyphWord);
    }
    return div.innerHTML;
  }

  // ---------- типографика ----------
  // Только замены «пробел → неразрывный пробел» (длина текста та же) и обёртки вокруг кавычек,
  // поэтому смещения цитат, закладок и места чтения не меняются.
  const T_SHORT = /(?<=^|[\s\u00a0(«„“"'—–-])([ВвКкСсУуОоИиАаЯя]|[Нн][аеои]|[Пп]о|[Зз]а|[Ии]з|[Оо]т|[Дд]о|[Оо]б|[Вв]о|[Сс]о|[Кк]о|[Дд]а|[Пп]ри|[Пп]ро|[Бб]ез|[Дд]ля|[Пп]од|[Нн]ад) (?=[^\s—–])/g;
  const T_PART = / (же|ж|ли|ль|бы|б)(?=$|[\s\u00a0.,:;!?…»“")])/g;
  const T_INIT = /(?<=(?:^|[\s\u00a0(«])[А-ЯЁA-Z]\.) (?=[А-ЯЁA-Z])/g;
  function typoText(v) {
    return v.replace(T_SHORT, '$1\u00a0').replace(T_PART, '\u00a0$1')
      .replace(/(?<=\S) (?=[—–](?:\s|$))/g, '\u00a0') // тире не начинает строку
      .replace(/^([—–]) /, '$1\u00a0')               // реплика: тире не остаётся одно в конце строки
      .replace(/(№|§) (?=\d)/g, '$1\u00a0')
      .replace(T_INIT, '\u00a0');
  }
  const OPENQ = /[«„“]/;
  function typoHtml(html) {
    const d = document.implementation.createHTMLDocument('');
    const div = d.createElement('div');
    div.innerHTML = html;
    const tw = d.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    const quotes = [];
    let n;
    while ((n = tw.nextNode())) {
      const p = n.parentNode;
      if (p && p.closest && p.closest('pre,code')) continue;
      const v = n.nodeValue;
      if (v.length < 2 && !OPENQ.test(v)) continue;
      const t = typoText(v);
      if (t !== v) n.nodeValue = t;
      if (OPENQ.test(t) && !(p.closest && p.closest('h1,h2,h3,h4,h5,h6,.title,.subtitle,.btp-title,.epigraph,.poem,td,th'))) quotes.push(n);
    }
    // открывающие кавычки — в обёртку: если окажутся в начале строки, их вынесет за край
    for (const node of quotes) {
      const v = node.nodeValue;
      const frag = d.createDocumentFragment();
      let last = 0;
      v.replace(/[«„“]/g, (m, i) => {
        if (i > 0 && !/[\s\u00a0(—–-]/.test(v[i - 1])) return m;
        if (i > last) frag.appendChild(d.createTextNode(v.slice(last, i)));
        const sp = d.createElement('span'); sp.className = 'hq'; sp.textContent = m;
        frag.appendChild(sp);
        last = i + 1;
        return m;
      });
      if (!last) continue;
      if (last < v.length) frag.appendChild(d.createTextNode(v.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return div.innerHTML;
  }
  function chapterHtml(c) {
    if (!S.typo) return c.html;
    if (!c.typo) { try { c.typo = typoHtml(c.html); } catch (e) { console.warn(e); c.typo = c.html; } }
    return c.typo;
  }
  // висячая пунктуация: кавычка в начале строки уходит на поля (Chromium сам этого не умеет)
  function applyHang() {
    const qs = flow.getElementsByClassName('hq');
    if (!qs.length) return;
    for (const q of Array.from(flow.querySelectorAll('.hq.hang'))) { q.classList.remove('hang'); q.style.marginLeft = ''; }
    if (!S.typo) return;
    const step = isScroll() ? 0 : R.geo.colW + R.geo.gap;
    const colStart = (x) => step ? Math.round(x / step) * step : 0;
    const fl = flow.getBoundingClientRect().left;
    const hits = [];
    for (const q of qs) {
      const r = q.getClientRects()[0];
      if (!r || !r.width) continue;
      const x = r.left - fl;
      if (Math.abs(x - colStart(x)) < 1.5) hits.push([q, r.width, colStart(x)]);
    }
    if (!hits.length) return;
    for (const [q, w] of hits) { q.classList.add('hang'); q.style.marginLeft = -w + 'px'; }
    // после переноса строк кавычка могла уехать с начала строки — тогда возвращаем как было
    const fl2 = flow.getBoundingClientRect().left;
    for (const [q, w, cs] of hits) {
      const r = q.getClientRects()[0];
      if (!r || Math.abs(r.left - fl2 - (cs - w)) > 1.5) { q.classList.remove('hang'); q.style.marginLeft = ''; }
    }
  }

  // ---------- рендер главы ----------
  async function renderChapter(ch, target, flip) {
    if (!R.book) return false;
    if (!(ch >= 0 && ch < R.book.chapters.length)) { ch = 0; target = { page: 0 }; }
    savePos.flush();
    const token = ++R.renderToken;
    R.rendering = true;
    try { return await renderChapterInner(ch, target, token, flip) && R.renderToken === token; }
    finally { if (R.renderToken === token) R.rendering = false; }
  }
  async function renderChapterInner(ch, target, token, flip) {
    if (R.endShown) hideBookEnd(true);
    if (!flip) dropClones();
    R.ch = ch;
    const c = R.book.chapters[ch];
    flow.classList.remove('anim');
    clearTimeout(R.animT); flow.style.transform = ''; flow.style.left = '0px'; R.x = 0;
    applyGeo();
    if (window.Hyph && !c.hyph) { try { c.html = hyphenateHtml(c.html); } catch (e) { console.warn(e); } c.hyph = true; }
    flow.innerHTML = chapterHtml(c) + '<span class="end-marker"></span>';
    R.units = null; R.fxEl = null;
    const imgs = Array.from(flow.querySelectorAll('img'));
    if (imgs.length) await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), sleep(1500)]);
    if (R.renderToken !== token) return false;
    applyHang();
    countPages();
    buildNodes();
    updateChapterNext();
    if (isScroll()) {
      viewport.scrollTop = 0;
      if (target === 'last') viewport.scrollTop = viewport.scrollHeight;
      else if (target && target.anchor) { const el = document.getElementById(target.anchor); if (el && flow.contains(el)) showElement(el); }
      else if (target && target.off) showOffset(target.off);
    } else {
      let p = 0;
      if (target === 'last') p = R.pages - 1;
      else if (target && target.anchor) {
        const el = document.getElementById(target.anchor);
        if (el && flow.contains(el)) p = pageOfX(elRect(el).left - flow.getBoundingClientRect().left);
      } else if (target && target.off) p = pageOfOffset(target.off);
      else if (target && target.page) p = target.page;
      setPage(p, false);
    }
    void flow.offsetWidth;
    flow.classList.add('fade');
    R.rendering = false;
    afterMove(target && target.off != null && target.keepOff ? target.off : null);
    return true;
  }

  async function relayout() {
    if (!R.book || R.rendering) return;
    dropClones();
    const off = R.off, token = R.renderToken;
    applyGeo();
    updateChapterNext();
    await sleep(0);
    if (!R.book || R.renderToken !== token || R.rendering || !R.nodes) return; // пока ждали, могла начаться отрисовка другой главы — она сама всё разложит
    applyHang();
    countPages();
    showOffset(off);
    if (R.endShown) positionBookEnd($('book-end'));
    else afterMove(off);
  }

  function afterMove(keepOff) {
    if ($('sel-bar')) { $('sel-bar').hidden = true; if (String(window.getSelection())) setTimeout(() => window.__showSelBar && window.__showSelBar(), 460); }
    R.off = keepOff != null ? keepOff : currentOffset();
    updateStatus();
    savePos();
    updateBookmarkFlag();
    if (window.__paintQuotes) window.__paintQuotes();
    if (fxOn()) fxPick();
    flipPrepare();
    autoSchedule();
  }

  function currentPct() {
    const b = R.book;
    if (R.ch === b.chapters.length - 1 && atEnd()) return 1;
    const c = b.chapters[R.ch];
    return Math.min(1, (b.offsets[R.ch] + c.len * (R.off / R.domLen)) / b.totalLen);
  }

  function chapterTitle() {
    const b = R.book;
    let best = null;
    for (const t of b.toc) { if (t.ch < R.ch || (t.ch === R.ch && !t.anchor)) best = t; else if (t.ch === R.ch && t.anchor) { const el = document.getElementById(t.anchor); if (el && flow.contains(el) && elPassed(el)) best = t; } }
    return best;
  }

  function updateStatus() {
    const pct = currentPct();
    const cs = R.book.chapters, cur = cs[R.ch];
    let left, partPages;
    if (isScroll()) {
      const h = Math.max(1, viewport.clientHeight);
      partPages = Math.max(1, Math.round(viewport.scrollHeight / h));
      left = Math.ceil(Math.max(0, viewport.scrollHeight - viewport.scrollTop - h - 4) / h);
    } else { partPages = R.pages; left = R.pages - R.page - 1; }
    for (let i = R.ch + 1; i < cs.length && cs[i].src === cur.src; i++) left += Math.max(1, Math.round(cs[i].len / (cur.len / partPages)));
    const pagesText = left > 0 ? 'ещё ' + left + ' ' + plural(left, 'страница', 'страницы', 'страниц') + ' в главе' : (R.ch < cs.length - 1 ? 'последняя страница главы' : 'конец книги');
    // страниц до конца книги — по тому, сколько текста помещается на страницу
    if (partPages >= 3 && cur.len > 2000) R.cpp = cur.len / partPages;
    const g = R.geo || computeGeo();
    const cpp = R.cpp || Math.max(200, (g.colW / (S.size * 0.52)) * ((isScroll() ? viewport.clientHeight : g.H) / (S.size * S.lh)) * (isScroll() ? 1 : g.cols));
    const restChars = Math.max(0, R.book.totalLen - (R.book.offsets[R.ch] + cur.len * (R.off / R.domLen)));
    const bookLeft = pct >= 1 ? 0 : Math.max(left, Math.round(restChars / cpp));
    const t = chapterTitle();
    R.tocCurrent = t;
    let title = t ? t.title : (cur.title || '');
    if (title === R.book.title) title = '';
    // показывается только вместе с панелью (движение мыши к краю или клик по центру)
    const headText = title || R.book.title || '', newHead = $('sheet-head').textContent !== headText;
    $('sheet-head').textContent = headText;
    // низ листа: полоска главы и сколько осталось; ярче сразу после листания, потом почти исчезает
    if (S.focus === 'sheet') {
      let before = isScroll() ? Math.floor(viewport.scrollTop / Math.max(1, viewport.clientHeight)) : R.page;
      for (let i = R.ch - 1; i >= 0 && cs[i].src === cur.src; i--) before += Math.max(1, Math.round(cs[i].len / (cur.len / partPages)));
      $('sf-fill').style.width = ((before + 1) / (before + 1 + left) * 100).toFixed(1) + '%';
      $('sf-text').textContent = pagesText;
      // верх и низ листа: ярче сразу после листания (название новой главы — подольше), потом почти исчезают
      const sf = $('sheet-foot'), sh = $('sheet-head');
      sf.classList.add('lit'); clearTimeout(R.sfT); R.sfT = setTimeout(() => sf.classList.remove('lit'), 1600);
      sh.classList.add('lit'); clearTimeout(R.shT); R.shT = setTimeout(() => sh.classList.remove('lit'), newHead ? 3200 : 1600);
    }
    const number = title.match(/^(?:(?:глава|chapter)\s+)?(\d+)(?=[\s.:—–-]|$)/iu)?.[1];
    const status = left > 0 ? 'ещё ' + left + ' стр.' + (number ? '' : ' в главе') : pagesText;
    $('r-left').textContent = number && status !== 'конец книги' ? 'Глава ' + number + ' · ' + status : status.charAt(0).toUpperCase() + status.slice(1);
    $('r-right').textContent = (bookLeft > 0 ? bookLeft + ' стр. до конца книги · ' : '') + Math.floor(pct * 100) + '%';
    $('r-progress-fill').style.width = (pct * 100).toFixed(2) + '%';
  }

  // две-три строки с того места, где остановились (для карточки на главной)
  function snippetHere() {
    try {
      if (!R.book) return '';
      if (!R.snipText || R.snipText.ch !== R.ch || R.snipText.book !== R.book) {
        // заголовки глав пропускаем, между абзацами — пробел (иначе «IV» слипается с текстом)
        const html = R.book.chapters[R.ch].html.replace(/<(h[1-6])[\s>][\s\S]*?<\/\1>/gi, (m) => ' '.repeat(plainText(m).length)).replace(/<\/(p|div|li|blockquote)>|<br\s*\/?>/gi, (m) => m + ' ');
        R.snipText = { ch: R.ch, book: R.book, text: plainText(html).replace(/\u00ad/g, '') };
      }
      const t = R.snipText.text;
      let i = Math.max(0, Math.min(t.length, R.off || 0));
      if (i > 0 && /\S/.test(t[i - 1])) { const sp = t.slice(i).search(/\s/); i = sp < 0 ? i : i + sp + 1; }
      const raw = t.slice(i, i + 600).replace(/\s+/g, ' ').trim();
      let s = raw.slice(0, 260);
      if (s.length < 40) return '';
      if (raw.length > 260) s = s.replace(/\s+\S*$/, '') + '…';
      return (i > 0 ? '…' : '') + s;
    } catch (e) { return ''; }
  }
  const savePos = (() => {
    let t = null;
    const write = () => {
      t = null;
      if (!R.book || R.rendering || R.previewReturn) return;
      const all = progress();
      const was = all[R.id] || {}, pct = R.endShown ? 1 : currentPct();
      // «прочитано» держится, пока книгу не начали заново
      all[R.id] = { ch: R.ch, off: R.off, pct, t: Date.now() };
      if (R.endShown || (was.done && pct >= 0.9)) all[R.id].done = was.done || Date.now();
      const sn = snippetHere();
      if (sn) { all[R.id].snip = sn; const tc = R.book.toc.filter((x) => x.ch <= R.ch).pop(); if (tc && tc.title) all[R.id].chap = String(tc.title).slice(0, 80); }
      else if (was.snip) { all[R.id].snip = was.snip; if (was.chap) all[R.id].chap = was.chap; }
      LS.set('progress', all);
      if (window.__saveStateSoon) window.__saveStateSoon();
    };
    const fn = () => { if (t) clearTimeout(t); t = setTimeout(write, 400); };
    fn.flush = () => { if (t) { clearTimeout(t); write(); } };
    return fn;
  })();
  window.addEventListener('beforeunload', () => savePos.flush());
  // программа закрывается/скрывается — сразу записать место чтения
  window.addEventListener('pagehide', () => { savePos.flush(); if (window.__saveStateNow) window.__saveStateNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { savePos.flush(); if (window.__saveStateNow) window.__saveStateNow(); } });

  // ---------- листание ----------
  async function turnChapter(ch, target, dir) {
    const flip = dir && fancyFlip() ? flipStart(dir) : null;
    let rendered = false;
    try {
      rendered = await renderChapter(ch, target, flip);
      if (rendered && dir) {
        if (flip) flip.play(); else turnSound('slide', 0.44);
      }
    } finally {
      if (flip && !rendered) flip.stop();
    }
  }
  function scrollStep(dir, amount) {
    const h = viewport.clientHeight;
    viewport.scrollBy({ top: dir * (amount || Math.round(h * 0.88)), behavior: S.anim ? 'smooth' : 'auto' });
  }
  async function next(amount) {
    if (!R.book || R.rendering || !R.nodes) return;
    readingResumed();
    if (isScroll()) {
      if (!atEnd()) { scrollStep(1, amount); return; }
      if (R.ch < R.book.chapters.length - 1) { await turnChapter(R.ch + 1, { page: 0 }); return; }
      showBookEnd(); return;
    }
    if (R.endShown) return;
    if (R.page < R.pages - 1) { setPage(R.page + 1, true); afterMove(); return; }
    if (R.ch < R.book.chapters.length - 1) { await turnChapter(R.ch + 1, { page: 0 }, 1); return; }
    showBookEnd(true);
  }
  async function prev(amount) {
    if (!R.book || R.rendering || !R.nodes) return;
    readingResumed();
    if (R.endShown) { hideBookEnd(); return; }
    if (isScroll()) {
      if (!atStart()) { scrollStep(-1, amount); return; }
      if (R.ch > 0) await turnChapter(R.ch - 1, 'last');
      return;
    }
    if (R.page > 0) { setPage(R.page - 1, true); afterMove(); return; }
    if (R.ch > 0) await turnChapter(R.ch - 1, 'last', -1);
  }
  async function goTo(ch, target, remember) {
    if (!R.book) return false;
    if (!R.nodes || R.rendering) return renderChapter(ch, target || { page: 0 });
    if (remember) pushHistory();
    if (ch === R.ch && target && target.anchor) {
      const el = document.getElementById(target.anchor);
      if (el && flow.contains(el)) { showElement(el); afterMove(); return true; }
    }
    if (ch === R.ch && target && target.off != null) { showOffset(target.off); afterMove(target.keepOff ? target.off : null); return true; }
    if (ch === R.ch && target && target.page === 0 && isScroll()) { viewport.scrollTop = 0; afterMove(); return true; }
    return renderChapter(ch, target || { page: 0 });
  }

  // кнопка в конце главы (только в ленте)
  function updateChapterNext() {
    const el = $('chapter-next');
    if (!isScroll() || !R.book) { el.hidden = true; return; }
    const cs = R.book.chapters, nxt = cs[R.ch + 1];
    el.hidden = false;
    if (!nxt) { el.innerHTML = '<div class="cn-end">Конец книги</div>'; return; }
    const cont = nxt.src === cs[R.ch].src;
    el.innerHTML = '<button class="cn-btn" id="cn-btn">' + (cont ? '<span class="cn-title">Читать дальше</span>'
      : '<span class="cn-label">Следующая глава</span><span class="cn-title">' + esc(nxt.title || 'Без названия') + '</span>') +
      '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>';
    $('cn-btn').onclick = () => next();
  }
  // при автопрокрутке пересчёт места и подсветки — не чаще раза в секунду (иначе каждый шаг — рывок)
  let scrollMoveT = 0;
  const scrollMove = debounce(() => { if (R.book && isScroll() && !R.rendering) { scrollMoveT = Date.now(); afterMove(); } }, 120);
  viewport.addEventListener('scroll', () => {
    if (AUTO.raf) { if (Date.now() - scrollMoveT > 1000 && R.book && !R.rendering) { scrollMoveT = Date.now(); afterMove(); } return; }
    scrollMove();
  });

  // ---------- листание как в книге: «Поворот» и «Загиб» ----------
  // Вне экрана всегда лежат две уже свёрстанные копии главы. При листании копия показывает старую
  // страницу поверх новой и уходит: поворачивается вокруг корешка или загибается от угла.
  // Копии готовы заранее, поэтому анимация есть при каждом листании, даже очень быстром.
  const FLIP = { slots: null, key: '', cur: null, last: 0, idle: 0, cast: null, cv: null };
  // на сверхдлинной главе копии слишком дороги — там листаем сдвигом
  const fancyFlip = () => (S.flip === 'turn' || S.flip === 'curl') && !isScroll() && !!R.geo && !!R.book && R.domLen < 250000;
  const cloneKey = () => R.geo ? [R.id, R.ch, R.geo.W, R.geo.H, R.geo.colW, R.geo.cols, R.geo.gap, R.pages, S.size, S.font, S.lh, S.width, S.typo, S.justify, S.hyph, S.focus === 'sheet'].join('|') : '';
  function pageRegion() {
    const sr = stage.getBoundingClientRect();
    if (S.focus === 'sheet') { const r = $('sheet').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, spread: false, sheet: true }; }
    const vr = viewport.getBoundingClientRect();
    const spread = R.geo.cols === 2;
    const pad = Math.round(Math.min(spread ? R.geo.gap / 2 : 44, (sr.width - vr.width) / 2));
    return { x: vr.left - pad, y: sr.top, w: vr.width + 2 * pad, h: sr.height, spread };
  }
  const paperColor = () => getComputedStyle(stage).getPropertyValue('--bg').trim() || getComputedStyle(document.body).backgroundColor;
  function makeSlot() {
    const slot = document.createElement('div');
    slot.className = 'flip-slot';
    slot.innerHTML = '<div class="fs-front"><div class="fs-sheet"><div class="sheet-head"></div><div class="sheet-foot"></div></div><div class="fs-vp"></div><div class="fs-shade"></div></div><div class="fs-back"><div class="fs-bshade"></div></div>';
    reader.appendChild(slot);
    return slot;
  }
  function flipPrepare() {
    if (!fancyFlip() || FLIP.key === cloneKey()) return;
    if (window.cancelIdleCallback) cancelIdleCallback(FLIP.idle);
    FLIP.idle = window.requestIdleCallback ? requestIdleCallback(buildClones, { timeout: 500 }) : setTimeout(buildClones, 200);
  }
  function buildClones() {
    if (!fancyFlip() || FLIP.cur || R.rendering) return;
    const key = cloneKey();
    if (FLIP.key === key) return;
    if (!FLIP.slots) {
      FLIP.slots = [makeSlot(), makeSlot()];
      FLIP.cast = document.createElement('div'); FLIP.cast.className = 'flip-cast'; reader.appendChild(FLIP.cast);
      FLIP.cv = document.createElement('canvas'); FLIP.cv.className = 'flip-cv'; reader.appendChild(FLIP.cv);
    }
    for (const slot of FLIP.slots) {
      const f = flow.cloneNode(true);
      f.removeAttribute('id'); f.classList.remove('anim', 'fx-para');
      for (const e of f.querySelectorAll('[id]')) e.removeAttribute('id');
      for (const e of f.querySelectorAll('.fx-cur')) e.classList.remove('fx-cur');
      f.style.transform = '';
      const vp = slot.querySelector('.fs-vp');
      vp.style.width = R.geo.vw + 'px'; vp.style.height = R.geo.H + 'px';
      vp.replaceChildren(f);
    }
    FLIP.key = key;
  }
  function finishFlip() { if (FLIP.cur) FLIP.cur.stop(); }
  // убрать копии (перед сменой вёрстки), чтобы браузер не пересчитывал их вместе с главой
  function dropClones() {
    finishFlip();
    if (FLIP.slots) for (const s of FLIP.slots) s.querySelector('.fs-vp').replaceChildren();
    FLIP.key = '';
  }
  function hideSlots() {
    if (!FLIP.slots) return;
    for (const s of FLIP.slots) {
      s.classList.remove('on'); s.style.transform = ''; s.style.opacity = '';
      const fr = s.firstChild; fr.style.clipPath = ''; fr.style.boxShadow = '';
    }
    FLIP.cast.style.display = 'none'; FLIP.cv.style.display = 'none';
  }
  // накрыть экран старой страницей; play() — увести её
  function flipStart(dir) {
    finishFlip();
    if (!fancyFlip() || anyPanel() || R.rendering) return null;
    // копии ещё не готовы (только что сменилась глава) — делаем сразу
    if (FLIP.key !== cloneKey() && R.domLen < 30000) buildClones();
    if (!FLIP.slots || FLIP.key !== cloneKey()) return null;
    const reg = pageRegion(), vr = viewport.getBoundingClientRect();
    const paper = paperColor();
    const half = reg.spread ? reg.w / 2 : reg.w;
    const lx = reg.spread ? (dir > 0 ? reg.x + half : reg.x) : reg.x;
    const [leaf, stat] = FLIP.slots;
    const page = R.page;
    const place = (slot, x, w) => {
      slot.style.left = x + 'px'; slot.style.top = reg.y + 'px'; slot.style.width = w + 'px'; slot.style.height = reg.h + 'px';
      slot.style.transform = ''; slot.style.opacity = '';
      const fr = slot.firstChild;
      fr.style.background = paper;
      fr.style.clipPath = '';
      fr.style.boxShadow = reg.sheet ? '0 0 0 1px var(--sheet-edge), 0 8px 30px var(--sheet-shadow)' : '';
      slot.lastChild.style.background = paper;
      const vp = fr.querySelector('.fs-vp');
      vp.style.left = (vr.left - x) + 'px'; vp.style.top = (vr.top - reg.y) + 'px';
      vp.firstChild.style.left = -Math.round(page * R.geo.step) + 'px';
      const sh = fr.querySelector('.fs-sheet');
      sh.hidden = !reg.sheet;
      if (reg.sheet) { sh.style.left = (reg.x - x) + 'px'; sh.style.width = reg.w + 'px'; sh.firstChild.textContent = $('sheet-head').textContent; sh.lastChild.innerHTML = $('sheet-foot').innerHTML; }
      fr.querySelector('.fs-shade').style.opacity = 0;
      slot.classList.add('on');
    };
    place(leaf, lx, half);
    if (reg.spread) place(stat, dir > 0 ? reg.x : reg.x + half, half);
    // быстрое листание подряд — анимация короче
    const now = Date.now(), quick = now - FLIP.last < 700;
    FLIP.last = now;
    let anims = [], raf = 0, curl = null, stopped = false;
    const ctl = {
      stop() {
        if (stopped) return; stopped = true;
        cancelAnimationFrame(raf); anims.forEach((a) => a.cancel());
        if (FLIP.cur === ctl) FLIP.cur = null;
        hideSlots();
        flipPrepare();
      },
      play() {
        if (stopped) return;
        const k = quick ? 0.62 : 1;
        turnSound(S.flip === 'curl' ? 'curl' : 'turn', (S.flip === 'curl' ? 760 : 660) * k / 1000);
        if (S.flip === 'curl') curl = playCurl(leaf, reg, lx, half, dir, paper, 760 * k, (id) => { raf = id; }, () => ctl.stop());
        else anims = playTurn(leaf, reg, lx, half, dir, 660 * k, () => ctl.stop());
      },
      // для автотестов: остановить на доле анимации
      seek(f) {
        if (f >= 1) { ctl.stop(); return; }
        if (curl) { cancelAnimationFrame(raf); curl(f); }
        anims.forEach((a) => { a.pause(); a.currentTime = f * a.effect.getComputedTiming().duration; });
      },
    };
    FLIP.cur = ctl;
    return ctl;
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // «Поворот»: лист поворачивается вокруг корешка (на развороте — правая страница ложится на левую)
  function playTurn(leaf, reg, lx, half, dir, T, done) {
    const fr = leaf.firstChild, shade = fr.querySelector('.fs-shade'), bshade = leaf.querySelector('.fs-bshade');
    leaf.style.transformOrigin = (dir > 0 ? 'left' : 'right') + ' center';
    shade.style.background = 'linear-gradient(' + (dir > 0 ? 'to right' : 'to left') + ', rgba(0,0,0,0) 0%, rgba(0,0,0,.08) 55%, rgba(0,0,0,.28) 100%)';
    bshade.style.background = 'linear-gradient(' + (dir > 0 ? 'to left' : 'to right') + ', rgba(0,0,0,.18) 0%, rgba(0,0,0,.04) 30%, rgba(0,0,0,0) 100%)';
    const cast = FLIP.cast;
    cast.style.cssText = 'display:block;left:' + lx + 'px;top:' + reg.y + 'px;width:' + half + 'px;height:' + reg.h + 'px;background:linear-gradient(' + (dir > 0 ? 'to right' : 'to left') + ', rgba(0,0,0,.22), rgba(0,0,0,0) 70%)';
    const E = 'cubic-bezier(.42,.0,.3,1)', end = dir > 0 ? -180 : 180, P = 'perspective(2400px) ';
    const keys = reg.spread
      ? [{ transform: P + 'rotateY(0deg)' }, { transform: P + 'rotateY(' + end / 2 + 'deg) translateZ(14px)', offset: 0.5 }, { transform: P + 'rotateY(' + end + 'deg)' }]
      : [{ transform: P + 'rotateY(0deg)', opacity: 1 }, { transform: P + 'rotateY(' + end * 0.5 + 'deg) translateZ(14px)', opacity: 1, offset: 0.5 }, { transform: P + 'rotateY(' + end * 0.62 + 'deg)', opacity: 0 }];
    const a1 = leaf.animate(keys, { duration: T, easing: E, fill: 'forwards' });
    const a2 = shade.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: T, easing: E, fill: 'forwards' });
    const a3 = cast.animate([{ opacity: 1 }, { opacity: 0.7, offset: 0.4 }, { opacity: 0 }], { duration: T, easing: E, fill: 'forwards' });
    const stat = FLIP.slots[1];
    // оборот листа и неподвижная половина в конце «проявляются» в настоящую страницу
    const fade = [{ opacity: 1 }, { opacity: 1, offset: 0.86 }, { opacity: 0 }];
    const a4 = (reg.spread ? stat : leaf.lastChild).animate(fade, { duration: T + 90, fill: 'forwards' });
    const a5 = reg.spread ? leaf.lastChild.animate(fade, { duration: T + 90, fill: 'forwards' }) : null;
    a4.onfinish = done;
    return [a1, a2, a3, a4, a5].filter(Boolean);
  }

  // «Загиб»: страница загибается от нижнего угла, как в настоящей книге
  function playCurl(leaf, reg, lx, half, dir, paper, T, setRaf, done) {
    const cv = FLIP.cv, dpr = window.devicePixelRatio || 1, P = (v) => v * dpr;
    cv.width = Math.round(window.innerWidth * dpr); cv.height = Math.round(window.innerHeight * dpr);
    cv.style.display = 'block'; cv.style.opacity = 1;
    const ctx = cv.getContext('2d');
    const fr = leaf.firstChild, stat = FLIP.slots[1];
    const L = { x: lx, y: reg.y, w: half, h: reg.h };
    const C = dir > 0 ? { x: L.x + L.w, y: L.y + L.h } : { x: L.x, y: L.y + L.h };
    const D = dir > 0 ? { x: L.x - L.w, y: L.y + L.h } : { x: L.x + 2 * L.w, y: L.y + L.h };
    const rect = [{ x: L.x, y: L.y }, { x: L.x + L.w, y: L.y }, { x: L.x + L.w, y: L.y + L.h }, { x: L.x, y: L.y + L.h }];
    const clip = (poly, f) => { // часть многоугольника, где f >= 0
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
        if (fa >= 0) out.push(a);
        if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
      }
      return out;
    };
    const path = (poly) => { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(P(p.x), P(p.y)) : ctx.moveTo(P(p.x), P(p.y)))); ctx.closePath(); };
    const draw = (t) => {
      const e = Math.max(0.002, ease(t));
      const Pt = { x: C.x + (D.x - C.x) * e, y: C.y + (D.y - C.y) * e - L.h * 0.22 * Math.sin(Math.PI * e) };
      const M = { x: (C.x + Pt.x) / 2, y: (C.y + Pt.y) / 2 };
      let nx = Pt.x - C.x, ny = Pt.y - C.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const f = (p) => (p.x - M.x) * nx + (p.y - M.y) * ny; // < 0 — сторона угла (загибается)
      const refl = (p) => { const d = 2 * f(p); return { x: p.x - d * nx, y: p.y - d * ny }; };
      const op = t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1;
      // ещё не загнутая часть — копия страницы, обрезанная по линии сгиба
      const flat = clip(rect, f);
      fr.style.clipPath = flat.length > 2 ? 'polygon(' + flat.map((p) => (p.x - L.x).toFixed(1) + 'px ' + (p.y - L.y).toFixed(1) + 'px').join(',') + ')' : 'inset(50%)';
      leaf.style.opacity = op; if (reg.spread) stat.style.opacity = op;
      cv.style.opacity = op;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      // тень от сгиба на открывшейся странице
      const open = clip(rect, (p) => -f(p));
      if (open.length > 2) {
        ctx.save(); path(open); ctx.clip();
        const gr = ctx.createLinearGradient(P(M.x), P(M.y), P(M.x - nx * 46), P(M.y - ny * 46));
        gr.addColorStop(0, 'rgba(0,0,0,.20)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore();
      }
      // загнутый лист: изнанка бумаги с тенью
      const flap = open.map(refl);
      if (flap.length > 2) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = P(18); ctx.shadowOffsetX = -nx * P(4); ctx.shadowOffsetY = -ny * P(4);
        path(flap); ctx.fillStyle = paper; ctx.fill();
        ctx.restore();
        ctx.save(); path(flap); ctx.clip();
        const gr = ctx.createLinearGradient(P(M.x), P(M.y), P(M.x + nx * 120), P(M.y + ny * 120));
        gr.addColorStop(0, 'rgba(0,0,0,.16)'); gr.addColorStop(0.18, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.05)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.restore();
      }
    };
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / T);
      draw(t);
      if (t < 1) setRaf(requestAnimationFrame(frame)); else done();
    };
    draw(0);
    setRaf(requestAnimationFrame(frame));
    return draw;
  }

  // ---------- звук листания ----------
  // Запись перелистывания настоящей книги (Kenney, «RPG Audio», CC0), смягчённая: без удара листа в конце.
  const SND = { ctx: null, bufs: null, loading: null };
  function soundWarm() {
    if (SND.ctx || !window.POLKA_SOUNDS || S.sound === 'off') return;
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      SND.ctx = new C();
      SND.loading = Promise.all(window.POLKA_SOUNDS.map((b64) => {
        const bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return SND.ctx.decodeAudioData(u.buffer);
      })).then((b) => { SND.bufs = b; }).catch(() => { SND.bufs = []; });
    } catch (e) { /* без звука */ }
  }
  // один и тот же мягкий шелест каждый раз — привычный, не отвлекает
  function turnSound(kind, dur, force) {
    if (!force && (S.sound === 'off' || isScroll() || reader.hidden)) return;
    soundWarm();
    if (!SND.ctx) return;
    if (!SND.bufs) { SND.loading.then(() => turnSound(kind, dur, force)); return; }
    if (!SND.bufs.length) return;
    try {
      const ctx = SND.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createBufferSource(); src.buffer = SND.bufs[0];
      const g = ctx.createGain(); g.gain.value = S.sound === 'loud' ? 0.95 : 0.5;
      src.connect(g); g.connect(ctx.destination);
      src.start();
    } catch (e) { /* без звука */ }
  }

  // ---------- автопрокрутка ----------
  // Скорость — слова в минуту. На страницах: время на страницу по числу слов на ней, потом листается само.
  // В «Абзаце» и «Предложении» сам идёт фокус. В ленте текст плавно ползёт вверх.
  // Пауза: меню, выделение, движение мыши (продолжает через пару секунд покоя), клавиша S.
  const AUTO = { timer: 0, raf: 0, paused: false, mouseUntil: 0, last: 0, acc: 0 };
  const autoOn = () => S.auto && S.auto !== 'off' && !!R.book && !reader.hidden;
  const words = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;
  function autoBlocked() {
    return anyPanel() || !!String(window.getSelection()) || Date.now() < AUTO.mouseUntil || document.hidden || R.rendering || !!FLIP.cur || (window.__popDirty && window.__popDirty());
  }
  function autoStop() { clearTimeout(AUTO.timer); cancelAnimationFrame(AUTO.raf); AUTO.timer = 0; AUTO.raf = 0; if (isScroll() && flow.style.transform) flow.style.transform = ''; }
  function autoSchedule() {
    // лента уже плывёт — не перезапускаем (перезапуск сбивал ход)
    if (AUTO.raf && isScroll() && !fxOn() && autoOn() && !AUTO.paused) return;
    autoStop();
    if (!autoOn() || AUTO.paused) return;
    const wpm = +S.auto;
    if (isScroll() && !fxOn()) { AUTO.last = performance.now(); AUTO.pos = viewport.scrollTop; AUTO.endAt = 0; AUTO.raf = requestAnimationFrame(autoTick); return; }
    let n;
    if (fxOn() && R.fxEl) n = words(S.focus === 'sent' ? sentRange().toString() : R.fxEl.textContent);
    else { const [s, e] = pageRange(); n = words(textAt(s, Math.min(isFinite(e) ? e - s : R.domLen - s, 40000))); }
    const ms = Math.max(fxOn() ? 900 : 2500, (n || 1) / wpm * 60000);
    AUTO.timer = setTimeout(autoStep, ms);
  }
  async function autoStep() {
    if (!autoOn() || AUTO.paused) return;
    if (autoBlocked()) { AUTO.timer = setTimeout(autoStep, 800); return; }
    if (R.ch === R.book.chapters.length - 1 && atEnd() && !(fxOn() && R.fxEl && fxUnits().indexOf(R.fxEl) < fxUnits().length - 1)) { AUTO.paused = true; showBookEnd(true); return; }
    if (fxOn()) { await fxStep(1); autoSchedule(); } else await next();
  }
  // лента: скорость в точках экрана в секунду — по ширине колонки и размеру шрифта
  function autoTick(now) {
    AUTO.raf = 0; // считается запущенным только пока запрошен следующий кадр
    const dt = Math.min(0.1, (now - AUTO.last) / 1000); AUTO.last = now;
    if (!autoOn() || AUTO.paused || !isScroll()) return;
    if (R.rendering) { AUTO.raf = requestAnimationFrame(autoTick); return; }
    if (autoBlocked()) AUTO.pos = viewport.scrollTop; // после паузы (или ручной прокрутки) — с того места, где текст сейчас
    else {
      const wpl = Math.max(4, (R.geo.colW / (S.size * 0.52)) / 6.3); // слов в строке
      const pps = (+S.auto / 60) / wpl * S.size * S.lh;
      // плавное положение копится точно, а на экран идёт шагом в одну точку экрана — равномерно, без рывков
      if (Math.abs(viewport.scrollTop - AUTO.pos) > 3) AUTO.pos = viewport.scrollTop; // прокрутили вручную
      AUTO.pos += pps * dt;
      // прокрутка — только целыми точками; остаток (доли точки на экранах с масштабом) — сдвигом текста по точкам экрана
      const dpr = window.devicePixelRatio || 1, q = Math.floor(AUTO.pos * dpr + 1e-6) / dpr, whole = Math.floor(q);
      if (whole > viewport.scrollTop) viewport.scrollTop = whole;
      const sub = Math.max(0, q - viewport.scrollTop);
      const tf = sub > 0 ? 'translateY(' + (-sub).toFixed(3) + 'px)' : '';
      if (flow.style.transform !== tf) flow.style.transform = tf;
      // в конце главы — дать дочитать последний экран (по скорости чтения), потом дальше
      if (atEnd()) {
        if (!AUTO.endAt) {
          const lines = viewport.clientHeight / (S.size * S.lh) * 0.6;
          AUTO.endAt = now + Math.max(2500, lines * wpl / (+S.auto / 60) * 1000);
        } else if (now >= AUTO.endAt) {
          AUTO.endAt = 0;
          if (R.ch < R.book.chapters.length - 1) { next(); return; }
          AUTO.paused = true; showBookEnd(true); return;
        }
      } else AUTO.endAt = 0;
    }
    AUTO.raf = requestAnimationFrame(autoTick);
  }
  function autoToggle() {
    if (!R.book) return;
    if (!autoOn()) return;
    AUTO.paused = !AUTO.paused;
    toast(AUTO.paused ? 'Автопрокрутка на паузе · пробел — продолжить' : 'Автопрокрутка · ' + S.auto + ' слов в минуту', 2000);
    autoSchedule();
  }
  // движение мыши над книгой — короткая пауза (в ленте — пока мышь двигается)
  reader.addEventListener('mousemove', () => { if (autoOn() && !AUTO.paused) AUTO.mouseUntil = Date.now() + 1800; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && autoOn()) autoSchedule(); });

  // ---------- последняя страница: «Книга прочитана» и впечатление о книге ----------
  function positionBookEnd(el) {
    const vr = viewport.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    // чуть шире колонки текста — висячие кавычки выходят на поля, их тоже закрываем
    el.style.left = (vr.left - sr.left - 34) + 'px'; el.style.width = vr.width + 68 + 'px';
    el.style.top = (vr.top - sr.top - 4) + 'px'; el.style.height = vr.height + 8 + 'px';
  }
  function showBookEnd(turn) {
    if (!R.book || R.endShown) return;
    const f = turn && fancyFlip() ? flipStart(1) : null;
    const el = $('book-end');
    positionBookEnd(el);
    const n = allItems().length;
    $('be-title').textContent = R.book.title || R.entry.name.replace(BOOK_RE, '');
    $('be-author').textContent = R.book.authors.join(', ');
    $('be-ta').value = (allBookThoughts()[R.id] || {}).body || '';
    $('be-notes').textContent = n ? 'Цитаты и заметки · ' + n : 'Цитаты и заметки';
    $('be-notes').hidden = !n;
    el.hidden = false; R.endShown = true;
    reader.classList.add('at-end');
    if (f) f.play(); else { el.classList.remove('be-in'); void el.offsetWidth; el.classList.add('be-in'); if (turn) turnSound('slide', 0.44); }
    if (!R.previewReturn) {
      // книга прочитана: место — самый конец
      const all = progress(); all[R.id] = Object.assign({}, all[R.id], { ch: R.ch, off: R.off, pct: 1, t: Date.now(), done: Date.now() }); LS.set('progress', all);
      if (window.__saveStateSoon) window.__saveStateSoon();
    }
  }
  function hideBookEnd(quiet) {
    if (!R.endShown) return;
    $('book-end').hidden = true; R.endShown = false; reader.classList.remove('at-end');
    if (!quiet) turnSound('slide', 0.44);
  }
  $('be-ta').addEventListener('input', () => autoGrow($('be-ta')));
  $('be-ta').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); $('be-ta').blur(); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('be-save').click(); }
  });
  $('be-save').onclick = async () => {
    const body = $('be-ta').value.replace(/\s+$/, '');
    const status = await saveBookThoughts(body, noteCtx());
    toast(status.message, status.failed ? 5000 : undefined);
  };
  $('be-lib').onclick = () => closeBook(false);
  $('be-notes').onclick = () => openToc('notes');

  // ---------- «Фокус» ----------
  // «Абзац»: ярко только абзац, который читаете; «Предложение»: только предложение;
  // «Лист»: текст на листе бумаги, вокруг — стол
  const FX_SEL = 'p, li, h1, h2, h3, h4, h5, h6, .v, .subtitle, .text-author, td, th, pre, dt, dd';
  const fxOn = () => S.focus === 'para' || S.focus === 'sent';
  function applyFocus() {
    reader.classList.toggle('fx-sheet', S.focus === 'sheet');
    flow.classList.toggle('fx-para', S.focus === 'para');
    flow.classList.toggle('fx-sent', S.focus === 'sent');
    if (!fxOn() && R.fxEl) { R.fxEl.classList.remove('fx-cur'); R.fxEl = null; }
    paintSent();
  }
  function fxUnits() {
    if (!R.units) {
      R.units = Array.from(flow.querySelectorAll(FX_SEL)).filter((el) => !el.querySelector(FX_SEL) && /\S/.test(el.textContent));
      for (const el of R.units) el.classList.add('fxu');
    }
    return R.units;
  }
  // видна ли часть (по прямоугольникам) на текущей странице — по номеру страницы, работает и во время листания
  function onPageRects(rs) {
    if (isScroll()) {
      const vr = viewport.getBoundingClientRect();
      for (const r of rs) if (r.height > 0 && r.bottom > vr.top + 8 && r.top < vr.bottom - 8) return true;
      return false;
    }
    const fl = flow.getBoundingClientRect().left;
    for (const r of rs) if (r.width > 0 && pageOfX(r.left - fl) === R.page) return true;
    return false;
  }
  const fxOnPage = (el) => onPageRects(el.getClientRects());
  function setFx(el) {
    if (R.fxEl === el) return;
    if (R.fxEl) R.fxEl.classList.remove('fx-cur');
    R.fxEl = el || null; R.fxS = 0;
    if (el) el.classList.add('fx-cur');
  }

  // предложения абзаца: конец — . ! ? … (и закрывающие кавычки), дальше пробел и заглавная буква.
  // «— спросил он» после реплики остаётся в том же предложении.
  const SENT_RE = /[.!?…]+[»"”')\]]*(?=\s+(?:[«"„“(]|[—–]\s+)?[A-ZА-ЯЁ0-9])/g;
  const sentCache = new WeakMap();
  function sentencesOf(el) {
    let out = sentCache.get(el);
    if (out) return out;
    const t = el.textContent; out = [];
    const push = (a, b) => { while (a < b && /\s/.test(t[a])) a++; while (b > a && /\s/.test(t[b - 1])) b--; if (b > a) out.push([a, b]); };
    let st = 0, m; SENT_RE.lastIndex = 0;
    while ((m = SENT_RE.exec(t))) { const e = m.index + m[0].length; push(st, e); st = e; }
    push(st, t.length);
    if (!out.length) out.push([0, t.length]);
    sentCache.set(el, out);
    return out;
  }
  function rangeIn(el, a, b) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
    let n, pos = 0, started = false;
    while ((n = tw.nextNode())) {
      const len = n.nodeValue.length;
      if (!started && a <= pos + len) { r.setStart(n, a - pos); started = true; }
      if (started && b <= pos + len) { r.setEnd(n, b - pos); return r; }
      pos += len;
    }
    if (!started) r.selectNodeContents(el); else r.setEnd(el, el.childNodes.length);
    return r;
  }
  const sentRange = () => { const ss = sentencesOf(R.fxEl); R.fxS = Math.max(0, Math.min(ss.length - 1, R.fxS || 0)); return rangeIn(R.fxEl, ss[R.fxS][0], ss[R.fxS][1]); };
  // весь текст главы, кроме текущего предложения, — приглушённым цветом (подсветка поверх текста)
  let dimStyle = null;
  function paintSent() {
    if (!window.Highlight || !CSS.highlights) return;
    // весь текст приглушён цветом самого абзаца (так тускнеют и знаки переноса), ярким подсвечено только предложение
    if (S.focus !== 'sent' || !R.fxEl || !R.book || !R.fxEl.isConnected) { CSS.highlights.delete('fxdim'); return; }
    const h = new Highlight(sentRange()); h.priority = 10;
    CSS.highlights.set('fxdim', h);
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#000';
    const css = '::highlight(fxdim) { color: ' + fg + '; }';
    if (!dimStyle) { dimStyle = document.createElement('style'); document.head.appendChild(dimStyle); }
    if (dimStyle.textContent !== css) dimStyle.textContent = css;
  }
  // первый абзац, для которого test(последний прямоугольник) верно (абзацы идут по порядку)
  function fxFirst(test) {
    const us = fxUnits();
    let lo = 0, hi = us.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rs = us[mid].getClientRects(), r = rs[rs.length - 1];
      if (r && test(r)) { k = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return k;
  }
  function fxPick(last) {
    if (!R.book || !R.nodes || !fxOn()) return;
    const us = fxUnits();
    if (!us.length) return;
    let keep = !last && R.fxEl && R.fxEl.isConnected && fxOnPage(R.fxEl);
    if (keep && isScroll()) {
      // в ленте держим фокус, пока абзац не ушёл из средней части экрана
      const vr = viewport.getBoundingClientRect(), rs = R.fxEl.getClientRects();
      keep = rs.length && rs[rs.length - 1].bottom > vr.top + vr.height * 0.12 && rs[0].top < vr.bottom - vr.height * 0.25;
    }
    if (!keep) {
      let k;
      if (isScroll()) {
        const vr = viewport.getBoundingClientRect(), line = vr.top + vr.height * 0.3;
        k = fxFirst((r) => r.bottom > line);
      } else {
        const fl = flow.getBoundingClientRect().left;
        k = fxFirst((r) => pageOfX(r.left - fl) >= R.page);
        if (last) { while (k + 1 < us.length && fxOnPage(us[k + 1])) k++; }
      }
      if (k >= 0) setFx(us[k]);
    }
    if (S.focus === 'sent' && R.fxEl) {
      // длинный абзац перешёл на новую страницу — фокус на первое видимое предложение
      const ss = sentencesOf(R.fxEl);
      const vis = (i) => onPageRects(rangeIn(R.fxEl, ss[i][0], ss[i][1]).getClientRects());
      if (!(keep && vis(Math.min(R.fxS || 0, ss.length - 1)))) {
        let i = -1;
        if (last) { for (let j = ss.length - 1; j >= 0; j--) if (vis(j)) { i = j; break; } }
        else for (let j = 0; j < ss.length; j++) if (vis(j)) { i = j; break; }
        R.fxS = i >= 0 ? i : 0;
      }
    }
    paintSent();
  }
  // показать то, на чём фокус: долистать страницу или прокрутить ленту
  function fxReveal(rs, d) {
    if (!rs.length) return;
    if (isScroll()) {
      const vr = viewport.getBoundingClientRect(), r = rs[0];
      if (r.top < vr.top + vr.height * 0.12 || r.bottom > vr.bottom - vr.height * 0.2) {
        viewport.scrollTo({ top: viewport.scrollTop + r.top - vr.top - vr.height * 0.3, behavior: S.anim ? 'smooth' : 'auto' });
      }
      return;
    }
    if (onPageRects(rs)) return;
    const fl = flow.getBoundingClientRect().left, r = d > 0 ? rs[0] : rs[rs.length - 1];
    setPage(pageOfX(r.left - fl), true);
    afterMove();
  }
  async function fxStep(d) {
    const us = fxUnits();
    if (!us.length) { d > 0 ? next() : prev(); return; }
    let i = R.fxEl ? us.indexOf(R.fxEl) : -1;
    if (i < 0) { fxPick(); i = us.indexOf(R.fxEl); }
    if (S.focus === 'sent' && i >= 0) {
      const j = (R.fxS || 0) + d, ss = sentencesOf(us[i]);
      if (j >= 0 && j < ss.length) { R.fxS = j; paintSent(); fxReveal(Array.from(sentRange().getClientRects()), d); return; }
    }
    const j = i + d;
    if (j < 0) { if (R.ch > 0) { await prev(); fxPick(true); } return; }
    if (j >= us.length) { await next(); return; }
    setFx(us[j]);
    if (S.focus === 'sent') {
      R.fxS = d > 0 ? 0 : sentencesOf(us[j]).length - 1;
      paintSent();
      fxReveal(Array.from(sentRange().getClientRects()), d);
      return;
    }
    fxReveal(Array.from(us[j].getClientRects()), d);
  }
  // клик по тексту — фокус туда (если уже там — false, и клик работает как обычно)
  function fxClick(u, x, y) {
    if (S.focus === 'para') { if (u === R.fxEl) return false; setFx(u); return true; }
    let idx = 0;
    const cr = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (cr && u.contains(cr.startContainer)) {
      const tw = document.createTreeWalker(u, NodeFilter.SHOW_TEXT); let n, pos = 0;
      while ((n = tw.nextNode())) { if (n === cr.startContainer) { idx = pos + cr.startOffset; break; } pos += n.nodeValue.length; }
    }
    const ss = sentencesOf(u);
    let si = ss.findIndex((p) => idx < p[1]); if (si < 0) si = ss.length - 1;
    if (u === R.fxEl && si === R.fxS) return false;
    setFx(u); R.fxS = si; paintSent();
    return true;
  }

  function pushHistory() {
    R.history.push({ ch: R.ch, off: R.off });
    showBackPill();
  }
  function startLinkedPreview(returnTo) {
    if (R.previewReturn) return;
    savePos.flush();
    R.previewReturn = returnTo;
    showBackPill();
  }
  async function previewInBook(ch, off) {
    if (ch < 0 || ch >= R.book.chapters.length) return;
    startLinkedPreview({ ch: R.ch, off: R.off });
    dropBackPill();
    closePanels();
    if (R.endShown) hideBookEnd(true);
    await goTo(ch, { off, keepOff: true });
  }
  function showBackPill() {
    let pill = $('back-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'back-pill'; pill.className = 'toast';
      pill.style.cursor = 'pointer';
      pill.onclick = async () => {
        const h = R.history.pop() || R.previewReturn;
        if (!h) return;
        if (h.scrollTop != null) { closeBook(false); return; }
        pill.disabled = true;
        try {
          if (R.endShown) hideBookEnd(true);
          if (!await goTo(h.ch, { off: h.off, keepOff: true })) return;
          if (h === R.previewReturn) {
            R.previewReturn = null;
            savePos();
          }
          if (!R.history.length && !R.previewReturn) pill.remove();
          else if (pill.isConnected) showBackPill();
        } finally {
          pill.disabled = false;
        }
      };
      document.body.appendChild(pill);
    }
    pill.textContent = R.previewReturn && R.history.length ? '← Назад'
      : R.previewReturn?.scrollTop != null ? '← Вернуться на главную' : '← Вернуться к чтению';
  }
  function dropBackPill() {
    R.history = [];
    if (R.previewReturn) showBackPill();
    else $('back-pill')?.remove();
  }

  // ---------- оглавление ----------
  function buildToc() {
    const b = R.book;
    const meta = L.metas[R.id];
    $('toc-cover').innerHTML = coverHtml(meta || { cover: null, title: b.title, authors: b.authors }, R.entry.name);
    if (b.cover && !(meta && meta.cover)) $('toc-cover').innerHTML = '<div class="cover"><img src="' + b.cover + '" alt=""></div>';
    $('toc-title').textContent = b.title || R.entry.name;
    $('toc-author').textContent = b.authors.join(', ');
    $('toc-list').innerHTML = b.toc.map((t, i) =>
      '<button class="toc-item depth-' + t.depth + '" data-i="' + i + '"><span class="ti-text">' + esc(t.title) + '</span><span class="ti-pct">' +
      Math.round(b.offsets[t.ch] / b.totalLen * 100) + '%</span></button>').join('') || '<div class="list-empty">Оглавления нет</div>';
  }

  function openToc(tab) {
    closePanels();
    $('toc-drawer').hidden = false; $('scrim').hidden = false;
    switchDrawerTab(tab || 'toc');
  }
  function switchDrawerTab(tab) {
    document.querySelectorAll('#drawer-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('toc-list').hidden = tab !== 'toc';
    $('bm-list').hidden = tab !== 'bookmarks';
    $('q-list').hidden = tab !== 'quotes';
    $('n-list').hidden = tab !== 'notes';
    if (tab === 'quotes') { renderQuotesList(); if (window.__syncBook) window.__syncBook(); return; }
    if (tab === 'notes') { renderNotesList(); if (window.__syncBook) window.__syncBook(); return; }
    if (tab === 'toc') {
      const cur = R.tocCurrent;
      const i = cur ? R.book.toc.indexOf(cur) : -1;
      document.querySelectorAll('#toc-list .toc-item').forEach((el) => el.classList.toggle('current', +el.dataset.i === i));
      const el = document.querySelector('#toc-list .current');
      if (el) el.scrollIntoView({ block: 'center' });
    } else renderBookmarks();
  }

  // ---------- закладки ----------
  const bookmarks = () => (LS.get('bookmarks', {})[R.id] || []);
  function setBookmarks(list) {
    const all = LS.get('bookmarks', {}); all[R.id] = list; LS.set('bookmarks', all);
    const t = LS.get('bookmarksT', {}); t[R.id] = Date.now(); LS.set('bookmarksT', t);
    if (window.__saveStateSoon) window.__saveStateSoon();
  }
  function pageRange() {
    const start = R.off;
    const end = isScroll() ? (atEnd() ? Infinity : offsetAtY(viewport.scrollTop + viewport.clientHeight - 8)) : R.page < R.pages - 1 ? offsetOfPage(R.page + 1) : Infinity;
    return [start, end];
  }
  function bookmarkHere() {
    const [s, e] = pageRange();
    return bookmarks().findIndex((b) => b.ch === R.ch && b.off >= s && b.off < e);
  }
  function toggleBookmark() {
    if (!R.book) return;
    const list = bookmarks();
    const i = bookmarkHere();
    if (i >= 0) { list.splice(i, 1); toast('Закладка удалена'); }
    else {
      list.push({ ch: R.ch, off: R.off, pct: currentPct(), text: textAt(R.off, 160), chapter: (R.tocCurrent && R.tocCurrent.title) || '', t: Date.now() });
      list.sort((a, b) => a.pct - b.pct);
      toast('Закладка добавлена');
    }
    setBookmarks(list);
    updateBookmarkFlag();
  }
  function updateBookmarkFlag() {
    const on = bookmarkHere() >= 0;
    $('bookmark-flag').hidden = !on;
    $('btn-bookmark').classList.toggle('active', on);
  }
  function renderBookmarks() {
    const list = bookmarks();
    $('bm-list').innerHTML = list.length ? list.map((b, i) =>
      '<div class="bm-row"><button class="toc-item bm" data-i="' + i + '"><span class="bm-snippet">' + esc(b.text || '…') + '</span>' +
      '<span class="bm-meta">' + Math.round(b.pct * 100) + '%' + (b.chapter ? ' · ' + esc(b.chapter) : '') + '</span></button>' +
      '<button class="icon-btn bm-del" data-del="' + i + '" title="Удалить"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>').join('')
      : '<div class="list-empty">Закладок пока нет.<br>Нажмите <b>B</b> или значок закладки сверху, чтобы отметить страницу.</div>';
  }

  // ---------- поиск по книге ----------
  // Текст главы для поиска — прямо из HTML, без разбора в DOM
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };
  function plainText(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(c) ? m : String.fromCodePoint(c); }
      return ENT[e.toLowerCase()] ?? m;
    });
  }
  function chapterTexts() {
    if (!R.texts) R.texts = R.book.chapters.map((c) => plainText(c.html));
    return R.texts;
  }
  // Нормализация для поиска: регистр, ё/е, любые пробелы и переводы строк, невидимые символы
  // (мягкий перенос, нулевой ширины, ударения) не важны. map[i] — позиция символа в исходной строке.
  function normMap(src) {
    // быстрый путь: коды символов в типизированных массивах (на большой книге первый поиск в разы быстрее);
    // если строчная буква не умещается в один символ (редкость: «İ»), — прежний общий путь, результат тот же
    const n = src.length, codes = new Uint16Array(n), map = new Int32Array(n);
    let j = 0, sp = false;
    for (let i = 0; i < n; i++) {
      let code = src.charCodeAt(i);
      if (code === 0xad || (code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff || (code >= 0x300 && code <= 0x36f)) continue;
      if (code <= 32 || code === 0xa0 || code === 0x2007 || code === 0x202f || (code >= 0x2000 && code <= 0x200a) || code === 0x3000) {
        if (sp) continue; code = 32; sp = true;
      } else {
        sp = false;
        if (code < 128) { if (code >= 65 && code <= 90) code += 32; }
        else if (code >= 0x410 && code <= 0x42f) code += 32;
        else if (code === 0x401 || code === 0x451) code = 0x435;
        else if (!(code >= 0x430 && code <= 0x44f)) {
          const l = src[i].toLowerCase();
          if (l.length !== 1) return normMapSlow(src);
          code = l.charCodeAt(0);
          if (code === 0x451) code = 0x435;
        }
      }
      codes[j] = code; map[j] = i; j++;
    }
    let t = '';
    for (let k = 0; k < j; k += 8192) t += String.fromCharCode.apply(null, codes.subarray(k, Math.min(j, k + 8192)));
    return { t, map: map.subarray(0, j) };
  }
  function normMapSlow(src) {
    const out = []; const map = []; let sp = false;
    for (let i = 0; i < src.length; i++) {
      const code = src.charCodeAt(i);
      if (code === 0xad || (code >= 0x200b && code <= 0x200f) || code === 0x2060 || code === 0xfeff || (code >= 0x300 && code <= 0x36f)) continue;
      let c = src[i];
      if (code <= 32 || code === 0xa0 || code === 0x2007 || code === 0x202f || (code >= 0x2000 && code <= 0x200a) || code === 0x3000) {
        if (sp) continue; c = ' '; sp = true;
      } else {
        sp = false;
        c = c.toLowerCase();
        if (c === 'ё') c = 'е';
      }
      out.push(c); map.push(i);
    }
    return { t: out.join(''), map };
  }
  const normQuery = (q) => normMap(q).t.trim();

  function runSearch(q) {
    const box = $('search-results');
    const nq = normQuery(q);
    R.searchIdx = -1;
    R.searchQ = nq;
    if (nq.length < 2) { box.innerHTML = ''; $('search-info').textContent = ''; R.searchRes = []; return; }
    const res = [];
    const b = R.book;
    const clean = (x) => x.replace(/[­​-‏⁠﻿]/g, '').replace(/\s+/g, ' ');
    chapterTexts().forEach((t, ch) => {
      if (res.length >= 5000) return;
      // нормализованный текст главы готовится один раз на книгу, а не при каждом запросе
      R.normCache = R.normCache || [];
      if (!R.normCache[ch]) { const nm = normMap(t); R.normCache[ch] = { t: nm.t, map: Int32Array.from(nm.map) }; }
      const { t: nt, map } = R.normCache[ch];
      let i = nt.indexOf(nq), k = 0;
      while (i >= 0 && res.length < 5000) {
        const s0 = map[i], e0 = map[i + nq.length - 1] + 1;
        res.push({ ch, k, off: s0, len: e0 - s0, frac: s0 / Math.max(1, t.length),
          before: clean(t.slice(Math.max(0, s0 - 60), s0)), hit: clean(t.slice(s0, e0)), after: clean(t.slice(e0, e0 + 80)) });
        k++;
        i = nt.indexOf(nq, i + nq.length);
      }
    });
    R.searchRes = res;
    $('search-info').textContent = res.length ? 'Найдено: ' + res.length + (res.length >= 5000 ? '+' : '') + (res.length > 500 ? ' (в списке первые 500, Enter и F3 — по всем)' : '') : 'Ничего не найдено';
    box.innerHTML = res.slice(0, 500).map((r, i) => {
      const pct = Math.round((b.offsets[r.ch] + b.chapters[r.ch].len * r.frac) / b.totalLen * 100);
      return '<button class="toc-item sr-item" data-i="' + i + '" style="flex-direction:column;align-items:stretch;gap:4px"><span class="bm-snippet">…' +
        esc(r.before) + '<mark>' + esc(r.hit) + '</mark>' + esc(r.after) + '…</span><span class="bm-meta">' + pct + '%</span></button>';
    }).join('');
  }
  // следующее (или предыдущее) совпадение относительно текущего места
  async function searchStep(dir) {
    const res = R.searchRes || [];
    if (!res.length) { toast('Сначала введите, что искать (Ctrl+F)'); return; }
    let i;
    if (R.searchIdx >= 0) i = (R.searchIdx + dir + res.length) % res.length;
    else {
      const here = (r) => r.ch > R.ch || (r.ch === R.ch && r.frac >= R.off / R.domLen - 0.0005);
      i = dir > 0 ? res.findIndex(here) : res.length - 1 - [...res].reverse().findIndex((r) => !here(r));
      if (i < 0 || i >= res.length) i = dir > 0 ? 0 : res.length - 1;
    }
    R.searchIdx = i;
    closePanels();
    await gotoSearchResult(res[i]);
    toast('Совпадение ' + (i + 1) + ' из ' + res.length + (res.length >= 5000 ? '+' : '') + ' · F3 — следующее, Shift+F3 — предыдущее');
  }
  async function gotoSearchResult(r) {
    if (!R.book) return;
    if ((r.ch !== R.ch || R.rendering || !R.nodes) && !await goTo(r.ch, { page: 0 })) return;
    if (!R.searchQ) return;
    // текст главы так, как он сейчас на экране (с теми же смещениями, что у закладок и позиции)
    let dom = '';
    const tw = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) dom += n.nodeValue.replace(SHY, '');
    const { t, map } = normMap(dom);
    const hits = [];
    let i = t.indexOf(R.searchQ);
    while (i >= 0) { hits.push(i); i = t.indexOf(R.searchQ, i + R.searchQ.length); }
    let off = null, len = 0;
    if (hits.length) {
      const h = hits[Math.min(r.k, hits.length - 1)];
      off = map[h]; len = map[h + R.searchQ.length - 1] + 1 - off;
    }
    if (off == null) { await goTo(r.ch, { off: Math.round(r.frac * R.domLen), keepOff: true }); return; }
    showOffset(off);
    afterMove(off);
    try {
      if (window.Highlight && CSS.highlights) CSS.highlights.set('search', new Highlight(rangeAt(off, len)));
    } catch (e) { /* ок */ }
  }

  // ---------- сноски ----------
  function linkTarget(a) {
    const anchor = a.dataset.anchor || null;
    const ch = a.dataset.ch != null ? R.book.resolve(+a.dataset.ch, anchor) : R.book.idMap[anchor];
    return { ch: ch == null ? null : ch, anchor };
  }

  function noteHtml(a) {
    const anchor = a.dataset.anchor;
    if (!anchor) return null;
    if (R.book.notes[anchor]) return R.book.notes[anchor];
    const ch = linkTarget(a).ch;
    if (ch == null) return null;
    R.noteCache = R.noteCache || {};
    let div = R.noteCache[ch];
    if (!div) {
      const d = document.implementation.createHTMLDocument('');
      div = d.createElement('div'); div.innerHTML = R.book.chapters[ch].html; d.body.appendChild(div);
      R.noteCache[ch] = div;
    }
    let el = div.ownerDocument.getElementById(anchor);
    if (!el) return null;
    if (/^h[1-6]$/.test(el.localName)) return null;
    // цель — сам номер сноски в тексте (или он внутри цели-якоря): это обратная ссылка из примечаний
    if ((el.localName === 'a' && el.classList.contains('noteref')) || (el.textContent.trim().length < 8 && el.querySelector && el.querySelector('a.noteref'))) return null;
    const wasPoint = el.localName === 'a' || el.textContent.trim().length < 4;
    if (wasPoint) el = el.closest('li,p,aside,dd,div,section') || el;
    // якорь внутри длинного абзаца основного текста — это обратная ссылка из примечаний: просто переходим
    if (wasPoint && el.textContent.length > 600) return null;
    if (el.textContent.trim().length < 2) {
      const nxt = el.nextElementSibling;
      if (nxt) el = nxt;
    }
    const html = el.localName === 'p' ? el.outerHTML : el.innerHTML;
    if (html.length > 20000) return null;
    return html;
  }

  function showNote(a, x, y) {
    const html = noteHtml(a);
    const { ch, anchor } = linkTarget(a);
    if (!html) { if (ch != null) goTo(ch, { anchor }, true); return; }
    const pop = $('note-pop');
    $('note-body').innerHTML = html;
    $('note-body').querySelectorAll('a').forEach((l) => { l.removeAttribute('href'); l.style.pointerEvents = 'none'; });
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(window.innerWidth - w - 16, Math.max(16, x - w / 2));
    let top = y + 18;
    if (top + h > window.innerHeight - 16) top = Math.max(16, y - h - 14);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    $('note-goto').onclick = () => { pop.hidden = true; if (ch != null) goTo(ch, { anchor }, true); };
  }

  // ---------- настройки ----------
  function buildSettings() {
    $('set-themes').innerHTML = THEMES.map((t) => '<button class="theme-dot" data-theme="' + t.id + '" title="' + t.name + '" style="background:' + t.bg + ';color:' + t.fg + '">Aa</button>').join('');
    $('font-list').innerHTML = FONTS.map((f) => '<button class="font-opt" data-font="' + f.id + '" style="font-family:\'' + f.id + '\', Georgia, serif">' + f.name + '</button>').join('');
    document.querySelector('.pad-colors').innerHTML = Object.entries(PAD_COLORS).map(([key, [label, color]]) =>
      '<button data-pad-setting="paper" data-v="' + key + '" title="' + label + '" aria-label="' + label + '" style="--swatch:' + (color || 'var(--pad-paper)') + '"></button>').join('');
    syncSettings();
  }
  function syncSettings() {
    syncPadSettings();
    document.querySelectorAll('.theme-dot').forEach((b) => b.classList.toggle('active', b.dataset.theme === S.theme));
    document.querySelectorAll('.font-opt').forEach((b) => b.classList.toggle('active', b.dataset.font === S.font));
    $('font-size-val').textContent = S.size;
    document.querySelectorAll('#set-lh button').forEach((b) => b.classList.toggle('active', +b.dataset.v === S.lh));
    document.querySelectorAll('#set-width button').forEach((b) => b.classList.toggle('active', +b.dataset.v === S.width));
    document.querySelectorAll('#set-cols button').forEach((b) => b.classList.toggle('active', b.dataset.v === String(S.cols)));
    $('set-justify').checked = S.justify; $('set-hyph').checked = S.hyph;
    const f = FONTS.find((x) => x.id === S.font) || FONTS[0];
    $('font-cur').textContent = f.name; $('font-btn').style.fontFamily = "'" + f.id + "', Georgia, serif";
    $('snd-chip').dataset.v = S.sound; $('snd-txt').textContent = { off: 'без звука', soft: 'звук тихо', loud: 'звук громче' }[S.sound];
    document.querySelectorAll('#set-auto button').forEach((b) => b.classList.toggle('active', b.dataset.v === String(S.auto)));
    document.querySelectorAll('#set-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.setTab));
    document.querySelectorAll('#settings .set-pane').forEach((p) => { p.hidden = p.dataset.pane !== S.setTab; });
    document.querySelectorAll('#set-flip button').forEach((b) => b.classList.toggle('active', b.dataset.v === S.flip));
    $('set-typo').checked = S.typo; $('set-remember').checked = S.remember !== false; $('set-guide').checked = !LS.get('guideHidden', false);
    $('set-keep-awake').checked = S.keepAwake === true;
    document.querySelectorAll('#set-focus button').forEach((b) => b.classList.toggle('active', b.dataset.v === S.focus));
  }
  const relayoutSoon = debounce(async () => {
    if (document.fonts && document.fonts.load) await document.fonts.load(S.size + 'px "' + S.font + '"').catch(() => {});
    await relayout();
  }, 60);
  function syncReadingPower() {
    native?.setReadingKeepAwake?.(S.keepAwake === true && !!R.book).catch(console.warn);
  }
  function changeSetting(k, v) {
    if (['font', 'size', 'lh', 'width', 'cols', 'justify', 'hyph', 'focus', 'typo'].includes(k)) dropClones();
    S[k] = v; saveSettings(); applyTheme(); syncSettings();
    if (k === 'font' || k === 'size') PADE?.applyAppearance();
    if (k === 'keepAwake') syncReadingPower();
    if (k === 'focus') { applyFocus(); if (fxOn()) fxPick(); }
    if (k === 'theme' && S.focus === 'sent') paintSent();
    if (k === 'typo' && R.book && !R.rendering) { renderChapter(R.ch, { off: R.off, keepOff: true }); return; }
    if (k === 'remember') renderLibrary();
    if (k === 'auto') { if (v !== 'off') toast('Автопрокрутка · ' + v + ' слов в минуту · пробел — пауза', 2600); autoSchedule(); }
    if (['font', 'size', 'lh', 'width', 'cols', 'justify', 'hyph', 'focus'].includes(k)) relayoutSoon();
  }
  function fontStep(d) {
    const sizes = [14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 36, 40];
    let i = sizes.findIndex((s) => s >= S.size); if (i < 0) i = sizes.length - 1;
    if (sizes[i] !== S.size && d < 0) i++;
    changeSetting('size', sizes[Math.max(0, Math.min(sizes.length - 1, i + d))]);
  }

  // ---------- панели, интерфейс ----------
  function closePanels() {
    for (const id of ['toc-drawer', 'search-drawer', 'settings', 'note-pop', 'scrim', 'sel-bar', 'info-card', 'quote-pop']) $(id).hidden = true;
    if (typeof hideUiSoon === 'function' && reader.classList.contains('ui')) hideUiSoon(1200);
    R.cardToken = null;
    if (window.__cancelDraft) window.__cancelDraft();
    $('btn-settings').classList.remove('active');
  }
  const anyPanel = () => ['toc-drawer', 'search-drawer', 'settings', 'note-pop', 'info-card', 'quote-pop', 'zoom'].some((id) => !$(id).hidden);

  // Панели сверху и снизу. Одно правило: видны, пока мышь у края окна или открыто окошко;
  // иначе через 2,5 с прячутся. Таймер не сдаётся: если прятать пока нельзя — проверит ещё раз.
  let uiTimer = null, mouseY = null;
  const nearEdge = () => mouseY != null && (mouseY < 70 || mouseY > window.innerHeight - 60);
  function showUi(on) { reader.classList.toggle('ui', on); if (!on) clearTimeout(uiTimer); }
  function hideUiSoon(ms) {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function tick() {
      if (reader.hidden) return;
      if (anyPanel() || nearEdge()) { uiTimer = setTimeout(tick, 600); return; }
      showUi(false);
    }, ms == null ? 2500 : ms);
  }
  // вернулись к чтению (листнули с клавиатуры или колесом) — панели убираем сразу
  function readingResumed() { if (reader.classList.contains('ui') && !anyPanel() && !nearEdge()) showUi(false); }

  let toastTimer;
  window.__toast = (m, ms) => toast(m, ms);
  // сообщение с действием («Отменить»); onExpire — когда время вышло
  function toastAction(msg, label, onAction, ms, onExpire) {
    const t = $('toast');
    t.innerHTML = '';
    t.append(document.createTextNode(msg + ' '));
    const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = label;
    let done = false;
    b.onclick = () => { if (done) return; done = true; clearTimeout(toastTimer); t.hidden = true; onAction(); };
    t.append(b); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; if (!done) { done = true; onExpire && onExpire(); } }, ms || 6000);
  }
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }

  let isFs = false;
  async function toggleFullscreen() {
    if (native && native.toggleFullscreen) { await native.toggleFullscreen(); return; }
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }
  function exitFullscreen() {
    if (native && native.setFullscreen) native.setFullscreen(false);
    else if (document.fullscreenElement) document.exitFullscreen();
  }
  function onFs(on) {
    isFs = on;
    document.body.classList.toggle('is-fs', on);
    if (on) toast('Esc — выйти из полноэкранного режима', 3000);
  }
  if (native && native.onFullscreen) native.onFullscreen(onFs);
  document.addEventListener('fullscreenchange', () => onFs(!!document.fullscreenElement));

  async function openSingleFile() {
    if (native) {
      const p = await native.pickFile();
      if (!p) return;
      await openPath(p);
      return;
    }
    $('file-input').onchange = async () => {
      const f = $('file-input').files[0]; $('file-input').value = '';
      if (!f) return;
      const e = { name: f.name, size: f.size, mtime: f.lastModified, file: f };
      if (!await identifyOpenedBook(e)) return;
      if (!L.entries.some((x) => x.id === e.id)) L.entries.push(e);
      await openEntry(e);
    };
    $('file-input').click();
  }

  async function openPath(p) {
    const st = await native.stat(p);
    if (!st) { toast('Файл не найден'); return; }
    const e = { name: st.name, size: st.size, mtime: st.mtime, path: p };
    if (!await identifyOpenedBook(e)) return;
    const existing = L.entries.find((x) => x.id === e.id);
    if (!existing) {
      const folder = LS.get('folder', '');
      const f0 = folder.replace(/[\\/]+$/, '').toLowerCase();
      // «C:\Книги2\x.fb2» не лежит в папке «C:\Книги» — сравниваем с разделителем после имени папки
      if (!folder || !(p.toLowerCase().startsWith(f0) && /[\\/]/.test(p.charAt(f0.length)))) {
        const extra = LS.get('extra', []); if (!extra.includes(p)) { extra.push(p); LS.set('extra', extra); }
      }
      L.entries.push(e);
    }
    await openEntry(e);
  }

  // ============================================================
  //                           События
  // ============================================================
  // библиотека
  $('btn-folder').onclick = $('btn-folder-empty').onclick = $('btn-folder-other').onclick = async () => {
    if (await Src.pick()) { $('folder-name').textContent = Src.folderName(); L.entries = []; await scan(); }
  };
  $('btn-reconnect').onclick = async () => {
    if (Src.kind === 'native') { $('reconnect').hidden = true; await scan(); return; }
    if (await Src.reconnect()) { $('reconnect').hidden = true; await scan(); }
  };
  $('btn-open-file').onclick = $('btn-open-file-empty').onclick = openSingleFile;
  // настройки программы — на главной, отдельно от настроек чтения
  $('btn-lib-settings').onclick = (ev) => {
    ev.stopPropagation();
    const open = $('lib-settings').hidden;
    $('lib-settings').hidden = !open; $('btn-lib-settings').classList.toggle('active', open);
    if (open) { syncSettings(); syncQuoteSettings(); }
  };
  document.addEventListener('mousedown', (ev) => {
    if (!$('lib-settings').hidden && !ev.target.closest('#lib-settings') && !ev.target.closest('#btn-lib-settings') && !ev.target.closest('#tags-pop')) { $('lib-settings').hidden = true; $('btn-lib-settings').classList.remove('active'); }
  });
  $('btn-lib-theme').onclick = () => {
    const order = THEMES.map((t) => t.id);
    const i = order.indexOf(S.theme);
    changeSetting('theme', order[(i + 1) % order.length]);
  };
  $('search').oninput = debounce(() => { if (NB.view === 'notebook') NB.query = $('search').value; else if (NB.view === 'pads') { PADV.query = $('search').value; PADV.open = null; } else { L.query = $('search').value; SH.page = 0; } renderLibrary(); }, 120);
  $('set-sort').onchange = (ev) => { S.sort = ev.target.value; saveSettings(); SH.page = 0; renderLibrary(); };
  $('lib-main').onclick = (ev) => {
    const stkEl = ev.target.closest('[data-stk]');
    if (stkEl) { ev.stopPropagation(); const g = (STK[stkEl.dataset.stk] || [])[+stkEl.dataset.g]; if (g) openSticker(stkEl.dataset.stk, g[0].id); return; }
    if (libClick(ev)) return;
    const more = ev.target.closest('[data-more]');
    if (more) { ev.stopPropagation(); const r = more.getBoundingClientRect(); bookMenu(more.closest('[data-id]').dataset.id, r.left, r.bottom + 4); return; }
    const pg = ev.target.closest('[data-shpage]');
    if (pg) { SH.page = +pg.dataset.shpage; renderShelves(); return; }
    if (ev.target.closest('#sh-new')) { SH.edit = 'new'; renderShelves(); return; }
    const vb = ev.target.closest('[data-shview]');
    if (vb) { setShelfView($('sh-view').dataset.key || SH.tab, vb.dataset.shview); return; }
    const tab = ev.target.closest('button.sh-tab');
    if (tab) { SH.tab = tab.dataset.shelf; SH.page = 0; SH.edit = null; renderShelves(); return; }
    const card = ev.target.closest('[data-id]');
    if (!card || (card.matches('.hb') && !ev.target.closest('.hb-go'))) return;
    const e = L.entries.find((x) => x.id === card.dataset.id);
    if (e) openEntry(e);
  };
  $('lib-main').addEventListener('contextmenu', (ev) => {
    const card = ev.target.closest('.book-card, .book-row, .hb'), tab = ev.target.closest('button.sh-tab[data-custom]');
    if (!card && !tab) return;
    ev.preventDefault();
    if (card) bookMenu(card.dataset.id, ev.clientX, ev.clientY); else shelfMenu(tab.dataset.shelf, ev.clientX, ev.clientY);
  });
  $('lib-main').addEventListener('mouseover', (ev) => { const t = ev.target.closest('[data-stk]'); if (t) showStkTip(t); });
  $('lib-main').addEventListener('mouseout', (ev) => { if (ev.target.closest('[data-stk]')) hideStkTip(); });
  $('lib-main').addEventListener('scroll', () => hideStkTip(true));
  $('stk-tip').addEventListener('mouseenter', () => clearTimeout(stkHide));
  $('stk-tip').addEventListener('mouseleave', () => hideStkTip());
  $('stk-tip').onclick = (ev) => { const b = ev.target.closest('[data-stkopen]') || $('stk-tip').querySelector('[data-stkopen]'); if (b) openSticker(b.dataset.stkopen, b.dataset.item); };
  $('ctx-menu').onclick = (ev) => { const b = ev.target.closest('[data-act]'); if (b) shelfAct(b); };
  $('ctx-menu').addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'cx-new') return;
    ev.stopPropagation();
    if (ev.key === 'Enter') { newShelf(ev.target.value, ev.target.dataset.book); closeCtx(); renderLibrary(); }
    else if (ev.key === 'Escape') closeCtx();
  });
  document.addEventListener('mousedown', (ev) => { if (!$('ctx-menu').hidden && !ev.target.closest('#ctx-menu') && !ev.target.closest('[data-more]')) closeCtx(); });
  $('sh-tabs').addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'sh-input') return;
    ev.stopPropagation();
    if (ev.key === 'Enter') shelfInputDone(ev.target, true); else if (ev.key === 'Escape') shelfInputDone(ev.target, false);
  });
  $('sh-tabs').addEventListener('focusout', (ev) => { if (ev.target.id === 'sh-input' && SH.edit) shelfInputDone(ev.target, true); });
  // полка листается страницами: колесо мыши (если главная не прокручивается сама) и стрелки
  let shWheel = 0, shLock = 0;
  $('lib-main').addEventListener('wheel', (ev) => {
    const m = $('lib-main');
    if (NB.view === 'notebook' || $('shelves').hidden || SH.pages < 2 || m.scrollHeight > m.clientHeight + 2 || !$('ctx-menu').hidden) return;
    shWheel += ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
    if (Date.now() < shLock || Math.abs(shWheel) < 40) return;
    shelfTurn(shWheel > 0 ? 1 : -1); shWheel = 0; shLock = Date.now() + 260;
  }, { passive: true });
  window.addEventListener('resize', debounce(() => { if (reader.hidden && !$('shelves').hidden) renderShelves(); }, 150));
  $('lib-main').addEventListener('scroll', () => document.querySelector('.lib-header').classList.toggle('scrolled', $('lib-main').scrollTop > 4));

  // читалка — верхняя панель
  $('btn-back').onclick = () => closeBook(false);
  $('btn-toc').onclick = () => openToc('toc');
  $('btn-bookmark').onclick = toggleBookmark;
  $('btn-fullscreen').onclick = toggleFullscreen;
  $('btn-search').onclick = () => {
    closePanels(); $('search-drawer').hidden = false; $('scrim').hidden = false;
    setTimeout(() => { $('book-search').focus(); $('book-search').select(); }, 50);
  };
  // для больших книг — чуть дольше ждём окончания набора и ищем от 3 букв (Enter ищет сразу)
  const runSearchFast = debounce(() => runSearch($('book-search').value), 250);
  const runSearchSlow = debounce(() => { const q = $('book-search').value.trim(); if (q.length >= 3 || !q) runSearch(q); }, 550);
  const runSearchSoon = () => (R.book && R.book.totalLen > 1500000 ? runSearchSlow : runSearchFast)();
  $('book-search').oninput = runSearchSoon;
  $('book-search').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault(); ev.stopPropagation();
    runSearch($('book-search').value);
    if (R.searchRes && R.searchRes.length) { pushHistory(); searchStep(ev.shiftKey ? -1 : 1); }
  });
  $('search-results').onclick = (ev) => {
    const b = ev.target.closest('[data-i]'); if (!b) return;
    R.searchIdx = +b.dataset.i;
    closePanels(); pushHistory(); gotoSearchResult(R.searchRes[+b.dataset.i]);
  };
  $('btn-settings').onclick = (ev) => {
    ev.stopPropagation();
    const open = $('settings').hidden;
    closePanels();
    if (open) { syncSettings(); $('settings').hidden = false; $('btn-settings').classList.add('active'); showUi(true); }
  };
  $('scrim').onclick = closePanels;
  $('drawer-tabs').onclick = (ev) => { const b = ev.target.closest('button'); if (b) switchDrawerTab(b.dataset.tab); };
  $('toc-list').onclick = (ev) => {
    const b = ev.target.closest('[data-i]'); if (!b) return;
    const t = R.book.toc[+b.dataset.i];
    closePanels(); dropBackPill();
    goTo(t.ch, t.anchor ? { anchor: t.anchor } : { page: 0 });
  };
  $('bm-list').onclick = (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { const l = bookmarks(); l.splice(+del.dataset.del, 1); setBookmarks(l); renderBookmarks(); updateBookmarkFlag(); return; }
    const b = ev.target.closest('[data-i]'); if (!b) return;
    const bm = bookmarks()[+b.dataset.i];
    closePanels(); goTo(bm.ch, { off: bm.off, keepOff: true });
  };

  // настройки
  $('settings').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const t = ev.target.closest('button');
    if (!ev.target.closest('.font-pick')) closeFontMenu();
    if (!t) return;
    if (t.dataset.tab) { S.setTab = t.dataset.tab; saveSettings(); syncSettings(); }
    else if (t.dataset.padSetting && PADE) PADE.setOption(t.dataset.padSetting, t.dataset.v);
    else if (t.id === 'font-btn') { const open = $('font-list').hidden; $('font-list').hidden = !open; t.classList.toggle('open', open); }
    else if (t.id === 'snd-chip') { const order = ['soft', 'loud', 'off']; changeSetting('sound', order[(order.indexOf(S.sound) + 1) % 3]); if (S.sound !== 'off') turnSound(S.flip === 'curl' ? 'curl' : S.flip === 'turn' ? 'turn' : 'slide', 0.66, true); }
    else if (t.parentNode.id === 'set-auto') { const v = t.dataset.v === 'off' ? 'off' : +t.dataset.v; if (v !== 'off') S.autoLast = v; AUTO.paused = false; changeSetting('auto', v); }
    else if (t.dataset.theme) changeSetting('theme', t.dataset.theme);
    else if (t.dataset.font) { changeSetting('font', t.dataset.font); closeFontMenu(); }
    else if (t.parentNode.id === 'set-lh') changeSetting('lh', +t.dataset.v);
    else if (t.parentNode.id === 'set-width') changeSetting('width', +t.dataset.v);
    else if (t.parentNode.id === 'set-focus') changeSetting('focus', t.dataset.v);
    else if (t.parentNode.id === 'set-flip') { changeSetting('flip', t.dataset.v); S.anim = S.flip !== 'off'; saveSettings(); }
    else if (t.parentNode.id === 'set-cols') changeSetting('cols', t.dataset.v === 'auto' || t.dataset.v === 'scroll' ? t.dataset.v : +t.dataset.v);
    else if (t.id === 'font-inc') fontStep(1);
    else if (t.id === 'font-dec') fontStep(-1);
  });
  function closeFontMenu() { $('font-list').hidden = true; $('font-btn').classList.remove('open'); }
  $('set-justify').onchange = (e) => changeSetting('justify', e.target.checked);
  $('set-hyph').onchange = (e) => changeSetting('hyph', e.target.checked);
  $('set-typo').onchange = (e) => changeSetting('typo', e.target.checked);
  $('set-keep-awake').closest('label').hidden = !native?.setReadingKeepAwake;
  $('set-keep-awake').onchange = (e) => changeSetting('keepAwake', e.target.checked);
  $('set-remember').onchange = (e) => changeSetting('remember', e.target.checked);
  $('set-guide').onchange = (e) => setGuide(e.target.checked);
  document.addEventListener('click', (ev) => {
    if (!$('settings').hidden && !ev.target.closest('#settings') && !ev.target.closest('#btn-settings')) { $('settings').hidden = true; $('btn-settings').classList.remove('active'); }
    if (!$('note-pop').hidden && !ev.target.closest('#note-pop') && !ev.target.closest('a.noteref')) $('note-pop').hidden = true;
  });

  // листание мышью: клик у левого/правого края листает, но ссылки и сноски — в приоритете
  // зоны листания — только поля слева и справа от текста (плюс узкая полоска у края текста)
  const zoneOf = (x) => {
    const sr = stage.getBoundingClientRect(), vr = textRect();
    const l = vr.left - sr.left, r = vr.right - sr.left;
    return x < l - 2 ? 'l' : x > r + 2 ? 'r' : '';
  };
  let downAt = null;
  stage.addEventListener('mousedown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: Date.now() }; });
  // листание кликом — только если мышь не тянули (иначе это выделение текста)
  const plainClick = (ev) => downAt && Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y) < 6 && Date.now() - downAt.t < 600;
  // курсор прячется, пока читаете (и после листания клавишами), и появляется только при движении мыши
  let lastMouse = null, cursorTimer = null;
  const hideCursor = () => { clearTimeout(cursorTimer); reader.classList.add('no-cursor'); };
  reader.addEventListener('mousemove', (ev) => {
    const moved = !lastMouse || Math.abs(ev.screenX - lastMouse[0]) + Math.abs(ev.screenY - lastMouse[1]) > 3;
    lastMouse = [ev.screenX, ev.screenY];
    if (!moved) return;
    reader.classList.remove('no-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { if (!anyPanel()) hideCursor(); }, 2000);
  });
  document.addEventListener('keydown', () => { if (!reader.hidden && !anyPanel()) hideCursor(); });
  stage.addEventListener('mousemove', (ev) => {
    const z = ev.target.closest('a') ? '' : zoneOf(ev.clientX - stage.getBoundingClientRect().left);
    stage.classList.toggle('zone-l', z === 'l'); stage.classList.toggle('zone-r', z === 'r');
  });
  stage.addEventListener('click', (ev) => {
    if (ev.target.closest('#book-end')) return;
    const im = ev.target.closest('img, image');
    if (im && flow.contains(im) && !String(window.getSelection()) && plainClick(ev) && !anyPanel() && zoomable(im)) { ev.preventDefault(); openZoom(im); return; }
    const a = ev.target.closest('a');
    if (a && flow.contains(a)) {
      ev.preventDefault();
      if (a.classList.contains('noteref')) { showNote(a, ev.clientX, ev.clientY); return; }
      if (a.classList.contains('internal')) {
        const { ch, anchor } = linkTarget(a);
        if (ch != null) goTo(ch, anchor ? { anchor } : { page: 0 }, true);
        return;
      }
      const href = a.getAttribute('href');
      if (/^https?:/i.test(href)) { if (native) native.openExternal(href); else window.open(href, '_blank', 'noopener'); }
      return;
    }
    if (String(window.getSelection())) return;
    if (window.__popDirty && window.__popDirty()) return; // несохранённая мысль — окошко не закрываем
    if (anyPanel()) { closePanels(); return; }
    const hitQ = quoteAtPoint(ev.clientX, ev.clientY);
    if (hitQ) { openSaved(hitQ, [{ left: ev.clientX - 1, right: ev.clientX + 1, top: ev.clientY - 10, bottom: ev.clientY + 10 }]); return; }
    if (!plainClick(ev)) return;
    const z = zoneOf(ev.clientX - stage.getBoundingClientRect().left);
    if (fxOn() && !z) {
      const u = ev.target.closest('.fxu');
      if (u && flow.contains(u) && fxClick(u, ev.clientX, ev.clientY)) return;
    }
    if (z === 'l' && zoneOf(downAt.x - stage.getBoundingClientRect().left) === 'l') { prev(); return; }
    if (z === 'r' && zoneOf(downAt.x - stage.getBoundingClientRect().left) === 'r') { next(); return; }
    showUi(!reader.classList.contains('ui'));
    if (reader.classList.contains('ui')) hideUiSoon();
  });

  let wheelAcc = 0, wheelLock = 0;
  flow.addEventListener('copy', (ev) => {
    const t = String(window.getSelection()).replace(/[\u00ad\u200b]/g, '').replace(/\u00a0/g, ' ');
    if (!t) return;
    ev.clipboardData.setData('text/plain', t);
    ev.preventDefault();
  });
  stage.addEventListener('wheel', (ev) => {
    if (!R.book) return;
    const d = Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
    // «Абзац»: колесо переводит фокус по абзацам (и само листает, когда абзацы на странице кончились)
    if (fxOn()) {
      ev.preventDefault();
      if (Math.sign(d) !== Math.sign(wheelAcc)) wheelAcc = 0;
      wheelAcc += ev.deltaMode === 1 ? d * 30 : d;
      const now = Date.now();
      if (now < wheelLock || Math.abs(wheelAcc) < 50) return;
      fxStep(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0; wheelLock = now + 170;
      return;
    }
    if (isScroll()) {
      if ((d > 0 && !atEnd()) || (d < 0 && !atStart())) { wheelAcc = 0; return; }
      ev.preventDefault();
      wheelAcc += d;
      if (Date.now() < wheelLock || Math.abs(wheelAcc) < 260) return;
      wheelAcc > 0 ? next() : prev();
      wheelAcc = 0; wheelLock = Date.now() + 700;
      return;
    }
    ev.preventDefault();
    wheelAcc += d;
    const now = Date.now();
    if (now < wheelLock) return;
    if (Math.abs(wheelAcc) >= 30) {
      wheelAcc > 0 ? next() : prev();
      wheelAcc = 0; wheelLock = now + 280;
    }
  }, { passive: false });

  // свайпы (сенсорные экраны)
  let touchX = null;
  stage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX == null || isScroll()) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
  });

  reader.addEventListener('mousemove', (ev) => {
    mouseY = ev.clientY;
    if (nearEdge()) { showUi(true); hideUiSoon(); }
  });
  // мышь ушла из окна (например, к заголовку Windows) — край больше не держит панели
  document.documentElement.addEventListener('mouseleave', () => { mouseY = null; if (!reader.hidden && reader.classList.contains('ui')) hideUiSoon(800); });

  // клавиатура
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'F1') { ev.preventDefault(); toggleHelp(); return; }
    if (!$('help').hidden) { if (ev.key === 'Escape') { ev.preventDefault(); toggleHelp(false); } return; }
    if (!zoomEl.hidden) {
      ev.preventDefault();
      if (ev.key === 'Escape') closeZoom();
      else if (ev.key === '+' || ev.key === '=' || ev.code === 'NumpadAdd') zoomBy(1.4);
      else if (ev.key === '-' || ev.code === 'NumpadSubtract') zoomBy(1 / 1.4);
      else if (ev.key === '0') zoomFit();
      return;
    }
    const typing = ev.target.matches('input, textarea');
    if (reader.hidden) {
      if (ev.key === 'Escape' && !$('ctx-menu').hidden) { closeCtx(); return; }
      if (!typing && !$('shelves').hidden && $('ctx-menu').hidden && $('lib-settings').hidden && (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === 'ArrowLeft' || ev.key === 'PageUp')) {
        if (shelfTurn(ev.key === 'ArrowRight' || ev.key === 'PageDown' ? 1 : -1)) ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape' && (!$('lib-settings').hidden || !$('tags-pop').hidden)) { $('lib-settings').hidden = true; $('tags-pop').hidden = true; $('btn-lib-settings').classList.remove('active'); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyF' || ev.key === '/' && !typing) { ev.preventDefault(); $('search').focus(); $('search').select(); }
      if (ev.key === 'Escape' && !typing && isFs) { exitFullscreen(); return; }
      if (ev.key === 'F11') { ev.preventDefault(); toggleFullscreen(); return; }
      if (ev.key === 'Escape' && typing) { ev.target.value = ''; if (NB.view === 'notebook') NB.query = ''; else if (NB.view === 'pads') PADV.query = ''; else L.query = ''; renderLibrary(); ev.target.blur(); }
      return;
    }
    if (ev.key === 'Escape') {
      if (!$('font-list').hidden) { closeFontMenu(); return; }
      if (window.__popDirty && window.__popDirty()) { window.__confirmLeave(); return; }
      if (anyPanel() || !$('tags-pop').hidden) { closePanels(); $('tags-pop').hidden = true; showUi(false); }
      else if (padOpen()) closePad();
      else if (String(window.getSelection())) window.getSelection().removeAllRanges();
      else if (isFs) exitFullscreen();
      else if (CSS.highlights && CSS.highlights.has('search')) CSS.highlights.delete('search');
      else closeBook(false);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyF') {
      ev.preventDefault();
      if ($('search-drawer').hidden) $('btn-search').click(); else { $('book-search').focus(); $('book-search').select(); }
      return;
    }
    if (ev.key === 'F3' || ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyG')) { ev.preventDefault(); searchStep(ev.shiftKey ? -1 : 1); return; }
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === 'Equal' || ev.code === 'NumpadAdd')) { ev.preventDefault(); fontStep(1); return; }
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === 'Minus' || ev.code === 'NumpadSubtract')) { ev.preventDefault(); fontStep(-1); return; }
    if (ev.key === 'F11') { ev.preventDefault(); toggleFullscreen(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyN') { ev.preventDefault(); togglePad(); return; }
    if (typing || (ev.key === ' ' && ev.target.closest('#sel-bar button'))) return;
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); if (fxOn()) fxStep(1); else next(isScroll() ? Math.round(S.size * S.lh * 3) : 0); break;
      case 'ArrowUp': ev.preventDefault(); if (fxOn()) fxStep(-1); else prev(isScroll() ? Math.round(S.size * S.lh * 3) : 0); break;
      case 'ArrowRight': case 'PageDown': ev.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp': ev.preventDefault(); prev(); break;
      case ' ': ev.preventDefault(); if (autoOn()) autoToggle(); break; // пробел — только пауза автопрокрутки
      case 'Home': ev.preventDefault(); goTo(R.ch, { page: 0 }); break;
      case 'End': ev.preventDefault(); if (isScroll()) viewport.scrollTop = viewport.scrollHeight; else setPage(R.pages - 1, false); afterMove(); break;
      default:
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
        if (ev.code === 'KeyT') openToc('toc');
        else if (ev.code === 'KeyB') toggleBookmark();
        else if (ev.code === 'KeyN') { ev.preventDefault(); togglePad(); }
        else if (ev.code === 'KeyF') toggleFullscreen();
    }
  });

  window.addEventListener('resize', () => { if (FLIP.key) dropClones(); });
  window.addEventListener('resize', debounce(() => { if (!reader.hidden) relayout(); }, 120));

  // перетаскивание файла в окно
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f || !/\.(fb2|epub|zip)$/i.test(f.name)) return;
    if (native && native.pathOf) { const p = native.pathOf(f); if (p) return openPath(p); }
    const entry = { name: f.name, size: f.size, mtime: f.lastModified, file: f };
    if (!await identifyOpenedBook(entry)) return;
    if (!L.entries.some((x) => x.id === entry.id)) L.entries.push(entry);
    openEntry(entry);
  });

  // ============================================================
  //        Выделение текста: перевод · значение · цитата
  // ============================================================
  const selBar = $('sel-bar'), infoCard = $('info-card'), quotePop = $('quote-pop');
  let quoteRects = null;
  let menuSelection = null;
  const ZW_RE = /[­​-‏⁠﻿]/g;
  const normalizeQuoteText = (text) => text.replace(ZW_RE, '').split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

  // логическое смещение точки (узел, позиция) от начала главы
  function logAt(container, offset) {
    const r = document.createRange();
    r.setStart(flow, 0);
    try { r.setEnd(container, offset); } catch (e) { return 0; }
    return r.toString().replace(SHY, '').length;
  }
  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const rg = sel.getRangeAt(0);
    if (!flow.contains(rg.commonAncestorContainer)) return null;
    const raw = sel.toString().replace(ZW_RE, '');
    const text = normalizeQuoteText(raw);
    if (!text) return null;
    let off = logAt(rg.startContainer, rg.startOffset);
    let end = logAt(rg.endContainer, rg.endOffset);
    // без пробелов по краям
    const lead = raw.replace(SHY, '').match(/^\s*/)[0].length, trail = raw.replace(SHY, '').match(/\s*$/)[0].length;
    off += lead; end -= trail;
    return { range: rg, text, off, len: Math.max(1, end - off) };
  }
  // видимые прямоугольники выделения (в листании часть может быть за краем)
  function visibleRects(rg) {
    const vr = viewport.getBoundingClientRect();
    return Array.from(rg.getClientRects()).filter((r) => r.width > 0 && r.right > vr.left + 2 && r.left < vr.right - 2 && r.bottom > vr.top && r.top < vr.bottom);
  }
  function placeNear(el, rects, below) {
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    const first = rects[0], last = rects[rects.length - 1];
    const cx = below ? (last.left + last.right) / 2 : (first.left + first.right) / 2;
    let left = Math.min(window.innerWidth - w - 12, Math.max(12, cx - w / 2));
    let top = below ? last.bottom + 12 : first.top - h - 10;
    if (top < 64) top = last.bottom + 12;
    if (top + h > window.innerHeight - 12) top = Math.max(12, first.top - h - 10);
    if (el === quotePop || el === selBar) top = Math.max(12, Math.min(top, window.innerHeight - h - 12));
    if (el === quotePop) el.style.setProperty('--quote-pop-left', left + 'px');
    else el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function sameSelection(a, b) { return !!a && !!b && a.off === b.off && a.len === b.len && a.text === b.text; }
  function showSelBar() {
    const s = currentSelection();
    if (!s) { hideSelBar(); return; }
    const rects = visibleRects(s.range);
    if (!rects.length) { hideSelBar(); return; }
    if (!sameSelection(s, menuSelection) || R.book !== menuSelection.book || R.ch !== menuSelection.ch) {
      menuSelection = { off: s.off, len: s.len, text: s.text, book: R.book, ch: R.ch };
      $('sel-status').textContent = '';
    }
    placeNear(selBar, rects, false);
  }
  function hideSelBar() { selBar.hidden = true; menuSelection = null; $('sel-status').textContent = ''; }
  function positionQuotePop() {
    if (!quotePop.hidden && quoteRects) placeNear(quotePop, quoteRects, true);
  }
  const quoteResize = new ResizeObserver(positionQuotePop);
  quoteResize.observe(quotePop);
  flow.addEventListener('mouseup', () => setTimeout(showSelBar, 10));
  document.addEventListener('keyup', (ev) => { if (!reader.hidden && ev.shiftKey) setTimeout(showSelBar, 10); });
  document.addEventListener('selectionchange', () => { const s = window.getSelection(); if (!s || s.isCollapsed) hideSelBar(); });
  viewport.addEventListener('scroll', hideSelBar);
  window.addEventListener('resize', () => { if (!selBar.hidden) showSelBar(); positionQuotePop(); });
  selBar.addEventListener('mousedown', (ev) => ev.preventDefault()); // не сбрасывать выделение

  selBar.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const s = currentSelection(); if (!s) return;
    if (b.dataset.act === 'share') {
      const selectedBook = R.book, chapter = R.ch;
      $('sel-status').textContent = '';
      const result = await exportQuote(s.text, b);
      if (selBar.hidden || selectedBook !== R.book || chapter !== R.ch || !sameSelection(s, currentSelection())) return;
      if (result?.error) {
        $('sel-status').textContent = result.error;
        showSelBar();
      } else if (result?.saved) {
        hideSelBar();
        if (result.message) toast(result.message);
      }
      return;
    }
    hideSelBar();
    const rects = visibleRects(s.range);
    if (b.dataset.act === 'translate') showTranslation(s.text, rects, padSource(s));
    else if (b.dataset.act === 'meaning') showMeaning(s.text, rects, padSource(s));
    else if (b.dataset.act === 'quote') startDraft(s, rects, 'quote');
    else if (b.dataset.act === 'note') startDraft(s, rects, 'note');
  });

  // ---------- сеть ----------
  const NET_WAIT = 15000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res({ ok: false, status: 0, timeout: true, text: '' }), ms))]);
  async function netJson(url) {
    let r;
    if (native && native.netGet) r = await withTimeout(native.netGet(url), NET_WAIT);
    else {
      try {
        const x = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(NET_WAIT) : undefined });
        r = { ok: x.ok, status: x.status, text: await x.text() };
      } catch (e) { r = { ok: false, status: 0, timeout: !!e && e.name === 'TimeoutError', text: '' }; }
    }
    if (!r || !r.ok) {
      const e = new Error(r && r.timeout ? 'сервер не ответил вовремя' : r && r.status ? 'HTTP ' + r.status : 'нет связи');
      e.offline = !(r && (r.status || r.timeout)); e.status = (r && r.status) || 0;
      throw e;
    }
    try { return JSON.parse(r.text); } catch (e) { throw new Error('непонятный ответ сервера'); }
  }
  const openUrl = (u) => { if (native) native.openExternal(u); else window.open(u, '_blank', 'noopener'); };
  const langName = (code) => { try { return new Intl.DisplayNames(['ru'], { type: 'language' }).of(code) || code; } catch (e) { return code; } };
  const cardLoading = (title) => '<div class="ic-head"><span class="ic-kicker">' + title + '</span></div><div class="ic-loading"><div class="spinner"></div></div>';
  const cardError = (err) => '<div class="ic-empty">' + (err && err.offline ? 'Нет подключения к интернету' : 'Не удалось получить ответ' + (err && err.message ? ' (' + esc(err.message) + ')' : '')) + '</div>';
  function openCard(html, rects) {
    infoCard.hidden = false;
    $('ic-body').innerHTML = html;
    placeNear(infoCard, rects, true);
    infoCard.dataset.anchor = JSON.stringify(rects.map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
  }
  function refreshCard(html) {
    $('ic-body').innerHTML = html;
    try { placeNear(infoCard, JSON.parse(infoCard.dataset.anchor), true); } catch (e) { /* ок */ }
  }

  // ---------- перевод (Google) ----------
  async function gtx(text, tl) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(tl) +
      '&dt=t&dt=bd&dj=1&q=' + encodeURIComponent(text.slice(0, 4500));
    const d = await netJson(url);
    return {
      src: d.src || '',
      text: (d.sentences || []).map((x) => x.trans || '').join(''),
      dict: (d.dict || []).map((x) => ({ pos: x.pos, terms: (x.terms || []).slice(0, 6) })),
      tl,
    };
  }
  async function showTranslation(text, rects, source) {
    const token = (R.cardToken = Math.random());
    openCard(cardLoading('Перевод'), rects);
    try {
      const tl = S.lang || 'ru';
      let t = await gtx(text, tl);
      // текст уже на нужном языке — переводим на английский (или на русский)
      if (t.src && t.src.split('-')[0] === tl.split('-')[0]) t = await gtx(text, tl === 'ru' ? 'en' : 'ru');
      if (token !== R.cardToken) return;
      const gUrl = 'https://translate.google.com/?sl=' + encodeURIComponent(t.src || 'auto') + '&tl=' + encodeURIComponent(t.tl) + '&text=' + encodeURIComponent(text.slice(0, 4500)) + '&op=translate';
      refreshCard('<div class="ic-head"><span class="ic-kicker">' + esc(langName(t.src || 'auto')) + ' → ' + esc(langName(t.tl)) + '</span></div>' +
        '<div class="ic-main">' + esc(t.text).replace(/\n/g, '<br>') + '</div>' +
        (t.dict.length ? '<div class="ic-dict">' + t.dict.map((d) => '<div><span class="ic-pos">' + esc(d.pos) + '</span> ' + esc(d.terms.join(', ')) + '</div>').join('') + '</div>' : '') +
        '<div class="ic-foot"><button class="link-btn" data-url="' + esc(gUrl) + '">Открыть в Google Переводчике ↗</button></div>');
      if (t.text) offerPadResult(source, text, t.text);
    } catch (err) {
      if (token === R.cardToken) refreshCard('<div class="ic-head"><span class="ic-kicker">Перевод</span></div>' + cardError(err));
    }
  }

  // ---------- значение (Викисловарь + Википедия) ----------
  function wiktMeanings(extract, isLatin) {
    const lines = extract.split('\n');
    const head = (l) => { const m = l.match(/^(=+)\s*(.*?)\s*=+\s*$/); return m ? { lvl: m[1].length, title: m[2] } : null; };
    const want = isLatin ? ['Английский', 'Латинский', 'Французский', 'Немецкий'] : ['Русский'];
    let langLvl = 0, inLang = false, inMeaning = false;
    const out = [];
    for (const l of lines) {
      const h = head(l);
      if (h) {
        if (want.some((w) => h.title.startsWith(w))) { inLang = true; langLvl = h.lvl; inMeaning = false; continue; }
        if (inLang && h.lvl <= langLvl && !/^\S+\s+(I|II|III|IV|V|\d)\b/.test(h.title) && !want.some((w) => h.title.startsWith(w))) { if (out.length) break; inLang = false; }
        inMeaning = inLang && /^Значени/.test(h.title);
        continue;
      }
      if (!inMeaning) continue;
      let t = l.replace(/^[#*:\s]+/, '').split('◆')[0].trim();
      t = t.replace(/\s+/g, ' ').replace(/[;,]\s*$/, '');
      if (t.length < 2 || /^Отсутству|^\?/.test(t)) continue;
      out.push(t);
      if (out.length >= 6) break;
    }
    return out;
  }
  async function wiktionary(word) {
    const isLatin = /^[a-z]/i.test(word);
    const api = 'https://ru.wiktionary.org/w/api.php?format=json&origin=*&formatversion=2';
    const fetchPage = async (title) => {
      const d = await netJson(api + '&action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=' + encodeURIComponent(title));
      const pg = d && d.query && d.query.pages && d.query.pages[0];
      return pg && !pg.missing && !pg.invalid && pg.extract ? { title: pg.title, extract: pg.extract } : null;
    };
    const lower = word.toLowerCase();
    const tried = new Set();
    const tryTitle = async (t) => {
      if (!t || tried.has(t)) return null;
      tried.add(t);
      const pg = await fetchPage(t);
      const means = pg ? wiktMeanings(pg.extract, isLatin) : [];
      return means.length ? { title: pg.title, means, url: 'https://ru.wiktionary.org/wiki/' + encodeURIComponent(pg.title) } : null;
    };
    // «безмятежным» → «безмятежный»; имена собственные («Москва») — с заглавной
    let r = (await tryTitle(lower)) || (await tryTitle(word));
    if (r) return r;
    // словоформа — ищем словарную форму (в статьях Викисловаря есть таблицы со всеми формами)
    const s = await netJson(api + '&action=query&list=search&srlimit=6&srprop=&srsearch=' + encodeURIComponent(lower));
    const stem = lower.replace(/ё/g, 'е').slice(0, 3);
    const cands = ((s && s.query && s.query.search) || []).map((x) => x.title)
      .filter((t) => !t.includes(':') && t.toLowerCase().replace(/ё/g, 'е').slice(0, 3) === stem);
    for (const c of cands.slice(0, 3)) { r = await tryTitle(c); if (r) return r; }
    return null;
  }
  // текст введения статьи без ударений, сносок и пустых скобок
  const cleanExtract = (t) => String(t || '').replace(/[\u0300\u0301]/g, '').replace(/\[\d+\]/g, '').replace(/[;,]?\s*произношение(\s*\(инф\.\))?/g, '')
    .replace(/\((?:\s*[,;]?\s*)\)/g, '').replace(/[ \t]+/g, ' ').replace(/ ([,.;:])/g, '$1').trim();
  async function wikipedia(query, lang) {
    const base = 'https://' + lang + '.wikipedia.org';
    // одним запросом: введение, картинка, «неоднозначность», краткое описание; перенаправления — сразу
    const page = async (title) => {
      const d = await netJson(base + '/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1' +
        '&prop=extracts|pageimages|pageprops|description&exintro=1&explaintext=1&exchars=1200&piprop=thumbnail&pithumbsize=250&ppprop=disambiguation' +
        '&titles=' + encodeURIComponent(title));
      const pg = d && d.query && d.query.pages && d.query.pages[0];
      if (!pg || pg.missing || pg.invalid) return null;
      const disamb = !!(pg.pageprops && 'disambiguation' in pg.pageprops);
      const extract = cleanExtract(pg.extract);
      if (!extract && !disamb) return null;
      const thumb = pg.thumbnail && pg.thumbnail.source ? String(pg.thumbnail.source).replace(/^\/\//, 'https://').replace(/^http:/, 'https:') : '';
      return { title: pg.title, desc: pg.description || '', extract, thumb: /^https:\/\/upload\.wikimedia\.org\//.test(thumb) ? thumb : '',
        disamb, url: base + '/wiki/' + encodeURIComponent(pg.title.replace(/ /g, '_')) };
    };
    const exact = await page(query);
    if (exact) return exact;
    // точного названия нет — ближайшее по поиску
    const os = await netJson(base + '/w/api.php?action=opensearch&format=json&origin=*&limit=1&namespace=0&redirects=resolve&search=' + encodeURIComponent(query));
    const title = Array.isArray(os) && os[1] && os[1][0];
    return title && title !== query ? page(title) : null;
  }
  // картинка: в программе — через главный процесс (data: URL), в веб-версии — прямой адрес
  const thumbCache = new Map();
  async function loadThumb(url) {
    if (!url) return '';
    if (!(native && native.netImage)) return url;
    if (thumbCache.has(url)) return thumbCache.get(url);
    let d = '';
    try { d = (await withTimeout(native.netImage(url), NET_WAIT)) || ''; } catch (e) { d = ''; }
    if (typeof d !== 'string' || !/^data:image\/(jpeg|png|gif|webp);base64,/.test(d)) d = '';
    if (d) { thumbCache.set(url, d); if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value); }
    return d;
  }
  const meaningCache = new Map();
  let lastMeaning = null;
  async function showMeaning(text, rects, source) {
    const token = (R.cardToken = Math.random());
    lastMeaning = { text, rects, source };
    // без ударений (за\u0301мок), мягких переносов, неразрывных пробелов и знаков по краям
    const q = text.replace(/[\u0300\u0301\u00ad\u200b-\u200f\u2060\ufeff]/g, '').replace(/[\s\u00a0]+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').slice(0, 120).trim();
    openCard(cardLoading('Значение'), rects);
    if (!q) { refreshCard('<div class="ic-head"><span class="ic-kicker">Значение</span></div><div class="ic-empty">Выделите слово или название</div>'); return; }
    const words = q.split(' ').length;
    const isLatin = /^[\p{Script=Latin}\s\d'’-]+$/u.test(q);
    const dictFirst = words === 1 && q === q.toLowerCase();
    const cached = meaningCache.get(q);
    let dict = cached ? cached.dict : null, wiki = cached ? cached.wiki : null, errDict = null, errWiki = null, img = '';
    const render = (done) => {
      if (token !== R.cardToken) return;
      const parts = [];
      const dictHtml = dict ? '<div class="ic-sec"><div class="ic-kicker">Викисловарь</div><div class="ic-word">' + esc(dict.title) + '</div><ol class="ic-means">' +
        dict.means.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ol><button class="link-btn" data-url="' + esc(dict.url) + '">Открыть статью ↗</button></div>' : '';
      const ext = wiki ? (wiki.extract.length > 700 ? wiki.extract.slice(0, 700).replace(/\s\S*$/, '') + '…' : wiki.extract) : '';
      const wikiHtml = !wiki ? '' : wiki.disamb
        ? '<div class="ic-sec"><div class="ic-kicker">Википедия</div><div class="ic-word">' + esc(wiki.title) + '</div>' +
          '<div class="ic-desc">У этого слова несколько значений — выберите нужное в Википедии</div>' +
          '<button class="link-btn" data-url="' + esc(wiki.url) + '">Список значений ↗</button></div>'
        : '<div class="ic-sec"><div class="ic-kicker">Википедия</div>' + (img ? '<img class="ic-thumb" src="' + esc(img) + '" alt="">' : '') +
          '<div class="ic-word">' + esc(wiki.title) + '</div>' + (wiki.desc ? '<div class="ic-desc">' + esc(wiki.desc) + '</div>' : '') +
          '<p class="ic-extract">' + esc(ext) + '</p>' +
          '<button class="link-btn" data-url="' + esc(wiki.url) + '">Читать в Википедии ↗</button></div>';
      if (dictFirst) parts.push(dictHtml, wikiHtml); else parts.push(wikiHtml, dictHtml);
      let html = parts.filter(Boolean).join('');
      const err = errDict || errWiki;
      if (!done) html += '<div class="ic-loading small"><div class="spinner"></div></div>';
      else if (!html) {
        html = '<div class="ic-head"><span class="ic-kicker">Значение</span></div>' +
          (err ? cardError(err) + '<div class="ic-foot"><button class="link-btn" data-retry="1">Попробовать ещё раз</button></div>'
            : '<div class="ic-empty">Ничего не нашлось для «' + esc(q) + '»</div>');
      } else if (err && !(dict && wiki)) {
        html += '<div class="ic-empty small">' + (errDict ? 'Викисловарь сейчас не ответил' : 'Википедия сейчас не ответила') + (err.offline ? '' : ' (' + esc(err.message) + ')') + '</div>';
      }
      refreshCard(html);
      if (done) offerPadResult(source, text, dict?.means.join('\n') || ext);
    };
    const showImg = async () => {
      if (!wiki || wiki.disamb || !wiki.thumb) return;
      const d = await loadThumb(wiki.thumb);
      if (d && token === R.cardToken) { img = d; render(!pending); }
    };
    let pending = true;
    if (cached) { pending = false; render(true); showImg(); return; }
    const tasks = [];
    if (words <= 3) tasks.push(wiktionary(q).then((x) => { dict = x; render(false); }).catch((e) => { errDict = e; }));
    tasks.push(wikipedia(q, 'ru').then(async (x) => { wiki = x || (isLatin ? await wikipedia(q, 'en') : null); render(false); showImg(); }).catch((e) => { errWiki = e; }));
    await Promise.all(tasks);
    // словоформа без статьи в Википедии — пробуем словарную форму («кошкой» → «Кошка»)
    if (!wiki && !errWiki && dict && dict.title.toLowerCase() !== q.toLowerCase()) {
      try { wiki = await wikipedia(dict.title, 'ru'); showImg(); } catch (e) { /* ок: словарь уже есть */ }
    }
    pending = false;
    if (!errDict && !errWiki && (dict || wiki)) { meaningCache.set(q, { dict, wiki }); if (meaningCache.size > 100) meaningCache.delete(meaningCache.keys().next().value); }
    render(true);
  }
  infoCard.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-retry]');
    if (r && lastMeaning) showMeaning(lastMeaning.text, lastMeaning.rects, lastMeaning.source);
  });
  // картинка не загрузилась — убрать, без «битого» значка
  infoCard.addEventListener('error', (ev) => { if (ev.target && ev.target.classList && ev.target.classList.contains('ic-thumb')) ev.target.remove(); }, true);
  infoCard.addEventListener('click', (ev) => { const b = ev.target.closest('[data-url]'); if (b) openUrl(b.dataset.url); });

  // ---------- цитаты ----------
  const allQuotes = () => LS.get('quotes', {});
  const bookQuotes = () => (allQuotes()[R.id] || []);
  function setBookQuotes(list) { const a = allQuotes(); a[R.id] = list; LS.set('quotes', a); }
  const recentTags = () => LS.get('quoteTags', []);
  function rememberTags(tags) {
    const list = recentTags().filter((t) => !tags.includes(t));
    LS.set('quoteTags', tags.concat(list).slice(0, 24));
  }
  const cleanTag = (t) => t.replace(/^#+/, '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_\-/]/gu, '').slice(0, 40);

  // ---------- папка дневника ----------
  async function quotesDir() {
    if (!native) return null;
    if (S.quotesDir) return S.quotesDir;
    const books = LS.get('folder', '');
    if (books) {
      const res = native.diaryDir ? await native.diaryDir(books) : native.quotesDefaultDir ? { dir: await native.quotesDefaultDir(books) } : { dir: null };
      if (res.renamed) {
        const movePath = (p) => typeof p === 'string' && p.startsWith(res.old) && /^[\\/]/.test(p.slice(res.old.length))
          ? res.dir + p.slice(res.old.length) : p;
        for (const store of ['quotes', 'notes']) {
          const all = LS.get(store, {});
          for (const items of Object.values(all)) for (const it of items) if (it.file) it.file = movePath(it.file);
          LS.set(store, all);
        }
        const paths = LS.get('notePaths', {});
        for (const id of Object.keys(paths)) paths[id] = movePath(paths[id]);
        LS.set('notePaths', paths);
        toast('Папка «Цитаты» переименована в «Читательский дневник».', 5000);
      } else if (res.kept && !R.keptWarned) {
        R.keptWarned = true;
        S.quotesDir = res.dir; saveSettings(); syncQuoteSettings();
        toast('Папка «Цитаты» сейчас занята другой программой — записи остаются в ней.', 6000);
      }
      return res.dir;
    }
    toast('Выберите папку для читательского дневника');
    const p = await native.pickFolder('Папка читательского дневника');
    if (p) { S.quotesDir = p; saveSettings(); syncQuoteSettings(); }
    return p || null;
  }
  const bookAuthor = () => (R.book.authors[0] || 'Неизвестный автор').trim();
  const bookTitle = () => (R.book.title || R.entry.name.replace(BOOK_RE, '')).trim();
  const yamlStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const linkName = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120);
  const ruDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  const shorten = (t, n) => t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t;
  const polkaLinkFor = (bookId, it) => 'polka://open?book=' + encodeURIComponent(bookId) +
    (it ? '&ch=' + it.ch + '&off=' + it.off + '&len=' + (it.len || 0) + (it.kind === 'note' ? '&n=' : '&q=') + it.id : '');

  // ---------- записи: цитаты и заметки ----------
  const allNotes = () => LS.get('notes', {});
  const bookNotes = () => (allNotes()[R.id] || []);
  function setBookNotes(list) { const a = allNotes(); a[R.id] = list; LS.set('notes', a); }
  const quoteById = (id) => bookQuotes().find((x) => x.id === id);
  const noteById = (id) => bookNotes().find((x) => x.id === id);
  const itemById = (kind, id) => kind === 'note' ? noteById(id) : quoteById(id);
  function updateItem(kind, id, patch) {
    const list = kind === 'note' ? bookNotes() : bookQuotes();
    const it = list.find((x) => x.id === id);
    if (it) { Object.assign(it, patch); kind === 'note' ? setBookNotes(list) : setBookQuotes(list); }
    return it ? Object.assign({ kind }, it) : null;
  }
  const updateQuote = (id, patch) => updateItem('quote', id, patch);
  const allItems = () => bookQuotes().map((q) => Object.assign({ kind: 'quote' }, q)).concat(bookNotes().map((n) => Object.assign({ kind: 'note' }, n)))
    .sort((a, b) => a.ch - b.ch || a.off - b.off);
  const allBookThoughts = () => LS.get('bookNotes', {});

  // ---- Читательский дневник в Obsidian — главное хранилище записей ----
  // Авторы/<Автор>.md — автор и его книги
  // Книги/<Название>.md (или «Название (Автор)» для одноимённых книг) — «Мои мысли о книге»,
  //   затем по ходу книги блоки [!quote] (цитаты) и [!note] (заметки)
  // .polka/state.json — место чтения и закладки (Obsidian его не показывает, OneDrive синхронизирует)
  // Всё, что нужно, записывается сразу; при открытии книги «Полка» подтягивает правки из Obsidian.
  let noteChain = Promise.resolve();
  const serial = (fn) => (noteChain = noteChain.then(fn, fn));

  // снимок «какая книга» в момент действия — запись не перепутается, если сразу открыть другую
  function noteCtx() {
    return { id: R.id, title: bookTitle(), author: bookAuthor(), series: (R.book && R.book.series) || '', items: allItems() };
  }

  const quoteLines = (txt) => txt.split('\n').map((l) => '> ' + l).join('\n>\n');
  const bodyLines = (txt) => txt.replace(/\s+$/, '').split('\n').map((l) => l.trim() ? '> ' + l : '>').join('\n');
  function footLine(it, ctx) {
    const tags = (it.tags || []).map((t) => '#' + t).join(' ');
    return '> ' + (tags ? tags + ' · ' : '') + ruDate(it.t) + ' · [открыть в Полке](' + polkaLinkFor(ctx.id, it) + ')';
  }
  function itemBlock(it, ctx) {
    const head = [it.chapter, Math.round(it.pct * 100) + '%'].filter(Boolean).join(' · ');
    if (it.kind === 'note') {
      const frag = it.text ? '> *«' + shorten(it.text.replace(/\s*\n\s*/g, ' ').replace(/[*_]/g, ''), 320) + '»*\n>\n' : '';
      return '> [!note] ' + head + '\n' + frag + bodyLines(it.body || '') + '\n>\n' + footLine(it, ctx) + '\n';
    }
    return '> [!quote] ' + head + '\n' + quoteLines(it.text) + '\n' +
      (it.note ? '>\n> ---\n' + bodyLines(it.note) + '\n' : '') + '>\n' + footLine(it, ctx) + '\n';
  }
  // блок записи находим по её ссылке «открыть в Полке» (в ней зашит номер)
  function findBlock(lines, id) {
    // номер из файла мог быть исправлен вручную: спецзнаки регулярных выражений — как обычные буквы
    const re = new RegExp('[?&][qn]=' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)');
    let foot = lines.findIndex((l) => l.startsWith('>') && re.test(l));
    if (foot < 0) {
      const mark = lines.findIndex((l) => l.trim() === '^' + id);
      if (mark < 0) return null;
      foot = mark - 1;
      while (foot >= 0 && lines[foot].trim() === '') foot--;
    }
    let start = foot;
    while (start > 0 && !/^> \[!(quote|note)\]/.test(lines[start]) && lines[start - 1].startsWith('>')) start--;
    let end = foot;
    if ((lines[end + 1] || '').trim() === '^' + id) end += 1;
    else if ((lines[end + 1] || '').trim() === '' && (lines[end + 2] || '').trim() === '^' + id) end += 2;
    return { start, end, foot };
  }
  // разбор блока из файла — для синхронизации с Obsidian и восстановления
  function parseBlock(lines, blk) {
    const rows = lines.slice(blk.start, blk.foot + 1).map((l) => l.replace(/^>\s?/, ''));
    const head = rows[0] || '';
    const kind = /^\[!note\]/.test(head) ? 'note' : 'quote';
    const foot = rows[rows.length - 1] || '';
    const parts = foot.split(' · ');
    const tags = parts[0].trim().startsWith('#') ? parts[0].trim().split(/\s+/).map((t) => t.replace(/^#+/, '')).filter(Boolean) : [];
    const link = (foot.match(/\((polka:[^)\s]+)\)/) || [])[1] || '';
    const headText = head.replace(/^\[!(quote|note)\]\s*/, '');
    const pctM = headText.match(/(?:^|·\s*)(\d{1,3})%\s*$/);
    const chapter = headText.replace(/\s*·?\s*\d{1,3}%\s*$/, '').trim();
    let inner = rows.slice(1, -1);
    while (inner.length && !inner[inner.length - 1].trim()) inner.pop();
    if (kind === 'note') {
      let text = '';
      if (inner.length && /^\*«[\s\S]*»\*$/.test(inner[0].trim())) { text = inner[0].trim().slice(2, -2); inner = inner.slice(1); }
      while (inner.length && !inner[0].trim()) inner.shift();
      return { kind, tags, link, chapter, pct: pctM ? +pctM[1] / 100 : 0, text, body: inner.join('\n') };
    }
    const sep = inner.findIndex((l) => l.trim() === '---');
    const textLines = sep >= 0 ? inner.slice(0, sep) : inner;
    const text = textLines.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean).join('\n');
    return { kind, tags, link, chapter, pct: pctM ? +pctM[1] / 100 : 0, text, note: sep >= 0 ? inner.slice(sep + 1).join('\n').trim() : '' };
  }
  const linkParam = (link, k) => { const m = String(link).match(new RegExp('[?&]' + k + '=([^&)]+)')); try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } };
  const tidy = (lines) => lines.filter((l) => !/^\^q[0-9a-z]{2,}$/.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n');

  // папка дневника без вопросов пользователю (для фоновых действий)
  async function quotesDirQuiet() {
    if (!native) return null;
    if (S.quotesDir) return S.quotesDir;
    const books = LS.get('folder', '');
    return books ? quotesDir() : null;
  }

  // заметка автора: список книг; заодно чиним испорченные прошлыми версиями (обрывки ссылок, повторы «## Книги»)
  function repairAuthorNote(md) {
    const out = []; const seen = new Set(); let inBooks = false, hadSection = false;
    for (const l of md.split('\n')) {
      if (l.trim() === '## Книги') { inBooks = true; if (hadSection) continue; hadSection = true; out.push(l); continue; }
      if (inBooks && /^##? /.test(l)) inBooks = false;
      if (inBooks && /^- \[\[/.test(l)) {
        const ok = /^- \[\[[^\[\]\n]+\]\]\s*$/.test(l);
        if (ok && !seen.has(l.trim())) { seen.add(l.trim()); out.push(l.trim()); }
        continue;
      }
      if (inBooks && /^[^\[]*\]\]\s*$/.test(l)) continue; // хвост обрывка вида « 000 000]]»
      out.push(l);
    }
    return out.join('\n');
  }
  async function ensureAuthorNote(dir, author, bookName) {
    const p = await native.noteCreate({ dir, sub: ['Авторы'], name: author, onlyIfMissing: true,
      content: '---\nтип: автор\n---\n\n# ' + author + '\n\n## Книги\n' });
    const md0 = await readNoteForUpdate(p);
    let md = repairAuthorNote(md0);
    const line = '- [[' + bookName + ']]';
    if (!md.split('\n').some((l) => l.trim() === line)) {
      // вставка функцией — знаки $ в названии не «оживают» как шаблон замены
      md = /\n## Книги\n/.test(md) ? md.replace(/(\n## Книги\n(?:- .*\n)*)/, (m) => m + line + '\n') : md.replace(/\s*$/, '') + '\n\n## Книги\n' + line + '\n';
    }
    if (md !== md0) await native.noteWrite(p, md);
  }
  // заметка книги: своё имя для каждой книги (одноимённые книги разных авторов не смешиваются)
  const bookKeyMatches = (key, id) => key === id || LS.get('bookAliases', {})[key] === id;
  const noteBelongs = (md, id) => { const m = md.match(/^polka: "polka:\/\/open\?book=([^"&]+)/m); try { return !!m && bookKeyMatches(decodeURIComponent(m[1]), id); } catch (e) { return false; } };
  async function readNoteForUpdate(p) {
    const md = await native.noteRead(p);
    if (md == null) throw new Error('Файл дневника исчез во время сохранения');
    return md;
  }
  const baseName = (p) => String(p).split(/[\\/]/).pop().replace(/\.md$/i, '');
  async function bookNotePath(ctx, create) {
    const dir = create ? await quotesDir() : await quotesDirQuiet();
    if (!dir) return null;
    const map = LS.get('notePaths', {});
    if (map[ctx.id]) { const md = await native.noteRead(map[ctx.id]); if (md != null && noteBelongs(md, ctx.id)) return map[ctx.id]; }
    const author = linkName(ctx.author), title = linkName(ctx.title);
    const names = [title, linkName(title + ' (' + author + ')')];
    for (let i = 2; i <= 5; i++) names.push(linkName(title + ' (' + author + ') ' + i));
    for (const name of names) {
      const p = await native.noteResolve({ dir, sub: ['Книги'], name });
      const md = await native.noteRead(p);
      if (md != null) {
        if (noteBelongs(md, ctx.id)) { map[ctx.id] = p; LS.set('notePaths', map); return p; }
        continue; // занято другой книгой — пробуем «Название (Автор)»
      }
      if (!create) continue;
      await ensureAuthorNote(dir, author, name);
      const created = await native.noteCreate({ dir, sub: ['Книги'], name, onlyIfMissing: true,
        content: '---\nавтор: ' + yamlStr('[[' + author + ']]') + '\n' + (ctx.series ? 'серия: ' + yamlStr(ctx.series) + '\n' : '') +
          'тип: книга\npolka: ' + yamlStr(polkaLinkFor(ctx.id)) + '\n---\n\n# ' + ctx.title + '\n\n[[' + author + ']] · [открыть в Полке](' + polkaLinkFor(ctx.id) + ')\n' });
      map[ctx.id] = created; LS.set('notePaths', map);
      return created;
    }
    return null;
  }
  async function ensureBookNote(ctx) {
    const p = await bookNotePath(ctx, true);
    if (p) { const dir = await quotesDir(); if (dir) await ensureAuthorNote(dir, linkName(ctx.author), baseName(p)); }
    return p;
  }
  // запись блока; changed — какие поля меняет «Полка» (остальные правки из Obsidian сохраняются)
  const writeItem = (it, ctx, changed) => serial(async () => {
    ctx = ctx || noteCtx();
    const p = await ensureBookNote(ctx);
    if (!p) return null;
    const md = await readNoteForUpdate(p);
    if (!noteBelongs(md, ctx.id)) throw new Error('Файл дневника относится к другой книге');
    const lines = md.split('\n');
    const blk = findBlock(lines, it.id);
    if (blk && changed) {
      const f = parseBlock(lines, blk);
      if (!changed.includes('tags')) it.tags = f.tags;
      if (it.kind === 'quote') { if (f.text) it.text = f.text; if (!changed.includes('note')) it.note = f.note || undefined; }
      else if (!changed.includes('body')) it.body = f.body;
    }
    const block = itemBlock(it, ctx).trimEnd().split('\n');
    if (blk) lines.splice(blk.start, blk.end - blk.start + 1, ...block);
    else {
      // по порядку в книге: перед первой записью, которая идёт дальше по тексту
      const later = ctx.items.filter((x) => x.id !== it.id && (x.ch > it.ch || (x.ch === it.ch && x.off > it.off)));
      let at = -1;
      for (const x of later) { const b2 = findBlock(lines, x.id); if (b2 && (at < 0 || b2.start < at)) at = b2.start; }
      if (at >= 0) lines.splice(at, 0, ...block, '');
      else { while (lines.length && lines[lines.length - 1].trim() === '') lines.pop(); lines.push('', ...block, ''); }
    }
    await native.noteWrite(p, tidy(lines));
    setupGraph();
    return p;
  });
  // теги — только в последней строке блока, остальное (в т.ч. правки в Obsidian) не трогаем
  const writeItemTags = (it, ctx) => serial(async () => {
    if (!it.file) return;
    const md = await native.noteRead(it.file);
    if (md == null) return;
    const lines = md.split('\n');
    const blk = findBlock(lines, it.id);
    if (!blk) return;
    lines[blk.foot] = footLine(it, ctx || noteCtx());
    await native.noteWrite(it.file, tidy(lines));
  });
  const removeItemBlock = (file, id) => serial(async () => {
    if (!file) return;
    const md = await native.noteRead(file);
    if (md == null) return;
    const lines = md.split('\n');
    const blk = findBlock(lines, id);
    if (!blk) return;
    lines.splice(blk.start, blk.end - blk.start + 1);
    await native.noteWrite(file, tidy(lines));
  });
  // «Мои мысли о книге» — раздел вверху заметки книги
  const writeBookThoughts = (body, ctx) => serial(async () => {
    ctx = ctx || noteCtx();
    const p = await ensureBookNote(ctx);
    if (!p) return null;
    const md = await readNoteForUpdate(p);
    if (!noteBelongs(md, ctx.id)) throw new Error('Файл дневника относится к другой книге');
    const lines = md.split('\n');
    const r = bookThoughtsRange(lines);
    const at = r ? r.at : sectionStart(lines);
    if (r) lines.splice(at, r.after - at);
    if (body.trim()) lines.splice(at, 0, '', BOOK_SEC, '', ...body.trim().split('\n'), '');
    await native.noteWrite(p, tidy(lines));
    setupGraph();
    return p;
  });

  async function saveBookThoughts(body, ctx) {
    const local = body.trim() ? 'Сохранено в Полке' : 'Впечатление удалено в Полке';
    const entry = { body, t: Date.now(), pending: !!native };
    const all = allBookThoughts();
    if (body.trim() || native) all[ctx.id] = entry; else delete all[ctx.id];
    if (!LS.set('bookNotes', all)) return { message: 'Не удалось сохранить впечатление в Полке', failed: true };
    if (!native) return { message: local };
    try {
      if (await writeBookThoughts(body, ctx)) {
        const current = allBookThoughts();
        if (current[ctx.id]?.pending && current[ctx.id].t === entry.t && current[ctx.id].body === body) {
          if (body.trim()) current[ctx.id].pending = false; else delete current[ctx.id];
          LS.set('bookNotes', current);
        }
        return { message: body.trim() ? 'Сохранено в дневник' : 'Впечатление удалено' };
      }
      return { message: local + '. Папка дневника не выбрана или файл недоступен', failed: true };
    } catch (err) {
      console.error(err);
      return { message: local + '. Не удалось обновить файл дневника', failed: true };
    }
  }

  // ---- синхронизация с дневником при открытии книги ----
  // • правки из Obsidian (мысли, теги, текст цитаты) переносятся в «Полку»;
  // • записи, удалённые в Obsidian, исчезают и здесь;
  // • записи, которых в «Полке» нет (новый компьютер, переустановка), восстанавливаются из дневника;
  // • записи одноимённой книги, попавшие в чужую заметку (прошлые версии), переезжают в свою.
  async function syncBook() {
    if (!native || !R.book) return;
    const book = R.book, ctx = noteCtx();
    await runPendingDeletes();
    if (R.book !== book) return;
    const p = await bookNotePath(ctx, false);
    if (R.book !== book) return;
    let changed = 0, restored = 0, removed = 0;
    const lists = { quote: bookQuotes(), note: bookNotes() };
    if (p) {
      const md = await native.noteRead(p);
      if (md == null) return;
      // заметка автора: ссылка на эту книгу есть и не испорчена
      const dir = await quotesDirQuiet();
      if (dir) await serial(() => ensureAuthorNote(dir, linkName(ctx.author), baseName(p)));
      if (R.book !== book) return;
      const lines = md.split('\n');
      const ids = new Set();
      for (const kind of ['quote', 'note']) {
        for (const it of lists[kind].slice()) {
          ids.add(it.id);
          const blk = findBlock(lines, it.id);
          if (!blk) {
            if (it.file && baseName(it.file) !== baseName(p)) continue; // лежит в другом файле — разберёмся ниже
            if (it.file) { lists[kind].splice(lists[kind].indexOf(it), 1); removed++; }
            continue;
          }
          const f = parseBlock(lines, blk);
          const patch = {};
          if (f.tags.join(' ') !== (it.tags || []).join(' ')) patch.tags = f.tags;
          if (kind === 'quote') {
            if (f.text && f.text !== it.text) patch.text = f.text;
            if ((f.note || '') !== (it.note || '')) patch.note = f.note || undefined;
          } else if (f.body !== (it.body || '')) patch.body = f.body;
          if (it.file !== p) patch.file = p;
          if (Object.keys(patch).length) { Object.assign(it, patch); if (!('file' in patch && Object.keys(patch).length === 1)) changed++; }
        }
      }
      // восстановление: блоки этой книги, которых нет в «Полке»
      lines.forEach((l, i) => {
        if (!/^>/.test(l) || !/\[открыть в Полке\]\(polka:/.test(l)) return;
        const link = (l.match(/\((polka:[^)\s]+)\)/) || [])[1];
        const id = linkParam(link, 'q') || linkParam(link, 'n');
        if (!id || ids.has(id) || !bookKeyMatches(linkParam(link, 'book'), ctx.id)) return;
        const blk = findBlock(lines, id);
        if (!blk) return;
        const f = parseBlock(lines, blk);
        const ch = +linkParam(link, 'ch'), off = +linkParam(link, 'off');
        if (!(ch >= 0 && ch < R.book.chapters.length) || !(off >= 0)) return;
        const it = { id, ch, off, len: +linkParam(link, 'len') || (f.text || '').length || 1, text: f.text || '', chapter: f.chapter, pct: f.pct, tags: f.tags, t: Date.now(), file: p, v2: true };
        if (f.kind === 'note') it.body = f.body; else if (f.note) it.note = f.note;
        lists[f.kind].push(it);
        ids.add(id); restored++;
      });
      // мысли о книге
      const r = bookThoughtsRange(lines);
      const bt = r ? lines.slice(r.at + 1, r.e).join('\n').trim() : '';
      const all = allBookThoughts();
      if (bt && !all[R.id]?.pending && bt !== ((all[R.id] || {}).body || '').trim()) { all[R.id] = { body: bt, t: Date.now() }; LS.set('bookNotes', all); changed++; }
      if (!bt && all[R.id] && r === null && (all[R.id].body || '').trim()) { /* в файле раздела нет — оставляем как есть */ }
    }
    // записи, лежащие в чужой (общей) заметке — переносим в свою
    let own = p;
    if (!own) {
      // своей заметки нет, а записи лежат в заметке другой книги с тем же названием — заводим свою
      for (const kind of ['quote', 'note']) for (const it of lists[kind]) {
        if (own || !it.file || !it.v2) continue;
        const md = await native.noteRead(it.file);
        if (R.book !== book) return;
        if (md != null && !noteBelongs(md, ctx.id)) own = await bookNotePath(ctx, true);
      }
    }
    if (R.book !== book) return;
    const strays = [];
    for (const kind of ['quote', 'note']) for (const it of lists[kind]) if (it.file && own && baseName(it.file) !== baseName(own) && it.v2) strays.push(Object.assign({ kind }, it));
    lists.quote.sort((a, b) => a.ch - b.ch || a.off - b.off); lists.note.sort((a, b) => a.ch - b.ch || a.off - b.off);
    setBookQuotes(lists.quote); setBookNotes(lists.note);
    for (const it of strays) {
      const old = it.file;
      const np = await writeItem(it, ctx, ['tags', 'note', 'body']);
      if (np) { markItemExported(ctx.id, it.kind, it.id, np); await removeItemBlock(old, it.id); }
      if (R.book !== book) return;
    }
    if (changed || restored || removed || strays.length) {
      paintQuotes(); refreshLists(); // молча: дневник — встроенная часть программы
    }
  }

  // ---- удаление с возможностью отменить ----
  // блок из файла убирается через несколько секунд; если программу закрыли раньше — при следующем запуске
  async function runPendingDeletes() {
    const pend = LS.get('pendingDeletes', []);
    if (!pend.length || !native) return;
    for (const d of pend) {
      await removeItemBlock(d.file, d.id);
      LS.set('pendingDeletes', LS.get('pendingDeletes', []).filter((x) => x.file !== d.file || x.id !== d.id));
    }
  }

  // переезд со старой схемы «файл на цитату» (при открытии книги)
  async function migrateQuotes() {
    if (!native || !R.book) return;
    const book = R.book, ctx = noteCtx();
    await tidyNotes();
    if (R.book !== book) return;
    const old = bookQuotes().filter((q) => q.file && !q.v2);
    if (old.length) {
      const dir = await quotesDir();
      if (R.book !== book) return;
      const oldName = linkName(ctx.author + ' — ' + ctx.title);
      for (const q of old) {
        const md = await native.noteRead(q.file);
        const p = await writeItem(Object.assign({ kind: 'quote' }, q), ctx);
        if (p) {
          markItemExported(ctx.id, 'quote', q.id, p);
          if (p !== q.file && md && /\npolka: "polka:/.test(md)) await native.noteDelete(q.file);
        }
        if (R.book !== book) return;
      }
      if (dir) {
        const hub = await native.noteResolve({ dir, sub: ['Книги'], name: oldName });
        const hmd = hub && await native.noteRead(hub);
        if (hmd && !hmd.includes('[!quote]') && /tags:\n {2}- книга/.test(hmd) && oldName !== linkName(ctx.title)) await native.noteDelete(hub);
        await native.noteRmdir({ dir, sub: [oldName] });
      }
    }
    if (R.book !== book) return;
    if (ctx.items.some((it) => it.pendingDiary) && await quotesDirQuiet()) {
      for (const it of ctx.items.filter((it) => it.pendingDiary)) {
        const p = await writeItem(it, ctx);
        if (p) markItemExported(ctx.id, it.kind, it.id, p);
      }
      if (R.book !== book) return;
    }
    await syncBook();
    if (R.book !== book) return;
    await syncPadFromDiary().catch((e) => console.warn(e));
  }
  // заметки прошлых версий: убрать метки «^q…», служебные теги #книга/#автор → «тип»
  async function tidyNotes() {
    const files = Array.from(new Set(bookQuotes().filter((q) => q.file && q.v2).map((q) => q.file)));
    if (!files.length) return;
    const author = bookAuthor();
    const dir = await quotesDirQuiet();
    if (dir) files.push(await native.noteResolve({ dir, sub: ['Авторы'], name: linkName(author) }));
    for (const f of files) await serial(async () => {
      const md = await native.noteRead(f);
      if (md == null) return;
      let fixed = tidy(md.split('\n')).replace(/^(---\n[\s\S]*?)tags:\n {2}- (книга|автор)\n(?=\S)/, '$1тип: $2\n');
      if (/\n## Книги\n/.test(fixed)) fixed = repairAuthorNote(fixed);
      if (fixed !== md) await native.noteWrite(f, fixed);
    });
    setupGraph();
  }
  // граф Obsidian: показать теги, раскрасить авторов и книги (один раз на хранилище)
  async function setupGraph() {
    if (!native || !native.obsidianGraph || R.graphChecked) return;
    R.graphChecked = true;
    const dir = await quotesDirQuiet();
    if (!dir) return;
    const done = LS.get('graphSetup', []);
    const res = await native.obsidianGraph(dir, done);
    if (res && res.vault && res.stuck && !done.includes(res.vault)) LS.set('graphSetup', done.concat(res.vault));
  }

  // ---- место чтения и закладки в папке дневника (.polka/state.json) ----
  let stateTimer = null;
  function saveStateSoon() {
    if (!native || !native.dataWrite) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(saveStateNow, 2500);
  }
  async function saveStateNow() {
    clearTimeout(stateTimer); stateTimer = null;
    const dir = await quotesDirQuiet();
    if (!dir) return;
    const state = { v: 1, saved: Date.now(), progress: progress(), bookmarks: LS.get('bookmarks', {}), bookmarksT: LS.get('bookmarksT', {}), shelves: shelves(), shelvesT: LS.get('shelvesT', 0) };
    try { await native.dataWrite(dir, 'state.json', JSON.stringify(state)); }
    catch (e) { console.warn(e); }
  }
  // при запуске: взять более свежее (например, с другого компьютера через OneDrive)
  async function loadStateFromDiary() {
    if (!native || !native.dataRead) return;
    const dir = await quotesDirQuiet();
    if (!dir) return;
    let st = null;
    try { st = JSON.parse((await native.dataRead(dir, 'state.json')) || 'null'); } catch (e) { st = null; }
    if (!st) { saveStateSoon(); return; }
    const prog = progress(); let n = 0;
    if (typeof st !== 'object') st = {};
    // файл могли испортить руками или синхронизацией: берём только похожие на правду записи
    for (const [id, p] of Object.entries(st.progress || {})) if (p && typeof p === 'object' && (!prog[id] || (p.t || 0) > (prog[id].t || 0))) { prog[id] = p; n++; }
    if (n) LS.set('progress', prog);
    const bm = LS.get('bookmarks', {}), bmT = LS.get('bookmarksT', {});
    for (const [id, list] of Object.entries(st.bookmarks || {})) {
      const t = (st.bookmarksT || {})[id] || 0;
      if (Array.isArray(list) && (!bm[id] || t > (bmT[id] || 0))) { bm[id] = list; bmT[id] = t; }
    }
    LS.set('bookmarks', bm); LS.set('bookmarksT', bmT);
    if (Array.isArray(st.shelves) && (st.shelvesT || 0) > LS.get('shelvesT', 0)) { LS.set('shelves', st.shelves); LS.set('shelvesT', st.shelvesT); }
  }

  async function saveItem(kind, s, tags, body) {
    const ctx = noteCtx();
    const it = { id: newId(kind === 'note' ? 'n' : 'q'), ch: R.ch, off: s.off, len: s.len, text: s.text,
      chapter: (R.tocCurrent && R.tocCurrent.title !== R.book.title && R.tocCurrent.title) || '', pct: currentPct(), tags: tags || [], t: Date.now(), pendingDiary: !!native };
    if (kind === 'note') it.body = body || ''; else if (body && body.trim()) it.note = body.trim();
    const list = kind === 'note' ? bookNotes() : bookQuotes();
    list.push(it);
    list.sort((a, b) => a.ch - b.ch || a.off - b.off);
    kind === 'note' ? setBookNotes(list) : setBookQuotes(list);
    ctx.items = allItems();
    if (it.tags.length) rememberTags(it.tags);
    paintQuotes();
    let status = 'Сохранено';
    if (native) {
      try { const p = await writeItem(Object.assign({ kind }, it), ctx); if (p) markItemExported(ctx.id, kind, it.id, p); else status = 'Сохранено в книге (папка не выбрана)'; }
      catch (err) { status = 'Сохранено в книге, но в дневник не записано. Повторим при открытии книги'; console.error(err); toast(status, 5000); }
    } else status = 'Сохранено в книге';
    return { it: itemById(kind, it.id), status };
  }

  function markItemExported(bookId, kind, itemId, file) {
    const store = kind === 'note' ? 'notes' : 'quotes';
    const all = LS.get(store, {});
    const it = (all[bookId] || []).find((item) => item.id === itemId);
    if (!it) return;
    Object.assign(it, { file, v2: true });
    delete it.pendingDiary;
    LS.set(store, all);
  }

  function originalQuoteText(item) {
    const chapter = item && R.book.chapters[item.ch];
    if (!chapter || !Number.isSafeInteger(item.off) || !Number.isSafeInteger(item.len) || item.off < 0 || item.len < 1) return '';
    // Смещения записи относятся к тексту главы без мягких переносов.
    const source = document.createElement('template');
    source.innerHTML = chapter.html;
    const walker = document.createTreeWalker(source.content, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const end = item.off + item.len;
    let startFound = false;
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = offset + logLen(node.nodeValue);
      if (!startFound && item.off < next) {
        range.setStart(node, logToRaw(node, item.off - offset));
        startFound = true;
      }
      if (startFound && end <= next) {
        range.setEnd(node, logToRaw(node, end - offset));
        const blocks = 'address,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,li,ol,p,pre,section,table,td,th,tr,ul';
        const fragment = range.cloneContents();
        for (const block of fragment.querySelectorAll(blocks)) {
          block.before('\n');
          if (block.localName !== 'br') block.after('\n');
        }
        return normalizeQuoteText(fragment.textContent);
      }
      offset = next;
    }
    return '';
  }

  let exportingQuote = false;
  async function exportQuote(text, button) {
    if (exportingQuote || !R.book) return;
    exportingQuote = true;
    button.disabled = true;
    try {
      if (!text) throw new Error('Не удалось найти исходный фрагмент в книге. Выделите его заново.');
      const title = normalizeQuoteText(bookTitle()).replace(/\n/g, ' ') || 'Без названия';
      const author = R.book.authors.map((name) => normalizeQuoteText(name).replace(/\n/g, ' ')).filter(Boolean).join(', ') || 'Неизвестный автор';
      const cover = R.book.cover || L.metas[R.id]?.cover;
      const typeset = text.split('\n').map(typoText).join('\n');
      const blob = await window.PolkaQuoteCard.render({ text: typeset, title, author, cover });
      const name = 'Цитата — ' + title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 90).trim() + '.png';
      if (native?.saveQuotePng) {
        const saved = await native.saveQuotePng({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        return { saved, message: saved ? 'Карточка сохранена' : '' };
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return { saved: true };
      }
    } catch (err) {
      return { error: err.message || 'Не удалось сохранить карточку' };
    } finally {
      exportingQuote = false;
      button.disabled = false;
    }
  }

  // ---------- окошко записи: черновик или сохранённая цитата / заметка ----------
  // pop = { mode: 'draft' | 'saved', kind: 'quote' | 'note', id, s, tags, body0 }
  let pop = null;
  const qpBody = $('qp-body');
  function quoteNotice(text, error = false) {
    const notice = $('qp-notice');
    notice.classList.toggle('is-error', error);
    notice.textContent = text;
  }
  function cancelDraft() {
    pop = null;
    quoteRects = null;
    quoteNotice('');
    if (CSS.highlights) CSS.highlights.delete('draft');
  }
  const popDirty = () => !!pop && !quotePop.hidden && (pop.mode === 'draft' ? qpBody.value.trim().length > 0 : qpBody.value !== pop.body0);
  function hideQuotePop() { quotePop.hidden = true; $('qp-suggest').hidden = true; $('qp-link-suggest').hidden = true; cancelDraft(); }
  function syncPopButtons() {
    const draft = pop.mode === 'draft';
    $('qp-save').hidden = !(draft || popDirty());
    $('qp-cancel').hidden = !draft;
    $('qp-delete').hidden = draft;
    $('qp-export').hidden = pop.kind !== 'quote';
    $('qp-delete').textContent = pop.kind === 'note' ? 'Удалить заметку' : 'Удалить цитату';
  }
  function showBody(on, focus) {
    $('qp-body-wrap').hidden = !on;
    $('qp-addthought').hidden = on || pop.kind === 'note';
    if (on) { autoGrow(qpBody); if (focus) setTimeout(() => qpBody.focus(), 30); }
  }
  function openPop(p, rects, status) {
    infoCard.hidden = true; R.cardToken = null;
    quotePop.hidden = true; $('qp-suggest').hidden = true; $('qp-link-suggest').hidden = true;
    if (CSS.highlights) CSS.highlights.delete('draft');
    pop = p;
    quoteRects = rects;
    quoteNotice('');
    quotePop.dataset.kind = p.kind;
    $('qp-status').textContent = status;
    $('qp-text').textContent = shorten(p.text || '', 240);
    $('qp-text').hidden = !p.text;
    qpBody.value = p.body0 || '';
    qpBody.placeholder = p.kind === 'note' ? 'Ваша мысль…' : 'Мысль к цитате…';
    $('qp-tag-input').value = '';
    renderQuoteTags();
    showBody(p.kind === 'note' || !!p.body0, p.mode === 'draft' && p.kind === 'note');
    syncPopButtons();
    placeNear(quotePop, rects, true);
    $('qp-content').scrollTop = 0;
  }
  function startDraft(s, rects, kind) {
    window.getSelection().removeAllRanges();
    const same = (x) => x.ch === R.ch && x.off === s.off && x.len === s.len;
    const dup = kind === 'note' ? bookNotes().find(same) : bookQuotes().find(same);
    if (dup) {
      if (native && kind === 'quote') {
        const ctx = noteCtx();
        writeItem(Object.assign({ kind }, dup), ctx).then((p) => p && markItemExported(ctx.id, kind, dup.id, p)).catch(() => {});
      }
      openSaved(Object.assign({ kind }, dup), rects, kind === 'note' ? 'Эта заметка уже есть' : 'Эта цитата уже сохранена'); return;
    }
    openPop({ mode: 'draft', kind, s, text: s.text, tags: [], body0: '' }, rects, kind === 'note' ? 'Новая заметка' : 'Новая цитата');
    try { if (window.Highlight) CSS.highlights.set('draft', new Highlight(rangeAt(s.off, s.len))); } catch (e) { /* ок */ }
  }
  function openSaved(it, rects, status) {
    openPop({ mode: 'saved', kind: it.kind, id: it.id, text: it.text, tags: it.tags || [], body0: (it.kind === 'note' ? it.body : it.note) || '' },
      rects, status || (it.kind === 'note' ? 'Заметка' : 'Цитата'));
  }
  async function commitPop() {
    if (!pop) return;
    quoteNotice('');
    const body = qpBody.value.replace(/\s+$/, '');
    if (pop.kind === 'note' && !body.trim()) { qpBody.focus(); quoteNotice('Напишите мысль — или нажмите «Отмена»', true); return; }
    $('qp-save').disabled = true;
    try {
      if (pop.mode === 'draft') {
        const { kind, s, tags } = pop;
        if (CSS.highlights) CSS.highlights.delete('draft');
        const { it, status } = await saveItem(kind, s, tags, body);
        if (!it) throw new Error('запись не сохранилась');
        pop = { mode: 'saved', kind, id: it.id, text: it.text, tags: it.tags, body0: body };
        $('qp-status').textContent = status;
      } else {
        const kind = pop.kind;
        const patch = kind === 'note' ? { body } : { note: body.trim() || undefined };
        const it = updateItem(kind, pop.id, patch);
        pop.body0 = body;
        let status = 'Сохранено';
        if (native && it) {
          // другие правки этого блока, сделанные в Obsidian, сохраняются — меняем только мысль
          const ctx = noteCtx();
          const file = await writeItem(it, ctx, [kind === 'note' ? 'body' : 'note']);
          if (file) {
            markItemExported(ctx.id, kind, it.id, file);
            if (R.id === ctx.id && R.book) updateItem(kind, it.id, { tags: it.tags, text: it.text });
          } else status = 'Сохранено в книге (папка не выбрана)';
        }
        $('qp-status').textContent = status;
        paintQuotes();
      }
    } catch (err) {
      console.error(err);
      quoteNotice('Не удалось сохранить: ' + (err.message || err), true);
      return;
    } finally {
      $('qp-save').disabled = false;
    }
    if (!pop) return;
    showBody(pop.kind === 'note' || !!body.trim(), false);
    syncPopButtons();
    refreshLists();
  }
  function refreshLists() {
    if (!$('q-list').hidden) renderQuotesList();
    if (!$('n-list').hidden) renderNotesList();
  }
  const popTags = () => pop ? pop.tags : [];
  function renderQuoteTags() {
    const tags = popTags();
    $('qp-tags').innerHTML = tags.map((t) => '<button class="tag-chip on" style="--tc:' + tagColor(t) + '" data-tag="' + esc(t) + '" title="Убрать тег">#' + esc(t) + '<span class="tc-x">×</span></button>').join('');
    $('qp-tags').hidden = !tags.length;
    $('qp-text').style.borderLeftColor = tags.length ? tagColor(tags[0]) : '';
  }
  async function applyTags(tags) {
    if (!pop) return;
    pop.tags = Array.from(new Set(tags));
    renderQuoteTags();
    if (pop.mode === 'draft') return;
    rememberTags(pop.tags);
    const it = updateItem(pop.kind, pop.id, { tags: pop.tags });
    paintQuotes();
    refreshLists();
    if (native && it && it.file) await writeItemTags(it);
  }
  $('qp-tags').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tag]'); if (!b) return;
    applyTags(popTags().filter((t) => t !== b.dataset.tag));
  });
  $('qp-addthought').onclick = () => showBody(true, true);
  $('qp-export').onclick = async (ev) => {
    if (pop?.kind !== 'quote' || !R.book) return;
    const openedQuote = pop;
    const text = pop.mode === 'draft' ? pop.s.text : originalQuoteText(quoteById(pop.id));
    quoteNotice('');
    const result = await exportQuote(text, ev.currentTarget);
    if (pop === openedQuote && !quotePop.hidden && result) quoteNotice(result.error || result.message || '', !!result.error);
  };
  qpBody.addEventListener('input', () => { autoGrow(qpBody); if (pop) syncPopButtons(); });
  qpBody.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commitPop(); }
    if (ev.key === 'Escape' && $('qp-link-suggest').hidden) { ev.preventDefault(); ev.stopPropagation(); qpBody.blur(); }
  });
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(260, Math.max(68, ta.scrollHeight + 2)) + 'px'; }

  // подсказки тегов
  let sugIdx = -1;
  function knownTags() {
    const known = recentTags().slice();
    const add = (list) => { for (const it of list) for (const t of it.tags || []) if (!known.includes(t)) known.push(t); };
    for (const qs of Object.values(allQuotes())) add(qs);
    for (const ns of Object.values(allNotes())) add(ns);
    return known;
  }
  function suggestions() {
    const typed = cleanTag($('qp-tag-input').value.split(/[,;#]+/).pop() || '');
    const active = popTags();
    const low = typed.toLowerCase();
    const list = knownTags().filter((t) => !active.includes(t) && (!low || t.toLowerCase().includes(low))).slice(0, 8);
    if (typed && !active.includes(typed) && !list.some((t) => t.toLowerCase() === low)) list.push({ create: typed });
    return list;
  }
  function renderSuggest() {
    const list = suggestions();
    const box = $('qp-suggest');
    if (!list.length) { box.hidden = true; return; }
    if (sugIdx >= list.length) sugIdx = list.length - 1;
    box.innerHTML = list.map((t, i) => typeof t === 'string'
      ? '<button class="qs-item' + (i === sugIdx ? ' sel' : '') + '" data-i="' + i + '"><span class="qs-dot" style="background:' + tagColor(t) + '"></span>#' + esc(t) + '</button>'
      : '<button class="qs-item qs-new' + (i === sugIdx ? ' sel' : '') + '" data-i="' + i + '">+ новый тег <b>#' + esc(t.create) + '</b></button>').join('');
    box.hidden = false;
    box._list = list;
  }
  function pickSuggest(i) {
    const t = $('qp-suggest')._list[i];
    $('qp-tag-input').value = '';
    sugIdx = -1;
    applyTags(popTags().concat(typeof t === 'string' ? t : t.create));
    $('qp-suggest').hidden = true;
  }
  $('qp-suggest').addEventListener('mousedown', (ev) => { ev.preventDefault(); const b = ev.target.closest('[data-i]'); if (b) pickSuggest(+b.dataset.i); });
  $('qp-tag-input').addEventListener('focus', () => { sugIdx = -1; renderSuggest(); });
  $('qp-tag-input').addEventListener('input', () => { sugIdx = -1; renderSuggest(); });
  $('qp-tag-input').addEventListener('blur', () => setTimeout(() => { $('qp-suggest').hidden = true; }, 120));
  $('qp-tag-input').addEventListener('keydown', (ev) => {
    const box = $('qp-suggest'), n = box.hidden ? 0 : (box._list || []).length;
    if (ev.key === 'ArrowDown' && n) { ev.preventDefault(); sugIdx = (sugIdx + 1) % n; renderSuggest(); return; }
    if (ev.key === 'ArrowUp' && n) { ev.preventDefault(); sugIdx = (sugIdx - 1 + n) % n; renderSuggest(); return; }
    if (ev.key === 'Escape' && !box.hidden) { ev.preventDefault(); ev.stopPropagation(); box.hidden = true; return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault(); ev.stopPropagation();
    if (sugIdx >= 0 && n) { pickSuggest(sugIdx); return; }
    // несколько тегов — через запятую или #; пробелы внутри тега становятся «_» (так требует Obsidian)
    const add = ev.target.value.split(/[,;#]+/).map(cleanTag).filter(Boolean);
    ev.target.value = '';
    if (add.length) { applyTags(popTags().concat(add)); $('qp-suggest').hidden = true; }
    else if (pop && (pop.mode === 'draft' || popDirty())) commitPop();
  });

  // ---------- подсказки ссылок [[…]] в тексте заметки ----------
  function linkTargets() {
    const out = [];
    const seen = new Set();
    const add = (name, kind) => { name = linkName(name || ''); if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push({ name, kind }); } };
    for (const e of L.entries) { const m = L.metas[e.id]; if (m && m.title) add(m.title, 'книга'); }
    for (const e of L.entries) { const m = L.metas[e.id]; if (m && m.authors) m.authors.forEach((a) => add(a, 'автор')); }
    return out;
  }
  function attachLinkSuggest(ta, box) {
    let idx = 0, list = [], q0 = null;
    const ctx = () => { const before = ta.value.slice(0, ta.selectionStart); const m = before.match(/\[\[([^\[\]\n|]*)$/); return m ? m[1] : null; };
    const render = () => {
      const q = ctx(); q0 = q;
      if (q == null) { box.hidden = true; return; }
      const low = q.toLowerCase();
      list = linkTargets().filter((t) => t.name.toLowerCase().includes(low)).slice(0, 7);
      if (q.trim() && !list.some((t) => t.name.toLowerCase() === low)) list.push({ name: q.trim(), kind: 'новая' });
      if (!list.length) { box.hidden = true; return; }
      idx = Math.min(idx, list.length - 1);
      box.innerHTML = list.map((t, i) => '<button class="qs-item' + (i === idx ? ' sel' : '') + '" data-i="' + i + '"><span class="qs-kind">' + t.kind + '</span>' + esc(t.name) + '</button>').join('');
      box.hidden = false;
    };
    const pick = (i) => {
      const t = list[i]; if (!t) return;
      const pos = ta.selectionStart, before = ta.value.slice(0, pos), after = ta.value.slice(pos);
      const start = before.length - q0.length;
      const rest = after.startsWith(']]') ? after.slice(2) : after;
      ta.value = before.slice(0, start) + t.name + ']]' + rest;
      const caret = start + t.name.length + 2;
      ta.setSelectionRange(caret, caret);
      box.hidden = true;
      ta.dispatchEvent(new Event('input'));
    };
    ta.addEventListener('input', () => { idx = 0; render(); });
    ta.addEventListener('click', render);
    ta.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
    ta.addEventListener('keydown', (ev) => {
      if (box.hidden) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); idx = (idx + 1) % list.length; render(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); idx = (idx - 1 + list.length) % list.length; render(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); pick(idx); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); box.hidden = true; }
    });
    box.addEventListener('mousedown', (ev) => { ev.preventDefault(); const b = ev.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  }
  attachLinkSuggest(qpBody, $('qp-link-suggest'));

  $('qp-save').onclick = () => commitPop();
  $('qp-cancel').onclick = () => hideQuotePop();
  $('qp-close').onclick = () => { if (popDirty() && !confirmLeave()) return; hideQuotePop(); };
  $('qp-delete').onclick = () => { const it = pop && itemById(pop.kind, pop.id); if (it) deleteItem(pop.kind, it); hideQuotePop(); };
  // не терять написанное случайным кликом мимо
  function confirmLeave() {
    quotePop.classList.remove('shake'); void quotePop.offsetWidth; quotePop.classList.add('shake');
    quoteNotice('Есть несохранённый текст — «Сохранить» или «Отмена»', true);
    return false;
  }

  // удаление: сразу из «Полки», из дневника — через несколько секунд, если не нажали «Отменить»
  async function deleteItem(kind, it) {
    const bookId = R.id;
    const backup = Object.assign({}, it); delete backup.kind;
    if (kind === 'note') setBookNotes(bookNotes().filter((x) => x.id !== it.id));
    else setBookQuotes(bookQuotes().filter((x) => x.id !== it.id));
    paintQuotes(); refreshLists();
    if (native && it.file) LS.set('pendingDeletes', LS.get('pendingDeletes', []).concat({ file: it.file, id: it.id }));
    let undone = false;
    toastAction(kind === 'note' ? 'Заметка удалена' : 'Цитата удалена', 'Отменить', () => {
      undone = true;
      LS.set('pendingDeletes', LS.get('pendingDeletes', []).filter((d) => d.id !== it.id));
      const store = kind === 'note' ? 'notes' : 'quotes';
      const all = LS.get(store, {});
      all[bookId] = (all[bookId] || []).concat(backup).sort((a, b) => a.ch - b.ch || a.off - b.off);
      LS.set(store, all);
      if (R.id === bookId) { paintQuotes(); refreshLists(); }
      toast('Восстановлено');
    }, 6000, async () => {
      if (undone || !native || !it.file) return;
      LS.set('pendingDeletes', LS.get('pendingDeletes', []).filter((d) => d.id !== it.id));
      await removeItemBlock(it.file, it.id);
    });
  }
  const deleteQuote = (q) => deleteItem('quote', q);

  // у каждого тега свой постоянный цвет; цитата — заливка, заметка — пунктир
  const TAG_COLORS = ['#e8603c', '#d4972a', '#7d9a36', '#2c9a8c', '#4a7fc4', '#8b5bb0', '#c94f7c', '#6f7d93'];
  const NOTE_DEFAULT = 4; // синий
  const tagIdx = (t) => hash(String(t).toLowerCase()) % TAG_COLORS.length;
  const tagColor = (t) => TAG_COLORS[tagIdx(t)];
  (function tagStyles() {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
    const st = document.createElement('style');
    st.textContent = TAG_COLORS.map((c, i) =>
      '::highlight(quote-' + i + ') { background-color: rgba(' + rgb(c) + ', .15); text-decoration: underline; text-decoration-color: rgba(' + rgb(c) + ', .75); text-decoration-thickness: 1.5px; text-underline-offset: 4px; }\n' +
      '::highlight(note-' + i + ') { background-color: rgba(' + rgb(c) + ', .06); text-decoration: underline dotted; text-decoration-color: rgba(' + rgb(c) + ', .9); text-decoration-thickness: 2px; text-underline-offset: 4px; }').join('\n');
    document.head.appendChild(st);
  })();
  const tagChip = (t, cls) => '<span class="' + (cls || 'tag-mini') + '" style="--tc:' + tagColor(t) + '">#' + esc(t) + '</span>';
  const itemColor = (it) => it.tags && it.tags.length ? tagColor(it.tags[0]) : (it.kind === 'note' ? TAG_COLORS[NOTE_DEFAULT] : TAG_COLORS[0]);

  // подсветка записей на странице + значки ✎ на полях
  const HL_KEYS = ['quote'].concat(TAG_COLORS.map((c, i) => 'quote-' + i), TAG_COLORS.map((c, i) => 'note-' + i));
  function paintQuotes() {
    if (!window.Highlight || !CSS.highlights || !R.book || !R.nodes) return;
    const groups = {};
    for (const it of allItems()) if (it.ch === R.ch) {
      const key = it.kind === 'note' ? 'note-' + (it.tags && it.tags.length ? tagIdx(it.tags[0]) : NOTE_DEFAULT)
        : (it.tags && it.tags.length ? 'quote-' + tagIdx(it.tags[0]) : 'quote');
      try { (groups[key] = groups[key] || []).push(rangeAt(it.off, it.len)); } catch (e) { /* ок */ }
    }
    for (const k of HL_KEYS) {
      if (groups[k]) { const h = new Highlight(...groups[k]); h.priority = 0; CSS.highlights.set(k, h); }
      else CSS.highlights.delete(k);
    }
    $('pins').innerHTML = '';
    clearTimeout(R.pinT);
    R.pinT = setTimeout(paintPins, S.anim && !isScroll() ? 460 : 0);
  }
  function paintPins() {
    const box = $('pins');
    box.innerHTML = '';
    if (!R.book || !R.nodes || reader.hidden) return;
    const sr = stage.getBoundingClientRect(), vr = textRect();
    const twoCol = R.geo && R.geo.cols === 2 && !isScroll();
    const used = [];
    for (const it of allItems()) {
      if (it.ch !== R.ch || !(it.kind === 'note' || it.note)) continue;
      let r = null;
      try { r = Array.from(rangeAt(it.off, it.len).getClientRects()).find((x) => x.width > 0 && x.left >= vr.left - 2 && x.right <= vr.right + 2 && x.top >= vr.top - 2 && x.bottom <= vr.bottom + 2); } catch (e) { /* ок */ }
      if (!r) continue;
      const left = !twoCol || r.left < vr.left + vr.width / 2;
      let top = r.top - sr.top + r.height / 2 - 12;
      const side = left ? 'l' : 'r';
      while (used.some((u) => u.side === side && Math.abs(u.top - top) < 26)) top += 26;
      used.push({ side, top });
      const b = document.createElement('button');
      b.className = 'note-pin';
      const px = Math.max(2, Math.min(sr.width - 26, left ? vr.left - sr.left - 38 : vr.right - sr.left + 14));
      b.style.cssText = 'top:' + top + 'px;left:' + px + 'px;--tc:' + itemColor(it);
      b.dataset.kind = it.kind; b.dataset.id = it.id;
      b.title = shorten((it.kind === 'note' ? it.body : it.note) || '', 220);
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
      box.appendChild(b);
    }
  }
  $('pins').addEventListener('click', (ev) => {
    const b = ev.target.closest('.note-pin'); if (!b) return;
    ev.stopPropagation();
    const it = itemById(b.dataset.kind, b.dataset.id); if (!it) return;
    const r = b.getBoundingClientRect();
    openSaved(Object.assign({ kind: b.dataset.kind }, it), [r]);
  });
  viewport.addEventListener('scroll', () => { if (isScroll()) { cancelAnimationFrame(R.pinRaf); R.pinRaf = requestAnimationFrame(paintPins); } });
  window.__paintQuotes = paintQuotes;
  window.__flipSeek = (f) => { if (FLIP.cur) FLIP.cur.seek(f); return !!FLIP.cur; };
  window.__flipReady = () => FLIP.key === cloneKey();
  window.__endShown = () => !!R.endShown;
  window.__flipActive = () => !!FLIP.cur;
  window.__showSelBar = showSelBar;
  window.__migrateQuotes = migrateQuotes;
  window.__syncBook = () => syncBook().catch((e) => console.warn(e));
  window.__loadState = async () => { await loadStateFromDiary(); await runPendingDeletes(); };
  window.__saveStateSoon = saveStateSoon;
  window.__saveStateNow = () => { if (stateTimer) saveStateNow(); };
  window.__cancelDraft = () => cancelDraft();
  window.__popDirty = () => popDirty();
  window.__confirmLeave = () => confirmLeave();
  // клик по подсвеченной записи — её окошко (заметка важнее цитаты)
  function quoteAtPoint(x, y) {
    const list = allItems().filter((it) => it.ch === R.ch);
    if (!list.length || !document.caretRangeFromPoint) return null;
    const cr = document.caretRangeFromPoint(x, y);
    if (!cr || !flow.contains(cr.startContainer)) return null;
    const off = logAt(cr.startContainer, cr.startOffset);
    const hit = list.filter((it) => off >= it.off && off <= it.off + it.len);
    return hit.find((it) => it.kind === 'note') || hit[0] || null;
  }

  // текст мысли: ссылки [[…]] — просто цветным словом
  const wikiHtml = (t) => esc(t).replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, a, b) => '<span class="wl">' + (b || a) + '</span>');

  // вкладка «Цитаты»
  function renderQuotesList() {
    const list = bookQuotes();
    $('q-list').innerHTML = list.length ? list.map((q) =>
      '<div class="bm-row"><button class="toc-item bm" data-qid="' + q.id + '" style="--tc:' + (q.tags && q.tags.length ? tagColor(q.tags[0]) : 'var(--faint)') + '"><span class="bm-snippet q-snip">' + esc(q.text) + '</span>' +
      (q.note ? '<span class="n-body small">' + wikiHtml(shorten(q.note, 200)) + '</span>' : '') +
      '<span class="bm-meta">' + Math.round(q.pct * 100) + '%' + (q.chapter ? ' · ' + esc(q.chapter) : '') +
      '</span>' + ((q.tags || []).length ? '<span class="tag-row">' + q.tags.map((t) => tagChip(t)).join('') + '</span>' : '') + '</button>' +
      '<button class="icon-btn bm-del" data-qdel="' + q.id + '" title="Удалить цитату"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>').join('')
      : '<div class="list-empty">Цитат пока нет.<br>Выделите текст и нажмите <b>Цитата</b>.</div>';
  }
  $('q-list').addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-qdel]');
    if (del) { const q = quoteById(del.dataset.qdel); if (q) deleteQuote(q); return; }
    const b = ev.target.closest('[data-qid]'); if (!b) return;
    const q = quoteById(b.dataset.qid); if (!q) return;
    previewInBook(q.ch, q.off);
  });

  // вкладка «Заметки»: мысли о книге + заметки по ходу чтения (и мысли к цитатам)
  function renderNotesList() {
    const bt = (allBookThoughts()[R.id] || {}).body || '';
    const thoughts = allItems().filter((it) => it.kind === 'note' || it.note);
    $('n-list').innerHTML =
      '<div class="bn-card" id="bn-card">' +
        '<div class="bn-head">О книге</div>' +
        '<div class="bn-view' + (bt ? '' : ' is-empty') + '" id="bn-view">' + (bt ? wikiHtml(bt).replace(/\n/g, '<br>') : 'Впечатление о книге…') + '</div>' +
        '<div class="bn-edit" id="bn-edit" hidden><div class="ta-wrap"><textarea id="bn-ta" placeholder="Мои мысли о книге…"></textarea><div class="qp-suggest link-suggest" id="bn-link-suggest" hidden></div></div>' +
          '<div class="bn-foot"><button class="link-btn" id="bn-cancel">Отмена</button><button class="qp-save" id="bn-save">Сохранить</button></div></div>' +
      '</div>' +
      (thoughts.length ? thoughts.map((it) => {
        const body = it.kind === 'note' ? it.body : it.note;
        return '<div class="bm-row"><button class="toc-item bm" data-nk="' + it.kind + '" data-nid="' + it.id + '" style="--tc:' + itemColor(it) + '">' +
          (it.text ? '<span class="n-frag' + (it.kind === 'quote' ? ' is-quote' : '') + '">' + esc(shorten(it.text, 140)) + '</span>' : '') +
          '<span class="n-body">' + wikiHtml(body || '') + '</span>' +
          '<span class="bm-meta">' + Math.round(it.pct * 100) + '%' + (it.chapter ? ' · ' + esc(it.chapter) : '') + (it.kind === 'quote' ? ' · к цитате' : '') + '</span>' +
          ((it.tags || []).length ? '<span class="tag-row">' + it.tags.map((t) => tagChip(t)).join('') + '</span>' : '') + '</button>' +
          (it.kind === 'note' ? '<button class="icon-btn bm-del" data-ndel="' + it.id + '" title="Удалить заметку"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '') + '</div>';
      }).join('') : '<div class="list-empty">Заметок по ходу чтения пока нет.<br>Выделите текст и нажмите <b>Заметка</b>.</div>');
    const ta = $('bn-ta');
    attachLinkSuggest(ta, $('bn-link-suggest'));
    ta.addEventListener('input', () => autoGrow(ta));
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('bn-save').click(); } if (ev.key === 'Escape') { ev.stopPropagation(); $('bn-cancel').click(); } });
    $('bn-view').onclick = () => { $('bn-view').hidden = true; $('bn-edit').hidden = false; ta.value = bt; autoGrow(ta); ta.focus(); };
    $('bn-cancel').onclick = () => { $('bn-view').hidden = false; $('bn-edit').hidden = true; };
    $('bn-save').onclick = async () => {
      const body = ta.value.replace(/\s+$/, '');
      const ctx = noteCtx();
      const status = await saveBookThoughts(body, ctx);
      if (R.book && R.id === ctx.id) renderNotesList();
      toast(status.message, status.failed ? 5000 : undefined);
    };
  }
  $('n-list').addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-ndel]');
    if (del) { const n = noteById(del.dataset.ndel); if (n) deleteItem('note', n); return; }
    const b = ev.target.closest('[data-nid]'); if (!b) return;
    const it = itemById(b.dataset.nk, b.dataset.nid); if (!it) return;
    previewInBook(it.ch, it.off);
  });

  // ---------- управление тегами ----------
  // Теги хранятся у самих записей (цитат и заметок) + список недавних для подсказок.
  function tagStats() {
    const counts = {};
    for (const store of ['quotes', 'notes']) for (const list of Object.values(LS.get(store, {}))) for (const it of list) for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
    for (const t of recentTags()) if (!(t in counts)) counts[t] = 0;
    const coll = new Intl.Collator('ru', { sensitivity: 'base' });
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0]));
  }
  const plural3 = (n) => n + ' ' + plural(n, 'запись', 'записи', 'записей');
  function renderTagManager() {
    const st = tagStats();
    $('tp-list').innerHTML = st.length ? st.map(([t, n]) =>
      '<div class="tp-row" data-tag="' + esc(t) + '"><span class="qs-dot" style="background:' + tagColor(t) + '"></span>' +
      '<button class="tp-name" title="Переименовать">#' + esc(t) + '</button>' +
      '<span class="tp-count">' + (n ? plural3(n) : 'не используется') + '</span>' +
      '<button class="icon-btn tp-del" title="' + (n ? 'Убрать тег из всех записей' : 'Забыть тег') + '"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>').join('')
      : '<div class="list-empty">Тегов пока нет.</div>';
  }
  // заменить/убрать тег во всех книгах и в файлах дневника
  async function tagOp(oldT, newT) {
    const changed = [];
    for (const store of ['quotes', 'notes']) {
      const all = LS.get(store, {});
      for (const list of Object.values(all)) for (const it of list) {
        if (!(it.tags || []).includes(oldT)) continue;
        it.tags = Array.from(new Set(it.tags.map((x) => x === oldT ? newT : x).filter(Boolean)));
        if (it.file) changed.push(it);
      }
      LS.set(store, all);
    }
    LS.set('quoteTags', Array.from(new Set(recentTags().map((x) => x === oldT ? newT : x).filter(Boolean))));
    if (native) for (const it of changed) await serial(async () => {
      const md = await native.noteRead(it.file);
      if (md == null) return;
      const lines = md.split('\n');
      const blk = findBlock(lines, it.id);
      if (!blk) return;
      const parts = lines[blk.foot].replace(/^>\s?/, '').split(' · ');
      if (parts[0].trim().startsWith('#')) parts.shift();
      if (it.tags.length) parts.unshift(it.tags.map((t) => '#' + t).join(' '));
      lines[blk.foot] = '> ' + parts.join(' · ');
      await native.noteWrite(it.file, tidy(lines));
    });
    if (R.book) { paintQuotes(); refreshLists(); }
    if (reader.hidden) renderLibrary();
    renderTagManager();
  }
  $('set-tags').onclick = (ev) => {
    ev.stopPropagation();
    $('settings').hidden = true; $('btn-settings').classList.remove('active');
    $('lib-settings').hidden = true; $('btn-lib-settings').classList.remove('active');
    renderTagManager();
    $('tags-pop').hidden = false;
  };
  $('tp-close').onclick = () => { $('tags-pop').hidden = true; };
  document.addEventListener('mousedown', (ev) => { if (!$('tags-pop').hidden && !ev.target.closest('#tags-pop') && !ev.target.closest('#set-tags')) $('tags-pop').hidden = true; });
  $('tp-list').addEventListener('click', async (ev) => {
    const row = ev.target.closest('.tp-row'); if (!row) return;
    const t = row.dataset.tag;
    const n = (tagStats().find((x) => x[0] === t) || [t, 0])[1];
    if (ev.target.closest('.tp-del')) {
      const btn = ev.target.closest('.tp-del');
      // тег с записями — подтверждение вторым кликом
      if (n && !btn.classList.contains('confirm')) {
        btn.classList.add('confirm'); btn.innerHTML = 'убрать из ' + n + '?';
        setTimeout(() => { if (btn.isConnected) renderTagManager(); }, 3500);
        return;
      }
      await tagOp(t, null);
      toast(n ? 'Тег #' + t + ' убран из ' + plural3(n) : 'Тег #' + t + ' забыт');
      return;
    }
    if (ev.target.closest('.tp-name')) {
      const nameBtn = ev.target.closest('.tp-name');
      const inp = document.createElement('input');
      inp.className = 'tp-input'; inp.value = t; inp.maxLength = 40;
      nameBtn.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const finish = async (ok) => {
        if (done) return; done = true;
        const nt = cleanTag(inp.value);
        if (ok && nt && nt !== t) { await tagOp(t, nt); toast('#' + t + ' → #' + nt); } else renderTagManager();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
      inp.addEventListener('blur', () => finish(true));
    }
  });

  // настройки
  function syncQuoteSettings() {
    const d = S.quotesDir;
    const books = LS.get('folder', '');
    $('set-qdir').textContent = d ? d.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') : (books ? 'Читательский дневник' : 'не выбрана');
    $('set-qdir').title = d || (books ? books + ' / Читательский дневник' : '');
    $('set-lang').value = S.lang || 'ru';
    $('set-sort').value = S.sort || 'recent';
    $('folder-name').textContent = Src.folderName() || 'выбрать'; $('btn-folder').title = LS.get('folder', '') || 'Выбрать папку с книгами';
  }
  $('set-qdir').onclick = async (ev) => {
    ev.stopPropagation();
    if (!native) { toast('Папку дневника можно выбрать в программе Polka.exe'); return; }
    const p = await native.pickFolder('Папка читательского дневника');
    if (p) { S.quotesDir = p; saveSettings(); syncQuoteSettings(); toast('Новые записи будут сохраняться в эту папку'); }
  };
  $('set-lang').onchange = (ev) => { S.lang = ev.target.value; saveSettings(); };
  syncQuoteSettings();
  (async () => { const v = native && native.version ? await native.version() : 'веб-версия'; const b = document.querySelector('.lib-brand'); if (b) b.title = 'Полка ' + v + ' · сборка ' + BUILD_DATE; })();

  document.addEventListener('mousedown', (ev) => {
    if (!infoCard.hidden && !ev.target.closest('#info-card')) { infoCard.hidden = true; R.cardToken = null; }
    if (!quotePop.hidden && !ev.target.closest('#quote-pop') && !ev.target.closest('.note-pin')) { if (popDirty()) confirmLeave(); else hideQuotePop(); }
  });

  // ссылки polka://open?book=…&ch=…&off=…
  // Вспышка помогает найти место по ссылке без сохранённой отметки.
  function flashAt(off, len) {
    let rects = [];
    try { const vr = viewport.getBoundingClientRect(); rects = Array.from(rangeAt(off, Math.max(1, len)).getClientRects()).filter((r) => r.width > 1 && r.left >= vr.left - 2 && r.right <= vr.right + 2 && r.top >= vr.top - 2 && r.bottom <= vr.bottom + 2); } catch (e) { /* ок */ }
    if (!rects.length) return;
    for (const r of rects.slice(0, 40)) {
      const d = document.createElement('div');
      d.className = 'flash-mark';
      d.style.cssText = 'left:' + (r.left - 3) + 'px;top:' + (r.top - 1) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 2) + 'px';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2600);
    }
  }
  function openLibraryItem(id, it) {
    return openLink(polkaLinkFor(id, it), { scrollTop: $('lib-main').scrollTop });
  }
  async function openLink(url, libraryReturn) {
    const m = String(url).match(/[?&]book=([^&]+)/);
    if (!m) { toast('Ссылка повреждена'); return; }
    let id;
    try { id = decodeURIComponent(m[1]); } catch (err) { toast('Ссылка повреждена'); return; }
    const num = (k) => { const x = String(url).match(new RegExp('[?&]' + k + '=(\\d+)')); return x ? +x[1] : null; };
    const ch = num('ch'), off = num('off');
    for (let i = 0; i < 100 && (L.scanning || !L.entries.length); i++) await sleep(100);
    const e = L.entries.find((x) => bookKeyMatches(id, x.id));
    if (!e) { toast('Книга из ссылки не найдена в папке'); return; }
    const wasOpen = R.book && R.id === e.id && !reader.hidden;
    if (wasOpen) {
      if (ch != null) await previewInBook(ch, off || 0);
    } else await openEntry(e, ch != null ? { ch, off: off || 0, libraryReturn } : null);
    if (!R.book || R.id !== e.id) return;
    if (ch != null && ch >= R.book.chapters.length) { toast(wasOpen ? 'Место из ссылки не найдено в книге' : 'Место из ссылки не найдено — книга открыта там, где вы остановились', 4000); return; }
    if (ch != null) {
      await sleep(250);
      if (R.id !== e.id || R.ch !== ch || !R.previewReturn || reader.hidden) return;
      const target = off || 0;
      if (window.Highlight && CSS.highlights &&
          allItems().some((it) => it.ch === ch && it.off <= target && target < it.off + it.len)) return;
      flashAt(target, num('len') || 40);
    }
  }

  // ============================================================
  //                    Справка (F1, шестерёнка на главной)
  // ============================================================
  function toggleHelp(on) {
    const h = $('help'), show = on === undefined ? h.hidden : on;
    h.hidden = !show;
    if (show) { $('lib-settings').hidden = true; $('btn-lib-settings').classList.remove('active'); $('help-body').scrollTop = 0; LS.set('helpSeen', true); }
  }
  $('btn-help').onclick = () => toggleHelp(true);
  const TG = 'https://t.me/polka_reader_win';
  const openTg = () => { if (native) native.openExternal(TG); else window.open(TG, '_blank', 'noopener'); };
  $('btn-tg').onclick = openTg; $('help-tg').onclick = openTg;
  (async () => { const v = native && native.version ? await native.version() : ''; $('help-ver').textContent = v ? v : ''; })();
  $('help-close').onclick = () => toggleHelp(false);
  $('help').addEventListener('mousedown', (ev) => { if (ev.target.id === 'help') toggleHelp(false); });
  $('help-nav').onclick = (ev) => { const a = ev.target.closest('[data-h]'); if (a) $(a.dataset.h).scrollIntoView({ block: 'start' }); };
  $('help-body').addEventListener('scroll', () => {
    const top = $('help-body').getBoundingClientRect().top + 40;
    let cur = null; for (const sec of $('help-body').querySelectorAll('section')) if (sec.getBoundingClientRect().top <= top) cur = sec.id;
    document.querySelectorAll('#help-nav a').forEach((a) => a.classList.toggle('on', a.dataset.h === (cur || 'h-lib')));
  });
  // один раз — тихая подсказка о справке
  setTimeout(() => { if (!LS.get('helpSeen', false) && !LS.get('helpHinted', false) && $('help').hidden) { LS.set('helpHinted', true); toast('F1 — как пользоваться Полкой', 4500); } }, 2500);

  // ============================================================
  //                    Иллюстрация крупно
  // ============================================================
  const zoomEl = $('zoom'), zImg = $('zoom-img');
  const Z = { s: 1, x: 0, y: 0, fit: 1, w: 1, h: 1, drag: null, moved: false };
  function zoomable(im) {
    if (im.localName === 'img') return !im.classList.contains('inline') && (im.naturalWidth >= 80 || im.naturalHeight >= 80);
    return !!imgSrc(im);
  }
  function imgSrc(im) {
    if (im.localName === 'img') return im.currentSrc || im.src;
    return im.getAttribute('href') || im.getAttribute('xlink:href') || '';
  }
  function zApply(anim) {
    zImg.classList.toggle('anim', !!anim);
    zImg.style.transform = 'translate(' + Z.x.toFixed(1) + 'px,' + Z.y.toFixed(1) + 'px) scale(' + Z.s.toFixed(4) + ')';
    zoomEl.classList.toggle('zoomed', Z.s > Z.fit * 1.01);
  }
  function zClamp() {
    const W = window.innerWidth, H = window.innerHeight, w = Z.w * Z.s, h = Z.h * Z.s;
    Z.x = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, Z.x));
    Z.y = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, Z.y));
  }
  function zoomFit(anim) {
    const W = window.innerWidth, H = window.innerHeight;
    // маленькие картинки увеличиваем, но не больше чем вдвое — иначе расплывутся
    Z.fit = Math.min((W - 96) / Z.w, (H - 96) / Z.h, Math.max(1, 2));
    Z.s = Z.fit;
    zClamp(); zApply(anim);
  }
  function zoomAt(ns, cx, cy, anim) {
    ns = Math.max(Z.fit, Math.min(Math.max(Z.fit * 6, 4), ns));
    if (ns <= Z.fit * 1.001) { zoomFit(anim); return; }
    Z.x = cx - (cx - Z.x) * ns / Z.s; Z.y = cy - (cy - Z.y) * ns / Z.s; Z.s = ns;
    zClamp(); zApply(anim);
  }
  const zoomBy = (f) => zoomAt(Z.s * f, window.innerWidth / 2, window.innerHeight / 2, true);
  async function openZoom(im) {
    const src = imgSrc(im);
    if (!src) return;
    zImg.src = src;
    try { await zImg.decode(); } catch (e) { return; }
    const r = im.getBoundingClientRect();
    Z.w = zImg.naturalWidth || r.width || 1; Z.h = zImg.naturalHeight || r.height || 1;
    zImg.style.width = Z.w + 'px'; zImg.style.height = Z.h + 'px';
    zoomEl.hidden = false;
    // картинка «вырастает» из своего места на странице
    const k = Math.min(r.width / Z.w, r.height / Z.h) || 0.5;
    Z.s = k; Z.x = r.left + (r.width - Z.w * k) / 2; Z.y = r.top + (r.height - Z.h * k) / 2;
    zApply(false);
    void zImg.offsetWidth;
    zoomFit(true);
    const hint = $('zoom-hint');
    hint.classList.remove('show'); void hint.offsetWidth; hint.classList.add('show');
  }
  function closeZoom() { zoomEl.hidden = true; zImg.removeAttribute('src'); }
  zoomEl.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const d = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
    zoomAt(Z.s * Math.exp(-d * 0.0022), ev.clientX, ev.clientY, false);
  }, { passive: false });
  zoomEl.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    Z.drag = { x: ev.clientX, y: ev.clientY, ox: Z.x, oy: Z.y }; Z.moved = false;
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!Z.drag) return;
    const dx = ev.clientX - Z.drag.x, dy = ev.clientY - Z.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { Z.moved = true; zoomEl.classList.add('dragging'); }
    if (!Z.moved || !zoomEl.classList.contains('zoomed')) return;
    Z.x = Z.drag.ox + dx; Z.y = Z.drag.oy + dy;
    zClamp(); zApply(false);
  });
  window.addEventListener('mouseup', () => { Z.drag = null; zoomEl.classList.remove('dragging'); });
  zoomEl.addEventListener('click', (ev) => {
    if (Z.moved) { Z.moved = false; return; }
    if (ev.target.closest('#zoom-close')) { closeZoom(); return; }
    if (ev.target === zImg) {
      if (zoomEl.classList.contains('zoomed')) zoomFit(true);
      else zoomAt(Math.max(1, Z.fit * 2.5), ev.clientX, ev.clientY, true);
      return;
    }
    closeZoom();
  });
  window.addEventListener('resize', () => { if (!zoomEl.hidden) zoomFit(false); });

  // ============================================================
  //              Записная книжка и «Вспомнить»
  // ============================================================
  const NB = { view: 'books', tag: null, book: null, mode: 'books', query: '', cards: [] };
  // дата без года, если год текущий
  const uiDate = (t) => new Date(t).getFullYear() === new Date().getFullYear() ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ruDate(t);
  const normQ = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  function bookLabel(id) {
    const m = L.metas[id] || {};
    const e = L.entries.find((x) => x.id === id);
    const name = e ? e.name : String(id).split('|')[0];
    return { title: m.title || name.replace(BOOK_RE, ''), author: (m.authors || []).join(', '), m, e, name };
  }
  // все цитаты и заметки из всех книг
  function everyItem() {
    const out = [];
    for (const [store, kind] of [['quotes', 'quote'], ['notes', 'note']]) {
      const all = LS.get(store, {});
      for (const id of Object.keys(all)) for (const it of all[id] || []) if (it && (it.text || it.body || it.note)) out.push(Object.assign({ kind, book: id }, it));
    }
    return out;
  }
  const recCount = (n) => n + ' ' + plural(n, 'запись', 'записи', 'записей');
  function nbCard(it, withBook) {
    const i = NB.cards.push(it) - 1;
    const body = it.kind === 'note' ? it.body : it.note;
    const tags = (it.tags || []).map((t) => tagChip(t)).join('');
    const where = withBook ? esc(bookLabel(it.book).title) + ' · ' : '';
    return '<div class="nb-card' + (it.kind === 'note' ? ' is-note' : '') + '" data-nbi="' + i + '" style="--tc:' + itemColor(it) + '" title="Открыть в книге">' +
      (it.text ? '<div class="nb-t">' + esc(it.kind === 'note' ? shorten(it.text, 320) : it.text) + '</div>' : '') +
      (body ? '<div class="nb-m">' + wikiHtml(body) + '</div>' : '') +
      '<div class="nb-f">' + tags + '<span>' + where + Math.round((it.pct || 0) * 100) + '% · ' + uiDate(it.t) + '</span><span class="nb-go">открыть →</span></div></div>';
  }
  function renderNotebook() {
    const items = everyItem();
    const thoughts = allBookThoughts();
    const q = normQ(NB.query.trim());
    const labels = {};
    const lab = (id) => labels[id] || (labels[id] = bookLabel(id));
    const tagCount = {}, bookCount = {}, bookLast = {};
    for (const it of items) {
      for (const t of it.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
      bookCount[it.book] = (bookCount[it.book] || 0) + 1;
      bookLast[it.book] = Math.max(bookLast[it.book] || 0, it.t || 0);
    }
    for (const id of Object.keys(thoughts)) if ((thoughts[id].body || '').trim()) bookLast[id] = Math.max(bookLast[id] || 0, thoughts[id].t || 0);
    if (NB.tag && !tagCount[NB.tag]) NB.tag = null;
    if (NB.book && !(NB.book in bookLast)) NB.book = null;
    const hay = (it) => normQ([it.text, it.note, it.body, it.chapter, (it.tags || []).map((t) => '#' + t).join(' '), lab(it.book).title, lab(it.book).author].join(' '));
    let list = items.filter((it) => (!NB.tag || (it.tags || []).includes(NB.tag)) && (!NB.book || it.book === NB.book));
    if (q) list = list.filter((it) => hay(it).includes(q));

    // слева: теги, книги, вид
    const coll = new Intl.Collator('ru', { sensitivity: 'base' });
    const tagsSorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0]));
    const booksSorted = Object.keys(bookLast).sort((a, b) => bookLast[b] - bookLast[a]);
    $('nb-side').innerHTML =
      (tagsSorted.length ? '<h4>Теги</h4>' + tagsSorted.map(([t, n]) =>
        '<button class="nb-row' + (NB.tag === t ? ' on' : '') + '" data-nb-tag="' + esc(t) + '"><i class="nb-dot" style="background:' + tagColor(t) + '"></i><span class="nb-name">#' + esc(t) + '</span><em>' + n + '</em></button>').join('') : '') +
      (booksSorted.length ? '<h4>Книги</h4>' + booksSorted.map((id) =>
        '<button class="nb-row nb-bk' + (NB.book === id ? ' on' : '') + '" data-nb-book="' + esc(id) + '">' + coverHtml(lab(id).m, lab(id).name) + '<span class="nb-name">' + esc(lab(id).title) + '</span><em>' + (bookCount[id] || '') + '</em></button>').join('') : '') +
      (items.length ? '<h4>Вид</h4><button class="nb-row' + (NB.mode === 'books' ? ' on' : '') + '" data-nb-mode="books"><span class="nb-name">По книгам</span></button>' +
        '<button class="nb-row' + (NB.mode === 'time' ? ' on' : '') + '" data-nb-mode="time"><span class="nb-name">Лентой по времени</span></button>' : '');

    // справа: записи
    NB.cards = [];
    const main = $('nb-main');
    if (!items.length && !booksSorted.length) {
      main.innerHTML = '<div class="nb-empty"><div class="nb-empty-q">«</div><h2>Здесь соберутся ваши цитаты и мысли</h2><p>Из всех книг сразу — с поиском и тегами. Выделите текст в&nbsp;книге и&nbsp;нажмите <b>Цитата</b> или <b>Заметка</b>.</p></div>';
      return;
    }
    const nBooks = new Set(list.map((it) => it.book)).size;
    let head = '';
    if (NB.tag || NB.book || q) {
      const what = [NB.tag ? 'с тегом ' + tagChip(NB.tag) : '', NB.book ? 'из книги «' + esc(lab(NB.book).title) + '»' : '', q ? 'по запросу «' + esc(NB.query.trim()) + '»' : ''].filter(Boolean).join(' ');
      head = '<div class="nb-head"><span class="nb-kicker">Записи</span> ' + what + '<span class="nb-sum"> · ' + recCount(list.length) + (nBooks > 1 ? ' в ' + nBooks + ' ' + plural(nBooks, 'книге', 'книгах', 'книгах') : '') + '</span>' +
        '<button class="link-btn nb-reset" data-nb-reset="1">сбросить</button></div>';
    }
    let html = '';
    if (NB.mode === 'time') {
      list.sort((a, b) => (b.t || 0) - (a.t || 0));
      html = list.length ? '<div class="nb-cards">' + list.slice(0, 800).map((it) => nbCard(it, true)).join('') + '</div>' : '';
    } else {
      const groups = {};
      for (const it of list) (groups[it.book] = groups[it.book] || []).push(it);
      const ids = booksSorted.filter((id) => groups[id] || (!NB.tag && (!NB.book || NB.book === id) && thoughts[id] && (thoughts[id].body || '').trim() && (!q || normQ(thoughts[id].body + ' ' + lab(id).title + ' ' + lab(id).author).includes(q))));
      let shown = 0;
      for (const id of ids) {
        if (shown > 800) break;
        const g = (groups[id] || []).sort((a, b) => a.ch - b.ch || a.off - b.off);
        shown += g.length;
        const bt = !NB.tag && thoughts[id] && (thoughts[id].body || '').trim();
        const b = lab(id);
        html += '<section class="nb-group"><button class="nb-gh" data-nb-openbook="' + esc(id) + '" title="Продолжить чтение">' + coverHtml(b.m, b.name) +
          '<span class="nb-gt"><b>' + esc(b.title) + '</b>' + (b.author ? '<span>' + esc(b.author) + '</span>' : '') + '</span></button>' +
          '<div class="nb-cards">' +
          (bt ? '<div class="nb-card is-book" data-nb-openbook="' + esc(id) + '"><div class="nb-kicker">О книге</div><div class="nb-m">' + wikiHtml(thoughts[id].body) + '</div></div>' : '') +
          g.map((it) => nbCard(it, false)).join('') + '</div></section>';
      }
    }
    main.innerHTML = head + (html || '<p class="nothing">Ничего не найдено</p>');
  }
  function syncLibTabs() {
    document.querySelectorAll('#lib-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === NB.view));
    $('search').placeholder = NB.view === 'notebook' ? 'Искать в записях' : NB.view === 'pads' ? 'Искать в блокнотах' : 'Название или автор';
    document.getElementById('library').classList.toggle('nb-mode', NB.view === 'notebook');
    document.getElementById('library').classList.toggle('pads-mode', NB.view === 'pads');
  }
  $('lib-tabs').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.dataset.view === NB.view) return;
    NB.view = b.dataset.view;
    $('search').value = NB.view === 'notebook' ? NB.query : NB.view === 'pads' ? PADV.query : L.query;
    if (NB.view === 'pads') PADV.open = null;
    $('lib-main').scrollTop = 0;
    renderLibrary();
  };

  // «Вспомнить»: раз в день — одна из старых цитат или мыслей
  const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const remKey = (it) => it.book + '#' + it.id;
  function rememberPool() {
    const now = Date.now();
    return everyItem().filter((it) => (it.text || it.body) && now - (it.t || 0) > 18 * 3600e3 && L.entries.some((e) => e.id === it.book));
  }
  function pickRemember(force) {
    const pool = rememberPool();
    if (!pool.length) return null;
    const st = LS.get('remember', {});
    if (!force && st.day === todayKey()) { const cur = pool.find((it) => remKey(it) === st.key); if (cur) return cur; }
    const seen = st.seen || [];
    let cand = pool.filter((it) => !seen.includes(remKey(it)) && remKey(it) !== st.key);
    if (!cand.length) cand = pool.filter((it) => remKey(it) !== st.key);
    if (!cand.length) cand = pool;
    const it = cand[Math.floor(Math.random() * cand.length)];
    LS.set('remember', { day: todayKey(), key: remKey(it), seen: [remKey(it)].concat(seen.filter((k) => k !== remKey(it))).slice(0, Math.max(0, Math.min(60, pool.length - 1))) });
    return it;
  }
  function renderRemember(force) {
    const box = $('remember');
    const it = S.remember !== false && NB.view === 'books' && !L.query.trim() && L.entries.length ? pickRemember(force) : null;
    if (!it) { box.hidden = true; R.remItem = null; return; }
    R.remItem = it;
    const b = bookLabel(it.book);
    const body = it.kind === 'note' ? it.body : it.note;
    box.innerHTML = '<div class="rm-kicker">Из прочитанного</div>' +
      (it.text ? '<div class="rm-quote' + (it.kind === 'note' ? ' is-frag' : '') + '">' + esc(shorten(it.text, 420)) + '</div>' : '') +
      (body ? '<div class="rm-thought">' + wikiHtml(shorten(body, 300)) + '</div>' : '') +
      '<div class="rm-src">' + (b.author ? '<b>' + esc(b.author) + '</b> · ' : '') + esc(b.title) + ' · ' + (it.kind === 'note' ? 'заметка от ' : 'сохранено ') + uiDate(it.t) + '</div>' +
      '<div class="rm-actions"><button class="rm-pri" data-rm="open">Открыть в книге</button>' +
      (rememberPool().length > 1 ? '<button data-rm="more">Ещё одну</button>' : '') +
      '<button data-rm="off">Больше не показывать</button></div>';
    if (force) { box.classList.remove('rm-in'); void box.offsetWidth; box.classList.add('rm-in'); }
    box.hidden = false;
  }
  function libClick(ev) {
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      const it = R.remItem;
      if (rm.dataset.rm === 'open' && it) openLibraryItem(it.book, it);
      else if (rm.dataset.rm === 'more') renderRemember(true);
      else if (rm.dataset.rm === 'off') {
        changeSetting('remember', false);
        toastAction('Блок «Вспомнить» скрыт. Вернуть можно в настройках «Аа».', 'Вернуть', () => changeSetting('remember', true), 7000);
      }
      return true;
    }
    const card = ev.target.closest('[data-nbi]');
    if (card) { const it = NB.cards[+card.dataset.nbi]; if (it) openLibraryItem(it.book, it); return true; }
    const ob = ev.target.closest('[data-nb-openbook]');
    if (ob) {
      const e = L.entries.find((x) => x.id === ob.dataset.nbOpenbook);
      if (e) openEntry(e); else toast('Этой книги сейчас нет в папке');
      return true;
    }
    const tg = ev.target.closest('[data-nb-tag]');
    if (tg) { NB.tag = NB.tag === tg.dataset.nbTag ? null : tg.dataset.nbTag; renderNotebook(); return true; }
    const bk = ev.target.closest('[data-nb-book]');
    if (bk) { NB.book = NB.book === bk.dataset.nbBook ? null : bk.dataset.nbBook; renderNotebook(); return true; }
    const md = ev.target.closest('[data-nb-mode]');
    if (md) { NB.mode = md.dataset.nbMode; renderNotebook(); return true; }
    if (ev.target.closest('[data-nb-reset]')) { NB.tag = null; NB.book = null; NB.query = ''; $('search').value = ''; renderNotebook(); return true; }
    return false;
  }


  // ============================================================
  //        Блокнот: чистый листок к книге (кто есть кто, где что было)
  // ============================================================
  // Хранится в polka.pads: { [id книги]: { pages: [текст листа…], t, title, author } }.
  // Сохраняется сам — при закрытии и через секунду тишины. В дневнике — раздел «## Блокнот» в файле книги,
  // листы разделены строкой «---».
  const pads = () => LS.get('pads', {});
  const PAD_COLORS = { ivory: ['Слоновая кость', null], sand: ['Песочный', '#e3d0a7'], sage: ['Серо-зелёный', '#c4cfc4'], rose: ['Серо-розовый', '#d7c4c6'] };
  const PAD_OPTIONS = { font: 'book', paper: 'ivory', rule: 'plain', navigation: 'pages', numbers: true };
  const padOptions = (id) => ({ ...PAD_OPTIONS, ...LS.get('padOptions', {})[id] });
  const PAD_IMAGE = /^!\[Картинка\]\(polka-pad-image:([a-z0-9]+)\/(\d+)\)$/;
  const PAD_LINK = /^\[Открыть в книге\]\((polka:\/\/open\?book=[^)\s]+)\)$/;
  const padEmbedded = (text) => PAD_IMAGE.test(text) || PAD_LINK.test(text);
  const diaryPadImages = new Set();
  const padImageKey = (key) => 'pad-image-' + key;
  async function readPadImage(key) {
    const local = await DB.get('kv', padImageKey(key));
    if (local || !native?.dataRead) return local;
    const dir = await quotesDirQuiet();
    if (!dir) return null;
    const stored = await native.dataRead(dir, padImageKey(key) + '.json');
    if (!stored || stored.length > 16 * 1024 * 1024) return null;
    const data = JSON.parse(stored);
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) return null;
    const bytes = Uint8Array.from(atob(data.slice(22)), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await DB.put('kv', blob, padImageKey(key));
    diaryPadImages.add(dir + '\n' + key);
    return blob;
  }
  async function syncPadImages(body) {
    if (!native?.dataWrite) return;
    const keys = new Set(body.split('\n').map((line) => line.match(PAD_IMAGE)?.[1]).filter(Boolean));
    if (!keys.size) return;
    const dir = await quotesDirQuiet();
    if (!dir) return;
    for (const key of keys) {
      const exported = dir + '\n' + key;
      if (diaryPadImages.has(exported)) continue;
      const blob = await readPadImage(key);
      if (!blob) continue;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await native.dataWrite(dir, padImageKey(key) + '.json', JSON.stringify(data));
      diaryPadImages.add(exported);
    }
  }
  const padOf = (id) => { const x = pads()[id]; return x && Array.isArray(x.pages) ? x : null; };
  const padText = (x) => (x ? x.pages.join('\n\n---\n\n').trim() : '');
  const padEmpty = (x) => !x || !x.pages.some((pg) => pg.trim());
  function padCtxFor(id) {
    if (R.book && R.id === id) return noteCtx();
    const m = L.metas[id] || {}, x = padOf(id) || {};
    return { id, title: m.title || x.title || 'Без названия', author: (m.authors || [])[0] || x.author || '', series: m.series || '',
      items: [].concat(((LS.get('quotes', {}) || {})[id] || []).map((it) => Object.assign({ kind: 'quote' }, it)), ((LS.get('notes', {}) || {})[id] || []).map((it) => Object.assign({ kind: 'note' }, it))) };
  }
  const writePadNote = (id) => serial(async () => {
    if (!native || !native.noteRead) return null;
    const ctx = padCtxFor(id);
    const p = await ensureBookNote(ctx);
    if (!p) return null;
    const md = await readNoteForUpdate(p);
    if (!noteBelongs(md, ctx.id)) throw new Error('Файл дневника относится к другой книге');
    const lines = md.split('\n');
    const r = padRange(lines);
    const at = r ? r.at : (bookThoughtsRange(lines)?.after ?? sectionStart(lines));
    if (r) lines.splice(at, r.after - at);
    const body = padText(padOf(id));
    await syncPadImages(body);
    if (body) lines.splice(at, 0, '', PAD_SEC, '', ...body.split('\n'), '', PAD_END, '');
    await native.noteWrite(p, tidy(lines));
    return p;
  });
  // при открытии книги: правки блокнота, сделанные в файле дневника, подтягиваем
  async function syncPadFromDiary() {
    if (!native || !R.book) return;
    const book = R.book, ctx = noteCtx();
    const p = await bookNotePath(ctx, false);
    if (!p || R.book !== book) return;
    const md = await native.noteRead(p);
    if (md == null || R.book !== book) return;
    const lines = md.split('\n'), r = padRange(lines);
    if (!r) return;
    const text = lines.slice(r.at + 1, r.e).join('\n').trim();
    if (text && text !== padText(padOf(R.id))) savePad(R.id, text.split(/\n\s*---\s*\n/).map((x) => x.replace(/^\n+|\n+$/g, '')), false);
  }
  function savePad(id, pages, toDiary) {
    const all = pads();
    while (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
    if (padEmpty({ pages })) { if (!all[id]) return; delete all[id]; }
    else {
      const ctx = padCtxFor(id);
      all[id] = { pages: pages.slice(), t: Date.now(), title: ctx.title, author: ctx.author };
    }
    if (!LS.set('pads', all)) return;
    if (toDiary !== false) writePadNote(id).catch((e) => console.warn(e));
  }

  function syncPadSettings() {
    const open = !!R.book && !$('pad').hidden;
    const settings = $('settings');
    const tab = settings.querySelector('[data-tab="pad"]');
    tab.hidden = !open;
    if (!open && S.setTab === 'pad') S.setTab = 'text';
    settings.classList.toggle('pad-aligned', open && S.setTab === 'pad');
    if (!open) return;
    const options = padOptions(R.id);
    settings.querySelectorAll('[data-pad-setting]').forEach((button) => {
      const active = options[button.dataset.padSetting] === button.dataset.v;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('set-pad-numbers').checked = options.numbers;
  }

  function padSource(s) {
    return { book: R.book, id: R.id, ch: R.ch, off: s.off, len: s.len };
  }
  function offerPadResult(source, text, result) {
    if (!source?.book || source.book !== R.book || !result) return;
    const button = document.createElement('button');
    button.className = 'link-btn ic-pad';
    button.textContent = 'В блокнот';
    $('ic-body').append(button);
    try { placeNear(infoCard, JSON.parse(infoCard.dataset.anchor), true); } catch (e) { /* карточку уже закрыли */ }
    button.onclick = async () => {
      if (source.book !== R.book) return;
      const url = 'polka://open?book=' + encodeURIComponent(source.id) + '&ch=' + source.ch + '&off=' + source.off + '&len=' + source.len;
      await openPad();
      if (source.book !== R.book || !PADE) return;
      PADE.insertBlock(text.trim() + ' — ' + result.trim() + '\n[Открыть в книге](' + url + ')');
      toast('Добавлено в блокнот');
    };
  }

  async function notebookImage(blob) {
    if (blob.size > 24 * 1024 * 1024) throw new Error('Файл изображения слишком большой');
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('Не удалось прочитать изображение');
      return png;
    } finally { bitmap.close(); }
  }

  const notebookListeners = new WeakMap();
  function notebookClipboard(host, E) {
    notebookListeners.get(host)?.abort();
    const lifetime = new AbortController();
    notebookListeners.set(host, lifetime);
    const fail = () => toast('Не удалось воспользоваться буфером обмена');
    const input = () => host.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : E.ta;
    const close = () => { $('pad-context').hidden = true; };
    const paste = (blob, target, text) => {
      if (!blob) { if (text) E.pasteText(target, text); return; }
      E.insertImage(blob, target).catch(() => toast('Не удалось вставить картинку'));
    };
    host.onpaste = (ev) => {
      const item = Array.from(ev.clipboardData?.items || []).find((x) => x.kind === 'file' && x.type.startsWith('image/'));
      if (!item) {
        if (ev.target.tagName === 'TEXTAREA') return;
        const text = ev.clipboardData?.getData('text/plain');
        if (!text) return;
        ev.preventDefault();
        paste(null, input(), text);
        return;
      }
      ev.preventDefault();
      paste(item.getAsFile(), input());
    };
    host.oncontextmenu = (ev) => {
      ev.preventDefault();
      const target = ev.target.closest('textarea') || input();
      if (!target) return;
      const menu = $('pad-context');
      menu.hidden = false;
      menu.style.left = Math.max(0, Math.min(ev.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = Math.max(0, Math.min(ev.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
      const image = ev.target.closest('[data-pad-image]')?.dataset.padImage || E.selectedImage;
      const selected = target.value.slice(target.selectionStart, target.selectionEnd);
      menu.querySelector('[data-copy]').disabled = !selected && !image;
      menu.onclick = async (event) => {
        const action = event.target.closest('button');
        if (!action) return;
        close();
        try {
          if ('copy' in action.dataset) {
            const data = image && await readPadImage(image);
            if (data) await copyPadImage(data);
            else if (selected) {
              if (native?.padClipboardWrite) await native.padClipboardWrite({ text: selected });
              else await navigator.clipboard.writeText(selected);
            }
          } else if (native?.padClipboardRead) {
            const data = await native.padClipboardRead();
            paste(data.image && new Blob([data.image], { type: 'image/png' }), target, data.text);
          } else {
            const items = await navigator.clipboard.read();
            const item = items.find((x) => x.types.some((type) => type.startsWith('image/')));
            if (item) paste(await item.getType(item.types.find((type) => type.startsWith('image/'))), target);
            else {
              const text = items.find((x) => x.types.includes('text/plain'));
              if (text) paste(null, target, await (await text.getType('text/plain')).text());
            }
          }
        } catch (err) { fail(); }
      };
    };
    host.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyC' && E.selectedImage) {
        ev.preventDefault();
        readPadImage(E.selectedImage).then((data) => data && copyPadImage(data)).catch(fail);
      }
    }, { capture: true, signal: lifetime.signal });
  }

  async function copyPadImage(blob) {
    if (native?.padClipboardWrite) await native.padClipboardWrite({ image: new Uint8Array(await blob.arrayBuffer()) });
    else await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  // ---- листок: страницы как в настоящем блокноте ----
  // Каждый лист — поле фиксированной высоты. Не влезает — хвост переезжает на следующий лист.
  function padEditor(host, id, opts) {
    opts = opts || {};
    const x = padOf(id);
    const E = { id, pages: x ? x.pages.slice() : [''], cur: 0, dirty: false, timer: null };
    host.innerHTML = '<textarea class="pad-ta" spellcheck="true" lang="ru" aria-label="Блокнот"></textarea>' +
      '<div class="pad-rich" hidden></div>' +
      '<div class="pad-folio" hidden><button class="pf-prev" aria-label="Предыдущий лист">‹</button><span class="pf-n"></span><button class="pf-next" aria-label="Следующий лист">›</button></div>';
    const ta = host.querySelector('.pad-ta'), folio = host.querySelector('.pad-folio'), rich = host.querySelector('.pad-rich');
    let options = padOptions(id), visiblePage = 0;
    const paged = () => options.navigation !== 'scroll';
    ta.value = E.pages[0]; // первый show() сохраняет поле в текущий лист — поле должно быть заполнено
    const commit = () => { if (!ta.hidden) E.pages[E.cur] = ta.value; };
    const number = folio.querySelector('.pf-n'), prev = folio.querySelector('.pf-prev'), next = folio.querySelector('.pf-next');
    function syncFolio() {
      const n = E.pages.length;
      folio.hidden = !paged() ? !options.numbers : n < 2 && (!options.numbers || !E.pages[0].trim());
      number.hidden = !options.numbers;
      number.innerHTML = '<b>' + ((paged() ? E.cur : visiblePage) + 1) + '</b> / ' + n;
      prev.hidden = next.hidden = !paged();
      prev.disabled = E.cur === 0;
      next.disabled = E.cur === n - 1;
    }
    const show = (i, caret, saveCurrent = true) => {
      if (saveCurrent) commit();
      E.cur = Math.max(0, Math.min(E.pages.length - 1, i));
      visiblePage = E.cur;
      ta.value = E.pages[E.cur];
      E.selectedImage = null;
      ta.hidden = !paged() || ta.value.split('\n').some(padEmbedded);
      rich.hidden = !ta.hidden;
      if (ta.hidden) renderRich();
      else { rich.replaceChildren(); E.ta = ta; }
      syncFolio();
      if (caret != null) focusAt(E.cur, caret < 0 ? E.pages[E.cur].length : caret);
      else if (!paged()) rich.querySelector('[data-pad-page="' + E.cur + '"]')?.scrollIntoView({ block: 'nearest' });
    };
    const saveSoon = () => { E.dirty = true; clearTimeout(E.timer); E.timer = setTimeout(E.save, 1000); };
    E.save = () => { clearTimeout(E.timer); if (!E.dirty) return; commit(); E.dirty = false; savePad(E.id, E.pages.slice()); if (opts.onSave) opts.onSave(); };
    E.applyAppearance = () => {
      host.dataset.padRule = options.rule;
      host.dataset.padFont = options.font;
      host.style.setProperty('--pad-custom-paper', PAD_COLORS[options.paper]?.[1] || 'var(--pad-paper)');
      host.style.setProperty('--pad-text-size', S.size + 'px');
      host.querySelectorAll('.pad-rich-text').forEach(sizeText);
    };
    E.setOption = (key, value) => {
      commit();
      const hadFocus = host.contains(document.activeElement);
      const caret = cursorOffset(E.ta);
      const all = LS.get('padOptions', {});
      options = { ...options, [key]: value };
      all[id] = options;
      LS.set('padOptions', all);
      E.applyAppearance();
      if (key === 'navigation') {
        const index = value === 'pages' ? visiblePage : E.cur;
        const offset = index === E.cur ? caret : 0;
        show(index, null, false);
        focusAt(index, offset, hadFocus);
      } else syncFolio();
      syncPadSettings();
    };
    function cursorOffset(target) {
      if (!target || target === ta) return ta.selectionStart;
      const section = target.closest('[data-pad-page]');
      const fields = Array.from(section?.children || []);
      const index = fields.indexOf(target);
      return fields.slice(0, Math.max(0, index)).reduce((n, field) => n + chunkValue(field).length + 1, target.selectionStart);
    }
    function focusAt(index, caret, focus = true) {
      let target = ta;
      if (ta.hidden) {
        const section = rich.querySelector('[data-pad-page="' + index + '"]');
        let last;
        for (const field of section?.children || []) {
          if (field.tagName === 'TEXTAREA') {
            last = field;
            if (caret <= field.value.length) break;
          }
          caret -= chunkValue(field).length + 1;
        }
        target = last || E.ta;
      }
      if (!target) return;
      E.ta = target;
      if (ta.hidden && !focus) target.scrollIntoView({ block: 'nearest' });
      if (focus) target.focus();
      const offset = Math.max(0, Math.min(target.value.length, caret));
      target.setSelectionRange(offset, offset);
    }
    const chunkValue = (node) => node.tagName === 'TEXTAREA' ? node.value : node.dataset.markdown;
    function richInput(section) {
      const index = Number(section.dataset.padPage);
      E.pages[index] = Array.from(section.children, chunkValue).join('\n');
      saveSoon();
    }
    function sizeText(field) {
      field.style.height = '0px';
      field.style.height = field.scrollHeight + 'px';
    }
    let drawVersion = 0;
    function renderRich() {
      const version = ++drawVersion;
      rich.replaceChildren();
      E.ta = null;
      const indexes = paged() ? [E.cur] : E.pages.map((_, index) => index);
      for (const index of indexes) {
        const section = document.createElement('div');
        section.className = 'pad-rich-page';
        section.dataset.padPage = index;
        const addText = (lines) => {
          const field = document.createElement('textarea');
          field.className = 'pad-rich-text';
          field.value = lines.join('\n');
          field.lang = 'ru';
          field.setAttribute('aria-label', 'Блокнот, лист ' + (index + 1));
          field.oninput = () => { sizeText(field); richInput(section); };
          field.onfocus = () => { E.ta = field; E.cur = index; selectImage(null); syncFolio(); };
          field.onpointerdown = () => selectImage(null);
          field.onkeydown = (event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); opts.onEscape?.(); }
            else if (paged() && event.key === 'PageUp' && index > 0) { event.preventDefault(); show(index - 1, -1); }
            else if (paged() && event.key === 'PageDown') {
              event.preventDefault();
              if (index === E.pages.length - 1 && E.pages[index].trim()) E.pages.push('');
              show(index + 1, 0);
            }
          };
          section.append(field);
          if (index === E.cur && !E.ta) E.ta = field;
        };
        let text = [];
        for (const line of E.pages[index].split('\n')) {
          const image = line.match(PAD_IMAGE), link = line.match(PAD_LINK);
          if (!image && !link) { text.push(line); continue; }
          addText(text); text = [];
          if (image) addImage(section, line, image, version);
          else {
            const open = document.createElement('button');
            open.className = 'pad-source';
            open.dataset.markdown = line;
            open.textContent = 'Открыть в книге';
            open.onclick = () => openLink(link[1]);
            section.append(open);
          }
        }
        addText(text);
        rich.append(section);
        section.querySelectorAll('textarea').forEach(sizeText);
      }
    }
    function selectImage(fig) {
      rich.querySelectorAll('[data-pad-image]').forEach((item) => item.classList.toggle('selected', item === fig));
      E.selectedImage = fig?.dataset.padImage || null;
    }
    function addImage(section, line, [, key, size], version) {
      const figure = document.createElement('figure');
      figure.className = 'pad-image';
      figure.dataset.markdown = line;
      figure.dataset.padImage = key;
      const img = document.createElement('img');
      img.alt = 'Картинка из блокнота';
      img.draggable = false;
      const width = (value) => {
        const clamped = Math.max(15, Math.min(100, Math.round(value)));
        figure.style.width = clamped + '%';
        figure.dataset.markdown = '![Картинка](polka-pad-image:' + key + '/' + clamped + ')';
      };
      width(Number(size));
      const handle = document.createElement('button');
      handle.className = 'pad-resize';
      handle.setAttribute('aria-label', 'Изменить размер картинки');
      figure.tabIndex = 0;
      figure.onfocus = figure.onpointerdown = () => selectImage(figure);
      figure.onkeydown = (event) => {
        event.stopPropagation();
        if (event.target !== figure) return;
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault();
        const before = figure.previousElementSibling, after = figure.nextElementSibling;
        before.value += (before.value && after.value ? '\n' : '') + after.value;
        after.remove(); figure.remove();
        sizeText(before); richInput(section); selectImage(null); before.focus();
      };
      handle.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        width(parseInt(figure.style.width, 10) + (event.key === 'ArrowRight' ? 5 : -5));
        richInput(section);
      };
      handle.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX, startWidth = figure.getBoundingClientRect().width;
        handle.onpointermove = (move) => width(100 * (startWidth + move.clientX - startX) / section.clientWidth);
        handle.onlostpointercapture = () => { handle.onpointermove = null; richInput(section); };
      };
      figure.append(img, handle);
      section.append(figure);
      readPadImage(key).then(async (blob) => {
        if (version !== drawVersion || !figure.isConnected) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          img.src = url;
          try { await img.decode(); } catch (e) { /* картинка недоступна */ } finally { URL.revokeObjectURL(url); }
        } else img.replaceWith(document.createTextNode('Картинка недоступна'));
      }).catch(() => { if (figure.isConnected) img.replaceWith(document.createTextNode('Картинка недоступна')); });
    }
    function insertBlock(block, target = E.ta) {
      if (!target || !host.contains(target)) return;
      commit();
      const index = Number(target.closest('[data-pad-page]')?.dataset.padPage ?? E.cur);
      const start = cursorOffset(target), end = start + target.selectionEnd - target.selectionStart;
      const before = E.pages[index].slice(0, start), after = E.pages[index].slice(end);
      const left = before.endsWith('\n') || !before ? before : before + '\n';
      const right = after.startsWith('\n') || !after ? after : '\n' + after;
      E.pages[index] = left + block + right;
      show(index, null, false);
      focusAt(index, left.length + block.length + 1);
      saveSoon();
      E.save();
    }
    E.insertBlock = insertBlock;
    E.insertImage = async (blob, target) => {
      const image = await notebookImage(blob);
      if (!host.contains(target) || !host.isConnected || host.getClientRects().length === 0) return;
      const key = newId('i');
      await DB.put('kv', image, padImageKey(key));
      if (host.contains(target) && host.getClientRects().length > 0) insertBlock('![Картинка](polka-pad-image:' + key + '/100)', target);
    };
    E.pasteText = (target, text) => {
      if (!host.contains(target) || host.getClientRects().length === 0) return;
      target.setRangeText(text, target.selectionStart, target.selectionEnd, 'end');
      target.dispatchEvent(new Event('input'));
      target.focus();
    };
    rich.onscroll = () => {
      if (paged()) return;
      const top = rich.getBoundingClientRect().top;
      const section = Array.from(rich.children).find((page) => page.getBoundingClientRect().bottom > top + 1);
      if (section) { visiblePage = Number(section.dataset.padPage); syncFolio(); }
    };
    // лист переполнен — хвост переезжает на следующий лист (и так по цепочке). Меряем копией поля той же ширины.
    const meter = document.createElement('textarea'); meter.className = 'pad-ta'; meter.tabIndex = -1; meter.setAttribute('aria-hidden', 'true');
    meter.style.cssText = 'visibility:hidden;pointer-events:none';
    host.appendChild(meter);
    const fits = (t) => { meter.value = t; return meter.scrollHeight <= meter.clientHeight + 1; };
    // высота текста без рамки поля — чтобы понять, на первой или последней строке курсор
    const lines = document.createElement('textarea'); lines.className = 'pad-ta'; lines.tabIndex = -1; lines.setAttribute('aria-hidden', 'true');
    lines.style.cssText = 'visibility:hidden;pointer-events:none;bottom:auto;height:0;min-height:0';
    host.appendChild(lines);
    const textH = (t) => { lines.value = t; return lines.scrollHeight; };
    const onFirstLine = () => textH(ta.value.slice(0, ta.selectionStart)) <= textH('x');
    const onLastLine = () => textH(ta.value.slice(0, ta.selectionEnd)) >= textH(ta.value);
    const split = (t) => { // сколько влезает на лист — по словам/строкам
      if (fits(t)) return [t, ''];
      let lo = 0, hi = t.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fits(t.slice(0, mid))) lo = mid; else hi = mid - 1; }
      let k = lo; const br = Math.max(t.lastIndexOf('\n', lo), t.lastIndexOf(' ', lo));
      if (br > lo * 0.6) k = br;
      return [t.slice(0, k), t.slice(k).replace(/^[ \n]/, '')];
    };
    const reflow = () => {
      if (ta.scrollHeight <= ta.clientHeight + 1) return;
      const caret = ta.selectionStart;
      commit();
      for (let i = E.cur; i < E.pages.length; i++) {
        const [head, tail] = split(E.pages[i]);
        if (!head && tail) break; // даже один символ не помещается
        if (!tail) continue;
        E.pages[i] = head;
        if (i === E.pages.length - 1) E.pages.push('');
        E.pages[i + 1] = tail + (E.pages[i + 1] ? (tail.endsWith('\n') ? '' : '\n') + E.pages[i + 1] : '');
      }
      // курсор: если он уехал на следующий лист — идём за ним
      const head = E.pages[E.cur];
      ta.value = head;
      let i = E.cur, c = caret;
      while (c > E.pages[i].length && i < E.pages.length - 1) { c -= E.pages[i].length + 1; i++; }
      show(i, Math.max(0, Math.min(E.pages[i].length, c)));
    };
    ta.addEventListener('input', () => { reflow(); saveSoon(); });
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyN')) { ev.preventDefault(); if (opts.onEscape) opts.onEscape(); return; }
      // стрелки переходят с листа на лист, как по одной длинной странице
      if (!ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const a = ta.selectionStart, b = ta.selectionEnd, last = E.pages.length - 1;
        if (ev.key === 'ArrowDown' && E.cur < last && onLastLine()) { ev.preventDefault(); show(E.cur + 1, 0); return; }
        if (ev.key === 'ArrowUp' && E.cur > 0 && onFirstLine()) { ev.preventDefault(); show(E.cur - 1, -1); return; }
        if (ev.key === 'ArrowRight' && E.cur < last && a === b && b === ta.value.length) { ev.preventDefault(); show(E.cur + 1, 0); return; }
        if (ev.key === 'ArrowLeft' && E.cur > 0 && a === b && a === 0) { ev.preventDefault(); show(E.cur - 1, -1); return; }
      }
      // Backspace в начале листа — к концу предыдущего
      if (ev.key === 'Backspace' && E.cur > 0 && ta.selectionStart === 0 && ta.selectionEnd === 0) {
        ev.preventDefault();
        if (!ta.value.trim()) { E.pages.splice(E.cur, 1); show(E.cur - 1, -1, false); saveSoon(); return; }
        show(E.cur - 1, -1); return;
      }
      if (ev.key === 'PageDown' || (ev.ctrlKey && ev.key === 'ArrowRight' && ev.altKey)) { ev.preventDefault(); if (E.cur < E.pages.length - 1) show(E.cur + 1, 0); }
      if (ev.key === 'PageUp') { ev.preventDefault(); if (E.cur > 0) show(E.cur - 1, -1); }
    });
    folio.addEventListener('click', (ev) => {
      if (ev.target.closest('.pf-prev')) show(E.cur - 1, -1);
      else if (ev.target.closest('.pf-next')) show(E.cur + 1, 0);
    });
    let wAcc = 0, wLock = 0;
    host.onwheel = (ev) => {
      ev.stopPropagation();
      if (!paged() || !rich.hidden || E.pages.length < 2) return;
      wAcc += ev.deltaY;
      if (Date.now() < wLock || Math.abs(wAcc) < 60) return;
      const d = wAcc > 0 ? 1 : -1; wAcc = 0; wLock = Date.now() + 350;
      if (E.cur + d >= 0 && E.cur + d < E.pages.length) show(E.cur + d, d > 0 ? 0 : -1);
    };
    notebookClipboard(host, E);
    E.applyAppearance();
    show(Math.max(0, E.pages.length - 1));
    E.focusEnd = () => show(E.cur, -1);
    return E;
  }

  // ---- блокнот в книге ----
  let PADE = null;
  const padOpen = () => !$('pad').hidden;
  async function openPad() {
    if (!R.book || padOpen()) return;
    closePanels();
    $('pad').hidden = false; reader.classList.add('pad-on'); $('btn-pad').classList.add('active');
    PADE = padEditor($('pad-sheet'), R.id, { onEscape: () => closePad() });
    syncSettings();
    const editor = PADE;
    await relayout();
    if (PADE === editor) editor.focusEnd();
  }
  async function closePad() {
    if (!padOpen()) return;
    if (PADE) PADE.save();
    PADE = null;
    $('pad').hidden = true; reader.classList.remove('pad-on'); $('btn-pad').classList.remove('active');
    syncSettings();
    await relayout();
  }
  const togglePad = () => (padOpen() ? closePad() : openPad());
  window.__pad = { open: openPad, close: closePad, editor: () => PADE };
  $('btn-pad').onclick = togglePad;
  $('set-pad-numbers').onchange = (event) => PADE?.setOption('numbers', event.target.checked);
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#pad-context')) $('pad-context').hidden = true;
  });
  // клик по тексту книги (не по полям для листания) закрывает листок
  stage.addEventListener('mousedown', (ev) => {
    if (!padOpen() || ev.button !== 0) return;
    const z = zoneOf(ev.clientX - stage.getBoundingClientRect().left);
    if (!z) setTimeout(() => { if (!String(window.getSelection())) closePad(); }, 0);
  });

  // ---- раздел «Блокноты» на главной ----
  const PADV = { open: null, query: '', ed: null };
  function renderPads() {
    const box = $('pads');
    if (PADV.ed) { PADV.ed.save(); PADV.ed = null; }
    const all = pads(), q = PADV.query.trim().toLowerCase().replace(/ё/g, 'е');
    const ids = Object.keys(all).filter((id) => !padEmpty(all[id])).sort((a, b) => (all[b].t || 0) - (all[a].t || 0));
    const title = (id) => (L.metas[id] && L.metas[id].title) || all[id].title || 'Без названия';
    const author = (id) => ((L.metas[id] && L.metas[id].authors) || [])[0] || all[id].author || '';
    if (PADV.open && all[PADV.open]) {
      const id = PADV.open, inLib = L.entries.some((e) => e.id === id);
      box.innerHTML = '<div class="pads-open"><div class="pad-sheet big" id="pad-big"></div><div class="po-side">' +
        '<div class="po-k">Блокнот к книге</div><div class="po-t">' + esc(title(id)) + '</div><div class="po-a">' + esc(author(id)) + (author(id) ? ' · ' : '') + 'изменён ' + ago(all[id].t) + '</div>' +
        '<div class="po-act">' + (inLib ? '<button data-pad-book="' + esc(id) + '">Открыть книгу →</button>' : '<span class="po-miss">Книги сейчас нет в папке</span>') +
        '<button class="po-back" data-pad-back="1">← Все блокноты</button></div></div></div>';
      PADV.ed = padEditor($('pad-big'), id, { onEscape: () => { PADV.open = null; renderPads(); } });
      return;
    }
    PADV.open = null;
    const list = ids.filter((id) => !q || (title(id) + ' ' + author(id) + ' ' + padText(all[id])).toLowerCase().replace(/ё/g, 'е').includes(q));
    if (!ids.length) {
      box.innerHTML = '<div class="pads-empty"><div class="pads-paper"></div><h2>Блокнотов пока нет</h2><p>Во время чтения нажмите <kbd>N</kbd> или значок блокнота наверху — откроется чистый листок для заметок к книге: кто есть кто, где что было. Он появится здесь.</p></div>';
      return;
    }
    box.innerHTML = '<div class="pads-head"><h2>Блокноты<span>' + list.length + '</span></h2></div>' +
      (list.length ? '<div class="pads-grid">' + list.map((id, i) => {
        const x = all[id], first = x.pages.find((pg) => pg.trim()) || '';
        const lines = first.split('\n').slice(0, 9).map((l) => '<span>' + (esc(l) || '&nbsp;') + '</span>').join('');
        return '<button class="padc" data-pad="' + esc(id) + '" style="--r:' + ([-.6, .5, -.3, .7, -.5][i % 5]) + 'deg">' + (x.pages.length > 1 ? '<span class="padc-under"></span>' : '') +
          '<span class="padc-paper"><span class="padc-lines">' + lines + '</span></span>' +
          '<span class="padc-t">' + esc(title(id)) + '</span><span class="padc-a">' + esc(author(id)) + (author(id) ? ' · ' : '') + ago(x.t) + (x.pages.length > 1 ? ' · ' + x.pages.length + ' ' + plural(x.pages.length, 'лист', 'листа', 'листов') : '') + '</span></button>';
      }).join('') + '</div>' : '<p class="nothing">Ничего не найдено</p>');
  }
  $('pads').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-pad]');
    if (c) { PADV.open = c.dataset.pad; renderPads(); $('lib-main').scrollTop = 0; return; }
    if (ev.target.closest('[data-pad-back]')) { PADV.open = null; renderPads(); return; }
    const b = ev.target.closest('[data-pad-book]');
    if (b) { if (PADV.ed) PADV.ed.save(); const e = L.entries.find((x) => x.id === b.dataset.padBook); if (e) openEntry(e); }
  });

  // запуск
  buildSettings();
  applyFocus();
  if (native) {
    native.onOpenFile((p) => openPath(p));
    if (native.onOpenUrl) native.onOpenUrl((u) => openLink(u));
  }
  (async () => {
    await loadLibrary();
    if (native) {
      const f = await native.initialFile(); if (f) openPath(f);
      const u = native.initialUrl && await native.initialUrl(); if (u) openLink(u);
    }
  })();

  // для отладки и автотестов
  // кнопка, нажатая мышью, не держит фокус: иначе после первой же клавиши (стрелки, T, B)
  // Chromium зажигает на ней кольцо :focus-visible, а во время чтения ничего не должно светиться
  document.addEventListener('click', (ev) => {
    if (!ev.detail) return; // Enter/пробел с клавиатуры — фокус остаётся, кольцо нужно
    const b = ev.target.closest && ev.target.closest('button');
    if (b) setTimeout(() => { if (document.activeElement === b) b.blur(); }); // после обработчиков, даже если они остановили всплытие
  }, true);
  window.__polka = { R, L, S, openEntry, next, prev, goTo, scan, relayout, changeSetting, openLink: (u) => openLink(u), meaning: (t) => showMeaning(t, [{ left: 500, right: 600, top: 300, bottom: 320 }]) };
})();
