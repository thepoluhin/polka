/* Разделы читательского дневника, общие для чтения и записи. */
const DiaryMarkdown = (() => {
  const BOOK_SEC = '## Мои мысли о книге';
  const PAD_SEC = '## Блокнот';
  const PAD_END = '<!-- polka:pad-end -->';
  const isRecord = (line) => /^> \[!(quote|note)\]/.test(line);

  function sectionRange(lines, heading, stopsAt, endMarker) {
    const at = lines.indexOf(heading);
    if (at < 0) return null;
    const end = endMarker ? lines.indexOf(endMarker, at + 1) : -1;
    if (end >= 0) return { at, e: end, after: end + 1 };
    let e = at + 1;
    while (e < lines.length && !isRecord(lines[e]) && !stopsAt(lines[e])) e++;
    return { at, e, after: e };
  }

  const bookThoughtsRange = (lines) => sectionRange(lines, BOOK_SEC, (line) => /^## /.test(line));
  const padRange = (lines) => sectionRange(lines, PAD_SEC, (line) => line === BOOK_SEC, PAD_END);

  function sectionStart(lines) {
    const link = lines.findIndex((line) => /\[открыть в Полке\]\(polka:\/\/open\?book=[^&)]*\)\s*$/.test(line));
    return link >= 0 ? link + 1 : lines.findIndex((line) => /^# /.test(line)) + 1;
  }

  return { BOOK_SEC, PAD_SEC, PAD_END, bookThoughtsRange, padRange, sectionStart };
})();
