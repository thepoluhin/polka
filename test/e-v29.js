// 2.0, краш-тесты главного процесса в настоящем Electron: xvfb-run -a node test/e-v29.js
// • IPC с чужими путями (.., UNC, C:\Windows, /etc) — отказ; • net-get/net-image — только разрешённые адреса;
// • одновременные записи одного файла дневника не смешиваются; • вторая копия с относительным путём к книге.
const { _electron: electron } = require('playwright'); const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { fb2, sec, para } = require('./v29-evilbooks.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polka-e29-'));
  const ud = path.join(tmp, 'ud'), lib = path.join(tmp, 'lib'), sub = path.join(tmp, 'другая');
  fs.mkdirSync(ud); fs.mkdirSync(lib); fs.mkdirSync(sub);
  fs.writeFileSync(path.join(lib, 'Своя.fb2'), fb2({ title: 'Своя', body: sec('Глава', para(20)) }));
  fs.writeFileSync(path.join(sub, 'Чужая книга.fb2'), fb2({ title: 'Открыта второй копией', body: sec('Глава', para(20)) }));
  fs.writeFileSync(path.join(tmp, 'secret.md'), 'секрет');
  fs.writeFileSync(path.join(ud, 'allowed.json'), JSON.stringify({ roots: [lib], files: [] }));
  const appDir = path.resolve(__dirname, '../dist/app');
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--user-data-dir=' + ud, appDir] });
  const page = await app.firstWindow();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.waitForFunction(() => window.__polka);
  await page.evaluate((lib) => { localStorage.setItem('polka.folder', JSON.stringify(lib)); localStorage.setItem('polka.helpHinted', 'true'); }, lib);
  await page.reload(); await page.waitForFunction(() => window.__polka && !window.__polka.L.scanning && window.__polka.L.entries.length > 0);

  // ---- чужие пути
  const r = await page.evaluate(async ({ lib, tmp }) => {
    const S = window.shelf, out = {};
    const tryP = async (f) => { try { return await f(); } catch (e) { return 'отказ'; } };
    const paths = [lib + '/../secret.md', lib + '/./../secret.md', '\\\\server\\share\\x.fb2', 'C:\\Windows\\win.ini', '/etc/hostname', '..', '', null, 42, { a: 1 }];
    for (const p of paths) {
      const k = JSON.stringify(p);
      out[k] = [
        await tryP(() => S.read(p).then(() => 'ПРОЧИТАН')), await tryP(() => S.stat(p).then((x) => (x ? 'ЕСТЬ' : 'отказ'))),
        await tryP(() => S.noteRead(p).then((x) => (x == null ? 'отказ' : 'ПРОЧИТАН'))), await tryP(() => S.noteWrite(p, 'x').then(() => 'ЗАПИСАН')),
        await tryP(() => S.noteDelete(p).then((x) => (x ? 'УДАЛЁН' : 'отказ'))), await tryP(() => S.scan(p).then((x) => ((x.files || []).length ? 'ВИДНО' : 'отказ'))),
      ].join(',');
    }
    out.dataEsc = await tryP(() => S.dataWrite(lib, '../../x.json', '{}').then(() => 'ЗАПИСАН'));
    out.dataOut = await tryP(() => S.dataWrite(tmp, 'x.json', '{}').then(() => 'ЗАПИСАН'));
    out.noteCreateOut = await tryP(() => S.noteCreate({ dir: tmp, sub: [], name: 'x', content: 'x' }).then(() => 'ЗАПИСАН'));
    out.noteCreateDots = await tryP(() => S.noteCreate({ dir: lib, sub: ['..', '..'], name: '../../evil', content: 'x' }));
    out.rmdir = await tryP(() => S.noteRmdir({ dir: lib, sub: ['..'] }));
    out.boot = await tryP(() => S.bootstrap({ folder: '/' }));
    return out;
  }, { lib, tmp });
  const bad = Object.entries(r).filter(([k, v]) => /ПРОЧИТАН|ЕСТЬ|ЗАПИСАН|УДАЛЁН|ВИДНО/.test(v));
  ok(!bad.length, 'чужие пути (.., UNC, C:\\Windows, /etc, мусор) — отказ' + (bad.length ? ': ' + JSON.stringify(bad) : ''));
  ok(typeof r.noteCreateDots === 'string' && r.noteCreateDots.startsWith(lib + path.sep), '«..» в имени заметки не выводит из папки: ' + r.noteCreateDots);
  ok(r.rmdir === false || r.rmdir === 'отказ', 'note-rmdir с «..» — отказ');
  ok(fs.readFileSync(path.join(tmp, 'secret.md'), 'utf8') === 'секрет' && !fs.existsSync(path.join(tmp, 'x.json')), 'файлы вне папки целы');

  // ---- сеть: только переводчик и Википедия
  const net = await page.evaluate(async () => {
    const urls = ['https://evil.com/', 'http://ru.wikipedia.org/w/api.php', 'https://ru.wikipedia.org.evil.com/x', 'https://translate.googleapis.com@evil.com/', 'https://evil.com/?https://ru.wikipedia.org/',
      'file:///etc/hostname', 'https://ru.wikipedia.org:8443/x', 'https://127.0.0.1/', 'javascript:alert(1)', null, 5];
    const o = {};
    for (const u of urls) { const x = await window.shelf.netGet(u); o['get ' + u] = x.ok || x.status || x.text ? 'ПУСТИЛ' : 'отказ'; }
    for (const u of ['https://evil.com/a.png', 'http://upload.wikimedia.org/a.png', 'https://upload.wikimedia.org.evil.com/a.png', 'file:///etc/hostname']) o['img ' + u] = (await window.shelf.netImage(u)) ? 'ПУСТИЛ' : 'отказ';
    return o;
  });
  const nbad = Object.entries(net).filter(([, v]) => v !== 'отказ');
  ok(!nbad.length, 'net-get / net-image с недопустимыми адресами — отказ' + (nbad.length ? ': ' + JSON.stringify(nbad) : ''));

  // ---- одновременные записи одного файла: содержимое целое (раньше общий .polka-tmp смешивал записи)
  const diary = path.join(lib, 'Читательский дневник');
  const res = await page.evaluate(async (dir) => {
    const bodies = Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, pad: 'ж'.repeat((40 - i) * 3000) }));
    const rr = await Promise.allSettled(bodies.map((b) => window.shelf.dataWrite(dir, 'state.json', b)));
    return { bodies, failed: rr.filter((x) => x.status === 'rejected').map((x) => String(x.reason)).slice(0, 2) };
  }, diary);
  const got = fs.readFileSync(path.join(diary, '.polka', 'state.json'), 'utf8');
  ok(res.bodies.includes(got), 'одновременные записи state.json: файл целый (одна из версий)');
  ok(!res.failed.length, 'одновременные записи не падают: ' + JSON.stringify(res.failed));
  ok(!fs.readdirSync(path.join(diary, '.polka')).some((n) => /polka-tmp/.test(n)), 'временных файлов не осталось');

  // ---- сканирование: 3000 файлов, вложенность 15 уровней, петля из символьных ссылок
  const big = path.join(lib, 'много'); fs.mkdirSync(big);
  const small = fb2({ title: 'М', body: sec('Г', para(2)) });
  for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(big, 'книга ' + i + '.fb2'), small);
  let deep = lib; for (let i = 0; i < 15; i++) { deep = path.join(deep, 'ур' + i); fs.mkdirSync(deep); if (i === 10 || i === 14) fs.writeFileSync(path.join(deep, 'глубоко ' + i + '.fb2'), small); }
  fs.symlinkSync(lib, path.join(lib, 'петля')); fs.symlinkSync(path.join(lib, 'петля'), path.join(big, 'петля2'));
  let t = Date.now();
  const sc = await page.evaluate(async (lib) => { const r = await window.shelf.scan(lib); return { n: r.files.length, deep: r.files.filter((f) => /глубоко/.test(f.name)).map((f) => f.name) }; }, lib);
  const scanMs = Date.now() - t;
  ok(sc.n >= 3002 && sc.n <= 3003 && scanMs < 15000, 'сканирование 3000 книг + петля из ссылок: ' + sc.n + ' книг за ' + scanMs + ' мс, без зацикливания');
  console.log('     вложенность: найдены ' + JSON.stringify(sc.deep) + ' (глубже 12 уровней книги не ищутся — так задумано)');
  t = Date.now();
  await page.evaluate(() => window.__polka.scan());
  await page.waitForFunction(() => !window.__polka.L.scanning, null, { timeout: 300000 });
  ok(await page.evaluate(() => window.__polka.L.entries.length) >= 3002, 'библиотека на 3000 книг собрана за ' + (Date.now() - t) + ' мс');

  // ---- вторая копия: относительный путь к книге из своей рабочей папки
  const second = cp.spawn(require('electron'), ['--no-sandbox', '--user-data-dir=' + ud, appDir, 'Чужая книга.fb2'], { cwd: sub, stdio: 'ignore' });
  await new Promise((res2) => second.on('exit', res2));
  try { await page.waitForFunction(() => window.__polka.R.book && window.__polka.R.book.title === 'Открыта второй копией', null, { timeout: 10000 }); } catch (e) { /* проверим ниже */ }
  ok(await page.evaluate(() => !!window.__polka.R.book && window.__polka.R.book.title === 'Открыта второй копией'), 'вторая копия с относительным путём открывает книгу в первой');
  ok(!errs.length, 'нет ошибок в окне: ' + JSON.stringify(errs));
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'всё хорошо');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
