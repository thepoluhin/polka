const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const first = 'Текст с выделением и продолжением.';
const second = 'Следующий абзац начинается с новой строки.';
const long = 'Длинная цитата. '.repeat(140).trim();
const book = `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description><title-info><author><first-name>Анна</first-name><last-name>Авторова</last-name></author>
<book-title>Книга для проверки</book-title><lang>ru</lang></title-info></description>
<body><section><p>Текст с <emphasis>выделением</emphasis> и продолжением.</p><p>${second}</p><p>${long}</p></section></body>
</FictionBook>`;
const file = pathToFileURL(path.join(__dirname, '../dist/Полка.html')).href;

async function openBook(page) {
  await page.evaluate(async (book) => {
    const file = new File([book], 'test.fb2');
    await window.__polka.openEntry({ file, name: file.name, id: 'quote-card-test' }, { ch: 1, off: 0 });
    const render = window.PolkaQuoteCard.render;
    window.PolkaQuoteCard.render = (data) => {
      window.lastQuoteCard = data;
      return render(data);
    };
  }, book);
}

async function selectText(page, lastParagraph) {
  await page.evaluate((lastParagraph) => {
    const [first, second, long] = document.querySelectorAll('#flow section p');
    const range = document.createRange();
    range.setStart(lastParagraph === 2 ? long.firstChild : first.firstChild, 0);
    const end = [first, second, long][lastParagraph].lastChild;
    range.setEnd(end, end.nodeValue.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.getElementById('flow').dispatchEvent(new MouseEvent('mouseup'));
  }, lastParagraph);
  await page.locator('#sel-bar').waitFor({ state: 'visible' });
}

async function select(page, lastParagraph, action) {
  await selectText(page, lastParagraph);
  await page.locator(`#sel-bar [data-act="${action}"]`).click();
}

async function copyQuote(page, selector = '#quote-pop', status = '#qp-notice', keyboard = false, checkLayout = false) {
  await page.evaluate(() => { window.copiedQuote = null; });
  const share = page.locator(selector).getByRole('button', { name: 'Поделиться', exact: true });
  if (keyboard) await share.press('Space');
  else await share.click();
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Карточка скопирована в буфер', status);
  assert.equal(await page.locator(selector + ' [data-share]').count(), 0);
  const png = Buffer.from(await page.evaluate(() => window.copiedQuote));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  if (checkLayout) {
    const [top, bottom] = await page.evaluate(async (pngData) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + pngData;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data, width, height } = ctx.getImageData(110, 204, 866, 450);
      let first = Infinity, last = -Infinity;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (data[i] === 57 && data[i + 1] === 44 && data[i + 2] === 32) {
            first = Math.min(first, 204 + y);
            last = 204 + y;
            break;
          }
        }
      }
      return [first, last];
    }, png.toString('base64'));
    assert.ok(top >= 226 && bottom <= 632, `Quote exceeds vertical bounds: ${top}…${bottom}`);
    assert.ok(Math.abs((top + bottom) / 2 - 429) <= 7, `Quote is not centered: ${top}…${bottom}`);
  }
  return page.evaluate(() => ({ ...window.lastQuoteCard, text: window.lastQuoteCard.text.replace(/\u00a0/g, ' ') }));
}

function storedEntries(page) {
  return page.evaluate(() => ['polka.quotes', 'polka.notes'].map((key) => localStorage.getItem(key)));
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: {
        async write(items) {
          const png = await items[0].getType('image/png');
          window.copiedQuote = Array.from(new Uint8Array(await png.arrayBuffer()));
        },
      } });
    });
    await page.goto(file);
    await openBook(page);
    const expected = { text: `${first}\n${second}`, title: 'Книга для проверки', author: 'Анна Авторова', cover: null };
    const entries = await storedEntries(page);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.waitForFunction(() => window.__polka.R.geo.W === 360);
    await selectText(page, 1);
    const firstAction = await page.locator('#sel-bar [data-act="translate"]').boundingBox();
    const finalAction = await page.locator('#sel-bar [data-act="share"]').boundingBox();
    assert.ok(firstAction && finalAction, 'Both actions are visible on a narrow viewport');
    assert.ok(finalAction.x >= 0 && finalAction.x + finalAction.width <= 360, 'Share stays inside the viewport');
    assert.deepEqual(await copyQuote(page, '#sel-bar', '#sel-status'), expected);
    assert.deepEqual(await storedEntries(page), entries);
    assert.deepEqual(await copyQuote(page, '#sel-bar', '#sel-status', true, true), expected);
    assert.ok(await page.locator('#quote-pop').isHidden());
    assert.deepEqual(await storedEntries(page), entries);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForFunction(() => window.__polka.R.geo.W === 1400);
    await select(page, 1, 'quote');
    await page.setViewportSize({ width: 420, height: 900 });
    const shareBounds = await page.getByRole('button', { name: 'Поделиться', exact: true }).boundingBox();
    assert.ok(shareBounds && shareBounds.x >= 0 && shareBounds.x + shareBounds.width <= 420);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.locator('#qp-addthought').click();
    await page.waitForFunction(() => document.activeElement === document.getElementById('qp-body'));
    await page.locator('#qp-body').fill('Личная мысль');
    await page.locator('#qp-tag-input').fill('личное');
    await page.locator('#qp-tag-input').press('Enter');
    assert.deepEqual(await copyQuote(page), expected);
    assert.equal(await page.locator('#qp-body').inputValue(), 'Личная мысль');
    await page.locator('#qp-save').click();
    await page.waitForFunction(() => document.getElementById('qp-status').textContent.startsWith('Сохранено'));
    assert.deepEqual(await copyQuote(page), expected);

    await page.evaluate(() => {
      const quotes = JSON.parse(localStorage.getItem('polka.quotes'));
      quotes['quote-card-test'][0].text = 'Текст изменили в дневнике';
      localStorage.setItem('polka.quotes', JSON.stringify(quotes));
    });
    await page.reload();
    await openBook(page);
    await select(page, 1, 'quote');
    assert.equal(await page.locator('#qp-text').textContent(), 'Текст изменили в дневнике');
    assert.deepEqual(await copyQuote(page), expected);

    await page.locator('#qp-close').click();
    assert.equal(await page.locator('#sel-bar [data-act="note"]').count(), 0);
    await select(page, 0, 'quote');
    assert.deepEqual(await copyQuote(page), { ...expected, text: first });
    await page.locator('#qp-cancel').click();
    await select(page, 2, 'quote');
    await page.locator('#qp-export').click();
    await page.waitForFunction(() => document.getElementById('qp-notice').textContent.includes('Цитата слишком длинная'));
    assert.ok(await page.locator('#toast').isHidden());
    await page.locator('#qp-cancel').click();
    await select(page, 2, 'share');
    await page.waitForFunction(() => document.getElementById('sel-status').textContent.includes('Цитата слишком длинная'));
    assert.ok(await page.locator('#quote-pop').isHidden());
    const longMetadata = await page.evaluate(async () => {
      const lines = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (str, x, ...rest) {
        if (x === 412) lines.push(str);
        return fillText.call(this, str, x, ...rest);
      };
      try {
        const blob = await window.PolkaQuoteCard.render({
          text: 'Цитата для проверки',
          title: 'Очень длинное название книги '.repeat(20),
          author: 'Имя Фамилия, '.repeat(30),
          cover: null,
        });
        return { type: blob.type, truncatedLines: lines.filter((line) => line.endsWith('…')).length };
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fillText;
      }
    });
    assert.deepEqual(longMetadata, { type: 'image/png', truncatedLines: 2 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

run().then(() => console.log('Quote card regressions passed')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
