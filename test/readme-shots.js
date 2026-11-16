// Кадры для README: node test/readme-shots.js <куда> <папка с книгами (lib8 + стихи)>
// окно 1280×800, deviceScaleFactor 2 → кадры 2560×1600, JPEG q86
const fs = require('fs'), path = require('path');
const K = require('./design-kit');
const OUT = process.argv[2], BOOKS = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const cache = path.join(OUT, '_state.json');
  let dump;
  if (fs.existsSync(cache)) dump = JSON.parse(fs.readFileSync(cache, 'utf8'));
  else { const p0 = await K.launch({ browser, books: BOOKS }); dump = (await K.prepare(p0)).dump; fs.writeFileSync(cache, JSON.stringify(dump)); await p0.ctx.close(); }
  // «Вспомнить» — Тургенев, «У счастья нет завтрашнего дня»
  const q = JSON.parse(dump['polka.quotes']);
  for (const [book, list] of Object.entries(q)) for (const it of list) if (it.text.startsWith('У счастья')) {
    const d = new Date(); dump['polka.remember'] = JSON.stringify({ day: d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(), key: book + '#' + it.id, seen: [] });
  }
  const p = await K.launch({ browser, books: BOOKS, w: 1280, h: 800, dpr: 2 });
  const shot = (n) => p.screenshot({ path: path.join(OUT, n + '.jpg'), type: 'jpeg', quality: 86 });
  const boot = (s) => K.boot(p, dump, Object.assign({ focus: 'off', cols: 'auto' }, s));

  // hero: главная, «Читаю сейчас» крупными карточками
  await boot({ theme: 'light' });
  await p.click('.sh-tab[data-shelf="reading"]'); await p.click('[data-shview="list"]'); await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById('lib-main').scrollTop = 0; });
  await shot('00-hero');
  // главная: своя полка «Стихи», обложки
  await boot({ theme: 'light', remember: false });
  await p.click('.sh-tab[data-shelf="later"]'); await p.click('[data-shview="grid"]'); await p.waitForTimeout(300);
  await p.click('.sh-tab[data-shelf="s2"]'); await p.waitForTimeout(400);
  await p.mouse.move(640, 790);
  await shot('01-glavnaya');
  // «Заметки»
  await p.click('#lib-tabs [data-view="notebook"]'); await p.waitForTimeout(600);
  await shot('05-zametki');
  // «Блокноты»
  await p.click('#lib-tabs [data-view="pads"]'); await p.waitForTimeout(600);
  await shot('07-bloknoty');
  // разворот, сепия
  await boot({ theme: 'sepia' });
  await K.open(p, 'Анна Каренина', 2, { page: 0 }); await K.calm(p);
  await shot('02-razvorot-sepia');
  // цитата с тегами
  const pos = await p.evaluate(() => { for (const [k, h] of CSS.highlights) { if (!k.startsWith('quote')) continue; for (const r of h) { const rr = r.getClientRects()[0]; if (rr && rr.width > 0) return { x: rr.left + 40, y: rr.top + rr.height / 2 }; } } return null; });
  if (pos) { await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(600); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await shot('04-citata'); await p.keyboard.press('Escape'); }
  // блокнот рядом с книгой
  await boot({ theme: 'sepia' });
  await K.open(p, 'Анна Каренина', 3, { page: 0 });
  await p.keyboard.press('KeyN'); await p.waitForTimeout(600);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await K.calm(p);
  await shot('06-bloknot-ryadom');
  // «Лист», ночь
  await boot({ theme: 'night', focus: 'sheet' });
  await K.open(p, 'Дама с собачкой', 2, { page: 1 }); await K.calm(p);
  await shot('03-list-noch');
  // «Аа», сумерки
  await boot({ theme: 'dusk' });
  await K.open(p, 'Пиковая дама', 1, { page: 0 }); await K.showBars(p);
  await p.click('#btn-settings'); await p.waitForTimeout(500);
  await shot('08-aa');
  if (p.errs.length) console.log('ошибки:', p.errs);
  await browser.close();
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg'))) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' КБ');
})();
