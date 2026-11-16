// 1.13.x: карточка «Значение» (Викисловарь + Википедия) с поддельной сетью
// node test/v25-meaning.js <папка для снимков>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'polka-v25'); fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const BOOKP = path.resolve(__dirname, '../testbooks/Северова - Дом у реки.fb2'), BS = fs.statSync(BOOKP);
const BOOK = { dir: path.dirname(BOOKP), file: { path: BOOKP, name: path.basename(BOOKP), size: BS.size, mtime: BS.mtimeMs } };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgYGAAkBwH/0QJ7NwAAAABJRU5ErkJggg==';
const UP = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';

// ---------- «Викисловарь» ----------
const wikt = (means) => '= Русский =\n\n=== Морфологические и синтаксические свойства ===\nПрилагательное.\n\n=== Семантические свойства ===\n\n==== Значение ====\n' +
  means.map((m) => m + ' ◆ Пример.').join('\n') + '\n\n==== Синонимы ====\nчто-то\n\n= Украинский =\n\n==== Значение ====\nчужое\n';
const WIKT = {
  'безмятежный': wikt(['ничем не нарушаемый, спокойный', 'ничем не встревоженный']),
  'кошка': wikt(['домашнее животное семейства кошачьих']),
  'замок': wikt(['устройство для запирания дверей']),
  'дом': wikt(['жилое здание']),
  'serendipity': '= Английский =\n\n==== Значение ====\nсчастливая случайность ◆ Пример.\n',
};
const WIKT_SEARCH = { 'безмятежным': ['Безмятежный (фильм)', 'безмятежность', 'безмятежный'], 'кошкой': ['кошка', 'кошкин'] };
// ---------- «Википедия» ----------
const WIKI = {
  ru: {
    'Москва': { description: 'столица России', extract: 'Москва́ (произношение) — столица России[1], крупнейший город страны.', thumbnail: { source: UP + 'a/aa/Moscow.jpg/250px-Moscow.jpg' } },
    'Кошка': { description: 'домашнее животное', extract: 'Ко́шка — домашнее животное.', thumbnail: { source: UP + 'b/bb/Cat_silhouette.svg/250px-Cat_silhouette.svg.png' } },
    'Дом': { extract: 'Дом — многозначный термин:', pageprops: { disambiguation: '' } },
    'Пётр I': { description: 'русский царь', extract: 'Пётр I Алексеевич — последний царь всея Руси и первый император.' },
    'Замок': { description: 'укреплённое жилище', extract: 'Замок — укреплённое жилище феодала.', thumbnail: { source: UP + 'c/cc/broken.jpg/250px-broken.jpg' } },
  },
  en: { 'Serendipity': { description: 'unplanned fortunate discovery', extract: 'Serendipity is an unplanned fortunate discovery.' } },
};
const REDIRECT = { 'Петр I': 'Пётр I' };
const OPENSEARCH = { 'Петр Первый': 'Пётр I' };

