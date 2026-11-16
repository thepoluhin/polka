const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const svg = fs.readFileSync(__dirname + '/icon.svg', 'utf8');
  const pngs = [];
  for (const s of [256, 64, 48, 32, 24, 16]) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    const buf = await p.screenshot({ omitBackground: true });
    pngs.push([s, buf]);
    if (s === 256) fs.writeFileSync(__dirname + '/icon.png', buf);
  }
  // ICO с PNG внутри
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = []; let off = 6 + 16 * pngs.length;
  for (const [s, buf] of pngs) {
    const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12); off += buf.length; dir.push(e);
  }
  fs.writeFileSync(__dirname + '/icon.ico', Buffer.concat([head, ...dir, ...pngs.map((x) => x[1])]));
  await b.close();
})();
