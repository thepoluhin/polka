// Кадры встроенного путеводителя: npm run build; node test/guide-shots.js [папка вывода]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'src/guide/img'));
const app = pathToFileURL(path.join(root, 'dist/app/index.html')).href;
const books = new Map();
const day = 24 * 60 * 60 * 1000;

const paragraphs = [
  'Утром Анна открыла окно и услышала, как под берегом идёт вода. Ночью прошёл дождь, и доски на крыльце стали темнее. В кухне ещё горела лампа.',
  'На подоконнике лежало письмо. Анна прочитала первую строчку и остановилась. Ей хотелось сначала вспомнить голос, которым эти слова были бы сказаны.',
  'Из-за поворота показалась лодка. Старик у вёсел не спешил и оглядывался на берег, словно проверял, на месте ли дома. Анна помахала ему ладонью.',
  'Ветер двигал занавеску. Письмо стало чуть слышно шуршать, и Анна прижала его чашкой. Потом она вышла к реке и просто постояла у воды.',
  'Чем дольше Анна смотрела на противоположный берег, тем яснее вспоминала прошлое лето. Тогда на пристани ещё стояли зелёные скамейки, а за ними рос высокий шиповник.',
  'Во дворе кто-то негромко закрыл калитку. Анна различила знакомые шаги, но не обернулась. Ей казалось, что ещё немного тишины ничего у них не отнимет.',
];
const opening = 'В этой истории берег встречается с городом, и оба они меняются после дождя.';
const river = '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info>' +
  '<author><first-name>Анна</first-name><last-name>Северова</last-name></author><book-title>Дом у реки</book-title>' +
  '<annotation><p>' + opening + '</p></annotation><sequence name="Речные истории" number="1"/><lang>ru</lang>' +
  '</title-info><publish-info><publisher>Пример издательства</publisher><year>2020</year></publish-info></description><body>' +
  ['Письмо', 'Берег', 'Свет в окне'].map((title, index) =>
    '<section><title><p>Глава ' + (index + 1) + '. ' + title + '</p></title>' +
    Array.from({ length: 4 }, () => paragraphs.map(p => '<p>' + p + '</p>').join('')).join('') + '</section>'
  ).join('') + '</body></FictionBook>';
books.set('/demo/Северова - Дом у реки.fb2', Buffer.from(river));
for (const source of ['Morgan - The Lighthouse Keeper.epub', 'Классика/Ильин - Зимние письма.fb2.zip']) {
  books.set('/demo/' + source, fs.readFileSync(path.join(root, 'testbooks', source)));
}

