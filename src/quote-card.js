(() => {
  const WIDTH = 1080;
  const HEIGHT = 1350;
  const QUOTE_CENTER_Y = 429;
  const BACKGROUND = 'data:image/svg+xml;base64,__QUOTE_BACKGROUND__';
  const QUOTE_FONT = 'Literata, Georgia, serif';
  const SERIF = '"PT Serif", Georgia, serif';
  const SANS = '"PT Sans", sans-serif';
  const INK = '#392c20';

  function loadImage(src) {
    const image = new Image();
    image.src = src;
    return image.decode().then(() => image);
  }

  function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (ctx.measureText(next).width <= width) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        if (ctx.measureText(word).width <= width) continue;
        line = '';
        const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
        for (const { segment } of graphemes) {
          if (line && ctx.measureText(line + segment).width > width) {
            lines.push(line);
            line = '';
          }
          line += segment;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function inkBounds(ctx, lines, step) {
    let top = Infinity, bottom = -Infinity;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const metrics = ctx.measureText(line);
      const baseline = i * step;
      top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
      bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
    });
    return { top, bottom };
  }

  function fit(ctx, text, { width, height, max, min, leading, family, color, bold, measureInk, truncate }) {
    for (let size = max; size >= min; size -= 1) {
      const font = (bold ? '700 ' : '') + size + 'px ' + family;
      ctx.font = font;
      const lines = wrap(ctx, text, width);
      const step = size * leading;
      if (truncate && size - 1 < min && (lines.length - 1) * step + size > height) {
        lines.length = Math.floor((height - size) / step) + 1;
        const last = lines.length - 1;
        const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(lines[last].trimEnd()), ({ segment }) => segment);
        while (segments.length && ctx.measureText(segments.join('') + '…').width > width) segments.pop();
        lines[last] = segments.join('').trimEnd() + '…';
      }
      const ink = measureInk ? inkBounds(ctx, lines, step) : null;
      const used = ink ? ink.bottom - ink.top : (lines.length - 1) * step + size;
      if (Number.isFinite(used) && used <= height) return { lines, step, size, used, font, color, ink };
    }
    return null;
  }

  function drawText(ctx, layout, x, y, align = 'left') {
    ctx.font = layout.font;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = layout.color;
    const baselineOffset = layout.ink ? -layout.ink.top : layout.size * .82;
    layout.lines.forEach((line, i) => ctx.fillText(line, x, y + baselineOffset + layout.step * i));
  }

  function drawCover(ctx, image, title, author) {
    const x = 112, y = 878, w = 256, h = 384;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [12, 18, 18, 12]);
    ctx.clip();
    if (image) {
      ctx.fillStyle = '#e6d8bd';
      ctx.fillRect(x, y, w, h);
      const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
      const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
      ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const cloth = ctx.createLinearGradient(x, y, x + w, y + h);
      cloth.addColorStop(0, '#98543a');
      cloth.addColorStop(1, '#643927');
      ctx.fillStyle = cloth;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#38201438';
      ctx.fillRect(x + 4, y, 7, h);
      ctx.strokeStyle = '#ecd6b38c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 13, y + 13, w - 26, h - 26);
      ctx.strokeStyle = '#ecd6b34d';
      ctx.strokeRect(x + 17, y + 17, w - 34, h - 34);
      const authorLayout = fit(ctx, author.toLocaleUpperCase('ru'), { width: 191, height: 44, max: 12, min: 7, leading: 1.2, family: SERIF, color: '#ecd6b3', truncate: true });
      const titleLayout = fit(ctx, title, { width: 194, height: 154, max: 29, min: 10, leading: 1.15, family: SERIF, color: '#f4e1c5', bold: true, truncate: true });
      if (authorLayout) drawText(ctx, authorLayout, x + w / 2, y + 53, 'center');
      if (titleLayout) drawText(ctx, titleLayout, x + w / 2, y + 160 - titleLayout.used / 2, 'center');
      ctx.strokeStyle = '#ecd6b3a6';
      ctx.beginPath();
      const ruleY = y + 63 + (authorLayout?.used || 0);
      ctx.moveTo(x + w / 2 - 12, ruleY);
      ctx.lineTo(x + w / 2 + 12, ruleY);
      ctx.stroke();
    }
    ctx.restore();
  }

  async function render({ text, title, author, cover }) {
    if (text.length > 2000) throw new Error('Цитата слишком длинная для карточки. Выберите фрагмент короче.');
    const [background, coverImage] = await Promise.all([
      loadImage(BACKGROUND),
      cover ? loadImage(cover).catch(() => null) : null,
      document.fonts.load('48.5px ' + QUOTE_FONT, text),
      document.fonts.load('700 42px ' + SERIF, title),
      document.fonts.load('12px ' + SERIF, author),
      document.fonts.load('28px ' + SANS, author),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
    const quoteLayout = fit(ctx, text, { width: 860, height: 406, max: 48.5, min: 26, leading: 1.515, family: QUOTE_FONT, color: INK, measureInk: true });
    if (!quoteLayout) throw new Error('Цитата слишком длинная для карточки. Выберите фрагмент короче.');
    drawText(ctx, quoteLayout, 112, QUOTE_CENTER_Y - quoteLayout.used / 2);
    drawCover(ctx, coverImage, title, author);
    const titleLayout = fit(ctx, title, { width: 500, height: 68, max: 42, min: 18, leading: 1.07, family: SERIF, color: INK, bold: true, truncate: true });
    const authorLayout = fit(ctx, author, { width: 470, height: 36, max: 28, min: 12, leading: 1.1, family: SANS, color: '#71604e', truncate: true });
    drawText(ctx, titleLayout, 412, 880);
    drawText(ctx, authorLayout, 412, 890 + titleLayout.used);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG')), 'image/png');
    });
  }

  window.PolkaQuoteCard = { render };
})();
