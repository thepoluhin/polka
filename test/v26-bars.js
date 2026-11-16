// Панели сверху и снизу: появляются у края, сами прячутся, не залипают.
// node test/v26-bars.js <папка для снимков> <книга.fb2>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2], BOOK = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.addInitScript((bk) => {
    const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    window.shelf = { pickFolder: async () => '/x', pickFile: async () => null, scan: async () => [{ path: bk, name: 'book.fb2', size: 1, mtime: 1 }], stat: async () => null,
      read: async (p) => bytes(await window.__read(p)), initialFile: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {} };
  }, BOOK);
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'night', sound: 'off', flip: 'off', focus: 'sheet' })); });
  await page.reload(); await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length);
  await page.evaluate(async () => { const P = window.__polka; await P.openEntry(P.L.entries[0]); });
  await page.waitForFunction(() => window.__polka.R.book && !document.getElementById('reader').hidden);
  const shown = () => page.evaluate(() => getComputedStyle(document.querySelector('.r-top')).opacity > 0.5);
  const uiOn = () => page.evaluate(() => document.getElementById('reader').classList.contains('ui'));
  const mid = async () => { await page.mouse.move(720, 450, { steps: 4 }); };
  await mid(); await page.waitForTimeout(3200);
  ok(!(await shown()), 'после открытия книги панели сами спрятались');
  // 1. мышь к верхнему краю, задержалась на панели дольше таймера, ушла в текст
  await page.mouse.move(720, 30, { steps: 4 }); await page.waitForTimeout(300);
  ok(await shown(), 'у верхнего края панель появилась');
  await page.waitForTimeout(3200);
  await mid(); await page.waitForTimeout(3200);
  ok(!(await shown()) && !(await uiOn()), 'ушли с панели в текст — панель спряталась');
  // 2. мышь над верхом листа (в «Листе» он заходит под панель) — без появления класса ui панель не должна торчать поверх колонтитула
  await page.mouse.move(1000, 40, { steps: 3 }); await page.waitForTimeout(400);
  const both = await page.evaluate(() => getComputedStyle(document.querySelector('.r-top')).opacity > 0.5 && getComputedStyle(document.getElementById('sheet-head')).opacity > 0.3);
  ok(!both, 'панель и колонтитул листа не видны одновременно');
  await page.screenshot({ path: OUT + '/1-verh.png' });
  await mid(); await page.waitForTimeout(3200);
  // 3. открыли «Аа» кнопкой и закрыли — панель не залипла (фокус на кнопке)
  await page.mouse.move(720, 30, { steps: 3 }); await page.waitForTimeout(300);
  await page.click('#btn-settings'); await page.waitForTimeout(300);
  await page.mouse.click(720, 600); await page.waitForTimeout(300);
  await mid(); await page.waitForTimeout(3300);
  ok(!(await shown()), 'после «Аа» панель спряталась (не держится фокусом)');
  // 4. оглавление открыли и закрыли Esc
  await page.keyboard.press('t'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await mid(); await page.waitForTimeout(3300);
  ok(!(await shown()), 'после оглавления панель спряталась');
  // 5. показали панель и перевернули страницу стрелкой — читаем дальше, панель уходит сразу
  await page.mouse.move(720, 30, { steps: 3 }); await page.waitForTimeout(300); await mid();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  ok(!(await shown()), 'листнули стрелкой — панель ушла сразу');
  // 6. нижний край
  await page.mouse.move(720, 880, { steps: 3 }); await page.waitForTimeout(300);
  ok(await uiOn(), 'у нижнего края строка состояния появилась');
  await page.mouse.move(720, 890, { steps: 2 }); await page.waitForTimeout(3300);
  ok(await uiOn(), 'пока мышь у края, не прячется');
  await mid(); await page.waitForTimeout(3300);
  ok(!(await uiOn()), 'ушли от края — спряталась');
  // 7. мышь ушла из окна сверху
  await page.mouse.move(720, 20, { steps: 3 }); await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })));
  await page.mouse.move(720, -5).catch(() => {}); await page.waitForTimeout(3300);
  ok(!(await shown()), 'мышь ушла из окна — панель спряталась');
  ok(!errs.length, 'ошибок нет ' + errs.join(' | '));
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'ВСЁ ХОРОШО');
  await b.close(); process.exit(fails ? 1 : 0);
})();
