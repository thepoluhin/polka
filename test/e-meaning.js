// «Значение» в настоящем Electron: сеть главного процесса подменена (protocol.handle),
// проверяем net-get (тайм-аут, разрешённые адреса) и net-image (картинка → data: URL под CSP)
// xvfb-run -a node test/e-meaning.js
const { _electron: electron } = require('playwright'); const path = require('path');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.resolve(__dirname, '../dist/app')] });
  await app.evaluate(({ protocol }) => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgYGAAkBwH/0QJ7NwAAAABJRU5ErkJggg==', 'base64');
    global.__seen = [];
    protocol.handle('https', async (req) => {
      const u = new URL(req.url); global.__seen.push({ url: req.url, ua: req.headers.get('user-agent') });
      const j = (d) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
      if (u.hostname === 'upload.wikimedia.org') {
        if (/svg-raw/.test(u.pathname)) return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml' } });
        if (/redirect/.test(u.pathname)) return new Response('', { status: 302, headers: { location: 'https://evil.example/x.png' } });
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      }
      if (u.hostname === 'ru.wikipedia.org' && u.searchParams.get('action') === 'query') {
        if (u.searchParams.get('titles') === 'Медленно') return new Promise(() => {});
        return j({ query: { pages: [{ title: 'Москва', description: 'столица России', extract: 'Москва — столица России.', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/M.jpg/250px-M.jpg' } }] } });
      }
      if (u.hostname === 'ru.wiktionary.org') return j({ query: { pages: [{ title: 'x', missing: true }], search: [] } });
      return new Response('nope', { status: 404 });
    });
  });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  const csp = []; win.on('console', (m) => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });
  await win.waitForFunction(() => window.__polka && window.shelf);
  // прямые вызовы моста
  const r = await win.evaluate(async () => ({
    img: (await window.shelf.netImage('https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/M.jpg/250px-M.jpg') || '').slice(0, 30),
    svg: await window.shelf.netImage('https://upload.wikimedia.org/wikipedia/commons/a/aa/svg-raw.svg'),
    redir: await window.shelf.netImage('https://upload.wikimedia.org/redirect.png'),
    other: await window.shelf.netImage('https://evil.example/x.png'),
    http: await window.shelf.netImage('http://upload.wikimedia.org/x.png'),
    get: (await window.shelf.netGet('https://evil.example/')).ok,
  }));
  ok(r.img === 'data:image/png;base64,iVBORw0K', 'net-image: png с upload.wikimedia.org → data: URL');
  ok(r.svg === null && r.redir === null && r.other === null && r.http === null && r.get === false, 'чужие адреса, перенаправления наружу и svg не пропускаются: ' + JSON.stringify(r));
  const seen = await app.evaluate(() => global.__seen);
  ok(seen.length && seen.every((s) => /^PolkaReader\/\d/.test(s.ua || '')), 'User-Agent для Викимедиа: ' + (seen[0] && seen[0].ua));
  // карточка целиком: книга не нужна, карточка в окне чтения — откроем читалку пустой
  await win.evaluate(() => { document.getElementById('library').hidden = true; document.getElementById('reader').hidden = false; window.__polka.meaning('Москва'); });
  await win.waitForFunction(() => { const i = document.querySelector('#ic-body .ic-thumb'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  const im = await win.evaluate(() => { const i = document.querySelector('#ic-body .ic-thumb'); return i ? { src: i.src.slice(0, 22), w: i.naturalWidth } : null; });
  ok(im && im.src === 'data:image/png;base64,' && im.w === 2, 'картинка в карточке показана в окне Electron: ' + JSON.stringify(im));
  ok(/Москва — столица России/.test(await win.textContent('#ic-body')), 'текст статьи показан');
  // зависший сервер: главный процесс сам обрывает запрос (12 с)
  const t0 = Date.now();
  const hang = await win.evaluate(() => window.shelf.netGet('https://ru.wikipedia.org/w/api.php?action=query&titles=%D0%9C%D0%B5%D0%B4%D0%BB%D0%B5%D0%BD%D0%BD%D0%BE'));
  ok(!hang.ok && hang.timeout && Date.now() - t0 < 14000, 'зависший запрос оборван через ' + Math.round((Date.now() - t0) / 1000) + ' с');
  ok(!csp.length, 'нарушений CSP нет: ' + csp.join('; '));
  ok(!errs.length, 'ошибок на странице нет: ' + errs.join('; '));
  await app.close();
  console.log(fails ? fails + ' FAIL' : 'всё хорошо'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
