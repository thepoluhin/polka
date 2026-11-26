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
      window.shelf = {
        scan: () => window.scanBooks(),
        read: async (p) => Uint8Array.from(atob(await window.readBook(p)), (b) => b.charCodeAt(0)),
        initialFile: async () => null,
        onOpenFile() {}, setTheme() {},
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
        '</title-info></description><BINARY id = "cover&amp;v2" content-type = "image/png">AQID</BINARY></FictionBook>'
      );
      const meta = window.BookParser.meta('cover.fb2', encoded);
      return [meta.coverType, Array.from(meta.coverBytes || [])];
    });
    assert.deepEqual(cover, ['image/png', [1, 2, 3]]);
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
    assert.deepEqual(await page.evaluate(() => {
      const pane = document.querySelector('#settings').getBoundingClientRect();
      const sheet = document.querySelector('#pad-sheet').getBoundingClientRect();
      return [Math.round(Math.abs(pane.left - sheet.left)), Math.round(Math.abs(pane.right - sheet.right))];
    }), [0, 0]);
    await page.getByRole('button', { name: 'Точки', exact: true }).click();
    await page.getByText('Номера листов', { exact: true }).click();
    assert.equal(await page.locator('#pad-sheet').getAttribute('data-pad-rule'), 'dots');
    assert.ok(await page.locator('.pf-n').isHidden());
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
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const data = new DataTransfer();
      data.items.add(new File([blob], 'notebook.png', { type: 'image/png' }));
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const figure = page.locator('#pad-sheet .pad-image');
    await figure.locator('img').waitFor();
    await page.waitForFunction(() => document.querySelector('.pad-image img')?.naturalWidth === 60);
    assert.deepEqual(await page.locator('#pad-sheet .pad-rich-text').evaluateAll((fields) => fields.map((field) => field.value)), ['До', 'После']);
    await figure.focus();
    await figure.getByRole('button', { name: 'Изменить размер картинки' }).press('ArrowLeft');
    assert.equal(await figure.evaluate((element) => element.style.width), '95%');
    await figure.click({ button: 'right' });
    assert.deepEqual(await page.locator('#pad-context button').allTextContents(), ['Копировать', 'Вставить']);
    await page.evaluate(async () => {
      await window.__pad.close();
      await window.__pad.open();
    });
    await figure.locator('img').waitFor();
    assert.equal(await figure.evaluate((element) => element.style.width), '95%');
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
    const savedSource = page.locator('#pad-sheet .pad-source');
    await savedSource.waitFor();
    assert.match(await savedSource.getAttribute('data-markdown'), /\[Открыть в книге\]\(polka:\/\/open\?book=[^&]+&ch=1&off=\d+&len=\d+\)/);
    assert.ok(await page.locator('#pad-sheet .pad-rich-text').evaluateAll((fields) => fields.some((field) => field.value.includes('Проверенный перевод'))));
    await page.evaluate(() => window.__pad.close());

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
