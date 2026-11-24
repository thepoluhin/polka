// Автотест: подменяем нативный API (как в Electron) и прогоняем сценарии
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('node:url');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'polka-shots');
const BOOKS = path.resolve(__dirname, '../testbooks');
fs.mkdirSync(OUT, { recursive: true });
function scan(d) { let o = []; for (const it of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, it.name); if (it.isDirectory()) o = o.concat(scan(p)); else if (/\.(fb2|epub|fb2\.zip)$/i.test(it.name)) { const s = fs.statSync(p); o.push({ path: p, name: it.name, size: s.size, mtime: s.mtimeMs }); } } return o; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.addInitScript((dir) => {
    window.shelf = {
      pickFolder: async () => dir, pickFile: async () => null,
      scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => { const b = atob(await window.__read(p)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
      initialFile: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {},
    };
  }, BOOKS);
  const clickBook = async (pfx, opt) => { for (const t of ['reading', 'later', 'done']) { if (await page.isVisible('#grid [data-book-name^="' + pfx + '"]')) break; if (await page.isVisible('.sh-tab[data-shelf="' + t + '"]')) await page.click('.sh-tab[data-shelf="' + t + '"]'); } await page.click('#grid [data-book-name^="' + pfx + '"]', opt); };
  await page.goto(pathToFileURL(path.resolve(__dirname, '../dist/app/index.html')).href);
  await page.screenshot({ path: OUT + '/01-empty.png' });
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/02-library.png' });
  console.log('entries', await page.evaluate(() => window.__polka.L.entries.map((e) => e.name + ' => ' + JSON.stringify((({ title, authors, series, broken }) => ({ title, authors, series, broken }))(window.__polka.L.metas[e.id] || {}))).join('\n')));

  // открыть fb2
  await clickBook('Северова');
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering);
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + '/03-fb2-cover.png' });
  const info = await page.evaluate(() => { const R = window.__polka.R; return { chapters: R.book.chapters.map((c) => c.title + ' [' + c.len + ']'), toc: R.book.toc.map((t) => '  '.repeat(t.depth) + t.title + ' -> ch' + t.ch + (t.anchor ? '#' + t.anchor : '')), notes: Object.keys(R.book.notes).length, pages: R.pages, cols: R.geo.cols }; });
  console.log(JSON.stringify(info, null, 1));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); }
  await page.mouse.move(700, 450);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: OUT + '/04-fb2-text.png' });
  // сноска
  const hasNote = await page.evaluate(() => { const a = document.querySelector('#flow a.noteref'); if (!a) return false; return true; });
  console.log('noteref on chapter', hasNote);
  // переход к главе 3 (с картинкой) через оглавление
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/05-toc.png' });
  await page.click('#toc-list .toc-item >> text=Глава 3');
  await page.waitForTimeout(600);
  for (let i = 0; i < 1; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); }
  await page.screenshot({ path: OUT + '/06-image.png' });
  // найти страницу со сноской и кликнуть
  for (let i = 0; i < 15; i++) {
    const box = await page.evaluate(() => { const vr = document.getElementById('viewport').getBoundingClientRect(); for (const a of document.querySelectorAll('#flow a.noteref')) { const r = a.getBoundingClientRect(); if (r.left > vr.left + 10 && r.right < vr.right - 10 && r.left > innerWidth * .2 && r.right < innerWidth * .8) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } return null; });
    if (box) { await page.mouse.click(box.x, box.y); break; }
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/07-note.png' });
  console.log('note visible', await page.evaluate(() => !document.getElementById('note-pop').hidden && document.getElementById('note-body').textContent.slice(0, 80)));
  await page.keyboard.press('Escape');
  // настройки + тема сепия + шрифт
  await page.mouse.move(700, 20); await page.waitForTimeout(300);
  await page.click('#btn-settings');
  await page.click('.theme-dot[data-theme="sepia"]');
  await page.click('#font-btn'); await page.click('.font-opt[data-font="PT Serif"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/08-settings-sepia.png' });
  await page.click('.theme-dot[data-theme="night"]');
  await page.click('#set-tabs [data-tab="read"]'); await page.click('#set-cols button[data-v="1"]');
  await page.click('#font-inc'); await page.click('#font-inc');
  await page.waitForTimeout(600);
  await page.mouse.click(700, 880); // закрыть
  await page.waitForTimeout(3000);
  await page.screenshot({ path: OUT + '/09-night-1col.png' });
  // закладка, поиск
  await page.keyboard.press('KeyB'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+f'); await page.waitForTimeout(200);
  await page.keyboard.type('отец');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/10-search.png' });
  await page.click('#search-results .sr-item:nth-child(5)');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/11-search-hit.png' });
  const pos = await page.evaluate(() => ({ ch: window.__polka.R.ch, page: window.__polka.R.page, pages: window.__polka.R.pages, off: window.__polka.R.off }));
  console.log('pos', pos);
  // ресайз сохраняет позицию
  const before = await page.evaluate(() => document.getElementById('r-right').textContent);
  await page.setViewportSize({ width: 1000, height: 760 }); await page.waitForTimeout(800);
  const after = await page.evaluate(() => document.getElementById('r-right').textContent);
  console.log('resize pct', before, '->', after);
  await page.screenshot({ path: OUT + '/12-resized.png' });
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(500);
  // в библиотеку и epub
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => window.__polka.changeSetting('theme', 'light'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/13-library-continue.png' });
  await clickBook('Morgan');
  await page.waitForFunction(() => window.__polka.R.book && window.__polka.R.book.format === 'epub' && !window.__polka.R.rendering);
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/14-epub-cover.png' });
  console.log(JSON.stringify(await page.evaluate(() => { const R = window.__polka.R; return { chapters: R.book.chapters.map((c) => c.title + ' [' + c.len + ']'), toc: R.book.toc.map((t) => '  '.repeat(t.depth) + t.title + ' -> ch' + t.ch + (t.anchor ? '#' + t.anchor : '')) }; }), null, 1));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/15-epub-text.png' });
  console.log('epub notes', await page.evaluate(() => Array.from(document.querySelectorAll('#flow a.noteref')).map((a) => a.textContent + '->' + a.dataset.ch + '#' + a.dataset.anchor).join(', ')));
  for (let i = 0; i < 8; i++) {
    const nb = await page.evaluate(() => { for (const a of document.querySelectorAll('#flow a.noteref')) { const r = a.getBoundingClientRect(); if (r.left > innerWidth * .2 && r.right < innerWidth * .8) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } return null; });
    if (nb) { await page.mouse.click(nb.x, nb.y); break; }
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/15b-epub-note.png' });
  console.log('epub note', await page.evaluate(() => !document.getElementById('note-pop').hidden && document.getElementById('note-body').textContent.slice(0, 80)));
  // fb2.zip
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await clickBook('Ильин');
  await page.waitForFunction(() => window.__polka.R.book && window.__polka.R.book.title === 'Зимние письма' && !window.__polka.R.rendering);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/16-fb2zip.png' });
  // мобильная ширина библиотеки
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 420, height: 860 }); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/17-narrow.png' });
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
