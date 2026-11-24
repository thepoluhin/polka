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
  fs.rmSync(OLDQ, { recursive: true, force: true }); fs.rmSync(QDIR, { recursive: true, force: true });
  await page.click('#btn-folder-empty');
  await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 0);
  await clickBook('Северова');
  await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering);
  await page.evaluate(() => window.__polka.goTo(1, { page: 0 })); await page.waitForTimeout(500);
  const pg = () => page.evaluate(() => [window.__polka.R.ch, window.__polka.R.page].join(':'));
  const g = await page.evaluate(() => { const v = document.getElementById('viewport').getBoundingClientRect(); const p = [...document.querySelectorAll('#flow section > p')].find((p) => { const r = p.getClientRects()[0]; return r && r.left < v.left + 100 && r.top > 300; }); const r = p.getClientRects()[1] || p.getClientRects()[0]; return { vl: v.left, vr: v.right, y: r.top + r.height / 2, tl: r.left }; });
  // 1. протянуть с поля в текст — выделение, без листания
  let p0 = await pg();
  await page.mouse.move(g.vl - 20, g.y); await page.mouse.down(); await page.mouse.move(g.vl + 160, g.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
  console.log('drag from margin: page', p0, '->', await pg(), '| selected:', JSON.stringify(await page.evaluate(() => String(getSelection()).replace(/\u00ad/g, '').slice(0, 30))));
  await page.keyboard.press('Escape');
  // 2. клик по тексту у самого края — не листает
  p0 = await pg();
  await page.mouse.click(g.tl + 4, g.y); await page.waitForTimeout(500);
  console.log('click text edge: page', p0, '->', await pg());
  // 3. короткий клик по правому полю — листает
  await page.mouse.click(g.vr + 25, g.y); await page.waitForTimeout(500);
  console.log('click right margin: page', p0, '->', await pg());
  // теги: заметка с тегами
  await page.evaluate(() => window.__polka.goTo(1, { page: 0 })); await page.waitForTimeout(400);
  await dragPhrase(); await page.click('#sel-bar [data-act="note"]'); await page.waitForTimeout(200);
  console.log('placeholder:', await page.evaluate(() => document.getElementById('qp-body').placeholder));
  await page.keyboard.type('Мысль'); await page.click('#qp-tag-input'); await page.keyboard.type('река, грусть, лишний'); await page.keyboard.press('Enter');
  await page.click('#qp-save'); await page.waitForTimeout(500); await page.click('#qp-close');
  const bookFile = path.join(QDIR, 'Книги', 'Дом у реки.md');
  const foot = () => (fs.readFileSync(bookFile, 'utf8').match(/^> #.*$/m) || ['—'])[0].replace(/\[открыть.*$/, '');
  console.log('foot before:', foot());
  await page.mouse.move(700, 20); await page.waitForTimeout(200);
  await page.click('#btn-back'); await page.waitForTimeout(300); // теги — в настройках на главной
  await page.click('#btn-lib-settings'); await page.click('#set-tags'); await page.waitForTimeout(200);
  console.log('tag manager:', await page.evaluate(() => document.getElementById('tp-list').innerText.replace(/\n+/g, ' | ')));
  await page.screenshot({ path: OUT + '/90-tags.png' });
  // переименовать «грусть» → «печаль»
  await page.click('.tp-row[data-tag="грусть"] .tp-name'); await page.keyboard.press('Control+a'); await page.keyboard.type('печаль'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  // удалить «лишний» (два клика — подтверждение)
  await page.click('.tp-row[data-tag="лишний"] .tp-del'); await page.waitForTimeout(100);
  console.log('confirm text:', await page.evaluate(() => document.querySelector('.tp-row[data-tag="лишний"] .tp-del').textContent));
  await page.click('.tp-row[data-tag="лишний"] .tp-del'); await page.waitForTimeout(400);
  console.log('after ops:', await page.evaluate(() => document.getElementById('tp-list').innerText.replace(/\n+/g, ' | ')));
  console.log('foot after:', foot());
  console.log('versions shown in settings:', await page.evaluate(() => /Полка \d/.test(document.getElementById('settings').innerText)));
  console.log('tabs:', await page.evaluate(() => document.getElementById('drawer-tabs').innerText.replace(/\n/g, ' / ')));
  console.log('errors:', errs);
  await browser.close();
  fs.rmSync(QDIR, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