async function setup(page) {
  await page.exposeFunction('guideDemoScan', () => [...books].map(([filename, bytes]) => ({
    path: filename, name: path.basename(filename), size: bytes.length, mtime: 1,
  })));
  await page.exposeFunction('guideDemoRead', (name) => books.get(name).toString('base64'));
  await page.addInitScript(() => {
    localStorage.setItem('polka.folder', JSON.stringify('/demo'));
    localStorage.setItem('polka.helpHinted', 'true');
    window.shelf = {
      scan: () => window.guideDemoScan(),
      read: async (name) => Uint8Array.from(atob(await window.guideDemoRead(name)), (c) => c.charCodeAt(0)),
      initialFile: async () => null, initialUrl: async () => null, onOpenFile() {}, onOpenUrl() {},
      setTheme() {}, diaryDir: async () => ({ dir: null }), padClipboardWrite: async ({ image }) => image?.length > 24, saveQuotePng: async ({ bytes }) => bytes?.length > 24,
    };
  });
  await page.goto(app);
  await ready(page);
  await page.evaluate(({ paragraphs, day }) => {
    const { L, S } = window.__polka;
    const house = L.entries.find(e => e.name.includes('Северова')).id;
    const letters = L.entries.find(e => e.name.includes('Ильин')).id;
    const lighthouse = L.entries.find(e => e.name.includes('Morgan')).id;
    const now = Date.now();
    const quotes = {
      [house]: [
        { id: 'window', ch: 1, off: 0, len: paragraphs[0].length, text: paragraphs[0], pct: .06, tags: ['начало'], note: 'Вода, доски, лампа — по этим деталям запоминается место.', t: now - 9 * day },
        { id: 'letter', ch: 1, off: 160, len: paragraphs[1].length, text: paragraphs[1], pct: .12, tags: ['перечитать'], t: now - 5 * day },
        { id: 'silence', ch: 2, off: 510, len: 97, text: 'Ей казалось, что ещё немного тишины ничего у них не отнимет.', pct: .36, tags: ['тишина'], note: 'Сравнить с последней главой.', t: now - 3 * day },
      ],
    };
    const date = new Date();
    localStorage.setItem('polka.remember', JSON.stringify({
      day: [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-'),
      keys: [house + '#window', house + '#letter'],
    }));
    localStorage.setItem('polka.settings', JSON.stringify({ ...S, theme: 'night', sound: 'off', cols: 'auto', focus: 'off', flip: 'curl' }));
    localStorage.setItem('polka.quotes', JSON.stringify(quotes));
    localStorage.setItem('polka.progress', JSON.stringify({
      [house]: { ch: 1, off: 480, pct: .14, t: now, chap: 'Глава 1. Письмо', snip: paragraphs[1] },
      [letters]: { ch: 1, off: 65, pct: .08, t: now - day, chap: 'Глава 1', snip: 'Сначала Анна разобрала имя на конверте, потом заметила знакомый почерк.' },
    }));
    localStorage.setItem('polka.shelves', JSON.stringify([{ id: 'evening', name: 'На вечер', books: [house, lighthouse] }]));
    localStorage.setItem('polka.bookNotes', JSON.stringify({ [house]: { body: 'Перечитать главу о письме, когда захочется тишины.', t: now } }));
    localStorage.setItem('polka.pads', JSON.stringify({
      [house]: { pages: [
        'Письмо на подоконнике\n\nАнна прочитала первую строчку. Ей важно вспомнить голос, прежде чем дочитать письмо.',
        'Кого встретили у реки\n\nАнна — у дома. Старик в лодке — возвращается к пристани.\n\nСравнить сцену с последней главой.',
        'Что перечитать\n\nПисьмо на подоконнике и разговор у лодки.',
      ], t: now, title: 'Дом у реки', author: 'Анна Северова' },
      [letters]: { pages: ['Перечитать зимний разговор у окна.'], t: now - day, title: 'Зимние письма', author: 'Пётр Ильин' },
    }));
    localStorage.setItem('polka.padOptions', JSON.stringify({
      [house]: { paper: 'sand', font: 'hand', ink: 'burgundy', rule: 'lines', navigation: 'pages', numbers: true, size: 16 },
      [letters]: { paper: 'sage', rule: 'dots' },
    }));
  }, { paragraphs, day });
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    const { L } = window.__polka;
    const entry = L.entries.find(e => e.name.includes('Северова'));
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ead3ad'; ctx.fillRect(0, 0, 320, 480);
    ctx.strokeStyle = '#744c37'; ctx.lineWidth = 3; ctx.strokeRect(19, 19, 282, 442);
    ctx.fillStyle = '#744c37'; ctx.textAlign = 'center';
    ctx.font = '20px Georgia'; ctx.fillText('Анна Северова', 160, 67);
    ctx.font = 'bold 32px Georgia'; ctx.fillText('Дом у реки', 160, 408);
    ctx.fillStyle = '#7c8c79';
    ctx.beginPath(); ctx.moveTo(44, 279); ctx.quadraticCurveTo(115, 170, 174, 264); ctx.quadraticCurveTo(230, 212, 278, 264); ctx.lineTo(278, 340); ctx.lineTo(44, 340); ctx.fill();
    ctx.fillStyle = '#526a68';
    ctx.beginPath(); ctx.moveTo(133, 263); ctx.bezierCurveTo(242, 265, 99, 320, 66, 343); ctx.lineTo(174, 343); ctx.bezierCurveTo(238, 293, 271, 265, 186, 254); ctx.fill();
    ctx.fillStyle = '#744c37'; ctx.fillRect(76, 209, 53, 44);
    ctx.beginPath(); ctx.moveTo(65, 213); ctx.lineTo(105, 180); ctx.lineTo(143, 213); ctx.fill();
    ctx.fillStyle = '#ead3ad'; ctx.fillRect(94, 222, 12, 17);
    L.metas[entry.id].cover = canvas.toDataURL();
  });
}

function ready(page) {
  return page.waitForFunction(() => {
    const library = window.__polka?.L;
    return library && !library.scanning && library.entries.length === 3 && library.entries.every(e => library.metas[e.id]);
  });
}

async function openRiver(page, settings = {}) {
  await page.evaluate(async (settings) => {
    const polka = window.__polka;
    for (const [key, value] of Object.entries(settings)) await polka.changeSetting(key, value);
    const river = polka.L.entries.find(e => e.name.includes('Северова'));
    if (!polka.R.book || polka.R.entry?.id !== river.id) await polka.openEntry(river);
    await polka.goTo(1, { page: 0 });
  }, settings);
  await page.locator('#flow p').first().waitFor();
}

