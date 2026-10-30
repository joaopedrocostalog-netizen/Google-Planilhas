// Visualizações de filtro: cada pessoa filtra ou agrupa a planilha só para si,
// sem mudar o que as outras pessoas veem (funciona também para quem só preenche valores).
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = App.esc, E = App.E;
  const def = (id, label, fn, sc) => App.commands.def(id, label, fn, sc);
  const icon = (n, s) => App.icon(n, s);

  const headerText = (sh, c) => {
    const nm = sh.colNames && sh.colNames[c];
    if (nm) return String(nm);
    try { const v = App.value(App.sheetIndex(sh), 1, c); return v === null || v === undefined ? '' : String(App.fmtValue(v, App.style(sh, 1, c).nf)); } catch (e) { return ''; }
  };
  const colLabel = (sh, c) => { const t = headerText(sh, c); return E.numToCol(c) + (t ? ' · ' + t.slice(0, 30) : ''); };

  // Intervalo inicial: a seleção (se houver mais de uma célula) ou todas as colunas com dados
  function defaultRange(sh) {
    const R = App.selRect(), used = App.usedRange(sh);
    const named = !!(sh.colNames && Object.keys(sh.colNames).length);
    const head = sh.filter ? sh.filter.r1 : named ? 0 : 1;
    if (!(R.r1 === R.r2 && R.c1 === R.c2) && !(R.r1 === 1 && R.r2 >= sh.rows && R.c1 === R.c2)) {
      if (R.r1 === 1 && R.r2 >= sh.rows) return { r1: named ? 0 : 1, c1: R.c1, c2: Math.max(R.c1, Math.min(R.c2, Math.max(R.c1, used.maxC))) };
      return { r1: R.r1, c1: R.c1, c2: R.c2, r2: R.r2 };
    }
    return { r1: head, c1: 1, c2: Math.max(1, used.maxC) };
  }

  App.setView = (sh, v) => {
    if (v) App.views.set(sh.id, v); else App.views.delete(sh.id);
    App.invalidate();
    App.emit('change', { view: true });
    render();
  };

  function create(kind, col) {
    const sh = App.sheet();
    const base = defaultRange(sh);
    const v = Object.assign({ crit: {}, kind, dyn: base.r2 === undefined, r2: base.r2 || sh.rows }, base);
    if (kind === 'group') {
      v.group = col;
      v.c1 = Math.min(v.c1, col); v.c2 = Math.max(v.c2, col);
    }
    App.setView(sh, v);
    App.emit('notify', kind === 'group' ? `Visualização agrupada por ${colLabel(sh, col)}. Só você vê.` : 'Visualização com filtro criada. Use os botões de filtro; só você vê o resultado.');
  }

  // ---------- Barra no topo e painel de grupos ----------
  let panel = null;
  function render() {
    const bar = $('view-bar');
    const sh = App.sheet();
    const v = sh && App.views.get(sh.id);
    if (!v) {
      bar.hidden = true;
      if (panel) { panel.remove(); panel = null; }
      return;
    }
    const range = `${E.numToCol(v.c1)}${Math.max(1, v.r1)}:${E.numToCol(v.c2)}${v.dyn ? '' : v.r2}`;
    const nFilters = Object.keys(v.crit || {}).length;
    bar.innerHTML = `<span class="vb-title">${icon('filterViews', 18)} ${v.kind === 'group' ? `Visualização agrupada por ${esc(colLabel(sh, v.group))}` : 'Visualização com filtro'}</span>
      <span class="vb-range">Intervalo: ${esc(range)}</span>
      <span class="vb-note">Só você vê esta visualização. Os dados e a tela das outras pessoas não mudam.</span>
      ${nFilters ? `<button class="vb-btn" id="vb-clear">Limpar filtros (${nFilters})</button>` : ''}
      <button class="vb-x" id="vb-close" title="Fechar visualização" aria-label="Fechar visualização">${icon('close', 18)}</button>`;
    bar.hidden = false;
    bar.querySelector('#vb-close').onclick = () => App.run('closeFilterView');
    const clear = bar.querySelector('#vb-clear');
    if (clear) clear.onclick = () => App.run('clearViewFilters');
    renderGroups(sh, v);
  }
  function renderGroups(sh, v) {
    if (v.kind !== 'group') { if (panel) { panel.remove(); panel = null; } return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'group-panel';
      $('grid-wrap').appendChild(panel);
    }
    const si = App.sheetIndex(sh), c = v.group;
    const counts = new Map();
    for (let r = v.r1 + 1, end = App.filterEnd(sh); r <= end; r++) {
      const t = App.fmtValue(App.value(si, r, c), App.style(sh, r, c).nf);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const values = [...counts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR', { numeric: true })));
    const crit = v.crit[c];
    const shown = crit && crit.hidden ? values.filter((x) => !crit.hidden.includes(x)) : null;
    const cur = shown && shown.length === 1 ? shown[0] : null;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    panel.innerHTML = `<h3>Grupos de ${esc(colLabel(sh, c))}</h3><small>Clique em um grupo para ver só as linhas dele.</small>
      <button class="gp-item${!crit ? ' on' : ''}" data-g="__all"><span>Todos</span><em>${total}</em></button>
      ${values.map((x, i) => `<button class="gp-item${cur === x ? ' on' : ''}" data-g="${i}"><span>${x === '' ? '(Vazias)' : esc(x)}</span><em>${counts.get(x)}</em></button>`).join('')}`;
    panel.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => {
      if (b.dataset.g === '__all') delete v.crit[c];
      else { const val = values[+b.dataset.g]; v.crit[c] = { hidden: values.filter((x) => x !== val), cond: null }; }
      App.setView(sh, v);
    }));
  }
  // atualiza os grupos quando os dados mudam (inclusive edições de outras pessoas)
  let t = null;
  App.on('change', (e) => {
    if (e && e.view) return;
    clearTimeout(t);
    t = setTimeout(() => { const sh = App.sheet(); const v = sh && App.views.get(sh.id); if (v && v.kind === 'group') renderGroups(sh, v); }, 200);
  });
  App.on('sheet', render);

  // ---------- Itens do menu (barra de ferramentas e Dados) ----------
  App.viewMenuItems = () => {
    const sh = App.sheet(), used = App.usedRange(sh);
    const cols = [];
    for (let c = 1; c <= Math.max(1, used.maxC); c++) {
      if (App.isColHidden(sh, c)) continue;
      cols.push({ label: colLabel(sh, c), cmd: 'createGroupedView', arg: c });
    }
    const items = [
      { label: 'Criar visualização agrupada', icon: 'plus', sub: cols.length ? cols : [{ label: 'Nenhuma coluna com dados', disabled: true }] },
      { label: 'Criar visualização com filtro', icon: 'plus', cmd: 'createFilterView' },
    ];
    if (App.views.has(sh.id)) items.push('-', { label: 'Limpar filtros da visualização', cmd: 'clearViewFilters' }, { label: 'Fechar visualização', icon: 'close', cmd: 'closeFilterView' });
    return items;
  };

  def('createFilterView', 'Criar visualização com filtro', () => create('filter'));
  def('createGroupedView', 'Criar visualização agrupada', (c) => create('group', typeof c === 'number' ? c : App.sel.ac));
  def('closeFilterView', 'Fechar visualização', () => { const sh = App.sheet(); if (App.views.has(sh.id)) App.setView(sh, null); });
  def('clearViewFilters', 'Limpar filtros da visualização', () => { const sh = App.sheet(), v = App.views.get(sh.id); if (v) { v.crit = {}; App.setView(sh, v); } });
})(window.App);
