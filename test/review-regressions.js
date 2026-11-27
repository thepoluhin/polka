const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const fixture = fs.readFileSync(path.join(__dirname, '../testbooks/Северова - Дом у реки.fb2'));
    const different = Buffer.from(fixture);
    different[different.length - 1] ^= 1;
    const books = new Map([
      ['/books/a/book.fb2', fixture],
      ['/books/b/book.fb2', different],
      ['/books/old.fb2', fixture.subarray(0, -2)],
    ]);
    const oldId = 'old.fb2|' + books.get('/books/old.fb2').length;
    const ambiguousId = 'book.fb2|' + fixture.length;
    const note = '/diary/Книги/Дом у реки.md';
    const original = '---\npolka: "polka://open?book=' + encodeURIComponent(oldId) +
      '"\n---\n\n# Дом у реки\n\n## Блокнот\n\nПервая строка\n## Персонажи\nАнна\n';
    const notes = new Map([[note, original]]);
    let denyRead = false;
    let denyWrite = false;
    await page.exposeFunction('scanBooks', () => [...books].map(([p, data]) => ({
      path: p, name: path.posix.basename(p), size: data.length, mtime: 1,
    })));
    await page.exposeFunction('readBook', (p) => books.get(p).toString('base64'));
    await page.exposeFunction('readNote', (p) => {
      if (p === note && denyRead) throw new Error('EACCES');
      return notes.get(p) ?? null;
    });
    await page.exposeFunction('writeNote', (p, value) => {
      if (denyWrite) throw new Error('EACCES');
      notes.set(p, value);
      return true;
    });
    await page.exposeFunction('createNote', (p, value) => {
      if (!notes.has(p)) notes.set(p, value);
      return p;
    });
    await page.addInitScript(({ oldId, ambiguousId }) => {
      localStorage.setItem('polka.folder', JSON.stringify('/books'));
      localStorage.setItem('polka.progress', JSON.stringify({
        [oldId]: { ch: 0, off: 10, t: 5 }, [ambiguousId]: { ch: 0, off: 20, t: 5 },
      }));
      const resolve = ({ dir, sub, name }) => [dir, ...sub, name + '.md'].join('/');
      let notebookClipboard = {};
      window.shelf = {
        scan: () => window.scanBooks(),
        read: async (p) => Uint8Array.from(atob(await window.readBook(p)), (b) => b.charCodeAt(0)),
        initialFile: async () => null,
        onOpenFile() {}, setTheme() {},
        padClipboardRead: async () => notebookClipboard,
        padClipboardWrite: async (data) => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          notebookClipboard = data;
        },
        netGet: async (url) => url.startsWith('https://translate.googleapis.com/')
          ? { ok: true, text: JSON.stringify({ src: 'en', sentences: [{ trans: 'Проверенный перевод' }] }) }
          : { ok: false, status: 503 },
        diaryDir: async () => ({ dir: '/diary' }),
        quotesDefaultDir: async () => '/diary',
        noteResolve: async (opts) => resolve(opts),
        noteCreate: (opts) => window.createNote(resolve(opts), opts.content),
        noteRead: (p) => window.readNote(p),
        noteWrite: (p, value) => window.writeNote(p, value),
      };
    }, { oldId, ambiguousId });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../dist/app/index.html')).href);
    await page.waitForFunction(() => window.__polka?.L.entries.length === 3 && !window.__polka.L.scanning);
    const cover = await page.evaluate(() => {
      const encoded = new TextEncoder().encode(
        '<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info>' +
        '<book-title>Обложка</book-title><coverpage><image l:href="#cover&amp;v2"/></coverpage>' +
        '</title-info><publish-info><publisher>Тестовое издательство</publisher><year>2001</year><isbn>978-5-00000-000-0</isbn></publish-info>' +
        '</description><BINARY id = "cover&amp;v2" content-type = "image/png">AQID</BINARY></FictionBook>'
      );
      const meta = window.BookParser.meta('cover.fb2', encoded);
      return [meta.coverType, Array.from(meta.coverBytes || []), meta.publication];
    });
    assert.deepEqual(cover, ['image/png', [1, 2, 3], { publisher: 'Тестовое издательство', year: '2001', isbn: '978-5-00000-000-0' }]);
    const catalog = () => page.evaluate(() => Object.fromEntries(window.__polka.L.entries.map((e) => [e.path, e.id])));
    const ids = await catalog();
    const id = ids['/books/old.fb2'];
    assert.notEqual(ids['/books/a/book.fb2'], ids['/books/b/book.fb2']);
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('polka.progress')));
    assert.equal(progress[id].off, 10);
    assert.equal(progress[ambiguousId].off, 20);
    assert.equal(progress[ids['/books/a/book.fb2']], undefined);
    assert.equal(progress[ids['/books/b/book.fb2']], undefined);
    books.set('/books/renamed.fb2', books.get('/books/old.fb2'));
    books.delete('/books/old.fb2');
    await page.evaluate(() => window.__polka.scan());
    assert.equal((await catalog())['/books/renamed.fb2'], id);
    await page.evaluate((id) => {
      const app = window.__polka;
      return app.openEntry(app.L.entries.find((e) => e.id === id));
    }, id);
    await page.waitForFunction((id) => {
      const pad = JSON.parse(localStorage.getItem('polka.pads') || '{}')[id];
      return pad?.pages.join('\n').includes('## Персонажи\nАнна');
    }, id);

    // Оба состояния используют один обработчик записи впечатления.
    const saveThought = (text) => page.evaluate(async (body) => {
      document.getElementById('be-ta').value = body;
      await document.getElementById('be-save').onclick();
      return document.getElementById('toast').textContent;
    }, text);
    denyRead = true;
    assert.match(await saveThought('Новая запись'), /Не удалось обновить файл дневника/);
    assert.equal(notes.get(note), original);
    denyRead = false;
    denyWrite = true;
    assert.match(await saveThought('Новая запись'), /Не удалось обновить файл дневника/);
    assert.equal(notes.get(note), original);
    denyWrite = false;
    assert.match(await saveThought('Новая запись'), /Сохранено в дневник/);
    assert.equal(notes.get(note).split('Новая запись').length, 2);
    assert.match(notes.get(note), /## Персонажи\nАнна/);

    await page.evaluate(async () => {
      await window.__pad.open();
      const input = document.querySelector('.pad-ta');
      input.value = 'Первая строка\n## Персонажи\nАнна и Борис';
      input.dispatchEvent(new Event('input'));
      window.__pad.close();
    });
    for (let i = 0; i < 100 && !notes.get(note).includes('polka:pad-end'); i++) await delay(50);
    assert.match(notes.get(note), /polka:pad-end/);
    assert.match(notes.get(note), /## Персонажи\nАнна и Борис/);
    assert.equal(notes.get(note).split('## Персонажи').length, 2);

    const beforeQuote = notes.get(note);
    denyRead = true;
    await page.evaluate(async () => {
      await window.__polka.goTo(1, { page: 0 });
      const flow = document.getElementById('flow');
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walker.nextNode())) {
        if (text.length < 18) continue;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 18);
        const rect = range.getBoundingClientRect();
        if (!rect.width || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) continue;
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.querySelector('#sel-bar [data-act="quote"]').click();
        await document.getElementById('qp-save').onclick();
        return;
      }
      throw new Error('No visible text to quote');
    });
    assert.equal(notes.get(note), beforeQuote);
    assert.match(await page.locator('#qp-status').textContent(), /в дневник не записано/);
    denyRead = false;
    await page.reload();
    await page.waitForFunction(() => window.__polka?.L.entries.length === 3 && !window.__polka.L.scanning);
    await page.evaluate((id) => {
      const app = window.__polka;
      return app.openEntry(app.L.entries.find((e) => e.id === id));
    }, id);
    for (let i = 0; i < 100 && !notes.get(note).includes('[!quote]'); i++) await delay(50);
    assert.equal((notes.get(note).match(/\[!quote\]/g) || []).length, 1);
    assert.match(notes.get(note), /Новая запись/);
    assert.match(notes.get(note), /## Персонажи\nАнна и Борис/);

    const savedPosition = () => page.evaluate((id) => JSON.parse(localStorage.getItem('polka.progress'))[id], id);
    const visiblePosition = () => page.evaluate(() => ({ ch: window.__polka.R.ch, off: window.__polka.R.off }));
    const returnPosition = { ch: 2, off: 240 };
    await page.evaluate(({ ch, off }) => window.__polka.goTo(ch, { off, keepOff: true }), returnPosition);
    await page.keyboard.press('Escape');
    const beforePreview = await savedPosition();
    assert.deepEqual({ ch: beforePreview.ch, off: beforePreview.off }, returnPosition);

    // Открытие записи через вкладку на главной, как при обычном использовании.
    await page.locator('#lib-tabs [data-view="notebook"]').click();
    const quoteCard = page.locator('[data-nbi]').first();
    await quoteCard.click();
    await page.waitForFunction(() => window.__polka.R.ch === 1 && !window.__polka.R.rendering);
    const backToLibrary = page.getByRole('button', { name: '← Вернуться на главную' });
    await backToLibrary.waitFor();
    await delay(500);
    assert.equal(await page.locator('.flash-mark').count(), 0);
    assert.equal(await page.evaluate(() => [...CSS.highlights].some(([name, ranges]) => name.startsWith('quote') && ranges.size > 0)), true);
    assert.deepEqual(await savedPosition(), beforePreview);
    await backToLibrary.click();
    await quoteCard.waitFor();
    assert.deepEqual(await savedPosition(), beforePreview);

    // Если закрыть книгу прямо на цитате, обычное открытие всё равно ведёт к месту чтения.
    await quoteCard.click();
    await page.waitForFunction(() => window.__polka.R.ch === 1 && !window.__polka.R.rendering);
    await page.keyboard.press('Escape');
    assert.deepEqual({ ch: (await savedPosition()).ch, off: (await savedPosition()).off }, returnPosition);
    await page.locator('#lib-tabs [data-view="books"]').click();
    const readingCard = page.locator('#grid .hb');
    await readingCard.waitFor();
    for (const [tab, section] of [['pads', '#pads'], ['notebook', '#notebook']]) {
      await page.locator('#lib-tabs [data-view="' + tab + '"]').click();
      assert.ok(await page.locator(section).isVisible());
      assert.ok(await page.locator('#shelves').isHidden());
      await page.locator('#lib-tabs [data-view="books"]').click();
      assert.ok(await page.locator(section).isHidden(), tab + ' remains on the Books tab');
      assert.ok(await readingCard.isVisible());
    }
    for (const region of ['.hb-t', '.hb-a', '.hb-sec', '.hb-cover']) {
      await readingCard.locator(region).click();
      assert.equal(await page.evaluate(() => window.__polka.R.opening || !!window.__polka.R.book), false);
    }
    await readingCard.getByRole('button', { name: /^Продолжить/ }).press('Enter');
    await page.waitForFunction(() => window.__polka.R.book && !window.__polka.R.opening);
    assert.deepEqual(await visiblePosition(), returnPosition);

    // Из списка цитат в книге возвращаемся к странице, с которой открыли список.
    await page.keyboard.press('KeyT');
    await page.locator('#drawer-tabs [data-tab="quotes"]').click();
    await page.locator('#q-list [data-qid]').first().click();
    await page.waitForFunction(() => window.__polka.R.ch === 1 && !window.__polka.R.rendering);
    const backToReading = page.getByRole('button', { name: '← Вернуться к чтению' });
    await backToReading.waitFor();
    await delay(500);
    const previewPosition = await savedPosition();
    assert.deepEqual({ ch: previewPosition.ch, off: previewPosition.off }, returnPosition);
    await backToReading.click();
    await page.waitForFunction(() => !document.getElementById('back-pill'));
    assert.deepEqual(await visiblePosition(), returnPosition);

    await page.evaluate((id) => window.__polka.openLink('polka://open?book=' + id + '&ch=2&off=240&len=18'), id);
    assert.ok(await page.locator('.flash-mark').count(), 'An unmarked destination still gets a temporary highlight');
    await page.evaluate(() => {
      const app = window.__polka;
      app.S.cols = 1;
      app.S.flip = 'turn';
      const chapters = app.R.book.chapters;
      chapters[1].html += '<img class="review-decode">';
      delete chapters[1].typo;
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (!this.classList.contains('review-decode')) return original.call(this);
        return new Promise((resolve) => { window.releaseChapterImage = resolve; });
      };
    });
    await page.evaluate(() => window.__polka.goTo(0, { page: Number.MAX_SAFE_INTEGER }));
    await page.evaluate(() => { window.chapterTurn = window.__polka.next(); });
    await page.waitForFunction(() => window.releaseChapterImage && window.__polka.R.rendering);
    assert.ok(await page.locator('.flip-slot.on .fs-vp').first().textContent(), 'The turning leaf keeps the previous chapter');
    await page.evaluate(async () => {
      const app = window.__polka;
      await app.goTo(2, { off: 12, keepOff: true });
      window.releaseChapterImage();
      await window.chapterTurn;
    });
    assert.deepEqual(await visiblePosition(), { ch: 2, off: 12 });
    assert.equal(await page.locator('.flip-slot.on').count(), 0);

    await page.evaluate(() => {
      window.releaseChapterImage = null;
      window.cancelledRender = window.__polka.goTo(1, { page: 0 });
    });
    await page.waitForFunction(() => window.releaseChapterImage && window.__polka.R.rendering);
    await page.evaluate(async () => {
      document.getElementById('btn-back').click();
      window.releaseChapterImage();
      await window.cancelledRender;
    });
    assert.equal(await page.evaluate(() => window.__polka.R.book), null);
    assert.equal(await page.locator('#flow').textContent(), '');

    await page.evaluate(async (id) => {
      const app = window.__polka;
      const entry = app.L.entries.find((item) => item.id === id);
      await app.openEntry(entry);
      localStorage.setItem('polka.pads', JSON.stringify({
        broken: { pages: [null] },
        [id]: { pages: ['Первый лист', 'Второй лист', ''] },
      }));
      await window.__pad.open();
    }, id);
    await page.locator('#pad .pad-ta').first().press('Home');
    await page.locator('#pad .pad-ta').first().press('Backspace');
    assert.equal(await page.locator('#pad .pad-ta').first().inputValue(), 'Второй лист');
    assert.equal(await page.locator('#pad .pf-n').textContent(), '2 / 2');
    const tinyPad = await page.evaluate(() => {
      const editor = window.__pad.editor();
      const meter = editor.ta.parentElement.querySelectorAll('.pad-ta')[1];
      for (const field of [editor.ta, meter]) {
        Object.defineProperty(field, 'clientHeight', { value: 1 });
        Object.defineProperty(field, 'scrollHeight', { value: 12 });
      }
      editor.ta.value = 'Текст';
      editor.ta.dispatchEvent(new Event('input'));
      return editor.pages;
    });
    assert.deepEqual(tinyPad, ['Первый лист', 'Текст']);
    await page.evaluate(() => window.__pad.close());

    await page.evaluate(async () => {
      await window.__pad.open();
      document.querySelector('#btn-settings').click();
    });
    await page.locator('#set-tabs [data-tab="pad"]').click();
    await page.evaluate(() => Promise.all(['#settings', '#pad-sheet'].flatMap((selector) =>
      document.querySelector(selector).getAnimations().map((animation) => animation.finished))));
    for (const tab of ['text', 'read', 'pad']) {
      await page.locator('#set-tabs [data-tab="' + tab + '"]').click();
      const rects = await page.evaluate(() => {
        const pane = document.querySelector('#settings').getBoundingClientRect();
        const sheet = document.querySelector('#pad-sheet').getBoundingClientRect();
        return { offset: pane.left + pane.width / 2 - sheet.left - sheet.width / 2, width: pane.width };
      });
      assert.ok(Math.abs(rects.offset) < 1, 'Аа is centered over the sheet on the ' + tab + ' tab');
      assert.ok(rects.width <= 340, 'Аа retains its standard width where it fits');
    }
    const panelBox = async () => page.locator('#settings').evaluate((el) => ({ left: el.offsetLeft, width: el.offsetWidth }));
    const standardPanel = await panelBox();
    await page.evaluate(() => document.getElementById('btn-settings').click());
    const handle = page.locator('#pad-width-handle');
    const handleBox = await handle.boundingBox();
    const sheetWidth = await page.locator('#pad-sheet').evaluate((sheet) => sheet.offsetWidth);
    assert.equal(await handle.evaluate((el) => getComputedStyle(el).cursor), 'ew-resize');
    await page.mouse.move(handleBox.x + 5, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 43, handleBox.y + handleBox.height / 2, { steps: 4 });
    await page.mouse.up();
    const resizedWidth = await page.locator('#pad-sheet').evaluate((sheet) => sheet.offsetWidth);
    assert.equal(resizedWidth, sheetWidth + 48);
    await page.evaluate(() => document.getElementById('btn-settings').click());
    assert.deepEqual(await panelBox(), standardPanel, 'The Аа panel keeps its position when the sheet resizes');
    await page.getByRole('button', { name: 'Точки', exact: true }).click();
    await page.getByText('Номера листов', { exact: true }).click();
    assert.equal(await page.locator('#pad-sheet').getAttribute('data-pad-rule'), 'dots');
    assert.ok(await page.locator('.pf-n').isHidden());
    await page.getByText('Номера листов', { exact: true }).click();
    await page.getByRole('button', { name: 'Прокрутка', exact: true }).click();
    assert.deepEqual(await page.locator('#pad-sheet .pad-rich-text').evaluateAll((fields) => fields.map((field) => field.value)), ['Первый лист', 'Текст']);
    await page.getByRole('button', { name: 'Листание', exact: true }).click();
    await page.evaluate(() => document.querySelector('#btn-settings').click());
    await page.evaluate(async () => {
      const field = window.__pad.editor().ta;
      field.value = 'До\nПосле';
      field.setSelectionRange(3, 3);
      const canvas = document.createElement('canvas');
      canvas.width = 60;
      canvas.height = 30;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#b9654b';
      ctx.fillRect(0, 0, 60, 30);
      ctx.fillStyle = '#dfb764';
      ctx.fillRect(6, 6, 20, 18);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const data = new DataTransfer();
      data.items.add(new File([blob], 'notebook.png', { type: 'image/png' }));
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const figure = page.locator('#pad-sheet .pad-image');
    await figure.locator('img').waitFor();
    await page.waitForFunction(() => document.querySelector('.pad-image img')?.naturalWidth === 60);
    assert.deepEqual(await page.locator('#pad-sheet .pad-rich-text:visible').evaluateAll((fields) => fields.map((field) => field.value)), ['До', 'После']);
    await figure.focus();
    const corner = figure.getByRole('button', { name: 'Изменить размер картинки' });
    for (let step = 0; step < 11; step++) await corner.press('ArrowLeft');
    assert.equal(await figure.evaluate((element) => element.style.width), '45%');
    const sideText = page.locator('#pad-sheet .pad-side-text');
    assert.equal(await sideText.inputValue(), 'После');
    assert.ok((await sideText.boundingBox()).x > (await figure.boundingBox()).x + (await figure.boundingBox()).width);
    await figure.click({ button: 'right' });
    assert.deepEqual(await page.locator('#pad-context button').allTextContents(), ['Копировать', 'Вставить']);
    await page.evaluate(async () => {
      await window.__pad.close();
      await window.__pad.open();
    });
    assert.equal(await page.locator('#pad-sheet').evaluate((sheet) => sheet.offsetWidth), resizedWidth);
    await figure.locator('img').waitFor();
    assert.equal(await figure.evaluate((element) => element.style.width), '45%');
    await figure.press('Control+c');
    await sideText.press('End');
    await sideText.press('Control+v');
    await page.waitForFunction(() => [...document.querySelectorAll('#pad-sheet .pad-image img')].filter((image) => image.naturalWidth === 60).length === 2);
    await figure.last().press('Delete');
    assert.equal(await figure.count(), 1);
    await page.evaluate(() => window.__pad.close());
    await page.evaluate(async () => {
      await window.__polka.goTo(1, { page: 0 });
      const flow = document.getElementById('flow');
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.length < 12) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 12);
        const { top, bottom, left, right, width } = range.getBoundingClientRect();
        if (!width || top < 0 || bottom > innerHeight || left < 0 || right > innerWidth) continue;
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.querySelector('#sel-bar [data-act="translate"]').click();
        return;
      }
      throw new Error('No visible text to translate');
    });
    await page.getByRole('button', { name: 'В блокнот', exact: true }).click();
    await page.waitForFunction(() => window.__pad.editor()?.pages.some((text) => text.includes('Проверенный перевод')));
    assert.ok(await page.evaluate(() => window.__pad.editor().pages.every((text) => !text.includes('polka://'))));
    assert.equal(await page.locator('#pad-sheet .pf-n').textContent(), '2 / 2');
    await page.locator('#pad-sheet .pf-next').click();
    assert.equal(await page.locator('#pad-sheet .pf-n').textContent(), '3 / 3');
    await page.locator('#pad-sheet .pad-ta:visible').fill('Третий лист для проверки разворота');
    await page.evaluate(() => window.__pad.close());

    await page.evaluate((id) => {
      document.getElementById('btn-back').click();
      const records = JSON.parse(localStorage.getItem('polka.progress'));
      records[id] = { ...records[id], pct: .14, chap: 'Глава для проверки', snip: 'Глава для проверки. Отрывок для проверки.' };
      const other = window.__polka.L.entries.find((entry) => entry.id !== id);
      records[other.id] = { ch: 0, off: 20, pct: .1, t: Date.now() };
      localStorage.setItem('polka.progress', JSON.stringify(records));
    }, id);
    const recordedPad = await page.evaluate(() => localStorage.getItem('polka.pads'));
    await page.locator('.sh-tab[data-shelf="reading"]').click();
    const currentBook = page.locator('.hb').filter({ has: page.getByRole('button', { name: 'Открыть блокнот', exact: true }) });
    assert.equal(await currentBook.evaluate((card) => card.querySelector('.hb-go').getBoundingClientRect().top -
      card.querySelector('.hb-cover').getBoundingClientRect().bottom), 12);
    assert.match(await currentBook.locator('.hb-a').textContent(), /^Автор /);
    assert.equal(await currentBook.locator('.hb-ch').textContent(), 'Глава для проверки');
    assert.equal(await currentBook.locator('.hb-q').textContent(), 'Отрывок для проверки.');
    assert.ok(!(await currentBook.textContent()).includes('Третий лист для проверки разворота'));
    assert.equal(await page.locator('.hb-pad-empty').textContent(), 'Нет блокнота');
    await currentBook.locator('.hb-pad-cover').click();
    assert.ok(await currentBook.isVisible(), 'The notebook cover is not an opening control');
    await currentBook.getByRole('button', { name: 'Открыть блокнот', exact: true }).click();
    const spread = page.locator('#pads .pad-spread');
    assert.equal(await spread.locator('.pad-sheet').count(), 2);
    assert.equal(await spread.locator('.pad-spread-binding i').count(), 19);
    assert.equal(await spread.locator('.pad-sheet').evaluateAll(([left, right]) =>
      right.getBoundingClientRect().left - left.getBoundingClientRect().right), 0);
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['1']);
    assert.equal(await spread.locator('textarea:visible:not([readonly])').count(), 0);
    assert.equal(await spread.locator('.pad-resize').count(), 0);
    assert.deepEqual(await spread.locator('.pad-sheet').evaluateAll((sheets) => sheets.map((sheet) => sheet.dataset.padRule)), ['dots', 'dots']);
    const turn = page.locator('.pad-turn-overlay');
    const turningLeaf = turn.locator('.flip-slot').last();
    const checkTurningPicture = async (face, portion, name) => {
      await turningLeaf.locator(face + ' .pad-image canvas').waitFor();
      await page.waitForFunction(() => document.querySelector('.pad-turn-overlay .flip-slot:nth-child(2)')?.getAnimations().length > 0);
      await turn.evaluate((overlay, portion) => {
        for (const animation of overlay.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration * portion;
        }
      }, portion);
      assert.notEqual(await turningLeaf.evaluate((leaf) => getComputedStyle(leaf).transform), 'none');
      assert.ok(await turningLeaf.locator(face + ' .pad-image canvas').evaluate((canvas) =>
        canvas.getContext('2d').getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4), 1, 1).data[3] > 0));
      assert.equal(await turn.locator('.pad-spread-binding i').count(), 19);
      if (process.env.POLKA_SPREAD_SCREENSHOTS) {
        await page.locator('#toast').evaluate((toast) => { toast.hidden = true; });
        await page.screenshot({ path: path.join(process.env.POLKA_SPREAD_SCREENSHOTS, name + '.png') });
      }
      await turn.evaluate((overlay) => overlay.getAnimations({ subtree: true }).forEach((animation) => animation.play()));
    };
    await page.getByRole('button', { name: 'Следующий разворот' }).press('ArrowRight');
    await turningLeaf.waitFor();
    assert.equal(await turn.getAttribute('data-turning'), 'right');
    assert.equal(await turningLeaf.locator('.fs-front .pad-sheet').getAttribute('aria-label'), 'Правый лист');
    await checkTurningPicture('.fs-back', .55, 'spread-forward');
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['2', '3']);
    assert.equal(await spread.locator('.pad-ta:visible').last().inputValue(), 'Третий лист для проверки разворота');
    await turn.waitFor({ state: 'detached' });
    const zoomable = spread.getByRole('button', { name: 'Увеличить картинку' });
    await zoomable.click();
    await page.locator('#zoom').waitFor();
    assert.equal(await page.locator('#zoom-img').evaluate((img) => img.naturalWidth), 60);
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['2', '3']);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#zoom').isHidden());
    await spread.locator('.pad-ta:visible').first().press('ArrowLeft');
    await turningLeaf.waitFor();
    assert.equal(await turn.getAttribute('data-turning'), 'left');
    assert.equal(await turningLeaf.locator('.fs-front .pad-sheet').getAttribute('aria-label'), 'Левый лист');
    await checkTurningPicture('.fs-front', .34, 'spread-backward');
    await turn.waitFor({ state: 'detached' });
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['1']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowRight');
    assert.equal(await turn.count(), 0);
    assert.equal(await spread.locator('.pad-ta:visible').last().inputValue(), 'Третий лист для проверки разворота');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await page.evaluate(() => localStorage.getItem('polka.pads')), recordedPad);
    await page.getByRole('button', { name: '← Все блокноты' }).click();
    const padCard = page.locator('#pads .padc').first();
    assert.ok((await padCard.locator('.padc-t').textContent()).length > 0);
    assert.equal(await padCard.locator('.padc-a').textContent(), 'Анна Северова');
    assert.equal(await padCard.locator('.padc-art .padc-book').count(), 1);
    assert.doesNotMatch(await padCard.textContent(), /Третий лист для проверки|сегодня|polka-pad-image/);
    await padCard.click();
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['1']);
    await page.locator('#search').press('ArrowRight');
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['1']);
    await page.getByRole('button', { name: 'Следующий разворот' }).press('ArrowRight');
    assert.deepEqual(await spread.locator('.pf-n:visible').allTextContents(), ['2', '3']);
    const leftEntry = JSON.parse(recordedPad)[id].pages[1];
    const resumeFromPad = { ch: 1, off: 1250 };
    await page.evaluate(({ id, resumeFromPad }) => {
      const records = JSON.parse(localStorage.getItem('polka.progress'));
      Object.assign(records[id], resumeFromPad);
      localStorage.setItem('polka.progress', JSON.stringify(records));
    }, { id, resumeFromPad });
    await page.getByRole('button', { name: 'Открыть книгу →' }).click();
    await page.waitForFunction(() => window.__pad.editor() && !window.__polka.R.opening);
    assert.ok(await page.locator('#pad').isVisible());
    assert.equal(await page.evaluate(() => window.__polka.R.ch), resumeFromPad.ch);
    assert.equal(await page.evaluate(() => window.__polka.R.off), resumeFromPad.off);
    assert.deepEqual(await page.evaluate(() => {
      const editor = window.__pad.editor();
      return [editor.pages[editor.cur], editor.ta.selectionStart];
    }), [leftEntry, 0]);
    await page.evaluate(() => window.__pad.close());

    const continuousPad = Array.from({ length: 640 }, (_, i) => 'Строка ' + (i + 1) + ' в тетради.').join(' ');
    await page.evaluate(({ id, continuousPad }) => {
      const records = JSON.parse(localStorage.getItem('polka.pads'));
      records[id] = { ...records[id], pages: [continuousPad], continuations: [] };
      localStorage.setItem('polka.pads', JSON.stringify(records));
      document.getElementById('reader').style.setProperty('--pad-custom-width', '236px');
      document.getElementById('btn-back').click();
    }, { id, continuousPad });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Следующий разворот' }).click();
    const thirdLeaf = spread.locator('.pad-ta:visible').first();
    const selectedExcerpt = (await thirdLeaf.inputValue()).slice(0, 28);
    assert.ok(selectedExcerpt.length > 0 && !continuousPad.startsWith(selectedExcerpt));
    await page.getByRole('button', { name: 'Открыть книгу →' }).click();
    await page.waitForFunction(() => window.__pad.editor() && !window.__polka.R.opening);
    const restored = await page.evaluate(() => {
      const editor = window.__pad.editor();
      return { anchor: editor.pages.slice(editor.cur).join('').slice(editor.ta.selectionStart, editor.ta.selectionStart + 28),
        all: editor.pages.join('') };
    });
    assert.deepEqual(restored, { anchor: selectedExcerpt, all: continuousPad });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async (width) => {
      await window.__pad.close();
      document.getElementById('reader').style.setProperty('--pad-custom-width', width + 'px');
    }, resizedWidth);

    await page.evaluate(async () => {
      await window.__polka.changeSetting('flip', 'off');
      await window.__polka.goTo(1, { page: 0 });
      document.getElementById('btn-settings').click();
    });
    await page.locator('#set-tabs [data-tab="pad"]').click();
    await page.getByText('Оставлять блокнот открытым', { exact: true }).click();
    assert.ok(await page.locator('#pad').isHidden());
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__pad.open());
    await page.locator('#viewport').click({ position: { x: 80, y: 160 } });
    assert.ok(await page.locator('#pad').isVisible());
    const initialBookPage = await page.evaluate(() => window.__polka.R.page);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((initial) => window.__polka.R.page > initial, initialBookPage);
    assert.ok(await page.locator('#pad').isVisible());
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((initial) => window.__polka.R.page === initial, initialBookPage);
    const rightMargin = await page.evaluate(() => {
      const flow = document.getElementById('viewport').getBoundingClientRect();
      const pad = document.getElementById('pad').getBoundingClientRect();
      return { x: (flow.right + pad.left) / 2, y: flow.top + 140 };
    });
    await page.mouse.click(rightMargin.x, rightMargin.y);
    await page.waitForFunction((initial) => window.__polka.R.page > initial, initialBookPage);
    assert.ok(await page.locator('#pad').isVisible());
    await page.evaluate(() => window.__pad.close());

    const longNotebook = 'КонсультантПлюс — справочная правовая система. '.repeat(100);
    await page.evaluate(async ({ id, longNotebook }) => {
      localStorage.setItem('polka.pads', JSON.stringify({
        [id]: { pages: [longNotebook + '\n[Открыть в книге](polka://open?book=test&ch=2&off=0&len=5)'] },
      }));
      localStorage.setItem('polka.padOptions', JSON.stringify({ [id]: { font: 'hand', navigation: 'scroll', size: 24, rule: 'lines' } }));
      await window.__pad.open();
      document.getElementById('btn-settings').click();
    }, { id, longNotebook });
    await page.locator('#set-tabs [data-tab="pad"]').click();
    assert.equal(await page.locator('#pad-sheet .pad-rich').evaluate((el) => getComputedStyle(el).scrollbarWidth), 'none');
    await page.locator('#pad-sheet .pad-rich').evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; });
    await page.waitForFunction(() => parseFloat(document.getElementById('pad-sheet').style.getPropertyValue('--pad-paper-scroll')) > 0);
    assert.match(await page.locator('#pad-sheet').evaluate((el) => getComputedStyle(el).backgroundSize), /43px$/);
    await page.getByRole('button', { name: 'Листание', exact: true }).click();
    const largePages = await page.evaluate(() => window.__pad.editor().pages);
    assert.ok(largePages.length > 2, 'A long handwritten notebook paginates when switching from scrolling');
    assert.equal(largePages.join(''), longNotebook);
    const middleSheet = await page.evaluate(() => window.__pad.editor().cur);
    assert.ok(middleSheet > 0 && middleSheet < largePages.length - 1);
    const size = page.locator('#set-pad-size');
    await size.press('Home');
    assert.equal(await size.inputValue(), '12');
    assert.match(await page.locator('#pad-sheet').evaluate((el) => getComputedStyle(el).backgroundSize), /22px$/);
    await page.getByRole('button', { name: 'Тёмно-синие', exact: true }).click();
    const smallPages = await page.evaluate(() => window.__pad.editor().pages);
    assert.ok(smallPages.length > 1 && smallPages.length < largePages.length);
    assert.equal(smallPages.join(''), longNotebook);
    assert.equal(await page.locator('#pad-sheet').evaluate((el) => getComputedStyle(el).color), 'rgb(32, 56, 88)');
    const paperSwatches = page.locator('#pad-paper-colors button');
    assert.equal(await paperSwatches.count(), 8);
    await page.getByRole('button', { name: 'Угольный', exact: true }).click();
    assert.equal(await page.locator('#pad-sheet').getAttribute('data-pad-tone'), 'dark');
    assert.equal(await page.getByRole('button', { name: 'Сливочные', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(await page.getByRole('button', { name: 'Тёмно-синие', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Слоновая кость', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Тёмно-синие', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => document.getElementById('btn-settings').click());
    const editorField = page.locator('#pad-sheet .pad-ta').first();
    assert.equal(await editorField.evaluate((el) => getComputedStyle(el).scrollbarWidth), 'none');
    assert.ok(await editorField.evaluate((el) => el.scrollHeight <= el.clientHeight + 1));
    await editorField.press('PageUp');
    const index = await page.evaluate(() => window.__pad.editor().cur);
    await editorField.press('PageDown');
    assert.equal(await page.evaluate(() => window.__pad.editor().cur), index + 1);
    await editorField.hover();
    await page.mouse.wheel(0, -140);
    await page.waitForFunction((expected) => window.__pad.editor().cur === expected, index);
    await page.evaluate(() => window.__pad.close());

    const legacyLink = 'polka://open?book=' + encodeURIComponent(id) + '&ch=1&off=24&len=16&n=nlegacy';
    notes.set(note, notes.get(note) + '\n\n> [!note] Глава · 15%\n> *«Старый фрагмент»*\n>\n> Старая личная мысль\n>\n> #проба · 26.11.2026 · [открыть в Полке](' + legacyLink + ')\n');
    await page.keyboard.press('KeyT');
    await page.getByRole('button', { name: 'Цитаты', exact: true }).click();
    assert.equal(await page.locator('#drawer-tabs [data-tab="notes"]').count(), 0);
    const legacy = page.locator('#q-list [data-qid="nlegacy"]');
    await legacy.waitFor();
    assert.match(await legacy.textContent(), /Старый фрагмент.*Старая личная мысль/s);
    assert.match(notes.get(note), /\[!note\]/);
    assert.ok(notes.get(note).includes(legacyLink));
    await page.keyboard.press('Escape');
    await page.evaluate((url) => window.__polka.openLink(url), legacyLink);
    await page.waitForFunction(() => window.__polka.R.ch === 1 && !window.__polka.R.rendering);
    await page.getByRole('button', { name: '← Вернуться к чтению' }).click();

    const end = await page.evaluate(async () => {
      const app = window.__polka;
      await app.goTo(app.R.book.chapters.length - 1, { page: Number.MAX_SAFE_INTEGER });
      let writes = 0;
      const original = window.__saveStateSoon;
      window.__saveStateSoon = () => { writes++; if (original) original(); };
      await app.next();
      const saved = JSON.parse(localStorage.getItem('polka.progress'))[app.R.id];
      return { written: writes > 0, done: saved.done > 0 };
    });
    assert.deepEqual(end, { written: true, done: true });
    await page.evaluate(async () => {
      const app = window.__polka;
      const relayout = app.relayout();
      await app.goTo(0, { page: 0 });
      await relayout;
    });
    await delay(100);
    assert.ok(await page.locator('#book-end').isHidden());
    const guidePage = await browser.newPage({ viewport: { width: 1300, height: 880 } });
    await guidePage.goto(pathToFileURL(path.resolve(__dirname, '../dist/app/index.html')).href);
    const guide = fs.readFileSync(path.join(__dirname, '../src/guide/guide.fb2')).toString('base64');
    await guidePage.evaluate(async (data) => {
      const file = new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'Путеводитель.fb2');
      const app = window.__polka;
      await app.changeSetting('cols', '1');
      await app.changeSetting('flip', 'turn');
      await app.openEntry({ file, name: file.name, id: 'guide-layout-test' }, { ch: 1, off: 0 });
      const chapter = app.R.book.chapters.findIndex((entry) => entry.html.includes('guide-caption-'));
      await app.goTo(chapter, { page: 0 });
    }, guide);
    await guidePage.locator('.flip-slot .guide-caption').first().waitFor({ state: 'attached' });
    const guideTurn = await guidePage.evaluate(async () => {
      const original = document.querySelector('#flow .guide-caption');
      const image = document.querySelector('#flow .guide-picture img');
      await window.__polka.next();
      const clone = document.querySelector('.flip-slot.on .guide-caption');
      const cloneImage = document.querySelector('.flip-slot.on .guide-picture img');
      const sameSize = ['fontSize', 'lineHeight', 'marginBottom'].every(
        (key) => getComputedStyle(original)[key] === getComputedStyle(clone)[key]);
      const sameImage = getComputedStyle(image).maxHeight === getComputedStyle(cloneImage).maxHeight;
      window.__flipSeek(1);
      return { sameSize, sameImage, hasDuplicateId: clone.hasAttribute('id') };
    });
    assert.deepEqual(guideTurn, { sameSize: true, sameImage: true, hasDuplicateId: false });
    await guidePage.mouse.move(1120, 16);
    await guidePage.locator('#btn-pad').click();
    const pad = guidePage.locator('#pad');
    const editor = pad.locator('.pad-ta:visible');
    assert.ok(await editor.evaluate((field) => field === document.activeElement));
    await guidePage.evaluate(() => window.__polka.changeSetting('focus', 'sheet'));
    const headerOffset = await guidePage.evaluate(() => {
      const center = (element) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
      return center(document.querySelector('.r-title')) - center(document.getElementById('sheet'));
    });
    assert.ok(Math.abs(headerOffset) < 1, 'The book title is centered over its sheet when the notebook is open');
    await guidePage.keyboard.type('First');
    assert.equal(await editor.inputValue(), 'First');
    await editor.blur();
    await guidePage.keyboard.press('KeyN');
    assert.ok(await pad.isVisible(), 'N does not close an open notebook');
    await pad.locator('#pad-sheet').click({ position: { x: 8, y: 10 } });
    assert.ok(await editor.evaluate((field) => field === document.activeElement));
    await guidePage.keyboard.type(' note');
    assert.equal(await editor.inputValue(), 'First note');
    await guidePage.keyboard.press('Control+n');
    await pad.waitFor({ state: 'hidden' });

    await guidePage.evaluate(() => {
      const id = window.__polka.R.id;
      localStorage.setItem('polka.padOptions', JSON.stringify({ [id]: { navigation: 'scroll' } }));
    });
    await guidePage.keyboard.press('KeyN');
    const scrollEditor = pad.locator('.pad-rich-text');
    assert.ok(await scrollEditor.evaluate((field) => field === document.activeElement));
    await scrollEditor.blur();
    await pad.locator('.pad-rich').click({ position: { x: 10, y: 100 } });
    await guidePage.keyboard.type(' again');
    assert.equal(await scrollEditor.inputValue(), 'First note again');
    await guidePage.keyboard.press('Control+n');
    await pad.waitFor({ state: 'hidden' });
    await guidePage.close();
    assert.deepEqual(errors, []);
    console.log('Review regressions passed');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
