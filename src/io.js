// Entrada e saída de dados, localizar, gráficos, ordenação e planilhas (abas).
(function () {
  'use strict';
  const A = window.App;
  const E = window.GridEngine;
  const $ = (id) => document.getElementById(id);

  // ---------- Utilidades ----------
  const notify = (m) => window.Features && window.Features.notify(m);
  const safeName = (s) => (s || 'planilha').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'planilha';
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  // Intervalo usado (maior linha/coluna com conteúdo)
  function usedRange(sh) {
    let maxR = 0, maxC = 0;
    for (const a in sh.cells) {
      const c = sh.cells[a];
      if (!c || c.v === '' || c.v === undefined) continue;
      const p = E.parseAddr(a);
      if (!p) continue;
      maxR = Math.max(maxR, p.row);
      maxC = Math.max(maxC, p.col);
    }
    return { maxR: maxR || 1, maxC: maxC || 1 };
  }
  function displayAt(sh, r, c) {
    const a = E.addrToStr(r, c);
    const cell = sh.cells[a];
    const v = cell && cell.v !== '' ? sh.eng.value(a) : null;
    return A.fmt(v, (cell && cell.s) || {});
  }

  // ---------- Documento ----------
  function newDocument() {
    if (!confirm('Criar uma nova planilha? O conteúdo atual será substituído (use Desfazer para voltar).')) return;
    A.pushUndo();
    A.doc.sheets = [A.newSheet('Planilha1')];
    A.doc.active = 0;
    A.doc.title = 'Planilha sem título';
    A.rebuildEngine(A.doc.sheets[0]);
    A.el.title.value = A.doc.title;
    A.S.ar = A.S.er = A.S.ac = A.S.ec = 1;
    A.layout();
    A.updateTabs();
    A.refresh();
    A.markDirty();
  }

  function exportJSON() {
    const payload = {
      app: 'Planilhas', version: 1, title: A.doc.title, zoom: A.doc.zoom, active: A.doc.active,
      sheets: A.doc.sheets.map((s) => ({ name: s.name, cells: s.cells, colW: s.colW, rowH: s.rowH, gridlines: s.gridlines })),
    };
    download(safeName(A.doc.title) + '.json', JSON.stringify(payload, null, 2), 'application/json');
    notify('Backup baixado');
  }

  function exportCSV() {
    const sh = A.sheet();
    const { maxR, maxC } = usedRange(sh);
    const lines = [];
    for (let r = 1; r <= maxR; r++) {
      const row = [];
      for (let c = 1; c <= maxC; c++) {
        const t = displayAt(sh, r, c);
        row.push(/[",;\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
      }
      lines.push(row.join(','));
    }
    download(safeName(sh.name) + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    notify('CSV baixado');
  }

  // CSV simples com aspas. Detecta ';' ou ',' como separador.
  function parseCSV(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function openFile(f) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        if (/\.json$/i.test(f.name)) {
          const d = JSON.parse(text);
          if (!d || !Array.isArray(d.sheets) || !d.sheets.length) throw new Error('formato');
          A.pushUndo();
          A.doc.title = d.title || f.name.replace(/\.json$/i, '');
          A.doc.zoom = d.zoom || 100;
          A.doc.sheets = d.sheets.map((s) => Object.assign(A.newSheet(s.name), s));
          A.doc.sheets.forEach(A.rebuildEngine);
          A.doc.active = Math.min(d.active || 0, A.doc.sheets.length - 1);
          A.el.title.value = A.doc.title;
          A.el.zoom.value = String(A.doc.zoom);
        } else {
          const rows = parseCSV(text);
          const sh = A.newSheet(f.name.replace(/\.csv$/i, '').slice(0, 31) || 'Importado');
          rows.forEach((row, r) => row.forEach((v, c) => {
            if (v === '') return;
            const a = E.addrToStr(r + 1, c + 1);
            sh.cells[a] = { v };
          }));
          A.rebuildEngine(sh);
          A.pushUndo();
          A.doc.sheets.push(sh);
          A.doc.active = A.doc.sheets.length - 1;
        }
        A.S.ar = A.S.er = A.S.ac = A.S.ec = 1;
        A.layout(); A.updateTabs(); A.refresh(); A.markDirty();
        notify('Arquivo aberto');
      } catch (e) {
        notify('Não foi possível abrir este arquivo');
      }
    };
    reader.readAsText(f, 'utf-8');
  }

  // ---------- Impressão ----------
  function print() {
    const sh = A.sheet();
    const { maxR, maxC } = usedRange(sh);
    let html = `<h2>${A.esc(A.doc.title)} · ${A.esc(sh.name)}</h2><table><tbody>`;
    for (let r = 1; r <= maxR; r++) {
      html += '<tr>';
      for (let c = 1; c <= maxC; c++) html += `<td>${A.esc(displayAt(sh, r, c))}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('print-area').innerHTML = html;
    window.print();
  }

  // ---------- Localizar ----------
  const find = { query: '', list: [], idx: -1 };
  function openFind() {
    $('findbar').hidden = false;
    const inp = $('find-input');
    inp.focus();
    inp.select();
    if (find.query) runFind(inp.value, true);
  }
  function closeFind() {
    $('findbar').hidden = true;
    A.S.found = null;
    find.list = []; find.idx = -1;
    A.renderCells();
    A.el.viewport.focus({ preventScroll: true });
  }
  function runFind(query, keepIdx) {
    find.query = query;
    const q = query.toLowerCase();
    const sh = A.sheet();
    const { maxR, maxC } = usedRange(sh);
    find.list = [];
    if (q) {
      for (let r = 1; r <= maxR; r++) for (let c = 1; c <= maxC; c++) {
        if (displayAt(sh, r, c).toLowerCase().includes(q)) find.list.push(E.addrToStr(r, c));
      }
    }
    if (!keepIdx) find.idx = -1;
    if (find.idx >= find.list.length) find.idx = -1;
    updateFoundState();
    if (find.list.length && find.idx < 0) gotoFind(0);
    else updateFindCount();
  }
  function gotoFind(i) {
    if (!find.list.length) return;
    find.idx = ((i % find.list.length) + find.list.length) % find.list.length;
    const a = E.parseAddr(find.list[find.idx]);
    A.S.found = { has: (x) => find.list.includes(x), cur: find.list[find.idx] };
    A.select(a.row, a.col, false);
    updateFindCount();
  }
  function updateFoundState() {
    const set = new Set(find.list);
    A.S.found = find.query ? { has: (x) => set.has(x), cur: find.list[find.idx] || null } : null;
    A.renderCells();
  }
  function updateFindCount() {
    const n = find.list.length;
    $('find-count').textContent = !find.query ? '' : n ? `${find.idx + 1} de ${n}` : 'Nenhum resultado';
  }
  function wireFind() {
    const inp = $('find-input');
    inp.addEventListener('input', () => runFind(inp.value, false));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (find.list.length) gotoFind(find.idx + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    $('find-next').addEventListener('click', () => { if (find.list.length) gotoFind(find.idx + 1); });
    $('find-close').addEventListener('click', closeFind);
  }

  // ---------- Ordenação ----------
  function rankOf(v) {
    if (v === null || v === undefined || v === '') return 3;
    if (typeof v === 'number') return 0;
    if (typeof v === 'boolean') return 2;
    return 1;
  }
  function sortRange(desc) {
    const R = A.rect();
    if (R.r1 === R.r2) { notify('Selecione pelo menos duas linhas para ordenar'); return; }
    const keyCol = Math.min(R.c2, Math.max(R.c1, A.S.ac));
    const sh = A.sheet();
    const rows = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const cells = [];
      for (let c = R.c1; c <= R.c2; c++) cells.push(A.cellAt(r, c) ? JSON.parse(JSON.stringify(A.cellAt(r, c))) : null);
      rows.push({ key: A.valueOf(r, keyCol), cells });
    }
    rows.sort((x, y) => {
      const rx = rankOf(x.key), ry = rankOf(y.key);
      if (rx === 3 || ry === 3) return rx - ry; // vazios sempre no fim
      let cmp;
      if (rx !== ry) cmp = rx - ry;
      else if (rx === 0 || rx === 2) cmp = Number(x.key) - Number(y.key);
      else cmp = String(x.key).localeCompare(String(y.key), 'pt-BR', { sensitivity: 'base', numeric: true });
      return desc ? -cmp : cmp;
    });
    A.pushUndo();
    rows.forEach((row, i) => {
      const r = R.r1 + i;
      row.cells.forEach((obj, j) => {
        const c = R.c1 + j;
        const a = E.addrToStr(r, c);
        if (!obj || (obj.v === '' && !obj.s)) delete sh.cells[a];
        else sh.cells[a] = obj;
      });
    });
    A.rebuildEngine(sh);
    A.refresh();
    A.markDirty();
    notify(desc ? 'Ordenado de Z a A' : 'Ordenado de A a Z');
  }

  // ---------- Gráficos (desenhados em SVG a partir de um intervalo) ----------
  const PALETTE = ['#e30613', '#1a1a1a', '#8c8c8c', '#f48b93', '#4d4d4d', '#b8000c', '#c9c9c9'];
  function openChart() {
    const R = A.rect();
    $('chart-range').value = `${E.addrToStr(R.r1, R.c1)}:${E.addrToStr(R.r2, R.c2)}`;
    $('chart-dialog').showModal();
    drawChart();
  }
  function parseRange(text) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text || '');
    if (!m) return null;
    const a = E.parseAddr(m[1] + m[2]);
    const b = m[3] ? E.parseAddr(m[3] + m[4]) : a;
    if (!a || !b) return null;
    return { r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row), c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col) };
  }
  function drawChart() {
    const out = $('chart-output');
    const R = parseRange($('chart-range').value);
    if (!R) { out.innerHTML = '<p>Intervalo inválido. Use algo como A1:B10.</p>'; return; }
    const type = $('chart-type').value;
    const sh = A.sheet();
    const val = (r, c) => A.valueOf(r, c);
    // Cabeçalho: se a primeira linha tiver texto nas colunas de dados, ela vira nomes de série
    const dataCols = [];
    for (let c = R.c1 + 1; c <= R.c2; c++) dataCols.push(c);
    let startRow = R.r1;
    let names = dataCols.map((c) => String(val(R.r1, c) ?? ''));
    if (R.r2 > R.r1 && dataCols.some((c) => typeof val(R.r1, c) === 'string') &&
        dataCols.every((c) => typeof val(R.r1 + 1, c) === 'number')) {
      startRow = R.r1 + 1;
    } else {
      names = dataCols.map((c) => 'Série ' + (c - R.c1));
    }
    if (dataCols.length === 0) { // uma coluna só: valores com índice
      dataCols.push(R.c1);
      names = ['Valores'];
    }
    const labels = [];
    const series = dataCols.map(() => []);
    for (let r = startRow; r <= R.r2; r++) {
      const lbl = R.c2 > R.c1 || dataCols[0] !== R.c1 ? displayAt(sh, r, R.c1) : String(r - startRow + 1);
      labels.push(lbl);
      dataCols.forEach((c, i) => { const v = val(r, c); series[i].push(typeof v === 'number' ? v : 0); });
    }
    if (!labels.length) { out.innerHTML = '<p>Nenhum dado no intervalo.</p>'; return; }
    out.innerHTML = type === 'pie' ? pieSvg(labels, series[0]) : barLineSvg(type, labels, series, names);
  }
  function barLineSvg(type, labels, series, names) {
    const W = 720, H = 320, pad = { l: 56, r: 16, t: 16, b: 56 };
    const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
    const all = series.flat();
    let max = Math.max(0, ...all), min = Math.min(0, ...all);
    if (max === min) max = min + 1;
    const y = (v) => pad.t + innerH - ((v - min) / (max - min)) * innerH;
    const n = labels.length;
    const x = (i) => pad.l + (innerW * (i + 0.5)) / n;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = min + ((max - min) * k) / 4;
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e6e6e6"/>`;
      g += `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b6b6b">${Number(v.toPrecision(3)).toLocaleString('pt-BR')}</text>`;
    }
    if (type === 'bar') {
      const gw = innerW / n, bw = Math.max(4, (gw * 0.7) / series.length);
      series.forEach((s, si) => s.forEach((v, i) => {
        const x0 = pad.l + gw * i + gw * 0.15 + bw * si;
        const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
        g += `<rect x="${x0}" y="${top}" width="${bw - 2}" height="${Math.max(1, bottom - top)}" fill="${PALETTE[si % PALETTE.length]}"/>`;
      }));
    } else {
      series.forEach((s, si) => {
        const pts = s.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        g += `<polyline points="${pts}" fill="none" stroke="${PALETTE[si % PALETTE.length]}" stroke-width="2.5"/>`;
        s.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${PALETTE[si % PALETTE.length]}"/>`; });
      });
    }
    labels.forEach((lb, i) => {
      g += `<text x="${x(i)}" y="${H - pad.b + 18}" text-anchor="middle" font-size="11" fill="#1a1a1a">${A.esc(lb).slice(0, 14)}</text>`;
    });
    let legend = '';
    names.forEach((nm, si) => {
      legend += `<rect x="${pad.l + si * 130}" y="${H - 14}" width="12" height="12" fill="${PALETTE[si % PALETTE.length]}"/>`;
      legend += `<text x="${pad.l + si * 130 + 18}" y="${H - 4}" font-size="12" fill="#1a1a1a">${A.esc(nm)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${g}${legend}</svg>`;
  }
  function pieSvg(labels, values) {
    const W = 720, H = 320, cx = 200, cy = 160, rad = 130;
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    let angle = -Math.PI / 2, paths = '', legend = '';
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total;
      const a2 = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + rad * Math.cos(angle), y1 = cy + rad * Math.sin(angle);
      const x2 = cx + rad * Math.cos(a2), y2 = cy + rad * Math.sin(a2);
      const col = PALETTE[i % PALETTE.length];
      if (frac > 0) paths += `<path d="M${cx},${cy} L${x1},${y1} A${rad},${rad} 0 ${large} 1 ${x2},${y2} Z" fill="${col}" stroke="#fff"/>`;
      legend += `<rect x="430" y="${40 + i * 24}" width="12" height="12" fill="${col}"/>`;
      legend += `<text x="450" y="${51 + i * 24}" font-size="12" fill="#1a1a1a">${A.esc(labels[i] || '')} · ${(frac * 100).toFixed(1).replace('.', ',')}%</text>`;
      angle = a2;
    });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${paths}${legend}</svg>`;
  }
  function wireChart() {
    $('chart-draw').addEventListener('click', drawChart);
    $('chart-type').addEventListener('change', drawChart);
    $('chart-range').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); drawChart(); } });
  }

  // ---------- Planilhas (abas) ----------
  function addSheet() {
    A.pushUndo();
    let n = A.doc.sheets.length + 1;
    const names = new Set(A.doc.sheets.map((s) => s.name));
    while (names.has('Planilha' + n)) n++;
    A.doc.sheets.push(A.newSheet('Planilha' + n));
    A.rebuildEngine(A.doc.sheets[A.doc.sheets.length - 1]);
    A.doc.active = A.doc.sheets.length - 1;
    A.layout(); A.updateTabs(); A.refresh(); A.markDirty();
  }
  function duplicateSheet() {
    A.pushUndo();
    const src = A.sheet();
    const copy = JSON.parse(JSON.stringify({ name: src.name + ' (cópia)', cells: src.cells, colW: src.colW, rowH: src.rowH, gridlines: src.gridlines }));
    const sh = Object.assign(A.newSheet(copy.name), copy);
    A.rebuildEngine(sh);
    A.doc.sheets.splice(A.doc.active + 1, 0, sh);
    A.doc.active += 1;
    A.layout(); A.updateTabs(); A.refresh(); A.markDirty();
  }
  function renameSheet() {
    const sh = A.sheet();
    const name = prompt('Novo nome da planilha:', sh.name);
    if (!name || !name.trim()) return;
    A.pushUndo();
    sh.name = name.trim().slice(0, 60);
    A.updateTabs(); A.markDirty();
  }
  function deleteSheet() {
    if (A.doc.sheets.length <= 1) { notify('A pasta precisa ter ao menos uma planilha'); return; }
    if (!confirm(`Excluir a planilha "${A.sheet().name}"?`)) return;
    A.pushUndo();
    A.doc.sheets.splice(A.doc.active, 1);
    A.doc.active = Math.min(A.doc.active, A.doc.sheets.length - 1);
    A.layout(); A.updateTabs(); A.refresh(); A.markDirty();
  }

  window.IO = {
    newDocument, exportJSON, exportCSV, openFile, print, openFind, wireFind, openChart,
    sortRange, addSheet, duplicateSheet, renameSheet, deleteSheet, parseCSV,
  };
  wireChart();
})();
