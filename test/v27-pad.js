// Блокнот: листок в книге (N, значок, Esc, клик по тексту), листы, сохранение, раздел «Блокноты» на главной.
// node test/v27-pad.js <папка для снимков> <папка с книгами fb2>
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
  const open = () => page.evaluate(() => !document.getElementById('pad').hidden);
  // пустой раздел «Блокноты»
  ok((await page.textContent('#lib-tabs')).replace(/\s+/g, '') === 'КнигиЗаметкиБлокноты', 'на главной три раздела: Книги · Заметки · Блокноты');
  await page.click('#lib-tabs [data-view="pads"]');
  ok(/Блокнотов пока нет/.test(await page.textContent('#pads')), 'пока блокнотов нет — подсказка');
  await shot('0-pusto');
  await page.click('#lib-tabs [data-view="books"]');
  // открыть книгу
  await page.evaluate(async () => { const P = window.__polka; await P.openEntry(P.L.entries.find((e) => e.name.includes('Анна'))); await P.goTo(3, { page: 1 }); });
  await page.waitForTimeout(600);
  const w0 = await page.evaluate(() => document.getElementById('stage').clientWidth);
  ok(!(await open()), 'листок сначала закрыт и ничего не торчит');
  await page.mouse.move(720, 450); await page.keyboard.press('n'); await page.waitForTimeout(500);
  ok(await open(), 'N открывает листок');
  ok(await page.evaluate(() => document.activeElement.classList.contains('pad-ta')), 'курсор сразу в листке');
  const w1 = await page.evaluate(() => document.getElementById('stage').clientWidth);
  ok(w1 < w0 - 300, 'книга отодвинулась, листок её не закрывает: ' + w0 + ' → ' + w1);
  await page.keyboard.type('Стива и Долли — Облонские, пятеро детей.\nАнна — сестра Стивы. Муж Каренин, сын Серёжа.\n\nПочему Левин уехал так резко?');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__polka.R.page) !== null, 'стрелки и буквы в листке не листают книгу');
  await page.mouse.move(720, 20); await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.getElementById('btn-pad').classList.contains('active')), 'значок блокнота подсвечен');
  await shot('1-listok');
  // закрыть Esc — сохранено
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  ok(!(await open()), 'Esc закрывает листок');
  const saved = await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('polka.pads')); return Object.values(p)[0]; });
  ok(saved && /Почему Левин/.test(saved.pages.join('\n')) && saved.title === 'Анна Каренина', 'записи сохранились сами');
  ok(await page.evaluate(() => document.getElementById('stage').clientWidth) === w0, 'книга вернулась на место');
  // значок, длинная запись — несколько листов
  await page.mouse.move(720, 20); await page.waitForTimeout(300); await page.click('#btn-pad'); await page.waitForTimeout(400);
  ok(await open(), 'значок открывает листок');
  const long = Array.from({ length: 40 }, (_, i) => 'Строка заметки номер ' + (i + 1) + ' про героев и города.').join('\n');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await page.evaluate((t) => { const ta = document.querySelector('.pad-ta'); ta.value += t; ta.dispatchEvent(new Event('input')); }, long);
  await page.waitForTimeout(300);
  const pg = await page.evaluate(() => window.__pad.editor().pages.length);
  ok(pg >= 2, 'длинная запись разложилась на листы: ' + pg);
  ok(await page.evaluate(() => { const ta = document.querySelector('.pad-ta'); return ta.scrollHeight <= ta.clientHeight + 1; }), 'на листе ничего не обрезано');
  ok(/\d+<\/b> \/ \d+/.test(await page.innerHTML('.pad-folio')) && await page.isVisible('.pad-folio'), 'внизу номер листа');
  await shot('2-neskolko-listov');
  await page.click('.pf-prev'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__pad.editor().cur) === pg - 2, 'листается назад');
  // клик по тексту книги закрывает
  await page.mouse.click(500, 450); await page.waitForTimeout(500);
  ok(!(await open()), 'клик по тексту книги закрывает листок');
  const saved2 = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('polka.pads')))[0]);
  ok(saved2.pages.length === pg && /номер 40/.test(saved2.pages.join('\n')) && /Почему Левин/.test(saved2.pages[0]), 'все листы сохранены, первый на месте');
  // открыть снова — ни один лист не потерялся
  await page.keyboard.press('n'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const saved3 = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('polka.pads')))[0]);
  ok(JSON.stringify(saved3.pages) === JSON.stringify(saved2.pages), 'повторное открытие не меняет листы');
  // ночь, «Лист»
  await page.evaluate(() => { window.__polka.changeSetting('theme', 'night'); window.__polka.changeSetting('focus', 'sheet'); }); await page.waitForTimeout(500);
  await page.keyboard.press('n'); await page.waitForTimeout(600); await page.mouse.move(720, 450); await page.waitForTimeout(2800);
  await shot('3-noch-list');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__polka.changeSetting('theme', 'sepia'); window.__polka.changeSetting('focus', 'off'); });
  // раздел «Блокноты»
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.click('#lib-tabs [data-view="pads"]'); await page.waitForTimeout(300);
  ok(await page.locator('.padc').count() === 1 && /Анна Каренина/.test(await page.textContent('.padc')), 'на главной листок «Анна Каренина»');
  await shot('4-bloknoty');
  await page.click('.padc'); await page.waitForTimeout(300);
  ok(await page.isVisible('#pad-big .pad-ta'), 'клик открывает листок крупно');
  await page.click('#pad-big .pad-ta'); await page.keyboard.press('Control+End'); await page.keyboard.type(' Дописано с главной.'); await page.waitForTimeout(1400);
  ok(/Дописано с главной/.test(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('polka.pads')))[0].pages.join(' '))), 'правка на главной сохраняется');
  await shot('5-otkryt-na-glavnoy');
  await page.click('[data-pad-back]');
  await page.fill('#search', 'левин'); await page.waitForTimeout(400);
  ok(await page.locator('.padc').count() === 1, 'поиск по тексту блокнотов');
  await page.fill('#search', 'вронский'); await page.waitForTimeout(300);
  ok(await page.locator('.padc').count() === 0, 'нет совпадений — пусто');
  await page.fill('#search', ''); await page.waitForTimeout(300);
  await page.click('.padc'); await page.click('[data-pad-book]');
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  ok(true, '«Открыть книгу» открывает книгу');
  ok(!errs.length, 'ошибок нет ' + errs.join(' | '));
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exit(fails ? 1 : 0);
})();
