// The forecast chart on the report: one line (where the balance is headed,
// day by day), a wash under it, their floor as a labelled reference line,
// and the lowest point marked. Hovering (or the arrow keys, once it's
// focused) shows the day and balance. Plain SVG: nothing to load.

(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#1B2349';     // the line and its wash (navy)
  const SLATE = '#4A5275';   // axis text, the floor
  const GRID = '#E4E0D6';    // hairlines

  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  /// Round tick values that cover [lo, hi].
  function ticks(lo, hi, count) {
    const span = hi - lo || Math.abs(hi) || 1;
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  /// Draws [points] ({on: 'YYYY-MM-DD', dollars}) into [box]. [floor] in dollars
  /// (0 or null: none). [money] and [day] format values and dates.
  function draw(box, { points, floor, money, moneyShort, day }) {
    box.replaceChildren();
    if (!points.length) return;
    const width = Math.max(box.clientWidth, 280);
    const height = width < 480 ? 220 : 260;
    const pad = { l: width < 480 ? 52 : 64, r: 16, t: 18, b: 30 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const values = points.map((p) => p.dollars);
    let lo = Math.min(...values, floor || Infinity);
    let hi = Math.max(...values, floor || -Infinity);
    if (lo > 0) lo = Math.max(0, lo - (hi - lo) * 0.15);
    const ys = ticks(lo, hi, 4);
    lo = Math.min(lo, ys[0]);
    hi = Math.max(hi, ys[ys.length - 1]);
    const x = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const y = (v) => pad.t + h - ((v - lo) / (hi - lo || 1)) * h;

    const svg = el('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: '0',
      'aria-label': `Forecast balance from ${day(points[0].on)} to ${day(points[points.length - 1].on)}`,
    }, box);

    // Hairline grid and the y axis.
    const compact = Math.max(...ys.map(Math.abs)) >= 10000;
    for (const v of ys) {
      el('line', { x1: pad.l, x2: pad.l + w, y1: y(v), y2: y(v), stroke: GRID, 'stroke-width': 1 }, svg);
      const t = el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', fill: SLATE, 'font-size': 12 }, svg);
      t.textContent = moneyShort(v, compact);
    }
    // A few days along the bottom.
    const every = Math.max(1, Math.round(points.length / (width < 480 ? 3 : 6)));
    for (let i = 0; i < points.length; i += every) {
      const t = el('text', { x: x(i), y: height - 8, 'text-anchor': i === 0 ? 'start' : 'middle', fill: SLATE, 'font-size': 12 }, svg);
      t.textContent = day(points[i].on);
    }

    // The wash, then the line.
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.dollars).toFixed(1)}`).join('');
    const base = y(Math.max(lo, Math.min(0, hi)));
    el('path', { d: `${line}L${x(points.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`, fill: INK, 'fill-opacity': 0.1 }, svg);
    el('path', { d: line, fill: 'none', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

    // Their floor: a reference line, labelled.
    if (floor) {
      el('line', { x1: pad.l, x2: pad.l + w, y1: y(floor), y2: y(floor), stroke: SLATE, 'stroke-width': 1.5 }, svg);
      const t = el('text', { x: pad.l + w, y: y(floor) - 6, 'text-anchor': 'end', fill: SLATE, 'font-size': 12, 'font-weight': 600 }, svg);
      t.textContent = `Floor ${money(floor)}`;
    }

    // The lowest point.
    let low = 0;
    values.forEach((v, i) => { if (v < values[low]) low = i; });
    el('circle', { cx: x(low), cy: y(values[low]), r: 5, fill: INK, stroke: '#fff', 'stroke-width': 2 }, svg);
    // Beside the mark and a little above it, on whichever side has room,
    // clear of the floor line below.
    const roomRight = pad.l + w - x(low) > 190;
    const lowLabel = el('text', {
      x: roomRight ? x(low) + 10 : x(low) - 10, y: Math.max(y(values[low]) - 10, pad.t + 12),
      'text-anchor': roomRight ? 'start' : 'end', fill: INK, 'font-size': 12, 'font-weight': 600,
    }, svg);
    lowLabel.textContent = `Lowest ${money(values[low])}, ${day(points[low].on)}`;

    // Hover: a crosshair at the nearest day, and its balance.
    const cross = el('line', { y1: pad.t, y2: pad.t + h, stroke: SLATE, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dot = el('circle', { r: 5, fill: INK, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    const tipValue = document.createElement('strong');
    const tipDay = document.createElement('span');
    tip.append(tipValue, tipDay);
    box.appendChild(tip);
    let at = -1;
    function show(i) {
      at = Math.max(0, Math.min(points.length - 1, i));
      const px = x(at);
      const py = y(points[at].dollars);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
      tipValue.textContent = money(points[at].dollars);
      tipDay.textContent = day(points[at].on);
      tip.hidden = false;
      const left = Math.min(Math.max(px - tip.offsetWidth / 2, 0), width - tip.offsetWidth);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(py - tip.offsetHeight - 12, 0)}px`;
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }
    const hit = el('rect', { x: pad.l, y: pad.t, width: w, height: h, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      show(Math.round(((px - pad.l) / w) * (points.length - 1)));
    });
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        show((at < 0 ? 0 : at) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  }

  window.WaterlineChart = { draw };
})();
