// 2.0: генератор «злых» книг для краш-тестов (v29-crash.js, e-v29.js).
// node test/v29-evilbooks.js <папка>  — создаёт папку с книгами; module.exports.make(dir) — то же из кода.
const fs = require('fs'), path = require('path');
const { zipSync, strToU8 } = require('fflate');
const fb2 = ({ title = 'Книга', author = '<first-name>Иван</first-name><last-name>Тестов</last-name>', lang = 'ru', body, extra = '', desc } = {}) =>
  '<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description>' +
  (desc != null ? desc : '<title-info>' + (author ? '<author>' + author + '</author>' : '') + (title != null ? '<book-title>' + title + '</book-title>' : '') + '<lang>' + lang + '</lang></title-info>') +
  '</description><body>' + body + '</body>' + extra + '</FictionBook>';
const para = (n, w) => Array.from({ length: n }, (_, i) => '<p>' + (w || 'Абзац номер ' + i + ' обычного текста, чтобы было что листать.') + '</p>').join('');
const sec = (t, b) => '<section><title><p>' + t + '</p></title>' + b + '</section>';
function epub(files, { opf, container } = {}) {
  const z = { mimetype: strToU8('application/epub+zip') };
  z['META-INF/container.xml'] = strToU8(container != null ? container : '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  if (opf !== null) z['OEBPS/c.opf'] = strToU8(opf || '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>');
  for (const [k, v] of Object.entries(files)) z[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(z, { level: 6 });
}
const xhtml = (b) => '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>' + b + '</body></html>';

function make(dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const w = (n, c) => fs.writeFileSync(path.join(dir, n), c);
  const ok = fb2({ title: 'Нормальная', body: sec('Глава 1', para(30)) + sec('Глава 2', para(30)) });
  w('00 Нормальная.fb2', ok);
  w('01 пустой.fb2', '');
  w('02 пустой.epub', '');
  w('03 мусор.fb2', Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256)));
  const ep = epub({ 'OEBPS/a.xhtml': xhtml(para(200)) });
  w('04 обрезанный.epub', Buffer.from(ep).subarray(0, Math.floor(ep.length / 2)));
  const fz = zipSync({ 'b.fb2': strToU8(ok) });
  w('05 обрезанный.fb2.zip', Buffer.from(fz).subarray(0, Math.floor(fz.length * 0.6)));
  w('06 только заголовок zip.epub', Buffer.from('PK\x03\x04garbage'));
  // миллиард смехов
  const lol = '<?xml version="1.0"?>\n<!DOCTYPE FictionBook [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
    Array.from({ length: 8 }, (_, i) => '<!ENTITY lol' + (i + 2) + ' "' + ('&lol' + (i + 1) + ';').repeat(10) + '">').join('') + ']>' +
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Бомба &lol9;</book-title></title-info></description><body><section><p>&lol9;</p></section></body></FictionBook>';
  w('07 бомба.fb2', lol);
  w('08 бомба.epub', epub({ 'OEBPS/a.xhtml': '<?xml version="1.0"?><!DOCTYPE html [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;"><!ENTITY g "&f;&f;&f;&f;&f;&f;&f;&f;&f;&f;"><!ENTITY h "&g;&g;&g;&g;&g;&g;&g;&g;&g;&g;">]><html xmlns="http://www.w3.org/1999/xhtml"><body><p>&h;</p></body></html>' }));
  // глубокая вложенность
  w('09 глубокие секции.fb2', fb2({ title: 'Глубина', body: '<section><title><p>x</p></title>'.repeat(5000) + '<p>дно</p>' + '</section>'.repeat(5000) }));
  w('10 глубокий emphasis.fb2', fb2({ title: 'Курсив', body: '<section><p>' + '<emphasis>'.repeat(100000) + 'дно' + '</emphasis>'.repeat(100000) + '</p></section>' }));
  w('11 глубокий div.epub', epub({ 'OEBPS/a.xhtml': xhtml('<div>'.repeat(20000) + '<p>дно</p>' + '</div>'.repeat(20000)) }));
  // огромные
  const big = [];
  for (let c = 0; c < 400; c++) big.push(sec('Глава ' + (c + 1), para(1000, 'Длинный абзац текста для толстой книги, примерно сто символов, повторяется тысячи раз подряд.')));
  w('12 огромная 50МБ.fb2', fb2({ title: 'Огромная', body: big.join('') }));
  w('13 глава 2М.fb2', fb2({ title: 'Длинная глава', body: sec('Одна', para(20000, 'Сто символов текста в одном абзаце, и так много-много раз подряд без всякого конца главы.')) }));
  w('14 абзац 2М без точек.fb2', fb2({ title: 'Абзац', body: sec('Один', '<p>' + 'слово '.repeat(350000) + '</p>') }));
  w('15 без глав.fb2', fb2({ title: 'Без глав', body: para(50) }));
  w('16 без названия.fb2', fb2({ title: null, body: sec('Глава', para(10)) }));
  w('17 без автора.fb2', fb2({ author: '', title: 'Сирота', body: sec('Глава', para(10)) }));
  w('18 без description.fb2', fb2({ desc: '', body: sec('Глава', para(10)) }));
  w('19 эмодзи RTL китайский.fb2', fb2({ title: '📚 كتاب 書 🧑‍🤝‍🧑', author: '<first-name>李</first-name><last-name>محمد 👩‍👩‍👧</last-name>', lang: 'ar', body: sec('الفصل 第一章 🎉', para(40, 'مرحبا بالعالم 你好世界 😀👍🏽 שלום עולם — смешанный текст ‮перевёрнутый‬ конец.')) }));
  w('20 только картинка битая.fb2', fb2({ title: 'Картинка', body: sec('Глава', '<image l:href="#i"/><p>текст</p>'), extra: '<binary id="i" content-type="image/png">!!!не base64!!!</binary><binary id="c" content-type="image/jpeg">AAAA</binary>', desc: '<title-info><book-title>Картинка</book-title><coverpage><image l:href="#c"/></coverpage></title-info>' }));
  w('21 пустое тело.fb2', fb2({ title: 'Пусто', body: '' }));
  w('22 пустой spine.epub', epub({}, { opf: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest/><spine/></package>' }));
  w('23 без opf.epub', epub({}, { opf: null }));
  w('24 без container.epub', epub({ 'OEBPS/a.xhtml': xhtml('<p>x</p>') }, { container: '' }));
  w('25 spine на пустоту.epub', epub({}, { opf: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="a" href="нет.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="zz"/></spine></package>' }));
  // zip-бомба: 300 МБ нулей (больше предела 256 МБ)
  const zeros = new Uint8Array(300 * 1024 * 1024);
  w('26 zip-бомба.epub', epub({ 'OEBPS/a.xhtml': xhtml('<p>Нормальный текст</p>'), 'OEBPS/zero.bin': zeros }));
  w('27 zip-бомба.fb2.zip', zipSync({ 'a.fb2': zeros }, { level: 9 }));
  // имена
  for (const n of ['$dollar$.fb2', '#hash#.fb2', '100% книга.fb2', '..точки...fb2', 'a&b <c> \'q\'.fb2', 'Я'.repeat(120) + '.fb2'])
    w(n, fb2({ title: 'Имя ' + n.slice(0, 20), body: sec('Глава', para(10)) }));
  // одинаковые названия (разные файлы)
  w('dup1.fb2', fb2({ title: 'Двойник', body: sec('Глава', para(10, 'один')) }));
  w('dup2.fb2', fb2({ title: 'Двойник', body: sec('Глава', para(10, 'два')) }));
  // одинаковое имя и размер в разных подпапках
  fs.mkdirSync(path.join(dir, 'A')); fs.mkdirSync(path.join(dir, 'B'));
  fs.writeFileSync(path.join(dir, 'A', 'same.fb2'), fb2({ title: 'Близнец А', body: sec('Глава', para(10, 'аааа')) }));
  fs.writeFileSync(path.join(dir, 'B', 'same.fb2'), fb2({ title: 'Близнец Б', body: sec('Глава', para(10, 'бббб')) }));
  // windows-1251 без объявления, utf-16
  w('28 utf16.fb2', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fb2({ title: 'UTF-16', body: sec('Глава', para(10)) }).replace('utf-8', 'utf-16'), 'utf16le')]));
  w('29 неизвестная кодировка.fb2', fb2({ title: 'Кодировка', body: sec('Глава', para(10)) }).replace('utf-8', 'x-klingon'));
  return fs.readdirSync(dir);
}
module.exports = { make, fb2, epub, xhtml, para, sec };
if (require.main === module) console.log(make(process.argv[2]).length, 'файлов');
