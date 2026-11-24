const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2]; const BOOKS = path.resolve(__dirname, '../testbooks');
const QDIR = path.join(BOOKS, 'Читательский дневник'); const OLDQ = path.join(BOOKS, 'Цитаты'); const window_graph_calls = []; fs.rmSync(QDIR, { recursive: true, force: true });
function scan(d) { let o = []; for (const it of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, it.name); if (it.isDirectory()) o = o.concat(scan(p)); else if (/\.(fb2|epub|fb2\.zip)$/i.test(it.name)) { const s = fs.statSync(p); o.push({ path: p, name: it.name, size: s.size, mtime: s.mtimeMs }); } } return o; }
const WIKT = `== Русский ==\n\n=== Морфологические и синтаксические свойства ===\nбез-мя-теж-ный\n\nПрилагательное.\n\n=== Семантические свойства ===\n\n==== Значение ====\nничем не нарушаемый, спокойный ◆ Безмятежная тишина.\nничем не встревоженный, не омрачённый заботами ◆ Отсутствует пример употребления (см. рекомендации).\n\n==== Синонимы ====\nспокойный\n`;
function fake(url) {
  if (url.includes('translate.googleapis.com')) {
    const q = decodeURIComponent(url.match(/[?&]q=([^&]*)/)[1]); const tl = url.match(/tl=([^&]*)/)[1];
    const ru = /[а-я]/i.test(q);
    if (tl === 'ru' && ru) return { src: 'ru', sentences: [{ trans: q }] };
    return { src: ru ? 'ru' : 'en', sentences: [{ trans: ru ? 'The quiet house by the river' : 'безмятежный' }], dict: ru ? undefined : [{ pos: 'имя прилагательное', terms: ['безмятежный', 'спокойный', 'ясный'] }] };
  }
  if (url.includes('wiktionary.org') && url.includes('list=search')) return { query: { search: [{ title: 'безмятежный' }] } };
  if (url.includes('wiktionary.org')) { const t = decodeURIComponent(url.match(/titles=([^&]*)/)[1]); return t === 'безмятежный' ? { query: { pages: [{ title: t, extract: WIKT }] } } : { query: { pages: [{ title: t, missing: true }] } }; }
  if (url.includes('opensearch')) return ['x', ['Безмятежность'], [''], ['']];
  if (url.includes('rest_v1/page/summary')) return { title: 'Безмятежность', description: 'состояние души', extract: 'Безмятежность — состояние спокойствия и душевного равновесия, свободы от тревог.', type: 'standard', content_urls: { desktop: { page: 'https://ru.wikipedia.org/wiki/x' } } };
  return null;
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.exposeFunction('__scan', () => scan(BOOKS));
  await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
  await page.exposeFunction('__stat', (p) => { try { const s = fs.statSync(p); return { name: path.basename(p), size: s.size, mtime: s.mtimeMs }; } catch (e) { return null; } });
  await page.exposeFunction('__net', (u) => { const d = fake(u); return d ? { ok: true, status: 200, text: JSON.stringify(d) } : { ok: false, status: 404, text: '' }; });
  const safe = (s) => String(s).replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120);
  await page.exposeFunction('__ncreate', (o) => { const dir = o.sub ? path.join(o.dir, ...o.sub.map(safe)) : o.dir; fs.mkdirSync(dir, { recursive: true }); let p = path.join(dir, safe(o.name) + '.md'); if (o.onlyIfMissing) { if (!fs.existsSync(p)) fs.writeFileSync(p, o.content); return p; } for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, safe(o.name) + ' (' + i + ').md'); fs.writeFileSync(p, o.content); return p; });
  await page.exposeFunction('__nread', (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } });
  await page.exposeFunction('__nwrite', (p, c) => { fs.writeFileSync(p, c); return true; });
  await page.exposeFunction('__nres', (o) => path.join(o.dir, ...(o.sub || []).map(safe), safe(o.name) + '.md'));
  await page.exposeFunction('__nrmdir', (o) => { try { fs.rmdirSync(path.join(o.dir, ...o.sub.map(safe))); return true; } catch (e) { return false; } });
  await page.exposeFunction('__graph', (d, done) => { window_graph_calls.push(d); return { vault: null }; });
  await page.exposeFunction('__diary', (b) => { const d = path.join(b, 'Читательский дневник'), o = path.join(b, 'Цитаты'); if (fs.existsSync(d) || !fs.existsSync(o)) return { dir: d }; fs.renameSync(o, d); return { dir: d, renamed: true, old: o }; });
  await page.exposeFunction('__ndel', (p) => { try { fs.unlinkSync(p); return true; } catch (e) { return false; } });
  await page.addInitScript((dir) => {
    window.__opened = [];
    window.shelf = {
      pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => { const b = atob(await window.__read(p)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
      initialFile: async () => null, initialUrl: async () => null, openExternal(u) { window.__opened.push(u); }, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {},
      netGet: (u) => window.__net(u), quotesDefaultDir: async (b) => b + '/Читательский дневник', diaryDir: (b) => window.__diary(b),
      noteCreate: (o) => window.__ncreate(o), noteRead: (p) => window.__nread(p), noteWrite: (p, c) => window.__nwrite(p, c), noteDelete: (p) => window.__ndel(p), noteResolve: (o) => window.__nres(o), noteRmdir: (o) => window.__nrmdir(o), obsidianGraph: (d, done) => window.__graph(d, done),
    };
  }, BOOKS);
  const clickBook = async (pfx, opt) => { for (const t of ['reading', 'later', 'done']) { if (await page.isVisible('#grid [data-book-name^="' + pfx + '"]')) break; if (await page.isVisible('.sh-tab[data-shelf="' + t + '"]')) await page.click('.sh-tab[data-shelf="' + t + '"]'); } await page.click('#grid [data-book-name^="' + pfx + '"]', opt); };
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  // абзац на странице: координаты начала первой строки
  const para = () => page.evaluate(() => {
    const vr = document.getElementById('viewport').getBoundingClientRect();
    for (const p of document.querySelectorAll('#flow section > p')) {
      const r = p.getClientRects()[0];
      if (r && r.left >= vr.left && r.right <= vr.right && p.textContent.length > 250 && r.top > vr.top + 20 && r.top < vr.bottom - 200) {
        const lh = parseFloat(getComputedStyle(p).lineHeight);
        return { x: r.left + 40, y: r.top + lh / 2, lh, w: r.width };
      }
    }
    return null;
  });
  async function dblWord() { const p = await para(); await page.mouse.dblclick(p.x + 30, p.y); await page.waitForTimeout(150); }
  async function dragPhrase() { const p = await para(); await page.mouse.move(p.x - 39, p.y); await page.mouse.down(); await page.mouse.move(p.x + p.w * 0.5, p.y + p.lh, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150); }
  const vis = (id) => page.evaluate((id) => !document.getElementById(id).hidden, id);
  // старая папка «Цитаты» с одной цитатой
  fs.rmSync(OLDQ, { recursive: true, force: true });
  fs.mkdirSync(path.join(OLDQ, 'Книги'), { recursive: true });
  const oldBook = path.join(OLDQ, 'Книги', 'Дом у реки.md');
  const BOOKID = encodeURIComponent('Северова - Дом у реки.fb2|' + fs.statSync(path.join(BOOKS, 'Северова - Дом у реки.fb2')).size);
  fs.writeFileSync(oldBook, '---\nавтор: "[[Анна Северова]]"\nтип: книга\npolka: "polka://open?book=' + BOOKID + '"\n---\n\n# Дом у реки\n\n[[Анна Северова]] · [открыть в Полке](polka://open?book=' + BOOKID + ')\n\n> [!quote] Глава 6 · 80%\n> Цитата прошлой версии\n>\n> #важно · 2 ноября 2026 · [открыть в Полке](polka://open?book=' + BOOKID + '&ch=6&off=10&q=qv2)\n');
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 0);
  await page.evaluate((f) => { const id = window.__polka.L.entries.find((e) => e.name.startsWith('Северова')).id; localStorage.setItem('polka.quotes', JSON.stringify({ [id]: [{ id: 'qv2', ch: 6, off: 10, len: 20, text: 'Цитата прошлой версии', chapter: 'Глава 6', pct: 0.8, tags: ['важно'], file: f, v2: true, t: Date.now() - 86400000 }] })); localStorage.setItem('polka.quoteTags', JSON.stringify(['важно', 'смерть'])); }, oldBook);
  await clickBook('Северова');
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering);
  await page.waitForTimeout(800);
  console.log('папки:', fs.existsSync(OLDQ) ? 'Цитаты ЕСТЬ' : 'Цитаты нет', '|', fs.existsSync(QDIR) ? 'Дневник есть' : 'Дневника нет', '| путь цитаты:', await page.evaluate(() => JSON.parse(localStorage.getItem('polka.quotes'))[window.__polka.R.id][0].file.includes('Читательский дневник')));
  await page.evaluate(() => window.__polka.goTo(1, { page: 0 })); await page.waitForTimeout(400);

  // 1. заметка к фрагменту
  await dragPhrase();
  console.log('sel-bar buttons:', await page.evaluate(() => document.getElementById('sel-bar').innerText.replace(/\n/g, ' · ')));
  await page.click('#sel-bar [data-act="note"]'); await page.waitForTimeout(300);
  console.log('note draft:', await page.evaluate(() => document.getElementById('qp-status').textContent), '| focus:', await page.evaluate(() => document.activeElement.id));
  await page.keyboard.type('Похоже на детство у реки. Напоминает [[Дом');
  await page.waitForTimeout(150);
  console.log('link suggest:', await page.evaluate(() => document.getElementById('qp-link-suggest').hidden ? 'hidden' : document.getElementById('qp-link-suggest').innerText.replace(/\n/g, ' ')));
  await page.keyboard.press('Enter');
  await page.keyboard.type(' и [[Лев Толстой');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  console.log('body:', await page.evaluate(() => document.getElementById('qp-body').value));
  // клик мимо не теряет текст
  await page.mouse.click(1300, 300); await page.waitForTimeout(200);
  console.log('после клика мимо окошко открыто:', await vis('quote-pop'));
  await page.click('#qp-tag-input'); await page.keyboard.type('смер'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.screenshot({ path: OUT + '/80-note-draft.png' });
  await page.click('#qp-save'); await page.waitForTimeout(500);
  console.log('saved:', await page.evaluate(() => document.getElementById('qp-status').textContent), '| delete:', await page.evaluate(() => document.getElementById('qp-delete').textContent));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  console.log('pins:', await page.evaluate(() => document.querySelectorAll('.note-pin').length), '| note highlight:', await page.evaluate(() => [...CSS.highlights.keys()].filter((k) => k.startsWith('note')).join(',')));
  await page.screenshot({ path: OUT + '/81-note-pin.png' });
  // клик по значку — заметка
  await page.click('.note-pin'); await page.waitForTimeout(200);
  console.log('pin click:', await page.evaluate(() => document.getElementById('qp-status').textContent + ' | ' + document.getElementById('qp-body').value.slice(0, 30)));
  await page.click('#qp-close');

  // 2. цитата с мыслью
  await page.evaluate(() => window.__polka.goTo(2, { page: 0 })); await page.waitForTimeout(400);
  await dragPhrase(); await page.click('#sel-bar [data-act="quote"]'); await page.waitForTimeout(300);
  console.log('quote draft: addthought visible', await vis('qp-addthought'), '| body visible', await vis('qp-body-wrap'));
  await page.click('#qp-save'); await page.waitForTimeout(500);
  await page.click('#qp-addthought'); await page.waitForTimeout(120); await page.keyboard.type('Здесь главное — тишина.');
  console.log('save shown when dirty:', await vis('qp-save'));
  await page.keyboard.press('Control+Enter'); await page.waitForTimeout(500);
  console.log('after save: save hidden', !(await vis('qp-save')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  console.log('pins on ch2:', await page.evaluate(() => document.querySelectorAll('.note-pin').length));

  // 3. мысли о книге
  await page.keyboard.press('KeyT'); await page.click('#drawer-tabs [data-tab="notes"]'); await page.waitForTimeout(200);
  await page.click('#bn-view'); await page.keyboard.type('Книга о том, как место хранит память. Рядом с [[Лев Толстой]].');
  await page.click('#bn-save'); await page.waitForTimeout(500);
  console.log('notes tab:', await page.evaluate(() => document.getElementById('n-list').innerText.replace(/\n+/g, ' | ')));
  await page.screenshot({ path: OUT + '/82-notes-tab.png' });
  await page.keyboard.press('Escape');

  const bookFile = path.join(QDIR, 'Книги', 'Дом у реки.md');
  console.log('---- книга ----\n' + fs.readFileSync(bookFile, 'utf8') + '---- конец ----');
  // ссылка на заметку
  const nlink = fs.readFileSync(bookFile, 'utf8').match(/\((polka:[^)]+&n=[^)]+)\)/)[1];
  await page.evaluate(() => window.__polka.goTo(5, { page: 0 })); await page.waitForTimeout(300);
  await page.evaluate((u) => window.__polka.openLink(u), nlink); await page.waitForTimeout(700);
  console.log('note deep link: ch', await page.evaluate(() => window.__polka.R.ch), 'flash', await page.evaluate(() => document.querySelectorAll('.flash-mark').length));
  // удаление заметки
  await page.keyboard.press('KeyT'); await page.click('#drawer-tabs [data-tab="notes"]'); await page.click('[data-ndel]'); await page.waitForTimeout(400);
  console.log('после удаления: [!note] в файле:', (fs.readFileSync(bookFile, 'utf8').match(/\[!note\]/g) || []).length);
  console.log('errors:', errs);
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
