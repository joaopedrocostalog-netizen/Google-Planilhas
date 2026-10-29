// Gráficos flutuantes sobre a planilha: desenho em SVG, mover, redimensionar e editor lateral.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const PALETTE = ['#e30613', '#1a1a1a', '#8c8c8c', '#f28b93', '#b8000c', '#4d4d4d', '#ffb3b8', '#c4c4c4'];
  const TYPES = [['column', 'Gráfico de colunas'], ['stacked', 'Colunas empilhadas'], ['bar', 'Gráfico de barras'], ['line', 'Gráfico de linhas'], ['area', 'Gráfico de área'], ['pie', 'Gráfico de pizza'], ['donut', 'Gráfico de rosca'], ['scatter', 'Gráfico de dispersão']];
  App.selectedChart = null;

  // ---------- Dados ----------
  function chartData(ch, si) {
    let M;
    try { M = App.evalRange(si, ch.range); } catch (e) { return null; }
    if (!M.length || !M[0].length) return null;
    const isNum = (v) => typeof v === 'number';
    const cols = M[0].length;
    // cabeçalho: primeira linha com texto nas colunas de dados
    let header = ch.headers;
    if (header === undefined || header === 'auto') header = M.length > 1 && M[0].slice(cols > 1 ? 1 : 0).some((v) => typeof v === 'string') && M[1].slice(cols > 1 ? 1 : 0).some(isNum);
    const rows = header ? M.slice(1) : M;
    let labelsCol = ch.labels;
    if (labelsCol === undefined || labelsCol === 'auto') labelsCol = cols > 1 && rows.some((r) => !isNum(r[0]) && r[0] !== null);
    if (ch.type === 'scatter' && cols > 1) labelsCol = true;
    const first = labelsCol ? 1 : 0;
    const series = [];
    for (let c = first; c < cols; c++) {
      series.push({
        name: header ? App.fmtValue(M[0][c]) || 'Série ' + (c - first + 1) : 'Série ' + (c - first + 1),
        values: rows.map((r) => (isNum(r[c]) ? r[c] : r[c] === true ? 1 : null)),
        color: (ch.colors && ch.colors[c - first]) || PALETTE[(c - first) % PALETTE.length],
      });
    }
    const labels = rows.map((r, i) => (labelsCol ? App.fmtValue(r[0], null) : String(i + 1)));
    const xNums = labelsCol ? rows.map((r) => (isNum(r[0]) ? r[0] : null)) : rows.map((_, i) => i + 1);
    return { labels, series, xNums, header, labelsCol, headerName: header && labelsCol ? App.fmtValue(M[0][0]) : '' };
  }

  // ---------- Desenho ----------
  const fmtTick = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi';
    if (a >= 1e6) return (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (a >= 1e4) return (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  };
  function niceScale(min, max, n) {
    if (min === max) { max = min + 1; min = Math.min(0, min); }
    const span = max - min, raw = span / n, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= n) || 10 * pow;
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
  }
  function render(ch, w, h, si) {
    const D = chartData(ch, si);
    const title = ch.title !== undefined ? ch.title : '';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, sans-serif"><rect width="${w}" height="${h}" fill="#ffffff"/>`;
    const top = title ? 40 : 16;
    if (title) svg += `<text x="${w / 2}" y="26" text-anchor="middle" font-size="15" font-weight="600" fill="#1a1a1a">${esc(title)}</text>`;
    if (!D || !D.series.length || !D.labels.length) return svg + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#6b6b6b">Sem dados no intervalo ${esc(ch.range)}</text></svg>`;
    const legendOn = ch.legend !== 'none' && (D.series.length > 1 || ch.type === 'pie' || ch.type === 'donut');
    const legendH = legendOn ? 28 : 0;
    if (ch.type === 'pie' || ch.type === 'donut') {
      const s = D.series[0];
      const vals = s.values.map((v) => Math.max(0, v || 0));
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const legendW = legendOn ? Math.min(200, w * 0.4) : 0;
      const cx = (w - legendW) / 2, cy = top + (h - top - 12) / 2, R = Math.max(10, Math.min((w - legendW) / 2, (h - top - 12) / 2) - 10);
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        const frac = v / total;
        if (frac <= 0) return;
        const a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
        const col = (ch.colors && ch.colors[i]) || PALETTE[i % PALETTE.length];
        if (frac >= 0.9999) svg += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${col}"/>`;
        else svg += `<path d="M${cx},${cy} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R} 0 ${large} 1 ${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)} Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>`;
        if (frac > 0.05) {
          const am = (a0 + a1) / 2, lr = ch.type === 'donut' ? R * 0.78 : R * 0.62;
          svg += `<text x="${cx + lr * Math.cos(am)}" y="${cy + lr * Math.sin(am) + 4}" text-anchor="middle" font-size="11" fill="${i % PALETTE.length === 6 || i % PALETTE.length === 7 ? '#1a1a1a' : '#ffffff'}">${(frac * 100).toFixed(1).replace('.', ',')}%</text>`;
        }
        a0 = a1;
      });
      if (ch.type === 'donut') svg += `<circle cx="${cx}" cy="${cy}" r="${R * 0.55}" fill="#ffffff"/>`;
      if (legendOn) {
        const lx = w - legendW + 8;
        D.labels.slice(0, Math.floor((h - top) / 20)).forEach((lb, i) => {
          svg += `<rect x="${lx}" y="${top + i * 20}" width="11" height="11" rx="2" fill="${(ch.colors && ch.colors[i]) || PALETTE[i % PALETTE.length]}"/><text x="${lx + 17}" y="${top + i * 20 + 10}" font-size="12" fill="#1a1a1a">${esc(lb.length > 22 ? lb.slice(0, 22) + '…' : lb)}</text>`;
        });
      }
      return svg + '</svg>';
    }
    const horizontal = ch.type === 'bar';
    const stacked = ch.type === 'stacked' || ch.stacked;
    let vmin = 0, vmax = 0;
    const n = D.labels.length;
    if (stacked) {
      for (let i = 0; i < n; i++) { let pos = 0, neg = 0; for (const s of D.series) { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; } vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg); }
    } else for (const s of D.series) for (const v of s.values) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    if (ch.type === 'line' || ch.type === 'scatter') {
      const all = D.series.flatMap((s) => s.values.filter((v) => v !== null));
      if (all.length) { vmin = Math.min(...all); vmax = Math.max(...all); if (vmin > 0 && vmin < vmax * 0.5) vmin = 0; }
    }
    const sc = niceScale(vmin, vmax, 5);
    const padL = horizontal ? Math.min(140, 12 + Math.max(...D.labels.map((l) => l.length)) * 6.5) : 14 + Math.max(...[sc.min, sc.max].map((v) => fmtTick(v).length)) * 7;
    const padB = legendH + (horizontal ? 26 : 34);
    const x0 = padL, y0 = top, pw = Math.max(10, w - padL - 18), ph = Math.max(10, h - top - padB);
    const vy = (v) => y0 + ph - ((v - sc.min) / (sc.max - sc.min)) * ph;
    const vx = (v) => x0 + ((v - sc.min) / (sc.max - sc.min)) * pw;
    // grade e eixo de valores
    for (let v = sc.min; v <= sc.max + sc.step / 2; v += sc.step) {
      if (horizontal) svg += `<line x1="${vx(v)}" x2="${vx(v)}" y1="${y0}" y2="${y0 + ph}" stroke="${Math.abs(v) < 1e-9 ? '#9a9a9a' : '#e6e6e6'}"/><text x="${vx(v)}" y="${y0 + ph + 16}" text-anchor="middle" font-size="11" fill="#5a5a5a">${fmtTick(v)}</text>`;
      else svg += `<line x1="${x0}" x2="${x0 + pw}" y1="${vy(v)}" y2="${vy(v)}" stroke="${Math.abs(v) < 1e-9 ? '#9a9a9a' : '#e6e6e6'}"/><text x="${x0 - 6}" y="${vy(v) + 4}" text-anchor="end" font-size="11" fill="#5a5a5a">${fmtTick(v)}</text>`;
    }
    const band = (horizontal ? ph : pw) / n;
    if (ch.type === 'scatter') {
      const xs = D.xNums.filter((v) => v !== null);
      const xsc = niceScale(Math.min(...xs, 0), Math.max(...xs, 1), 5);
      const px = (v) => x0 + ((v - xsc.min) / (xsc.max - xsc.min)) * pw;
      for (let v = xsc.min; v <= xsc.max + xsc.step / 2; v += xsc.step) svg += `<text x="${px(v)}" y="${y0 + ph + 16}" text-anchor="middle" font-size="11" fill="#5a5a5a">${fmtTick(v)}</text>`;
      D.series.forEach((s) => s.values.forEach((v, i) => { if (v !== null && D.xNums[i] !== null) svg += `<circle cx="${px(D.xNums[i])}" cy="${vy(v)}" r="4" fill="${s.color}" fill-opacity="0.85"/>`; }));
    } else if (ch.type === 'line' || ch.type === 'area') {
      D.series.forEach((s, si2) => {
        const pts = [];
        const acc = stacked ? D.labels.map((_, i) => D.series.slice(0, si2 + 1).reduce((a, x) => a + (x.values[i] || 0), 0)) : s.values;
        acc.forEach((v, i) => { if (v !== null) pts.push([x0 + band * (i + 0.5), vy(v)]); });
        if (!pts.length) return;
        if (ch.type === 'area') {
          const base = stacked && si2 > 0 ? D.labels.map((_, i) => D.series.slice(0, si2).reduce((a, x) => a + (x.values[i] || 0), 0)).map((v, i) => [x0 + band * (i + 0.5), vy(v)]).reverse() : [[pts[pts.length - 1][0], vy(Math.max(sc.min, 0))], [pts[0][0], vy(Math.max(sc.min, 0))]];
          svg += `<path d="M${pts.map((p) => p.join(',')).join(' L')} L${base.map((p) => p.join(',')).join(' L')} Z" fill="${s.color}" fill-opacity="0.28"/>`;
        }
        svg += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
        if (pts.length <= 40) pts.forEach((p) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${s.color}"/>`; });
      });
    } else {
      const groupW = band * 0.72;
      const bw = stacked ? groupW : groupW / D.series.length;
      for (let i = 0; i < n; i++) {
        let pos = 0, neg = 0;
        D.series.forEach((s, k) => {
          const v = s.values[i];
          if (v === null) return;
          let a, b;
          if (stacked) { if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg + v; b = neg; neg = a; } }
          else { a = Math.min(0, v); b = Math.max(0, v); }
          const off = band * i + (band - groupW) / 2 + (stacked ? 0 : bw * k);
          if (horizontal) svg += `<rect x="${vx(Math.max(a, sc.min))}" y="${y0 + off}" width="${Math.max(1, vx(b) - vx(Math.max(a, sc.min)))}" height="${Math.max(1, bw - 1)}" fill="${s.color}"/>`;
          else svg += `<rect x="${x0 + off}" y="${vy(b)}" width="${Math.max(1, bw - 1)}" height="${Math.max(1, vy(Math.max(a, sc.min)) - vy(b))}" fill="${s.color}"/>`;
        });
      }
    }
    // rótulos de categoria
    if (ch.type !== 'scatter') {
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horizontal ? ph : pw) / (horizontal ? 16 : 54)))));
      D.labels.forEach((lb, i) => {
        if (i % every) return;
        const t = esc(lb.length > 14 ? lb.slice(0, 13) + '…' : lb);
        if (horizontal) svg += `<text x="${x0 - 6}" y="${y0 + band * (i + 0.5) + 4}" text-anchor="end" font-size="11" fill="#1a1a1a">${t}</text>`;
        else svg += `<text x="${x0 + band * (i + 0.5)}" y="${y0 + ph + 16}" text-anchor="middle" font-size="11" fill="#1a1a1a">${t}</text>`;
      });
    }
    if (legendOn) {
      let lx = x0;
      const ly = h - 16;
      D.series.forEach((s) => {
        const nm = s.name.length > 20 ? s.name.slice(0, 20) + '…' : s.name;
        svg += `<rect x="${lx}" y="${ly - 9}" width="11" height="11" rx="2" fill="${s.color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="#1a1a1a">${esc(nm)}</text>`;
        lx += 30 + nm.length * 6.6;
      });
    }
    return svg + '</svg>';
  }
  App.renderChart = render;

  // ---------- Objetos flutuantes ----------
  let layer;
  const z = () => doc.zoom / 100;
  function sync(full) {
    const sh = App.sheet(), st = App.gridState;
    layer.style.left = st.hdrW + 'px';
    layer.style.top = st.hdrH + 'px';
    const ids = new Set(sh.charts.map((c) => c.id));
    layer.querySelectorAll('.chart-obj').forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
    for (const ch of sh.charts) {
      let el = layer.querySelector(`.chart-obj[data-id="${ch.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'chart-obj';
        el.dataset.id = ch.id;
        el.innerHTML = `<div class="chart-svg"></div><button class="chart-menu" title="Mais opções">${icon('more', 18)}</button>${['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((p) => `<i class="ch-h ch-${p}" data-h="${p}"></i>`).join('')}`;
        layer.appendChild(el);
        bindChart(el);
        full = true;
      }
      const W = ch.w * z(), H = ch.h * z();
      el.style.left = ch.x * z() - st.sx + 'px';
      el.style.top = ch.y * z() - st.sy + 'px';
      el.style.width = W + 'px';
      el.style.height = H + 'px';
      el.classList.toggle('selected', App.selectedChart === ch.id);
      if (ch.type === 'image') {
        if (el._src !== ch.src) { el.querySelector('.chart-svg').innerHTML = `<img src="${ch.src}" alt="" draggable="false">`; el._src = ch.src; el.classList.add('image-obj'); }
      } else if (full || el._size !== W + 'x' + H) { el.querySelector('.chart-svg').innerHTML = render(ch, Math.round(W), Math.round(H), doc.active); el._size = W + 'x' + H; }
    }
  }
  function findChart(id) { return App.sheet().charts.find((c) => c.id === id); }
  function bindChart(el) {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.chart-menu')) return;
      e.preventDefault(); e.stopPropagation();
      if (App.editing()) App.commitEdit();
      const ch = findChart(el.dataset.id);
      if (!ch) return;
      App.selectedChart = ch.id;
      sync(false);
      const handle = e.target.dataset.h;
      const start = { x: e.clientX, y: e.clientY, cx: ch.x, cy: ch.y, cw: ch.w, chh: ch.h };
      let moved = false;
      const move = (ev) => {
        const dx = (ev.clientX - start.x) / z(), dy = (ev.clientY - start.y) / z();
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (!handle) { ch.x = Math.max(0, start.cx + dx); ch.y = Math.max(0, start.cy + dy); }
        else {
          if (handle.includes('e')) ch.w = Math.max(160, start.cw + dx);
          if (handle.includes('s')) ch.h = Math.max(120, start.chh + dy);
          if (handle.includes('w')) { const nw = Math.max(160, start.cw - dx); ch.x = start.cx + (start.cw - nw); ch.w = nw; }
          if (handle.includes('n')) { const nh = Math.max(120, start.chh - dy); ch.y = start.cy + (start.chh - nh); ch.h = nh; }
        }
        sync(false);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (moved) {
          const fin = { x: ch.x, y: ch.y, w: ch.w, h: ch.h };
          Object.assign(ch, { x: start.cx, y: start.cy, w: start.cw, h: start.chh });
          App.change(handle ? 'Redimensionar gráfico' : 'Mover gráfico', () => Object.assign(ch, fin));
        }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    el.addEventListener('dblclick', () => { const ch = findChart(el.dataset.id); if (ch && ch.type !== 'image') openEditor(el.dataset.id); });
    el.querySelector('.chart-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      App.selectedChart = id; sync(false);
      const ch = findChart(id);
      if (ch && ch.type === 'image') {
        App.ui.menuPopup(e.currentTarget, [
          { label: 'Restaurar proporção original', action: () => { const im = new Image(); im.onload = () => App.change('Imagem', () => { ch.h = Math.round(ch.w * im.naturalHeight / im.naturalWidth); }); im.src = ch.src; } },
          { label: 'Excluir imagem', action: () => deleteChart(id) },
        ]);
        return;
      }
      App.ui.menuPopup(e.currentTarget, [
        { label: 'Editar gráfico', action: () => openEditor(id) },
        { label: 'Excluir gráfico', action: () => deleteChart(id) }, '-',
        { label: 'Baixar como PNG', action: () => exportChart(id, 'png') },
        { label: 'Baixar como SVG', action: () => exportChart(id, 'svg') },
      ]);
    });
  }
  function deleteChart(id) {
    const sh = App.sheet();
    App.change('Excluir gráfico', () => { sh.charts = sh.charts.filter((c) => c.id !== id); });
    App.selectedChart = null;
  }
  function exportChart(id, kind) {
    const ch = findChart(id);
    if (!ch) return;
    const svg = render(ch, Math.round(ch.w * 2), Math.round(ch.h * 2), doc.active).replace(/font-size="(\d+)"/g, (m, n) => `font-size="${n * 2}"`).replace(/stroke-width="([\d.]+)"/g, (m, n) => `stroke-width="${n * 2}"`);
    const name = (ch.title || 'grafico').replace(/[\\/:*?"<>|]+/g, '_');
    if (kind === 'svg') { App.io.downloadBlob(new Blob([render(ch, ch.w, ch.h, doc.active)], { type: 'image/svg+xml' }), name + '.svg'); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => App.io.downloadBlob(b, name + '.png'), 'image/png');
    };
    img.onerror = () => notify('Não foi possível gerar a imagem do gráfico.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---------- Inserir e editar ----------
  function insertChart() {
    const sh = App.sheet(), si = doc.active;
    let R = App.selRect();
    if (App.selIsCell()) R = App.dataRegion(si, App.sel.ar, App.sel.ac);
    if (R.r1 === 1 && R.r2 >= sh.rows) R = Object.assign({}, R, { r2: Math.max(1, App.usedRange(sh).maxR) });
    if (R.c1 === 1 && R.c2 >= sh.cols) R = Object.assign({}, R, { c2: Math.max(1, App.usedRange(sh).maxC) });
    let left = 0, topY = 0;
    for (let c = 1; c <= R.c2; c++) if (!App.isColHidden(sh, c)) left += sh.colW[c] || App.DEF_W;
    for (let r = 1; r < R.r1; r++) if (!App.isRowHidden(sh, r)) topY += sh.rowH[r] || App.DEF_H;
    const ch = { id: App.uid(), type: 'column', range: App.rangeText(R), x: left + 24, y: topY, w: 480, h: 300, title: '', headers: 'auto', labels: 'auto', legend: 'bottom', colors: [] };
    const D = chartData(ch, si);
    if (D && D.labels.length > 20 && D.series.length <= 3) ch.type = 'line';
    if (D && D.series.length) ch.title = D.series.length === 1 ? (D.header ? D.series[0].name : '') + (D.headerName ? ' por ' + D.headerName : '') : D.series.map((s) => s.name).join(' e ');
    App.change('Inserir gráfico', () => sh.charts.push(ch));
    App.selectedChart = ch.id;
    openEditor(ch.id);
  }
  // Imagem sobre as células: reduz para no máximo 1000 px para caber no armazenamento do navegador
  function insertImage() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const png = f.type === 'image/png' || f.type === 'image/gif' || f.type === 'image/svg+xml';
          const src = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85);
          const sh = App.sheet();
          let x = 0, y = 0;
          for (let cc = 1; cc < App.sel.ac; cc++) if (!App.isColHidden(sh, cc)) x += sh.colW[cc] || App.DEF_W;
          for (let r = 1; r < App.sel.ar; r++) if (!App.isRowHidden(sh, r)) y += sh.rowH[r] || App.DEF_H;
          const w = Math.min(400, c.width), h = Math.round(w * c.height / c.width);
          const ch = { id: App.uid(), type: 'image', src, x, y, w, h, range: '' };
          App.change('Inserir imagem', () => sh.charts.push(ch));
          App.selectedChart = ch.id;
          sync(true);
        };
        img.onerror = () => notify('Não foi possível ler esta imagem.');
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    inp.click();
  }

  function openEditor(id) {
    const sh = App.sheet();
    const ch = findChart(id);
    if (!ch) return;
    App.selectedChart = id;
    const original = JSON.parse(JSON.stringify(ch));
    const live = () => sync(true);
    const finish = () => {
      const fin = JSON.parse(JSON.stringify(ch));
      if (JSON.stringify(fin) === JSON.stringify(original)) return;
      Object.assign(ch, original);
      App.change('Editar gráfico', () => Object.assign(ch, fin));
    };
    const renderPanel = (body) => {
      const D = chartData(ch, doc.active);
      body.innerHTML = `
        <div class="sp-tabs"><button class="on" data-t="setup">Configurar</button><button data-t="custom">Personalizar</button></div>
        <div data-pane="setup">
          <label class="field"><span>Tipo de gráfico</span><select class="input" data-f="type">${TYPES.map(([k, l]) => `<option value="${k}"${ch.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <div class="chart-types">${TYPES.map(([k, l]) => `<button class="ct${ch.type === k ? ' on' : ''}" data-ct="${k}" title="${l}">${typeIcon(k)}</button>`).join('')}</div>
          <label class="field"><span>Intervalo de dados</span><input class="input" data-f="range" value="${esc(ch.range)}"></label>
          <label class="check"><input type="checkbox" data-f="headers"${D && D.header ? ' checked' : ''}> Usar a primeira linha como cabeçalho</label>
          <label class="check"><input type="checkbox" data-f="labels"${D && D.labelsCol ? ' checked' : ''}> Usar a primeira coluna como rótulos</label>
        </div>
        <div data-pane="custom" hidden>
          <label class="field"><span>Título do gráfico</span><input class="input" data-f="title" value="${esc(ch.title || '')}"></label>
          <label class="field"><span>Legenda</span><select class="input" data-f="legend"><option value="bottom"${ch.legend !== 'none' ? ' selected' : ''}>Mostrar</option><option value="none"${ch.legend === 'none' ? ' selected' : ''}>Nenhuma</option></select></label>
          <span class="sp-label">Cores ${ch.type === 'pie' || ch.type === 'donut' ? 'das fatias' : 'das séries'}</span>
          <div class="series-colors">${(ch.type === 'pie' || ch.type === 'donut' ? (D ? D.labels : []) : (D ? D.series.map((s) => s.name) : [])).slice(0, 12).map((name, i) => `<label class="sc-row"><input type="color" data-color="${i}" value="${(ch.colors && ch.colors[i]) || PALETTE[i % PALETTE.length]}"><span>${esc(name)}</span></label>`).join('')}</div>
        </div>
        <div class="sp-foot"><button class="btn sp-remove">Excluir gráfico</button><button class="btn btn-primary sp-done">Concluído</button></div>`;
      body.querySelectorAll('.sp-tabs button').forEach((b) => b.onclick = () => {
        body.querySelectorAll('.sp-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        body.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.t; });
      });
      const q = (f) => body.querySelector(`[data-f="${f}"]`);
      q('type').onchange = () => { ch.type = q('type').value; live(); renderPanel(body); };
      body.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => { ch.type = b.dataset.ct; live(); renderPanel(body); });
      q('range').onchange = () => { if (App.parseRange(q('range').value)) { ch.range = q('range').value.trim(); live(); renderPanel(body); } else notify('Intervalo inválido.'); };
      q('headers').onchange = () => { ch.headers = q('headers').checked; live(); };
      q('labels').onchange = () => { ch.labels = q('labels').checked; live(); };
      q('title').oninput = () => { ch.title = q('title').value; live(); };
      q('legend').onchange = () => { ch.legend = q('legend').value; live(); };
      body.querySelectorAll('[data-color]').forEach((inp) => inp.oninput = () => { ch.colors = ch.colors || []; ch.colors[+inp.dataset.color] = inp.value; live(); });
      body.querySelector('.sp-remove').onclick = () => { App.panels.close(); deleteChart(id); };
      body.querySelector('.sp-done').onclick = () => App.panels.close();
    };
    App.panels.open('Editor de gráfico', renderPanel, finish);
    void sh;
  }
  function typeIcon(k) {
    const p = {
      column: 'M5 20V12M10 20V6M15 20v-9M20 20V9', stacked: 'M5 20v-7M5 13v-3M11 20v-9M11 11V5M17 20v-5M17 15v-4',
      bar: 'M4 6h9M4 10h15M4 14h7M4 18h12', line: 'm4 17 5-6 4 3 7-8', area: 'M4 20V15l5-6 4 3 7-7v15z',
      pie: 'M12 4a8 8 0 1 0 8 8h-8z', donut: 'M12 4a8 8 0 1 0 8 8', scatter: 'M6 16h.01M10 10h.01M14 13h.01M18 6h.01M8 7h.01M17 16h.01',
    }[k];
    return `<svg width="26" height="26" viewBox="0 0 24 24"><path d="${p}" fill="${k === 'area' || k === 'pie' ? 'currentColor' : 'none'}" fill-opacity="${k === 'area' ? 0.3 : 1}" stroke="currentColor" stroke-width="${k === 'scatter' ? 3.2 : 2}" stroke-linecap="round"/></svg>`;
  }

  function init() {
    layer = $('charts-layer');
    App.on('viewport', () => sync(false));
    App.on('change', () => sync(true));
    App.on('sheet', () => { App.selectedChart = null; layer.innerHTML = ''; sync(true); });
    App.on('zoom', () => sync(true));
    App.on('gridMouseDown', () => { if (App.selectedChart) { App.selectedChart = null; sync(false); } });
    document.addEventListener('keydown', (e) => {
      if (!App.selectedChart || App.editing() || /input|textarea|select/i.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); deleteChart(App.selectedChart); }
      if (e.key === 'Escape') { App.selectedChart = null; sync(false); }
    }, true);
    App.commands.def('insertChart', 'Gráfico', insertChart, 'Ctrl+Alt+R');
    App.commands.def('insertImage', 'Inserir imagem sobre as células', insertImage);
    App.commands.def('insertCellImage', 'Inserir imagem na célula', () => {
      App.ui.prompt('Imagem na célula', 'Endereço da imagem (https://…)', '', (url) => {
        url = url.trim();
        if (!/^https?:\/\//i.test(url)) return notify('Use um endereço que comece com http:// ou https://.');
        const sh = App.sheet(), s = App.sel;
        App.change('Imagem na célula', () => App.setRaw(sh, s.ar, s.ac, `=IMAGEM("${url.replace(/"/g, '""')}")`));
      });
    });
    sync(true);
  }
  App.charts = { init, sync, render, insertChart, openEditor };
})(window.App);