let mode = {}; const calls = [], imgCalls = [];
const res = (d, status = 200) => ({ ok: status === 200, status, text: typeof d === 'string' ? d : JSON.stringify(d) });
async function net(url) {
  calls.push(url);
  const u = new URL(url); const p = u.searchParams;
  const host = u.hostname;
  if (mode.slow && p.get('titles') === mode.slow.title) await new Promise((r) => setTimeout(r, mode.slow.ms));
  if (mode.offline) return { ok: false, status: 0, text: 'net::ERR_INTERNET_DISCONNECTED' };
  if (mode.hang) return new Promise(() => {});
  if (/wiktionary/.test(host)) {
    if (mode.wiktFail) return res('<html>oops</html>', mode.wiktFail);
    if (p.get('list') === 'search') return res({ query: { search: (WIKT_SEARCH[p.get('srsearch')] || []).map((title) => ({ title })) } });
    const t = p.get('titles');
    return res({ query: { pages: [WIKT[t] ? { title: t, extract: WIKT[t] } : { title: t, missing: true }] } });
  }
  if (/wikipedia/.test(host)) {
    if (mode.wikiFail) return res('<html>Error</html>', mode.wikiFail);
    if (mode.wikiHtml) return res('<!DOCTYPE html><title>captcha</title>');
    const lang = host.split('.')[0], W = WIKI[lang] || {};
    if (p.get('action') === 'opensearch') { const t = OPENSEARCH[p.get('search')]; return res([p.get('search'), t ? [t] : [], [], []]); }
    if (p.get('action') === 'query') {
      let t = p.get('titles'); t = t.charAt(0).toUpperCase() + t.slice(1); // первая буква в Википедии не различается
      const red = REDIRECT[t]; if (red) t = red;
      const pg = W[t];
      return res({ query: Object.assign(red ? { redirects: [{ from: p.get('titles'), to: t }] } : {}, { pages: [pg ? Object.assign({ title: t }, pg) : { title: t, missing: true }] }) });
    }
  }
  return res('', 404);
}
async function netImage(url) {
  imgCalls.push(url);
  if (/broken/.test(url)) return null;
  return 'data:image/png;base64,' + PNG;
}

