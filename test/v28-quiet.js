// 1.14.1: стрелки между листами блокнота, Ctrl+N, «тихие» полки (не в «Читаю сейчас»).
// node test/v28-quiet.js <папка для снимков> <папка с книгами fb2>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2], BOOKS = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const scan = (d) => fs.readdirSync(d).filter((n) => /\.fb2$/i.test(n)).map((n) => { const p = path.join(d, n), s = fs.statSync(p); return { path: p, name: n, size: s.size, mtime: s.mtimeMs }; });
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.addInitScript((dir) => {
    const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    window.shelf = { pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: async () => null, read: async (p) => bytes(await window.__read(p)),
      initialFile: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {} };
  }, BOOKS);
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'sepia', sound: 'off', flip: 'off', cols: 'auto' })); });
  await page.reload(); await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8);
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const padOpen = () => page.evaluate(() => !document.getElementById('pad').hidden);
  const ids = await page.evaluate(() => Object.fromEntries(window.__polka.L.entries.map((e) => [e.name.split(' - ')[1].replace('.fb2', ''), e.id])));
  // --- блокнот: три листа текста
  await page.evaluate(async () => { const P = window.__polka; await P.openEntry(P.L.entries.find((e) => e.name.includes('Анна'))); await P.goTo(2, { page: 0 }); });
  await page.waitForTimeout(500);
  await page.keyboard.press('n'); await page.waitForTimeout(400);
  ok(await padOpen(), 'N открывает блокнот');
  const lines = Array.from({ length: 50 }, (_, i) => 'Строка ' + (i + 1) + ' про героев').join('\n');
  await page.evaluate((t) => { const ta = document.querySelector('#pad .pad-ta'); ta.value = t; ta.setSelectionRange(t.length, t.length); ta.dispatchEvent(new Event('input')); }, lines);
  await page.waitForTimeout(200);
  const E = () => page.evaluate(() => { const e = window.__pad.editor(); const ta = e.ta; return { cur: e.cur, n: e.pages.length, pos: ta.selectionStart, len: ta.value.length, first: ta.value.split('\n')[0] }; });
  let s = await E();
  ok(s.n >= 2, 'текст разложился на листы: ' + s.n);
  await page.keyboard.press('n'); await page.waitForTimeout(150);
  ok(await padOpen() && (await page.evaluate(() => document.querySelector('#pad .pad-ta').value.endsWith('n'))), 'во время записи N — обычная буква');
  await page.keyboard.press('Backspace');
  // в начало первого листа
  await page.evaluate(() => window.__pad.editor().ta && null);
  await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp');
  await page.keyboard.press('Control+Home');
  s = await E(); ok(s.cur === 0 && s.pos === 0, 'стоим в начале первого листа');
  // вниз стрелкой до следующего листа
  let moved = false;
  for (let i = 0; i < 60 && !moved; i++) { await page.keyboard.press('ArrowDown'); s = await E(); if (s.cur === 1) moved = true; }
  ok(moved && s.pos === 0, 'стрелка вниз с последней строки переходит на следующий лист, в начало');
  await page.keyboard.press('ArrowUp'); s = await E();
  ok(s.cur === 0 && s.pos === s.len, 'стрелка вверх с первой строки — обратно, в конец предыдущего листа');
  await page.keyboard.press('ArrowRight'); s = await E();
  ok(s.cur === 1 && s.pos === 0, 'стрелка вправо в конце листа — на следующий');
  await page.keyboard.press('ArrowLeft'); s = await E();
  ok(s.cur === 0 && s.pos === s.len, 'стрелка влево в начале листа — на предыдущий');
  await page.keyboard.press('ArrowLeft'); s = await E();
  ok(s.cur === 0 && s.pos === s.len - 1, 'внутри листа стрелки работают как обычно');
  await page.keyboard.press('Control+KeyN'); await page.waitForTimeout(400);
  ok(!(await padOpen()), 'Ctrl+N закрывает блокнот во время записи');
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem('polka.pads'))[id].pages.join('\n'), ids['Анна Каренина']);
  ok(saved.includes('Строка 50 про героев'), 'текст сохранён при закрытии');
  await page.keyboard.press('Control+KeyN'); await page.waitForTimeout(400);
  ok(await padOpen(), 'Ctrl+N открывает блокнот при чтении');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // --- «тихая» полка
  await page.evaluate((ids) => {
    const now = Date.now(), pr = JSON.parse(localStorage.getItem('polka.progress') || '{}');
    for (const [t, pct] of [['Пиковая дама', .3], ['Ася', .6], ['Первая любовь', 1], ['Дама с собачкой', .5]]) pr[ids[t]] = { ch: 1, off: 0, pct, t: now, done: pct >= 1 ? now : undefined };
    localStorage.setItem('polka.progress', JSON.stringify(pr));
    localStorage.setItem('polka.shelves', JSON.stringify([{ id: 'sp', name: 'Стихи', books: [ids['Пиковая дама'], ids['Ася'], ids['Первая любовь']] }]));
  }, ids);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.reload(); await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8); await page.waitForTimeout(600);
  const cnt = (id) => page.evaluate((id) => { const t = document.querySelector('.sh-tab[data-shelf="' + id + '"]'); return t ? +(t.textContent.match(/(\d+)\s*$/) || t.textContent.match(/(\d+)/) || [0, 0])[1] : -1; }, id);
  const titles = () => page.evaluate(() => [...document.querySelectorAll('.sh-main [data-id], .sh-main .book')].map((x) => x.textContent).join('|'));
  const r0 = await cnt('reading'), d0 = await cnt('done');
  ok(r0 >= 3, 'без галочки книги со «Стихов» в «Читаю сейчас»: ' + r0);
  const pos = await page.evaluate(() => { const t = document.querySelector('.sh-tab[data-shelf="sp"]'); const b = t.getBoundingClientRect(); return { x: b.left + 30, y: b.top + 15 }; });
  await page.mouse.click(pos.x, pos.y, { button: 'right' }); await page.waitForTimeout(200);
  ok(/Не показывать в «Читаю сейчас»/.test(await page.textContent('#ctx-menu')), 'в меню полки есть «Не показывать в „Читаю сейчас“»');
  const inView = await page.evaluate(() => { const r = document.getElementById('ctx-menu').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0; });
  ok(inView, 'меню не вылезает за окно');
  await shot('1-menu');
  await page.click('#ctx-menu [data-act="quiet"]'); await page.waitForTimeout(300);
  const r1 = await cnt('reading'), d1 = await cnt('done');
  ok(r1 === r0 - 2, '«Читаю сейчас» без стихов: ' + r0 + ' → ' + r1);
  ok(d1 === d0 - 1 || (d0 === 1 && d1 === -1), '«Прочитано» без стихов: ' + d0 + ' → ' + (d1 < 0 ? 'пусто, полка скрыта' : d1));
  ok(await cnt('sp') === 3, 'на самих «Стихах» все три книги');
  ok(JSON.parse(await page.evaluate(() => localStorage.getItem('polka.shelves')))[0].quiet === true, 'галочка сохранена в полке');
  await page.click('.sh-tab[data-shelf="reading"]'); await page.waitForTimeout(300);
  await shot('2-seychas');
  // открыть книгу со «Стихов» и закрыть — вернуться на «Стихи»
  await page.evaluate(async (id) => { const P = window.__polka; await P.openEntry(P.L.entries.find((e) => e.id === id)); }, ids['Ася']);
  await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => { const t = document.querySelector('.sh-tab.active, .sh-tab.on, .sh-tab[aria-current="true"]'); return t && t.dataset.shelf; }) === 'sp', 'после книги со «Стихов» главная открывается на «Стихах»');
  await shot('3-stihi');
  // снять галочку (открытие книги в тесте сдвинуло место в «Асе» к началу — возвращаем)
  await page.evaluate((id) => { const pr = JSON.parse(localStorage.getItem('polka.progress')); pr[id].pct = .6; localStorage.setItem('polka.progress', JSON.stringify(pr)); }, ids['Ася']);
  const pos2 = await page.evaluate(() => { const t = document.querySelector('.sh-tab[data-shelf="sp"]'); const b = t.getBoundingClientRect(); return { x: b.left + 30, y: b.top + 15 }; });
  await page.mouse.click(pos2.x, pos2.y, { button: 'right' }); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('#ctx-menu [data-act="quiet"]').classList.contains('on')), 'галочка видна в меню');
  await page.click('#ctx-menu [data-act="quiet"]'); await page.waitForTimeout(300);
  const r2 = await cnt('reading'); ok(r2 === r0, 'галочку сняли — книги вернулись в «Читаю сейчас»: ' + r2);
  ok(!errs.length, 'ошибок нет ' + errs.join('; '));
  console.log(fails ? 'ЕСТЬ ОШИБКИ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exitCode = fails ? 1 : 0;
})();
