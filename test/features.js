const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2]; const BOOKS = path.resolve(__dirname, '../testbooks');
const QDIR = path.join(BOOKS, 'Цитаты'); const window_graph_calls = []; fs.rmSync(QDIR, { recursive: true, force: true });
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
  if (url.includes('wikipedia.org') && url.includes('action=query')) { const t = decodeURIComponent(url.match(/titles=([^&]*)/)[1]); return t === 'Безмятежность' ? { query: { pages: [{ title: t, description: 'состояние души', extract: 'Безмятежность — состояние спокойствия и душевного равновесия, свободы от тревог.' }] } } : { query: { pages: [{ title: t, missing: true }] } }; }
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
  await page.exposeFunction('__ndel', (p) => { try { fs.unlinkSync(p); return true; } catch (e) { return false; } });
  await page.addInitScript((dir) => {
    window.__opened = [];
    window.shelf = {
      pickFolder: async () => dir, pickFile: async () => null, scan: () => window.__scan(), stat: (p) => window.__stat(p),
      read: async (p) => { const b = atob(await window.__read(p)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
      initialFile: async () => null, initialUrl: async () => null, openExternal(u) { window.__opened.push(u); }, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {},
      netGet: (u) => window.__net(u), quotesDefaultDir: async (b) => b + '/Цитаты',
      noteCreate: (o) => window.__ncreate(o), noteRead: (p) => window.__nread(p), noteWrite: (p, c) => window.__nwrite(p, c), noteDelete: (p) => window.__ndel(p), noteResolve: (o) => window.__nres(o), noteRmdir: (o) => window.__nrmdir(o), obsidianGraph: (d, done) => window.__graph(d, done),
    };
  }, BOOKS);
  const clickBook = async (pfx, opt) => { for (const t of ['reading', 'later', 'done']) { if (await page.isVisible('#grid [data-book-name^="' + pfx + '"]')) break; if (await page.isVisible('.sh-tab[data-shelf="' + t + '"]')) await page.click('.sh-tab[data-shelf="' + t + '"]'); } await page.click('#grid [data-book-name^="' + pfx + '"]', opt); };
  await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 0);
  // старая схема: цитата отдельным файлом
  const oldDir = path.join(QDIR, 'Анна Северова — Дом у реки'); fs.mkdirSync(oldDir, { recursive: true }); fs.mkdirSync(path.join(QDIR, 'Книги'), { recursive: true }); fs.mkdirSync(path.join(QDIR, 'Авторы'), { recursive: true });
  const oldFile = path.join(oldDir, 'Старая цитата.md');
  fs.writeFileSync(oldFile, '---\nкнига: "[[Анна Северова — Дом у реки]]"\ntags:\n  - цитата\npolka: "polka://open?x"\n---\n\n> старая\n');
  fs.writeFileSync(path.join(QDIR, 'Книги', 'Дом у реки.md'), '---\nавтор: "[[Анна Северова]]"\ntags:\n  - книга\npolka: "polka://open?book=x"\n---\n\n# Дом у реки\n\n[[Анна Северова]] · [открыть в Полке](polka://open?book=x)\n\n> [!quote] Глава 6 · 80%\n> Цитата прошлой версии\n>\n> #важно · 2 ноября 2026 · [открыть в Полке](polka://open?book=x&ch=6&off=10&q=qv2)\n\n^qv2\n');
  fs.writeFileSync(path.join(QDIR, 'Книги', 'Анна Северова — Дом у реки.md'), '---\nавтор: "[[Анна Северова]]"\ntags:\n  - книга\n---\n\n# Дом у реки\n\n[[Анна Северова]]\n');
  fs.writeFileSync(path.join(QDIR, 'Авторы', 'Анна Северова.md'), '---\ntags:\n  - автор\n---\n\n# Анна Северова\n');
  await page.evaluate((f) => { const id = window.__polka.L.entries.find((e) => e.name.startsWith('Северова')).id; localStorage.setItem('polka.quotes', JSON.stringify({ [id]: [{ id: 'qold1', ch: 3, off: 120, len: 40, text: 'Старая цитата из третьей главы', chapter: 'Глава 3. Дорога', pct: 0.3, tags: ['время'], file: f, t: Date.now() - 86400000 }, { id: 'qv2', ch: 6, off: 10, len: 20, text: 'Цитата прошлой версии', chapter: 'Глава 6', pct: 0.8, tags: ['важно'], file: f.replace(/Анна Северова — Дом у реки[\\/]Старая цитата\.md$/, 'Книги/Дом у реки.md'), v2: true, t: Date.now() - 86400000 }] })); }, oldFile);
  await clickBook('Северова');
  await page.waitForTimeout(1200);
  console.log('после переезда:', fs.readdirSync(QDIR, { recursive: true }).join(' | '));
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering);
  await page.evaluate(() => window.__polka.goTo(1, { page: 0 })); await page.waitForTimeout(400);

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

  const firstWord = await page.evaluate(() => { const p = document.querySelector('#flow section > p'); return p.textContent.replace(/­/g, '').split(/\s+/)[0]; });
  await dblWord();
  console.log('sel-bar visible:', await vis('sel-bar'), '| selection:', await page.evaluate(() => String(getSelection()).replace(/­/g, '')));
  await page.screenshot({ path: OUT + '/70-selbar.png' });
  await page.click('#sel-bar [data-act="translate"]'); await page.waitForTimeout(400);
  console.log('translate card:', await page.evaluate(() => document.getElementById('ic-body').innerText.replace(/\n+/g, ' | ')));
  await page.screenshot({ path: OUT + '/71-translate.png' });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  await dblWord();
  await page.click('#sel-bar [data-act="meaning"]'); await page.waitForTimeout(500);
  console.log('meaning card (unknown word):', await page.evaluate(() => document.getElementById('ic-body').innerText.replace(/\n+/g, ' | ').slice(0, 300)));
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__polka.meaning('безмятежным')); await page.waitForTimeout(500);
  console.log('meaning безмятежным:', await page.evaluate(() => document.getElementById('ic-body').innerText.replace(/\n+/g, ' | ')));
  await page.screenshot({ path: OUT + '/75-meaning.png' });
  await page.keyboard.press('Escape');
  // цитата из нескольких слов
  await dragPhrase();
  const selTxt = await page.evaluate(() => String(getSelection()).replace(/­/g, ''));
  await page.click('#sel-bar [data-act="quote"]'); await page.waitForTimeout(400);
  const cnt = () => page.evaluate(() => (JSON.parse(localStorage.getItem('polka.quotes') || '{}')[window.__polka.R.id] || []).length);
  console.log('draft:', await page.evaluate(() => document.getElementById('qp-status').textContent), '| save btn:', await vis('qp-save'), '| delete btn:', await vis('qp-delete'), '| quotes before save:', await cnt());
  // отмена черновика ничего не сохраняет
  await page.click('#qp-cancel'); await page.waitForTimeout(200);
  console.log('after cancel: pop', await vis('quote-pop'), 'quotes', await cnt());
  await dragPhrase(); await page.click('#sel-bar [data-act="quote"]'); await page.waitForTimeout(300);
  await page.click('#qp-tag-input'); await page.waitForTimeout(150);
  console.log('suggest on focus:', await page.evaluate(() => document.getElementById('qp-suggest').hidden ? 'hidden' : document.getElementById('qp-suggest').innerText.replace(/\n/g, ' | ')));
  await page.keyboard.type('вре'); await page.waitForTimeout(150);
  console.log('suggest «вре»:', await page.evaluate(() => document.getElementById('qp-suggest').innerText.replace(/\n/g, ' | ')));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  await page.keyboard.type('река детство'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  console.log('chips:', await page.evaluate(() => document.getElementById('qp-tags').innerText.replace(/\n/g, ' ')), '| quotes still', await cnt());
  await page.screenshot({ path: OUT + '/72-quote.png' });
  await page.click('#qp-save'); await page.waitForTimeout(500);
  console.log('saved:', await page.evaluate(() => document.getElementById('qp-status').textContent), '| delete btn:', await vis('qp-delete'), '| save btn:', await vis('qp-save'), '| quotes', await cnt());
  await page.screenshot({ path: OUT + '/72b-saved.png' });
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('polka.quotes'))[window.__polka.R.id][0]);
  console.log('stored quote:', { text: q.text, selTxt, off: q.off, len: q.len, tags: q.tags, file: q.file && path.relative ? q.file : q.file });
  await page.keyboard.press('Escape'); await page.mouse.click(700, 870);
  await page.evaluate(() => window.__polka.goTo(5, { page: 0 })); await page.waitForTimeout(400);
  await dragPhrase(); await page.click('#sel-bar [data-act="quote"]'); await page.waitForTimeout(300);
  await page.click('#qp-save'); await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__polka.goTo(1, { page: 0 })); await page.waitForTimeout(400);
  console.log('---- книга ----\n' + fs.readFileSync(q.file, 'utf8') + '---- конец ----');
  console.log('graph setup calls:', window_graph_calls.length);
  console.log('---- автор ----\n' + fs.readFileSync(path.join(QDIR, 'Авторы', 'Анна Северова.md'), 'utf8') + '---- конец ----');
  console.log('tree:', fs.readdirSync(QDIR, { recursive: true }).join(' | '));
  await page.waitForTimeout(200);
  // подсветка и клик по ней
  console.log('highlight text:', await page.evaluate(() => { const h = [...CSS.highlights.keys()].filter((k) => k.startsWith('quote')).map((k) => CSS.highlights.get(k))[0]; return h ? [...h][0].toString().replace(/­/g, '') : null; }));
  const hb = await page.evaluate(() => { const r = [...[...CSS.highlights.keys()].filter((k) => k.startsWith('quote')).map((k) => CSS.highlights.get(k))[0]][0].getClientRects()[0]; return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await page.mouse.click(hb.x, hb.y); await page.waitForTimeout(200);
  console.log('click on quote -> pop:', await vis('quote-pop'), await page.evaluate(() => document.getElementById('qp-text').textContent.slice(0, 40)));
  await page.keyboard.press('Escape');
  // вкладка цитат
  await page.keyboard.press('KeyT'); await page.click('#drawer-tabs [data-tab="quotes"]'); await page.waitForTimeout(200);
  console.log('quotes tab:', await page.evaluate(() => document.getElementById('q-list').innerText.replace(/\n+/g, ' | ')));
  await page.screenshot({ path: OUT + '/73-quotes-tab.png' });
  await page.keyboard.press('Escape');
  // глубокая ссылка: из другой главы обратно к цитате
  await page.evaluate(() => window.__polka.goTo(4, { page: 0 })); await page.waitForTimeout(300);
  const link = fs.readFileSync(q.file, 'utf8').match(new RegExp('\\((polka:[^)]+&q=' + q.id + ')\\)'))[1];
  await page.evaluate((u) => window.__polka.openLink(u), link); await page.waitForTimeout(700);
  console.log('flash marks:', await page.evaluate(() => document.querySelectorAll('.flash-mark').length));
  await page.screenshot({ path: OUT + '/76-flash.png' });
  console.log('deep link ->', await page.evaluate(() => ({ ch: window.__polka.R.ch, off: window.__polka.R.off })), 'quote at', q.ch, q.off,
    'visible:', await page.evaluate(() => { const h = [...CSS.highlights.keys()].filter((k) => k.startsWith('quote')).map((k) => CSS.highlights.get(k))[0]; if (!h) return false; const r = [...h][0].getClientRects()[0]; const v = document.getElementById('viewport').getBoundingClientRect(); return !!r && r.left >= v.left && r.right <= v.right; }));
  // лента + цитата через границу «страниц»
  await page.evaluate(() => window.__polka.changeSetting('cols', 'scroll')); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/74-scroll-quote.png' });
  // удаление
  await page.evaluate(() => { const b = document.querySelector('#q-list'); }); 
  await page.keyboard.press('KeyT'); await page.click('#drawer-tabs [data-tab="quotes"]'); await page.click('[data-qdel]'); await page.waitForTimeout(300);
  console.log('---- книга после удаления ----\n' + fs.readFileSync(q.file, 'utf8') + '---- конец ----');
  console.log('after delete: file exists?', fs.existsSync(q.file), '| list:', await page.evaluate(() => document.getElementById('q-list').innerText.slice(0, 40)));
  console.log('errors:', errs);
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
