// Сборка: dist/Полка.html (один файл) + dist/app (файлы для Electron)
const fs = require('fs');
const path = require('path');
const FS = path.join(__dirname, 'node_modules/@fontsource');
const FONTS = [['literata', 'Literata'], ['pt-serif', 'PT Serif'], ['lora', 'Lora'], ['ibm-plex-serif', 'IBM Plex Serif'], ['pt-sans', 'PT Sans']];

function fontCss() {
  let css = '';
  for (const [pkg, family] of FONTS) {
    for (const w of ['400', '700']) for (const it of ['', '-italic']) {
      const src = fs.readFileSync(path.join(FS, pkg, w + it + '.css'), 'utf8');
      for (const block of src.split('@font-face').slice(1)) {
        const name = (block.match(/files\/([\w-]+)\.woff2/) || [])[1];
        if (!name || !/-(cyrillic|latin)-\d/.test(name) || /-(cyrillic|latin)-ext-/.test(name) && !/latin-ext/.test(name)) continue;
        if (/latin-ext/.test(name)) continue;
        const b64 = fs.readFileSync(path.join(FS, pkg, 'files', name + '.woff2')).toString('base64');
        const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
        css += `@font-face{font-family:'${family}';font-style:${it ? 'italic' : 'normal'};font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}\n`;
      }
    }
  }
  return css;
}

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const fflate = fs.readFileSync(path.join(__dirname, 'node_modules/fflate/umd/index.js'), 'utf8');
const BUILD_DATE = new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
// скрипты программы; CSP разрешает выполнять только их (по sha256-отпечаткам) — код из книг не запустится
// звуки листания — записи настоящей книги из набора Kenney «RPG Audio» (CC0), вшиты в страницу
const SOUNDS = 'window.POLKA_SOUNDS = ' + JSON.stringify(['page'].map((n) => fs.readFileSync(path.join(__dirname, 'src/sounds', n + '.ogg')).toString('base64'))) + ';';
const scripts = [fflate, fs.readFileSync(path.join(__dirname, 'build/hyph.js'), 'utf8'), src('parsers.js'), SOUNDS, src('app.js').replace('__BUILD_DATE__', BUILD_DATE)]
  .map((code) => '\n' + code + '\n');
const crypto = require('crypto');
const hashes = scripts.map((code) => "'sha256-" + crypto.createHash('sha256').update(code, 'utf8').digest('base64') + "'");
const CSP = [
  "default-src 'none'",
  'script-src ' + hashes.join(' '),
  "style-src 'unsafe-inline'",
  "img-src data: blob: https://upload.wikimedia.org",
  "font-src data:",
  // сеть из окна нужна только веб-версии (в программе запросы идут через главный процесс)
  "connect-src https://translate.googleapis.com https://*.wikipedia.org https://*.wiktionary.org",
  "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
const html = src('index.html')
  .replace('<meta charset="utf-8">', () => '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + CSP + '">')
  .replace('<!--STYLES-->', () => '<style>\n' + fontCss() + '</style>\n<style>\n' + src('styles.css') + '\n</style>')
  .replace('<!--SCRIPTS-->', () => scripts.map((code) => '<script>' + code + '</script>').join('\n'));

fs.mkdirSync('dist/app', { recursive: true });
fs.writeFileSync('dist/Полка.html', html);
fs.writeFileSync('dist/app/index.html', html);
for (const f of ['main.js', 'preload.js', 'package.json']) fs.copyFileSync(path.join('electron', f), path.join('dist/app', f));
if (fs.existsSync('src/guide/guide.fb2')) fs.copyFileSync('src/guide/guide.fb2', 'dist/app/guide.fb2');
if (fs.existsSync('build/icon.png')) fs.copyFileSync('build/icon.png', 'dist/app/icon.png');
console.log('dist/Полка.html', (html.length / 1024).toFixed(0) + ' KB');
