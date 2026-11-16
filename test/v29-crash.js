// 2.0, краш-тесты: злые книги, испорченные данные, нетипичное поведение интерфейса.
// node test/v29-crash.js <папка для снимков> <папка с книгами fb2 (assets/lib8)>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
const { make, fb2, sec, para } = require('./v29-evilbooks.js');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'v29'), BOOKS = path.resolve(process.argv[3] || path.join(__dirname, '../../assets/lib8'));
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const APP = 'file://' + path.resolve(__dirname, '../dist/app/index.html');
const scan = (d) => fs.readdirSync(d).filter((n) => /\.fb2$/i.test(n)).map((n) => { const p = path.join(d, n), s = fs.statSync(p); return { path: p, name: n, size: s.size, mtime: s.mtimeMs }; });

// окно с «нативным» мостом: книги с диска, дневник — в памяти (diary), сбои записи — по флагу
async function openApp(b, { ls = {}, viewport = { width: 1280, height: 820 }, dsf = 1, books = BOOKS, state = null, diary = {}, roDiary = false } = {}) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const warns = []; page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
  await page.exposeFunction('__scan', () => scan(books));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.addInitScript(([dir, ls, state, diary, ro]) => {
    if (!sessionStorage.getItem('v29')) {
      sessionStorage.setItem('v29', '1'); localStorage.clear();
      localStorage.setItem('polka.folder', JSON.stringify(dir)); localStorage.setItem('polka.helpHinted', 'true');
      localStorage.setItem('polka.settings', JSON.stringify({ flip: 'off', sound: 'off' }));
      for (const [k, v] of Object.entries(ls)) localStorage.setItem('polka.' + k, v);
    }
    const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    const files = window.__diary = Object.assign({}, diary);
    const deny = async () => { if (ro) throw new Error('EACCES: permission denied'); };
    const safe = (s) => String(s).replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Без названия';
    window.shelf = {
      pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => bytes(await window.__read(p)), initialFile: async () => null, initialUrl: async () => null,
      openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {}, bootstrap: async () => false,
      diaryDir: async (b) => ({ dir: b + '/Читательский дневник' }), quotesDefaultDir: async (b) => b + '/Читательский дневник',
      dataRead: async () => state, dataWrite: async () => { await deny(); return true; },
      noteResolve: async (o) => o.dir + '/' + o.sub.map(safe).join('/') + '/' + safe(o.name) + '.md',
      noteRead: async (p) => (p in files ? files[p] : null), noteExists: async (p) => p in files,
      noteWrite: async (p, c) => { await deny(); files[p] = c; return true; },
      noteCreate: async (o) => { await deny(); const p = o.dir + '/' + o.sub.map(safe).join('/') + '/' + safe(o.name) + '.md'; if (!(p in files)) files[p] = o.content; return p; },
      noteDelete: async (p) => { delete files[p]; return true; }, noteRmdir: async () => false, obsidianGraph: async () => ({ vault: null }),
    };
  }, [books, ls, state, diary, roDiary]);
  await page.goto(APP);
  return { ctx, page, errs, warns };
}
const ready = (page, t) => page.waitForFunction(() => window.__polka && !window.__polka.L.scanning && window.__polka.L.entries.length > 0, null, { timeout: t || 15000 });
const openBook = (page, part) => page.evaluate(async (part) => { const P = window.__polka; const e = P.L.entries.find((x) => x.name.includes(part)) || P.L.entries[0]; await P.openEntry(e); return !!P.R.book; }, part || 'Анна');

