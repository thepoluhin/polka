// встроенный путеводитель в настоящем Electron: xvfb-run -a node test/e-guide.js <папка с книгами>
const { _electron: electron } = require('playwright'); const path = require('path'), fs = require('fs'), os = require('os');
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'polka-g-'));
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--user-data-dir=' + ud, path.resolve(__dirname, '../dist/app')] });
  const page = await app.firstWindow(); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.shelf.guideStat());
  const len = await page.evaluate(async () => (await window.shelf.guideRead()).byteLength);
  console.log(st && st.size === len && len > 1e6 ? 'ok   путеводитель читается из программы: ' + len + ' байт' : 'FAIL ' + JSON.stringify(st) + ' ' + len);
  const meta = await page.evaluate(async () => { const b = new Uint8Array(await window.shelf.guideRead()); const m = BookParser.meta('g.fb2', b); return m.title + ' / ' + (m.authors || []).join(','); });
  console.log((/Как здесь/.test(meta) ? 'ok   ' : 'FAIL ') + meta);
  await app.close();
})();