async function selectExcerpt(page) {
  await page.evaluate(() => {
    const p = document.querySelectorAll('#flow section > p')[2];
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('#sel-bar').waitFor();
}

async function insertIllustration(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e8dabd';
    ctx.fillRect(0, 0, 320, 180);
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a9b9c';
    ctx.beginPath(); ctx.moveTo(-20, 152); ctx.bezierCurveTo(74, 160, 122, 51, 202, 67); ctx.quadraticCurveTo(260, 96, 344, 30); ctx.stroke();
    ctx.strokeStyle = '#927f62';
    ctx.lineWidth = 2;
    ctx.strokeRect(146, 128, 30, 26);
    ctx.beginPath(); ctx.moveTo(139, 130); ctx.lineTo(160, 113); ctx.lineTo(182, 130); ctx.stroke();
    ctx.font = '17px Georgia';
    ctx.fillStyle = '#514939';
    ctx.fillText('Дом', 190, 149);
    ctx.fillText('Река', 227, 74);
    const editor = window.__pad.editor();
    editor.ta.setSelectionRange(editor.ta.value.length, editor.ta.value.length);
    await editor.insertImage(await new Promise(resolve => canvas.toBlob(resolve)), editor.ta);
  });
  await page.waitForFunction(() => document.querySelector('#pad-sheet .pad-image img')?.naturalWidth === 320);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const shot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, name + '.jpg'), type: 'jpeg', quality: 90, animations: 'disabled', caret: 'hide' });
      console.log(name);
    };

    await setup(page);
    await page.locator('.sh-tab[data-shelf="reading"]').click();
    await page.locator('.rm-card').nth(1).waitFor();
    await shot('01b-opisanie');
    await page.locator('#lib-tabs [data-view="notebook"]').click();
    await page.locator('.nb-card').nth(2).waitFor();
    await shot('07-zapisnaya-knizhka');
    await page.locator('#lib-tabs [data-view="pads"]').click();
    await page.locator('.padc').nth(1).waitFor();
    await shot('12c-katalog-bloknotov');

    await openRiver(page, { theme: 'sepia', cols: '2' });
    await page.keyboard.press('KeyT');
    await page.locator('#drawer-tabs [data-tab="impression"]').click();
    await page.locator('#n-list .bn-card').nth(1).waitFor();
    await shot('02b-o-knige');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__pad.open());
    await page.mouse.move(850, 16);
    await page.locator('#btn-settings').click();
    await page.locator('#set-tabs [data-tab="read"]').click();
    await shot('08b-aa-chtenie');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__pad.close());

    await openRiver(page, { theme: 'dusk', focus: 'sent' });
    await page.keyboard.press('ArrowDown');
    await shot('06-fokus-predlozhenie');
    await openRiver(page, { theme: 'sepia', focus: 'off', cols: '1' });
    await selectExcerpt(page);
    await shot('05-vydelenie');
    await page.locator('#sel-bar [data-act="quote"]').click();
    await page.locator('#quote-pop').waitFor();
    await page.locator('#qp-addthought').click();
    await page.locator('#qp-body').fill('Отметить, как меняется тишина перед разговором.');
    await shot('05-citata');
    await page.locator('#qp-export').click();
    await page.getByText('Карточка сохранена', { exact: true }).waitFor();
    await shot('05-delyatsya');
    await page.locator('#qp-close').click();

    await openRiver(page, { theme: 'night', cols: 'auto' });
    await page.evaluate(() => window.__pad.open());
    const previousSheet = page.locator('#pad-sheet .pf-prev');
    for (let pageIndex = 0; pageIndex < 2 && await previousSheet.isEnabled(); pageIndex++) await previousSheet.click();
    await insertIllustration(page);
    await shot('12-bloknot');
    await page.mouse.move(840, 14);
    await page.locator('#btn-settings').click();
    await page.locator('#set-tabs [data-tab="pad"]').click();
    await page.getByText('Оставлять блокнот открытым', { exact: true }).click();
    await shot('12b-aa-bloknot');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__pad.close());
    await page.mouse.move(34, 18);
    await page.locator('#btn-back').click();
    await page.locator('#lib-tabs [data-view="pads"]').click();
    await page.getByRole('button', { name: /Дом у реки/ }).click();
    await page.waitForFunction(() => document.querySelector('.pad-cover-leaf img')?.naturalWidth > 0);
    await shot('12d-razvorot-bloknota');

    await openRiver(page, { theme: 'sepia', cols: '1', flip: 'off' });
    await page.waitForFunction(() => !window.__polka.R.rendering && window.__polka.R.geo?.cols === 1);
    await page.evaluate(async () => {
      const polka = window.__polka;
      const { R } = polka;
      await polka.goTo(R.book.chapters.length - 1, 'last');
      for (let index = 0, limit = R.pages + 1; index < limit && !R.endShown; index++) await polka.next();
    });
    await page.locator('#book-end').waitFor();
    await shot('09-kniga-prochitana');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
