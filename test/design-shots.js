// Дизайн-снимки всех экранов: node test/design-shots.js <куда> <папка с книгами> [темы] [размеры] [масштабы] [сцены]
//   темы: light,sepia,dusk,night,black   размеры: 1280x800,1440x900   масштабы: 1,1.25   сцены: имена через запятую (по умолчанию все)
const fs = require('fs'), path = require('path');
const K = require('./design-kit');
const OUT = process.argv[2], BOOKS = process.argv[3];
const THEMES = (process.argv[4] || 'light').split(',');
const SIZES = (process.argv[5] || '1440x900').split(',').map((s) => s.split('x').map(Number));
const DPRS = (process.argv[6] || '1').split(',').map(Number);
const ONLY = process.argv[7] ? new Set(process.argv[7].split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });

const lib = async (p, dump, theme, extra) => { await K.boot(p, dump, Object.assign({ theme }, extra || {})); };
const clickTab = async (p, id) => { await p.click('.sh-tab[data-shelf="' + id + '"]'); await p.waitForTimeout(300); };
const view = async (p, mode) => { await p.click('[data-shview="' + mode + '"]'); await p.waitForTimeout(400); };
const reader = async (p, dump, theme, s, title, ch, opt) => { await K.boot(p, dump, Object.assign({ theme, focus: 'off', cols: 'auto' }, s || {})); await K.open(p, title, ch, opt); };

