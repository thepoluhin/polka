// листание «Поворот» / «Загиб» в настоящей программе: раскадровка
const { _electron: electron } = require('playwright');
const OUT = process.argv[3];
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', require('path').resolve(__dirname, '../dist/app'), process.argv[2]] });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.waitForFunction(() => window.__polka && window.__polka.R.book && !window.__polka.R.rendering, null, { timeout: 15000 });
  const sets = [['turn', 'auto', 'off', 'sepia'], ['turn', 'auto', 'sheet', 'sepia'], ['curl', 'auto', 'off', 'light'], ['curl', 'auto', 'sheet', 'night'], ['turn', 'auto', 'off', 'night']];
  for (const [flip, cols, focus, theme] of sets) {
    await win.evaluate(([f, c, fo, t]) => { const P = window.__polka; P.changeSetting('flip', f); P.changeSetting('cols', c); P.changeSetting('focus', fo); P.changeSetting('theme', t); P.goTo(1, { page: 1 }); }, [flip, cols, focus, theme]);
    await win.mouse.move(700, 450); await win.waitForTimeout(3500); // панель спряталась, снимок готов
    const ready = await win.evaluate(() => !!window.__flipReady && window.__flipReady());
    await win.keyboard.press('ArrowRight');
    const name = flip + '-' + (focus === 'sheet' ? 'sheet' : 'spread') + '-' + theme;
    for (const f of [0.2, 0.4, 0.6, 0.8]) { const on = await win.evaluate((f) => window.__flipSeek(f), f); await win.waitForTimeout(60); await win.screenshot({ path: OUT + '/' + name + '-' + Math.round(f * 100) + '.png' }); if (!on) console.log('нет анимации', name); }
    await win.evaluate(() => window.__flipSeek(1));
    await win.waitForTimeout(600);
    console.log(name, 'snapshot ready:', ready, 'page:', await win.evaluate(() => window.__polka.R.page), 'overlay left:', await win.evaluate(() => !!document.querySelector('.flip')));
  }
  // переход на следующую главу тоже листается
  await win.evaluate(() => { const P = window.__polka; P.changeSetting('flip', 'turn'); P.goTo(1, 'last'); });
  await win.waitForTimeout(3000);
  await win.keyboard.press('ArrowRight'); await win.waitForTimeout(150);
  console.log('глава → глава: анимация', await win.evaluate(() => window.__flipSeek(0.5)), 'глава', await win.evaluate(() => window.__polka.R.ch));
  await win.screenshot({ path: OUT + '/chapter-turn.png' });
  await win.evaluate(() => window.__flipSeek(1));
  // быстрое листание: анимация на каждом листе
  await win.evaluate(() => { const P = window.__polka; P.changeSetting('flip', 'turn'); P.changeSetting('focus', 'off'); P.goTo(2, { page: 0 }); });
  await win.waitForTimeout(1500);
  const hits = [];
  for (let i = 0; i < 6; i++) { await win.keyboard.press('ArrowRight'); await win.waitForTimeout(40); hits.push(await win.evaluate(() => window.__flipActive() + ':' + window.__polka.R.ch + '/' + window.__polka.R.page + '/' + window.__flipReady())); await win.waitForTimeout(140); }
  console.log('быстрое листание, анимация на каждом листе:', hits.join(' '));
  // быстрое листание подряд не ломает страницу
  for (let i = 0; i < 8; i++) { await win.keyboard.press('ArrowRight'); await win.waitForTimeout(60); }
  await win.waitForTimeout(1200);
  console.log('после быстрого листания overlay:', await win.evaluate(() => document.querySelectorAll('.flip').length), 'страница', await win.evaluate(() => window.__polka.R.page));
  console.log('errors:', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
