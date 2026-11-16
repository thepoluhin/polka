const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
const PROF = process.argv[2], BOOKS = path.resolve(__dirname, '../testbooks');
const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--user-data-dir=' + PROF, path.resolve(__dirname, '../dist/app')] });
(async () => {
  // «старая версия»: в профиле только localStorage с выбранной папкой, файла разрешений нет
  let app = await launch(); let win = await app.firstWindow();
  await win.waitForFunction(() => window.__polka);
  await win.evaluate((d) => { localStorage.setItem('polka.folder', JSON.stringify(d)); localStorage.setItem('polka.progress', JSON.stringify({ x: { ch: 1, off: 5, pct: 0.1, t: 1 } })); }, BOOKS);
  await app.close();
  fs.rmSync(path.join(PROF, 'allowed.json'), { force: true });
  // «новая версия»
  app = await launch(); win = await app.firstWindow();
  await win.waitForFunction(() => window.__polka && !window.__polka.L.scanning && window.__polka.L.entries.length > 0, null, { timeout: 15000 }).catch(() => {});
  console.log('книг в библиотеке после обновления:', await win.evaluate(() => window.__polka.L.entries.length), '| разрешено:', JSON.parse(fs.readFileSync(path.join(PROF, 'allowed.json'), 'utf8')).roots.map((r) => path.basename(r)).join(','));
  await win.click('.book-card'); await win.waitForFunction(() => window.__polka.R.book && !window.__polka.R.rendering, null, { timeout: 15000 });
  console.log('книга открывается:', await win.evaluate(() => window.__polka.R.book.title));
  await app.close();
  // третий запуск: разрешения уже есть, «подсунуть» новую папку через bootstrap нельзя
  app = await launch(); win = await app.firstWindow();
  await win.waitForFunction(() => window.__polka);
  console.log('повторный bootstrap:', await win.evaluate(() => window.shelf.bootstrap({ folder: '/' })));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
