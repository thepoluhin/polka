// новое «Аа» (две вкладки, шрифт списком, звук в строке листания) и автопрокрутка
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = process.argv[2], BOOK = process.argv[3];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + require('path').resolve(__dirname, '../dist/app/index.html'));
  const d = fs.readFileSync(BOOK).toString('base64');
  await page.evaluate(async (d) => { const P = window.__polka; P.changeSetting('theme', 'light'); P.changeSetting('focus', 'off'); P.changeSetting('cols', 'auto'); const bin = atob(d); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await P.openEntry({ name: 'v.fb2', size: u.length, bytes: u, id: 'v' }); await P.goTo(1, { page: 0 }); }, d);
  await page.waitForTimeout(500);
  const shot = async (n) => { const r = await page.evaluate(() => { const e = document.getElementById('settings'); const b = e.getBoundingClientRect(); return { x: b.left - 16, y: 0, width: b.width + 32, height: Math.min(900, Math.max(b.bottom, ...[...e.querySelectorAll('.font-menu:not([hidden])')].map((m) => m.getBoundingClientRect().bottom)) + 16) }; }); await page.screenshot({ path: OUT + '/' + n + '.png', clip: r }); };
  await page.mouse.move(700, 20); await page.click('#btn-settings'); await page.waitForTimeout(300);
  ok(await page.isVisible('[data-pane="text"]') && !(await page.isVisible('[data-pane="read"]')), 'открыта вкладка «Текст»');
  await shot('aa-text');
  await page.click('#font-btn'); await page.waitForTimeout(250);
  ok(await page.isVisible('#font-list'), 'список шрифтов раскрылся');
  await shot('aa-font-open');
  await page.click('#font-list [data-font="PT Serif"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__polka.S.font) === 'PT Serif' && !(await page.isVisible('#font-list')) && (await page.textContent('#font-cur')) === 'PT Serif', 'выбор шрифта из списка');
  await page.click('#set-tabs [data-tab="read"]'); await page.waitForTimeout(250);
  ok(await page.isVisible('[data-pane="read"]') && !(await page.isVisible('[data-pane="text"]')), 'вкладка «Чтение»');
  await page.click('#snd-chip'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__polka.S.sound) === 'loud' && (await page.textContent('#snd-txt')) === 'звук громче', 'кнопка звука: тихо → громче');
  await page.click('#snd-chip'); await page.click('#snd-chip');
  await shot('aa-read');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(!(await page.evaluate(() => document.getElementById('reader').classList.contains('ui'))), 'Esc закрывает «Аа» и прячет верхнюю панель');
  await page.mouse.move(700, 20); await page.waitForTimeout(200);
  await page.click('#btn-settings'); await page.waitForTimeout(200);
  ok(await page.isVisible('[data-pane="read"]'), 'меню помнит вкладку');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.evaluate(() => window.__polka.changeSetting('font', 'Literata'));
  // автопрокрутка по страницам (для теста — очень быстрая)
  await page.evaluate(() => { window.__polka.goTo(1, { page: 0 }); window.__polka.changeSetting('auto', 8000); });
  const p0 = await page.evaluate(() => window.__polka.R.page);
  await page.waitForTimeout(3300);
  ok(await page.evaluate(() => window.__polka.R.page) > p0, 'страницы листаются сами');
  // пауза пробелом
  await page.keyboard.press(' '); const p1 = await page.evaluate(() => window.__polka.R.page);
  await page.waitForTimeout(3300);
  ok(await page.evaluate(() => window.__polka.R.page) === p1, 'пробел — пауза');
  await page.keyboard.press(' ');
  // предложение
  await page.evaluate(() => { const P = window.__polka; P.changeSetting('focus', 'sent'); P.changeSetting('auto', 3000); });
  await page.waitForTimeout(400);
  const s0 = await page.evaluate(() => [...CSS.highlights.get('fxdim')][0].toString());
  await page.waitForTimeout(2200);
  ok(await page.evaluate(() => [...CSS.highlights.get('fxdim')][0].toString()) !== s0, 'в «Предложении» фокус идёт сам');
  // лента
  await page.evaluate(() => { const P = window.__polka; P.changeSetting('focus', 'off'); P.changeSetting('cols', 'scroll'); P.changeSetting('auto', 300); });
  await page.waitForTimeout(800);
  const y0 = await page.evaluate(() => document.getElementById('viewport').scrollTop);
  await page.waitForTimeout(3000);
  const y1 = await page.evaluate(() => document.getElementById('viewport').scrollTop);
  console.log('лента: за 3 с прокрутилось на', y1 - y0, 'точек');
  ok(y1 - y0 > 15 && y1 - y0 < 200, 'лента ползёт плавно и неспешно');
  await page.mouse.move(600, 400); await page.mouse.move(650, 420);
  const y2 = await page.evaluate(() => document.getElementById('viewport').scrollTop); await page.waitForTimeout(800);
  ok(await page.evaluate(() => document.getElementById('viewport').scrollTop) - y2 < 3, 'движение мыши — пауза');
  await page.evaluate(() => { const P = window.__polka; P.changeSetting('auto', 'off'); P.changeSetting('cols', 'auto'); });
  // пробел без автопрокрутки ничего не делает
  await page.waitForTimeout(600); const p2 = await page.evaluate(() => window.__polka.R.page);
  await page.keyboard.press(' '); await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__polka.R.page) === p2, 'пробел без автопрокрутки не листает');
  // справка
  await page.keyboard.press('F1'); await page.waitForTimeout(400);
  ok(await page.isVisible('#help'), 'F1 открывает справку');
  await page.screenshot({ path: OUT + '/help.png' });
  await page.click('#help-nav [data-h="h-keys"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/help-keys.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(!(await page.isVisible('#help')) && !(await page.isHidden('#reader')), 'Esc закрывает справку, книга остаётся');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#btn-lib-settings'); await page.click('#btn-help'); await page.waitForTimeout(300);
  ok(await page.isVisible('#help'), 'справка из шестерёнки на главной');
  await page.keyboard.press('Escape');
  ok(!errs.length, 'ошибок нет ' + errs.join(' | '));
  await b.close();
})();
