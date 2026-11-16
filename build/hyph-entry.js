// Исходник build/hyph.js (переносы ru/en из пакета hyphen). Пересборка:
// npx esbuild build/hyph-entry.js --bundle --minify --format=iife --outfile=build/hyph.js
import { hyphenateSync as ru } from 'hyphen/ru';
import { hyphenateSync as en } from 'hyphen/en-us';
window.Hyph = { ru: (w) => ru(w, { html: false }), en: (w) => en(w, { html: false }) };
