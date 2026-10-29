// Recursos da interface: menus, barra de ferramentas, formatação, área de transferência,
// alça de preenchimento, menu de contexto e atalhos. Usa window.App (app.js) e window.IO (io.js).
(function () {
  'use strict';
  const A = window.App;
  const E = window.GridEngine;
  const $ = (id) => document.getElementById(id);

  // ---------- Utilidades ----------
  const isTyping = (t) => !!t && !!t.matches && (t.matches('input, select, textarea, [contenteditable]') || !!document.querySelector('dialog[open]'));
  const deepCopy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  function notify(msg) {
    A.el.status.textContent = msg;
    clearTimeout(notify._t);
    notify._t = setTimeout(() => { A.el.status.textContent = 'Tudo salvo'; }, 2200);
  }

  // Aplica uma alteração de estilo a todas as células da seleção
  function forSelection(fn) {
    const R = A.rect();
    for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) A.setStyle(r, c, fn);
  }
  function applyStyle(fn) {
    A.pushUndo();
    forSelection(fn);
    A.refresh();
    A.markDirty();
  }
  function curStyle() { return A.style(A.S.ar, A.S.ac); }
  function toggle(key) {
    const on = !!curStyle()[key];
    applyStyle((s) => { if (on) delete s[key]; else s[key] = true; });
  }
  function setNf(nf) {
    applyStyle((s) => { if (nf === 'general') delete s.nf; else s.nf = nf; if (nf !== 'general') delete s.dec; });
  }
  function changeDecimals(delta) {
    const s = curStyle();
    const nf = s.nf || 'general';
    const base = s.dec !== undefined ? s.dec : (nf === 'currency' ? 2 : nf === 'percent' ? 0 : 2);
    const next = Math.max(0, Math.min(6, base + delta));
    applyStyle((st) => { st.dec = next; if (!st.nf) st.nf = 'number'; });
  }
  function changeSize(delta) {
    const cur = curStyle().fs || 10;
    const next = Math.max(6, Math.min(72, cur + delta));
    applyStyle((s) => { s.fs = next; });
    A.el.fontSize.value = String(next);
  }
  function clearFormat() {
    applyStyle((s) => { for (const k of Object.keys(s)) delete s[k]; });
  }

  // ---------- Fórmulas: deslocamento de referências (copiar/colar e arrastar) ----------
  // Desloca referências relativas (A1) e mantém as absolutas ($A$1). Ignora textos entre aspas.
  function shiftFormula(f, dr, dc) {
    const parts = f.split(/("(?:[^"]|"")*")/);
    return parts.map((p, i) => {
      if (i % 2 === 1) return p;
      return p.replace(/(^|[^\p{L}\p{N}_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\p{L}\p{N}_(])/gu,
        (m, pre, dA, col, dR, row) => {
          const c = E.colToNum(col.toUpperCase());
          const r = parseInt(row, 10);
          const nc = dA ? c : c + dc;
          const nr = dR ? r : r + dr;
          if (nc < 1 || nr < 1 || nc > A.COLS || nr > A.ROWS) return pre + '#REF!';
          return pre + (dA ? '$' : '') + E.numToCol(nc) + (dR ? '$' : '') + nr;
        });
    }).join('');
  }

  // ---------- Área de transferência ----------
  const clip = { data: null, text: null, cut: false, R: null };
  function rangeText(R) {
    const rows = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const cols = [];
      for (let c = R.c1; c <= R.c2; c++) cols.push(A.display(r, c).replace(/\t|\n/g, ' '));
      rows.push(cols.join('\t'));
    }
    return rows.join('\n');
  }
  function rangeCells(R) {
    const out = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const row = [];
      for (let c = R.c1; c <= R.c2; c++) row.push(deepCopy(A.cellAt(r, c)));
      out.push(row);
    }
    return out;
  }
  function setCellObj(r, c, obj) {
    const sh = A.sheet();
    const a = A.addr(r, c);
    if (!obj || (obj.v === '' && !obj.s)) { delete sh.cells[a]; sh.eng.setRaw(a, ''); return; }
    sh.cells[a] = obj;
    sh.eng.setRaw(a, obj.v || '');
  }
  function copySelection(cut) {
    const R = A.rect();
    const text = rangeText(R);
    clip.data = rangeCells(R);
    clip.text = text;
    clip.cut = cut;
    clip.R = R;
    return text;
  }
  function pasteText(text) {
    const R = A.rect();
    const r0 = R.r1, c0 = R.c1;
    A.pushUndo();
    let endR, endC;
    if (clip.data && text === clip.text) {
      const src = clip.data, sR = clip.R;
      if (clip.cut) {
        // Recortar: limpa a origem primeiro (sem deslocar fórmulas)
        for (let r = sR.r1; r <= sR.r2; r++) for (let c = sR.c1; c <= sR.c2; c++) setCellObj(r, c, null);
      }
      for (let i = 0; i < src.length; i++) {
        for (let j = 0; j < src[i].length; j++) {
          const dr = r0 + i, dc = c0 + j;
          const obj = deepCopy(src[i][j]);
          if (obj && !clip.cut && obj.v && obj.v.startsWith('=')) {
            obj.v = shiftFormula(obj.v, dr - (sR.r1 + i), dc - (sR.c1 + j));
          }
          setCellObj(dr, dc, obj);
        }
      }
      endR = r0 + src.length - 1;
      endC = c0 + (src[0] ? src[0].length : 1) - 1;
      if (clip.cut) clip.data = null;
    } else {
      const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      lines.forEach((line, i) => {
        line.split('\t').forEach((v, j) => {
          const r = r0 + i, c = c0 + j;
          if (r > A.ROWS || c > A.COLS) return;
          A.setRaw(r, c, v);
        });
      });
      endR = Math.min(A.ROWS, r0 + lines.length - 1);
      endC = Math.min(A.COLS, c0 + Math.max(...lines.map((l) => l.split('\t').length)) - 1);
    }
    A.S.ar = r0; A.S.ac = c0; A.S.er = endR; A.S.ec = endC;
    A.refresh();
    A.markDirty();
  }
  function cancelClipboardMarquee() { /* sem marcha-formiga visual; recortar já foi concluído */ }

  // Eventos nativos de copiar/recortar/colar (funcionam com o teclado e com o menu do navegador)
  document.addEventListener('copy', (e) => {
    if (isTyping(e.target) || A.S.editing) return;
    e.clipboardData.setData('text/plain', copySelection(false));
    e.preventDefault();
    notify('Copiado');
  });
  document.addEventListener('cut', (e) => {
    if (isTyping(e.target) || A.S.editing) return;
    e.clipboardData.setData('text/plain', copySelection(true));
    e.preventDefault();
    notify('Recortado');
  });
  document.addEventListener('paste', (e) => {
    if (isTyping(e.target) || A.S.editing) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });

  // ---------- Alça de preenchimento ----------
  let fillState = null;
  A.el.fill.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fillState = { R: A.rect() };
    window.addEventListener('mousemove', fillMove);
    window.addEventListener('mouseup', fillUp, { once: true });
  });
  function fillMove(e) {
    if (!fillState) return;
    const p = A.vpPos(e);
    const tr = A.rowAt(p.y), tc = A.colAt(p.x);
    const R = fillState.R;
    const dv = tr - R.r2, dh = tc - R.c2;
    const S = A.S;
    if (dv > 0 && Math.abs(dv) >= Math.abs(dh)) {
      S.ar = R.r1; S.ac = R.c1; S.er = tr; S.ec = R.c2;
    } else if (dh > 0) {
      S.ar = R.r1; S.ac = R.c1; S.er = R.r2; S.ec = tc;
    } else {
      S.ar = R.r1; S.ac = R.c1; S.er = R.r2; S.ec = R.c2;
    }
    A.refresh();
  }
  function fillUp() {
    window.removeEventListener('mousemove', fillMove);
    const st = fillState;
    fillState = null;
    if (!st) return;
    const R = st.R;
    const S = A.S;
    const vertical = S.er > R.r2;
    const horizontal = !vertical && S.ec > R.c2;
    if (!vertical && !horizontal) { A.refresh(); return; }
    A.pushUndo();
    if (vertical) {
      const h = R.r2 - R.r1 + 1;
      for (let c = R.c1; c <= R.c2; c++) {
        const numeric = h >= 2 && Array.from({ length: h }, (_, k) => A.valueOf(R.r1 + k, c)).every((v) => typeof v === 'number');
        for (let r = R.r2 + 1; r <= S.er; r++) {
          if (numeric) {
            const vals = Array.from({ length: h }, (_, k) => A.valueOf(R.r1 + k, c));
            const step = vals[h - 1] - vals[h - 2];
            const v = vals[h - 1] + step * (r - R.r2);
            setCellObj(r, c, { v: String(+v.toPrecision(15)), s: deepCopy(A.style(R.r2, c)) });
          } else {
            const srcR = R.r1 + ((r - R.r1) % h);
            const obj = deepCopy(A.cellAt(srcR, c));
            if (obj && obj.v && obj.v.startsWith('=')) obj.v = shiftFormula(obj.v, r - srcR, 0);
            setCellObj(r, c, obj);
          }
        }
      }
    } else {
      const w = R.c2 - R.c1 + 1;
      for (let r = R.r1; r <= R.r2; r++) {
        const numeric = w >= 2 && Array.from({ length: w }, (_, k) => A.valueOf(r, R.c1 + k)).every((v) => typeof v === 'number');
        for (let c = R.c2 + 1; c <= S.ec; c++) {
          if (numeric) {
            const vals = Array.from({ length: w }, (_, k) => A.valueOf(r, R.c1 + k));
            const step = vals[w - 1] - vals[w - 2];
            const v = vals[w - 1] + step * (c - R.c2);
            setCellObj(r, c, { v: String(+v.toPrecision(15)), s: deepCopy(A.style(r, R.c2)) });
          } else {
            const srcC = R.c1 + ((c - R.c1) % w);
            const obj = deepCopy(A.cellAt(r, srcC));
            if (obj && obj.v && obj.v.startsWith('=')) obj.v = shiftFormula(obj.v, 0, c - srcC);
            setCellObj(r, c, obj);
          }
        }
      }
    }
    A.refresh();
    A.markDirty();
  }

  // ---------- Operações da planilha ----------
  function autoSum() {
    const R = A.rect();
    const S = A.S;
    A.pushUndo();
    if (R.r1 === R.r2 && R.c1 === R.c2) {
      // soma os números acima da célula ativa; se não houver, os da esquerda
      const c = R.c1;
      let top = R.r1 - 1;
      while (top >= 1 && typeof A.valueOf(top, c) === 'number') top--;
      if (top < R.r1 - 1) {
        A.setRaw(R.r1, c, `=SOMA(${A.addr(top + 1, c)}:${A.addr(R.r1 - 1, c)})`);
      } else {
        let left = R.c1 - 1;
        const r = R.r1;
        while (left >= 1 && typeof A.valueOf(r, left) === 'number') left--;
        if (left < R.c1 - 1) A.setRaw(r, R.c1, `=SOMA(${A.addr(r, left + 1)}:${A.addr(r, R.c1 - 1)})`);
        else { notify('Não há números para somar'); A.refresh(); return; }
      }
    } else {
      for (let c = R.c1; c <= R.c2; c++) {
        A.setRaw(R.r2 + 1, c, `=SOMA(${A.addr(R.r1, c)}:${A.addr(R.r2, c)})`);
      }
      S.ar = R.r2 + 1; S.ac = R.c1; S.er = R.r2 + 1; S.ec = R.c2;
    }
    A.refresh();
    A.markDirty();
  }
  function insertFunction() {
    A.startEdit(A.S.ar, A.S.ac, '=');
  }
  function toggleGrid() {
    const sh = A.sheet();
    sh.gridlines = sh.gridlines === false;
    A.renderCells();
    A.markDirty();
  }
  function setZoom(v) {
    A.doc.zoom = v;
    A.el.zoom.value = String(v);
    A.layout();
    A.refresh();
    A.markDirty();
  }
  function selectAll() {
    A.S.ar = 1; A.S.ac = 1; A.S.er = A.ROWS; A.S.ec = A.COLS;
    A.refresh();
  }

  // ---------- Menus ----------
  const MENUS = [
    { label: 'Arquivo', items: [
      { label: 'Nova planilha', action: () => IO().newDocument() },
      { label: 'Abrir (.json ou .csv)…', action: () => $('file-open').click() },
      '-',
      { label: 'Salvar', sc: 'Ctrl+S', action: () => { A.persist(); notify('Salvo no navegador'); } },
      { label: 'Baixar como CSV', action: () => IO().exportCSV() },
      { label: 'Baixar backup (.json)', action: () => IO().exportJSON() },
      '-',
      { label: 'Imprimir', sc: 'Ctrl+P', action: () => IO().print() },
    ] },
    { label: 'Editar', items: [
      { label: 'Desfazer', sc: 'Ctrl+Z', action: () => A.undo() },
      { label: 'Refazer', sc: 'Ctrl+Y', action: () => A.redo() },
      '-',
      { label: 'Recortar', sc: 'Ctrl+X', action: () => document.execCommand('cut') },
      { label: 'Copiar', sc: 'Ctrl+C', action: () => document.execCommand('copy') },
      { label: 'Colar', sc: 'Ctrl+V', action: () => notify('Use Ctrl+V para colar') },
      '-',
      { label: 'Limpar conteúdo', sc: 'Del', action: () => A.clearRange(true) },
      { label: 'Limpar formatação', action: clearFormat },
      '-',
      { label: 'Selecionar tudo', sc: 'Ctrl+A', action: selectAll },
      { label: 'Localizar', sc: 'Ctrl+F', action: () => IO().openFind() },
    ] },
    { label: 'Ver', items: [
      { label: 'Mostrar/ocultar linhas de grade', action: toggleGrid },
      '-',
      { label: 'Zoom 75%', action: () => setZoom(75) },
      { label: 'Zoom 100%', action: () => setZoom(100) },
      { label: 'Zoom 125%', action: () => setZoom(125) },
      { label: 'Zoom 150%', action: () => setZoom(150) },
    ] },
    { label: 'Inserir', items: [
      { label: 'Gráfico…', action: () => IO().openChart() },
      { label: 'Soma automática', sc: 'Σ', action: autoSum },
      { label: 'Função…', action: insertFunction },
      '-',
      { label: 'Nova planilha', action: () => IO().addSheet() },
    ] },
    { label: 'Formatar', items: [
      { label: 'Negrito', sc: 'Ctrl+B', action: () => toggle('b') },
      { label: 'Itálico', sc: 'Ctrl+I', action: () => toggle('i') },
      { label: 'Sublinhado', sc: 'Ctrl+U', action: () => toggle('u') },
      { label: 'Tachado', action: () => toggle('st') },
      '-',
      { label: 'Número', action: () => setNf('number') },
      { label: 'Porcentagem', action: () => setNf('percent') },
      { label: 'Moeda (R$)', action: () => setNf('currency') },
      { label: 'Data', action: () => setNf('date') },
      { label: 'Texto simples', action: () => setNf('text') },
      { label: 'Formato geral', action: () => setNf('general') },
      '-',
      { label: 'Alinhar à esquerda', action: () => applyStyle((s) => { s.al = 'l'; }) },
      { label: 'Centralizar', action: () => applyStyle((s) => { s.al = 'c'; }) },
      { label: 'Alinhar à direita', action: () => applyStyle((s) => { s.al = 'r'; }) },
      { label: 'Quebrar texto', action: () => toggle('wrap') },
      { label: 'Bordas', action: () => toggle('bd') },
      '-',
      { label: 'Limpar formatação', action: clearFormat },
    ] },
    { label: 'Dados', items: [
      { label: 'Ordenar intervalo A→Z', action: () => IO().sortRange(false) },
      { label: 'Ordenar intervalo Z→A', action: () => IO().sortRange(true) },
      '-',
      { label: 'Duplicar planilha', action: () => IO().duplicateSheet() },
      { label: 'Renomear planilha', action: () => IO().renameSheet() },
      { label: 'Excluir planilha', action: () => IO().deleteSheet() },
    ] },
    { label: 'Ferramentas', items: [
      { label: 'Localizar', sc: 'Ctrl+F', action: () => IO().openFind() },
      { label: 'Gráfico…', action: () => IO().openChart() },
    ] },
    { label: 'Ajuda', items: [
      { label: 'Atalhos de teclado', action: () => $('help-dialog').showModal() },
      { label: 'Sobre o Planilhas', action: () => notify('Planilhas · editor de planilhas no navegador') },
    ] },
  ];
  function IO() { return window.IO; }

  const menuDD = $('menu-dropdown');
  let openMenuBtn = null;
  function closeMenus() {
    menuDD.hidden = true;
    if (openMenuBtn) openMenuBtn.classList.remove('open');
    openMenuBtn = null;
  }
  function openMenu(btn, menu) {
    closeMenus();
    openMenuBtn = btn;
    btn.classList.add('open');
    const rc = btn.getBoundingClientRect();
    menuDD.innerHTML = menu.items.map((it, i) => it === '-'
      ? '<div class="mi-sep"></div>'
      : `<div class="mi" data-i="${i}"><span>${A.esc(it.label)}</span>${it.sc ? `<kbd>${A.esc(it.sc)}</kbd>` : ''}</div>`
    ).join('');
    menuDD.style.position = 'fixed';
    menuDD.style.left = rc.left + 'px';
    menuDD.style.top = rc.bottom + 4 + 'px';
    menuDD.hidden = false;
    menuDD.onclick = (e) => {
      const item = e.target.closest('.mi');
      if (!item) return;
      const it = menu.items[+item.dataset.i];
      closeMenus();
      if (it && it.action) it.action();
    };
  }
  function buildMenubar() {
    const bar = $('menubar');
    bar.innerHTML = MENUS.map((m, i) => `<button data-m="${i}">${m.label}</button>`).join('');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (openMenuBtn === b) { closeMenus(); return; }
      openMenu(b, MENUS[+b.dataset.m]);
    });
    bar.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button');
      if (b && openMenuBtn && openMenuBtn !== b) openMenu(b, MENUS[+b.dataset.m]);
    });
  }

  // ---------- Menu de contexto ----------
  const ctx = $('context-menu');
  const CTX_ITEMS = [
    { label: 'Recortar', sc: 'Ctrl+X', action: () => document.execCommand('cut') },
    { label: 'Copiar', sc: 'Ctrl+C', action: () => document.execCommand('copy') },
    { label: 'Colar', sc: 'Ctrl+V', action: () => notify('Use Ctrl+V para colar') },
    '-',
    { label: 'Limpar conteúdo', sc: 'Del', action: () => A.clearRange(true) },
    { label: 'Negrito', sc: 'Ctrl+B', action: () => toggle('b') },
    '-',
    { label: 'Ordenar A→Z', action: () => IO().sortRange(false) },
    { label: 'Ordenar Z→A', action: () => IO().sortRange(true) },
    { label: 'Gráfico…', action: () => IO().openChart() },
  ];
  function openContext(e) {
    const p = A.vpPos(e);
    const r = A.rowAt(p.y), c = A.colAt(p.x);
    const R = A.rect();
    const inside = r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2;
    if (!inside) A.select(r, c, false);
    ctx.innerHTML = CTX_ITEMS.map((it, i) => it === '-'
      ? '<div class="mi-sep"></div>'
      : `<div class="mi" data-i="${i}"><span>${A.esc(it.label)}</span>${it.sc ? `<kbd>${A.esc(it.sc)}</kbd>` : ''}</div>`
    ).join('');
    ctx.style.position = 'fixed';
    ctx.style.left = Math.min(e.clientX, window.innerWidth - 250) + 'px';
    ctx.style.top = Math.min(e.clientY, window.innerHeight - 320) + 'px';
    ctx.hidden = false;
    ctx.onclick = (ev) => {
      const item = ev.target.closest('.mi');
      if (!item) return;
      const it = CTX_ITEMS[+item.dataset.i];
      ctx.hidden = true;
      if (it && it.action) it.action();
    };
  }

  // ---------- Barra de ferramentas ----------
  const CMD = {
    undo: () => A.undo(),
    redo: () => A.redo(),
    print: () => IO().print(),
    bold: () => toggle('b'),
    italic: () => toggle('i'),
    underline: () => toggle('u'),
    strike: () => toggle('st'),
    'align-left': () => applyStyle((s) => { s.al = 'l'; }),
    'align-center': () => applyStyle((s) => { s.al = 'c'; }),
    'align-right': () => applyStyle((s) => { s.al = 'r'; }),
    wrap: () => toggle('wrap'),
    borders: () => toggle('bd'),
    'fmt-currency': () => setNf('currency'),
    'fmt-percent': () => setNf('percent'),
    'dec-dec': () => changeDecimals(-1),
    'dec-inc': () => changeDecimals(1),
    'size-dec': () => changeSize(-1),
    'size-inc': () => changeSize(1),
    sum: autoSum,
    'sort-asc': () => IO().sortRange(false),
    chart: () => IO().openChart(),
    find: () => IO().openFind(),
  };

  function bindToolbar() {
    document.querySelectorAll('[data-cmd]').forEach((b) => {
      // mantém o foco na grade ao clicar nos botões
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const fn = CMD[b.dataset.cmd];
        if (fn) fn();
        A.el.viewport.focus({ preventScroll: true });
      });
    });
    $('zoom').addEventListener('change', (e) => setZoom(+e.target.value));
    $('fmt-number').addEventListener('change', (e) => { setNf(e.target.value); A.el.viewport.focus({ preventScroll: true }); });
    $('font-family').addEventListener('change', (e) => { applyStyle((s) => { s.ff = e.target.value; }); A.el.viewport.focus({ preventScroll: true }); });
    const size = $('font-size');
    size.addEventListener('change', () => {
      const n = Math.max(6, Math.min(72, parseInt(size.value, 10) || 10));
      size.value = String(n);
      applyStyle((s) => { s.fs = n; });
    });
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { size.blur(); A.el.viewport.focus({ preventScroll: true }); } });
    // cores: aplica em tempo real e grava uma única entrada no histórico
    let colorTxn = false;
    const colorInput = (id, key, swatchId) => {
      const inp = $(id);
      inp.addEventListener('input', () => {
        if (!colorTxn) { A.pushUndo(); colorTxn = true; }
        forSelection((s) => { s[key] = inp.value; });
        $(swatchId).style.background = inp.value;
        A.refresh(); A.markDirty();
      });
      inp.addEventListener('change', () => { colorTxn = false; A.el.viewport.focus({ preventScroll: true }); });
    };
    colorInput('text-color', 'color', 'text-swatch');
    colorInput('fill-color', 'bg', 'fill-swatch');
    $('tab-add').addEventListener('click', () => IO().addSheet());
    $('btn-help').addEventListener('click', () => $('help-dialog').showModal());
  }

  // Sincroniza o estado visual da barra de ferramentas com a célula ativa
  function onRefresh() {
    const st = A.style(A.S.ar, A.S.ac);
    document.querySelectorAll('[data-cmd]').forEach((b) => {
      const key = { bold: 'b', italic: 'i', underline: 'u', strike: 'st', wrap: 'wrap', borders: 'bd' }[b.dataset.cmd];
      const alignMap = { 'align-left': 'l', 'align-center': 'c', 'align-right': 'r' }[b.dataset.cmd];
      let on = false;
      if (key) on = !!st[key];
      else if (alignMap) on = (st.al || 'auto') === alignMap;
      b.classList.toggle('active', on);
    });
    const nf = st.nf || 'general';
    $('fmt-number').value = ['number', 'percent', 'currency', 'date', 'text'].includes(nf) ? nf : 'general';
    $('font-family').value = st.ff || 'Arial';
    $('font-size').value = String(st.fs || 10);
    $('text-swatch').style.background = st.color || '#000';
    $('fill-swatch').style.background = st.bg || '#ffffff';
    $('text-color').value = st.color || '#000000';
    $('fill-color').value = st.bg || '#ffffff';
  }

  // ---------- Atalhos ----------
  // Retorna true quando o atalho foi tratado (app.js chama preventDefault)
  function shortcut(e) {
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 'z') { A.redo(); return true; }
    switch (k) {
      case 'z': A.undo(); return true;
      case 'y': A.redo(); return true;
      case 'b': toggle('b'); return true;
      case 'i': toggle('i'); return true;
      case 'u': toggle('u'); return true;
      case 's': A.persist(); notify('Salvo no navegador'); return true;
      case 'p': IO().print(); return true;
      case 'f': IO().openFind(); return true;
      case 'a': selectAll(); return true;
      default: return false; // c, x, v: eventos nativos de copiar/recortar/colar
    }
  }

  function init() {
    buildMenubar();
    bindToolbar();
    document.body.appendChild(menuDD);
    document.body.appendChild(ctx);
    A.el.fontSize = $('font-size');

    // Fecha menus ao clicar fora ou pressionar Esc
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.menubar') && !e.target.closest('.menu-dropdown')) closeMenus();
      if (!e.target.closest('.context-menu')) ctx.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeMenus(); ctx.hidden = true; }
      // atalhos globais que o navegador usaria por padrão (salvar, imprimir, localizar)
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'f'].includes(e.key.toLowerCase())) {
        const inFormula = e.target === A.el.formula || e.target === A.el.editor;
        if (e.key.toLowerCase() === 'f' && !inFormula) { e.preventDefault(); IO().openFind(); return; }
        if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'p') { e.preventDefault(); shortcut(e); }
      }
    }, true);

    A.el.viewport.addEventListener('contextmenu', (e) => { e.preventDefault(); openContext(e); });
    A.el.formula.addEventListener('blur', () => { /* mantém a edição até Enter/Esc/clique */ });

    // Abrir arquivo: .json (backup) ou .csv
    $('file-open').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) IO().openFile(f);
      e.target.value = '';
    });

    // Painel de localização e recuperação de histórico
    IO().wireFind();
    A.el.viewport.addEventListener('mousedown', closeMenus);
    window.addEventListener('beforeunload', () => { A.persist(); });
  }

  window.Features = {
    init, shortcut, onRefresh, cancelClipboardMarquee, shiftFormula, pasteText, applyStyle, forSelection,
    setNf, setZoom, selectAll, autoSum, clearFormat, toggle, notify, rangeText,
  };

  // Chamado no fim de app.js; features.js carrega depois, então inicializa aqui.
  // io.js carrega antes deste arquivo (ver index.html).
  init();
})();
