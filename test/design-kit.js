// Общая обвязка для дизайн-снимков (test/design-shots.js, test/readme-shots.js):
// подменный window.shelf, «живая» библиотека с цитатами, заметками, полками и блокнотом.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const APP = 'file://' + path.resolve(__dirname, '../dist/app/index.html');
const DAY = 86400000;

function scan(d) {
  return fs.readdirSync(d).filter((n) => /\.fb2$/i.test(n)).map((n) => { const p = path.join(d, n), s = fs.statSync(p); return { path: p, name: n, size: s.size, mtime: s.mtimeMs }; });
}

// цитаты и заметки — настоящие места в тексте (кто, текст, теги, мысль, сколько дней назад, вид)
const Q = [
  ['Толстой - Анна', 'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.', ['семья', 'важно'], '', 9],
  ['Толстой - Анна', 'Все смешалось в доме Облонских.', ['семья'], 'Шесть слов — и уже весь дом перед глазами.', 9],
  ['Толстой - Анна', 'Степан Аркадьич был человек правдивый в отношении к себе самому.', ['характер'], '', 8],
  ['Пушкин - Капитанская', 'Не приведи бог видеть русский бунт, бессмысленный и беспощадный!', ['история'], '', 21],
  ['Пушкин - Капитанская', 'Береги честь смолоду.', ['важно'], '', 22],
  ['Тургенев - Ася', 'У счастья нет завтрашнего дня; у него нет и вчерашнего; оно не помнит прошедшего, не думает о будущем; у него есть настоящее – и то не день – а мгновенье.', ['счастье', 'важно'], 'Перечитать, когда кажется, что всё впереди.', 30],
  ['Толстой - Смерть', 'Прошедшая история жизни Ивана Ильича была самая простая и обыкновенная и самая ужасная.', ['жизнь'], '', 14],
  ['Чехов - Дама', 'И казалось, что еще немного – и решение будет найдено, и тогда начнется новая, прекрасная жизнь; и обоим было ясно, что до конца еще далеко-далеко и что самое сложное и трудное только еще начинается.', ['любовь', 'жизнь'], 'Лучший финал у Чехова: ничего не кончилось.', 3],
  ['Чехов - Дама', 'Говорили, что на набережной появилось новое лицо: дама с собачкой.', ['начало'], '', 4],
];
const NOTES = [
  ['Толстой - Анна', 'Степан Аркадьич не избирал ни направления, ни взглядов', 'Стива живёт «как все» — и в этом весь его характер. Сравнить с Левиным.', ['характер'], 7],
];
const PAD_AK = 'Кто кому родственник\n\nОблонские: Стива и Долли, пятеро детей.\nАнна — сестра Стивы, замужем за Карениным, сын Серёжа.\nКити — младшая сестра Долли (Щербацкие).\nЛевин — давний друг Стивы, влюблён в Кити.\nВронский — граф, офицер. Кити ждёт от него предложения.\nКознышев — сводный брат Левина, Николай — родной.\n\nПочему Толстой начинает не с Анны, а с чужой ссоры?';
const PAD_DAMA = 'Ялта, осень 1899.\nГуров — под сорок, банк, двое сыновей.\nАнна Сергеевна — «дама с собачкой», муж в С.\n\nЧехов не судит ни его, ни её.';

async function launch(o) {
  o = Object.assign({ w: 1280, h: 800, dpr: 1, books: null }, o);
  const b = o.browser || await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr });
  const page = await ctx.newPage();
  page.errs = []; page.on('pageerror', (e) => page.errs.push(e.message));
  await page.exposeFunction('__scan', () => scan(o.books));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__net', (u) => {
    if (/translate\.googleapis/.test(u)) return /tl=ru/.test(u) ? { ok: true, status: 200, text: JSON.stringify({ src: 'ru', sentences: [{ trans: '' }] }) }
      : { ok: true, status: 200, text: JSON.stringify({ src: 'ru', sentences: [{ trans: 'Everything was in confusion in the Oblonskys’ house.' }] }) };
    if (/wiktionary/.test(u)) return { ok: false, status: 404, text: '' };
    return { ok: false, status: 404, text: '' };
  });
  await page.addInitScript((dir) => {
    const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    window.shelf = { pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: async () => null, read: async (p) => bytes(await window.__read(p)),
      initialFile: async () => null, initialUrl: async () => null, openExternal() {}, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {},
      netGet: (u) => window.__net(u), diaryDir: async () => ({ dir: null }), noteRead: async () => null, version: async () => '2.0.0' };
  }, o.books);
  page.ctx = ctx; page.browser = b;
  return page;
}