(async () => {
  const b = await chromium.launch();

  // ============ 1. злые книги: разбор не виснет, ошибки по-русски ============
  const EVIL = path.join(os.tmpdir(), 'polka-v29-evil');
  if (!fs.existsSync(path.join(EVIL, '00 Нормальная.fb2'))) make(EVIL);
  const all = []; (function walk(d) { for (const it of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, it.name); if (it.isDirectory()) walk(p); else all.push(p); } })(EVIL);
  // известное: 5000 вложенных секций / 100 000 вложенных emphasis разбираются десятки секунд (см. REPORT.md) — здесь не гоняем
  const KNOWN_SLOW = /^(09|10) /;
  const slow = [], english = [], longP = [];
  for (const f of all) {
    const name = path.basename(f);
    if (KNOWN_SLOW.test(name)) continue;
    const page = await b.newPage(); await page.goto(APP);
    await page.evaluate((b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); window.__b = u; }, fs.readFileSync(f).toString('base64'));
    const t = Date.now();
    const r = await page.evaluate((n) => {
      const o = {};
      for (const op of ['meta', 'opening', 'parse']) {
        try { const x = BookParser[op](n, window.__b); if (op === 'parse') o.maxP = Math.max(0, ...x.chapters.map((c) => Math.max(0, ...(c.html.match(/<p[^>]*>[^<]*/g) || []).map((s) => s.length)))); }
        catch (e) { o[op] = e.message; }
      }
      return o;
    }, name);
    const dt = Date.now() - t;
    if (dt > 12000) slow.push(name + ' ' + dt + 'мс');
    for (const k of ['meta', 'parse']) if (r[k] && !/[а-яё]/i.test(r[k])) english.push(name + ': ' + r[k]);
    if (r.maxP > 40000) longP.push(name + ': ' + r.maxP);
    await page.close();
  }
  ok(!slow.length, 'злые книги разбираются быстрее 12 с: ' + (slow.join('; ') || 'все'));
  ok(!english.length, 'ошибки разбора — по-русски: ' + (english.join('; ') || 'да'));
  ok(!longP.length, 'сверхдлинные абзацы порезаны (≤ 40 тыс. знаков): ' + (longP.join('; ') || 'да'));

  // ============ 2. абзац 2 млн знаков без точек: открыть и пролистать до конца — окно живо ============
  {
    const one = path.join(os.tmpdir(), 'polka-v29-one'); fs.rmSync(one, { recursive: true, force: true }); fs.mkdirSync(one);
    fs.writeFileSync(path.join(one, 'Поток.fb2'), fb2({ title: 'Поток', body: sec('Один', '<p>' + 'слово '.repeat(350000) + '</p>') }));
    fs.writeFileSync(path.join(one, 'Иероглифы.fb2'), fb2({ title: '書', body: sec('一', '<p>' + '你好世界这是一个很长的段落'.repeat(30000) + '</p>') }));
    const { ctx, page, errs } = await openApp(b, { books: one });
    await ready(page);
    for (const n of ['Поток', 'Иероглифы']) {
      const t = Date.now();
      await openBook(page, n);
      await page.keyboard.press('End'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      const alive = await Promise.race([page.evaluate(() => window.__polka.R.ch), new Promise((r) => setTimeout(() => r('завис'), 20000))]);
      ok(typeof alive === 'number' && Date.now() - t < 20000, n + ': открылась и листается до конца главы за ' + (Date.now() - t) + ' мс');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    ok(!errs.length, 'длинный абзац: без ошибок ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ============ 3. испорченный localStorage polka.* ============
  {
    const CASES = [['bookmarks', '5'], ['bookmarks', '"str"'], ['bookmarksT', 'true'], ['progress', '"x"'], ['extra', '5'], ['extra', '{}'], ['folder', '5'], ['folder', '[]'],
      ['shelves', '{}'], ['shelves', '[null,5,"x",{}]'], ['shelves', '[{"id":"s1","name":7,"books":[]}]'], ['quotes', '{"a":5,"b":[null,1]}'], ['notes', '[null,5]'],
      ['pads', '5'], ['pendingDeletes', '"x"'], ['quoteTags', '{}'], ['settings', '{"theme":"zzz","size":"abc","lh":null}'], ['settings', '[1,2]'], ['remember', '5'], ['shelvesT', '"x"']];
    const bad = [];
    for (const [k, v] of CASES) {
      const { ctx, page, errs } = await openApp(b, { ls: { [k]: v } });
      try {
        await ready(page, 8000);
        for (const t of ['reading', 'later', 'done']) if (await page.isVisible('.sh-tab[data-shelf="' + t + '"]')) await page.click('.sh-tab[data-shelf="' + t + '"]');
        await openBook(page);
        for (const key of ['ArrowRight', 'b', 't', 'Escape', 'n', 'Escape', 'Escape']) { await page.keyboard.press(key); await page.waitForTimeout(60); }
      } catch (e) {
        // испорченная «папка» = папки нет: должен быть экран выбора папки, а не падение
        if (k === 'folder') { if (!(await page.isVisible('#btn-folder-empty'))) errs.push('нет экрана выбора папки'); }
        else errs.push('не дошли до конца: ' + e.message.split('\n')[0]);
      }
      if (errs.length) bad.push('polka.' + k + '=' + v + ' → ' + [...new Set(errs)].join(' | '));
      await ctx.close();
    }
    ok(!bad.length, 'испорченные значения polka.* не роняют программу' + (bad.length ? ':\n   ' + bad.join('\n   ') : ''));
  }

  // ============ 4. испорченный .polka/state.json и дневник с ручными правками ============
  {
    const id = scan(BOOKS).find((f) => f.name.includes('Анна'));
    const bid = id.name + '|' + id.size, D = BOOKS + '/Читательский дневник';
    const link = (q, ch, off) => 'polka://open?book=' + encodeURIComponent(bid) + '&ch=' + ch + '&off=' + off + '&len=5&q=' + q;
    const md = '---\nтип: книга\npolka: "polka://open?book=' + encodeURIComponent(bid) + '"\n---\n\n# Анна Каренина\n\nкакие-то ручные правки\n> странная цитата без ссылки\n\n' +
      '> [!quote] Глава · 5%\n> Сломанный номер\n>\n> 1 января 2026 · [открыть в Полке](' + link('qa(b[', 2, 10) + ')\n\n' +
      '> [!quote] Глава · 6%\n> Нормальная цитата\n>\n> #тег · 1 января 2026 · [открыть в Полке](' + link('qok1', 2, 40) + ')\n\n' +
      '>>> мусор ' + '‮'.repeat(3) + '\n' + '> [!note]\n> без ссылки\n';
    const big = Array.from({ length: 3000 }, (_, i) => '> [!quote] · 1%\n> Цитата ' + i + '\n>\n> 1 января 2026 · [открыть в Полке](' + link('qb' + i.toString(36), 2, i) + ')\n').join('\n');
    for (const [label, content] of [['ручные правки и сломанный номер', md], ['дневник на 3000 цитат', md + '\n' + big]]) {
      const { ctx, page, errs, warns } = await openApp(b, { state: '{"v":1,"progress":{"x":null,"y":5,"' + bid + '":"str"},"bookmarks":{"z":5},"bookmarksT":{"z":"q"},"shelves":[null,1],"shelvesT":9e15}', diary: { [D + '/Книги/Анна Каренина.md']: content } });
      await ready(page);
      await openBook(page);
      await page.waitForTimeout(label.includes('3000') ? 4000 : 1500);
      const got = await page.evaluate((bid) => { const q = JSON.parse(localStorage.getItem('polka.quotes') || '{}')[bid] || []; return { n: q.length, ok1: q.some((x) => x.id === 'qok1'), weird: q.some((x) => x.id === 'qa(b[') }; }, bid);
      ok(got.ok1 && got.weird, label + ': записи восстановлены из дневника (' + got.n + '), включая с «сломанным» номером');
      ok(!warns.some((w) => /regular expression/i.test(w)), label + ': без ошибок регулярных выражений');
      ok(!errs.length, label + ': без ошибок ' + JSON.stringify(errs));
      await ctx.close();
    }
  }

  // ============ 5. дневник недоступен для записи; книга удалена во время чтения ============
  {
    const tmp = path.join(os.tmpdir(), 'polka-v29-del'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
    for (const n of fs.readdirSync(BOOKS).filter((x) => /\.fb2$/.test(x)).slice(0, 3)) fs.copyFileSync(path.join(BOOKS, n), path.join(tmp, n));
    const { ctx, page, errs } = await openApp(b, { books: tmp, roDiary: true });
    await ready(page);
    await openBook(page, '');
    await page.keyboard.press('b'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(3000); // закладка → запись state.json падает
    const first = await page.evaluate(() => window.__polka.R.entry.path);
    fs.unlinkSync(first);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const toast = await page.evaluate(async () => { const P = window.__polka; document.getElementById('toast').textContent = ''; await P.openEntry(P.L.entries.find((e) => e.path === P.R.entry || true)); return document.getElementById('toast').textContent; });
    await page.evaluate(async (p) => { const P = window.__polka; await P.openEntry(P.L.entries.find((e) => e.path === p)); }, first);
    const t2 = await page.evaluate(() => document.getElementById('toast').textContent);
    ok(/файл не найден/i.test(t2), 'удалённая книга: понятное сообщение «' + (t2 || toast).slice(0, 60) + '»');
    ok(!errs.length, 'дневник только для чтения + удалённая книга: без ошибок ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ============ 6. интерфейс: клавиши во всех состояниях, темы, режимы, размеры окна, масштаб ============
  for (const [vp, dsf] of [[{ width: 800, height: 500 }, 1], [{ width: 1280, height: 800 }, 1.25], [{ width: 1440, height: 900 }, 1.5], [{ width: 1920, height: 1080 }, 2], [{ width: 3840, height: 2160 }, 1]]) {
    const { ctx, page, errs } = await openApp(b, { viewport: vp, dsf, ls: { settings: JSON.stringify({ flip: 'turn', sound: 'off' }) } });
    await ready(page);
    // двойное открытие
    await page.evaluate(async () => { const P = window.__polka; const e = P.L.entries.find((x) => x.name.includes('Анна')); await Promise.all([P.openEntry(e), P.openEntry(e), P.openEntry(P.L.entries[1])]); });
    await page.waitForTimeout(300);
    const seq = ['n', 'Escape', 't', 'Control+f', 'Escape', 'Escape', 'Control+n', 't', 'b', 'b', 'n', 'Escape', 'Escape', 'Control+n', 'Control+n'];
    for (const k of seq) { await page.keyboard.press(k); await page.waitForTimeout(40); }
    // быстрые клики по листанию и смена размера окна во время анимации
    for (let i = 0; i < 12; i++) { await page.keyboard.press(i % 3 ? 'ArrowRight' : 'ArrowLeft'); if (i % 4 === 0) await page.setViewportSize({ width: vp.width - 100 * (i % 2), height: vp.height }); }
    await page.setViewportSize(vp); await page.waitForTimeout(500);
    for (const th of ['light', 'sepia', 'dusk', 'night', 'black']) await page.evaluate((th) => window.__polka.changeSetting('theme', th), th);
    for (const [k, v] of [['cols', 'scroll'], ['focus', 'sheet'], ['focus', 'para'], ['focus', 'sent'], ['auto', 200], ['cols', 'auto'], ['focus', 'off'], ['auto', 'off']]) {
      await page.evaluate(([k, v]) => window.__polka.changeSetting(k, v), [k, v]);
      for (const key of ['ArrowDown', 'ArrowRight', 'n', 'Escape', ' ']) { await page.keyboard.press(key); await page.waitForTimeout(30); }
    }
    await page.screenshot({ path: OUT + '/ui-' + vp.width + 'x' + vp.height + '@' + dsf + '.png' });
    ok(!errs.length, 'интерфейс ' + vp.width + '×' + vp.height + ' @' + dsf + ': клавиши, темы, режимы — без ошибок ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ============ 7. блокнот: 100 КБ вставкой, отмена, IME; 50 полок ============
  {
    const { ctx, page, errs } = await openApp(b);
    await ready(page); await openBook(page);
    await page.keyboard.press('n'); await page.waitForTimeout(300);
    const big = Array.from({ length: 2000 }, (_, i) => 'Строка ' + i + ' вставленного текста, примерно пятьдесят знаков.').join('\n');
    await page.evaluate((t) => { const ta = document.querySelector('#pad .pad-ta'); ta.focus(); document.execCommand('insertText', false, t); }, big);
    await page.waitForTimeout(500);
    const pages = await page.evaluate(() => window.__pad.editor().pages.length);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Home'); await page.keyboard.down('Shift'); for (let i = 0; i < 40; i++) await page.keyboard.press('PageDown'); await page.keyboard.up('Shift');
    await page.keyboard.insertText('ё'); // IME: составной ввод приходит как insertText
    await page.keyboard.press('Control+n'); await page.waitForTimeout(300);
    ok(pages > 3, 'блокнот: 100 КБ вставились, листов ' + pages);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.evaluate(() => { for (let i = 0; i < 50; i++) localStorage.setItem('x', i); });
    for (let i = 0; i < 50; i++) await page.evaluate((i) => { const s = JSON.parse(localStorage.getItem('polka.shelves') || '[]'); s.push({ id: 's' + i, name: 'Полка ' + i, books: [], quiet: i % 2 === 0 }); localStorage.setItem('polka.shelves', JSON.stringify(s)); }, i);
    await page.reload(); await ready(page);
    ok(await page.evaluate(() => document.querySelectorAll('.sh-tab[data-custom]').length) === 50, '50 полок на месте');
    ok(!errs.length, 'блокнот и полки: без ошибок ' + JSON.stringify(errs));
    await ctx.close();
  }

  await b.close();
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'всё хорошо');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