const SCENES = {
  'home-grid': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'later'); await view(p, 'grid'); },
  'home-list': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'later'); await view(p, 'list'); },
  'home-hero': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'reading'); await view(p, 'list'); },
  'home-reading-grid': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'reading'); await view(p, 'grid'); },
  'home-sticker': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'reading'); await view(p, 'list'); const s = p.locator('.stk i').first(); await s.hover(); await p.waitForTimeout(400); },
  'home-book-menu': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'later'); await view(p, 'grid'); await p.click('#grid .book-card >> nth=1', { button: 'right' }); await p.waitForTimeout(300); },
  'home-shelf-menu': async (p, d, t) => { await lib(p, d, t); await p.click('.sh-tab[data-custom="1"]', { button: 'right' }); await p.waitForTimeout(300); },
  'home-lib-settings': async (p, d, t) => { await lib(p, d, t); await p.click('#btn-lib-settings'); await p.waitForTimeout(400); },
  'home-focus-keyboard': async (p, d, t) => { await lib(p, d, t); await clickTab(p, 'later'); await view(p, 'grid'); await p.mouse.move(5, 400); for (let i = 0; i < 9; i++) await p.keyboard.press('Tab'); await p.waitForTimeout(200); },
  'home-search': async (p, d, t) => { await lib(p, d, t); await p.fill('#search', 'толстой'); await p.waitForTimeout(500); },
  'notes': async (p, d, t) => { await lib(p, d, t); await p.click('#lib-tabs [data-view="notebook"]'); await p.waitForTimeout(500); },
  'pads': async (p, d, t) => { await lib(p, d, t); await p.click('#lib-tabs [data-view="pads"]'); await p.waitForTimeout(500); },
  'pad-open': async (p, d, t) => { await lib(p, d, t); await p.click('#lib-tabs [data-view="pads"]'); await p.waitForTimeout(300); await p.click('.padc >> nth=0'); await p.waitForTimeout(400); await p.evaluate(() => document.activeElement && document.activeElement.blur()); },
  'empty-folder': async (p, d, t) => { await p.goto(K.APP); await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: t })); }, t); await p.reload(); await p.waitForTimeout(600); },
  'empty-shelf': async (p, d, t) => { const d2 = Object.assign({}, d, { 'polka.shelves': JSON.stringify(JSON.parse(d['polka.shelves']).concat([{ id: 's9', name: 'Перечитать летом', books: [] }])) }); await lib(p, d2, t); await clickTab(p, 's9'); },
  'empty-notes': async (p, d, t) => { const d2 = Object.assign({}, d, { 'polka.quotes': '{}', 'polka.notes': '{}', 'polka.bookNotes': '{}' }); await lib(p, d2, t); await p.click('#lib-tabs [data-view="notebook"]'); await p.waitForTimeout(400); },
  'empty-pads': async (p, d, t) => { const d2 = Object.assign({}, d, { 'polka.pads': '{}' }); await lib(p, d2, t); await p.click('#lib-tabs [data-view="pads"]'); await p.waitForTimeout(400); },
  'read-page': async (p, d, t) => { await reader(p, d, t, { cols: '1' }, 'Анна Каренина', 2, { page: 0 }); await K.calm(p); },
  'read-spread': async (p, d, t) => { await reader(p, d, t, { cols: '2' }, 'Анна Каренина', 2, { page: 0 }); await K.calm(p); },
  'read-bars': async (p, d, t) => { await reader(p, d, t, {}, 'Капитанская дочка', 2, { page: 1 }); await K.showBars(p); },
  'read-scroll': async (p, d, t) => { await reader(p, d, t, { cols: 'scroll' }, 'Пиковая дама', 2, { page: 0 }); await p.evaluate(() => { document.getElementById('viewport').scrollTop = 420; }); await K.calm(p); },
  'read-sheet': async (p, d, t) => { await reader(p, d, t, { focus: 'sheet' }, 'Дама с собачкой', 2, { page: 1 }); await K.calm(p); },
  'read-sheet-bars': async (p, d, t) => { await reader(p, d, t, { focus: 'sheet' }, 'Дама с собачкой', 2, { page: 1 }); await K.showBars(p); },
  'read-focus': async (p, d, t) => { await reader(p, d, t, { focus: 'sent' }, 'Ася', 3, { page: 0 }); for (let i = 0; i < 5; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(60); } await K.calm(p); },
  'read-aa': async (p, d, t) => { await reader(p, d, t, {}, 'Пиковая дама', 1, { page: 0 }); await K.showBars(p); await p.click('#btn-settings'); await p.waitForTimeout(400); },
  'read-aa-2': async (p, d, t) => { await reader(p, d, t, {}, 'Пиковая дама', 1, { page: 0 }); await K.showBars(p); await p.click('#btn-settings'); await p.waitForTimeout(300); await p.click('#set-tabs [data-tab="read"]'); await p.waitForTimeout(300); },
  'read-toc': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 3, { page: 0 }); await p.keyboard.press('KeyT'); await p.waitForTimeout(500); },
  'read-quotes': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 3, { page: 0 }); await p.keyboard.press('KeyT'); await p.waitForTimeout(300); await p.click('#drawer-tabs [data-tab="quotes"]'); await p.waitForTimeout(400); },
  'read-notes': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 3, { page: 0 }); await p.keyboard.press('KeyT'); await p.waitForTimeout(300); await p.click('#drawer-tabs [data-tab="impression"]'); await p.waitForTimeout(400); },
  'read-bookmarks': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 3, { page: 0 }); await p.keyboard.press('KeyT'); await p.waitForTimeout(300); await p.click('#drawer-tabs [data-tab="bookmarks"]'); await p.waitForTimeout(400); },
  'read-search': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 3, { page: 0 }); await p.keyboard.press('Control+f'); await p.waitForTimeout(300); await p.keyboard.type('Облонск'); await p.keyboard.press('Enter'); await p.waitForTimeout(900); },
  'read-selbar': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await K.selectText(p, 'Все смешалось', 30); },
  'read-translate': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await K.selectText(p, 'Все смешалось', 30); await p.click('.sel-bar [data-act="translate"]'); await p.waitForTimeout(700); },
  'read-quote-new': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await K.selectText(p, 'Жена узнала', 40); await p.click('.sel-bar [data-act="quote"]'); await p.waitForTimeout(500); },
  'read-quote': async (p, d, t) => {
    await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await K.calm(p);
    const pos = await p.evaluate(() => { for (const [k, h] of CSS.highlights) { if (!k.startsWith('quote')) continue; for (const r of h) { const rr = r.getClientRects()[0]; if (rr && rr.width > 0) return { x: rr.left + 30, y: rr.top + rr.height / 2 }; } } return null; });
    if (pos) { await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(500); }
  },
  'read-end': async (p, d, t) => { await reader(p, d, t, {}, 'Смерть Ивана', 0); await p.evaluate(async () => { const P = window.__polka; await P.goTo(P.R.book.chapters.length - 1, 'last'); }); await p.waitForTimeout(600); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(800); await K.calm(p); },
  'read-pad': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await p.keyboard.press('KeyN'); await p.waitForTimeout(500); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await K.showBars(p); },
  'help': async (p, d, t) => { await lib(p, d, t); await p.keyboard.press('F1'); await p.waitForTimeout(500); },
  'toast': async (p, d, t) => { await reader(p, d, t, {}, 'Анна Каренина', 2, { page: 0 }); await p.keyboard.press('KeyB'); await p.waitForTimeout(350); },
};

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  let dump;
  const cache = path.join(OUT, '_state.json');
  if (fs.existsSync(cache)) dump = JSON.parse(fs.readFileSync(cache, 'utf8'));
  else { const p = await K.launch({ browser, books: BOOKS }); dump = (await K.prepare(p)).dump; fs.writeFileSync(cache, JSON.stringify(dump)); await p.ctx.close(); }
  const errs = [];
  for (const [w, h] of SIZES) for (const dpr of DPRS) {
    const p = await K.launch({ browser, books: BOOKS, w, h, dpr });
    for (const t of THEMES) for (const [name, fn] of Object.entries(SCENES)) {
      if (ONLY && !ONLY.has(name)) continue;
      const file = path.join(OUT, name + '__' + t + '__' + w + 'x' + h + '@' + dpr + '.png');
      try { await fn(p, dump, t); await p.screenshot({ path: file }); }
      catch (e) { errs.push(name + ' ' + t + ' ' + w + 'x' + h + '@' + dpr + ': ' + e.message.split('\n')[0]); }
    }
    errs.push(...p.errs.map((e) => 'pageerror: ' + e)); await p.ctx.close();
  }
  console.log(errs.length ? errs.join('\n') : 'ошибок нет');
  await browser.close();
})();
