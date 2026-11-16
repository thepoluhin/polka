// 1.13: полки колонкой справа, вид «обложки / с описанием», крупная карточка, «где вы остановились»
// node test/v24.js <папка для снимков> <папка с книгами fb2>
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
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', sound: 'off', flip: 'off' })); });
  await page.reload();
  await page.click('#btn-folder-empty');
  const N = scan(BOOKS).length;
  const ready = () => page.waitForFunction((n) => !window.__polka.L.scanning && window.__polka.L.entries.length === n && window.__polka.L.entries.every((e) => window.__polka.L.metas[e.id] && window.__polka.L.metas[e.id].mv === 2), N);
  await ready();
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const m = await page.evaluate(() => Object.values(window.__polka.L.metas));
  ok(m.every((x) => /^#[0-9a-f]{6}$/.test(x.color)), 'у всех книг есть цвет корешка');
  ok(m.some((x) => x.annot || x.open), 'у книг есть описание или начало текста: ' + m.filter((x) => x.annot).length + ' с аннотацией, ' + m.filter((x) => x.open).length + ' с началом');
  // начнём одну книгу: открыть, перелистать, закрыть
  await page.evaluate(async () => { const P = window.__polka; await P.openEntry(P.L.entries.find((e) => e.name.includes('Дама'))); });
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  const p = await page.evaluate(() => { const pr = JSON.parse(localStorage.getItem('polka.progress')); return Object.values(pr)[0]; });
  ok(p && p.snip && p.snip.length > 60, 'запомнились строки «где вы остановились»: ' + (p && p.snip || '').slice(0, 70));
  ok(await page.isVisible('#grid .hb.big'), 'одна книга в «Читаю сейчас» — крупная карточка');
  ok(/Где вы остановились/.test(await page.textContent('#grid .hb')), 'в карточке «Где вы остановились»');
  await page.mouse.move(700, 880); await page.waitForTimeout(300);
  await shot('1-odna-kniga');
  // вторая книга с цитатой
  await page.evaluate(() => {
    const P = window.__polka, e = P.L.entries.find((x) => x.name.includes('Анна')), pr = JSON.parse(localStorage.getItem('polka.progress'));
    pr[e.id] = { ch: 3, off: 0, pct: 0.38, t: Date.now() - 864e5 * 3, chap: 'Часть первая' };
    localStorage.setItem('polka.progress', JSON.stringify(pr));
    const q = JSON.parse(localStorage.getItem('polka.quotes') || '{}');
    q[e.id] = [{ id: 'q1', ch: 1, off: 0, len: 20, pct: 0.02, text: 'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.', tags: ['семья', 'важно'], t: Date.now() - 864e5 * 3, chapter: 'Часть первая' },
      { id: 'q2', ch: 1, off: 120, len: 30, pct: 0.025, text: 'Все смешалось в доме Облонских.', tags: ['семья'], t: Date.now() - 864e5 * 3, chapter: 'Часть первая' }];
    for (let i = 0; i < 16; i++) q[e.id].push({ id: 'qx' + i, ch: 2, off: i * 50, len: 10, pct: 0.1 + i * 0.055, text: 'Проба стикера номер ' + i, tags: [['время', 'любовь', 'важно', 'смерть'][i % 4]], t: Date.now() - 864e5 });
    const n = JSON.parse(localStorage.getItem('polka.notes') || '{}');
    n[e.id] = [{ id: 'n1', ch: 3, off: 10, len: 20, pct: 0.3, text: 'фрагмент', body: 'Тут Толстой будто извиняется за Стиву.', tags: [], t: Date.now() - 864e5 }];
    localStorage.setItem('polka.notes', JSON.stringify(n));
    localStorage.setItem('polka.quotes', JSON.stringify(q));
  });
  await page.reload(); await ready(); await page.waitForTimeout(400);
  ok(await page.locator('#grid .hb').count() === 2 && !/Последняя цитата/.test(await page.textContent('#grid')), 'две книги — две карточки, цитат в тексте нет');
  const nst = await page.locator('#grid .hb >> nth=1').locator('.stk i').count();
  ok(nst > 0 && nst <= 12, 'у книги с записями стикеры, не больше 12: ' + nst);
  ok(await page.locator('#grid .hb >> nth=0').locator('.stk i').count() === 0, 'у книги без записей стикеров нет');
  await page.hover('#grid .hb >> nth=1 >> .stk i >> nth=0'); await page.waitForTimeout(300);
  ok(await page.isVisible('#stk-tip') && /Все счастливые/.test(await page.textContent('#stk-tip')) && /Облонских/.test(await page.textContent('#stk-tip')), 'наведение — подсказка; две близкие цитаты склеены в один стикер');
  await shot('2c-stiker-podskazka');
  await shot('2-dve-knigi');
  // длинное название рядом с коротким: строки сетки у карточек общие
  await page.evaluate(() => { const P = window.__polka, e = P.L.entries.find((x) => x.name.includes('Дама')); P.L.metas[e.id].title = '45 татуировок менеджера. Правила российского руководителя'; document.querySelector('.sh-tab[data-shelf="reading"]').click(); });
  await page.waitForTimeout(300);
  const al = await page.evaluate(() => { const c = [...document.querySelectorAll('#grid .hb')]; const top = (el, s) => Math.round(el.querySelector(s).getBoundingClientRect().top); return ['.hb-a', '.hb-sec', '.hb-go'].map((s) => top(c[0], s) === top(c[1], s)); });
  ok(al.every(Boolean), 'автор, текст и кнопка у двух карточек на одной высоте: ' + al.join(','));
  await shot('2b-dlinnoe-nazvanie');
  // клик по цитате в подсказке открывает книгу на этом месте
  await page.click('#stk-tip [data-item="q2"]');
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => window.__polka.R.ch) === 1 && /Анна/.test(await page.evaluate(() => window.__polka.R.book.title)), 'клик по стикеру открывает книгу на месте цитаты');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // клик по карточке открывает книгу
  await page.click('#grid .hb >> nth=0 >> .hb-t'); await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  ok(true, 'клик по карточке открывает книгу');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // переключатель вида на «Читаю сейчас»
  await page.click('[data-shview="grid"]'); await page.waitForTimeout(200);
  // «Анна» открыта на самом начале — она могла уйти в «Отложенные»; стикеры ищем там, где она стоит
  let stc = await page.locator('#grid .book-card .stk i').count();
  if (!stc) { await page.click('.sh-tab[data-shelf="later"]'); await page.click('[data-shview="grid"]'); stc = await page.locator('#grid .book-card .stk i').count(); await page.click('.sh-tab[data-shelf="reading"]'); }
  ok(stc > 0, 'в виде «Обложки» стикеры тоже есть: ' + stc);
  await shot('3-chitayu-oblozhki');
  await page.click('[data-shview="list"]');
  // «Отложенные» с описанием
  await page.click('.sh-tab[data-shelf="later"]'); await page.click('[data-shview="list"]'); await page.waitForTimeout(300);
  await shot('4-otlozhennye-opisanie');
  // старые метаданные (до 1.13) дочитываются сами
  await page.evaluate(async () => { const P = window.__polka; for (const m of Object.values(P.L.metas)) { delete m.mv; delete m.annot; delete m.open; delete m.color; } });
  await page.evaluate(() => window.__upgradeMetas());
  await page.waitForFunction(() => Object.values(window.__polka.L.metas).every((m) => m.mv === 2 && m.color));
  ok(true, 'описания и цвета старых книг дочитаны в фоне');
  // своя полка в колонке, контекстное меню полки
  await page.click('#sh-new'); await page.fill('#sh-input', 'На отпуск'); await page.keyboard.press('Enter');
  ok(await page.evaluate(() => document.querySelector('.sh-tab.on .st-name').textContent) === 'На отпуск', 'новая полка в колонке и открыта');
  await page.click('.sh-tab[data-shelf="later"]');
  for (const i of [0, 1, 2]) { await page.click('#grid [data-id] >> nth=' + i, { button: 'right' }); await page.click('#ctx-menu .cx-check'); }
  await page.click('.sh-tab[data-custom]', { button: 'right' });
  ok(await page.isVisible('#ctx-menu [data-act="rename"]'), 'правый клик по своей полке — меню полки');
  await page.keyboard.press('Escape');
  await shot('5-svoya-polka');
  // ночь и узкое окно
  await page.evaluate(() => window.__polka.changeSetting('theme', 'night')); await page.waitForTimeout(300);
  await shot('6-noch');
  await page.setViewportSize({ width: 1000, height: 720 }); await page.waitForTimeout(400);
  ok(!(await page.isVisible('.spines')) && await page.evaluate(() => { const m = document.getElementById('lib-main'); return m.scrollHeight <= m.clientHeight + 2; }), 'узкое окно: полки без корешков, прокрутки нет');
  await shot('7-uzkoe-okno');
  ok(!errs.length, 'ошибок в консоли нет ' + errs.join(' | '));
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exit(fails ? 1 : 0);
})();
