// 1.9: «Вспомнить», записная книжка, типографика, фокус, иллюстрации, страницы до конца книги
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2]; const BOOKS = process.argv[3];
const QDIR = path.join(BOOKS, 'Читательский дневник'); fs.rmSync(QDIR, { recursive: true, force: true });
function scan(d) { let o = []; for (const it of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, it.name); if (it.isDirectory()) o = o.concat(scan(p)); else if (/\.(fb2|epub|fb2\.zip)$/i.test(it.name)) { const s = fs.statSync(p); o.push({ path: p, name: it.name, size: s.size, mtime: s.mtimeMs }); } } return o; }
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.addInitScript((dir) => {
    window.shelf = {
      pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => { const b = atob(await window.__read(p)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
      initialFile: async () => null, initialUrl: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {},
      diaryDir: async () => ({ dir: null }), noteRead: async () => null,
    };
  }, BOOKS);
  const clickBook = async (pfx, opt) => { for (const t of ['reading', 'later', 'done']) { if (await page.isVisible('#grid [data-book-name^="' + pfx + '"]')) break; if (await page.isVisible('.sh-tab[data-shelf="' + t + '"]')) await page.click('.sh-tab[data-shelf="' + t + '"]'); } await page.click('#grid [data-book-name^="' + pfx + '"]', opt); };
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 2);
  // записи в трёх книгах, созданные «давно»
  await page.evaluate(() => {
    const E = window.__polka.L.entries, id = (s) => E.find((e) => e.name.startsWith(s)).id, day = 86400000, now = Date.now();
    const q = {
      [id('Элбом')]: [
        { id: 'q1', ch: 1, off: 40, len: 60, text: 'Как только ты захочешь узнать, как умирать, ты узнаешь, как жить.', chapter: 'Студент', pct: 0.41, tags: ['смерть', 'важно'], t: now - 3 * day },
        { id: 'q2', ch: 1, off: 300, len: 40, text: 'Все знают, что умрут, но никто в это не верит.', note: 'Здесь главное — «не верит», а не «умрут».', chapter: 'Студент', pct: 0.38, tags: ['смерть', 'время'], t: now - 4 * day },
      ],
      [id('Ветров')]: [
        { id: 'q3', ch: 0, off: 200, len: 80, text: 'Книга — это разговор с тем, кого уже нет рядом', chapter: 'Глава 1', pct: 0.05, tags: ['книги'], t: now - 6 * day },
        { id: 'q4', ch: 1, off: 900, len: 50, text: 'Он умел молчать так, что от этого становилось тепло.', chapter: 'Глава 2', pct: 0.4, tags: ['отец', 'важно'], t: now - 9 * day },
      ],
      [id('Северова')]: [{ id: 'q5', ch: 2, off: 100, len: 30, text: 'Утро тихо поднималось над рекой, и туман медленно сползал с берегов.', chapter: 'Глава 2', pct: 0.22, tags: ['время'], t: now - 12 * day }],
    };
    const n = { [id('Элбом')]: [{ id: 'n1', ch: 1, off: 700, len: 30, text: 'смерть заканчивает жизнь, но не отношения', body: 'Перекликается с [[Смерть Ивана Ильича]]: Толстой о том же, только с другой стороны.', chapter: 'Студент', pct: 0.62, tags: ['смерть'], t: now - 2 * day }] };
    localStorage.setItem('polka.quotes', JSON.stringify(q)); localStorage.setItem('polka.notes', JSON.stringify(n));
    localStorage.setItem('polka.bookNotes', JSON.stringify({ [id('Ветров')]: { body: 'Тихая книга об отце. Перечитать осенью.', t: now - day } }));
    localStorage.removeItem('polka.remember');
  });
  await page.reload();
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 2);
  await page.waitForTimeout(500);
  ok(await page.isVisible('#remember'), '«Вспомнить» показан');
  const rq1 = await page.textContent('#remember .rm-quote, #remember .rm-thought');
  await page.screenshot({ path: OUT + '/1-library.png' });
  await page.reload(); await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 2); await page.waitForTimeout(300);
  ok(await page.textContent('#remember .rm-quote, #remember .rm-thought') === rq1, 'в течение дня та же цитата');
  await page.click('[data-rm="more"]'); await page.waitForTimeout(200);
  ok(await page.textContent('#remember .rm-quote, #remember .rm-thought') !== rq1, '«Ещё одну» меняет цитату');
  await page.click('[data-rm="off"]'); await page.waitForTimeout(200);
  ok(!(await page.isVisible('#remember')), '«Больше не показывать» скрывает');
  await page.click('.toast-act'); await page.waitForTimeout(200);
  ok(await page.isVisible('#remember'), '«Вернуть» возвращает');

  // записная книжка
  await page.click('#lib-tabs [data-view="notebook"]'); await page.waitForTimeout(300);
  ok(await page.$$eval('.nb-card[data-nbi]', (a) => a.length) === 6, 'в книжке 6 записей');
  ok(!(await page.isVisible('#shelves')), 'полка скрыта');
  await page.screenshot({ path: OUT + '/2-notebook.png' });
  await page.click('[data-nb-tag="смерть"]'); await page.waitForTimeout(200);
  ok(await page.$$eval('.nb-card[data-nbi]', (a) => a.length) === 3, 'фильтр по тегу #смерть: 3');
  await page.screenshot({ path: OUT + '/2b-notebook-tag.png' });
  await page.click('[data-nb-reset]');
  await page.fill('#search', 'молчать'); await page.waitForTimeout(300);
  ok(await page.$$eval('.nb-card[data-nbi]', (a) => a.length) === 1, 'поиск по записям');
  await page.fill('#search', ''); await page.waitForTimeout(300);
  await page.click('[data-nb-mode="time"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/2c-notebook-time.png' });
  await page.click('[data-nb-mode="books"]');
  // открыть запись — книга открывается на месте
  await page.click('.nb-card[data-nbi]:has-text("молчать")');
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering && !document.getElementById('reader').hidden);
  ok(await page.evaluate(() => window.__polka.R.ch) === 1, 'запись открыла нужную главу');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(await page.isVisible('#notebook'), 'после книги — снова записная книжка');
  await page.click('#lib-tabs [data-view="books"]'); await page.waitForTimeout(200);
  await page.click('#btn-lib-settings'); await page.waitForTimeout(300);
  ok(await page.isVisible('#lib-settings'), 'настройки на главной');
  await page.screenshot({ path: OUT + '/7-lib-settings.png' });
  await page.click('#set-tags'); await page.waitForTimeout(300);
  ok(await page.isVisible('#tags-pop'), 'теги открываются с главной');
  await page.screenshot({ path: OUT + '/7b-tags.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(!(await page.isVisible('#tags-pop')) && !(await page.isVisible('#lib-settings')), 'Esc закрывает');

  // типографика
  await clickBook('Ветров');
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering);
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => {
    const f = document.getElementById('flow');
    return { nbsp: (f.textContent.match(/ /g) || []).length, hq: f.querySelectorAll('.hq').length, hang: f.querySelectorAll('.hq.hang').length, pretty: getComputedStyle(f.querySelector('p')).textWrap };
  });
  console.log('типографика:', JSON.stringify(t));
  ok(t.nbsp > 50 && t.hq > 5, 'неразрывные пробелы и кавычки на месте');
  // смещения не изменились: текст главы в DOM той же длины, что без типографики
  const lenOn = await page.evaluate(() => window.__polka.R.domLen);
  await page.evaluate(() => window.__polka.changeSetting('typo', false)); await page.waitForTimeout(500);
  const lenOff = await page.evaluate(() => window.__polka.R.domLen);
  ok(lenOn === lenOff, 'длина текста одна и та же (' + lenOn + ' = ' + lenOff + ')');
  await page.evaluate(() => window.__polka.changeSetting('typo', true)); await page.waitForTimeout(500);
  const status = await page.textContent('#r-right');
  console.log('статус:', status);
  ok(/стр\. до конца книги/.test(status), 'страниц до конца книги');
  // копирование без неразрывных пробелов
  // иллюстрация
  const img = await page.$('#flow img');
  await img.scrollIntoViewIfNeeded().catch(() => {});
  const box = await img.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  ok(await page.isVisible('#zoom'), 'клик по картинке — крупно');
  await page.screenshot({ path: OUT + '/5-zoom.png' });
  await page.mouse.move(700, 440);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.getElementById('zoom').classList.contains('zoomed')), 'колёсико увеличивает');
  await page.screenshot({ path: OUT + '/5b-zoom-in.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(!(await page.isVisible('#zoom')) && !(await page.isHidden('#reader')), 'Esc закрывает картинку, книга остаётся');
  await page.evaluate(() => window.__polka.goTo(0, { page: 1 })); await page.waitForTimeout(500);
  await page.mouse.move(700, 440);
  await page.screenshot({ path: OUT + '/3-typo.png' });

  // фокус: абзац
  await page.evaluate(() => window.__polka.changeSetting('theme', 'sepia'));
  await page.evaluate(() => window.__polka.changeSetting('focus', 'para')); await page.waitForTimeout(500);
  const cur1 = await page.evaluate(() => document.querySelector('.fx-cur') && document.querySelector('.fx-cur').textContent.slice(0, 30));
  console.log('фокус на абзаце (на титуле абзацев нет):', cur1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500);
  const cur2 = await page.evaluate(() => document.querySelector('.fx-cur').textContent.slice(0, 30));
  ok(cur2 !== cur1, '↓ — следующий абзац: ' + cur2);
  await page.screenshot({ path: OUT + '/4a-focus-para.png' });
  // листаем ↓ до следующей страницы
  const p0 = await page.evaluate(() => window.__polka.R.page);
  for (let i = 0; i < 14; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80); }
  await page.waitForTimeout(600);
  const p1 = await page.evaluate(() => window.__polka.R.page);
  ok(p1 > p0, '↓ доходит до конца страницы и листает (' + p0 + '→' + p1 + ')');
  ok(await page.evaluate(() => { const el = document.querySelector('.fx-cur'); const vr = document.getElementById('viewport').getBoundingClientRect(); return [...el.getClientRects()].some((r) => r.left >= vr.left - 2 && r.right <= vr.right + 2); }), 'абзац в фокусе виден на странице');
  // колесо в «Абзаце» — по абзацам
  const w0 = await page.evaluate(() => window.__polka.R.units.indexOf(window.__polka.R.fxEl));
  await page.mouse.move(700, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(300); await page.mouse.wheel(0, 120); await page.waitForTimeout(300);
  const w1 = await page.evaluate(() => window.__polka.R.units.indexOf(window.__polka.R.fxEl));
  ok(w1 === w0 + 2, 'колесо: два абзаца вперёд (' + w0 + '→' + w1 + ')');
  await page.mouse.wheel(0, -120); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__polka.R.units.indexOf(window.__polka.R.fxEl)) === w1 - 1, 'колесо назад — абзац назад');
  // фокус: лист
  await page.evaluate(() => window.__polka.changeSetting('focus', 'sheet')); await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.__polka.R.geo.cols) === 1, 'лист — одна колонка');
  await page.screenshot({ path: OUT + '/4b-focus-sheet.png' });
  await page.evaluate(() => window.__polka.changeSetting('theme', 'night')); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/4c-focus-sheet-night.png' });
  // фокус в ленте
  await page.evaluate(() => { window.__polka.changeSetting('theme', 'light'); window.__polka.changeSetting('focus', 'para'); window.__polka.changeSetting('cols', 'scroll'); }); await page.waitForTimeout(800);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(800);
  ok(!!(await page.$('.fx-cur')), 'фокус работает в ленте');
  await page.screenshot({ path: OUT + '/4d-focus-scroll.png' });
  // фокус: предложение
  await page.evaluate(() => { const P = window.__polka; P.changeSetting('cols', 'auto'); P.changeSetting('theme', 'night'); P.changeSetting('focus', 'sent'); P.goTo(1, { page: 0 }); }); await page.waitForTimeout(800);
  const sent = () => page.evaluate(() => { const h = CSS.highlights.get('fxdim'); if (!h) return null; return [...h][0].toString().replace(/\u00ad/g, ''); });
  const s1 = await sent();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
  const s2 = await sent();
  console.log('предложения:', JSON.stringify(s1), '→', JSON.stringify(s2));
  ok(s1 && s2 && s1 !== s2 && s2.length < 200, 'фокус по предложениям, ↓ — следующее');
  await page.mouse.move(700, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(300);
  ok((await sent()) !== s2, 'колесо — следующее предложение');
  await page.screenshot({ path: OUT + '/8-focus-sentence.png' });
  const pg0 = await page.evaluate(() => window.__polka.R.page);
  for (let i = 0; i < 40; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(40); }
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => window.__polka.R.page) > pg0, 'предложения ведут на следующую страницу');
  await page.screenshot({ path: OUT + '/8b-focus-sentence-next.png' });
  await page.evaluate(() => { window.__polka.changeSetting('focus', 'off'); window.__polka.changeSetting('cols', 'auto'); });
  await page.mouse.move(720, 20); await page.waitForTimeout(200); await page.click('#btn-settings'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/6-settings.png' });
  ok(!errs.length, 'ошибок в консоли нет' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
})();
