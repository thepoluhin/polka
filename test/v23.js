// 1.12: встроенная книга-путеводитель. node test/v23.js <папка для снимков> <папка с книгами fb2>
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
  await page.exposeFunction('__guide', () => fs.readFileSync(path.resolve(__dirname, '../dist/app/guide.fb2')).toString('base64'));
  await page.addInitScript((dir) => {
    const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    window.shelf = { pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: async () => null,
      read: async (p) => bytes(await window.__read(p)), guideRead: async () => bytes(await window.__guide()), guideStat: async () => ({ size: (await window.__guide()).length }),
      initialFile: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {} };
  }, BOOKS);
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', sound: 'off', flip: 'off' })); });
  await page.reload();
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const has = () => page.isVisible('#grid [data-id="polka-guide"]');
  ok(await page.isVisible('#empty') && !(await has()), 'до выбора папки путеводителя не видно');
  await page.click('#btn-folder-empty');
  const N = scan(BOOKS).length;
  await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length === n + 1 && window.__polka.L.entries.every((e) => window.__polka.L.metas[e.id]), N);
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.querySelector('#grid .book-card').dataset.id) === 'polka-guide', 'после выбора папки путеводитель стоит первым в «Отложенных»');
  ok(await page.evaluate(() => !!document.querySelector('.book-card[data-id="polka-guide"] img')), 'у него своя обложка');
  await shot('1-na-polke');
  await page.click('#grid [data-id="polka-guide"]');
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => ({ t: window.__polka.R.book.title, ch: window.__polka.R.book.chapters.length, toc: window.__polka.R.book.toc.map((x) => x.title) }));
  ok(info.t === 'Как здесь всё устроено' && info.toc.includes('Полки') && info.toc.includes('Клавиши'), 'книга открылась: ' + info.t + ', глав в оглавлении ' + info.toc.length);
  await page.mouse.move(720, 470); await page.waitForTimeout(3000); await shot('2-titul');
  const go = async (title, pg) => { await page.evaluate(async ([title, pg]) => { const P = window.__polka; const t = P.R.book.toc.find((x) => x.title === title); await P.goTo(t.ch, { page: pg }); }, [title, pg]); await page.mouse.move(720, 470); await page.waitForTimeout(3200); };
  await go('Здравствуйте', 0); await shot('3-zdravstvuyte');
  await go('Полки', 0); await shot('4-polki');
  ok(await page.evaluate(() => [...document.querySelectorAll('#flow img')].every((i) => i.complete && i.naturalWidth > 1000)), 'снимки экрана в главе загрузились');
  await go('Цитаты и заметки', 0); await shot('5-citaty');
  await go('Читательский дневник', 0); await shot('7-karta');
  await page.evaluate(() => window.__polka.changeSetting('focus', 'sheet')); await go('Как листать', 0); await shot('6-list');
  await page.evaluate(() => window.__polka.changeSetting('focus', 'off'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // убрать с полки и вернуть
  if (!(await has())) await page.click('.sh-tab[data-shelf="reading"]');
  await page.click('#grid [data-id="polka-guide"]', { button: 'right' });
  await page.click('#ctx-menu [data-act="hideguide"]');
  await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length === n, N);
  ok(!(await has()), '«Убрать с полки» убирает путеводитель');
  await page.reload(); await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length === n, N);
  ok(!(await has()), 'после перезапуска его по-прежнему нет');
  await page.click('#btn-lib-settings'); await page.click('label:has(#set-guide)');
  await page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length === n + 1, N);
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => window.__polka.L.entries.some((e) => e.id === 'polka-guide')), 'переключатель в шестерёнке возвращает его');
  ok(!errs.length, 'ошибок в консоли нет ' + errs.join(' | '));
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exit(fails ? 1 : 0);
})();
