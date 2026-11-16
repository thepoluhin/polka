const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
// node test/e-evil.js [папка] — «вредная» книга evil.epub создаётся во временной папке (или в указанной)
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'polka-evil-'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
function makeEvil() {
  const { zipSync, strToU8 } = require('fflate');
  const x = (body) => '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><script>window.__pwn1=1</script></head><body>' + body + '</body></html>';
  const ch = x('<h1 id="toast">Глава</h1><p>Обычный текст главы.</p><script>window.__pwn2=1</script>' +
    '<img src="x" onerror="window.__pwn3=1"/><iframe src="javascript:window.__pwn4=1"></iframe><p style="color:red" onclick="window.__pwn5=1">Абзац со стилем.</p>' +
    '<a href="javascript:window.__pwn6=1">ссылка</a><svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwn7=1"><rect width="1" height="1"/></svg>' +
    '<img src="https://example.com/track.png"/><p>Конец главы.</p>');
  const opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">evil</dc:identifier><dc:title>Вредная книга</dc:title><dc:language>ru</dc:language></metadata>' +
    '<manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>';
  const nav = x('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="c1.xhtml">Глава</a></li></ol></nav>');
  fs.writeFileSync(path.join(S, 'evil.epub'), zipSync({ mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/c.opf': strToU8(opf), 'OEBPS/nav.xhtml': strToU8(nav), 'OEBPS/c1.xhtml': strToU8(ch) }));
  fs.writeFileSync(path.join(S, 'outside.md'), 'чужая заметка');
  fs.rmSync(path.join(S, 'planted.md'), { force: true });
}
(async () => {
  if (!fs.existsSync(path.join(S, 'evil.epub'))) makeEvil();
  // свой профиль: «вредная» книга не должна остаться в общем профиле и попасть в другие тесты
  fs.rmSync(path.join(S, 'profile'), { recursive: true, force: true });
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--user-data-dir=' + path.join(S, 'profile'), path.resolve(__dirname, '../dist/app'), S + '/evil.epub'] });
  const win = await app.firstWindow();
  const reqs = [];
  win.on('request', (r) => reqs.push(r.url()));
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.waitForFunction(() => window.__polka && window.__polka.R.book && !window.__polka.R.rendering, null, { timeout: 15000 });
  await win.waitForTimeout(1500);
  console.log('книга открыта:', await win.evaluate(() => window.__polka.R.book.title), '| глав:', await win.evaluate(() => window.__polka.R.book.chapters.length));
  const pwn = await win.evaluate(() => [1, 2, 3, 4, 5, 6, 7].filter((i) => window['__pwn' + i]).join(','));
  ok(!pwn, 'код из книги не выполнился' + (pwn ? ': ' + pwn : ''));
  console.log('выполнился код из книги:', pwn || 'нет', '| заголовок окна:', await win.title());
  console.log('текст главы на месте:', await win.evaluate(() => (() => { const t = document.getElementById('flow').textContent.replace(/\u00ad/g, ''); return /Обычный текст главы/.test(t) && /Конец главы/.test(t); })()));
  console.log('опасные теги в главе:', await win.evaluate(() => document.querySelectorAll('#flow script,#flow iframe,#flow xmp,#flow noembed,#flow [onerror],#flow [onload],#flow p[style]').length));
  console.log('ссылка javascript: href =', await win.evaluate(() => { const a = document.querySelector('#flow a'); return a ? a.getAttribute('href') : 'удалена'; }));
  console.log('id из книги не перехватывает toast:', await win.evaluate(() => document.getElementById('toast').classList.contains('toast')));
  console.log('запросы в интернет:', reqs.filter((u) => /^https?:/.test(u)).join(', ') || 'нет');
  // попытки из окна добраться до диска
  const tries = await win.evaluate(async (S) => {
    const r = {};
    try { await window.shelf.read('/etc/hostname'); r.read = 'ПРОЧИТАН'; } catch (e) { r.read = 'отказ'; }
    r.stat = (await window.shelf.stat('/etc/hostname')) ? 'ЕСТЬ' : 'отказ';
    r.del = (await window.shelf.noteDelete(S + '/outside.md')) ? 'УДАЛЁН' : 'отказ';
    try { await window.shelf.noteWrite(S + '/planted.md', 'x'); r.write = 'ЗАПИСАН'; } catch (e) { r.write = 'отказ'; }
    const sc = await window.shelf.scan('/'); r.scan = (sc.files || sc).length ? 'ВИДНО ' + (sc.files || sc).length : 'отказ';
    r.boot = (await window.shelf.bootstrap({ folder: '/' })) ? 'ПРИНЯТ' : 'отказ';
    try { await window.shelf.dataWrite('/tmp', 'x.json', '{}'); r.data = 'ЗАПИСАН'; } catch (e) { r.data = 'отказ'; }
    return r;
  }, S);
  console.log('доступ к диску из окна:', JSON.stringify(tries));
  ok(Object.values(tries).every((v) => v === 'отказ'), 'окно не получает доступ к диску');
  ok(fs.existsSync(S + '/outside.md') && !fs.existsSync(S + '/planted.md'), 'чужие файлы целы, подбросить файл нельзя');
  ok(!reqs.some((u) => /^https?:/.test(u)), 'книга не ходит в интернет');
  console.log('чужая заметка цела:', fs.existsSync(S + '/outside.md'), '| подброшенный файл:', fs.existsSync(S + '/planted.md'));
  try { await win.evaluate(() => { location.href = 'file:///etc/'; }); await win.waitForTimeout(800); } catch (e) { /* ок */ }
  console.log('увод окна на file:///etc/ → адрес:', win.url().replace(/^.*\//, '…/'));
  console.log('ошибки:', errs);
  await app.close();
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
