// Coluna MODALIDADE (botão direito): marcar a operação como SEM CUSTOS (SC) ou FRETE SPOT.
// A marca fica na própria célula (sc / spot) e aparece pequena, em vermelho, no canto esquerdo.
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc;
  const notify = (m) => App.emit('notify', m);
  const TAGS = { sc: { short: 'SC', label: 'Operação sem custos (SC)' }, spot: { short: 'SPOT', label: 'Operação FRETE SPOT' } };

  const modCol = (sh) => (App.colByName ? App.colByName(sh, 'MODALIDADE') : null);
  // células reais da coluna MODALIDADE na seleção (inclui Ctrl+clique e a visualização com filtro)
  function selCells(sh) {
    const col = modCol(sh);
    if (!col) return [];
    const rows = new Set();
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) {
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 2000); r++) {
        const p = App.realCell ? App.realCell(r, R.c1) : { r, c: R.c1 };
        if (p) rows.add(p.r);
      }
    }
    const first = sh.colNames && sh.colNames[col] ? 1 : 2;
    return [...rows].filter((r) => r >= first).sort((a, b) => a - b).map((r) => E.addrToStr(r, col));
  }
  function toggle(key) {
    const sh = App.sheet(), col = modCol(sh);
    if (!col) return notify('Esta página não tem a coluna MODALIDADE.');
    const cells = selCells(sh);
    if (!cells.length) return notify('Selecione as linhas na coluna MODALIDADE.');
    if (App.editGuard) { const p = E.parseAddr(cells[0]); const err = App.editGuard(sh, p.row, p.col, true); if (err) return notify(err); }
    const on = !cells.every((a) => sh.cells[a] && sh.cells[a][key]);
    const done = App.change(on ? `Marcar ${TAGS[key].short}` : `Tirar ${TAGS[key].short}`, () => {
      for (const a of cells) {
        const x = sh.cells[a] || (sh.cells[a] = { v: '' });
        if (on) x[key] = true; else delete x[key];
        App.cleanup(sh, a);
      }
    });
    if (done !== false) notify(`${TAGS[key].label}: ${on ? 'marcada' : 'desmarcada'} em ${cells.length === 1 ? 'linha ' + E.parseAddr(cells[0]).row : cells.length + ' linhas'}.`);
  }

  App.on('contextItems', ({ hit, items }) => {
    if (hit.area !== 'cell' && hit.area !== 'fill') return;
    const sh = App.sheet(), col = modCol(sh);
    if (!col) return;
    const p = App.realCell ? App.realCell(hit.r, hit.c) : { r: hit.r, c: hit.c };
    if (!p || p.c !== col) return;
    const cells = App.withReal(() => selCells(sh));
    const has = (k) => cells.length > 0 && cells.every((a) => sh.cells[a] && sh.cells[a][k]);
    items.splice(Math.min(items.length, 4), 0,
      { label: TAGS.sc.label, check: has('sc'), cmd: 'tagSC' },
      { label: TAGS.spot.label, check: has('spot'), cmd: 'tagSPOT' }, '-');
  });
  App.commands.def('tagSC', 'Operação sem custos (SC)', () => toggle('sc'));
  App.commands.def('tagSPOT', 'Operação FRETE SPOT', () => toggle('spot'));
  App.opTags = { toggle, TAGS };
})(window.App);