(async () => {
  const b = await chromium.launch();
  async function open(withImageIpc) {
    const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const cspErr = []; page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) cspErr.push(m.text()); });
    await page.exposeFunction('__net', net);
    await page.exposeFunction('__read', (p) => fs.readFileSync(p).toString('base64'));
    if (withImageIpc) await page.exposeFunction('__netImage', netImage);
    await page.addInitScript((img) => {
      const bytes = (s) => { s = atob(s); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
      window.shelf = { pickFolder: async () => BOOK.dir, pickFile: async () => null, scan: async () => ({ files: [BOOK.file] }), stat: async () => null, read: async (p) => bytes(await window.__read(p)),
        initialFile: async () => null, initialUrl: async () => null, openExternal(u) { (window.__opened = window.__opened || []).push(u); }, toggleFullscreen() {}, setTheme() {}, onOpenFile() {}, onOpenUrl() {},
        netGet: (u) => window.__net(u) };
      if (img) window.shelf.netImage = (u) => window.__netImage(u);
    }, withImageIpc);
    await page.addInitScript((b) => { window.BOOK = b; }, BOOK);
    await page.goto('file://' + path.resolve(__dirname, '../dist/app/index.html'));
    await page.waitForFunction(() => window.__polka);
    await page.evaluate(() => { localStorage.setItem('polka.helpHinted', 'true'); localStorage.setItem('polka.settings', JSON.stringify({ theme: 'light', sound: 'off', flip: 'off' })); });
    await page.reload(); await page.waitForFunction(() => window.__polka);
    await page.click('#btn-folder-empty');
    await page.waitForFunction(() => !window.__polka.L.scanning && window.__polka.L.entries.length > 0);
    await page.evaluate(async () => { const P = window.__polka; await P.openEntry(P.L.entries[0]); });
    await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering && !document.getElementById('reader').hidden);
    await page.waitForTimeout(300);
    return { page, errs, cspErr };
  }
  const { page, errs } = await open(true);
  const card = () => page.evaluate(() => document.getElementById('info-card').hidden ? '(скрыта)' : document.getElementById('ic-body').innerText.replace(/\n+/g, ' | '));
  const spinning = () => page.evaluate(() => !!document.querySelector('#ic-body .spinner'));
  async function meaning(t, wait = 4000) {
    calls.length = 0; imgCalls.length = 0;
    await page.evaluate((t) => window.__polka.meaning(t), t);
    await page.waitForFunction(() => !document.querySelector('#ic-body .spinner'), null, { timeout: wait }).catch(() => {});
    await page.waitForTimeout(150);
    return card();
  }
  const imgState = () => page.evaluate(() => { const i = document.querySelector('#ic-body .ic-thumb'); return i ? { src: i.src.slice(0, 30), w: i.naturalWidth } : null; });

  // 1. словоформа: Викисловарь находит словарную форму, Википедии нет — не «пусто», а словарь
  let c = await meaning('безмятежным');
  ok(/Викисловарь/i.test(c) && /безмятежный/.test(c) && /спокойный/.test(c), 'словоформа «безмятежным» → «безмятежный»: ' + c.slice(0, 90));
  ok(!/Пример|чужое|Синонимы/.test(c), 'примеры, синонимы и чужие языки не попали в значения');
  await page.screenshot({ path: OUT + '/1-bezmyatezhnym.png' });

  // 2. словоформа существительного: Википедия по словарной форме + картинка-svg через главный процесс
  c = await meaning('кошкой');
  await page.waitForTimeout(200);
  ok(/кошка/.test(c) && /Ко?шка — домашнее/.test(c), '«кошкой»: словарь и Википедия по словарной форме: ' + c.slice(0, 120));
  ok(!/́/.test(c), 'ударения из текста статьи убраны');
  let im = await imgState();
  ok(im && /^data:image\/png/.test(im.src) && im.w === 2, 'картинка (svg → png) пришла через главный процесс и показана: ' + JSON.stringify(im));
  ok(imgCalls.length === 1 && /\.svg\/250px-.*\.svg\.png$/.test(imgCalls[0]), 'запрошена превью-картинка 250px: ' + imgCalls[0]);
  await page.screenshot({ path: OUT + '/2-koshkoy.png' });

  // 3. заглавное слово: сначала Википедия, сноски/«(произношение)» убраны, картинка есть
  c = await meaning('Москва');
  await page.waitForTimeout(200);
  ok(/^ВИКИПЕДИЯ/i.test(c) && /столица России, крупнейший/.test(c) && !/\[1\]|произношение/.test(c), 'Москва: Википедия первой, без сносок и «(произношение)»: ' + c.slice(0, 120));
  ok((await imgState() || {}).w === 2, 'у Москвы есть картинка');
  ok(calls.filter((u) => /wikipedia/.test(u)).length === 1 && /prop=extracts%7Cpageimages|prop=extracts\|pageimages/.test(calls.find((u) => /wikipedia/.test(u))), 'Википедия: один запрос (текст + картинка + перенаправления)');

  // 4. выделение с ударением, мягким переносом, nbsp и знаками препинания
  c = await meaning('«за́­мок,» ');
  ok(/устройство для запирания/.test(c), '«за́­мок,» → замок: ' + c.slice(0, 80));
  ok(calls.some((u) => /wiktionary/.test(u) && u.endsWith('titles=' + encodeURIComponent('замок'))), 'в запрос ушло чистое «замок»');
  im = await imgState();
  ok(!im, 'картинка не загрузилась — её нет в карточке (без «битого» значка)');
  ok(/Замок — укреплённое/.test(c), 'текст Википедии при этом показан');

  // 5. неоднозначность
  c = await meaning('дом');
  ok(/жилое здание/.test(c) && /несколько значений/.test(c) && !/многозначный термин:/.test(c), 'многозначная статья: подсказка вместо обрывка «…термин:»: ' + c.slice(0, 160));
  ok(/^ВИКИСЛОВАРЬ/i.test(c), 'обычное слово — сначала словарь');

  // 6. перенаправление (е/ё) и поиск
  c = await meaning('Петр I');
  ok(/Пётр I/.test(c) && /последний царь/.test(c), 'перенаправление «Петр I» → «Пётр I»: ' + c.slice(0, 80));
  c = await meaning('Петр Первый');
  ok(/последний царь/.test(c) && calls.some((u) => /opensearch/.test(u)), 'нет точной статьи — находим поиском: ' + c.slice(0, 60));

  // 7. английское слово: ru-Википедии нет — en
  c = await meaning('serendipity');
  ok(/счастливая случайность/.test(c) && /unplanned fortunate/.test(c), 'serendipity: словарь + en.wikipedia: ' + c.slice(0, 120));

  // 8. ничего нет
  c = await meaning('абырвалг');
  ok(/Ничего не нашлось для «абырвалг»/.test(c), 'нет ни статьи, ни словаря: ' + c);

  // 9. ошибки сервера не выдаются за «ничего не нашлось»
  mode = { wikiFail: 503, wiktFail: 429 };
  c = await meaning('камень');
  ok(/Не удалось получить ответ \(HTTP/.test(c) && /Попробовать ещё раз/.test(c), 'ошибка сервера показана с кнопкой повтора: ' + c);
  mode = {};
  calls.length = 0;
  await page.click('#ic-body [data-retry]');
  await page.waitForFunction(() => !document.querySelector('#ic-body .spinner'));
  c = await card();
  ok(calls.length > 0 && /Ничего не нашлось для «камень»/.test(c), 'повтор после ошибки снова спрашивает сеть: ' + c);
  mode = { wikiFail: 500 };
  c = await meaning('кошкой');
  ok(/домашнее животное семейства/.test(c), 'кэш не мешает: результат взят из памяти');
  c = await meaning('безмятежно');
  ok(/Ничего не нашлось|не ответила|Не удалось/.test(c), 'Википедия упала, словаря нет: ' + c);
  mode = { wiktFail: 503 };
  c = await meaning('Пётр I');
  ok(/последний царь/.test(c) && /Викисловарь сейчас не ответил \(HTTP 503\)/.test(c), 'одна служба упала — вторая показана, о сбое сказано: ' + c.slice(-60));
  mode = { wikiHtml: true };
  c = await meaning('тишина');
  ok(/непонятный ответ сервера/.test(c), 'HTML вместо JSON (капча/заглушка) не роняет карточку: ' + c);
  mode = { offline: true };
  c = await meaning('море');
  ok(/Нет подключения к интернету/.test(c), 'без сети: ' + c);

  // 10. сервер молчит — карточка не крутится вечно
  mode = { hang: true };
  const t0 = Date.now();
  c = await meaning('гора', 20000);
  ok(!(await spinning()) && /не ответил вовремя/.test(c) && Date.now() - t0 < 19000, 'зависший запрос: через ' + Math.round((Date.now() - t0) / 1000) + ' с — ' + c);
  mode = {};

  // 11. гонка: медленный ответ на старое слово не затирает новое
  mode = { slow: { title: 'Москва', ms: 1200 } };
  calls.length = 0;
  await page.evaluate(() => window.__polka.meaning('Москва'));
  await page.waitForTimeout(100);
  c = await meaning('дом');
  await page.waitForTimeout(1500);
  c = await card();
  ok(/жилое здание/.test(c) && !/столица/.test(c), 'медленная «Москва» не перебила «дом»');
  mode = {};
  ok(!errs.length, 'ошибок на странице нет: ' + errs.join('; '));

  // 12. веб-версия (без главного процесса): картинка прямой ссылкой проходит CSP
  const web = await open(false);
  await web.page.route('https://upload.wikimedia.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  await web.page.evaluate(() => window.__polka.meaning('Москва'));
  await web.page.waitForFunction(() => { const i = document.querySelector('#ic-body .ic-thumb'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const w = await web.page.evaluate(() => { const i = document.querySelector('#ic-body .ic-thumb'); return i ? { src: i.src, w: i.naturalWidth } : null; });
  ok(w && /^https:\/\/upload\.wikimedia\.org\//.test(w.src) && w.w === 2, 'веб-версия: картинка с upload.wikimedia.org показана: ' + JSON.stringify(w));
  ok(!web.cspErr.length, 'нарушений CSP нет: ' + web.cspErr.join('; '));
  await web.page.screenshot({ path: OUT + '/12-web.png' });

  await b.close();
  console.log(fails ? fails + ' FAIL' : 'всё хорошо');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
