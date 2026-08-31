/* Go30 scorecard mockups — shared chart primitives.
 *
 * Every option in this folder draws through these, so the marks, hover behaviour and table
 * fallback are identical across the set and a reviewer is comparing LAYOUTS, not five different
 * chart implementations. Mark specs follow the dataviz house rules: 2px lines, >=8px markers,
 * 4px rounded data-ends, a 2px surface gap between adjacent fills, recessive grid, hover on
 * everything that plots, and a table view behind every chart (the light-mode team palette sits
 * below 3:1 on the card surface, so a text label or table is mandatory relief, not a nicety).
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // --- single shared tooltip -------------------------------------------------
  var tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = el('div', 'tip'); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function bindTip(node, htmlFn) {
    function move(e) {
      var t = tip();
      t.innerHTML = htmlFn();
      t.classList.add('on');
      var x = e.clientX + 14, y = e.clientY + 14;
      var r = t.getBoundingClientRect();
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
      t.style.left = x + 'px'; t.style.top = y + 'px';
    }
    node.addEventListener('mousemove', move);
    node.addEventListener('mouseenter', move);
    node.addEventListener('mouseleave', function () { tip().classList.remove('on'); });
    node.addEventListener('touchstart', function (e) { move(e.touches[0]); }, { passive: true });
  }

  /** Donut showing one percentage. Single series, so no legend — the caption names it. */
  function donut(pct, size, color, centerTop, centerSub) {
    var stroke = Math.max(6, Math.round(size * 0.11));
    var rad = (size - stroke) / 2, c = 2 * Math.PI * rad;
    var s = svg('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img' });
    s.appendChild(svg('circle', { cx: size / 2, cy: size / 2, r: rad, fill: 'none', stroke: 'var(--track)', 'stroke-width': stroke }));
    s.appendChild(svg('circle', {
      cx: size / 2, cy: size / 2, r: rad, fill: 'none', stroke: color, 'stroke-width': stroke,
      'stroke-linecap': 'round', 'stroke-dasharray': c,
      'stroke-dashoffset': c * (1 - Math.min(1, Math.max(0, pct / 100))),
      transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
    }));
    if (centerTop != null) {
      var t = svg('text', { x: size / 2, y: size / 2, 'text-anchor': 'middle', fill: 'var(--text)',
        'font-size': Math.round(size * 0.26), 'font-weight': 'bold', 'font-family': 'inherit', dy: centerSub ? '-.05em' : '.35em' });
      t.textContent = centerTop; s.appendChild(t);
    }
    if (centerSub) {
      var u = svg('text', { x: size / 2, y: size / 2, 'text-anchor': 'middle', fill: 'var(--text-muted)',
        'font-size': Math.round(size * 0.13), 'font-family': 'inherit', dy: '1.35em' });
      u.textContent = centerSub; s.appendChild(u);
    }
    return s;
  }

  /**
   * Multi-series line chart with a crosshair + tooltip. `series` = [{name, color, values}].
   * Series are direct-labelled at their end point (<=6 of them) AND legended by the caller.
   */
  function lineChart(series, opts) {
    opts = opts || {};
    var w = opts.width || 680, h = opts.height || 220;
    var pad = { t: 10, r: opts.labelGutter == null ? 78 : opts.labelGutter, b: 22, l: 34 };
    var n = series[0].values.length;
    var all = series.reduce(function (a, s) { return a.concat(s.values); }, []);
    var min = Math.min(0, Math.min.apply(null, all)), max = Math.max.apply(null, all);
    var pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    var X = function (i) { return pad.l + (n === 1 ? 0 : (i / (n - 1)) * pw); };
    var Y = function (v) { return pad.t + ph - ((v - min) / (max - min || 1)) * ph; };

    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, role: 'img',
      'aria-label': opts.ariaLabel || 'line chart' });

    // Recessive grid + axis ticks on "nice" round steps (1/2/5 x 10^n) rather than max/4, so the
    // axis reads 0-5-10-15-20 instead of 0-5.3-10.6-15.9-21.2.
    var rawStep = (max - min) / 4;
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var norm = rawStep / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var tickVals = [];
    for (var tv = Math.ceil(min / step) * step; tv <= max + 1e-9; tv += step) tickVals.push(tv);
    for (var g = 0; g < tickVals.length; g++) {
      var v = tickVals[g], y = Y(v);
      s.appendChild(svg('line', { x1: pad.l, x2: w - pad.r, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      var lab = svg('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', fill: 'var(--text-faint)', 'font-size': 10, 'font-family': 'inherit' });
      lab.textContent = Math.abs(v) < 1e-9 ? '0' : (step < 1 ? v.toFixed(1) : String(Math.round(v)));
      s.appendChild(lab);
    }
    [0, Math.round((n - 1) / 2), n - 1].forEach(function (i) {
      var t = svg('text', { x: X(i), y: h - 6, 'text-anchor': i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle'),
        fill: 'var(--text-faint)', 'font-size': 10, 'font-family': 'inherit' });
      t.textContent = (opts.xLabel || 'Day ') + (i + 1);
      s.appendChild(t);
    });

    series.forEach(function (ser) {
      var d = ser.values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      s.appendChild(svg('path', { d: d, fill: 'none', stroke: ser.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      // 2px surface ring so overlapping end markers stay separable.
      s.appendChild(svg('circle', { cx: X(n - 1), cy: Y(ser.values[n - 1]), r: 4.5, fill: ser.color,
        stroke: 'var(--card-bg)', 'stroke-width': 2 }));
    });

    // Direct end-labels, pushed apart so near-tied series stay readable (the failure mode this
    // chart hits first: four teams finishing within a point of each other overprint each other).
    var LABEL_GAP = 12;
    var placed = series.map(function (ser, i) { return { ser: ser, y: Y(ser.values[n - 1]), i: i }; })
      .sort(function (a, b) { return a.y - b.y; });
    for (var q = 1; q < placed.length; q++) {
      if (placed[q].y - placed[q - 1].y < LABEL_GAP) placed[q].y = placed[q - 1].y + LABEL_GAP;
    }
    var overflow = placed.length ? placed[placed.length - 1].y - (pad.t + ph) : 0;
    if (overflow > 0) placed.forEach(function (pl) { pl.y -= overflow; });
    placed.forEach(function (pl) {
      var trueY = Y(pl.ser.values[n - 1]);
      if (Math.abs(pl.y - trueY) > 2) {
        // Leader line back to the real end point, so a nudged label still points at its series.
        s.appendChild(svg('path', {
          d: 'M' + (X(n - 1) + 4) + ' ' + trueY + ' L' + (X(n - 1) + 9) + ' ' + pl.y,
          fill: 'none', stroke: pl.ser.color, 'stroke-width': 1, opacity: .6
        }));
      }
      var lbl = svg('text', { x: X(n - 1) + 11, y: pl.y + 4, fill: 'var(--text)', 'font-size': 11, 'font-family': 'inherit' });
      lbl.textContent = pl.ser.name;
      s.appendChild(lbl);
    });

    // Crosshair + hover band
    var cross = svg('line', { x1: 0, x2: 0, y1: pad.t, y2: pad.t + ph, stroke: 'var(--text-faint2)', 'stroke-width': 1, opacity: 0 });
    s.appendChild(cross);
    var hit = svg('rect', { x: pad.l, y: pad.t, width: pw, height: ph, fill: 'transparent' });
    s.appendChild(hit);
    var hoverIdx = 0;
    hit.addEventListener('mousemove', function (e) {
      var box = s.getBoundingClientRect();
      var rel = ((e.clientX - box.left) / box.width) * w;
      hoverIdx = Math.max(0, Math.min(n - 1, Math.round(((rel - pad.l) / pw) * (n - 1))));
      cross.setAttribute('x1', X(hoverIdx)); cross.setAttribute('x2', X(hoverIdx));
      cross.setAttribute('opacity', 1);
    });
    hit.addEventListener('mouseleave', function () { cross.setAttribute('opacity', 0); });
    bindTip(hit, function () {
      return '<strong>' + (opts.xLabel || 'Day ') + (hoverIdx + 1) + '</strong><br>' +
        series.slice().sort(function (a, b) { return b.values[hoverIdx] - a.values[hoverIdx]; })
          .map(function (ser) {
            return '<span style="color:' + ser.color + '">■</span> ' + esc(ser.name) + ' ' +
              ser.values[hoverIdx].toFixed(1);
          }).join('<br>');
    });
    return s;
  }

  /** Legend chips — always rendered for >=2 series; identity is never colour-alone. */
  function legend(items) {
    var n = el('div', 'legend');
    items.forEach(function (it) {
      n.appendChild(el('span', null, '<i style="background:' + it.color + '"></i>' + esc(it.name)));
    });
    return n;
  }

  /** Collapsible table view behind a chart (the accessibility fallback, on every option). */
  function tableView(headers, rows) {
    var box = el('div');
    var btn = el('button', 'tbl-toggle', '▸ Show the numbers');
    var tbl = el('div', 'scroll-x');
    tbl.hidden = true;
    tbl.innerHTML = '<table class="data"><thead><tr>' +
      headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>';
    btn.addEventListener('click', function () {
      tbl.hidden = !tbl.hidden;
      btn.textContent = (tbl.hidden ? '▸ Show' : '▾ Hide') + ' the numbers';
    });
    box.appendChild(btn); box.appendChild(tbl);
    return box;
  }

  /** The five-option switcher, so a reviewer can flip between mockups without going back. */
  var OPTIONS = [
    ['index.html', 'Overview'],
    ['option-a-him-ladder.html', 'A · HIM Ladder'],
    ['option-b-team-race.html', 'B · Team Race'],
    ['option-c-awards-wall.html', 'C · Awards Wall'],
    ['option-d-consistency-grid.html', 'D · Consistency Grid'],
    ['option-e-my-standing.html', 'E · Where I Stand']
  ];
  function optnav(current) {
    var n = el('div', 'optnav');
    OPTIONS.forEach(function (o) {
      var a = el('a', o[0] === current ? 'on' : null, o[1]);
      a.href = o[0];
      n.appendChild(a);
    });
    return n;
  }

  global.Viz = { svg: svg, el: el, esc: esc, bindTip: bindTip, donut: donut, lineChart: lineChart,
    legend: legend, tableView: tableView, optnav: optnav, OPTIONS: OPTIONS };
})(window);
