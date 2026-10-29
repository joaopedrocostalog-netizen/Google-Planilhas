// Comandos (usados por menus, barra de ferramentas, busca e atalhos), teclado e área de transferência.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const sel = App.sel;
  const $ = (id) => document.getElementById(id);
  const notify = (m) => App.emit('notify', m);

  const cmds = (App.cmds = {});
  const def = (id, label, run, sc) => { cmds[id] = { id, label, run, sc }; };
  App.run = (id, arg) => {
    const c = cmds[id];
    if (!c) return console.warn('Comando desconhecido', id);
    if (App.editing() && !['undo', 'redo'].includes(id)) {
      if (!App.commitEdit()) return;
    }
    const before = document.activeElement;
    c.run(arg);
    // só devolve o foco à grade se o comando não abriu um campo, diálogo ou popup
    const now = document.activeElement;
    if ((now === before || now === document.body) && !document.querySelector('dialog[open]') && !App.editing()) App.grid.focus();
  };

  // ---------- Formatação ----------
  const si = () => doc.active;
  function forSel(fn, R) {
    const sh = App.sheet();
    R = R || App.selRect();
    const used = App.usedRange(sh);
    // seleção de colunas inteiras: limita às linhas em uso (mais 50) para não criar milhares de células
    const r2 = R.r1 === 1 && R.r2 >= sh.rows && R.r2 - R.r1 > 200 ? Math.max(used.maxR + 50, 100) : R.r2;
    const c2 = R.c1 === 1 && R.c2 >= sh.cols && R.c2 - R.c1 > 26 ? Math.max(used.maxC + 5, 26) : R.c2;
    for (let r = R.r1; r <= Math.min(r2, sh.rows); r++) for (let c = R.c1; c <= Math.min(c2, sh.cols); c++) App.setStyle(sh, r, c, (s) => fn(s, r, c, R));
  }
  App.forSel = forSel;
  const styleAt = () => App.style(App.sheet(), sel.ar, sel.ac);
  function applyStyle(label, fn) { App.change(label, () => forSel(fn)); }
  function toggle(key, label) {
    const on = !!styleAt()[key];
    applyStyle(label, (s) => { if (on) delete s[key]; else s[key] = true; });
  }
  const setKey = (key, label) => (val) => applyStyle(label, (s) => { if (val === null || val === undefined || val === '') delete s[key]; else s[key] = val; });

  def('bold', 'Negrito', () => toggle('b', 'Negrito'), 'Ctrl+B');
  def('italic', 'Itálico', () => toggle('i', 'Itálico'), 'Ctrl+I');
  def('underline', 'Sublinhado', () => toggle('u', 'Sublinhado'), 'Ctrl+U');
  def('strike', 'Tachado', () => toggle('st', 'Tachado'), 'Alt+Shift+5');
  def('clearFormat', 'Limpar formatação', () => applyStyle('Limpar formatação', (s) => { for (const k in s) delete s[k]; }), 'Ctrl+\\');
  def('fontFamily', 'Fonte', setKey('ff', 'Fonte'));
  def('fontSize', 'Tamanho da fonte', (n) => applyStyle('Tamanho da fonte', (s) => { const v = Math.max(1, Math.min(400, +n || 10)); if (v === 10) delete s.fs; else s.fs = v; }));
  def('fontSizeInc', 'Aumentar tamanho da fonte', () => { const v = (styleAt().fs || 10) + 1; App.run('fontSize', v); }, 'Ctrl+Shift+.');
  def('fontSizeDec', 'Diminuir tamanho da fonte', () => { const v = Math.max(1, (styleAt().fs || 10) - 1); App.run('fontSize', v); }, 'Ctrl+Shift+,');
  def('textColor', 'Cor do texto', setKey('color', 'Cor do texto'));
  def('fillColor', 'Cor de preenchimento', setKey('bg', 'Cor de preenchimento'));
  for (const [id, label, key, val, sc] of [
    ['alignLeft', 'Alinhar à esquerda', 'al', 'l', 'Ctrl+Shift+L'], ['alignCenter', 'Centralizar', 'al', 'c', 'Ctrl+Shift+E'], ['alignRight', 'Alinhar à direita', 'al', 'r', 'Ctrl+Shift+R'],
    ['valignTop', 'Alinhar acima', 'va', 't'], ['valignMiddle', 'Alinhar ao meio', 'va', 'm'], ['valignBottom', 'Alinhar abaixo', 'va', null],
    ['wrapOverflow', 'Transbordar', 'wrap', null], ['wrapWrap', 'Ajustar texto', 'wrap', 'wrap'], ['wrapClip', 'Cortar texto', 'wrap', 'clip'],
    ['rotNone', 'Sem rotação', 'rot', null], ['rot45', 'Inclinar para cima', 'rot', 45], ['rotUp', 'Girar para cima', 'rot', 90], ['rotDown', 'Girar para baixo', 'rot', -90],
  ]) {
    if (key === 'wrap') {
      // ajustar texto também recalcula a altura das linhas
      def(id, label, () => App.change(label, () => {
        const R = App.selRect(), sh = App.sheet();
        forSel((s) => { if (val === null) delete s.wrap; else s.wrap = val; });
        const used = App.usedRange(sh);
        const rows = [];
        for (let r = R.r1; r <= Math.min(R.r2, Math.max(used.maxR, R.r1)); r++) rows.push(r);
        App.autoFitRows(sh, rows);
      }), sc);
    } else def(id, label, () => setKey(key, label)(val), sc);
  }
  def('indentInc', 'Aumentar recuo', () => applyStyle('Recuo', (s) => { s.indent = Math.min(15, (s.indent || 0) + 1); }));
  def('indentDec', 'Diminuir recuo', () => applyStyle('Recuo', (s) => { if ((s.indent || 0) <= 1) delete s.indent; else s.indent--; }));

  // Formatos de número
  def('format', 'Formato de número', (key) => {
    const f = App.FORMATS[key];
    const code = f ? f.code : key;
    applyStyle('Formato de número', (s) => { if (!code) delete s.nf; else s.nf = code; });
  });
  for (const [k, sc] of [['number', 'Ctrl+Shift+1'], ['time', 'Ctrl+Shift+2'], ['date', 'Ctrl+Shift+3'], ['currency', 'Ctrl+Shift+4'], ['percent', 'Ctrl+Shift+5'], ['scientific', 'Ctrl+Shift+6']]) {
    def('fmt_' + k, 'Formatar como ' + App.FORMATS[k].label.toLowerCase(), () => App.run('format', k), sc);
  }
  function changeDecimals(delta) {
    const sh = App.sheet();
    const v = App.value(si(), sel.ar, sel.ac);
    let code = styleAt().nf;
    if (!code) {
      const raw = App.raw(sh, sel.ar, sel.ac);
      code = typeof raw === 'string' && raw[0] === '=' ? App.inferFormat(si(), raw) : null;
    }
    if (!code) {
      const shown = typeof v === 'number' ? App.fmtAuto(v) : '0';
      const dec = (shown.split(',')[1] || '').length;
      const n = Math.max(0, dec + delta);
      code = n ? '0.' + '0'.repeat(n) : '0';
    } else {
      if (/[dyhs]/i.test(code.replace(/"[^"]*"/g, ''))) return notify('Não é possível alterar as casas decimais de datas e horas.');
      code = code.split(';').map((sec) => {
        const m = /([0#?])(\.([0#?]*))?(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/.exec(sec);
        if (!m) return sec;
        // localiza o último bloco de dígitos do padrão
        const idx = sec.search(/[0#?][0#?,]*(\.[0#?]*)?(?=[^0#?.,]*$)/);
        if (idx < 0) return sec;
        const tail = sec.slice(idx);
        const mm = /^([0#?][0#?,]*)(\.([0#?]*))?/.exec(tail);
        const intPart = mm[1], decs = mm[3] || '';
        const nd = Math.max(0, decs.length + delta);
        return sec.slice(0, idx) + intPart + (nd ? '.' + '0'.repeat(nd) : '') + tail.slice(mm[0].length);
      }).join(';');
    }
    App.change('Casas decimais', () => forSel((s) => { s.nf = code; }));
  }
  def('decInc', 'Aumentar casas decimais', () => changeDecimals(1));
  def('decDec', 'Diminuir casas decimais', () => changeDecimals(-1));

  // Bordas: type = all | inner | h | v | outer | left | top | right | bottom | none
  def('border', 'Bordas', (opt) => {
    const type = opt.type, b = { style: opt.style || 'solid', color: opt.color || '#000000' };
    App.change('Bordas', () => forSel((s, r, c, R) => {
      const bd = Object.assign({}, s.bd || {});
      const set = (side, on) => { if (on) bd[side] = Object.assign({}, b); };
      if (type === 'none') { delete s.bd; return; }
      if (type === 'all') { set('t', 1); set('b', 1); set('l', 1); set('r', 1); }
      if (type === 'outer') { set('t', r === R.r1); set('b', r === R.r2); set('l', c === R.c1); set('r', c === R.c2); }
      if (type === 'inner') { set('b', r < R.r2); set('r', c < R.c2); }
      if (type === 'h') set('b', r < R.r2);
      if (type === 'v') set('r', c < R.c2);
      if (type === 'left') set('l', c === R.c1);
      if (type === 'right') set('r', c === R.c2);
      if (type === 'top') set('t', r === R.r1);
      if (type === 'bottom') set('b', r === R.r2);
      s.bd = bd;
      if (!Object.keys(bd).length) delete s.bd;
    }));
  });
  def('merge', 'Mesclar células', (mode) => {
    const sh = App.sheet(), R = App.selRect();
    if (mode !== 'none' && R.r1 === R.r2 && R.c1 === R.c2) return notify('Selecione mais de uma célula para mesclar.');
    let lost = 0;
    if (mode && mode !== 'none') for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
      const keep = mode === 'all' ? r === R.r1 && c === R.c1 : mode === 'h' ? c === R.c1 : r === R.r1;
      if (!keep && App.raw(sh, r, c) !== '') lost++;
    }
    const go = () => { App.change('Mesclar', () => App.merge(sh, R, mode || 'all')); App.grid.select(R.r1, R.c1); App.grid.selectRange(R); };
    if (lost) App.ui.confirm('Mesclar células', 'A mesclagem mantém somente o valor da célula superior esquerda. Os outros valores serão descartados.', 'Mesclar', go);
    else go();
  });

  // ---------- Linhas, colunas e planilhas ----------
  const isFullRows = (R, sh) => R.c1 === 1 && R.c2 >= sh.cols;
  const isFullCols = (R, sh) => R.r1 === 1 && R.r2 >= sh.rows;
  def('insertRowsAbove', 'Inserir linhas acima', () => { const R = App.selRect(), n = R.r2 - R.r1 + 1; App.change('Inserir linhas', () => App.structural(si(), 'row', R.r1, n)); App.grid.selectRows(R.r1, R.r1 + n - 1); });
  def('insertRowsBelow', 'Inserir linhas abaixo', () => { const R = App.selRect(), n = R.r2 - R.r1 + 1; App.change('Inserir linhas', () => App.structural(si(), 'row', R.r2 + 1, n)); App.grid.selectRows(R.r2 + 1, R.r2 + n); });
  def('insertColsLeft', 'Inserir colunas à esquerda', () => { const R = App.selRect(), n = R.c2 - R.c1 + 1; App.change('Inserir colunas', () => App.structural(si(), 'col', R.c1, n)); App.grid.selectCols(R.c1, R.c1 + n - 1); });
  def('insertColsRight', 'Inserir colunas à direita', () => { const R = App.selRect(), n = R.c2 - R.c1 + 1; App.change('Inserir colunas', () => App.structural(si(), 'col', R.c2 + 1, n)); App.grid.selectCols(R.c2 + 1, R.c2 + n); });
  def('deleteRows', 'Excluir linhas', () => {
    const sh = App.sheet(), R = App.selRect();
    if (R.r2 - R.r1 + 1 >= sh.rows) return notify('Não é possível excluir todas as linhas da planilha.');
    App.change('Excluir linhas', () => App.structural(si(), 'row', R.r1, -(R.r2 - R.r1 + 1)));
    App.grid.select(Math.min(R.r1, App.sheet().rows), sel.ac);
  });
  def('deleteCols', 'Excluir colunas', () => {
    const sh = App.sheet(), R = App.selRect();
    if (R.c2 - R.c1 + 1 >= sh.cols) return notify('Não é possível excluir todas as colunas da planilha.');
    App.change('Excluir colunas', () => App.structural(si(), 'col', R.c1, -(R.c2 - R.c1 + 1)));
    App.grid.select(sel.ar, Math.min(R.c1, App.sheet().cols));
  });
  def('insertSmart', 'Inserir linhas/colunas', () => { const sh = App.sheet(), R = App.selRect(); App.run(isFullCols(R, sh) && !isFullRows(R, sh) ? 'insertColsLeft' : 'insertRowsAbove'); }, 'Ctrl+Alt+=');
  def('deleteSmart', 'Excluir linhas/colunas', () => { const sh = App.sheet(), R = App.selRect(); App.run(isFullCols(R, sh) && !isFullRows(R, sh) ? 'deleteCols' : 'deleteRows'); }, 'Ctrl+Alt+-');
  def('clearValues', 'Excluir valores', () => {
    const sh = App.sheet(), R = App.selRect();
    App.change('Excluir valores', () => {
      for (const a of Object.keys(sh.cells)) {
        const p = E.parseAddr(a);
        if (App.inRect(R, p.row, p.col)) {
          const dv = App.dvAt(sh, p.row, p.col);
          sh.cells[a].v = dv && dv.type === 'checkbox' ? 'FALSE' : '';
          App.cleanup(sh, a);
        }
      }
    });
  }, 'Delete');
  def('clearAll', 'Limpar tudo (valores e formatação)', () => {
    const sh = App.sheet(), R = App.selRect();
    App.change('Limpar', () => { for (const a of Object.keys(sh.cells)) { const p = E.parseAddr(a); if (App.inRect(R, p.row, p.col)) delete sh.cells[a]; } });
  });
  def('hideRows', 'Ocultar linhas', () => { const sh = App.sheet(), R = App.selRect(); App.change('Ocultar linhas', () => { for (let r = R.r1; r <= R.r2; r++) sh.hiddenRows[r] = true; }); }, 'Ctrl+Alt+9');
  def('hideCols', 'Ocultar colunas', () => { const sh = App.sheet(), R = App.selRect(); App.change('Ocultar colunas', () => { for (let c = R.c1; c <= R.c2; c++) sh.hiddenCols[c] = true; }); }, 'Ctrl+Alt+0');
  def('unhideRows', 'Reexibir linhas', () => { const sh = App.sheet(), R = App.selRect(); App.change('Reexibir linhas', () => { for (let r = Math.max(1, R.r1 - 1); r <= R.r2 + 1; r++) delete sh.hiddenRows[r]; }); }, 'Ctrl+Shift+9');
  def('unhideCols', 'Reexibir colunas', () => { const sh = App.sheet(), R = App.selRect(); App.change('Reexibir colunas', () => { for (let c = Math.max(1, R.c1 - 1); c <= R.c2 + 1; c++) delete sh.hiddenCols[c]; }); }, 'Ctrl+Shift+0');
  def('resizeRows', 'Redimensionar linhas', () => {
    const sh = App.sheet(), R = App.selRect();
    App.ui.prompt('Redimensionar linhas ' + R.r1 + (R.r2 > R.r1 ? ' a ' + R.r2 : ''), 'Altura em pixels (padrão: 21)', String(Math.round(sh.rowH[R.r1] || App.DEF_H)), (v) => {
      const n = parseInt(v, 10);
      if (!(n > 1)) return notify('Informe um número maior que 1.');
      App.change('Redimensionar linhas', () => { for (let r = R.r1; r <= R.r2; r++) if (n === App.DEF_H) delete sh.rowH[r]; else sh.rowH[r] = n; });
    });
  });
  def('resizeCols', 'Redimensionar colunas', () => {
    const sh = App.sheet(), R = App.selRect();
    App.ui.prompt('Redimensionar colunas ' + E.numToCol(R.c1) + (R.c2 > R.c1 ? ' a ' + E.numToCol(R.c2) : ''), 'Largura em pixels (padrão: 100)', String(Math.round(sh.colW[R.c1] || App.DEF_W)), (v) => {
      const n = parseInt(v, 10);
      if (!(n > 1)) return notify('Informe um número maior que 1.');
      App.change('Redimensionar colunas', () => { for (let c = R.c1; c <= R.c2; c++) if (n === App.DEF_W) delete sh.colW[c]; else sh.colW[c] = n; });
    });
  });
  def('autofitCols', 'Ajustar colunas ao conteúdo', () => { const R = App.selRect(); App.grid.autofitCols(R.c1); });
  def('addRows', 'Adicionar linhas', (n) => { const sh = App.sheet(); App.change('Adicionar linhas', () => { sh.rows += Math.max(1, Math.min(100000, +n || 1000)); }); });
  def('addCols', 'Adicionar colunas', (n) => { const sh = App.sheet(); App.change('Adicionar colunas', () => { sh.cols += Math.max(1, Math.min(1000, +n || 26)); }); });
  def('freezeRows', 'Congelar linhas', (n) => { const sh = App.sheet(); App.change('Congelar', () => { sh.freeze.rows = n === 'current' ? sel.ar : n; }); });
  def('freezeCols', 'Congelar colunas', (n) => { const sh = App.sheet(); App.change('Congelar', () => { sh.freeze.cols = n === 'current' ? sel.ac : n; }); });
  def('zoom', 'Zoom', (z) => { doc.zoom = Math.max(25, Math.min(400, +z || 100)); App.scheduleSave(); App.grid.layout(); App.emit('zoom'); });
  def('toggleGridlines', 'Linhas de grade', () => { doc.showGrid = !doc.showGrid; App.scheduleSave(); App.grid.draw(); App.emit('viewOptions'); });
  def('toggleFormulas', 'Mostrar fórmulas', () => { doc.showFormulas = !doc.showFormulas; App.grid.draw(); App.emit('viewOptions'); }, 'Ctrl+`');
  def('toggleFormulaBar', 'Barra de fórmulas', () => { document.body.classList.toggle('no-formula-bar'); App.grid.layout(); App.emit('viewOptions'); });
  def('toggleMenus', 'Ocultar menus', () => { document.body.classList.toggle('compact'); App.grid.layout(); }, 'Ctrl+Shift+F');
  def('fullscreen', 'Tela cheia', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => notify('O navegador não permitiu a tela cheia.')); });

  def('newSheet', 'Nova planilha', () => {
    App.change('Nova planilha', () => { doc.sheets.splice(doc.active + 1, 0, App.newSheet(App.nextSheetName())); doc.active++; });
    App.emit('sheet');
  }, 'Shift+F11');
  def('duplicateSheet', 'Duplicar planilha', () => {
    const src = App.sheet();
    App.change('Duplicar planilha', () => {
      const copy = App.normalizeSheet(JSON.parse(JSON.stringify(src, (k, v) => (k[0] === '_' ? undefined : v))));
      copy.id = App.uid(); copy.name = App.uniqueSheetName('Cópia de ' + src.name);
      copy.charts = copy.charts.map((c) => Object.assign(c, { id: App.uid() }));
      doc.sheets.splice(doc.active + 1, 0, copy); doc.active++;
    });
    App.emit('sheet');
  });
  def('deleteSheet', 'Excluir planilha', (idx) => {
    const i = idx === undefined ? doc.active : idx;
    if (doc.sheets.filter((s) => !s.hidden).length <= 1) return notify('Não é possível excluir a única planilha visível.');
    App.ui.confirm('Excluir planilha', `Tem certeza de que deseja excluir "${doc.sheets[i].name}"? Você pode desfazer com Ctrl+Z.`, 'Excluir', () => {
      App.change('Excluir planilha', () => {
        doc.sheets.splice(i, 1);
        doc.active = Math.max(0, Math.min(doc.active >= i ? doc.active - 1 : doc.active, doc.sheets.length - 1));
        while (doc.sheets[doc.active].hidden) doc.active = (doc.active + 1) % doc.sheets.length;
      });
      App.emit('sheet');
    });
  });
  def('renameSheet', 'Renomear planilha', (idx) => App.emit('renameTab', idx === undefined ? doc.active : idx));
  def('hideSheet', 'Ocultar planilha', (idx) => {
    const i = idx === undefined ? doc.active : idx;
    if (doc.sheets.filter((s) => !s.hidden).length <= 1) return notify('Não é possível ocultar a única planilha visível.');
    App.change('Ocultar planilha', () => {
      doc.sheets[i].hidden = true;
      if (doc.active === i) { let k = i; do { k = (k + 1) % doc.sheets.length; } while (doc.sheets[k].hidden); doc.active = k; }
    });
    App.emit('sheet');
  });
  def('showSheet', 'Mostrar planilha', (i) => { App.change('Mostrar planilha', () => { doc.sheets[i].hidden = false; doc.active = i; }); App.emit('sheet'); });
  def('sheetColor', 'Cor da guia', (arg) => { const i = arg.i === undefined ? doc.active : arg.i; App.change('Cor da guia', () => { doc.sheets[i].color = arg.color || null; }); App.emit('sheet'); });
  def('moveSheet', 'Mover planilha', (arg) => {
    const i = arg.i === undefined ? doc.active : arg.i, j = arg.to;
    if (j < 0 || j >= doc.sheets.length || i === j) return;
    App.change('Mover planilha', () => { const [s] = doc.sheets.splice(i, 1); doc.sheets.splice(j, 0, s); doc.active = j; });
    App.emit('sheet');
  });
  def('switchSheet', 'Ir para planilha', (i) => {
    if (i < 0 || i >= doc.sheets.length || i === doc.active) return;
    doc.active = i; App.emit('sheet'); App.scheduleSave();
  });
  const visibleNeighbor = (dir) => { let k = doc.active; for (let n = 0; n < doc.sheets.length; n++) { k = (k + dir + doc.sheets.length) % doc.sheets.length; if (!doc.sheets[k].hidden) return k; } return doc.active; };
  def('nextSheet', 'Próxima planilha', () => App.run('switchSheet', visibleNeighbor(1)), 'Ctrl+PageDown');
  def('prevSheet', 'Planilha anterior', () => App.run('switchSheet', visibleNeighbor(-1)), 'Ctrl+PageUp');

  // ---------- Dados ----------
  def('sortSheet', 'Classificar página', (desc) => {
    const sh = App.sheet(), used = App.usedRange(sh);
    if (!used.maxR) return;
    const R = { r1: (sh.freeze.rows || 0) + 1, c1: 1, r2: used.maxR, c2: Math.max(used.maxC, 1) };
    App.change('Classificar página', () => App.sortRange(si(), R, [{ col: sel.ac, asc: !desc }], false));
  });
  def('sortRange', 'Classificar intervalo', (desc) => {
    const R = App.selRect();
    if (R.r1 === R.r2) return notify('Selecione pelo menos duas linhas para classificar.');
    App.change('Classificar intervalo', () => App.sortRange(si(), R, [{ col: Math.min(Math.max(sel.ac, R.c1), R.c2), asc: !desc }], false));
  });
  def('toggleFilter', 'Criar um filtro', () => {
    const sh = App.sheet();
    if (sh.filter) { App.change('Remover filtro', () => { sh.filter = null; }); return; }
    let R = App.selRect();
    if (R.r1 === R.r2 && R.c1 === R.c2) R = App.dataRegion(si(), sel.ar, sel.ac);
    if (R.r1 === 1 && R.r2 >= sh.rows) R = Object.assign({}, R, { r2: Math.max(2, App.usedRange(sh).maxR) });
    App.change('Criar filtro', () => { sh.filter = Object.assign({}, R, { crit: {} }); });
  });
  def('trimWhitespace', 'Cortar espaço em branco', () => {
    const sh = App.sheet(), R = App.selRect();
    let n = 0;
    App.change('Cortar espaço em branco', () => {
      for (const a of Object.keys(sh.cells)) {
        const p = E.parseAddr(a), x = sh.cells[a];
        if (!App.inRect(R, p.row, p.col) || typeof x.v !== 'string' || x.v[0] === '=') continue;
        const t = x.v.trim().replace(/[ \t]+/g, ' ');
        if (t !== x.v) { x.v = t; n++; App.cleanup(sh, a); }
      }
    });
    notify(n ? `${n} ${n === 1 ? 'célula foi ajustada' : 'células foram ajustadas'}.` : 'Nenhum espaço em branco extra encontrado.');
  });
  def('removeDuplicates', 'Remover cópias', () => App.panels.removeDuplicates());
  def('splitText', 'Dividir texto em colunas', () => App.panels.splitText());
  def('insertCheckbox', 'Caixa de seleção', () => {
    const sh = App.sheet(), R = App.selRect();
    App.change('Caixa de seleção', () => {
      sh.dv = sh.dv.filter((d) => !(d.range.r1 >= R.r1 && d.range.r2 <= R.r2 && d.range.c1 >= R.c1 && d.range.c2 <= R.c2));
      sh.dv.push({ id: App.uid(), range: Object.assign({}, R), type: 'checkbox' });
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
        const raw = App.raw(sh, r, c);
        if (!/^(TRUE|FALSE|VERDADEIRO|FALSO)$/i.test(raw)) App.setRaw(sh, r, c, 'FALSE');
      }
    });
  });
  def('insertDate', 'Inserir data atual', () => insertNow('date'), 'Ctrl+;');
  def('insertTime', 'Inserir hora atual', () => insertNow('time'), 'Ctrl+Shift+;');
  def('insertDateTime', 'Inserir data e hora atuais', () => insertNow('datetime'), 'Ctrl+Alt+Shift+;');
  function insertNow(kind) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`, time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const text = kind === 'date' ? date : kind === 'time' ? time : date + ' ' + time;
    if (App.editing()) { App.editor.insertText(text); return; }
    const sh = App.sheet();
    App.change('Inserir data', () => { App.setRaw(sh, sel.ar, sel.ac, text); App.setStyle(sh, sel.ar, sel.ac, (s) => { s.nf = App.autoFormatFor(text); }); });
  }
  def('autoSum', 'Soma automática', (fn) => {
    const name = fn || 'SOMA';
    const sh = App.sheet(), R = App.selRect();
    if (!App.selIsCell()) {
      App.change('Soma automática', () => { for (let c = R.c1; c <= R.c2; c++) App.setRaw(sh, R.r2 + 1, c, `=${name}(${App.rangeText({ r1: R.r1, c1: c, r2: R.r2, c2: c })})`); });
      App.grid.select(R.r2 + 1, R.c1);
      return;
    }
    // sugere o bloco de números acima ou à esquerda
    let top = sel.ar - 1;
    while (top >= 1 && typeof App.value(si(), top, sel.ac) === 'number') top--;
    let ref = '';
    if (top < sel.ar - 1) ref = App.rangeText({ r1: top + 1, c1: sel.ac, r2: sel.ar - 1, c2: sel.ac });
    else {
      let left = sel.ac - 1;
      while (left >= 1 && typeof App.value(si(), sel.ar, left) === 'number') left--;
      if (left < sel.ac - 1) ref = App.rangeText({ r1: sel.ar, c1: left + 1, r2: sel.ar, c2: sel.ac - 1 });
    }
    App.startEdit({ mode: 'enter', initial: `=${name}(${ref}` + (ref ? ')' : '') });
  });
  def('insertFunction', 'Inserir função', (name) => {
    if (App.editing()) { App.editor.insertText(name + '('); return; }
    App.startEdit({ mode: 'enter', initial: '=' + name + '(' });
  });
  def('fillDown', 'Preencher para baixo', () => {
    const R = App.selRect();
    if (R.r1 === R.r2) return;
    App.change('Preencher para baixo', () => App.fill(si(), { r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c2 }, R, 'down'));
  }, 'Ctrl+D');
  def('fillRight', 'Preencher para a direita', () => {
    const R = App.selRect();
    if (R.c1 === R.c2) return;
    App.change('Preencher para a direita', () => App.fill(si(), { r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c1 }, R, 'right'));
  }, 'Ctrl+R');
  def('selectAll', 'Selecionar tudo', () => {
    const sh = App.sheet(), R = App.selRect();
    const region = App.dataRegion(si(), sel.ar, sel.ac);
    const already = R.r1 === region.r1 && R.r2 === region.r2 && R.c1 === region.c1 && R.c2 === region.c2;
    if (!already && (region.r2 > region.r1 || region.c2 > region.c1)) App.grid.selectRange(region, { r: sel.ar, c: sel.ac });
    else App.grid.selectRange({ r1: 1, c1: 1, r2: sh.rows, c2: sh.cols });
  }, 'Ctrl+A');
  def('selectColumn', 'Selecionar coluna', () => { const R = App.selRect(); App.grid.selectCols(R.c1, R.c2); }, 'Ctrl+Space');
  def('selectRow', 'Selecionar linha', () => { const R = App.selRect(); App.grid.selectRows(R.r1, R.r2); }, 'Shift+Space');

  // ---------- Desfazer, área de transferência e pincel ----------
  def('undo', 'Desfazer', () => { if (App.editing()) App.cancelEdit(); App.undo(); }, 'Ctrl+Z');
  def('redo', 'Refazer', () => { if (App.editing()) App.cancelEdit(); App.redo(); }, 'Ctrl+Y');
  def('cut', 'Recortar', () => { if (!document.execCommand('cut')) notify('Use Ctrl+X para recortar.'); }, 'Ctrl+X');
  def('copy', 'Copiar', () => { if (!document.execCommand('copy')) notify('Use Ctrl+C para copiar.'); }, 'Ctrl+C');
  def('paste', 'Colar', () => pasteFromMenu('all'), 'Ctrl+V');
  def('pasteValues', 'Colar somente valores', () => pasteFromMenu('values'), 'Ctrl+Shift+V');
  def('pasteFormat', 'Colar somente a formatação', () => pasteFromMenu('format'), 'Ctrl+Alt+V');
  def('pasteFormula', 'Colar somente a fórmula', () => pasteFromMenu('formula'));
  def('pasteTranspose', 'Colar transposto', () => pasteFromMenu('all', true));
  def('paintFormat', 'Pintar formatação', () => {
    if (App.paint) { App.paint = null; App.emit('paint'); return; }
    App.paint = App.readBlock(si(), App.selRect());
    App.emit('paint');
    notify('Selecione as células que receberão a formatação.');
  });

  const clip = (App.clip = { block: null, text: null, cut: false });
  function blockToText(block) {
    return block.cells.map((row, i) => row.map((_, j) => {
      const r = block.R.r1 + i, c = block.R.c1 + j;
      const v = App.value(block.si, r, c);
      const t = App.fmtValue(v, App.style(doc.sheets[block.si], r, c).nf);
      return /[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }).join('\t')).join('\n');
  }
  function blockToHtml(block) {
    const sh = doc.sheets[block.si];
    const rows = block.cells.map((row, i) => '<tr>' + row.map((x, j) => {
      const r = block.R.r1 + i, c = block.R.c1 + j;
      const s = (x && x.s) || {};
      const css = [s.b ? 'font-weight:bold' : '', s.i ? 'font-style:italic' : '', s.u ? 'text-decoration:underline' : '', s.color ? 'color:' + s.color : '', s.bg ? 'background:' + s.bg : '', s.al ? 'text-align:' + { l: 'left', c: 'center', r: 'right' }[s.al] : ''].filter(Boolean).join(';');
      const t = App.fmtValue(App.value(block.si, r, c), s.nf);
      return `<td${css ? ` style="${css}"` : ''}>${App.esc(t)}</td>`;
    }).join('') + '</tr>').join('');
    return `<table data-planilhas="1">${rows}</table>`;
  }
  function doCopy(e, cut) {
    const R = App.selRect();
    const block = App.readBlock(si(), R);
    const text = blockToText(block);
    clip.block = block; clip.text = text; clip.cut = cut;
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', blockToHtml(block));
    e.preventDefault();
    App.grid.setMarquee({ si: si(), R });
  }
  function parseTsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"' && field === '') q = true;
      else if (ch === '\t') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function htmlToBlock(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const table = d.querySelector('table');
    if (!table) return null;
    const cells = [];
    for (const tr of table.querySelectorAll('tr')) {
      const row = [];
      for (const td of tr.querySelectorAll('td,th')) {
        const s = {};
        const st = td.getAttribute('style') || '';
        if (/font-weight:\s*(bold|[6-9]00)/i.test(st) || td.querySelector('b,strong') || td.tagName === 'TH') s.b = true;
        if (/font-style:\s*italic/i.test(st) || td.querySelector('i,em')) s.i = true;
        const bg = /background(?:-color)?:\s*(#[0-9a-f]{3,6}|rgb[^;]+)/i.exec(st); if (bg) s.bg = toHex(bg[1]);
        const co = /(?:^|;)\s*color:\s*(#[0-9a-f]{3,6}|rgb[^;]+)/i.exec(st); if (co) s.color = toHex(co[1]);
        row.push({ v: td.innerText !== undefined ? td.textContent.replace(/ /g, ' ').trim() : '', s: Object.keys(s).length ? s : undefined });
        const span = +td.getAttribute('colspan') || 1;
        for (let k = 1; k < span; k++) row.push(null);
      }
      cells.push(row);
    }
    const w = Math.max(...cells.map((r) => r.length));
    cells.forEach((r) => { while (r.length < w) r.push(null); });
    return cells.length && w ? cells : null;
  }
  function toHex(c) {
    if (c[0] === '#') return c.length === 4 ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c;
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c);
    return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : null;
  }
  function pasteBlock(block, mode, transpose, cut) {
    const sh = App.sheet(), R = App.selRect();
    let h = block.cells.length, w = block.cells[0].length;
    if (transpose) [h, w] = [w, h];
    // repete o bloco se a seleção for múltipla do tamanho copiado
    const selH = R.r2 - R.r1 + 1, selW = R.c2 - R.c1 + 1;
    const tileR = !cut && selH % h === 0 ? selH / h : 1, tileC = !cut && selW % w === 0 ? selW / w : 1;
    let out;
    App.change('Colar', () => {
      for (let i = 0; i < tileR; i++) for (let j = 0; j < tileC; j++) out = App.writeBlock(si(), R.r1 + i * h, R.c1 + j * w, block, mode, transpose, cut && i === 0 && j === 0);
    });
    App.grid.selectRange({ r1: R.r1, c1: R.c1, r2: R.r1 + h * tileR - 1, c2: R.c1 + w * tileC - 1 });
    void sh; void out;
  }
  function onPaste(e) {
    const mode = App._pasteMode || 'all';
    App._pasteMode = null;
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    e.preventDefault();
    if (clip.block && (text === clip.text || (html && html.includes('data-planilhas')))) {
      pasteBlock(clip.block, mode, App._pasteTranspose, clip.cut);
      if (clip.cut) { clip.block = null; App.grid.setMarquee(null); }
      App._pasteTranspose = false;
      return;
    }
    let cells = html ? htmlToBlock(html) : null;
    if (!cells) {
      const rows = parseTsv(text.replace(/\n$/, ''));
      if (!rows.length) return;
      const w = Math.max(...rows.map((r) => r.length));
      cells = rows.map((r) => { const out = r.map((v) => (v === '' ? null : { v })); while (out.length < w) out.push(null); return out; });
    }
    const block = { si: si(), R: { r1: 1, c1: 1, r2: cells.length, c2: cells[0].length }, cells, merges: [] };
    // valores colados de fora: aplica formatos automáticos (datas, %, R$)
    for (const row of cells) for (const x of row) if (x && x.v && !(x.s && x.s.nf)) { const f = App.autoFormatFor(x.v); if (f) x.s = Object.assign({}, x.s, { nf: f }); }
    pasteBlock(block, mode === 'values' ? 'formula' : mode, App._pasteTranspose, false);
    App._pasteTranspose = false;
  }
  function pasteFromMenu(mode, transpose) {
    if (clip.block) {
      pasteBlock(clip.block, mode, transpose, clip.cut);
      if (clip.cut) { clip.block = null; App.grid.setMarquee(null); }
      return;
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((text) => {
        const fake = { clipboardData: { getData: (t) => (t === 'text/plain' ? text : '') }, preventDefault() {} };
        App._pasteMode = mode; App._pasteTranspose = transpose;
        onPaste(fake);
      }).catch(() => notify('Use Ctrl+V para colar (o navegador bloqueou o acesso à área de transferência).'));
    } else notify('Use Ctrl+V para colar.');
  }

  // ---------- Caixas de seleção ----------
  App.toggleCheckboxes = (cells) => {
    const sh = App.sheet();
    const boxes = cells.filter(([r, c]) => { const d = App.dvAt(sh, r, c); return d && d.type === 'checkbox'; });
    if (!boxes.length) return false;
    const anyOff = boxes.some(([r, c]) => App.value(si(), r, c) !== true);
    App.change('Caixa de seleção', () => { for (const [r, c] of boxes) App.setRaw(sh, r, c, anyOff ? 'TRUE' : 'FALSE'); });
    return true;
  };

  // ---------- Movimento após confirmar a edição ----------
  App.moveAfterCommit = (r, c, dr, dc) => {
    sel.ar = sel.er = r; sel.ac = sel.ec = c;
    if (dc) {
      if (sel.tabOrigin == null) sel.tabOrigin = c;
      App.grid.moveCursor(0, dc, false);
    } else if (dr) {
      const col = sel.tabOrigin != null && dr > 0 ? sel.tabOrigin : c;
      sel.tabOrigin = null;
      sel.ac = sel.ec = col;
      App.grid.moveCursor(dr, 0, false);
    }
  };

  // ---------- Teclado ----------
  function key(e) {
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const sh = App.sheet();
    const combo = (ctrl ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (k.length === 1 ? k.toUpperCase() : k);
    const code = (ctrl ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code;
    const MAP = {
      'Ctrl+KeyZ': 'undo', 'Ctrl+KeyY': 'redo', 'Ctrl+Shift+KeyZ': 'redo',
      'Ctrl+KeyB': 'bold', 'Ctrl+KeyI': 'italic', 'Ctrl+KeyU': 'underline', 'Alt+Shift+Digit5': 'strike', 'Ctrl+Backslash': 'clearFormat',
      'Ctrl+Shift+KeyL': 'alignLeft', 'Ctrl+Shift+KeyE': 'alignCenter', 'Ctrl+Shift+KeyR': 'alignRight',
      'Ctrl+Shift+Digit1': 'fmt_number', 'Ctrl+Shift+Digit2': 'fmt_time', 'Ctrl+Shift+Digit3': 'fmt_date', 'Ctrl+Shift+Digit4': 'fmt_currency', 'Ctrl+Shift+Digit5': 'fmt_percent', 'Ctrl+Shift+Digit6': 'fmt_scientific',
      'Ctrl+Shift+Period': 'fontSizeInc', 'Ctrl+Shift+Comma': 'fontSizeDec',
      'Ctrl+KeyK': 'insertLink', 'Ctrl+Alt+KeyM': 'insertComment', 'Shift+F2': 'insertNote',
      'Ctrl+Semicolon': 'insertDate', 'Ctrl+Shift+Semicolon': 'insertTime', 'Ctrl+Alt+Shift+Semicolon': 'insertDateTime',
      'Ctrl+KeyD': 'fillDown', 'Ctrl+KeyR': 'fillRight', 'Ctrl+KeyA': 'selectAll', 'Ctrl+Space': 'selectColumn', 'Shift+Space': 'selectRow',
      'Ctrl+KeyF': 'find', 'Ctrl+KeyH': 'findReplace', 'Ctrl+Slash': 'shortcuts', 'Alt+Slash': 'menuSearch', 'Ctrl+KeyO': 'open', 'Ctrl+KeyP': 'print',
      'Ctrl+Backquote': 'toggleFormulas', 'Ctrl+Alt+Equal': 'insertSmart', 'Ctrl+Alt+Minus': 'deleteSmart',
      'Ctrl+Alt+Digit9': 'hideRows', 'Ctrl+Alt+Digit0': 'hideCols', 'Ctrl+Shift+Digit9': 'unhideRows', 'Ctrl+Shift+Digit0': 'unhideCols',
      'Shift+F11': 'newSheet', 'Ctrl+PageDown': 'nextSheet', 'Ctrl+PageUp': 'prevSheet', 'Alt+ArrowDown': 'nextSheet', 'Alt+ArrowUp': 'prevSheet',
      'Ctrl+Shift+KeyF': 'toggleMenus', 'Ctrl+Alt+KeyR': 'insertChart', 'Ctrl+Shift+Digit7': 'borderOuter',
    };
    if (MAP[code] && cmds[MAP[code]]) {
      e.preventDefault();
      if (MAP[code] === 'borderOuter') App.run('border', { type: 'outer' });
      else App.run(MAP[code]);
      return true;
    }
    if (code === 'Ctrl+KeyS') { e.preventDefault(); App.save(); notify('Todas as alterações foram salvas no navegador.'); return true; }
    if (code === 'Ctrl+Shift+KeyV') { App._pasteMode = 'values'; return false; }
    if (code === 'Ctrl+Alt+KeyV') { App._pasteMode = 'format'; return false; }
    switch (k) {
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault();
        sel.tabOrigin = null;
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
        App.grid.moveCursor(d[0], d[1], e.shiftKey, ctrl);
        return true;
      }
      case 'Home': e.preventDefault(); if (ctrl) App.grid.select(1, 1, e.shiftKey); else App.grid.select(sel.ar, 1, e.shiftKey); return true;
      case 'End': {
        e.preventDefault();
        const used = App.usedRange(sh);
        if (ctrl) App.grid.select(Math.max(1, used.maxR), Math.max(1, used.maxC), e.shiftKey);
        else { let c = sh.cols; while (c > 1 && App.raw(sh, sel.ar, c) === '') c--; App.grid.select(sel.ar, c, e.shiftKey); }
        return true;
      }
      case 'PageDown': case 'PageUp': {
        if (ctrl) return false;
        e.preventDefault();
        const n = App.grid.pageRows() * (k === 'PageDown' ? 1 : -1);
        App.grid.moveCursor(n, 0, e.shiftKey);
        return true;
      }
      case 'Tab': e.preventDefault(); if (sel.tabOrigin == null) sel.tabOrigin = sel.ac; App.grid.moveCursor(0, e.shiftKey ? -1 : 1, false); return true;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) { App.grid.moveCursor(-1, 0, false); return true; }
        if (sel.tabOrigin != null) { const col = sel.tabOrigin; sel.tabOrigin = null; App.grid.select(sel.ar, col); App.grid.moveCursor(1, 0, false); return true; }
        App.startEdit({ mode: 'edit' });
        return true;
      case 'F2': e.preventDefault(); App.startEdit({ mode: 'edit' }); return true;
      case 'Delete': case 'Backspace':
        e.preventDefault(); App.run('clearValues'); return true;
      case 'Escape':
        if (clip.block || App.gridState.marquee) { clip.block = null; App.grid.setMarquee(null); }
        if (App.paint) { App.paint = null; App.emit('paint'); }
        return true;
      case ' ':
        if (!ctrl && !e.shiftKey && !e.altKey) {
          const R = App.selRect(), list = [];
          for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) list.push([r, c]);
          if (App.toggleCheckboxes(list)) { e.preventDefault(); return true; }
        }
    }
    if (!ctrl && !e.altKey && k.length === 1) {
      e.preventDefault();
      App.startEdit({ mode: 'enter', initial: k });
      return true;
    }
    return false;
  }

  function init() {
    const focus = $('grid-focus');
    focus.addEventListener('keydown', key);
    focus.addEventListener('compositionstart', () => { if (!App.editing()) App.startEdit({ mode: 'enter', initial: '' }); });
    document.addEventListener('copy', (e) => { if (document.activeElement === focus && !App.editing()) doCopy(e, false); });
    document.addEventListener('cut', (e) => { if (document.activeElement === focus && !App.editing()) doCopy(e, true); });
    document.addEventListener('paste', (e) => { if (document.activeElement === focus && !App.editing()) onPaste(e); });
    // atalhos que valem mesmo fora da grade
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.target === focus) return;
      if (ctrl && e.code === 'KeyP') { e.preventDefault(); App.run('print'); }
      else if (ctrl && e.code === 'KeyS') { e.preventDefault(); App.save(); notify('Todas as alterações foram salvas no navegador.'); }
      else if (ctrl && (e.code === 'KeyF' || e.code === 'KeyH') && !App.editing() && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); App.run(e.code === 'KeyF' ? 'find' : 'findReplace'); }
      else if (e.altKey && e.code === 'Slash') { e.preventDefault(); App.run('menuSearch'); }
      else if (ctrl && e.code === 'Slash') { e.preventDefault(); App.run('shortcuts'); }
    });
    App.on('gridMouseDown', () => { sel.tabOrigin = null; if (App.paint) App._paintArmed = true; });
    window.addEventListener('mouseup', () => {
      if (!App._paintArmed || !App.paint) return;
      App._paintArmed = false;
      const block = App.paint, R = App.selRect();
      App.paint = null; App.emit('paint');
      const h = block.cells.length, w = block.cells[0].length;
      App.change('Pintar formatação', () => {
        const sh = App.sheet();
        for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
          const src = block.cells[(r - R.r1) % h][(c - R.c1) % w];
          App.setStyle(sh, r, c, (s) => { for (const k in s) delete s[k]; if (src && src.s) Object.assign(s, JSON.parse(JSON.stringify(src.s))); });
        }
      });
    });
  }
  App.commands = { init, forSel, def };
})(window.App);
