// Núcleo da planilha: estado do documento, grade virtualizada, seleção e edição.
(function () {
  'use strict';
  const E = window.GridEngine;

  const COLS = 52;          // A..AZ
  const ROWS = 1000;
  const DEF_W = 100;        // largura padrão (px base, antes do zoom)
  const DEF_H = 22;         // altura padrão
  const STORAGE_KEY = 'planilhas:v1';

  const $ = (id) => document.getElementById(id);
  const el = {
    viewport: $('viewport'), spacer: $('spacer'), cells: $('cells'),
    sel: $('selection'), fill: $('fill-handle'),
    colH: $('col-headers'), colHI: $('col-headers-inner'),
    rowH: $('row-headers'), rowHI: $('row-headers-inner'),
    editor: $('cell-editor'), formula: $('formula'), nameBox: $('name-box'),
    title: $('doc-title'), zoom: $('zoom'), tabs: $('tabs'), tabInfo: $('tab-info'),
    status: $('save-status'), ctx: $('context-menu'), sheetArea: $('sheet-area'),
  };

  // ---------- Estado ----------
  function newSheet(name) {
    return { name, cells: {}, colW: {}, rowH: {}, eng: null, gridlines: true };
  }
  function rebuildEngine(sh) {
    const map = {};
    for (const a in sh.cells) {
      const c = sh.cells[a];
      if (c && c.v !== undefined && c.v !== '') map[a] = c.v;
    }
    sh.eng = new E.Sheet(map);
  }
  const doc = { title: 'Planilha sem título', sheets: [newSheet('Planilha1')], active: 0, zoom: 100 };
  rebuildEngine(doc.sheets[0]);

  // Seleção: âncora (ar,ac) = célula ativa; (er,ec) = ponta oposta
  const S = { ar: 1, ac: 1, er: 1, ec: 1, drag: null, editing: null, undo: [], redo: [], clip: null, fillFrom: null, fillTo: null, dirtyTimer: null };

  const sheet = () => doc.sheets[doc.active];
  const addr = (r, c) => E.addrToStr(r, c);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const z = () => doc.zoom / 100;

  function cellAt(r, c) { return sheet().cells[addr(r, c)]; }
  function raw(r, c) { const x = cellAt(r, c); return x && x.v !== undefined ? x.v : ''; }
  function style(r, c) { const x = cellAt(r, c); return (x && x.s) || {}; }
  function valueOf(r, c) { return sheet().eng.value(addr(r, c)); }

  function rect() {
    return {
      r1: Math.min(S.ar, S.er), r2: Math.max(S.ar, S.er),
      c1: Math.min(S.ac, S.ec), c2: Math.max(S.ac, S.ec),
    };
  }

  // ---------- Alterações de dados ----------
  function setRaw(r, c, text) {
    const sh = sheet();
    const a = addr(r, c);
    let cell = sh.cells[a];
    if (!cell) {
      if (text === '') return;
      cell = sh.cells[a] = { v: '' };
    }
    cell.v = text;
    if (cell.v === '' && (!cell.s || !Object.keys(cell.s).length)) delete sh.cells[a];
    sh.eng.setRaw(a, text);
  }
  function setStyle(r, c, fn) {
    const sh = sheet();
    const a = addr(r, c);
    let cell = sh.cells[a] || (sh.cells[a] = { v: '' });
    cell.s = cell.s || {};
    fn(cell.s);
    if (!Object.keys(cell.s).length) delete cell.s;
    if (cell.v === '' && !cell.s) delete sh.cells[a];
  }

  // ---------- Histórico (desfazer / refazer) ----------
  function snapshot() {
    return JSON.stringify({
      active: doc.active,
      sheets: doc.sheets.map((s) => ({ name: s.name, cells: s.cells, colW: s.colW, rowH: s.rowH, gridlines: s.gridlines })),
    });
  }
  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > 200) S.undo.shift();
    S.redo = [];
  }
  function restore(snap) {
    const data = JSON.parse(snap);
    doc.sheets = data.sheets.map((s) => { const sh = Object.assign(newSheet(s.name), s); rebuildEngine(sh); return sh; });
    doc.active = clamp(data.active, 0, doc.sheets.length - 1);
    layout();
    refresh();
    markDirty();
  }
  function undo() {
    if (!S.undo.length) return;
    S.redo.push(snapshot());
    restore(S.undo.pop());
  }
  function redo() {
    if (!S.redo.length) return;
    S.undo.push(snapshot());
    restore(S.redo.pop());
  }

  // ---------- Persistência (localStorage, com proteção contra falhas) ----------
  function markDirty() {
    el.status.textContent = 'Salvando…';
    clearTimeout(S.dirtyTimer);
    S.dirtyTimer = setTimeout(persist, 400);
  }
  function persist() {
    try {
      const payload = { title: doc.title, zoom: doc.zoom, active: doc.active, sheets: doc.sheets.map((s) => ({ name: s.name, cells: s.cells, colW: s.colW, rowH: s.rowH, gridlines: s.gridlines })) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      el.status.textContent = 'Tudo salvo';
    } catch (e) {
      el.status.textContent = 'Não foi possível salvar no navegador';
    }
  }
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.sheets) || !d.sheets.length) return;
      doc.title = d.title || doc.title;
      doc.zoom = d.zoom || 100;
      doc.sheets = d.sheets.map((s) => Object.assign(newSheet(s.name), s));
      doc.sheets.forEach(rebuildEngine);
      doc.active = clamp(d.active || 0, 0, doc.sheets.length - 1);
    } catch (e) { /* dados corrompidos: começa vazio */ }
  }

  // ---------- Layout (posições em px, com zoom) ----------
  const L = { left: new Float64Array(COLS + 2), top: new Float64Array(ROWS + 2) };
  function layout() {
    const sh = sheet();
    const f = z();
    L.left = new Float64Array(COLS + 2);
    L.top = new Float64Array(ROWS + 2);
    for (let c = 1; c <= COLS; c++) L.left[c + 1] = L.left[c] + (sh.colW[c] || DEF_W) * f;
    for (let r = 1; r <= ROWS; r++) L.top[r + 1] = L.top[r] + (sh.rowH[r] || DEF_H) * f;
    el.spacer.style.width = L.left[COLS + 1] + 'px';
    el.spacer.style.height = L.top[ROWS + 1] + 'px';
    el.colHI.style.width = L.left[COLS + 1] + 'px';
    el.rowHI.style.height = L.top[ROWS + 1] + 'px';
    document.documentElement.style.setProperty('--hdr-w', '46px');
  }
  // Busca binária: coluna/linha que contém a coordenada x/y
  function colAt(x) {
    let lo = 1, hi = COLS;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L.left[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function rowAt(y) {
    let lo = 1, hi = ROWS;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L.top[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function cellRect(r, c) {
    return { x: L.left[c], y: L.top[r], w: L.left[c + 1] - L.left[c], h: L.top[r + 1] - L.top[r] };
  }

  // ---------- Formatação de exibição ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fmtDate(serial) {
    const d = new Date(Math.round((serial - 25569) * 86400000));
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }
  function fmt(v, s) {
    if (v === null || v === undefined) return '';
    if (v instanceof E.CellError) return v.code;
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    const nf = (s && s.nf) || 'general';
    if (typeof v === 'string') return v;
    if (nf === 'text') return String(v);
    const dec = s && s.dec !== undefined ? s.dec : (nf === 'currency' ? 2 : nf === 'percent' ? 0 : 2);
    const opts = { minimumFractionDigits: dec, maximumFractionDigits: dec };
    switch (nf) {
      case 'number': return v.toLocaleString('pt-BR', opts);
      case 'percent': return (v * 100).toLocaleString('pt-BR', opts) + '%';
      case 'currency': return 'R$ ' + v.toLocaleString('pt-BR', opts);
      case 'date': return fmtDate(v);
      default: return v.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
    }
  }
  // Texto exibido de uma célula (para copiar/exportar)
  function display(r, c) { return fmt(valueOf(r, c), style(r, c)); }

  // ---------- Renderização ----------
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderCells(); });
  }

  function renderCells() {
    const vp = el.viewport;
    const sh = sheet();
    const x0 = vp.scrollLeft, y0 = vp.scrollTop;
    const x1 = x0 + vp.clientWidth, y1 = y0 + vp.clientHeight;
    const c0 = colAt(x0), c1 = Math.min(COLS, colAt(x1) + 1);
    const r0 = rowAt(y0), r1 = Math.min(ROWS, rowAt(y1) + 1);
    const found = S.found || null;
    let html = '';
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const a = addr(r, c);
        const cell = sh.cells[a];
        const s = (cell && cell.s) || {};
        const v = cell && cell.v !== '' ? sh.eng.value(a) : null;
        const txt = fmt(v, s);
        const rc = cellRect(r, c);
        // alinhamento padrão: texto à esquerda, números e erros à direita, booleanos ao centro
        const al = s.al || (typeof v === 'string' || v === null ? 'l' : typeof v === 'boolean' ? 'c' : 'r');
        const cls = ['cell', 'al-' + al];
        if (s.wrap) cls.push('wrap');
        if (v instanceof E.CellError) cls.push('err');
        if (s.bd) cls.push('bd-all');
        if (found && found.has(a)) cls.push(found.cur === a ? 'found-cur' : 'found');
        const styles = [`left:${rc.x}px`, `top:${rc.y}px`, `width:${rc.w}px`, `height:${rc.h}px`];
        if (s.bg) styles.push(`background:${s.bg}`);
        if (s.color) styles.push(`color:${s.color}`);
        if (s.b) styles.push('font-weight:700');
        if (s.i) styles.push('font-style:italic');
        const deco = [s.u ? 'underline' : '', s.st ? 'line-through' : ''].filter(Boolean).join(' ');
        if (deco) styles.push(`text-decoration:${deco}`);
        if (s.ff) styles.push(`font-family:${s.ff}`);
        styles.push(`font-size:${((s.fs || 10) * 1.3 * z()).toFixed(1)}px`);
        if (!txt) {
          html += `<div class="${cls.join(' ')}" style="${styles.join(';')}" data-r="${r}" data-c="${c}"></div>`;
        } else {
          html += `<div class="${cls.join(' ')}" style="${styles.join(';')}" data-r="${r}" data-c="${c}">${esc(txt)}</div>`;
        }
      }
    }
    el.cells.innerHTML = html;
    el.cells.classList.toggle('no-grid', sh.gridlines === false);
  }

  function renderHeaders() {
    const { r1, r2, c1, c2 } = rect();
    let ch = '';
    for (let c = 1; c <= COLS; c++) {
      const on = c >= c1 && c <= c2 ? ' on' : '';
      ch += `<div class="hdr col${on}" data-c="${c}" style="left:${L.left[c]}px;width:${L.left[c + 1] - L.left[c]}px">${E.numToCol(c)}<div class="hdr-resize" data-rc="${c}"></div></div>`;
    }
    el.colHI.innerHTML = ch;
    let rh = '';
    for (let r = 1; r <= ROWS; r++) {
      const on = r >= r1 && r <= r2 ? ' on' : '';
      rh += `<div class="hdr row${on}" data-r="${r}" style="top:${L.top[r]}px;height:${L.top[r + 1] - L.top[r]}px">${r}<div class="hdr-resize-row" data-rr="${r}"></div></div>`;
    }
    el.rowHI.innerHTML = rh;
  }

  function renderSelection() {
    const R = rect();
    const rc1 = cellRect(R.r1, R.c1);
    const rc2 = cellRect(R.r2, R.c2);
    const box = el.sel;
    box.style.display = 'block';
    box.style.left = rc1.x + 'px';
    box.style.top = rc1.y + 'px';
    box.style.width = (rc2.x + rc2.w - rc1.x) + 'px';
    box.style.height = (rc2.y + rc2.h - rc1.y) + 'px';
    const single = R.r1 === R.r2 && R.c1 === R.c2;
    box.classList.toggle('cursor-only', single);
    el.nameBox.value = single ? addr(S.ar, S.ac) : `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`;
    if (!S.editing) el.formula.value = raw(S.ar, S.ac);
    renderHeaders();
    renderSummary(R);
  }

  // Resumo na barra de status: soma, média e contagem dos números do intervalo
  function renderSummary(R) {
    if (R.r1 === R.r2 && R.c1 === R.c2) { el.tabInfo.textContent = ''; return; }
    let sum = 0, n = 0, cnt = 0;
    for (let r = R.r1; r <= R.r2; r++) {
      for (let c = R.c1; c <= R.c2; c++) {
        const cell = cellAt(r, c);
        if (!cell || cell.v === '') continue;
        cnt++;
        const v = valueOf(r, c);
        if (typeof v === 'number') { sum += v; n++; }
      }
    }
    const avg = n ? sum / n : 0;
    const f = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
    el.tabInfo.textContent = n
      ? `Soma: ${f(sum)}   Média: ${f(avg)}   Contagem: ${cnt}`
      : `Contagem: ${cnt}`;
  }

  function reveal(r, c) {
    const vp = el.viewport;
    const rc = cellRect(r, c);
    if (rc.x < vp.scrollLeft) vp.scrollLeft = rc.x;
    else if (rc.x + rc.w > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = rc.x + rc.w - vp.clientWidth;
    if (rc.y < vp.scrollTop) vp.scrollTop = rc.y;
    else if (rc.y + rc.h > vp.scrollTop + vp.clientHeight) vp.scrollTop = rc.y + rc.h - vp.clientHeight;
  }

  function refresh() {
    el.colH.scrollLeft = el.viewport.scrollLeft;
    el.rowH.scrollTop = el.viewport.scrollTop;
    scheduleRender();
    renderSelection();
    updateTabs();
    if (window.Features && window.Features.onRefresh) window.Features.onRefresh();
  }
  function renderAll() {
    layout();
    refresh();
  }

  // ---------- Seleção ----------
  function select(r, c, extend) {
    r = clamp(r, 1, ROWS);
    c = clamp(c, 1, COLS);
    if (extend) { S.er = r; S.ec = c; reveal(r, c); }
    else { S.ar = S.er = r; S.ac = S.ec = c; reveal(r, c); }
    refresh();
  }
  // Ctrl+setas: salta até o limite de dados contíguos
  function jumpTo(r, c, dr, dc) {
    const filled = (rr, cc) => rr >= 1 && rr <= ROWS && cc >= 1 && cc <= COLS && raw(rr, cc) !== '';
    let nr = r, nc = c;
    const step = (x, y) => { nr = x; nc = y; };
    if (!filled(r + dr, c + dc)) {
      // vai até a borda, ou até o próximo dado
      while (nr + dr >= 1 && nr + dr <= ROWS && nc + dc >= 1 && nc + dc <= COLS && !filled(nr + dr, nc + dc)) step(nr + dr, nc + dc);
      if (nr + dr >= 1 && nr + dr <= ROWS && nc + dc >= 1 && nc + dc <= COLS) step(nr + dr, nc + dc);
    } else {
      while (filled(nr + dr, nc + dc)) step(nr + dr, nc + dc);
    }
    return { r: nr, c: nc };
  }
  function moveCursor(dr, dc, extend, jump) {
    S.tabOrigin = null;
    if (jump) {
      const from = extend ? { r: S.er, c: S.ec } : { r: S.ar, c: S.ac };
      const t = jumpTo(from.r, from.c, dr, dc);
      select(t.r, t.c, extend);
      return;
    }
    if (extend) select(S.er + dr, S.ec + dc, true);
    else {
      const R = rect();
      // com seleção ampla, seta recolhe para a célula ativa
      const baseR = S.ar + dr, baseC = S.ac + dc;
      void R;
      select(baseR, baseC, false);
    }
  }

  // ---------- Edição ----------
  function startEdit(r, c, initial, focusTo) {
    S.editing = { r, c };
    const rc = cellRect(r, c);
    const ed = el.editor;
    ed.hidden = false;
    ed.style.left = rc.x + 'px';
    ed.style.top = rc.y + 'px';
    ed.style.minWidth = rc.w + 'px';
    ed.style.minHeight = rc.h + 'px';
    ed.style.width = Math.max(rc.w, 60) + 'px';
    ed.style.font = `${((style(r, c).fs || 10) * 1.3 * z()).toFixed(1)}px ${style(r, c).ff || 'Arial'}`;
    const text = initial !== undefined ? initial : raw(r, c);
    ed.value = text;
    el.formula.value = text;
    if (focusTo === 'formula') {
      el.formula.focus();
      el.formula.setSelectionRange(text.length, text.length);
    } else {
      ed.focus();
      if (initial === undefined) ed.setSelectionRange(text.length, text.length);
    }
    refresh();
  }
  function commitEdit(dr, dc) {
    if (!S.editing) return;
    const { r, c } = S.editing;
    const text = el.editor.value;
    if (text !== raw(r, c)) {
      pushUndo();
      setRaw(r, c, text);
      markDirty();
    }
    endEdit();
    if (dc) {
      // Tab: lembra a coluna onde a sequência começou, para o Enter voltar a ela
      if (S.tabOrigin == null) S.tabOrigin = c;
      select(r + dr, c + dc, false);
    } else if (dr) {
      const col = S.tabOrigin != null ? S.tabOrigin : c;
      S.tabOrigin = null;
      select(r + dr, col, false);
    } else {
      S.tabOrigin = null;
      refresh();
    }
  }
  function cancelEdit() {
    if (!S.editing) return;
    endEdit();
    refresh();
  }
  function endEdit() {
    S.editing = null;
    el.editor.hidden = true;
    el.editor.blur();
    el.formula.blur();
    el.viewport.focus({ preventScroll: true });
  }
  // Limpa conteúdo da seleção
  function clearRange(keepStyle) {
    const R = rect();
    pushUndo();
    for (let r = R.r1; r <= R.r2; r++) {
      for (let c = R.c1; c <= R.c2; c++) {
        const a = addr(r, c);
        const cell = sheet().cells[a];
        if (!cell) continue;
        if (keepStyle) { cell.v = ''; sheet().eng.setRaw(a, ''); }
        else { delete sheet().cells[a]; sheet().eng.setRaw(a, ''); }
      }
    }
    refresh();
    markDirty();
  }

  // ---------- Eventos: mouse ----------
  function vpPos(e) {
    const rc = el.viewport.getBoundingClientRect();
    return { x: e.clientX - rc.left + el.viewport.scrollLeft, y: e.clientY - rc.top + el.viewport.scrollTop };
  }

  el.viewport.addEventListener('mousedown', (e) => {
    if (e.target === el.fill) return; // tratado em features.js
    if (e.button !== 0) return;
    if (S.editing) commitEdit(0, 0);
    S.tabOrigin = null;
    const p = vpPos(e);
    S.drag = 'cells';
    select(rowAt(p.y), colAt(p.x), e.shiftKey);
    el.viewport.focus({ preventScroll: true });
  });
  el.viewport.addEventListener('dblclick', (e) => {
    if (S.editing) return;
    const p = vpPos(e);
    startEdit(rowAt(p.y), colAt(p.x));
  });
  el.viewport.addEventListener('scroll', () => {
    el.colH.scrollLeft = el.viewport.scrollLeft;
    el.rowH.scrollTop = el.viewport.scrollTop;
    scheduleRender();
  });

  // Cabeçalhos: seleção de linha/coluna e redimensionamento
  el.colH.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rz = e.target.closest('.hdr-resize');
    if (rz) { startResizeCol(e, +rz.dataset.rc); return; }
    const h = e.target.closest('.hdr');
    if (!h) return;
    if (S.editing) commitEdit(0, 0);
    const c = +h.dataset.c;
    S.drag = 'cols';
    if (e.shiftKey) S.ec = c;
    else { S.ac = S.ec = c; S.ar = 1; }
    if (!e.shiftKey) { S.ar = 1; S.er = ROWS; }
    else S.er = ROWS;
    refresh();
  });
  el.rowH.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rz = e.target.closest('.hdr-resize-row');
    if (rz) { startResizeRow(e, +rz.dataset.rr); return; }
    const h = e.target.closest('.hdr');
    if (!h) return;
    if (S.editing) commitEdit(0, 0);
    const r = +h.dataset.r;
    S.drag = 'rows';
    if (e.shiftKey) S.er = r;
    else { S.ar = S.er = r; S.ac = 1; }
    S.ec = e.shiftKey ? S.ec : COLS;
    refresh();
  });

  window.addEventListener('mousemove', (e) => {
    if (!S.drag) return;
    if (S.drag === 'cells') {
      const p = vpPos(e);
      const r = rowAt(p.y), c = colAt(p.x);
      if (r !== S.er || c !== S.ec) select(r, c, true);
    } else if (S.drag === 'cols') {
      const rc = el.colH.getBoundingClientRect();
      const x = e.clientX - rc.left + el.colH.scrollLeft;
      const c = colAt(x);
      if (c !== S.ec) { S.ec = c; refresh(); }
    } else if (S.drag === 'rows') {
      const rc = el.rowH.getBoundingClientRect();
      const y = e.clientY - rc.top + el.rowH.scrollTop;
      const r = rowAt(y);
      if (r !== S.er) { S.er = r; refresh(); }
    }
  });
  window.addEventListener('mouseup', () => { S.drag = null; });

  function startResizeCol(e, c) {
    e.preventDefault();
    const startX = e.clientX;
    const sh = sheet();
    const startW = sh.colW[c] || DEF_W;
    const move = (ev) => {
      sh.colW[c] = Math.max(24, startW + (ev.clientX - startX) / z());
      layout(); refresh();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); markDirty(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  function startResizeRow(e, r) {
    e.preventDefault();
    const startY = e.clientY;
    const sh = sheet();
    const startH = sh.rowH[r] || DEF_H;
    const move = (ev) => {
      sh.rowH[r] = Math.max(14, startH + (ev.clientY - startY) / z());
      layout(); refresh();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); markDirty(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ---------- Editor e barra de fórmulas ----------
  el.editor.addEventListener('input', () => { el.formula.value = el.editor.value; });
  el.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
  el.formula.addEventListener('focus', () => {
    if (!S.editing) startEdit(S.ar, S.ac, undefined, 'formula');
  });
  el.formula.addEventListener('input', () => {
    if (S.editing) el.editor.value = el.formula.value;
  });
  el.formula.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
  el.nameBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const m = /^\s*([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?\s*$/.exec(el.nameBox.value);
    if (m) {
      const a = E.parseAddr(m[1] + m[2]);
      if (a) { S.ar = S.er = a.row; S.ac = S.ec = a.col; }
      if (m[3]) { const b = E.parseAddr(m[3] + m[4]); if (b) { S.er = b.row; S.ec = b.col; } }
      reveal(S.ar, S.ac);
      refresh();
      el.viewport.focus({ preventScroll: true });
    }
  });

  // ---------- Teclado (quando o foco está na grade) ----------
  function isTypingTarget(t) {
    if (!t) return false;
    if (t.matches && t.matches('input, select, textarea, [contenteditable]')) return true;
    if (document.querySelector('dialog[open]')) return true;
    return false;
  }
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // já tratado na fase de captura (ex.: Ctrl+P)
    if (isTypingTarget(e.target)) return;
    if (S.editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && window.Features && window.Features.shortcut(e)) { e.preventDefault(); return; }
    if (ctrl || e.altKey) return;
    const jump = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveCursor(1, 0, e.shiftKey, jump); return;
      case 'ArrowUp': e.preventDefault(); moveCursor(-1, 0, e.shiftKey, jump); return;
      case 'ArrowRight': e.preventDefault(); moveCursor(0, 1, e.shiftKey, jump); return;
      case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1, e.shiftKey, jump); return;
      case 'Tab': e.preventDefault(); moveCursor(0, e.shiftKey ? -1 : 1, false); return;
      case 'Enter':
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        startEdit(S.ar, S.ac);
        return;
      case 'F2': e.preventDefault(); startEdit(S.ar, S.ac); return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault(); clearRange(false); return;
      case 'Escape':
        if (window.Features) window.Features.cancelClipboardMarquee();
        return;
      case 'Home': e.preventDefault(); select(S.ar, 1, e.shiftKey); return;
      case 'End': e.preventDefault(); select(S.ar, COLS, e.shiftKey); return;
      case 'PageDown': e.preventDefault(); moveCursor(20, 0, e.shiftKey, false); return;
      case 'PageUp': e.preventDefault(); moveCursor(-20, 0, e.shiftKey, false); return;
    }
    // Digitação direta substitui o conteúdo da célula
    if (e.key.length === 1) {
      e.preventDefault();
      startEdit(S.ar, S.ac, e.key);
    }
  });

  // Cálculo de alturas/larguras ao redimensionar a janela
  window.addEventListener('resize', () => { scheduleRender(); renderSelection(); });

  // ---------- Abas das planilhas ----------
  function updateTabs() {
    el.tabs.innerHTML = doc.sheets.map((s, i) =>
      `<div class="tab${i === doc.active ? ' active' : ''}" data-i="${i}" title="Clique para abrir; duplo clique para renomear">${esc(s.name)}</div>`
    ).join('');
    el.title.value = doc.title;
  }
  el.tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (S.editing) commitEdit(0, 0);
    doc.active = +t.dataset.i;
    layout(); refresh(); markDirty();
  });
  el.tabs.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    const i = +t.dataset.i;
    const input = document.createElement('input');
    input.value = doc.sheets[i].name;
    t.textContent = '';
    t.appendChild(input);
    input.focus(); input.select();
    const done = () => {
      const v = input.value.trim();
      if (v) { pushUndo(); doc.sheets[i].name = v; }
      updateTabs(); markDirty();
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = doc.sheets[i].name; input.blur(); } });
    input.addEventListener('blur', done);
  });
  el.title.addEventListener('change', () => { doc.title = el.title.value.trim() || 'Planilha sem título'; document.title = doc.title + ' · Planilhas'; markDirty(); });

  // ---------- Expõe API interna para features.js ----------
  window.App = {
    COLS, ROWS, DEF_W, DEF_H, doc, S, el, L, E,
    sheet, addr, raw, style, cellAt, valueOf, display, fmt, esc, rect, clamp, z,
    setRaw, setStyle, pushUndo, undo, redo, snapshot, restore,
    select, moveCursor, refresh, renderAll, layout, reveal, startEdit, commitEdit, cancelEdit, endEdit,
    clearRange, markDirty, persist, cellRect, colAt, rowAt, updateTabs, vpPos, newSheet, rebuildEngine,
    scheduleRender, renderCells, renderSelection,
  };

  // ---------- Inicialização ----------
  loadPersisted();
  document.title = doc.title + ' · Planilhas';
  el.zoom.value = String(doc.zoom);
  renderAll();
  updateTabs();
  el.viewport.focus({ preventScroll: true });
})();
