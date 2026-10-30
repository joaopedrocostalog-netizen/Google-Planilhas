// Visualizações de filtro: cada pessoa filtra, agrupa (inclusive grupos dentro de grupos), classifica por status
// e muda a ordem das colunas só para si, na própria grade, sem mudar o que as outras pessoas veem.
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = App.esc, E = App.E;
  const def = (id, label, fn, sc) => App.commands.def(id, label, fn, sc);
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const SAVE_KEY = 'planilhas:fviews';

  const headerText = (sh, c) => {
    const nm = sh.colNames && sh.colNames[c];
    if (nm) return String(nm);
    try { return App.withReal(() => { const v = App.value(App.sheetIndex(sh), 1, c); return v === null || v === undefined ? '' : String(App.fmtValue(v, App.style(sh, 1, c).nf)); }); } catch (e) { return ''; }
  };
  const colLabel = (sh, c) => { const t = headerText(sh, c); return E.numToCol(c) + (t ? ' · ' + t.slice(0, 30) : ''); };
  App.colLabelOf = colLabel;
  const isFinal = (s) => /finaliz|conclu|entregue|encerrad/i.test(s);
  const alpha = (a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR', { numeric: true }));

  // ---------- Guardar a visualização da pessoa (volta quando ela abrir a página de novo) ----------
  const saveKey = (sh) => (App.docId || 'local') + '|' + sh.id;
  const readSaved = () => {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { /* vazio */ }
    return Object.assign(local, (App.userPrefs && App.userPrefs().fviews) || {});
  };
  function persist(sh, v) {
    const all = readSaved();
    if (v) { const copy = Object.assign({}, v); delete copy._statusOrder; all[saveKey(sh)] = copy; } else delete all[saveKey(sh)];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch (e) { /* ignora */ }
    if (App.savePrefs) App.savePrefs({ fviews: all });
  }
  function restore() {
    const sh = App.sheet();
    if (!sh || App.views.has(sh.id)) return;
    const v = readSaved()[saveKey(sh)];
    if (v) { App.views.set(sh.id, v); App.invalidate(); }
  }

  // Intervalo inicial: a seleção (se houver mais de uma célula) ou todas as colunas com dados
  function defaultRange(sh) {
    const R = App.selRect(), used = App.usedRange(sh);
    const named = !!(sh.colNames && Object.keys(sh.colNames).length);
    const head = sh.filter ? sh.filter.r1 : named ? 0 : 1;
    if (!App.vm && !(R.r1 === R.r2 && R.c1 === R.c2) && !(R.r1 === 1 && R.r2 >= sh.rows)) return { r1: R.r1, c1: R.c1, c2: R.c2, r2: R.r2 };
    return { r1: head, c1: 1, c2: Math.max(1, used.maxC) };
  }

  App.setView = (sh, v) => {
    if (v) App.views.set(sh.id, v); else App.views.delete(sh.id);
    persist(sh, v);
    App.invalidate();
    App.emit('change', { view: true });
    render();
  };
  const cur = () => { const sh = App.sheet(); return sh && App.views.get(sh.id); };

  function create(kind, col) {
    const sh = App.sheet();
    const old = App.views.get(sh.id);
    const base = defaultRange(sh);
    const v = old || Object.assign({ crit: {}, dyn: base.r2 === undefined, r2: base.r2 || sh.rows, groups: [], order: [], collapsed: [] }, base);
    if (kind === 'group' && col) {
      v.groups = (v.groups || []).filter((c) => c !== col).concat([col]);
      v.c1 = Math.min(v.c1, col); v.c2 = Math.max(v.c2, col);
    }
    App.setView(sh, v);
    notify(kind === 'group' ? `Agrupado por ${colLabel(sh, col)}. Só você vê.` : 'Visualização com filtro aberta. Só você vê o resultado.');
  }

  // ---------- Mapa da tela: ordem das colunas, classificação por status e grupos ----------
  function statusOrder(sh, v, rows, txt) {
    const vals = [];
    const seen = new Set();
    for (const r of rows) { const t = txt(r, v.sort.col); if (!seen.has(t)) { seen.add(t); vals.push(t); } }
    const order = (v.sort.order || []).filter((x) => seen.has(x));
    const rest = vals.filter((x) => !order.includes(x)).sort((a, b) => (isFinal(b) - isFinal(a)) || alpha(a, b));
    return order.concat(rest);
  }
  App.buildVmap = () => {
    const sh = App.sheet();
    const v = sh && App.views.get(sh.id);
    const needs = v && ((v.order && v.order.length) || (v.groups && v.groups.length) || (v.sort && v.sort.col));
    // mantém a célula selecionada no lugar certo quando as linhas mudam de posição
    const sel = App.sel;
    const before = App.vm && sel ? App.realCell(sel.ar, sel.ac) : null;
    if (!needs) { App.vm = null; if (before && sel) { sel.ar = sel.er = before.r; sel.ac = sel.ec = before.c; } return; }
    App.withReal(() => {
      const si = App.sheetIndex(sh), used = App.usedRange(sh);
      const top = Math.min(sh.rows, Math.max((sh.freeze && sh.freeze.rows) || 0, v.r1 || 0));
      const rows = [null];
      for (let r = 1; r <= top; r++) rows.push({ r });
      const fh = App.filterHidden(sh), old = App.oldRows(sh);
      let data = [];
      for (let r = top + 1; r <= used.maxR; r++) if (!fh.has(r) && !old.has(r)) data.push(r);
      const cache = new Map();
      const txt = (r, c) => {
        const k = r + ':' + c;
        if (cache.has(k)) return cache.get(k);
        const x = App.value(si, r, c);
        const t = x === null || x === undefined ? '' : E.isErr(x) ? x.code : String(App.fmtValue(x, App.style(sh, r, c).nf)).trim();
        cache.set(k, t);
        return t;
      };
      let rank = null;
      if (v.sort && v.sort.col) {
        const order = statusOrder(sh, v, data, txt);
        v._statusOrder = order;
        rank = new Map(order.map((x, i) => [x, i]));
        data.sort((a, b) => (rank.get(txt(a, v.sort.col)) - rank.get(txt(b, v.sort.col))) || a - b);
      }
      const groups = (v.groups || []).filter((c) => c >= 1 && c <= sh.cols);
      const collapsed = new Set(v.collapsed || []);
      const emit = (list, level, prefix) => {
        if (level >= groups.length) { for (const r of list) rows.push({ r }); return; }
        const c = groups[level];
        const m = new Map();
        for (const r of list) { const t = txt(r, c); if (!m.has(t)) m.set(t, []); m.get(t).push(r); }
        const names = [...m.keys()];
        if (rank && v.sort.col === c) names.sort((a, b) => rank.get(a) - rank.get(b)); else names.sort(alpha);
        for (const n of names) {
          const key = prefix + c + '=' + n;
          const closed = collapsed.has(key);
          rows.push({ group: { level, col: c, value: n, count: m.get(n).length, key, closed } });
          if (!closed) emit(m.get(n), level + 1, key + '|');
        }
      };
      emit(data, 0, '');
      for (let r = Math.max(top, used.maxR) + 1; r <= sh.rows; r++) rows.push({ r });
      const fc = Math.min((sh.freeze && sh.freeze.cols) || 0, sh.cols);
      const cols = [0];
      for (let c = 1; c <= fc; c++) cols.push(c);
      const seen = new Set(cols);
      for (const c of v.order || []) if (c > fc && c <= sh.cols && !seen.has(c)) { cols.push(c); seen.add(c); }
      for (let c = fc + 1; c <= sh.cols; c++) if (!seen.has(c)) cols.push(c);
      const rowPos = new Map(), colPos = new Map();
      rows.forEach((e, i) => { if (e && e.r) rowPos.set(e.r, i); });
      cols.forEach((c, i) => { if (i) colPos.set(c, i); });
      App.vm = { sheetId: sh.id, rows, cols, rowPos, colPos, nRows: rows.length - 1, nCols: cols.length - 1 };
    });
    if (sel) {
      const p = before ? App.dispCell(before.r, before.c) : null;
      if (p) { sel.ar = sel.er = p.r; sel.ac = sel.ec = p.c; }
      sel.ar = Math.min(sel.ar, App.vm.nRows); sel.er = Math.min(sel.er, App.vm.nRows);
    }
  };

  // ---------- Ações da visualização ----------
  App.toggleViewGroup = (key) => {
    const sh = App.sheet(), v = cur();
    if (!v) return;
    const set = new Set(v.collapsed || []);
    if (set.has(key)) set.delete(key); else set.add(key);
    v.collapsed = [...set];
    App.setView(sh, v);
  };
  // move as colunas de tela [d1..d2] para antes da coluna de tela "to"
  App.moveViewCols = (d1, d2, to) => {
    const sh = App.sheet(), v = cur(), vm = App.vm;
    if (!v) return null;
    const fc = Math.min((sh.freeze && sh.freeze.cols) || 0, sh.cols);
    const list = vm ? vm.cols.slice(1) : Array.from({ length: sh.cols }, (_, i) => i + 1);
    const moving = list.slice(d1 - 1, d2);
    if (moving.some((c) => c <= fc) || (to > d1 && to <= d2 + 1)) return null;
    const rest = list.filter((c) => !moving.includes(c));
    let at = to - 1 - (to > d2 ? moving.length : 0);
    at = Math.max(fc, Math.min(rest.length, at));
    rest.splice(at, 0, ...moving);
    v.order = rest.filter((c) => c > fc);
    App.setView(sh, v);
    return { from: at + 1, to: at + moving.length };
  };

  // ---------- Barra da visualização ----------
  function render() {
    const bar = $('view-bar');
    const sh = App.sheet();
    const v = sh && App.views.get(sh.id);
    if (!v) { bar.hidden = true; return; }
    const used = App.usedRange(sh);
    const allCols = [];
    for (let c = 1; c <= Math.max(1, used.maxC); c++) if (!(App.colBlocked && App.colBlocked(sh, c))) allCols.push(c);
    const nFilters = Object.keys(v.crit || {}).length;
    const groups = v.groups || [];
    const opt = (list, none) => `<option value="">${none}</option>` + list.map((c) => `<option value="${c}">${esc(colLabel(sh, c))}</option>`).join('');
    bar.innerHTML = `<span class="vb-title">${icon('filterViews', 18)} Visualização com filtro</span>
      <span class="vb-groups">${groups.length ? `<span class="vb-lbl">Agrupado por</span> ${groups.map((c, i) => `${i ? '<span class="vb-sep">›</span>' : ''}<span class="vb-chip lv${Math.min(i, 2)}">${esc(colLabel(sh, c))}<button data-ungroup="${c}" title="Remover este agrupamento">×</button></span>`).join('')}` : ''}
        <select class="vb-sel" id="vb-group">${opt(allCols.filter((c) => !groups.includes(c)), groups.length ? '+ Agrupar dentro…' : '+ Agrupar por…')}</select></span>
      <span class="vb-sort"><select class="vb-sel" id="vb-sort"><option value="">Classificar por status…</option>${allCols.map((c) => `<option value="${c}"${v.sort && v.sort.col === c ? ' selected' : ''}>Status: ${esc(colLabel(sh, c))}</option>`).join('')}</select>
        ${v.sort && v.sort.col ? '<button class="vb-btn" id="vb-order">Ordem dos status</button>' : ''}</span>
      ${v.order && v.order.length ? '<button class="vb-btn" id="vb-cols">Restaurar ordem das colunas</button>' : '<span class="vb-note">Arraste o cabeçalho de uma coluna selecionada para mudar a ordem. Só você vê.</span>'}
      ${nFilters ? `<button class="vb-btn" id="vb-clear">Limpar filtros (${nFilters})</button>` : ''}
      <button class="vb-x" id="vb-close" title="Fechar visualização" aria-label="Fechar visualização">${icon('close', 18)}</button>`;
    bar.hidden = false;
    bar.querySelector('#vb-close').onclick = () => App.run('closeFilterView');
    const q = (id) => bar.querySelector(id);
    if (q('#vb-clear')) q('#vb-clear').onclick = () => App.run('clearViewFilters');
    if (q('#vb-cols')) q('#vb-cols').onclick = () => { v.order = []; App.setView(sh, v); };
    q('#vb-group').onchange = (e) => { const c = +e.target.value; if (c) create('group', c); };
    bar.querySelectorAll('[data-ungroup]').forEach((b) => (b.onclick = () => { v.groups = groups.filter((c) => c !== +b.dataset.ungroup); v.collapsed = []; App.setView(sh, v); }));
    q('#vb-sort').onchange = (e) => { const c = +e.target.value; v.sort = c ? { col: c, order: (v.sort && v.sort.col === c && v.sort.order) || [] } : null; App.setView(sh, v); };
    if (q('#vb-order')) q('#vb-order').onclick = orderDialog;
  }
  function orderDialog() {
    const sh = App.sheet(), v = cur();
    if (!v || !v.sort) return;
    const items = (v._statusOrder || []).slice();
    const m = App.ui.modal({
      title: 'Ordem dos status', width: '440px', cls: 'modal-tall', enterSubmits: false,
      body: '<p class="sp-hint">Os status de cima aparecem primeiro. Quando uma linha muda de status, ela muda de lugar na hora.</p><div class="mv-list"></div><button class="btn btn-sm" id="so-final">Finalizados primeiro</button>',
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => { v.sort.order = items.slice(); App.setView(sh, v); } }],
    });
    const list = m.el.querySelector('.mv-list');
    const draw = () => {
      list.innerHTML = items.map((it, i) => `<div class="mv-li" draggable="true" data-i="${i}"><span class="mv-grip">⠿</span><span>${it === '' ? '(Vazio)' : esc(it)}</span>
        <button class="icon-btn" data-up="${i}"${i === 0 ? ' disabled' : ''}>▲</button><button class="icon-btn" data-down="${i}"${i === items.length - 1 ? ' disabled' : ''}>▼</button></div>`).join('');
      list.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }));
      list.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { const i = +b.dataset.down; [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); }));
      // segurar e arrastar para mudar a ordem
      let from = null;
      list.querySelectorAll('.mv-li').forEach((el) => {
        el.addEventListener('dragstart', () => { from = +el.dataset.i; el.classList.add('dragging'); });
        el.addEventListener('dragover', (e) => { e.preventDefault(); });
        el.addEventListener('drop', (e) => { e.preventDefault(); const to = +el.dataset.i; if (from === null || from === to) return; const [x] = items.splice(from, 1); items.splice(to, 0, x); draw(); });
      });
    };
    m.el.querySelector('#so-final').onclick = () => { items.sort((a, b) => isFinal(b) - isFinal(a)); draw(); };
    draw();
  }

  // Na visualização reordenada, só ficam as ações de preencher e formatar células; o resto pede para fechar a visualização
  const VIEW_OK = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'pasteValues', 'pasteFormat', 'pasteFormula', 'clearValues', 'clearFormat', 'clearAll', 'fillDown', 'fillRight',
    'bold', 'italic', 'underline', 'strike', 'textColor', 'fillColor', 'fontFamily', 'fontSize', 'fontSizeInc', 'fontSizeDec', 'format', 'customFormat', 'decInc', 'decDec',
    'fmt_number', 'fmt_time', 'fmt_date', 'fmt_currency', 'fmt_percent', 'fmt_scientific', 'paintFormat', 'alignLeft', 'alignCenter', 'alignRight', 'valignTop', 'valignMiddle', 'valignBottom',
    'wrapOverflow', 'wrapWrap', 'wrapClip', 'insertDate', 'insertTime', 'insertDateTime', 'markCritical', 'cellHistory', 'zoom', 'toggleGridlines', 'toggleFormulas', 'toggleFormulaBar',
    'toggleMenus', 'fullscreen', 'selectAll', 'selectColumn', 'selectRow', 'switchSheet', 'nextSheet', 'prevSheet', 'openCloud', 'share', 'login', 'shortcuts', 'about',
    'functionList', 'menuSearch', 'createFilterView', 'createGroupedView', 'closeFilterView', 'clearViewFilters', 'toggleOldRows', 'myView', 'viewAs', 'dssLookup']);
  function lockInView() {
    for (const id in App.cmds) {
      const c = App.cmds[id];
      if (c._viewLocked || VIEW_OK.has(id)) continue;
      const run = c.run;
      c.run = (...args) => { if (App.vm) return notify('Feche a visualização de filtro (X na barra escura) para usar esta opção.'); return run(...args); };
      c._viewLocked = true;
    }
  }

  App.on('sheet', () => { restore(); render(); });
  App.on('change', (e) => { if (e && e.view) return; if (cur()) setTimeout(render, 0); });
  App.on('gridMouseDown', (h) => {
    if (!h || (h.area !== 'cell' && h.area !== 'colHdr' && h.area !== 'rowHdr')) return;
    const sh = App.sheet();
    if (!sh.colGroups || !sh.colGroups.length) return;
    const real = h.c && App.realCell(1, h.c);
    setTimeout(() => App.collapseUnlocked(sh, real ? real.c : (h.c || App.sel.ac)), 0);
  });

  // ---------- Botão das linhas recolhidas (regras de "Ocultar linhas") ----------
  let oldChip = null;
  function renderOld() {
    const sh = App.sheet();
    const rule = sh && App.foldRules(sh);
    const all = rule ? App.oldRowsAll(sh) : null;
    if (!all || !all.size) { if (oldChip) oldChip.hidden = true; return; }
    if (!oldChip) {
      oldChip = document.createElement('button');
      oldChip.className = 'old-chip';
      oldChip.onclick = () => App.run('toggleOldRows');
      $('grid-wrap').appendChild(oldChip);
    }
    const open = App.showOld(sh), n = all.size;
    const what = rule.days && !rule.above && !rule.values ? ` com mais de ${rule.days.n || 30} dias` : ' ocultas';
    oldChip.hidden = false;
    oldChip.classList.toggle('open', open);
    oldChip.innerHTML = open ? `<b>−</b> Recolher ${n} ${n === 1 ? 'linha' : 'linhas'}${what === ' ocultas' ? '' : what}` : `<b>+</b> ${n} ${n === 1 ? 'linha' : 'linhas'}${what}`;
    oldChip.title = open ? 'Só você está vendo estas linhas.' : 'Mostrar as linhas recolhidas (só para você)';
  }
  let ot = null;
  App.on('change', () => { clearTimeout(ot); ot = setTimeout(renderOld, 120); });
  App.on('sheet', () => setTimeout(renderOld, 0));

  // ---------- Itens do menu (barra de ferramentas e Dados) ----------
  App.viewMenuItems = () => {
    const sh = App.sheet(), used = App.usedRange(sh);
    const cols = [];
    for (let c = 1; c <= Math.max(1, used.maxC); c++) {
      if (App.colBlocked && App.colBlocked(sh, c)) continue;
      cols.push({ label: colLabel(sh, c), cmd: 'createGroupedView', arg: c });
    }
    const v = App.views.get(sh.id);
    const items = [
      { label: v && v.groups && v.groups.length ? 'Agrupar dentro do agrupamento' : 'Criar visualização agrupada', icon: 'plus', sub: cols.length ? cols : [{ label: 'Nenhuma coluna com dados', disabled: true }] },
      { label: v ? 'Visualização com filtro (aberta)' : 'Criar visualização com filtro', icon: 'plus', cmd: 'createFilterView' },
    ];
    if (v) items.push('-', { label: 'Limpar filtros da visualização', cmd: 'clearViewFilters' }, { label: 'Fechar visualização', icon: 'close', cmd: 'closeFilterView' });
    return items;
  };

  def('createFilterView', 'Criar visualização com filtro', () => create('filter'));
  def('myView', 'Visualização com filtro', () => create('filter'));
  def('createGroupedView', 'Criar visualização agrupada', (c) => { const real = typeof c === 'number' ? c : (App.realCell(App.sel.ar, App.sel.ac) || {}).c; create('group', real); });
  def('closeFilterView', 'Fechar visualização', () => { const sh = App.sheet(); if (App.views.has(sh.id)) App.setView(sh, null); });
  def('clearViewFilters', 'Limpar filtros da visualização', () => { const sh = App.sheet(), v = App.views.get(sh.id); if (v) { v.crit = {}; App.setView(sh, v); } });
  App.viewsInit = () => { lockInView(); restore(); render(); };
})(window.App);
