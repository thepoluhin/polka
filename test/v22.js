// 1.12: полки — «Читаю сейчас», «Отложенные», «Прочитано», свои полки, страницы полки
// node test/v22.js <папка для снимков> <папка с 30+ книгами fb2>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2], BOOKS = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
function scan(d) { return fs.readdirSync(d).filter((n) => /\.fb2$/i.test(n)).map((n) => { const p = path.join(d, n), s = fs.statSync(p); return { path: p, name: n, size: s.size, mtime: s.mtimeMs }; }); }
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.addInitScript((dir) => {
    window.shelf = { pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => { const s = atob(await window.__read(p)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
      initialFile: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {} };
  }, BOOKS);
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', sound: 'off' })); });
  await page.reload();
  await page.click('#btn-folder-empty');
  const N = scan(BOOKS).length;
  await page.waitForFunction((n) => !window.__polka.L.scanning && Object.keys(window.__polka.L.metas).length >= n, N);
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('#sh-tabs .sh-tab')].map((t) => t.querySelector('.st-name').textContent + t.querySelector('small').textContent));
  const cards = () => page.locator('#grid [data-id]').count();

  // новая библиотека: всё в «Отложенных»
  ok((await tabs()).join('|') === 'Отложенные' + N, 'сначала одна полка «Отложенные»: ' + (await tabs()).join('|'));
  ok(!(await page.isVisible('#sh-folio')) || (await cards()) < N, 'страница полки не длиннее экрана');
  const per = await cards();
  ok(per < N && await page.isVisible('#sh-folio'), 'книг на странице ' + per + ' из ' + N + ', внизу номера страниц');
  ok(await page.evaluate(() => { const m = document.getElementById('lib-main'); return m.scrollHeight <= m.clientHeight + 2; }), 'главная не прокручивается');

  // место чтения: три читаю, пять прочитано
  await page.evaluate(() => {
    const E = window.__polka.L.entries, by = (s) => E.find((e) => e.name.includes(s)).id, now = Date.now(), pr = {};
    pr[by('Дама с собачкой')] = { ch: 2, off: 0, pct: 0.54, t: now - 3600e3 };
    pr[by('Анна Каренина')] = { ch: 3, off: 0, pct: 0.12, t: now - 2 * 864e5 };
    pr[by('Ася')] = { ch: 4, off: 0, pct: 0.31, t: now - 5 * 864e5 };
    for (const s of ['Смерть Ивана Ильича', 'Капитанская дочка', 'Обломов', 'Гроза', 'Левша']) pr[by(s)] = { ch: 1, off: 0, pct: 1, t: now - 20 * 864e5, done: now - 20 * 864e5 };
    localStorage.setItem('polka.progress', JSON.stringify(pr));
  });
  await page.reload();
  await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length >= n, N);
  await page.waitForTimeout(500);
  ok((await tabs()).join('|') === 'Читаю сейчас3|Отложенные' + (N - 8) + '|Прочитано5', 'три полки: ' + (await tabs()).join('|'));
  ok(await page.evaluate(() => document.querySelector('.sh-tab.on').dataset.shelf) === 'reading', 'при запуске открыта «Читаю сейчас»');
  ok(await cards() === 3 && await page.locator('#grid .progress').count() === 3, 'в ней три книги с полоской прогресса');
  ok(await page.locator('#grid .book-row').count() === 3, '«Читаю сейчас» по умолчанию — с описанием');
  ok(await page.locator('#sh-tabs .sh-tab.on .spines i').count() === 3, 'у полки в колонке корешки ее книг');
  await shot('1-chitayu');

  await page.click('.sh-tab[data-shelf="later"]');
  ok(await page.locator('#grid .book-card').count() > 0, '«Отложенные» по умолчанию — обложками');
  await shot('2-otlozhennye');
  await page.click('[data-shview="list"]'); await page.waitForTimeout(200);
  ok(await page.locator('#grid .book-row').count() > 0 && await page.evaluate(() => { const m = document.getElementById('lib-main'); return m.scrollHeight <= m.clientHeight + 2; }), 'вид «с описанием»: ' + await cards() + ' книг на странице, без прокрутки');
  await shot('2b-otlozhennye-opisanie');
  await page.click('.sh-tab[data-shelf="reading"]'); await page.click('.sh-tab[data-shelf="later"]');
  ok(await page.locator('#grid .book-row').count() > 0, 'вид запомнился для полки');
  await page.click('[data-shview="grid"]'); await page.waitForTimeout(200);
  // листание страниц полки: номер, стрелка, колесо
  const first = await page.evaluate(() => document.querySelector('#grid [data-id]').dataset.id);
  await page.click('#sh-folio [data-shpage="1"]');
  ok(await page.evaluate(() => document.querySelector('#sh-folio b').textContent) === '— 2 —' && await page.evaluate(() => document.querySelector('#grid [data-id]').dataset.id) !== first, 'клик по номеру открывает вторую страницу');
  await shot('3-stranica-2');
  await page.keyboard.press('ArrowLeft');
  ok(await page.evaluate(() => document.querySelector('#sh-folio b').textContent) === '— 1 —', 'стрелка ← возвращает на первую');
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 120); await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.querySelector('#sh-folio b').textContent) === '— 2 —', 'колесо мыши листает страницы полки');
  await page.keyboard.press('ArrowLeft');

  // меню книги: новая полка
  await page.click('#grid [data-id] >> nth=1', { button: 'right' });
  ok(await page.isVisible('#ctx-menu'), 'правый клик открывает меню книги');
  await page.fill('#cx-new', 'На отпуск'); await page.keyboard.press('Enter');
  ok((await tabs()).includes('На отпуск1'), 'новая полка появилась: ' + (await tabs()).join('|'));
  // ещё три книги на ту же полку
  for (const i of [3, 5, 6]) { await page.click('#grid [data-id] >> nth=' + i, { button: 'right' }); await page.click('#ctx-menu .cx-check'); }
  ok((await tabs()).includes('На отпуск4'), 'на полке четыре книги');
  ok((await tabs()).includes('Отложенные' + (N - 8 - 4)), 'разложенные книги ушли из «Отложенных»: ' + (await tabs()).join('|'));
  const shelved = await page.evaluate(() => JSON.parse(localStorage.getItem('polka.shelves'))[0].books);
  ok(!(await page.evaluate((ids) => ids.some((id) => document.querySelector('#grid [data-id="' + CSS.escape(id) + '"]')), shelved)), 'их нет на странице «Отложенных»');
  await page.click('#grid [data-id] >> nth=2', { button: 'right' }); await page.waitForTimeout(200);
  await shot('4-menu-knigi');
  // «Прочитано» из меню
  const id2 = await page.evaluate(() => document.querySelectorAll('#grid [data-id]')[2].dataset.id);
  await page.click('#ctx-menu [data-act="done"]');
  ok((await tabs()).includes('Прочитано6') && !(await page.isVisible('.book-card[data-id="' + id2.replace(/"/g, '\\"') + '"]')), 'книга ушла в «Прочитано»');
  // «Отложить» из «Читаю сейчас»
  await page.click('.sh-tab[data-shelf="reading"]');
  await page.click('#grid [data-id] >> nth=2', { button: 'right' }); await page.click('#ctx-menu [data-act="later"]');
  ok((await tabs())[0] === 'Читаю сейчас2', 'отложенная книга ушла из «Читаю сейчас»');
  ok(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('polka.progress'))).filter((p) => p.later && p.pct > 0.3).length) === 1, 'место чтения отложенной книги сохранилось');

  // своя полка: открыть, новая полка из строки, переименовать, убрать
  await page.click('.sh-tab[data-custom] >> nth=0'); await page.waitForTimeout(200);
  ok(await cards() === 4, 'на своей полке четыре книги');
  await shot('5-svoya-polka');
  await page.click('#sh-new'); await page.fill('#sh-input', 'Перечитать'); await page.keyboard.press('Enter');
  ok((await tabs()).includes('Перечитать0') && await page.evaluate(() => document.querySelector('.sh-tab.on').textContent) === 'Перечитать0', 'полка из строки создана и открыта');
  ok(/пусто/.test(await page.textContent('#nothing-found')), 'на пустой полке подсказка');
  await shot('6-pustaya-polka');
  await page.click('.sh-tab.on', { button: 'right' }); await page.click('#ctx-menu [data-act="rename"]');
  await page.fill('#sh-input', 'Перечитать зимой'); await page.keyboard.press('Enter');
  ok((await tabs()).includes('Перечитать зимой0'), 'полка переименована');
  await page.click('.sh-tab.on', { button: 'right' }); await page.click('#ctx-menu [data-act="remove"]');
  ok(!(await tabs()).some((t) => /Перечитать/.test(t)) && (await tabs()).includes('На отпуск4'), 'полка убрана, другая на месте');

  // поиск — по всем полкам
  await page.fill('#search', 'толстой'); await page.waitForTimeout(300);
  ok((await page.textContent('#sh-title')) === 'Найдено' + await cards() && await cards() >= 4 && !(await page.isVisible('.sh-tab.on')), 'поиск по всем полкам: ' + (await page.textContent('#sh-title')));
  await shot('7-poisk');
  await page.fill('#search', ''); await page.waitForTimeout(300);

  // открыть отложенную книгу и полистать — встанет в «Читаю сейчас»
  await page.click('.sh-tab[data-shelf="later"]');
  await page.click('#grid [data-id] >> nth=0');
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  ok((await tabs())[0] === 'Читаю сейчас3', 'открытая книга встала в «Читаю сейчас»: ' + (await tabs())[0]);

  // полки переживают перезапуск; ночная тема
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('polka.settings')); s.theme = 'night'; localStorage.setItem('polka.settings', JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length >= n, N);
  await page.waitForTimeout(500);
  ok((await tabs()).includes('На отпуск4'), 'после перезапуска полка на месте');
  await page.click('.sh-tab[data-shelf="later"]'); await shot('8-noch');
  // узкое окно: меньше книг на странице, больше страниц
  await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(400);
  ok(await cards() < per && await page.evaluate(() => { const m = document.getElementById('lib-main'); return m.scrollHeight <= m.clientHeight + 2; }), 'в маленьком окне на странице ' + (await cards()) + ' книг, прокрутки нет');
  await shot('9-maloe-okno');

  ok(!errs.length, 'ошибок в консоли нет ' + errs.join(' | '));
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exit(fails ? 1 : 0);
})();