const ready = (page, n) => page.waitForFunction((n) => window.__polka && !window.__polka.L.scanning && window.__polka.L.entries.length >= n && window.__polka.L.entries.every((e) => window.__polka.L.metas[e.id]), n || 8, { timeout: 60000 });

// первый запуск: папка, затем точные места цитат; результат — дамп localStorage
async function prepare(page, extra) {
  await page.goto(APP);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', flip: 'off', sound: 'off', focus: 'off', cols: 'auto' })); });
  await page.reload();
  await page.click('#btn-folder-empty');
  await ready(page);
  const quotes = {}, notes = {};
  const locate = (who, text) => page.evaluate(async ([who, text]) => {
    const P = window.__polka, e = P.L.entries.find((x) => x.name.startsWith(who));
    await P.openEntry(e);
    const norm = (s) => s.replace(/­/g, '').replace(/\s+/g, ' ');
    const ch = P.R.book.chapters.findIndex((c) => norm(c.html.replace(/<[^>]*>/g, '')).includes(norm(text).slice(0, 40)));
    if (ch < 0) return { off: -1 };
    await P.goTo(ch, { page: 0 });
    let dom = ''; const tw = document.createTreeWalker(document.getElementById('flow'), NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) dom += n.nodeValue.replace(/­/g, '');
    dom = dom.replace(/ /g, ' '); const off = dom.indexOf(text.slice(0, 30));
    const pct = (P.R.book.offsets[ch] + P.R.book.chapters[ch].len * off / Math.max(1, dom.length)) / P.R.book.totalLen;
    const t = P.R.book.toc.filter((x) => x.ch <= ch).pop();
    return { id: e.id, ch, off, pct, chapter: t ? t.title : '' };
  }, [who, text]);
  for (const [who, text, tags, note, days] of Q) {
    const r = await locate(who, text);
    if (r.off < 0) { console.log('не нашёл', text.slice(0, 30)); continue; }
    const it = { id: 'p' + Math.random().toString(36).slice(2, 9), ch: r.ch, off: r.off, len: text.length, text, chapter: r.chapter, pct: r.pct, tags, t: Date.now() - days * DAY };
    if (note) it.note = note;
    (quotes[r.id] = quotes[r.id] || []).push(it);
  }
  for (const [who, frag, body, tags, days] of NOTES) {
    const r = await locate(who, frag);
    if (r.off < 0) { console.log('не нашёл', frag.slice(0, 30)); continue; }
    (notes[r.id] = notes[r.id] || []).push({ id: 'n' + Math.random().toString(36).slice(2, 9), ch: r.ch, off: r.off, len: frag.length, text: frag, body, chapter: r.chapter, pct: r.pct, tags, t: Date.now() - days * DAY });
  }
  const ids = await page.evaluate(() => Object.fromEntries(window.__polka.L.entries.filter((e) => e.name.includes(' - ')).map((e) => [e.name.split(' - ')[1].replace(/\.fb2$/, ''), e.id])));
  await page.evaluate(([q, n, ids, PAD_AK, PAD_DAMA]) => {
    localStorage.setItem('polka.quotes', JSON.stringify(q));
    localStorage.setItem('polka.notes', JSON.stringify(n));
    localStorage.setItem('polka.bookNotes', JSON.stringify({ [ids['Смерть Ивана Ильича']]: { body: 'Самая страшная и самая светлая книга Толстого. Про то, что жить «как надо» — не то же самое, что жить.', t: Date.now() - 12 * 86400000 } }));
    const now = Date.now(), pr = {};
    pr[ids['Анна Каренина']] = { ch: 3, off: 0, pct: 0.12, t: now - 3600e3, chap: 'III', snip: 'Одевшись, Степан Аркадьич прыснул на себя духами, выправил рукава рубашки, привычным движением рассовал по карманам папиросы, бумажник, спички, часы с двойной цепочкой и брелоками…' };
    pr[ids['Дама с собачкой']] = { ch: 2, off: 0, pct: 0.54, t: now - 2 * 86400000, chap: 'II', snip: 'Прошла неделя после знакомства. Был праздничный день. В комнатах было душно, а на улицах вихрем носилась пыль, срывало шляпы.' };
    pr[ids['Смерть Ивана Ильича']] = { ch: 12, off: 0, pct: 1, t: now - 12 * 86400000, done: now - 12 * 86400000 };
    pr[ids['Ася']] = { ch: 22, off: 0, pct: 1, t: now - 30 * 86400000, done: now - 30 * 86400000 };
    localStorage.setItem('polka.progress', JSON.stringify(pr));
    const sh = [{ id: 's1', name: 'На отпуск', books: [ids['Пиковая дама'], ids['Первая любовь']] }];
    const poems = window.__polka.L.entries.filter((e) => /Стихотворения/.test(e.name)).map((e) => e.id);
    if (poems.length) sh.push({ id: 's2', name: 'Стихи', quiet: true, books: poems });
    localStorage.setItem('polka.shelves', JSON.stringify(sh));
    localStorage.setItem('polka.pads', JSON.stringify({
      [ids['Анна Каренина']]: { pages: [PAD_AK], t: now - 3600e3, title: 'Анна Каренина', author: 'Лев Толстой' },
      [ids['Дама с собачкой']]: { pages: [PAD_DAMA], t: now - 2 * 86400000, title: 'Дама с собачкой', author: 'Антон Чехов' },
    }));
    localStorage.setItem('polka.remember', JSON.stringify({}));
  }, [quotes, notes, ids, PAD_AK, PAD_DAMA]);
  if (extra) await extra(page, ids);
  const dump = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  return { dump, ids };
}

