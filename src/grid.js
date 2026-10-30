// Grade desenhada em canvas: layout, desenho, seleção, rolagem e interação com o mouse.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const $ = (id) => document.getElementById(id);

  const C = {
    grid: '#e2e2e2', hdrBg: '#f6f6f6', hdrText: '#5a5a5a', hdrLine: '#d4d4d4',
    hdrSelBg: '#fde3e5', hdrSelText: '#a3000b', hdrFullBg: '#e30613', hdrFullText: '#ffffff',
    sel: '#e30613', selFill: 'rgba(227, 6, 19, 0.07)', freeze: '#c4c4c4', link: '#b8000c',
    note: '#1a1a1a', comment: '#f29900', err: '#e30613', chipBg: '#ececec', check: '#e30613',
    found: 'rgba(255, 214, 0, 0.45)', foundCur: 'rgba(255, 170, 0, 0.75)',
  };
  const REF_COLORS = ['#e30613', '#1a73e8', '#188038', '#9334e6', '#e37400', '#d01884', '#12b5cb', '#5f6368'];
  App.REF_COLORS = REF_COLORS;

  const st = {
    left: new Float64Array(2), top: new Float64Array(2), z: 1, hdrW: 46, hdrH: 24,
    sx: 0, sy: 0, vw: 0, vh: 0, Fr: 0, Fc: 0, FW: 0, FH: 0,
    drag: null, marquee: null, refs: [], found: null, foundCur: null, fillPreview: null, queued: false,
  };
  App.gridState = st;
  const sel = (App.sel = { ar: 1, ac: 1, er: 1, ec: 1 });

  let wrap, canvas, ctx, scroller, spacer, addRowsBar;

  // ---------- Layout ----------
  function layout() {
    const sh = App.sheet();
    const z = (st.z = doc.zoom / 100);
    // visualização de filtro com ordem própria: a grade desenha posições de tela (ver App.buildVmap)
    if (App.buildVmap) App.buildVmap();
    const vm = App.vm && App.vm.sheetId === sh.id ? App.vm : null;
    st.vm = vm;
    st.nR = vm ? vm.nRows : sh.rows; st.nC = vm ? vm.nCols : sh.cols;
    const L = new Float64Array(st.nC + 2), T = new Float64Array(st.nR + 2);
    for (let d = 1; d <= st.nC; d++) { const c = vm ? vm.cols[d] : d; L[d + 1] = L[d] + (App.isColHidden(sh, c) ? 0 : (sh.colW[c] || App.DEF_W) * z); }
    for (let d = 1; d <= st.nR; d++) {
      const e = vm ? vm.rows[d] : null;
      const h = e && e.group ? Math.round(26 * z) : (() => { const r = e ? e.r : d; return App.isRowHidden(sh, r) ? 0 : (sh.rowH[r] || App.DEF_H) * z; })();
      T[d + 1] = T[d] + h;
    }
    st.left = L; st.top = T;
    st.Fr = Math.min(sh.freeze.rows || 0, st.nR);
    st.Fc = Math.min(sh.freeze.cols || 0, st.nC);
    st.FW = L[st.Fc + 1]; st.FH = T[st.Fr + 1];
    st.hdrW = Math.round(Math.max(46, 14 + 8 * String(st.nR).length) * z);
    // faixa acima dos cabeçalhos para os grupos de colunas (botões + e −)
    st.gut = sh.colGroups && sh.colGroups.length ? Math.round(18 * z) : 0;
    st.hdrH = Math.round(24 * z) + st.gut;
    spacer.style.width = st.hdrW + L[st.nC + 1] + 'px';
    spacer.style.height = st.hdrH + T[st.nR + 1] + 64 + 'px';
    resize();
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    st.vw = scroller.clientWidth; st.vh = scroller.clientHeight;
    schedule();
  }
  // posição de tela -> coluna/linha real
  const RC = (c) => (st.vm ? st.vm.cols[c] || c : c);
  const RR = (r) => (st.vm ? (st.vm.rows[r] && st.vm.rows[r].r) || null : r);
  const GROUP = (r) => (st.vm && st.vm.rows[r] && st.vm.rows[r].group) || null;
  const colX = (c) => st.hdrW + st.left[c] - (c > st.Fc ? st.sx : 0);
  const rowY = (r) => st.hdrH + st.top[r] - (r > st.Fr ? st.sy : 0);
  const colW = (c) => st.left[c + 1] - st.left[c];
  const rowH = (r) => st.top[r + 1] - st.top[r];
  function colAtContent(x) {
    const L = st.left, n = L.length - 2;
    let lo = 1, hi = n;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function rowAtContent(y) {
    const T = st.top, n = T.length - 2;
    let lo = 1, hi = n;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }
  // Coordenada de tela (relativa à grade) -> linha/coluna
  const colAtScreen = (x) => { const xc = x - st.hdrW; return colAtContent(xc < st.FW ? xc : xc + st.sx); };
  const rowAtScreen = (y) => { const yc = y - st.hdrH; return rowAtContent(yc < st.FH ? yc : yc + st.sy); };

  // Retângulo de tela de uma célula (considera mesclagem); null se fora da área visível
  function cellRect(r, c, noMerge) {
    const sh = App.sheet();
    const g = noMerge ? null : App.mergeAt(sh, r, c);
    const r1 = g ? g.r1 : r, c1 = g ? g.c1 : c, r2 = g ? g.r2 : r, c2 = g ? g.c2 : c;
    return { x: colX(c1), y: rowY(r1), w: st.left[c2 + 1] - st.left[c1], h: st.top[r2 + 1] - st.top[r1], r1, c1, r2, c2 };
  }

  // ---------- Seleção ----------
  App.selRect = () => {
    const R = { r1: Math.min(sel.ar, sel.er), r2: Math.max(sel.ar, sel.er), c1: Math.min(sel.ac, sel.ec), c2: Math.max(sel.ac, sel.ec) };
    return App.expandToMerges(App.sheet(), R);
  };
  App.selIsCell = () => { const R = App.selRect(), g = App.mergeAt(App.sheet(), sel.ar, sel.ac); return g ? R.r1 === g.r1 && R.r2 === g.r2 && R.c1 === g.c1 && R.c2 === g.c2 : R.r1 === R.r2 && R.c1 === R.c2; };
  function clampCell(r, c) {
    const sh = App.sheet();
    return [Math.max(1, Math.min(st.nR, r)), Math.max(1, Math.min(st.nC, c))];
  }
  function select(r, c, extend, noReveal) {
    [r, c] = clampCell(r, c);
    if (extend) { sel.er = r; sel.ec = c; }
    else {
      const g = App.mergeAt(App.sheet(), r, c);
      if (g) { r = g.r1; c = g.c1; }
      sel.ar = sel.er = r; sel.ac = sel.ec = c;
    }
    if (!noReveal) reveal(extend ? sel.er : sel.ar, extend ? sel.ec : sel.ac);
    App.emit('selection');
    schedule();
  }
  function selectRange(R, active) {
    const sh = App.sheet();
    sel.ar = active ? active.r : R.r1; sel.ac = active ? active.c : R.c1;
    sel.er = sel.ar === R.r1 ? R.r2 : R.r1; sel.ec = sel.ac === R.c1 ? R.c2 : R.c1;
    if (sel.ar !== R.r1 && sel.ar !== R.r2) { sel.ar = R.r1; sel.er = R.r2; }
    if (sel.ac !== R.c1 && sel.ac !== R.c2) { sel.ac = R.c1; sel.ec = R.c2; }
    sel.er = Math.min(sel.er, st.nR); sel.ec = Math.min(sel.ec, st.nC);
    reveal(sel.ar, sel.ac);
    App.emit('selection');
    schedule();
  }
  // Passo de navegação que pula linhas/colunas ocultas e atravessa mesclagens
  function step(r, c, dr, dc) {
    const sh = App.sheet();
    const g = App.mergeAt(sh, r, c);
    if (g) { if (dr > 0) r = g.r2; if (dr < 0) r = g.r1; if (dc > 0) c = g.c2; if (dc < 0) c = g.c1; }
    let nr = r + dr, nc = c + dc;
    while (nr >= 1 && nr <= st.nR && dr && !rowH(nr) && !(st.vm && st.vm.rows[nr] && st.vm.rows[nr].group)) nr += dr;
    while (nc >= 1 && nc <= st.nC && dc && !colW(nc)) nc += dc;
    if (nr < 1 || nr > st.nR) nr = r;
    if (nc < 1 || nc > st.nC) nc = c;
    return [nr, nc];
  }
  function jump(r, c, dr, dc) {
    const sh = App.sheet();
    const filled = (rr, cc) => rr >= 1 && cc >= 1 && rr <= st.nR && cc <= st.nC && App.raw(sh, rr, cc) !== '';
    let nr = r, nc = c;
    const inb = (rr, cc) => rr >= 1 && cc >= 1 && rr <= st.nR && cc <= st.nC;
    if (filled(r, c) && filled(r + dr, c + dc)) {
      while (filled(nr + dr, nc + dc)) { nr += dr; nc += dc; }
    } else {
      while (inb(nr + dr, nc + dc) && !filled(nr + dr, nc + dc)) { nr += dr; nc += dc; }
      if (inb(nr + dr, nc + dc)) { nr += dr; nc += dc; }
    }
    return [nr, nc];
  }
  function moveCursor(dr, dc, extend, toEdge) {
    const from = extend ? [sel.er, sel.ec] : [sel.ar, sel.ac];
    const [r, c] = toEdge ? jump(from[0], from[1], dr, dc) : step(from[0], from[1], dr, dc);
    select(r, c, extend);
  }

  function reveal(r, c) {
    const sh = App.sheet();
    if (r > st.nR || c > st.nC) return;
    let sx = st.sx, sy = st.sy;
    const availW = st.vw - st.hdrW, availH = st.vh - st.hdrH;
    if (c > st.Fc) {
      const x0 = st.left[c] - st.FW, x1 = st.left[c + 1] - st.FW;
      if (x0 < sx) sx = x0; else if (x1 - sx > availW - st.FW) sx = Math.min(x0, x1 - (availW - st.FW));
    }
    if (r > st.Fr) {
      const y0 = st.top[r] - st.FH, y1 = st.top[r + 1] - st.FH;
      if (y0 < sy) sy = y0; else if (y1 - sy > availH - st.FH) sy = Math.min(y0, y1 - (availH - st.FH));
    }
    if (sx !== st.sx) scroller.scrollLeft = sx;
    if (sy !== st.sy) scroller.scrollTop = sy;
  }

  // ---------- Desenho ----------
  function schedule() {
    if (st.queued) return;
    st.queued = true;
    requestAnimationFrame(() => { st.queued = false; draw(); });
  }
  function fontFor(s) {
    const px = ((s.fs || 10) * 1.333 * st.z).toFixed(2);
    const fam = s.ff || 'Arial';
    return `${s.i ? 'italic ' : ''}${s.b ? 'bold ' : ''}${px}px ${/[\s]/.test(fam) && !/^['"]/.test(fam) ? `"${fam}"` : fam}, Arial, sans-serif`;
  }
  App.fontFor = fontFor;

  // Informações de exibição de uma célula (texto, alinhamento, decorações)
  const EMPTY_INFO = { cell: null, raw: '', v: null, s: {}, text: '', align: 'l', dv: null, link: null, isErr: false };
  function cellInfo(sh, si, r, c) {
    const [rr, cc] = App.mapRC(sh, r, c);
    if (!rr) return EMPTY_INFO;
    return App.withReal(() => cellInfoReal(sh, si, rr, cc));
  }
  function cellInfoReal(sh, si, r, c) {
    const cell = sh.cells[E.addrToStr(r, c)];
    const raw = cell && cell.v !== undefined && cell.v !== null ? cell.v : '';
    const base = (cell && cell.s) || {};
    const v = App.value(si, r, c);
    let s = App.effectiveStyle(sh, si, r, c, base);
    // container crítico: a célula pisca em vermelho
    if (cell && cell.crit) {
      st.hasCrit = true;
      s = Object.assign({}, s, Math.floor(Date.now() / 550) % 2 ? { bg: '#d93025', color: '#ffffff', b: true } : { bg: '#fce8e6', color: '#b3261e', b: true });
    }
    const isFormula = typeof raw === 'string' && raw[0] === '=';
    let nf = base.nf;
    if (nf === undefined && isFormula) nf = App.inferFormat(si, raw);
    let text;
    if (doc.showFormulas && isFormula) text = raw;
    else text = App.fmtValue(v, nf);
    const dv = sh.dv.length ? App.dvAt(sh, r, c) : null;
    let align = s.al;
    if (!align) align = doc.showFormulas && isFormula ? 'l' : typeof v === 'number' ? 'r' : typeof v === 'boolean' || E.isErr(v) ? 'c' : 'l';
    let link = (cell && cell.link) || null;
    if (!link && isFormula && /^=\s*(HYPERLINK|HIPERLINK)\s*\(/i.test(raw)) { const m = /\(\s*"([^"]+)"/.exec(raw); if (m) link = m[1]; }
    if (!link && typeof v === 'string' && /^(https?:\/\/|www\.)\S+$/i.test(v)) link = v.startsWith('www.') ? 'https://' + v : v;
    return { cell, raw, v, s, text, align, dv, link, isErr: E.isErr(v), note: cell && cell.note, comment: cell && cell.comments && cell.comments.length };
  }
  App.cellInfo = (r, c) => cellInfo(App.sheet(), doc.active, r, c);

  function draw() {
    if (!ctx) return;
    const sh = App.sheet(), si = doc.active;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const W = st.vw, H = st.vh, hw = st.hdrW, hh = st.hdrH;
    const regions = [
      { rows: [st.Fr + 1, st.nR], cols: [st.Fc + 1, st.nC], sx: st.sx, sy: st.sy, x: hw + st.FW, y: hh + st.FH, w: W - hw - st.FW, h: H - hh - st.FH },
      { rows: [1, st.Fr], cols: [st.Fc + 1, st.nC], sx: st.sx, sy: 0, x: hw + st.FW, y: hh, w: W - hw - st.FW, h: st.FH },
      { rows: [st.Fr + 1, st.nR], cols: [1, st.Fc], sx: 0, sy: st.sy, x: hw, y: hh + st.FH, w: st.FW, h: H - hh - st.FH },
      { rows: [1, st.Fr], cols: [1, st.Fc], sx: 0, sy: 0, x: hw, y: hh, w: st.FW, h: st.FH },
    ];
    for (const rg of regions) {
      if (rg.w <= 0 || rg.h <= 0 || rg.rows[0] > rg.rows[1] || rg.cols[0] > rg.cols[1]) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(rg.x, rg.y, rg.w, rg.h); ctx.clip();
      drawRegion(sh, si, rg);
      drawOverlays(sh, rg);
      ctx.restore();
    }
    drawGroupRows(sh);
    drawHeaders(sh);
    // linhas de congelamento
    ctx.fillStyle = C.freeze;
    if (st.Fr > 0) ctx.fillRect(0, hh + st.FH - 2, W, 4);
    if (st.Fc > 0) ctx.fillRect(hw + st.FW - 2, 0, 4, H);
    if (st.drag && st.drag.kind === 'colMove' && st.drag.active) drawColMove(st.drag, H);
    positionAddRows(sh);
    App.emit('viewport');
  }

  // arrastar coluna na visualização: a coluna "fantasma" acompanha o mouse e uma linha mostra onde ela vai ficar
  function drawColMove(d, H) {
    let w = 0;
    for (let c = d.d1; c <= d.d2; c++) w += colW(c);
    w = Math.max(40, Math.min(w, 320));
    const gx = Math.round(d.px - w / 2);
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.fillStyle = d.frozen ? '#888' : C.sel; ctx.fillRect(gx, 0, w, H);
    const g0 = st.gut || 0;
    ctx.globalAlpha = 1; ctx.fillStyle = d.frozen ? '#666' : C.sel; ctx.fillRect(gx, g0, w, st.hdrH - g0);
    ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(12 * st.z)}px Inter, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sh = App.sheet(), real = App.vm ? App.vm.cols[d.d1] : d.d1;
    const nm = (sh.colNames && sh.colNames[real]) || E.numToCol(real);
    ctx.fillText((d.d2 > d.d1 ? `${d.d2 - d.d1 + 1} colunas` : nm).slice(0, 28), gx + w / 2, g0 + (st.hdrH - g0) / 2 + 0.5);
    if (!d.frozen && d.to) {
      const x = Math.round(colX(d.to)) - 1;
      ctx.fillStyle = C.sel; ctx.fillRect(x - 2, 0, 4, H);
    }
    ctx.restore();
  }

  function drawRegion(sh, si, rg) {
    const r0 = Math.max(rg.rows[0], rowAtContent(rg.y - st.hdrH + rg.sy));
    const r1 = Math.min(rg.rows[1], rowAtContent(rg.y - st.hdrH + rg.sy + rg.h));
    const c0 = Math.max(rg.cols[0], colAtContent(rg.x - st.hdrW + rg.sx));
    const c1 = Math.min(rg.cols[1], colAtContent(rg.x - st.hdrW + rg.sx + rg.w));
    const X = (c) => st.hdrW + st.left[c] - rg.sx, Y = (r) => st.hdrH + st.top[r] - rg.sy;
    const showGrid = doc.showGrid && sh.gridlines !== false;
    // 1) linhas de grade
    if (showGrid) {
      ctx.beginPath();
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (let c = c0; c <= c1; c++) { if (!colW(c)) continue; const x = Math.round(X(c + 1)) - 0.5; ctx.moveTo(x, Y(r0)); ctx.lineTo(x, Y(r1 + 1)); }
      for (let r = r0; r <= r1; r++) { if (!rowH(r)) continue; const y = Math.round(Y(r + 1)) - 0.5; ctx.moveTo(X(c0), y); ctx.lineTo(X(c1 + 1), y); }
      ctx.stroke();
    }
    // coleta células visíveis
    const items = [];
    const mergesDone = new Set();
    const occupied = new Set(); // células cobertas por texto transbordado
    for (let r = r0; r <= r1; r++) {
      if (!rowH(r)) continue;
      for (let c = c0; c <= c1; c++) {
        if (!colW(c)) continue;
        const g = sh.merges.length ? App.mergeAt(sh, r, c) : null;
        if (g) {
          const k = g.r1 + ':' + g.c1;
          if (mergesDone.has(k)) continue;
          mergesDone.add(k);
          const info = cellInfo(sh, si, g.r1, g.c1);
          items.push({ r: g.r1, c: g.c1, x: X(g.c1), y: Y(g.r1), w: st.left[g.c2 + 1] - st.left[g.c1], h: st.top[g.r2 + 1] - st.top[g.r1], info, merge: g });
          continue;
        }
        const info = cellInfo(sh, si, r, c);
        if (info.text === '' && !info.s.bg && !info.s.bd && !info.dv && !info.note && !info.comment && !(info.v && typeof info.v === 'object' && !info.isErr)) continue;
        items.push({ r, c, x: X(c), y: Y(r), w: colW(c), h: rowH(r), info });
      }
    }
    // 2) preenchimentos (e fundo branco de mesclagens para esconder a grade interna)
    for (const it of items) {
      const bg = it.info.s.bg || (it.merge ? '#ffffff' : null);
      if (!bg) continue;
      ctx.fillStyle = bg;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      if (it.merge && !it.info.s.bg && showGrid) {
        ctx.strokeStyle = C.grid; ctx.strokeRect(Math.round(it.x) - 0.5, Math.round(it.y) - 0.5, Math.round(it.w), Math.round(it.h));
      }
    }
    // 3) texto transbordado: apaga as linhas de grade cobertas
    const emptyAt = (r, c) => {
      if (App.raw(sh, r, c) !== '') return false;
      if (sh.merges.length && App.mergeAt(sh, r, c)) return false;
      const v = App.value(si, r, c);
      return v === null || v === '';
    };
    for (const it of items) {
      const inf = it.info;
      it.tx = it.x; it.tw = it.w;
      if (it.merge || !inf.text || inf.s.wrap === 'wrap' || inf.s.wrap === 'clip' || inf.dv || typeof inf.v === 'number' || inf.s.rot) continue;
      ctx.font = fontFor(inf.s);
      const need = ctx.measureText(inf.text).width + 6 * st.z;
      if (need <= it.w) continue;
      let x0 = it.x, x1 = it.x + it.w;
      const goRight = inf.align === 'l' || inf.align === 'c';
      const goLeft = inf.align === 'r' || inf.align === 'c';
      const extra = inf.align === 'c' ? (need - it.w) / 2 : need - it.w;
      if (goRight) { let c = it.c + 1; while (x1 - it.x - (inf.align === 'c' ? 0 : 0) < it.w + extra && c <= Math.min(st.nC, c1 + 20) && (colW(c) === 0 || emptyAt(it.r, c))) { if (colW(c)) { occupied.add(it.r + ':' + c); x1 += colW(c); } c++; } }
      if (goLeft) { let c = it.c - 1; while (it.x - x0 < extra && c >= Math.max(1, rg.cols[0]) && (colW(c) === 0 || emptyAt(it.r, c))) { if (colW(c)) { occupied.add(it.r + ':' + c); x0 -= colW(c); } c--; } }
      it.tx = x0; it.tw = x1 - x0;
      if (showGrid && (x0 < it.x || x1 > it.x + it.w)) {
        ctx.fillStyle = inf.s.bg || '#ffffff';
        ctx.fillRect(x0, it.y, x1 - x0 - 1, it.h - 1);
      }
    }
    // 4) bordas
    for (const it of items) if (it.info.s.bd) drawBorders(it);
    // 5) conteúdo
    for (const it of items) drawContent(sh, si, it);
    // destaque de resultados de pesquisa
    if (st.found && st.found.size) {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r + ':' + c;
        if (!st.found.has(k)) continue;
        ctx.fillStyle = st.foundCur === k ? C.foundCur : C.found;
        ctx.fillRect(X(c), Y(r), colW(c) - 1, rowH(r) - 1);
      }
    }
    // ícones de filtro na linha de cabeçalho
    const f = App.activeFilter(sh);
    if (f && f.r1 >= 1 && f.r1 >= r0 && f.r1 <= r1 && (App.views.has(sh.id) || !(App.adminOnly && App.adminOnly()))) {
      for (let c = c0; c <= c1; c++) {
        const rc = RC(c);
        if (!colW(c) || rc < f.c1 || rc > f.c2) continue;
        const x = X(c + 1) - 18 * st.z, y = Y(f.r1) + (rowH(f.r1) - 14 * st.z) / 2, s = 14 * st.z;
        const active = f.crit && f.crit[rc] && ((f.crit[rc].hidden && f.crit[rc].hidden.length) || f.crit[rc].cond);
        ctx.fillStyle = active ? C.sel : '#ffffff';
        ctx.strokeStyle = active ? C.sel : '#9a9a9a';
        roundRect(x, y, s, s, 3 * st.z); ctx.fill(); ctx.stroke();
        ctx.fillStyle = active ? '#ffffff' : '#555';
        ctx.beginPath(); ctx.moveTo(x + 3 * st.z, y + 4 * st.z); ctx.lineTo(x + s - 3 * st.z, y + 4 * st.z); ctx.lineTo(x + s / 2 + 1 * st.z, y + 8 * st.z);
        ctx.lineTo(x + s / 2 + 1 * st.z, y + 11 * st.z); ctx.lineTo(x + s / 2 - 1 * st.z, y + 11 * st.z); ctx.lineTo(x + s / 2 - 1 * st.z, y + 8 * st.z); ctx.closePath(); ctx.fill();
      }
    }
  }

  // Grupos de colunas: faixa com + (recolhido) e − (aberto). Abrir vale só para quem clicou.
  // Cada grupo fica na região das suas colunas (congeladas ou não) e os rótulos não se sobrepõem.
  function drawColGroups(sh, hw, W, z) {
    st.groupBoxes = [];
    if (!st.gut) return;
    const g = st.gut, s = Math.round(12 * z);
    ctx.save();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(hw, 0, W - hw, g);
    ctx.fillStyle = C.hdrLine; ctx.fillRect(hw, g - 1, W - hw, 1);
    ctx.font = `${(10.5 * z).toFixed(1)}px Arial, sans-serif`; ctx.textBaseline = 'middle';
    const regions = [{ clipX: hw, clipW: st.FW, frozen: true }, { clipX: hw + st.FW, clipW: W - hw - st.FW, frozen: false }];
    const groups = sh.colGroups.slice().sort((p, q) => p.c1 - q.c1);
    for (const rg of regions) {
      if (rg.clipW <= 0) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(rg.clipX, 0, rg.clipW, g); ctx.clip();
      let minX = rg.clipX;
      const box = (bx, by, kind) => {
        // kind: plus | minus | lock | unlock
        const red = kind === 'plus' || kind === 'lock';
        ctx.fillStyle = red ? C.sel : '#ffffff'; ctx.strokeStyle = red ? C.sel : '#5f6368'; ctx.lineWidth = 1;
        roundRect(bx + 0.5, by + 0.5, s, s, 2 * z); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = red ? '#ffffff' : '#3c4043'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.5 * z;
        ctx.beginPath();
        if (kind === 'plus' || kind === 'minus') {
          ctx.moveTo(bx + 3 * z, by + s / 2 + 0.5); ctx.lineTo(bx + s - 2 * z, by + s / 2 + 0.5);
          if (kind === 'plus') { ctx.moveTo(bx + s / 2 + 0.5, by + 3 * z); ctx.lineTo(bx + s / 2 + 0.5, by + s - 2 * z); }
          ctx.stroke();
        } else {
          // cadeado (travado: fechado em vermelho; destravado: aberto)
          ctx.fillRect(bx + 3 * z, by + s / 2, s - 5 * z, s / 2 - 2 * z);
          ctx.beginPath(); ctx.arc(bx + s / 2 + 0.5, by + s / 2, 2.6 * z, Math.PI, kind === 'lock' ? 0 : -0.3 * Math.PI); ctx.stroke();
        }
      };
      for (const grp of groups) {
        const inFrozen = grp.c1 <= st.Fc;
        if (inFrozen !== rg.frozen) continue;
        const open = App.isGroupOpen(sh, grp), locked = open && App.isGroupLocked(sh, grp);
        const x1 = colX(grp.c1), x2 = colX(grp.c2) + colW(grp.c2);
        const by = Math.round((g - s) / 2);
        const label = grp.label || '';
        if (open) {
          const lockX = Math.round(x2 - 2 * s - 6 * z), minusX = Math.round(x2 - s - 3 * z);
          const start = Math.max(x1, minX) + 4 * z;
          ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 1.5 * z;
          ctx.beginPath(); ctx.moveTo(start, g / 2); ctx.lineTo(lockX - 3 * z, g / 2); ctx.moveTo(start, g / 2 - 3 * z); ctx.lineTo(start, g / 2 + 3 * z); ctx.stroke();
          if (label) {
            const room = lockX - start - 14 * z;
            let t = label;
            while (t.length > 1 && ctx.measureText(t).width > room) t = t.slice(0, -1);
            if (t !== label && t.length > 1) t = t.slice(0, -1) + '…';
            if (room > 12 * z) { const tw = ctx.measureText(t).width + 8 * z; ctx.fillStyle = '#ffffff'; ctx.fillRect(start + 6 * z, 1, tw, g - 3); ctx.fillStyle = '#3c4043'; ctx.textAlign = 'left'; ctx.fillText(t, start + 10 * z, g / 2); }
          }
          box(lockX, by, locked ? 'lock' : 'unlock');
          box(minusX, by, 'minus');
          st.groupBoxes.push({ x: lockX - 1, w: s + 2, id: grp.id, act: 'lock' }, { x: minusX - 1, w: s + 2, id: grp.id, act: 'toggle' });
          minX = x2;
        } else {
          const bx = Math.round(Math.max(x1 + 2 * z, minX + 4 * z));
          box(bx, by, 'plus');
          let w = s;
          if (label) { ctx.fillStyle = '#3c4043'; ctx.textAlign = 'left'; ctx.fillText(label, bx + s + 4 * z, g / 2); w += 6 * z + ctx.measureText(label).width; }
          st.groupBoxes.push({ x: bx - 2, w: w + 4, id: grp.id, act: 'toggle', clipX: rg.clipX, clipW: rg.clipW });
          minX = bx + w + 2 * z;
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Títulos dos grupos da visualização agrupada (cores fortes; grupos dentro de grupos ficam recuados)
  const GROUP_COLORS = [['#c5221f', '#ffffff'], ['#f28b82', '#3c0a08'], ['#fce8e6', '#5a0006']];
  function drawGroupRows(sh) {
    if (!st.vm) return;
    const z = st.z, hw = st.hdrW, W = st.vw;
    const r0 = Math.max(st.Fr + 1, rowAtContent(st.FH + st.sy)), r1 = Math.min(st.nR, rowAtContent(st.vh - st.hdrH + st.sy));
    ctx.save();
    ctx.beginPath(); ctx.rect(hw, st.hdrH + st.FH, W - hw, st.vh - st.hdrH - st.FH); ctx.clip();
    for (let r = r0; r <= r1; r++) {
      const g = GROUP(r);
      if (!g) continue;
      const y = rowY(r), h = rowH(r);
      const [bg, fg] = GROUP_COLORS[Math.min(g.level, 2)];
      ctx.fillStyle = bg; ctx.fillRect(hw, y, W - hw, h);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(hw, y + h - 1, W - hw, 1);
      const x0 = hw + 8 * z + g.level * 22 * z, s = Math.round(14 * z), by = Math.round(y + (h - s) / 2);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = g.level === 0 ? '#ffffff' : '#c5221f'; ctx.lineWidth = 1;
      roundRect(x0 + 0.5, by + 0.5, s, s, 3 * z); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c5221f'; ctx.lineWidth = 1.8 * z;
      ctx.beginPath(); ctx.moveTo(x0 + 3.5 * z, by + s / 2 + 0.5); ctx.lineTo(x0 + s - 2.5 * z, by + s / 2 + 0.5);
      if (g.closed) { ctx.moveTo(x0 + s / 2 + 0.5, by + 3.5 * z); ctx.lineTo(x0 + s / 2 + 0.5, by + s - 2.5 * z); }
      ctx.stroke();
      ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const name = App.colLabelOf ? App.colLabelOf(sh, g.col) : E.numToCol(g.col);
      ctx.font = `${(11 * z).toFixed(1)}px Arial, sans-serif`;
      const lbl = name + ': ';
      ctx.fillText(lbl, x0 + s + 8 * z, y + h / 2);
      const lw = ctx.measureText(lbl).width;
      ctx.font = `bold ${(12.5 * z).toFixed(1)}px Arial, sans-serif`;
      const val = g.value === '' ? '(Vazio)' : g.value;
      ctx.fillText(val, x0 + s + 8 * z + lw, y + h / 2);
      const vw = ctx.measureText(val).width;
      ctx.font = `${(11 * z).toFixed(1)}px Arial, sans-serif`;
      ctx.fillText(`  ·  ${g.count} ${g.count === 1 ? 'linha' : 'linhas'}`, x0 + s + 8 * z + lw + vw, y + h / 2);
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawBorders(it) {
    const bd = it.info.s.bd;
    const line = (b, x1, y1, x2, y2) => {
      if (!b) return;
      ctx.save();
      ctx.strokeStyle = b.color || '#000000';
      const w = b.style === 'thick' ? 3 : b.style === 'medium' ? 2 : 1;
      ctx.lineWidth = w;
      if (b.style === 'dashed') ctx.setLineDash([4, 2]);
      if (b.style === 'dotted') ctx.setLineDash([1, 2]);
      const off = w % 2 ? 0.5 : 0;
      ctx.beginPath();
      if (b.style === 'double') {
        const dx = y1 === y2 ? 0 : 1.5, dy = y1 === y2 ? 1.5 : 0;
        ctx.moveTo(Math.round(x1 - dx) + off, Math.round(y1 - dy) + off); ctx.lineTo(Math.round(x2 - dx) + off, Math.round(y2 - dy) + off);
        ctx.moveTo(Math.round(x1 + dx) + off, Math.round(y1 + dy) + off); ctx.lineTo(Math.round(x2 + dx) + off, Math.round(y2 + dy) + off);
      } else {
        ctx.moveTo(Math.round(x1) - off, Math.round(y1) - off); ctx.lineTo(Math.round(x2) - off, Math.round(y2) - off);
      }
      ctx.stroke();
      ctx.restore();
    };
    const { x, y, w, h } = it;
    line(bd.t, x, y, x + w, y);
    line(bd.b, x, y + h, x + w, y + h);
    line(bd.l, x, y, x, y + h);
    line(bd.r, x + w, y, x + w, y + h);
  }

  function wrapLines(text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(/(\s+)/);
      let line = '';
      for (const w of words) {
        const test = line + w;
        if (ctx.measureText(test).width > maxW && line.trim() !== '') { out.push(line.trimEnd()); line = w.trimStart(); }
        else line = test;
        // palavra maior que a largura: quebra por caractere
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      }
      out.push(line);
    }
    return out;
  }

  function drawContent(sh, si, it) {
    const inf = it.info, s = inf.s, z = st.z;
    const pad = 3 * z;
    ctx.save();
    // indicadores no canto superior direito
    const tri = (color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(it.x + it.w - 7 * z, it.y); ctx.lineTo(it.x + it.w - 1, it.y); ctx.lineTo(it.x + it.w - 1, it.y + 7 * z - 1); ctx.closePath(); ctx.fill();
    };
    const invalid = inf.dv && inf.raw !== '' && inf.dv.type !== 'checkbox' && !App.validate(sh, it.r, it.c, String(inf.raw));
    // minigráfico (SPARKLINE) e imagem na célula (IMAGEM)
    if (E.Sparkline && inf.v instanceof E.Sparkline) { drawSparkline(inf.v, it); ctx.restore(); return; }
    if (E.CellImage && inf.v instanceof E.CellImage) { drawCellImage(inf.v, it); ctx.restore(); return; }
    // caixa de seleção
    if (inf.dv && inf.dv.type === 'checkbox') {
      const size = Math.round(12 * z);
      const cx = s.al === 'l' ? it.x + pad + size / 2 : s.al === 'r' ? it.x + it.w - pad - size / 2 : it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      const on = App.cbIsOn(inf.dv, inf.raw, inf.v);
      ctx.lineWidth = 1.5 * z;
      roundRect(cx - size / 2, cy - size / 2, size, size, 2 * z);
      if (on) { ctx.fillStyle = C.check; ctx.fill(); ctx.strokeStyle = C.check; ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8 * z; ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy); ctx.lineTo(cx - size * 0.06, cy + size * 0.22); ctx.lineTo(cx + size * 0.3, cy - size * 0.22); ctx.stroke();
      } else { ctx.strokeStyle = '#5f5f5f'; ctx.stroke(); }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.rect(it.tx + 1, it.y + 1, it.tw - 2, it.h - 2);
    ctx.clip();
    ctx.font = fontFor(s);
    let color = s.color || '#000000';
    if (inf.link && !s.color) color = C.link;
    ctx.fillStyle = color;
    // lista suspensa em formato de chip
    if (inf.dv && (inf.dv.type === 'list' || inf.dv.type === 'range')) {
      const arrow = 9 * z;
      if (inf.dv.style === 'arrow' || inf.text === '') {
        ctx.fillStyle = '#5f5f5f';
        const ax = it.x + it.w - pad - arrow, ay = it.y + it.h / 2 - 2 * z;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + arrow, ay); ctx.lineTo(ax + arrow / 2, ay + 5 * z); ctx.closePath(); ctx.fill();
        if (inf.text) { ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(inf.text, it.x + pad, it.y + it.h / 2 + 0.5); }
      } else {
        const colorMap = inf.dv.colors || {};
        const tw = ctx.measureText(inf.text).width;
        const chipH = Math.min(it.h - 4 * z, 18 * z), chipW = Math.min(it.w - 2 * pad, tw + 26 * z);
        const cx = it.x + pad, cy = it.y + (it.h - chipH) / 2;
        ctx.fillStyle = colorMap[inf.text] || C.chipBg;
        roundRect(cx, cy, chipW, chipH, chipH / 2); ctx.fill();
        ctx.fillStyle = s.color || '#1a1a1a';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(inf.text, cx + 8 * z, cy + chipH / 2 + 0.5);
        ctx.fillStyle = '#5f5f5f';
        const ax = cx + chipW - 14 * z, ay = cy + chipH / 2 - 2 * z;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 7 * z, ay); ctx.lineTo(ax + 3.5 * z, ay + 4 * z); ctx.closePath(); ctx.fill();
      }
    } else if (inf.text !== '') {
      const fs = (s.fs || 10) * 1.333 * z;
      const lineH = fs * 1.22;
      let lines;
      const avail = it.w - 2 * pad;
      if (s.wrap === 'wrap') lines = wrapLines(inf.text, avail);
      else lines = String(inf.text).split('\n');
      // número que não cabe: mostra ####### (como planilhas fazem com datas e números)
      if (typeof inf.v === 'number' && s.wrap !== 'wrap' && lines.length === 1 && ctx.measureText(lines[0]).width > avail && !inf.merge && !doc.showFormulas) {
        const hashes = Math.max(1, Math.floor(avail / ctx.measureText('#').width));
        lines = ['#'.repeat(hashes)];
      }
      const totalH = lines.length * lineH;
      const va = s.va || 'b';
      let y0 = va === 't' ? it.y + pad : va === 'm' ? it.y + (it.h - totalH) / 2 : it.y + it.h - pad - totalH;
      if (lines.length > 1 && va === 'b' && totalH > it.h) y0 = it.y + pad;
      ctx.textBaseline = 'middle';
      const xs = { l: it.tx + pad, c: it.tx + it.tw / 2, r: it.tx + it.tw - pad };
      const align = inf.align;
      ctx.textAlign = align === 'l' ? 'left' : align === 'c' ? 'center' : 'right';
      const tx = align === 'l' ? (s.indent ? xs.l + s.indent * 10 * z : xs.l) : xs[align];
      lines.forEach((ln, i) => {
        const y = y0 + i * lineH + lineH / 2 + 0.5;
        if (s.rot) {
          ctx.save(); ctx.translate(it.x + it.w / 2, it.y + it.h / 2); ctx.rotate((-s.rot * Math.PI) / 180);
          ctx.textAlign = 'center'; ctx.fillText(ln, 0, 0); ctx.restore();
          return;
        }
        ctx.fillText(ln, tx, y);
        if (s.u || s.st || inf.link) {
          const w = ctx.measureText(ln).width;
          const lx = align === 'l' ? tx : align === 'c' ? tx - w / 2 : tx - w;
          ctx.fillRect(lx, s.st ? y - 0.5 * z : y + fs * 0.42, w, Math.max(1, z));
          if (s.u && s.st) ctx.fillRect(lx, y + fs * 0.42, w, Math.max(1, z));
        }
      });
    }
    ctx.restore();
    if (inf.isErr || invalid) tri(C.err);
    else if (inf.comment) tri(C.comment);
    else if (inf.note) tri(C.note);
  }

  function drawSparkline(sp, it) {
    const o = sp.opts, z = st.z;
    const vals = sp.values;
    const nums = vals.filter((v) => v !== null);
    if (!nums.length) return;
    const pad = 3 * z, x = it.x + pad, y = it.y + pad, w = it.w - 2 * pad, h = it.h - 2 * pad;
    const type = String(o.charttype || 'line').toLowerCase();
    const color = o.color || o.color1 || '#e30613';
    ctx.save();
    ctx.beginPath(); ctx.rect(it.x + 1, it.y + 1, it.w - 2, it.h - 2); ctx.clip();
    if (type === 'bar') {
      // barra única empilhada com 1 ou 2 valores
      const max = typeof o.max === 'number' ? o.max : nums.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let cx = x;
      nums.slice(0, 2).forEach((v, i) => {
        const bw = Math.max(0, Math.min(w, (Math.max(0, v) / max) * w));
        ctx.fillStyle = i === 0 ? color : (o.color2 || '#1a1a1a');
        ctx.fillRect(cx, y + h * 0.2, bw, h * 0.6);
        cx += bw;
      });
    } else {
      const min = typeof o.ymin === 'number' ? o.ymin : Math.min(0, ...nums), max = typeof o.ymax === 'number' ? o.ymax : Math.max(...nums);
      const span = max - min || 1;
      const n = vals.length;
      const Y = (v) => y + h - ((v - min) / span) * h;
      if (type === 'column' || type === 'winloss') {
        const bw = w / n;
        vals.forEach((v, i) => {
          if (v === null) return;
          if (type === 'winloss') {
            ctx.fillStyle = v >= 0 ? color : (o.negcolor || '#1a1a1a');
            ctx.fillRect(x + i * bw + bw * 0.1, v >= 0 ? y : y + h / 2, bw * 0.8, h / 2 - 1);
          } else {
            ctx.fillStyle = v < 0 ? (o.negcolor || '#1a1a1a') : (i === n - 1 && o.highcolor ? o.highcolor : color);
            const top = Y(Math.max(v, 0)), bottom = Y(Math.min(v, 0));
            ctx.fillRect(x + i * bw + bw * 0.12, top, bw * 0.76, Math.max(1, bottom - top));
          }
        });
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = (o.linewidth || 1.5) * z;
        ctx.beginPath();
        let started = false;
        vals.forEach((v, i) => {
          if (v === null) return;
          const px = x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
          if (!started) { ctx.moveTo(px, Y(v)); started = true; } else ctx.lineTo(px, Y(v));
        });
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const imgCache = new Map();
  function drawCellImage(im, it) {
    let img = imgCache.get(im.url);
    if (!img) {
      img = new Image();
      img.onload = schedule;
      img.onerror = () => { img.failed = true; schedule(); };
      img.src = im.url;
      imgCache.set(im.url, img);
    }
    if (!img.complete || img.failed || !img.naturalWidth) {
      if (img.failed) { ctx.fillStyle = '#8a8a8a'; ctx.font = `${11 * st.z}px Arial`; ctx.textBaseline = 'middle'; ctx.fillText('Imagem indisponível', it.x + 4, it.y + it.h / 2); }
      return;
    }
    const pad = 2 * st.z, W = it.w - 2 * pad, H = it.h - 2 * pad;
    let dw = W, dh = H;
    if (im.mode === 1 || !im.mode) { const k = Math.min(W / img.naturalWidth, H / img.naturalHeight); dw = img.naturalWidth * k; dh = img.naturalHeight * k; }
    else if (im.mode === 3) { dw = img.naturalWidth * st.z; dh = img.naturalHeight * st.z; }
    else if (im.mode === 4) { dw = (im.w || img.naturalWidth) * st.z; dh = (im.h || img.naturalHeight) * st.z; }
    ctx.save();
    ctx.beginPath(); ctx.rect(it.x + 1, it.y + 1, it.w - 2, it.h - 2); ctx.clip();
    ctx.drawImage(img, it.x + pad + (W - dw) / 2, it.y + pad + (H - dh) / 2, dw, dh);
    ctx.restore();
  }

  function drawOverlays(sh, rg) {
    const X = (c) => st.hdrW + st.left[c] - rg.sx, Y = (r) => st.hdrH + st.top[r] - rg.sy;
    const z = st.z;
    const box = (R) => ({ x: X(R.c1), y: Y(R.r1), w: st.left[R.c2 + 1] - st.left[R.c1], h: st.top[R.r2 + 1] - st.top[R.r1] });
    // referências da fórmula em edição (cores)
    if (st.refs.length) {
      for (const ref of st.refs) {
        if (ref.si !== doc.active) continue;
        const b = box(ref.R);
        ctx.fillStyle = ref.color + '1f';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = ref.color; ctx.lineWidth = ref.active ? 2 : 1.5;
        ctx.setLineDash(ref.active ? [5, 3] : []);
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.setLineDash([]);
      }
    }
    // cursores de outras pessoas (edição em tempo real)
    if (st.peers && st.peers.length) {
      const sid = sh.id;
      ctx.font = `500 ${(11 * z).toFixed(1)}px Arial, sans-serif`;
      for (const p of st.peers) {
        if (!p.sel || p.sheetId !== sid) continue;
        const pb = box(p.sel);
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(pb.x) + 1, Math.round(pb.y) + 1, Math.round(pb.w) - 2, Math.round(pb.h) - 2);
        ctx.fillStyle = p.color + '14';
        ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
        const label = p.name + (p.editing ? ' (editando)' : '');
        const tw = ctx.measureText(label).width + 10 * z, th = 16 * z;
        const ly = pb.y - th >= rg.y ? pb.y - th : pb.y + pb.h;
        ctx.fillStyle = p.color;
        ctx.fillRect(pb.x + pb.w - tw, ly, tw, th);
        ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(label, pb.x + pb.w - tw + 5 * z, ly + th / 2 + 0.5);
      }
    }
    // seleção
    const R = App.selRect();
    const b = box(R);
    const single = App.selIsCell();
    if (!single) {
      // sombreia a seleção, exceto a célula ativa (como no Sheets)
      const a = cellRect(sel.ar, sel.ac);
      const ax = X(a.c1), ay = Y(a.r1);
      ctx.fillStyle = C.selFill;
      ctx.fillRect(b.x, b.y, b.w, ay - b.y);
      ctx.fillRect(b.x, ay + a.h, b.w, b.y + b.h - ay - a.h);
      ctx.fillRect(b.x, ay, ax - b.x, a.h);
      ctx.fillRect(ax + a.w, ay, b.x + b.w - ax - a.w, a.h);
      ctx.strokeStyle = C.sel; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w) - 1, Math.round(b.h) - 1);
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(ax) + 1, Math.round(ay) + 1, Math.round(a.w) - 2, Math.round(a.h) - 2);
    } else if (!App.editing || !App.editing()) {
      ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(b.x) + 1, Math.round(b.y) + 1, Math.round(b.w) - 2, Math.round(b.h) - 2);
    }
    // alça de preenchimento
    if (!App.editing || !App.editing()) {
      const hx = b.x + b.w - 4, hy = b.y + b.h - 4;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - 1, hy - 1, 8, 8);
      ctx.fillStyle = C.sel; ctx.fillRect(hx, hy, 6, 6);
    }
    // prévia do preenchimento
    if (st.fillPreview) {
      const p = box(st.fillPreview);
      ctx.strokeStyle = '#5f5f5f'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1); ctx.setLineDash([]);
    }
    // contorno do que foi copiado
    if (st.marquee && st.marquee.si === doc.active) {
      const m = box(st.marquee.R);
      ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -((Date.now() / 60) % 10);
      ctx.strokeRect(m.x + 1, m.y + 1, m.w - 2, m.h - 2); ctx.setLineDash([]);
    }
    // contorno do filtro
    const af = App.activeFilter(sh);
    if (af) {
      const f = box(Object.assign({}, af, { r1: Math.max(1, af.r1), r2: Math.min(st.nR, App.filterEnd(sh)) }));
      ctx.strokeStyle = C.sel; ctx.lineWidth = 1.5;
      ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
    }
    void z;
  }

  function drawHeaders(sh) {
    const W = st.vw, H = st.vh, hw = st.hdrW, hh = st.hdrH, z = st.z;
    const R = App.selRect();
    const fullCols = R.r1 === 1 && R.r2 >= st.nR;
    const fullRows = R.c1 === 1 && R.c2 >= st.nC;
    ctx.font = `${(11 * z).toFixed(1)}px Arial, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    // cabeçalho de colunas
    const viewOn = App.views.has(sh.id);
    const hdrBg = viewOn ? '#3c4043' : C.hdrBg, hdrText = viewOn ? '#e8eaed' : C.hdrText;
    ctx.fillStyle = hdrBg; ctx.fillRect(hw, 0, W - hw, hh);
    const drawCols = (from, to, sx, clipX, clipW) => {
      const hh = st.hdrH - st.gut; // altura das letras (abaixo da faixa de grupos)
      if (clipW <= 0) return;
      ctx.save(); ctx.translate(0, st.gut);
      ctx.save(); ctx.beginPath(); ctx.rect(clipX, 0, clipW, hh); ctx.clip();
      const c0 = Math.max(from, colAtContent(clipX - hw + sx)), c1 = Math.min(to, colAtContent(clipX - hw + sx + clipW));
      for (let c = c0; c <= c1; c++) {
        const w = colW(c), x = hw + st.left[c] - sx;
        if (!w) {
          if (!sh.hiddenCols[c]) continue; // oculta por permissão: sem marcador
          // marcador de coluna oculta
          ctx.fillStyle = '#7a7a7a';
          ctx.beginPath(); ctx.moveTo(x - 6 * z, hh / 2 - 4 * z); ctx.lineTo(x - 2 * z, hh / 2); ctx.lineTo(x - 6 * z, hh / 2 + 4 * z); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + 6 * z, hh / 2 - 4 * z); ctx.lineTo(x + 2 * z, hh / 2); ctx.lineTo(x + 6 * z, hh / 2 + 4 * z); ctx.fill();
          continue;
        }
        const inSel = c >= R.c1 && c <= R.c2;
        // cabeçalho personalizado (fundo, cor do texto, negrito)
        const rc = RC(c);
        const hs = sh.colHdr && sh.colHdr[rc];
        if (hs && hs.bg) { ctx.fillStyle = hs.bg; ctx.fillRect(x, 0, w, hh); }
        if (inSel) { ctx.fillStyle = fullCols ? C.hdrFullBg : C.hdrSelBg; if (hs && hs.bg) ctx.globalAlpha = 0.45; ctx.fillRect(x, 0, w, hh); ctx.globalAlpha = 1; }
        ctx.fillStyle = inSel && !(hs && hs.bg) ? (fullCols ? C.hdrFullText : C.hdrSelText) : (hs && hs.color) || (hs && hs.bg ? '#000000' : inSel ? C.hdrSelText : hdrText);
        ctx.font = `${inSel || (hs && hs.b) ? 'bold ' : ''}${(11 * z).toFixed(1)}px Arial, sans-serif`;
        const nm = sh.colNames && sh.colNames[rc];
        if (nm) {
          // nome dado pelo administrador (ex.: CLIENTE) no lugar da letra
          let t = String(nm);
          const room = w - (App.colReadonly && App.colReadonly(sh, c) ? 26 : 10) * z;
          if (ctx.measureText(t).width > room) { while (t.length > 1 && ctx.measureText(t + '…').width > room) t = t.slice(0, -1); t += '…'; }
          ctx.fillText(t, x + w / 2, hh / 2 + 0.5);
        } else ctx.fillText(E.numToCol(rc), x + w / 2, hh / 2 + 0.5);
        if (App.colReadonly && w > 34 * z && App.colReadonly(sh, rc)) {
          // cadeado: coluna somente para visualizar
          const lx = x + w - 13 * z, ly = hh / 2 - 1 * z;
          ctx.fillStyle = '#8a8a8a'; ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1.2 * z;
          ctx.fillRect(lx - 3.5 * z, ly, 7 * z, 5.5 * z);
          ctx.beginPath(); ctx.arc(lx, ly, 2.4 * z, Math.PI, 0); ctx.stroke();
        }
        const hf = App.activeFilter(sh);
        if (hf && hf.r1 === 0 && rc >= hf.c1 && rc <= hf.c2 && w > 24 * z) {
          // botão de filtro no cabeçalho da coluna
          const s = 14 * z, bx = x + w - 18 * z, by = (hh - s) / 2;
          const active = hf.crit && hf.crit[rc] && ((hf.crit[rc].hidden && hf.crit[rc].hidden.length) || hf.crit[rc].cond);
          const showBtn = (App.views.has(sh.id) || !(App.adminOnly && App.adminOnly()));
          if (showBtn || active) {
            ctx.fillStyle = active ? C.sel : '#ffffff'; ctx.strokeStyle = active ? C.sel : '#9a9a9a'; ctx.lineWidth = 1;
            roundRect(bx, by, s, s, 3 * z); ctx.fill(); ctx.stroke();
            ctx.fillStyle = active ? '#ffffff' : '#555';
            ctx.beginPath(); ctx.moveTo(bx + 3 * z, by + 4 * z); ctx.lineTo(bx + s - 3 * z, by + 4 * z); ctx.lineTo(bx + s / 2 + 1 * z, by + 8 * z);
            ctx.lineTo(bx + s / 2 + 1 * z, by + 11 * z); ctx.lineTo(bx + s / 2 - 1 * z, by + 11 * z); ctx.lineTo(bx + s / 2 - 1 * z, by + 8 * z); ctx.closePath(); ctx.fill();
          }
        }
        ctx.fillStyle = C.hdrLine; ctx.fillRect(Math.round(x + w) - 1, 0, 1, hh);
      }
      ctx.restore();
      ctx.restore();
    };
    drawCols(st.Fc + 1, st.nC, st.sx, hw + st.FW, W - hw - st.FW);
    drawCols(1, st.Fc, 0, hw, st.FW);
    drawColGroups(sh, hw, W, z);
    ctx.fillStyle = C.hdrLine; ctx.fillRect(hw, hh - 1, W - hw, 1);
    // cabeçalho de linhas
    ctx.fillStyle = hdrBg; ctx.fillRect(0, hh, hw, H - hh);
    const drawRows = (from, to, sy, clipY, clipH) => {
      if (clipH <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.rect(0, clipY, hw, clipH); ctx.clip();
      const r0 = Math.max(from, rowAtContent(clipY - hh + sy)), r1 = Math.min(to, rowAtContent(clipY - hh + sy + clipH));
      for (let r = r0; r <= r1; r++) {
        const h = rowH(r), y = hh + st.top[r] - sy;
        if (!h) {
          ctx.fillStyle = '#7a7a7a';
          ctx.beginPath(); ctx.moveTo(hw / 2 - 4 * z, y - 6 * z); ctx.lineTo(hw / 2, y - 2 * z); ctx.lineTo(hw / 2 + 4 * z, y - 6 * z); ctx.fill();
          ctx.beginPath(); ctx.moveTo(hw / 2 - 4 * z, y + 6 * z); ctx.lineTo(hw / 2, y + 2 * z); ctx.lineTo(hw / 2 + 4 * z, y + 6 * z); ctx.fill();
          continue;
        }
        const inSel = r >= R.r1 && r <= R.r2;
        if (inSel) { ctx.fillStyle = fullRows ? C.hdrFullBg : C.hdrSelBg; ctx.fillRect(0, y, hw, h); }
        ctx.fillStyle = inSel ? (fullRows ? C.hdrFullText : C.hdrSelText) : hdrText;
        ctx.font = `${inSel ? 'bold ' : ''}${(11 * z).toFixed(1)}px Arial, sans-serif`;
        const gr = GROUP(r);
        if (gr) { ctx.fillStyle = GROUP_COLORS[Math.min(gr.level, 2)][0]; ctx.fillRect(0, y, hw - 1, h); continue; }
        ctx.fillText(String(RR(r)), hw / 2, y + h / 2 + 0.5);
        ctx.fillStyle = C.hdrLine; ctx.fillRect(0, Math.round(y + h) - 1, hw, 1);
      }
      ctx.restore();
    };
    drawRows(st.Fr + 1, st.nR, st.sy, hh + st.FH, H - hh - st.FH);
    drawRows(1, st.Fr, 0, hh, st.FH);
    ctx.fillStyle = C.hdrLine; ctx.fillRect(hw - 1, hh, 1, H - hh);
    // canto
    ctx.fillStyle = hdrBg; ctx.fillRect(0, 0, hw, hh);
    ctx.fillStyle = C.hdrLine; ctx.fillRect(hw - 1, 0, 1, hh); ctx.fillRect(0, hh - 1, hw, 1);
    // barras de congelamento no canto (arrastáveis)
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, hh - 4 + st.FH * 0, hw, st.Fr ? 0 : 3);
    ctx.fillRect(hw - 4, 0, st.Fc ? 0 : 3, hh);
  }

  // Barra "Adicionar mais linhas" ao chegar no fim
  function positionAddRows(sh) {
    const y = st.hdrH + st.top[st.nR + 1] - st.sy;
    if (y < st.vh && y > st.hdrH) {
      addRowsBar.hidden = false;
      addRowsBar.style.top = y + 10 + 'px';
      addRowsBar.style.left = st.hdrW + 10 + 'px';
    } else addRowsBar.hidden = true;
  }

  // ---------- Testes de posição ----------
  function hit(x, y) {
    const sh = App.sheet();
    if (x < 0 || y < 0 || x > st.vw || y > st.vh) return { area: 'out' };
    const locked = !!(App.adminOnly && App.adminOnly());
    if (y < st.hdrH && x < st.hdrW) {
      if (locked) return { area: 'corner' };
      if (y > st.hdrH - 6) return { area: 'freezeRowBar' };
      if (x > st.hdrW - 6) return { area: 'freezeColBar' };
      return { area: 'corner' };
    }
    if (y < st.hdrH) {
      if (st.gut && y < st.gut) {
        const b = (st.groupBoxes || []).find((q) => x >= q.x && x <= q.x + q.w);
        return b ? { area: 'colGroup', id: b.id, act: b.act } : { area: 'gutter' };
      }
      const c = colAtScreen(x);
      // filtro criado a partir da coluna: botão no próprio cabeçalho
      const hf = App.activeFilter(sh);
      if (hf && hf.r1 === 0 && RC(c) >= hf.c1 && RC(c) <= hf.c2 && colW(c) && (App.views.has(sh.id) || !(App.adminOnly && App.adminOnly())) && x > colX(c) + colW(c) - 22 * st.z && x < colX(c) + colW(c) - 4) return { area: 'filterHdr', c };
      // planilha compartilhada: só administradores mexem na estrutura das colunas
      if (locked || (App.colsLocked && App.colsLocked())) return { area: 'colHdr', c };
      const right = colX(c) + colW(c);
      if (Math.abs(x - right) <= 4) return { area: 'colEdge', c };
      const left = colX(c);
      if (Math.abs(x - left) <= 4 && c > 1) {
        let p = c - 1; while (p > 1 && !colW(p)) p--;
        if (!colW(c - 1) && App.sheet().hiddenCols[c - 1]) return { area: 'unhideCols', c };
        return { area: 'colEdge', c: p };
      }
      return { area: 'colHdr', c };
    }
    if (x < st.hdrW) {
      const r = rowAtScreen(y);
      if (locked) return { area: 'rowHdr', r };
      const bottom = rowY(r) + rowH(r);
      if (Math.abs(y - bottom) <= 3) return { area: 'rowEdge', r };
      const top = rowY(r);
      if (Math.abs(y - top) <= 3 && r > 1) {
        if (!rowH(r - 1)) return { area: 'unhideRows', r };
        let p = r - 1; while (p > 1 && !rowH(p)) p--;
        return { area: 'rowEdge', r: p };
      }
      return { area: 'rowHdr', r };
    }
    const r = Math.min(st.nR, rowAtScreen(y)), c = Math.min(st.nC, colAtScreen(x));
    const R = App.selRect();
    const sb = cellRectRange(R);
    if (!(App.editing && App.editing()) && Math.abs(x - (sb.x + sb.w)) <= 5 && Math.abs(y - (sb.y + sb.h)) <= 5) return { area: 'fill', r, c };
    return { area: 'cell', r, c };
  }
  function cellRectRange(R) {
    return { x: colX(R.c1), y: rowY(R.r1), w: st.left[R.c2 + 1] - st.left[R.c1], h: st.top[R.r2 + 1] - st.top[R.r1] };
  }
  function pos(e) { const rc = wrap.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; }

  // ---------- Mouse ----------
  let lastMouse = null, autoTimer = null;
  function onDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    const p = pos(e);
    const h = hit(p.x, p.y);
    App.emit('gridMouseDown', h);
    if (e.button === 2) {
      // botão direito: seleciona a célula se estiver fora da seleção
      const R = App.selRect();
      if (h.area === 'cell' && !App.inRect(R, h.r, h.c)) { if (App.editing && App.editing()) App.commitEdit(); select(h.r, h.c, false, true); }
      if (h.area === 'colHdr' && !(h.c >= R.c1 && h.c <= R.c2 && R.r1 === 1 && R.r2 >= st.nR)) selectCols(h.c, h.c);
      if (h.area === 'rowHdr' && !(h.r >= R.r1 && h.r <= R.r2 && R.c1 === 1 && R.c2 >= st.nC)) selectRows(h.r, h.r);
      return;
    }
    e.preventDefault();
    const sh = App.sheet();
    // modo apontar (inserir referências durante a edição de fórmula)
    if (App.editing && App.editing() && App.editorWantsPoint && (h.area === 'cell' || h.area === 'colHdr' || h.area === 'rowHdr') && App.editorWantsPoint()) {
      st.drag = { kind: 'point', start: h };
      App.pointRef(h, h, false);
      bindDrag();
      return;
    }
    if (App.editing && App.editing()) App.commitEdit();
    focusGrid();
    switch (h.area) {
      case 'corner': selectRange({ r1: 1, c1: 1, r2: st.nR, c2: st.nC }); return;
      case 'colEdge': st.drag = { kind: 'colResize', c: RC(h.c), x0: p.x, w0: sh.colW[RC(h.c)] || App.DEF_W }; bindDrag(); return;
      case 'rowEdge': if (!RR(h.r)) return; st.drag = { kind: 'rowResize', r: RR(h.r), y0: p.y, h0: sh.rowH[RR(h.r)] || App.DEF_H }; bindDrag(); return;
      case 'unhideCols': App.change('Reexibir colunas', () => { let c = h.c - 1; while (c >= 1 && sh.hiddenCols[c]) { delete sh.hiddenCols[c]; c--; } }); return;
      case 'unhideRows': App.change('Reexibir linhas', () => { let r = h.r - 1; while (r >= 1 && sh.hiddenRows[r]) { delete sh.hiddenRows[r]; r--; } }); return;
      case 'freezeRowBar': st.drag = { kind: 'freezeRows' }; bindDrag(); return;
      case 'colGroup': if (h.act === 'lock') App.toggleGroupLock(sh, h.id); else App.toggleGroup(sh, h.id); return;
      case 'gutter': return;
      case 'filterHdr': App.emit('filterMenu', { c: RC(h.c), x: colX(h.c) + colW(h.c), y: st.hdrH }); return;
      case 'freezeColBar': st.drag = { kind: 'freezeCols' }; bindDrag(); return;
      case 'colHdr': {
        // visualização de filtro: segurar a coluna selecionada e arrastar muda a ordem (só para você)
        // basta segurar o cabeçalho e arrastar; Shift+clique seleciona várias colunas para mover juntas
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && App.views.has(sh.id)) {
          let Rs = App.selRect();
          if (!(Rs.r1 === 1 && Rs.r2 >= st.nR && h.c >= Rs.c1 && h.c <= Rs.c2)) { selectCols(h.c, h.c); Rs = App.selRect(); }
          st.drag = { kind: 'colMove', d1: Rs.c1, d2: Rs.c2, x0: p.x, px: p.x, to: null, active: false, frozen: Rs.c1 <= st.Fc };
          bindDrag(); return;
        }
      }
        if (e.shiftKey) { sel.ec = h.c; sel.er = st.nR; sel.ar = 1; App.emit('selection'); schedule(); }
        else selectCols(h.c, h.c);
        st.drag = { kind: 'cols', c0: sel.ac }; bindDrag(); return;
      case 'rowHdr':
        if (e.shiftKey) { sel.er = h.r; sel.ec = st.nC; sel.ac = 1; App.emit('selection'); schedule(); }
        else selectRows(h.r, h.r);
        st.drag = { kind: 'rows', r0: sel.ar }; bindDrag(); return;
      case 'fill': st.drag = { kind: 'fill', R: App.selRect() }; bindDrag(); return;
      case 'cell': {
        // linha de título de grupo (visualização agrupada): abre/fecha o grupo
        const grp = GROUP(h.r);
        if (grp) { App.toggleViewGroup(grp.key); return; }
        const info = App.cellInfo(h.r, h.c);
        // clique na caixa de seleção
        if (info.dv && info.dv.type === 'checkbox' && !e.shiftKey) {
          select(h.r, h.c, false, true);
          App.toggleCheckboxes([[h.r, h.c]]);
          return;
        }
        // clique na seta do filtro
        const f = App.activeFilter(sh);
        if (f && h.r === f.r1 && RC(h.c) >= f.c1 && RC(h.c) <= f.c2 && (App.views.has(sh.id) || !(App.adminOnly && App.adminOnly()))) {
          const right = colX(h.c) + colW(h.c);
          if (p.x > right - 22 * st.z) { select(h.r, h.c, false, true); App.emit('filterMenu', { c: RC(h.c), x: right, y: rowY(h.r) + rowH(h.r) }); return; }
        }
        select(h.r, h.c, e.shiftKey, true);
        // lista suspensa
        if (info.dv && (info.dv.type === 'list' || info.dv.type === 'range') && !e.shiftKey) {
          const rc = cellRect(h.r, h.c);
          App.emit('dropdown', { r: h.r, c: h.c, x: rc.x, y: rc.y + rc.h, w: rc.w });
          return;
        }
        if (info.link && (e.ctrlKey || e.metaKey)) { window.open(info.link, '_blank', 'noopener'); return; }
        st.drag = { kind: 'cells' };
        bindDrag();
      }
    }
  }
  function selectCols(c1, c2) {
    const sh = App.sheet();
    sel.ar = 1; sel.ac = c1; sel.er = st.nR; sel.ec = c2;
    App.emit('selection'); schedule();
  }
  function selectRows(r1, r2) {
    const sh = App.sheet();
    sel.ar = r1; sel.ac = 1; sel.er = r2; sel.ec = st.nC;
    App.emit('selection'); schedule();
  }
  function bindDrag() {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  }
  function onMove(e) {
    const d = st.drag;
    if (!d) return;
    lastMouse = e;
    const p = pos(e);
    const sh = App.sheet();
    const px = Math.max(st.hdrW + 1, Math.min(st.vw - 1, p.x)), py = Math.max(st.hdrH + 1, Math.min(st.vh - 1, p.y));
    const r = Math.min(st.nR, rowAtScreen(py)), c = Math.min(st.nC, colAtScreen(px));
    switch (d.kind) {
      case 'cells': if (r !== sel.er || c !== sel.ec) { sel.er = r; sel.ec = c; App.emit('selection'); schedule(); } break;
      case 'cols': if (c !== sel.ec) { sel.ec = c; App.emit('selection'); schedule(); } break;
      case 'rows': if (r !== sel.er) { sel.er = r; App.emit('selection'); schedule(); } break;
      case 'point': App.pointRef(d.start, { area: d.start.area, r, c }, true); break;
      case 'colResize': {
        const w = Math.max(5, d.w0 + (p.x - d.x0) / st.z);
        sh.colW[d.c] = w; d.changed = true; layout(); break;
      }
      case 'rowResize': {
        const hgt = Math.max(5, d.h0 + (p.y - d.y0) / st.z);
        sh.rowH[d.r] = hgt; d.changed = true; layout(); break;
      }
      case 'colMove': {
        if (Math.abs(p.x - d.x0) > 6) d.active = true;
        d.px = p.x;
        scroller.style.cursor = d.frozen ? 'not-allowed' : 'grabbing';
        if (d.frozen) { schedule(); break; }
        const cc = colAtScreen(px);
        d.to = p.x > colX(cc) + colW(cc) / 2 ? cc + 1 : cc;
        if (d.to <= st.Fc) d.to = st.Fc + 1;
        schedule(); break;
      }
      case 'freezeRows': d.to = p.y < st.hdrH + 4 ? 0 : rowAtScreen(p.y); schedule(); break;
      case 'freezeCols': d.to = p.x < st.hdrW + 4 ? 0 : colAtScreen(p.x); schedule(); break;
      case 'fill': {
        const R = d.R;
        const dv = r > R.r2 ? r - R.r2 : r < R.r1 ? R.r1 - r : 0;
        const dh = c > R.c2 ? c - R.c2 : c < R.c1 ? R.c1 - c : 0;
        let P = null;
        if (dv >= dh && dv > 0) P = r > R.r2 ? { r1: R.r1, c1: R.c1, r2: r, c2: R.c2, dir: 'down' } : { r1: r, c1: R.c1, r2: R.r2, c2: R.c2, dir: 'up' };
        else if (dh > 0) P = c > R.c2 ? { r1: R.r1, c1: R.c1, r2: R.r2, c2: c, dir: 'right' } : { r1: R.r1, c1: c, r2: R.r2, c2: R.c2, dir: 'left' };
        st.fillPreview = P; schedule(); break;
      }
    }
    // rolagem automática ao arrastar para fora
    if (d.kind === 'colMove' && d.active && !d.frozen) {
      const out = p.x > st.vw - 30 || (st.sx > 0 && p.x < st.hdrW + st.FW + 30);
      if (out && !autoTimer) autoTimer = setInterval(autoScroll, 40);
      if (!out && autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }
    if (['cells', 'cols', 'rows', 'point', 'fill'].includes(d.kind)) {
      // só rola quando o mouse sai da área da grade (antes, passar pelas linhas/colunas congeladas fazia a planilha andar sozinha)
      const out = p.x > st.vw - 8 || p.y > st.vh - 8 || (p.x < st.hdrW + 6 && d.kind !== 'rows') || (p.y < st.hdrH + 6 && d.kind !== 'cols');
      if (out && !autoTimer) autoTimer = setInterval(autoScroll, 40);
      if (!out && autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }
  }
  function autoScroll() {
    if (!st.drag || !lastMouse) { clearInterval(autoTimer); autoTimer = null; return; }
    const p = pos(lastMouse);
    if (st.drag.kind === 'colMove') {
      if (p.x > st.vw - 30) scroller.scrollLeft += 30;
      else if (p.x < st.hdrW + st.FW + 30 && st.sx > 0) scroller.scrollLeft -= 30;
      onMove(lastMouse);
      return;
    }
    if (p.x > st.vw - 8) scroller.scrollLeft += 30;
    if (p.y > st.vh - 8) scroller.scrollTop += 30;
    if (p.x < st.hdrW + 6 && st.sx > 0) scroller.scrollLeft -= 30;
    if (p.y < st.hdrH + 6 && st.sy > 0) scroller.scrollTop -= 30;
    onMove(lastMouse);
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const d = st.drag;
    st.drag = null;
    if (!d) return;
    if (d.kind === 'colMove') {
      schedule();
      scroller.style.cursor = '';
      if (d.active && d.frozen) { App.emit('notify', 'Colunas congeladas ficam fixas. Para mudar a ordem delas, descongele em Ver › Congelar.'); return; }
      if (!d.active || d.to === null) return;
      const res = App.moveViewCols(d.d1, d.d2, d.to);
      if (res) setTimeout(() => selectCols(res.from, res.to), 0);
      return;
    }
    const sh = App.sheet(), si = doc.active;
    if (d.kind === 'colResize' || d.kind === 'rowResize') {
      if (d.changed) {
        // registra no histórico o tamanho final
        const key = d.kind === 'colResize' ? 'colW' : 'rowH', idx = d.kind === 'colResize' ? d.c : d.r, val = sh[key][idx];
        sh[key][idx] = d.kind === 'colResize' ? d.w0 : d.h0;
        const R = App.selRect();
        App.change('Redimensionar', () => {
          const full = d.kind === 'colResize' ? R.r1 === 1 && R.r2 >= st.nR && idx >= R.c1 && idx <= R.c2 : R.c1 === 1 && R.c2 >= st.nC && idx >= R.r1 && idx <= R.r2;
          if (full) { const [a, b] = d.kind === 'colResize' ? [R.c1, R.c2] : [R.r1, R.r2]; for (let i = a; i <= b; i++) sh[key][i] = val; }
          else sh[key][idx] = val;
        });
      }
    } else if (d.kind === 'fill' && st.fillPreview) {
      const P = st.fillPreview;
      st.fillPreview = null;
      App.change('Preencher', () => App.fill(si, d.R, P, P.dir));
      selectRange({ r1: P.r1, c1: P.c1, r2: P.r2, c2: P.c2 });
    } else if (d.kind === 'freezeRows' && d.to !== undefined) {
      App.change('Congelar', () => { sh.freeze.rows = d.to; });
    } else if (d.kind === 'freezeCols' && d.to !== undefined) {
      App.change('Congelar', () => { sh.freeze.cols = d.to; });
    } else if (d.kind === 'point') {
      App.pointRef(null, null, false, true);
    }
    st.fillPreview = null;
    schedule();
  }
  function onDblClick(e) {
    const p = pos(e);
    const h = hit(p.x, p.y);
    const sh = App.sheet();
    if (h.area === 'colEdge') { autofitCols(h.c); return; }
    if (h.area === 'colHdr') { App.run('renameCol', h.c); return; }
    if (h.area === 'rowEdge') { App.change('Ajustar altura', () => { delete sh.rowH[h.r]; }); return; }
    if (h.area === 'cell') {
      const info = App.cellInfo(h.r, h.c);
      if (info.dv && info.dv.type === 'checkbox') return;
      App.startEdit({ mode: 'edit', caretAtClick: true });
    }
  }
  // Ajusta a largura das colunas ao conteúdo (duplo clique na borda do cabeçalho)
  function autofitCols(c) {
    const sh = App.sheet(), si = doc.active;
    const R = App.selRect();
    const cols = (R.r1 === 1 && R.r2 >= st.nR && c >= R.c1 && c <= R.c2 ? range(R.c1, R.c2) : [c]).map(RC);
    const used = App.usedRange(sh);
    App.change('Ajustar ao conteúdo', () => App.withReal(() => {
      for (const col of cols) {
        let maxW = 0;
        for (let r = 1; r <= Math.max(1, used.maxR); r++) {
          if (App.isRowHidden(sh, r)) continue;
          const info = cellInfo(sh, si, r, col);
          if (!info.text) continue;
          ctx.font = fontFor(info.s).replace(/[\d.]+px/, (m) => parseFloat(m) / st.z + 'px');
          const w = Math.max(...String(info.text).split('\n').map((t) => ctx.measureText(t).width)) + (info.dv ? 34 : 10);
          if (w > maxW) maxW = w;
        }
        if (maxW) sh.colW[col] = Math.min(1000, Math.max(30, Math.ceil(maxW)));
        else delete sh.colW[col];
      }
    }));
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  // Altura necessária para uma linha com texto em várias linhas ou ajustado (px sem zoom)
  function autoRowHeight(sh, si, r) {
    let maxH = App.DEF_H;
    const used = App.usedRange(sh);
    const z = st.z;
    for (let c = 1; c <= Math.max(used.maxC, 1); c++) {
      if (App.isColHidden(sh, c) || (sh.merges.length && App.mergeAt(sh, r, c))) continue;
      const info = cellInfo(sh, si, r, c);
      if (!info.text || info.dv) continue;
      const s = info.s;
      const multi = String(info.text).includes('\n');
      if (!multi && s.wrap !== 'wrap') continue;
      ctx.font = fontFor(s);
      const lines = s.wrap === 'wrap' ? wrapLines(info.text, ((sh.colW[c] || App.DEF_W) * z) - 6 * z) : String(info.text).split('\n');
      const lineH = (s.fs || 10) * 1.333 * 1.22;
      maxH = Math.max(maxH, Math.ceil(lines.length * lineH + 7));
    }
    return Math.min(maxH, 600);
  }
  App.autoFitRows = (sh, rows) => {
    if (App.adminOnly && App.adminOnly()) return; // tamanho das linhas: só administradores
    const si = App.sheetIndex(sh);
    App.invalidate();
    // rows: linhas reais
    App.withReal(() => {
      for (const r of rows) {
        const h = autoRowHeight(sh, si, r);
        if (h > (sh.rowH[r] || App.DEF_H)) sh.rowH[r] = h;
      }
    });
  };

  // Dicas ao passar o mouse (notas, comentários, erros)
  let hoverTimer = null, hoverKey = null;
  function onHover(e) {
    if (st.drag) return;
    const p = pos(e);
    const h = hit(p.x, p.y);
    scroller.style.cursor = h.area === 'cell' && GROUP(h.r) ? 'pointer' : h.area === 'colEdge' ? 'col-resize' : h.area === 'rowEdge' ? 'row-resize' : h.area === 'fill' ? 'crosshair'
      : h.area === 'colHdr' && App.views.has(App.sheet().id) ? 'grab'
      : h.area === 'colHdr' || h.area === 'filterHdr' || h.area === 'colGroup' || h.area === 'rowHdr' || h.area === 'unhideCols' || h.area === 'unhideRows' || h.area === 'corner' ? 'pointer'
        : h.area === 'freezeRowBar' ? 'row-resize' : h.area === 'freezeColBar' ? 'col-resize' : 'default';
    const key = h.area === 'cell' ? h.r + ':' + h.c : null;
    if (key === hoverKey) return;
    hoverKey = key;
    clearTimeout(hoverTimer);
    App.emit('hover', null);
    if (!key) return;
    hoverTimer = setTimeout(() => {
      const rc = cellRect(h.r, h.c);
      App.emit('hover', { r: h.r, c: h.c, x: rc.x + rc.w, y: rc.y, rect: rc });
    }, 350);
  }

  function focusGrid() { const f = $('grid-focus'); if (document.activeElement !== f) f.focus({ preventScroll: true }); }

  // ---------- Inicialização ----------
  function init() {
    wrap = $('grid-wrap'); canvas = $('grid-canvas'); scroller = $('grid-scroll'); spacer = $('grid-spacer');
    addRowsBar = $('add-rows');
    ctx = canvas.getContext('2d');
    scroller.addEventListener('scroll', () => {
      st.sx = scroller.scrollLeft; st.sy = scroller.scrollTop;
      schedule();
    }, { passive: true });
    scroller.addEventListener('mousedown', onDown);
    scroller.addEventListener('dblclick', onDblClick);
    scroller.addEventListener('mousemove', onHover);
    scroller.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverKey = null; });
    scroller.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pos(e);
      App.emit('contextMenu', { hit: hit(p.x, p.y), x: e.clientX, y: e.clientY });
    });
    new ResizeObserver(resize).observe(wrap);
    if (document.fonts) document.fonts.addEventListener('loadingdone', schedule);
    // anima o contorno de cópia
    setInterval(() => { if (st.marquee) schedule(); }, 120);
    setInterval(() => { if (st.hasCrit) { st.hasCrit = false; schedule(); } }, 550);
    App.on('change', () => { layout(); App.emit('selection'); });
    App.on('sheet', () => {
      const sh = App.sheet();
      sel.ar = Math.min(sel.ar, st.nR); sel.er = Math.min(sel.er, st.nR);
      sel.ac = Math.min(sel.ac, st.nC); sel.ec = Math.min(sel.ec, st.nC);
      scroller.scrollLeft = 0; scroller.scrollTop = 0; st.sx = 0; st.sy = 0;
      layout(); App.emit('selection');
    });
    layout();
  }

  App.grid = {
    init, layout, draw: schedule, select, selectRange, selectCols, selectRows, moveCursor, reveal, cellRect, hit,
    focus: focusGrid, colX, rowY, colW, rowH,
    setMarquee: (m) => { st.marquee = m; schedule(); },
    setRefs: (refs) => { st.refs = refs || []; schedule(); },
    setFound: (set, cur) => { st.found = set; st.foundCur = cur; schedule(); },
    setPeers: (list) => { st.peers = list; schedule(); },
    autofitCols,
    scrollBy: (dx, dy) => { scroller.scrollLeft += dx; scroller.scrollTop += dy; },
    pageRows: () => Math.max(1, Math.floor((st.vh - st.hdrH - st.FH) / ((App.DEF_H) * st.z)) - 1),
  };
})(window.App);
