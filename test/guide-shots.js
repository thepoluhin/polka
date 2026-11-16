// скриншоты для встроенной книги-путеводителя (src/guide): node test/guide-shots.js <куда> <папка с книгами>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2], BOOKS = process.argv[3];
function scan(d) { let o = []; for (const it of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, it.name); if (it.isFile() && /\.fb2$/i.test(it.name)) { const s = fs.statSync(p); o.push({ path: p, name: it.name, size: s.size, mtime: s.mtimeMs }); } } return o; }
const DAY = 86400000;
const Q = [
  ['Толстой', 'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.', ['семья', 'важно'], '', 9],
  ['Толстой', 'Все смешалось в доме Облонских.', ['семья'], 'Шесть слов — и уже весь дом перед глазами.', 9],
  ['Пушкин - Капитанская', 'Не приведи бог видеть русский бунт, бессмысленный и беспощадный!', ['история'], '', 21],
  ['Тургенев - Ася', 'У счастья нет завтрашнего дня; у него нет и вчерашнего; оно не помнит прошедшего, не думает о будущем; у него есть настоящее – и то не день – а мгновенье.', ['счастье', 'важно'], 'Перечитать, когда кажется, что всё впереди.', 30],
  ['Толстой - Смерть', 'Прошедшая история жизни Ивана Ильича была самая простая и обыкновенная и самая ужасная.', ['жизнь'], '', 14],
  ['Чехов - Дама', 'И казалось, что еще немного – и решение будет найдено, и тогда начнется новая, прекрасная жизнь; и обоим было ясно, что до конца еще далеко-далеко и что самое сложное и трудное только еще начинается.', ['любовь', 'жизнь'], 'Лучший финал у Чехова: ничего не кончилось.', 3],
];
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.25 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.exposeFunction('__guide', () => { try { return fs.readFileSync(path.resolve(__dirname, '../src/guide/guide.fb2')).toString('base64'); } catch (e) { return ''; } });
  await page.addInitScript((dir) => { const gb = async () => { const b = atob(await window.__guide()); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }; window.shelf = { guideStat: async () => { const u = await gb(); return u.length ? { size: u.length } : null; }, guideRead: gb, pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p), read: async (p) => { const b = atob(await window.__read(p)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }, initialFile: async () => null, initialUrl: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {}, diaryDir: async () => ({ dir: null }), noteRead: async () => null, version: async () => '1.11' }; }, BOOKS);
  await page.goto('file://' + require('path').resolve(__dirname, '../dist/app/index.html'));
  await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', flip: 'turn', sound: 'off', focus: 'off', cols: 'auto' })); });
  await page.reload();
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8 && window.__polka.L.entries.every((e) => window.__polka.L.metas[e.id]));
  await page.waitForTimeout(800);
  // цитаты — на настоящих местах в тексте
  const quotes = {}, notes = {};
  for (const [who, text, tags, note, days] of Q) {
    const r = await page.evaluate(async ([who, text]) => {
      const P = window.__polka, e = P.L.entries.find((x) => x.name.startsWith(who));
      await P.openEntry(e);
      const norm = (s) => s.replace(/­/g, '').replace(/\s+/g, ' ');
      const ch = P.R.book.chapters.findIndex((c) => norm(c.html.replace(/<[^>]*>/g, '')).includes(norm(text).slice(0, 40)));
      await P.goTo(ch, { page: 0 });
      let dom = ''; const tw = document.createTreeWalker(document.getElementById('flow'), NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) dom += n.nodeValue.replace(/­/g, '');
      dom = dom.replace(/\u00a0/g, ' '); const off = dom.indexOf(text.slice(0, 30));
      const pct = (P.R.book.offsets[ch] + P.R.book.chapters[ch].len * off / Math.max(1, dom.length)) / P.R.book.totalLen;
      const t = P.R.book.toc.filter((x) => x.ch <= ch).pop();
      return { id: e.id, ch, off, pct, chapter: t ? t.title : '' };
    }, [who, text]);
    if (r.off < 0) { console.log('не нашёл', text.slice(0, 30)); continue; }
    const it = { id: 'p' + Math.random().toString(36).slice(2, 9), ch: r.ch, off: r.off, len: text.length, text, chapter: r.chapter, pct: r.pct, tags, t: Date.now() - days * DAY };
    if (note) it.note = note;
    (quotes[r.id] = quotes[r.id] || []).push(it);
  }
  const ids = await page.evaluate(() => Object.fromEntries(window.__polka.L.entries.filter((e) => e.name.includes(' - ')).map((e) => [e.name.split(' - ')[1].replace('.fb2', ''), e.id])));
  await page.evaluate(([q, ids]) => {
    localStorage.setItem('polka.quotes', JSON.stringify(q));
    localStorage.setItem('polka.bookNotes', JSON.stringify({ [ids['Смерть Ивана Ильича']]: { body: 'Самая страшная и самая светлая книга Толстого. Про то, что жить «как надо» — не то же самое, что жить.', t: Date.now() - 12 * 86400000 } }));
    const now = Date.now();
    const pr = {};
    pr[ids['Дама с собачкой']] = { ch: 2, off: 0, pct: 0.54, t: now - 3600e3, chap: 'II', snip: 'Прошла неделя после знакомства. Был праздничный день. В комнатах было душно, а на улицах вихрем носилась пыль, срывало шляпы. Весь день хотелось пить, и Гуров часто заходил в павильон…' };
    pr[ids['Анна Каренина']] = { ch: 3, off: 0, pct: 0.12, t: now - 2 * 86400000, chap: 'III', snip: 'Одевшись, Степан Аркадьич прыснул на себя духами, выправил рукава рубашки, привычным движением рассовал по карманам папиросы, бумажник, спички, часы с двойной цепочкой и брелоками…' };
    pr[ids['Смерть Ивана Ильича']] = { ch: 12, off: 0, pct: 1, t: now - 12 * 86400000, done: now - 12 * 86400000 };
    localStorage.setItem('polka.progress', JSON.stringify(pr));
    localStorage.setItem('polka.remember', JSON.stringify({}));
  }, [quotes, ids]);
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.jpg', type: 'jpeg', quality: 80 });
  const open = async (title, ch, opt) => { await page.evaluate(async ([title, ch, opt]) => { const P = window.__polka; const e = P.L.entries.find((x) => x.name.includes(title)); if (!P.R.book || P.R.entry.id !== e.id) await P.openEntry(e); await P.goTo(ch, opt || { page: 0 }); }, [title, ch, opt]); await page.waitForTimeout(700); };
  const set = (o) => page.evaluate((o) => { for (const [k, v] of Object.entries(o)) window.__polka.changeSetting(k, v); }, o);
  const calm = async () => { await page.mouse.move(640, 420); await page.waitForTimeout(3300); };
  // 1. библиотека
  await page.reload();
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8);
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('polka.remember') || '{}'); });
  // «Вспомнить» — пусть будет Тургенев
  await page.evaluate(() => { const q = JSON.parse(localStorage.getItem('polka.quotes')); for (const [book, list] of Object.entries(q)) for (const it of list) if (it.text.startsWith('У счастья')) localStorage.setItem('polka.remember', JSON.stringify({ day: (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })(), key: book + '#' + it.id, seen: [] })); });
  await page.reload();
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8);
  await page.waitForTimeout(900);
  await page.click('[data-shview="grid"]'); await page.waitForTimeout(400);
  await shot('01-polki');
  await page.click('[data-shview="list"]'); await page.waitForTimeout(400);
  await shot('01b-opisanie');
  // полка «Отложенные» с меню книги и своей полкой
  await page.evaluate((ids) => { localStorage.setItem('polka.shelves', JSON.stringify([{ id: 's1', name: 'На отпуск', books: [ids['Пиковая дама'], ids['Первая любовь']] }])); }, ids);
  await page.reload();
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8);
  await page.waitForTimeout(700);
  await page.click('.sh-tab[data-shelf="later"]'); await page.waitForTimeout(300);
  await page.click('#grid .book-card >> nth=2', { button: 'right' }); await page.waitForTimeout(300);
  await shot('02-menu-knigi');
  await page.keyboard.press('Escape');
  // 2. записная книжка
  await page.click('#lib-tabs [data-view="notebook"]'); await page.waitForTimeout(500);
  await shot('07-zapisnaya-knizhka');
  await page.click('#lib-tabs [data-view="books"]');
  // 3. разворот, сепия — Анна Каренина
  await set({ theme: 'sepia', cols: 'auto', focus: 'off' });
  await open('Анна Каренина', 2, { page: 0 }); await calm();
  await shot('02-razvorot-sepia');
  // 4. цитата: окошко записи
  await page.evaluate(() => { const P = window.__polka; const it = JSON.parse(localStorage.getItem('polka.quotes'))[P.R.id].find((x) => x.text.startsWith('Все счастливые')); });
  const pos = await page.evaluate(() => { const hs = CSS.highlights; for (const [k, h] of hs) { if (!k.startsWith('quote')) continue; for (const r of h) { const rr = r.getClientRects()[0]; if (rr && rr.width > 0) return { x: rr.left + 30, y: rr.top + rr.height / 2 }; } } return null; });
  if (pos) { await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(500); await shot('05-citata'); await page.keyboard.press('Escape'); }
  // 5. «Лист», ночь — Дама с собачкой
  await set({ theme: 'night', focus: 'sheet' });
  await open('Дама с собачкой', 2, { page: 1 }); await calm();
  await shot('03-list-noch');
  // 6. поворот листа — посередине
  await set({ theme: 'sepia', focus: 'off', cols: 'auto', flip: 'turn' });
  await open('Капитанская дочка', 2, { page: 1 }); await calm();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60);
  await page.evaluate(() => window.__flipSeek(0.28)); await page.waitForTimeout(150); // лист хорошо виден (около середины он стоит ребром)
  await shot('04-povorot');
  await page.evaluate(() => window.__flipSeek(1)); await page.waitForTimeout(300);
  await set({ flip: 'curl' }); await open('Капитанская дочка', 2, { page: 1 }); await calm();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60);
  await page.evaluate(() => window.__flipSeek(0.45)); await page.waitForTimeout(150);
  await shot('04b-zagib');
  await page.evaluate(() => window.__flipSeek(1)); await set({ flip: 'turn' });
  // 7. фокус на предложении, сумерки — Ася
  await set({ theme: 'dusk', focus: 'sent', cols: 'auto' });
  await open('Ася', 3, { page: 0 }); await page.waitForTimeout(400);
  for (let i = 0; i < 7; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(60); }
  await calm();
  await shot('06-fokus-predlozhenie');
  // 8. меню «Аа»
  await set({ theme: 'light', focus: 'off' });
  await open('Пиковая дама', 1, { page: 0 }); await page.mouse.move(640, 20); await page.waitForTimeout(300);
  await page.click('#btn-settings'); await page.waitForTimeout(400);
  await shot('08-aa-tekst');
  await page.click('#set-tabs [data-tab="read"]'); await page.waitForTimeout(300);
  await shot('08b-aa-chtenie');
  await page.keyboard.press('Escape');
  // 9. последняя страница
  await set({ theme: 'sepia', focus: 'sheet' });
  await page.evaluate(async () => { const P = window.__polka; const e = P.L.entries.find((x) => x.name.includes('Смерть Ивана')); await P.openEntry(e); await P.goTo(P.R.book.chapters.length - 1, 'last'); });
  await page.waitForTimeout(800); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  await page.evaluate(() => window.__flipSeek && window.__flipSeek(1)); await calm();
  await shot('09-kniga-prochitana');
  // 10. лента, чёрная тема
  await page.keyboard.press('ArrowLeft');
  await set({ theme: 'black', focus: 'off', cols: 'scroll' });
  await open('Пиковая дама', 2, { page: 0 }); await page.evaluate(() => { document.getElementById('viewport').scrollTop = 420; }); await calm();
  await shot('10-lenta-chernaya');
  // 12. блокнот рядом с книгой — Анна Каренина, сепия
  await page.evaluate((id) => localStorage.setItem('polka.pads', JSON.stringify({ [id]: { pages: ['Облонские: Стива и Долли, пятеро детей.\nАнна — сестра Стивы, замужем за Карениным, сын Серёжа.\nКити — младшая сестра Долли.\nЛевин — давний друг Стивы, влюблён в Кити.\nВронский — граф, офицер. Кити ждёт от него предложения.\n\nПочему Толстой начинает не с Анны, а с чужой ссоры?'], t: Date.now(), title: 'Анна Каренина', author: 'Лев Толстой' } })), ids['Анна Каренина']);
  await page.reload();
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length >= 8);
  await set({ theme: 'sepia', focus: 'off', cols: 'auto' });
  await open('Анна Каренина', 2, { page: 0 });
  await page.keyboard.press('KeyN'); await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.mouse.move(640, 20); await page.waitForTimeout(400);
  await shot('12-bloknot');
  console.log('ошибки:', errs);
  await b.close();
})();