// новая вкладка с готовым состоянием
async function boot(page, dump, settings) {
  await page.goto(APP);
  await page.evaluate(([d, s]) => {
    localStorage.clear(); for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    const cur = JSON.parse(d['polka.settings'] || '{}');
    localStorage.setItem('polka.settings', JSON.stringify(Object.assign(cur, { sound: 'off', flip: 'off' }, s || {})));
  }, [dump, settings]);
  await page.reload();
  await ready(page);
  await page.waitForTimeout(500);
}

const set = (page, o) => page.evaluate((o) => { for (const [k, v] of Object.entries(o)) window.__polka.changeSetting(k, v); }, o);
async function open(page, title, ch, opt) {
  await page.evaluate(async ([title, ch, opt]) => { const P = window.__polka; const e = P.L.entries.find((x) => x.name.includes(title)); if (!P.R.book || P.R.entry.id !== e.id) await P.openEntry(e); await P.goTo(ch, opt || { page: 0 }); }, [title, ch, opt]);
  await page.waitForTimeout(600);
}
async function calm(page) { const v = page.viewportSize(); await page.mouse.move(v.width / 2, v.height / 2); await page.waitForTimeout(3300); }
async function showBars(page) { const v = page.viewportSize(); await page.mouse.move(v.width / 2, 10); await page.waitForTimeout(450); }

// выделить фразу в тексте книги (по началу) и показать всплывашку
async function selectText(page, start, len) {
  const r = await page.evaluate(([start, len]) => {
    const flow = document.getElementById('flow'); const tw = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) {
      const t = n.nodeValue.replace(/­/g, ''); const i = t.indexOf(start);
      if (i >= 0) {
        // смещения с учётом мягких переносов
        const map = []; for (let k = 0; k < n.nodeValue.length; k++) if (n.nodeValue[k] !== '­') map.push(k);
        const a = map[i], z = (map[Math.min(i + len, map.length - 1)] || n.nodeValue.length);
        const rg = document.createRange(); rg.setStart(n, a); rg.setEnd(n, z);
        const rc = rg.getClientRects(); if (!rc.length || rc[0].width === 0) continue;
        const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
        const last = rc[rc.length - 1]; return { x: last.right - 2, y: last.top + last.height / 2 };
      }
    }
    return null;
  }, [start, len]);
  if (r) { await page.mouse.move(r.x, r.y); await page.evaluate(() => document.getElementById('flow').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))); await page.waitForTimeout(350); }
  return r;
}

module.exports = { launch, prepare, boot, ready, set, open, calm, showBars, selectText, APP, scan };
