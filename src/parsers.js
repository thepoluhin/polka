/* Разбор книг FB2 / FB2.ZIP / EPUB в единую модель:
   book = { format, title, authors[], lang, annotation(html), series, cover (url|null),
            chapters: [{ title, html, len }], toc: [{ title, ch, anchor, depth }],
            notes: { id: html }, idMap: { id: ch }, urls: [blobUrls] } */
(function () {
  'use strict';

  const XLINK = 'http://www.w3.org/1999/xlink';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const textLen = (html) => html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').length;
  const kids = (el, name) => Array.from(el ? el.children : []).filter((c) => !name || c.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ---------- кодировка ----------
  function decodeText(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    const m = head.match(/encoding\s*=\s*["']([\w-]+)["']/i);
    if (m) {
      try { return new TextDecoder(m[1].toLowerCase()).decode(bytes); } catch (e) { /* неизвестная кодировка */ }
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1251').decode(bytes); }
  }

  function parseXml(text, type) {
    const doc = new DOMParser().parseFromString(text, type || 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  }

  // HTML-сокращения (&nbsp; &mdash; &laquo; …) → числовые: XML знает только &amp; &lt; &gt; &quot; &apos;
  const entDecoder = document.createElement('textarea');
  function fixEntities(text) {
    return text
      .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
        if (/^(amp|lt|gt|quot|apos)$/.test(name)) return m;
        entDecoder.innerHTML = m;
        const ch = entDecoder.value;
        return ch !== m ? Array.from(ch).map((c) => '&#' + c.codePointAt(0) + ';').join('') : '&amp;' + name + ';';
      });
  }
  // Запасной разбор для FB2 с перепутанными / незакрытыми тегами: «терпеливый» HTML-парсер,
  // но особые для HTML теги (body, title, p, table, style…) временно переименованы, чтобы он их не «переосмыслил»,
  // а затем дерево пересобирается обратно в XML с исходными именами.
  const HTML_SPECIAL = /<(\/?)(body|title|image|head|html|p|table|tr|td|th|style|a|section|binary|description)(?=[\s>/])/gi;
  function htmlFallback(text) {
    const t = text
      .replace(/<\?xml[^>]*\?>/, '')
      .replace(/<([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)\s*\/>/g, '<$1$2></$1>')
      .replace(HTML_SPECIAL, (m, slash, tag) => '<' + slash + 'fb-' + tag.toLowerCase());
    const hd = new DOMParser().parseFromString(t, 'text/html');
    const src = hd.querySelector('fictionbook') || hd.body;
    const xd = document.implementation.createDocument(null, 'FictionBook', null);
    const copy = (from, to) => {
      for (const n of Array.from(from.childNodes)) {
        if (n.nodeType === 3) { to.appendChild(xd.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        let el;
        try { el = xd.createElement(n.localName.replace(/^fb-/, '')); } catch (e) { copy(n, to); continue; }
        for (const at of Array.from(n.attributes)) { try { el.setAttribute(at.name, at.value); } catch (e) { /* странное имя атрибута */ } }
        to.appendChild(el);
        copy(n, el);
      }
    };
    copy(src, xd.documentElement);
    return xd;
  }
  function parseXmlLenient(text) {
    let doc = parseXml(text);
    if (doc) return doc;
    // типичные ошибки FB2: неэкранированные &, HTML-сокращения, мусор после корня
    let fixed = fixEntities(text);
    const end = fixed.lastIndexOf('</FictionBook>');
    if (end > 0) fixed = fixed.slice(0, end + 14);
    doc = parseXml(fixed);
    if (doc) return doc;
    // последний шанс — терпеливый разбор с пересборкой
    return htmlFallback(fixed);
  }

  function bytesToBlobUrl(bytes, type, urls) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    urls.push(url);
    return url;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function personName(a) {
    const g = (n) => clean(kid(a, n) && kid(a, n).textContent);
    const name = [g('first-name'), g('middle-name'), g('last-name')].filter(Boolean).join(' ');
    return name || g('nickname');
  }

  function getHref(el) {
    return el.getAttributeNS(XLINK, 'href') || el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
  }

  // ---------- сверхдлинные абзацы ----------
  // Абзац в десятки тысяч символов браузер верстает секундами. Делим его по концам предложений
  // (вне тегов) на части по ~6 тыс. символов; продолжения — <p class="cont"> без отступа. Текст не меняется.
  const LONG_P = 8000, P_CHUNK = 6000;
  function splitLongPara(html) {
    const out = []; let start = 0, depth = 0, inTag = false, textLen = 0;
    for (let i = 0; i < html.length; i++) {
      const c = html[i];
      if (inTag) {
        if (c === '>') {
          inTag = false;
          const tag = html.slice(html.lastIndexOf('<', i), i + 1);
          if (/^<\//.test(tag)) depth--; else if (!/\/>$/.test(tag) && !/^<(br|img|wbr|hr)\b/i.test(tag)) depth++;
        }
        continue;
      }
      if (c === '<') { inTag = true; continue; }
      textLen++;
      if (textLen >= P_CHUNK && depth === 0 && /[.!?…»]/.test(c) && html[i + 1] === ' ') {
        out.push(html.slice(start, i + 2)); start = i + 2; textLen = 0;
      } else if (textLen >= P_CHUNK && depth === 0 && /[。！？]/.test(c)) {
        out.push(html.slice(start, i + 1)); start = i + 1; textLen = 0; // китайский/японский: без пробела после точки
      } else if (depth === 0 && ((textLen >= P_CHUNK * 2 && c === ' ') || (textLen >= P_CHUNK * 3 && html.lastIndexOf('&', i) <= html.lastIndexOf(';', i)))) {
        // предложений нет (сплошной поток слов) — режем по пробелу, а без пробелов — где придётся (не внутри &…;),
        // иначе вёрстка такого абзаца вешает окно
        out.push(html.slice(start, i + 1)); start = i + 1; textLen = 0;
      }
    }
    out.push(html.slice(start));
    return out.filter((x) => x.length);
  }
  const textLenOf = (html) => html.replace(/<[^>]+>/g, '').length;

  // ---------- распаковка ----------
  // файлы больше 256 МБ внутри архива не распаковываем: настоящей книге столько не нужно, а «zip-бомба»
  // (1 ГБ нулей в 1 МБ архива) иначе забирает память и на десятки секунд замораживает окно
  const ZIP_ENTRY_MAX = 256 * 1024 * 1024;
  function unzip(bytes, filter) {
    try {
      return fflate.unzipSync(bytes, { filter: (f) => f.originalSize <= ZIP_ENTRY_MAX && (!filter || filter(f)) });
    } catch (e) {
      throw new Error(/zip/i.test(e && e.message) ? 'файл повреждён — архив не читается' : (e && e.message) || String(e));
    }
  }

  function isZip(bytes) { return bytes[0] === 0x50 && bytes[1] === 0x4b; }

  function fb2FromZip(bytes) {
    const files = unzip(bytes, (f) => /\.fb2$/i.test(f.name));
    const name = Object.keys(files)[0];
    if (!name) throw new Error('В архиве нет файла FB2');
    return files[name];
  }


  // ---------- деление очень длинных глав на части (для скорости вёрстки) ----------
  const PART = 70000;
  function splitHtml(html) {
    if (html.length < PART * 1.5) return [html];
    const doc = document.implementation.createHTMLDocument('');
    const root = doc.createElement('div');
    root.innerHTML = html;
    const chain = [];
    let box = root;
    while (box.children.length === 1 && box.firstElementChild.childNodes.length > 1) { box = box.firstElementChild; chain.push(box); }
    // если внутри несколько крупных блоков-обёрток — спускаемся в самый большой не будем: режем по детям
    const parts = []; let cur = []; let size = 0;
    const isHead = (n) => n.nodeType === 1 && /^(h[1-6])$/i.test(n.localName) || (n.classList && n.classList.contains('title'));
    for (const n of Array.from(box.childNodes)) {
      if (n.nodeType === 8) continue;
      const len = n.nodeType === 1 ? n.outerHTML.length : n.nodeValue.length;
      if (size > PART && n.nodeType === 1) {
        const carry = [];
        while (cur.length && isHead(cur[cur.length - 1])) carry.unshift(cur.pop());
        if (cur.length) { parts.push(cur); cur = carry; size = carry.reduce((a, c) => a + c.outerHTML.length, 0); }
      }
      cur.push(n); size += len;
    }
    if (cur.length) parts.push(cur);
    if (parts.length < 2) return [html];
    return parts.map((nodes, pi) => {
      let inner = nodes.map((n) => n.nodeType === 1 ? n.outerHTML : esc(n.nodeValue)).join('');
      for (let i = chain.length - 1; i >= 0; i--) {
        const c = chain[i].cloneNode(false);
        if (pi > 0) c.removeAttribute('id');
        c.innerHTML = inner;
        inner = c.outerHTML;
      }
      return inner;
    });
  }

  // разбивает главы, проставляет src (номер исходной главы), ids, offsets и resolve()
  function splitAndIndex(book) {
    // id из книги получают приставку, чтобы не совпасть с элементами самой программы (id="toast" и т.п.)
    const P = 'bk-';
    book.chapters.forEach((c) => { c.html = c.html.replace(/(\s)id="/g, '$1id="' + P).replace(/data-anchor="/g, 'data-anchor="' + P); });
    book.toc.forEach((t) => { if (t.anchor) t.anchor = P + t.anchor; });
    if (book.notes) { const n = {}; for (const k of Object.keys(book.notes)) n[P + k] = book.notes[k]; book.notes = n; }
    const out = [];
    book.chapters.forEach((c, i) => {
      const parts = splitHtml(c.html);
      parts.forEach((h, k) => out.push(Object.assign({}, c, { html: h, src: i, part: k, parts: parts.length })));
    });
    book.chapters = out;
    book.idMap = {};
    out.forEach((c, i) => {
      c.len = Math.max(1, textLen(c.html));
      c.ids = new Set();
      const re = /\sid="([^"]+)"/g; let m;
      while ((m = re.exec(c.html))) { c.ids.add(m[1]); if (!(m[1] in book.idMap)) book.idMap[m[1]] = i; }
    });
    const first = {};
    out.forEach((c, i) => { if (!(c.src in first)) first[c.src] = i; });
    book.resolve = (src, anchor) => {
      const start = first[src];
      if (start === undefined) return null;
      if (anchor) for (let i = start; i < out.length && out[i].src === src; i++) if (out[i].ids.has(anchor)) return i;
      return start;
    };
    book.toc = book.toc.map((t) => Object.assign({}, t, { ch: book.resolve(t.ch, t.anchor) })).filter((t) => t.ch != null);
    let total = 0;
    book.offsets = out.map((c) => { const o = total; total += c.len; return o; });
    book.totalLen = total;
  }

  // =====================================================================
  //                               FB2
  // =====================================================================
  function fb2Meta(bytes) {
    if (isZip(bytes)) bytes = fb2FromZip(bytes);
    const text = decodeText(bytes);
    const dm = text.match(/<description[\s>][\s\S]*?<\/description>/);
    const meta = { format: 'fb2', title: '', authors: [], series: '', lang: '', annotation: '', coverBytes: null, coverType: '' };
    if (!dm) return meta;
    const head = text.slice(0, text.indexOf('<description'));
    const rootOpen = (head.match(/<FictionBook[^>]*>/) || ['<FictionBook xmlns:l="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink">'])[0];
    let doc = parseXml(rootOpen + dm[0] + '</FictionBook>');
    if (!doc) doc = parseXml('<FictionBook xmlns:l="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink">' + fixEntities(dm[0]) + '</FictionBook>');
    if (!doc) return meta;
    fillFb2Meta(doc.documentElement, meta);
    if (meta.coverId) {
      const binaries = /<binary(?=\s)((?:[^"'<>]|"[^"]*"|'[^']*')*)>([^<]*)<\/binary\s*>/gi;
      for (const [, attributes, data] of text.matchAll(binaries)) {
        const binary = parseXml('<binary' + fixEntities(attributes) + '/>')?.documentElement;
        if (binary?.getAttribute('id') !== meta.coverId) continue;
        try {
          meta.coverBytes = b64ToBytes(data);
          meta.coverType = binary.getAttribute('content-type') || 'image/jpeg';
        } catch (e) { /* битая картинка */ }
        break;
      }
    }
    return meta;
  }

  function fillFb2Meta(root, meta) {
    const desc = kid(root, 'description');
    const ti = desc && kid(desc, 'title-info');
    if (!ti) return;
    meta.title = clean(kid(ti, 'book-title') && kid(ti, 'book-title').textContent);
    meta.authors = kids(ti, 'author').map(personName).filter(Boolean);
    meta.lang = clean(kid(ti, 'lang') && kid(ti, 'lang').textContent);
    const seq = kid(ti, 'sequence');
    if (seq && seq.getAttribute('name')) {
      meta.series = clean(seq.getAttribute('name')) + (seq.getAttribute('number') ? ' · ' + seq.getAttribute('number') : '');
    }
    const ann = kid(ti, 'annotation');
    if (ann) meta.annotation = fb2Inner(ann, { images: {}, depth: 0 });
    const edition = kid(desc, 'publish-info');
    meta.publication = {
      publisher: clean(kid(edition, 'publisher')?.textContent),
      year: clean(kid(edition, 'year')?.textContent),
      isbn: clean(kid(edition, 'isbn')?.textContent),
    };
    const cp = kid(ti, 'coverpage');
    const img = cp && kid(cp, 'image');
    if (img) meta.coverId = getHref(img).replace(/^#/, '');
  }

  // Конвертация элементов FB2 в HTML (строкой — быстро)
  function fb2Inner(el, ctx) {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3 || n.nodeType === 4) out += esc(n.nodeValue);
      else if (n.nodeType === 1) out += fb2El(n, ctx);
    }
    return out;
  }

  function idAttr(n, ctx) {
    const id = n.getAttribute('id');
    if (!id) return '';
    if (ctx && ctx.onId) ctx.onId(id);
    return ' id="' + esc(id) + '"';
  }

  function fb2El(n, ctx) {
    const t = n.localName;
    switch (t) {
      case 'p': {
        const inner = fb2Inner(n, ctx);
        const id = idAttr(n, ctx);
        if (inner.length < LONG_P || textLenOf(inner) < LONG_P) return '<p' + id + '>' + inner + '</p>';
        return splitLongPara(inner).map((part, k) => (k ? '<p class="cont">' : '<p' + id + '>') + part + '</p>').join('');
      }
      case 'emphasis': return '<em>' + fb2Inner(n, ctx) + '</em>';
      case 'strong': return '<strong>' + fb2Inner(n, ctx) + '</strong>';
      case 'strikethrough': return '<s>' + fb2Inner(n, ctx) + '</s>';
      case 'sub': return '<sub>' + fb2Inner(n, ctx) + '</sub>';
      case 'sup': return '<sup>' + fb2Inner(n, ctx) + '</sup>';
      case 'code': return '<code>' + fb2Inner(n, ctx) + '</code>';
      case 'style': return '<span>' + fb2Inner(n, ctx) + '</span>';
      case 'empty-line': return '<div class="empty-line"></div>';
      case 'subtitle': return '<p class="subtitle"' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</p>';
      case 'text-author': return '<p class="text-author">' + fb2Inner(n, ctx) + '</p>';
      case 'epigraph': return '<div class="epigraph"' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</div>';
      case 'cite': return '<blockquote class="cite"' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</blockquote>';
      case 'poem': return '<div class="poem"' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</div>';
      case 'stanza': return '<div class="stanza">' + fb2Inner(n, ctx) + '</div>';
      case 'v': return '<p class="v"' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</p>';
      case 'date': return '<p class="text-author">' + fb2Inner(n, ctx) + '</p>';
      case 'title': {
        const lvl = Math.min(6, (ctx.depth || 0) + 1);
        const lines = kids(n).map((c) => c.localName === 'empty-line' ? '' : fb2Inner(c, ctx)).filter((s, i, a) => s || (i > 0 && i < a.length - 1));
        return '<h' + lvl + ' class="title">' + lines.join('<br>') + '</h' + lvl + '>';
      }
      case 'image': {
        const id = getHref(n).replace(/^#/, '');
        const src = ctx.images[id];
        if (!src) return '';
        const alt = esc(n.getAttribute('alt') || '');
        const inline = n.parentNode && ['p', 'v', 'subtitle', 'emphasis', 'strong', 'td', 'th', 'text-author'].includes(n.parentNode.localName);
        return inline ? '<img class="inline" src="' + src + '" alt="' + alt + '">' : '<div class="img"' + idAttr(n, ctx) + '><img src="' + src + '" alt="' + alt + '"></div>';
      }
      case 'a': {
        const href = getHref(n).trim();
        const inner = fb2Inner(n, ctx);
        if (href.startsWith('#')) {
          const id = href.slice(1);
          const isNote = n.getAttribute('type') === 'note' || (ctx.noteIds && ctx.noteIds.has(id));
          return '<a href="#" class="' + (isNote ? 'noteref' : 'internal') + '" data-anchor="' + esc(id) + '">' + inner.replace(/^\s*\[(.*)\]\s*$/, '$1') + '</a>';
        }
        if (!href || !SAFE_URL.test(href)) return inner;
        return '<a href="' + esc(href) + '" class="external">' + inner + '</a>';
      }
      case 'table': return '<table' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</table>';
      case 'tr': return '<tr>' + fb2Inner(n, ctx) + '</tr>';
      case 'td': case 'th': return '<' + t + '>' + fb2Inner(n, ctx) + '</' + t + '>';
      case 'section': {
        ctx.depth = (ctx.depth || 0) + 1;
        const html = '<section' + idAttr(n, ctx) + '>' + fb2Inner(n, ctx) + '</section>';
        ctx.depth--;
        return html;
      }
      case 'annotation': return '<div class="annotation">' + fb2Inner(n, ctx) + '</div>';
      default: return fb2Inner(n, ctx);
    }
  }

  function sectionTitle(sec) {
    const t = kid(sec, 'title');
    if (!t) return '';
    return clean(kids(t).map((p) => p.textContent).join('. ').replace(/\.\s*\./g, '.'));
  }

  function parseFb2(bytes) {
    if (isZip(bytes)) bytes = fb2FromZip(bytes);
    const text = decodeText(bytes);
    const doc = parseXmlLenient(text);
    const root = doc.documentElement;
    const lname = (el) => (el.localName || '').toLowerCase();
    const urls = [];
    const book = { format: 'fb2', title: '', authors: [], series: '', lang: 'ru', annotation: '', cover: null,
      chapters: [], toc: [], notes: {}, idMap: {}, urls };

    // картинки
    const images = {};
    for (const b of Array.from(root.children).filter((c) => lname(c) === 'binary')) {
      const id = b.getAttribute('id');
      if (!id) continue;
      try { images[id] = bytesToBlobUrl(b64ToBytes(b.textContent), b.getAttribute('content-type') || 'image/jpeg', urls); }
      catch (e) { /* пропускаем битую картинку */ }
    }

    const meta = {};
    fillFb2Meta(root, meta);
    Object.assign(book, { title: meta.title || '', authors: meta.authors || [], series: meta.series || '', annotation: meta.annotation || '', publication: meta.publication });
    if (meta.lang) book.lang = meta.lang;
    if (meta.coverId && images[meta.coverId]) book.cover = images[meta.coverId];

    const bodies = Array.from(root.children).filter((c) => lname(c) === 'body');
    const main = bodies.find((b) => !/notes|comments|примеч/i.test(b.getAttribute('name') || '')) || bodies[0];
    // текста нет совсем — честно говорим, а не показываем пустую книгу
    if (!main || !main.textContent.trim()) throw new Error('файл книги повреждён — текст не удалось прочитать');
    const noteBodies = bodies.filter((b) => b !== main);

    // id сносок — чтобы распознавать ссылки на них, даже если type="note" не указан
    const noteIds = new Set();
    for (const nb of noteBodies) nb.querySelectorAll('[id]').forEach((e) => noteIds.add(e.getAttribute('id')));

    let cur = null;
    const ctx = { images, depth: 0, noteIds, onId: (id) => { book.idMap[id] = book.chapters.length - 1; } };
    const startChapter = (title) => { cur = { title: title || '', html: '' }; book.chapters.push(cur); };

    // обложка + титульный лист
    let intro = '';
    if (book.cover) intro += '<div class="cover-page"><img src="' + book.cover + '" alt=""></div>';
    intro += '<div class="book-title-page">' +
      (book.authors.length ? '<div class="btp-author">' + esc(book.authors.join(', ')) + '</div>' : '') +
      '<div class="btp-title">' + esc(book.title || 'Без названия') + '</div>' +
      (book.series ? '<div class="btp-author">' + esc(book.series) + '</div>' : '') +
      '<div class="btp-rule"></div>' +
      (book.annotation ? '<div class="btp-annot">' + book.annotation + '</div>' : '') + '</div>';
    startChapter(book.title || 'Обложка');
    cur.html = intro;
    book.toc.push({ title: 'Обложка', ch: 0, anchor: null, depth: 0 });

    if (main) {
      // у вложенных секций с заголовком должен быть id — для перехода из оглавления
      let gen = 0;
      main.querySelectorAll('section').forEach((s) => { if (!s.getAttribute('id') && kid(s, 'title')) s.setAttribute('id', '_sec' + (gen++)); });
      // содержимое body до первой секции (название, эпиграф)
      let pre = '';
      for (const c of kids(main)) {
        if (lname(c) === 'section') break;
        if (lname(c) === 'title') continue; // заголовок body дублирует титульный лист
        pre += fb2El(c, ctx);
      }
      if (pre.trim()) cur.html += pre;

      const emitSection = (sec, depth) => {
        const title = sectionTitle(sec);
        const subs = kids(sec, 'section');
        const big = sec.textContent.length > 120000;
        if (subs.length && big) {
          startChapter(title);
          if (title) book.toc.push({ title, ch: book.chapters.length - 1, anchor: sec.getAttribute('id'), depth });
          ctx.depth = depth;
          let html = '<section' + idAttr(sec, ctx) + '>';
          for (const c of kids(sec)) {
            if (lname(c) === 'section') {
              if (html) { cur.html += html + '</section>'; html = ''; }
              emitSection(c, depth + 1);
              ctx.depth = depth;
            } else {
              ctx.depth = depth + 1;
              const h = fb2El(c, ctx);
              if (html) html += h; else cur.html += h;
            }
          }
          if (html) cur.html += html + '</section>';
        } else {
          startChapter(title);
          const ch = book.chapters.length - 1;
          ctx.depth = depth;
          cur.html = fb2El(sec, ctx);
          // оглавление: сама глава + вложенные подглавы
          const addToc = (s, d) => {
            const t = sectionTitle(s);
            if (t) book.toc.push({ title: t, ch, anchor: s === sec ? null : s.getAttribute('id'), depth: d });
            for (const ss of kids(s, 'section')) addToc(ss, d + 1);
          };
          addToc(sec, depth);
        }
      };
      ctx.depth = 0;
      for (const sec of kids(main, 'section')) emitSection(sec, 0);
    }

    // сноски
    for (const nb of noteBodies) {
      const nctx = { images, depth: 0, noteIds };
      nb.querySelectorAll('section[id], [id]').forEach((s) => {
        if (lname(s) !== 'section' && lname(s) !== 'p') return;
        const id = s.getAttribute('id');
        if (!book.notes[id]) book.notes[id] = fb2Inner(s, nctx);
      });
      const name = nb.getAttribute('name') === 'notes' ? 'Примечания' : (sectionTitle(nb) || 'Комментарии');
      startChapter(name);
      const ch = book.chapters.length - 1;
      nctx.onId = (id) => { book.idMap[id] = ch; };
      cur.html = '<div class="notes-section"><h2 class="title">' + esc(name) + '</h2>' + kids(nb).filter((c) => lname(c) !== 'title').map((c) => fb2El(c, nctx)).join('') + '</div>';
      book.toc.push({ title: name, ch, anchor: null, depth: 0 });
    }

    finish(book);
    return book;
  }

  function finish(book) {
    const keep = []; const map = {};
    book.chapters.forEach((c, i) => {
      if (i === 0 || textLen(c.html) > 0 || /<img|<svg/i.test(c.html)) { map[i] = keep.length; keep.push(c); }
      else map[i] = keep.length;
    });
    book.chapters = keep;
    book.toc = book.toc.map((t) => Object.assign({}, t, { ch: Math.min(map[t.ch], keep.length - 1) }));
    splitAndIndex(book);
    // в FB2 id уникальны на всю книгу — уточним главу по якорю
    book.toc.forEach((t) => { if (t.anchor && t.anchor in book.idMap) t.ch = book.idMap[t.anchor]; });
  }

  // =====================================================================
  //                               EPUB
  // =====================================================================
  function resolvePath(base, rel) {
    rel = rel.split('#')[0];
    try { rel = decodeURIComponent(rel); } catch (e) { /* ok */ }
    if (rel.startsWith('/')) return rel.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const p of rel.split('/')) {
      if (p === '..') parts.pop(); else if (p !== '.' && p !== '') parts.push(p);
    }
    return parts.join('/');
  }

  const td = new TextDecoder('utf-8');
  function readText(files, path) {
    const f = files[path] || files[Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase())];
    return f ? decodeText(f) : null;
  }
  function getFile(files, path) {
    return files[path] || files[Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase())] || null;
  }

  function epubOpf(files) {
    const container = readText(files, 'META-INF/container.xml');
    let opfPath = null;
    if (container) {
      const m = container.match(/full-path\s*=\s*["']([^"']+)["']/);
      if (m) opfPath = m[1];
    }
    if (!opfPath) opfPath = Object.keys(files).find((k) => /\.opf$/i.test(k));
    if (!opfPath) throw new Error('Не найден OPF-файл EPUB');
    const opfText = readText(files, opfPath);
    const opf = parseXml(opfText) || new DOMParser().parseFromString(opfText, 'text/html');
    return { opf, opfPath };
  }

  function epubMetaFrom(opf, opfPath) {
    const q = (name) => Array.from(opf.getElementsByTagNameNS('*', name));
    const meta = { format: 'epub', title: '', authors: [], series: '', lang: '', annotation: '' };
    meta.title = clean((q('title')[0] || {}).textContent);
    meta.authors = q('creator').map((c) => clean(c.textContent)).filter(Boolean);
    meta.lang = clean((q('language')[0] || {}).textContent);
    const d = q('description')[0];
    if (d) {
      const raw = d.textContent.trim();
      meta.annotation = /<\w/.test(raw) ? sanitizeSimple(raw) : raw.split(/\n+/).map((p) => '<p>' + esc(p) + '</p>').join('');
    }
    const isbn = q('identifier').map((node) => {
      const value = clean(node.textContent);
      const scheme = Array.from(node.attributes).find((attribute) => attribute.localName === 'scheme')?.value;
      if (/^(?:urn:)?isbn\s*:/i.test(value) || /^isbn$/i.test(scheme || '')) {
        return value.replace(/^(?:urn:)?isbn\s*:\s*/i, '');
      }
      return '';
    }).find(Boolean);
    meta.publication = {
      publisher: clean(q('publisher')[0]?.textContent),
      year: clean(q('date')[0]?.textContent).match(/^\d{4}(?=-|$)/)?.[0],
      isbn,
    };
    const metas = q('meta');
    const sName = metas.find((m) => m.getAttribute('name') === 'calibre:series');
    const sIdx = metas.find((m) => m.getAttribute('name') === 'calibre:series_index');
    const coll = metas.find((m) => m.getAttribute('property') === 'belongs-to-collection');
    if (sName) meta.series = sName.getAttribute('content') + (sIdx ? ' · ' + sIdx.getAttribute('content') : '');
    else if (coll) meta.series = clean(coll.textContent);

    const manifest = {};
    for (const it of q('item')) {
      manifest[it.getAttribute('id')] = {
        href: resolvePath(opfPath, it.getAttribute('href') || ''),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || '',
      };
    }
    let coverPath = null;
    const ci = Object.values(manifest).find((m) => /cover-image/.test(m.props));
    if (ci) coverPath = ci.href;
    if (!coverPath) {
      const cm = metas.find((m) => m.getAttribute('name') === 'cover');
      if (cm && manifest[cm.getAttribute('content')]) coverPath = manifest[cm.getAttribute('content')].href;
    }
    if (!coverPath) {
      const guess = Object.entries(manifest).find(([id, m]) => /^image\//.test(m.type) && /cover/i.test(id + m.href));
      if (guess) coverPath = guess[1].href;
    }
    if (coverPath && !/\.(jpe?g|png|gif|webp|svg)$/i.test(coverPath) && !(Object.values(manifest).find((m) => m.href === coverPath) || {}).type.startsWith('image/')) coverPath = null;
    meta.coverPath = coverPath;
    meta.manifest = manifest;
    meta.spine = q('itemref').map((r) => ({ idref: r.getAttribute('idref'), linear: r.getAttribute('linear') !== 'no' }));
    const spineEl = q('spine')[0];
    meta.ncxId = spineEl && spineEl.getAttribute('toc');
    return meta;
  }

  function epubMeta(bytes) {
    const small = unzip(bytes, (f) => /container\.xml$|\.opf$/i.test(f.name));
    const { opf, opfPath } = epubOpf(small);
    const meta = epubMetaFrom(opf, opfPath);
    if (meta.coverPath) {
      const files = unzip(bytes, (f) => f.name === meta.coverPath || f.name.toLowerCase() === meta.coverPath.toLowerCase());
      const c = Object.values(files)[0];
      if (c) { meta.coverBytes = c; meta.coverType = mimeOf(meta.coverPath); }
    }
    delete meta.manifest; delete meta.spine;
    return meta;
  }

  function mimeOf(p) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
  }

  // ---------- очистка HTML из EPUB: «белый список» ----------
  // Книга собирается заново только из разрешённых тегов и атрибутов; всё прочее отбрасывается
  // (текст при этом сохраняется). Скрипты, обработчики событий, «сырые» теги вроде <xmp> не проходят.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HTML_OK = new Set(('p div span br hr h1 h2 h3 h4 h5 h6 em i strong b u s strike del ins sub sup small big cite q blockquote ' +
    'pre code tt kbd var samp abbr dfn mark a img figure figcaption table thead tbody tfoot tr td th caption col colgroup ' +
    'ul ol li dl dt dd section article aside header footer main nav center address time ruby rt rp wbr bdi bdo').split(' '));
  const SVG_OK = new Set('svg g image rect circle ellipse line polyline polygon path text tspan'.split(' '));
  // вместе с содержимым выбрасываем: исполняемое, формы, медиа, «сырой текст»
  const DROP = new Set(('script style link meta iframe frame frameset object embed applet form input button select textarea ' +
    'audio video source track canvas noscript noembed noframes xmp plaintext template head title base dialog portal math').split(' '));
  const ATTR_OK = new Set('id class href src alt title colspan rowspan lang dir start type epub:type role reversed value'.split(' '));
  const SVG_ATTR_OK = new Set(('id class viewbox preserveaspectratio x y width height d points cx cy r rx ry x1 y1 x2 y2 ' +
    'fill stroke stroke-width transform href xlink:href opacity font-size text-anchor').split(' '));
  const SAFE_URL = /^(#|[^:]*$|https?:|mailto:|data:image\/(png|jpe?g|gif|webp);)/i; // без javascript:, file: и т.п.

  function cleanDom(src, doc) {
    const out = doc.createDocumentFragment();
    const walk = (node, parent) => {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3 || n.nodeType === 4) { parent.appendChild(doc.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = (n.localName || '').toLowerCase();
        if (DROP.has(tag)) continue;
        const isSvg = n.namespaceURI === SVG_NS || tag === 'svg';
        const ok = isSvg ? SVG_OK.has(tag) : HTML_OK.has(tag);
        if (!ok) { walk(n, parent); continue; } // неизвестный тег — оставляем только содержимое
        const el = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
        for (const a of Array.from(n.attributes)) {
          const name = a.name.toLowerCase();
          if (!(isSvg ? SVG_ATTR_OK : ATTR_OK).has(name)) continue;
          if ((name === 'href' || name === 'src' || name === 'xlink:href') && !SAFE_URL.test(a.value.trim())) continue;
          try {
            if (name === 'xlink:href') el.setAttributeNS(XLINK, 'xlink:href', a.value);
            else el.setAttribute(isSvg && name === 'viewbox' ? 'viewBox' : isSvg && name === 'preserveaspectratio' ? 'preserveAspectRatio' : a.name, a.value);
          } catch (e) { /* недопустимое имя атрибута */ }
        }
        parent.appendChild(el);
        walk(n, el);
      }
    };
    walk(src, out);
    return out;
  }
  function sanitizeSimple(html) {
    const d = document.implementation.createHTMLDocument('');
    const src = new DOMParser().parseFromString(html, 'text/html');
    const div = d.createElement('div');
    div.appendChild(cleanDom(src.body, d));
    return div.innerHTML;
  }

  function parseEpub(bytes) {
    const files = unzip(bytes);
    const { opf, opfPath } = epubOpf(files);
    const meta = epubMetaFrom(opf, opfPath);
    const urls = [];
    const book = { format: 'epub', title: meta.title, authors: meta.authors, series: meta.series, lang: meta.lang || 'ru',
      annotation: meta.annotation, publication: meta.publication, cover: null, chapters: [], toc: [], notes: {}, idMap: {}, urls };

    const imgCache = {};
    const imgUrl = (path) => {
      if (path in imgCache) return imgCache[path];
      const f = getFile(files, path);
      return (imgCache[path] = f ? bytesToBlobUrl(f, mimeOf(path), urls) : '');
    };
    if (meta.coverPath) book.cover = imgUrl(meta.coverPath) || null;

    const spine = meta.spine.map((s) => meta.manifest[s.idref]).filter((m) => m && /html|xml/.test(m.type) && !/ncx/.test(m.type));
    const pathToCh = {};
    spine.forEach((m, i) => { pathToCh[m.href] = i; pathToCh[m.href.toLowerCase()] = i; });

    const inert = document.implementation.createHTMLDocument('');

    spine.forEach((item) => {
      const raw = readText(files, item.href) || '';
      let src = parseXml(raw, 'application/xhtml+xml');
      if (!src) src = new DOMParser().parseFromString(raw, 'text/html');
      const body = src.getElementsByTagName('body')[0] || src.documentElement;
      const wrap = inert.createElement('div');
      wrap.appendChild(cleanDom(body, inert));
      wrap.querySelectorAll('p').forEach((p) => {
        if (p.textContent.length < LONG_P) return;
        const parts = splitLongPara(p.innerHTML);
        if (parts.length < 2) return;
        p.innerHTML = parts[0];
        let prev = p;
        for (const part of parts.slice(1)) { const q = inert.createElement('p'); q.className = 'cont'; q.innerHTML = part; prev.after(q); prev = q; }
      });
      // картинки: только свои, из книги; внешние адреса (слежка за читателем) убираем
      wrap.querySelectorAll('img').forEach((img) => {
        const s = img.getAttribute('src') || '';
        if (/^https?:/i.test(s) || !s) { img.remove(); return; }
        if (!/^data:/.test(s)) { const u = imgUrl(resolvePath(item.href, s)); if (u) img.setAttribute('src', u); else img.remove(); }
      });
      wrap.querySelectorAll('image').forEach((img) => {
        const s = img.getAttributeNS(XLINK, 'href') || img.getAttribute('xlink:href') || img.getAttribute('href') || '';
        if (/^https?:/i.test(s) || !s) { img.remove(); return; }
        if (!/^data:/.test(s)) {
          const u = imgUrl(resolvePath(item.href, s));
          if (!u) { img.remove(); return; }
          img.setAttributeNS(XLINK, 'xlink:href', u);
          img.setAttribute('href', u);
        }
      });
      wrap.querySelectorAll('svg').forEach((svg) => {
        if (!svg.getAttribute('viewBox') && svg.getAttribute('width') && svg.getAttribute('height')) {
          svg.setAttribute('viewBox', '0 0 ' + parseFloat(svg.getAttribute('width')) + ' ' + parseFloat(svg.getAttribute('height')));
        }
        svg.removeAttribute('width'); svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.cssText = 'width:100%;height:calc(var(--page-h, 80vh) - 2em);';
      });
      // ссылки
      wrap.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (/^(https?|mailto):/i.test(href)) { a.classList.add('external'); return; }
        const [p, anchor] = href.split('#');
        const target = p ? resolvePath(item.href, p) : item.href;
        const ch = pathToCh[target] ?? pathToCh[target.toLowerCase()];
        if (ch === undefined) { a.removeAttribute('href'); return; }
        const epubType = (a.getAttribute('epub:type') || '') + ' ' + (a.getAttribute('role') || '');
        const txt = a.textContent.trim();
        // сноска: явная разметка, или короткая метка вида 1 / [12] / * / а), или ссылка в файл/блок примечаний
        const marker = /^[\[({]?\s*(\d{1,4}|[*†‡§]{1,4}|[a-zа-яё]{1,2})\s*[\])}]?\.?$/i.test(txt);
        const notesTarget = /note|footnote|endnote|comment|fn\d|примеч|сноск|коммент/i.test(target + ' ' + (anchor || '') + ' ' + a.className);
        const isNote = /noteref|footnote|endnote/.test(epubType) || (!!anchor && (marker || (notesTarget && txt.length <= 12)));
        a.setAttribute('href', '#');
        a.className = isNote ? 'noteref' : 'internal';
        a.dataset.ch = ch;
        if (anchor) a.dataset.anchor = anchor;
      });
      // заголовок главы по первому h1-h3
      const h = wrap.querySelector('h1,h2,h3');
      book.chapters.push({ title: h ? clean(h.textContent) : '', html: wrap.innerHTML, path: item.href });
    });

    // оглавление
    const navItem = Object.values(meta.manifest).find((m) => /\bnav\b/.test(m.props));
    let toc = [];
    if (navItem) {
      const navText = readText(files, navItem.href);
      const nd = navText && (parseXml(navText, 'application/xhtml+xml') || new DOMParser().parseFromString(navText, 'text/html'));
      if (nd) {
        const navs = Array.from(nd.getElementsByTagName('nav'));
        const nav = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
        const walk = (ol, depth) => {
          for (const li of Array.from(ol ? ol.children : []).filter((c) => c.localName === 'li')) {
            const a = Array.from(li.children).find((c) => c.localName === 'a' || c.localName === 'span');
            if (a && a.getAttribute('href')) toc.push({ title: clean(a.textContent), href: resolvePath(navItem.href, a.getAttribute('href')), anchor: (a.getAttribute('href').split('#')[1] || null), depth });
            const sub = Array.from(li.children).find((c) => c.localName === 'ol');
            if (sub) walk(sub, depth + 1);
          }
        };
        if (nav) walk(Array.from(nav.children).find((c) => c.localName === 'ol'), 0);
      }
    }
    if (!toc.length) {
      const ncx = (meta.ncxId && meta.manifest[meta.ncxId]) || Object.values(meta.manifest).find((m) => /ncx/.test(m.type));
      const ncxText = ncx && readText(files, ncx.href);
      const nd = ncxText && parseXml(ncxText);
      if (nd) {
        const walk = (parent, depth) => {
          for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
            const label = np.getElementsByTagNameNS('*', 'text')[0];
            const content = Array.from(np.children).find((c) => c.localName === 'content');
            if (content) {
              const src = content.getAttribute('src') || '';
              toc.push({ title: clean(label && label.textContent), href: resolvePath(ncx.href, src), anchor: src.split('#')[1] || null, depth });
            }
            walk(np, depth + 1);
          }
        };
        const navMap = nd.getElementsByTagNameNS('*', 'navMap')[0];
        if (navMap) walk(navMap, 0);
      }
    }
    book.toc = toc.map((t) => ({ title: t.title, ch: pathToCh[t.href] ?? pathToCh[t.href.toLowerCase()], anchor: t.anchor, depth: Math.min(t.depth, 3) }))
      .filter((t) => t.ch !== undefined && t.title);
    // названия глав из оглавления
    for (const t of book.toc) if (!t.anchor || !book.chapters[t.ch].tocTitle) book.chapters[t.ch].tocTitle = book.chapters[t.ch].tocTitle || t.title;
    book.chapters.forEach((c) => { if (c.tocTitle) c.title = c.tocTitle; });
    if (!book.toc.length) book.toc = book.chapters.map((c, i) => ({ title: c.title || 'Глава ' + (i + 1), ch: i, anchor: null, depth: 0 }));

    splitAndIndex(book);
    return book;
  }

  // ---------- публичное API ----------
  function detect(name, bytes) {
    const n = name.toLowerCase();
    if (n.endsWith('.epub')) return 'epub';
    if (n.endsWith('.fb2') || n.endsWith('.fb2.zip')) return 'fb2';
    if (isZip(bytes)) {
      const names = Object.keys(unzip(bytes, (f) => /mimetype$|\.fb2$/i.test(f.name)));
      return names.some((x) => /\.fb2$/i.test(x)) ? 'fb2' : 'epub';
    }
    return 'fb2';
  }

  // начало текста книги — для карточки на полке, когда в книге нет аннотации (только FB2)
  function opening(name, bytes) {
    try {
      if (detect(name, bytes) === 'epub') return '';
      if (isZip(bytes)) bytes = fb2FromZip(bytes);
      const text = decodeText(bytes);
      const i = text.search(/<body[\s>]/);
      if (i < 0) return '';
      const chunk = text.slice(i, i + 40000)
        .replace(/<binary[\s\S]*?<\/binary>/g, ' ')
        .replace(/<(title|epigraph|annotation|subtitle|image)[\s>][\s\S]*?<\/\1>|<image[^>]*\/>/g, ' ');
      const out = [];
      for (const m of chunk.matchAll(/<p[\s>][\s\S]*?<\/p>/g)) {
        const t = m[0].replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z#0-9]+;/gi, (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&laquo;': '«', '&raquo;': '»', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…' }[e] || ' ')).replace(/\s+/g, ' ').trim();
        if (t.length > 1) out.push(t);
        if (out.join(' ').length > 600) break;
      }
      return out.join(' ').slice(0, 600);
    } catch (e) { return ''; }
  }

  window.BookParser = {
    opening,
    meta(name, bytes) { return detect(name, bytes) === 'epub' ? epubMeta(bytes) : fb2Meta(bytes); },
    parse(name, bytes) { return detect(name, bytes) === 'epub' ? parseEpub(bytes) : parseFb2(bytes); },
    esc,
  };
})();
