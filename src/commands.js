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
        for (let r = R.r1; r <= Math.min(R.r2, Math.max(used.maxR, R.r1)); r++) { const p = App.realCell(r, R.c1); if (p) rows.push(p.r); }
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
  def('renameCol', 'Renomear coluna', (col) => {
    const sh = App.sheet(), c = typeof col === 'number' ? col : App.selRect().c1;
    const cur = (sh.colNames && sh.colNames[c]) || '';
    App.ui.prompt(`Renomear coluna ${E.numToCol(c)}`, 'Nome da coluna (deixe vazio para voltar à letra)', cur, (v) => {
      const name = String(v || '').trim().slice(0, 60);
      if (name === cur) return;
      App.change('Renomear coluna', () => {
        const names = Object.assign({}, sh.colNames || {});
        if (name) names[c] = name; else delete names[c];
        if (Object.keys(names).length) sh.colNames = names; else delete sh.colNames;
      });
    }, 'Renomear');
  });
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
  // visualização reordenada: percorre as células da seleção na tela (já traduzidas para as reais)
  const viewCells = (sh, R, fn) => {
    const used = App.usedRange(sh);
    for (let r = R.r1; r <= Math.min(R.r2, (App.vm ? App.vm.nRows : sh.rows)); r++) {
      const p0 = App.realCell(r, R.c1);
      if (!p0 || p0.r > used.maxR) continue;
      for (let c = R.c1; c <= Math.min(R.c2, App.vm ? App.vm.nCols : sh.cols); c++) { const p = App.realCell(r, c); if (p) fn(p.r, p.c, E.addrToStr(p.r, p.c)); }
    }
  };
  def('clearValues', 'Excluir valores', () => {
    const sh = App.sheet(), R = App.selRect();
    if (App.vm) {
      App.change('Excluir valores', () => App.withReal(() => viewCells(sh, R, (r, c, a) => {
        if (!sh.cells[a]) return;
        const dv = App.dvAt(sh, r, c);
        sh.cells[a].v = dv && dv.type === 'checkbox' ? App.cbValues(dv).off : '';
        App.cleanup(sh, a);
      })));
      return;
    }
    App.change('Excluir valores', () => {
      for (const a of Object.keys(sh.cells)) {
        const p = E.parseAddr(a);
        if (App.inRect(R, p.row, p.col)) {
          const dv = App.dvAt(sh, p.row, p.col);
          sh.cells[a].v = dv && dv.type === 'checkbox' ? App.cbValues(dv).off : '';
          App.cleanup(sh, a);
        }
      }
    });
  }, 'Delete');
  def('clearAll', 'Limpar tudo (valores e formatação)', () => {
    const sh = App.sheet(), R = App.selRect();
    if (App.vm) { App.change('Limpar', () => viewCells(sh, R, (r, c, a) => { delete sh.cells[a]; })); return; }
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
  def('freezeCustom', 'Congelar (personalizado)', () => {
    const sh = App.sheet();
    App.ui.modal({
      title: 'Congelar linhas e colunas', width: '380px',
      body: `<p class="sp-hint">As linhas do topo e as colunas da esquerda ficam fixas ao rolar. Use 0 para descongelar.</p>
        <div class="field-row"><label class="field"><span>Linhas</span><input class="input" id="fz-r" type="number" min="0" max="${sh.rows}" value="${sh.freeze.rows || 0}"></label>
        <label class="field"><span>Colunas</span><input class="input" id="fz-c" type="number" min="0" max="${sh.cols}" value="${sh.freeze.cols || 0}"></label></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Congelar', primary: true, action: (d) => {
        const r = Math.max(0, Math.min(sh.rows - 1, parseInt(d.querySelector('#fz-r').value, 10) || 0));
        const c = Math.max(0, Math.min(sh.cols - 1, parseInt(d.querySelector('#fz-c').value, 10) || 0));
        App.change('Congelar', () => { sh.freeze = { rows: r, cols: c }; });
      } }],
    });
  });
  // Cabeçalho da coluna: nome, fundo, cor do texto e negrito (ex.: A → DATA, fundo preto e letra branca)
  def('colHeaderStyle', 'Personalizar cabeçalho da coluna', (col) => {
    const sh = App.sheet(), R = App.selRect();
    const c1 = typeof col === 'number' ? col : R.c1, c2 = typeof col === 'number' ? col : Math.min(R.c2, R.c1 + 200);
    const cur = (sh.colHdr && sh.colHdr[c1]) || {};
    const name = (sh.colNames && sh.colNames[c1]) || '';
    const label = c1 === c2 ? `coluna ${E.numToCol(c1)}` : `colunas ${E.numToCol(c1)} a ${E.numToCol(c2)}`;
    App.ui.modal({
      title: `Cabeçalho da ${label}`, width: '440px',
      body: `${c1 === c2 ? `<label class="field"><span>Nome (no lugar da letra ${E.numToCol(c1)})</span><input class="input" id="ch-name" value="${App.esc(name)}" placeholder="${E.numToCol(c1)}" maxlength="60"></label>` : ''}
        <div class="field-row"><label class="field"><span>Fundo</span><span class="inline"><input type="color" id="ch-bg" value="${cur.bg || '#000000'}"> <label class="check"><input type="checkbox" id="ch-bg-on"${cur.bg ? ' checked' : ''}> usar</label></span></label>
        <label class="field"><span>Cor do texto</span><span class="inline"><input type="color" id="ch-color" value="${cur.color || '#ffffff'}"> <label class="check"><input type="checkbox" id="ch-color-on"${cur.color ? ' checked' : ''}> usar</label></span></label></div>
        <label class="check"><input type="checkbox" id="ch-b"${cur.b ? ' checked' : ''}> Negrito</label>
        <div class="ch-preview" id="ch-prev"></div>
        <div class="ch-presets"><span class="sp-hint">Modelos:</span> <button class="btn btn-sm" data-p="#000000|#ffffff">Preto e branco</button> <button class="btn btn-sm" data-p="#e30613|#ffffff">Vermelho</button> <button class="btn btn-sm" data-p="#34a853|#ffffff">Verde</button> <button class="btn btn-sm" data-p="">Padrão</button></div>`,
      onOpen: (d) => {
        const prev = () => {
          const p = d.querySelector('#ch-prev');
          const bg = d.querySelector('#ch-bg-on').checked ? d.querySelector('#ch-bg').value : '#f6f6f6';
          const color = d.querySelector('#ch-color-on').checked ? d.querySelector('#ch-color').value : bg === '#f6f6f6' ? '#5a5a5a' : '#000000';
          const nm = d.querySelector('#ch-name') ? d.querySelector('#ch-name').value || E.numToCol(c1) : E.numToCol(c1);
          p.style.background = bg; p.style.color = color; p.style.fontWeight = d.querySelector('#ch-b').checked ? '700' : '400';
          p.textContent = nm;
        };
        d.querySelectorAll('input').forEach((x) => x.addEventListener('input', prev));
        d.querySelector('#ch-bg').addEventListener('input', () => { d.querySelector('#ch-bg-on').checked = true; prev(); });
        d.querySelector('#ch-color').addEventListener('input', () => { d.querySelector('#ch-color-on').checked = true; prev(); });
        d.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
          const [bg, fg] = b.dataset.p.split('|');
          d.querySelector('#ch-bg-on').checked = !!bg; d.querySelector('#ch-color-on').checked = !!fg; d.querySelector('#ch-b').checked = !!bg;
          if (bg) d.querySelector('#ch-bg').value = bg;
          if (fg) d.querySelector('#ch-color').value = fg;
          prev();
        }));
        prev();
      },
      buttons: [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, action: (d) => {
        const st = {};
        if (d.querySelector('#ch-bg-on').checked) st.bg = d.querySelector('#ch-bg').value;
        if (d.querySelector('#ch-color-on').checked) st.color = d.querySelector('#ch-color').value;
        if (d.querySelector('#ch-b').checked) st.b = true;
        const newName = d.querySelector('#ch-name') ? d.querySelector('#ch-name').value.trim().slice(0, 60) : null;
        App.change('Cabeçalho da coluna', () => {
          const all = Object.assign({}, sh.colHdr || {});
          for (let c = c1; c <= c2; c++) { if (Object.keys(st).length) all[c] = Object.assign({}, st); else delete all[c]; }
          if (Object.keys(all).length) sh.colHdr = all; else delete sh.colHdr;
          if (newName !== null && newName !== name) {
            const nm = Object.assign({}, sh.colNames || {});
            if (newName) nm[c1] = newName; else delete nm[c1];
            if (Object.keys(nm).length) sh.colNames = nm; else delete sh.colNames;
          }
        });
      } }],
    });
  });
  // Grupos de colunas (ex.: Entrega 1, Entrega 2): ficam recolhidos com + para todos; abrir vale só para quem clicou
  def('groupCols', 'Agrupar colunas', () => {
    const sh = App.sheet(), R = App.selRect();
    const label0 = (sh.colNames && sh.colNames[R.c1]) || '';
    App.ui.prompt(`Agrupar colunas ${E.numToCol(R.c1)} a ${E.numToCol(R.c2)}`, 'Nome do grupo (ex.: Entrega 1)', label0, (v) => {
      App.change('Agrupar colunas', () => {
        const list = (sh.colGroups || []).filter((g) => g.c2 < R.c1 || g.c1 > R.c2);
        list.push({ id: App.uid(), c1: R.c1, c2: R.c2, label: String(v || '').trim().slice(0, 40) });
        list.sort((a, b) => a.c1 - b.c1);
        sh.colGroups = list;
      });
      notify('Grupo criado. Ele aparece recolhido (+) para todos; quem clicar abre só para si.');
    }, 'Agrupar');
  });
  def('ungroupCols', 'Desagrupar colunas', () => {
    const sh = App.sheet(), R = App.selRect();
    if (!(sh.colGroups || []).some((g) => !(g.c2 < R.c1 || g.c1 > R.c2))) return notify('Não há grupo nas colunas selecionadas.');
    App.change('Desagrupar colunas', () => {
      const list = sh.colGroups.filter((g) => g.c2 < R.c1 || g.c1 > R.c2);
      if (list.length) sh.colGroups = list; else delete sh.colGroups;
    });
  });
  // Ocultar linhas com +: datas antigas, acima de uma linha e/ou valores de uma coluna (ex.: status FINALIZADO).
  // Ficam recolhidas para todos; o botão + mostra as linhas só para quem clicou.
  def('recentRows', 'Ocultar linhas (com +)', () => {
    const sh = App.sheet(), used = App.usedRange(sh), si = App.sheetIndex(sh);
    const cur = App.foldRules(sh) || {};
    const head = (c) => { const n = sh.colNames && sh.colNames[c]; if (n) return n; const v = App.value(si, 1, c); return v === null || v === undefined ? '' : String(App.fmtValue(v, App.style(sh, 1, c).nf)); };
    const colOpts = (sel) => { let o = ''; for (let c = 1; c <= Math.max(1, used.maxC); c++) o += `<option value="${c}"${sel === c ? ' selected' : ''}>${E.numToCol(c)}${head(c) ? ' · ' + App.esc(String(head(c)).slice(0, 30)) : ''}</option>`; return o; };
    const distinct = (c) => { const m = new Map(); for (let r = 2; r <= used.maxR; r++) { const t = String(App.fmtValue(App.value(si, r, c), App.style(sh, r, c).nf)).trim(); if (t) m.set(t, (m.get(t) || 0) + 1); } return [...m.keys()].sort((x, y) => x.localeCompare(y, 'pt-BR')); };
    const m = App.ui.modal({
      title: 'Ocultar linhas (com +)', width: '520px', enterSubmits: false,
      body: `<p class="sp-hint">As linhas que atenderem a qualquer regra marcada ficam recolhidas para todos. Um botão <b>+</b> mostra essas linhas, e abrir vale só para quem clicou.</p>
        <div class="fold-rule"><label class="check"><input type="checkbox" id="fd-days-on"${cur.days ? ' checked' : ''}> Datas com mais de</label>
          <input class="input fd-n" id="fd-days" type="number" min="1" max="3650" value="${(cur.days && cur.days.n) || 30}"> dias na coluna <select class="input" id="fd-days-col">${colOpts((cur.days && cur.days.col) || App.sel.ac)}</select></div>
        <div class="fold-rule"><label class="check"><input type="checkbox" id="fd-above-on"${cur.above ? ' checked' : ''}> Linhas acima da linha</label>
          <input class="input fd-n" id="fd-above" type="number" min="2" value="${cur.above || App.sel.ar}"><span class="sp-hint">(as linhas congeladas continuam visíveis)</span></div>
        <div class="fold-rule"><label class="check"><input type="checkbox" id="fd-val-on"${cur.values ? ' checked' : ''}> Linhas em que a coluna</label>
          <select class="input" id="fd-val-col">${colOpts((cur.values && cur.values.col) || App.sel.ac)}</select> for:</div>
        <div class="fd-vals" id="fd-vals"></div>`,
      buttons: [
        ...(App.foldRules(sh) ? [{ label: 'Desativar tudo', action: () => { App.change('Ocultar linhas', () => { delete sh.fold; delete sh.recent; }); } }] : []),
        { label: 'Cancelar' },
        { label: 'Aplicar', primary: true, action: (d) => {
          const rule = {};
          if (d.querySelector('#fd-days-on').checked) rule.days = { col: +d.querySelector('#fd-days-col').value, n: Math.max(1, parseInt(d.querySelector('#fd-days').value, 10) || 30) };
          if (d.querySelector('#fd-above-on').checked) rule.above = Math.max(2, parseInt(d.querySelector('#fd-above').value, 10) || 2);
          const list = [...d.querySelectorAll('#fd-vals input:checked')].map((x) => x.value);
          if (d.querySelector('#fd-val-on').checked && list.length) rule.values = { col: +d.querySelector('#fd-val-col').value, list };
          App.change('Ocultar linhas', () => { delete sh.recent; if (Object.keys(rule).length) sh.fold = rule; else delete sh.fold; });
        } },
      ],
    });
    const drawVals = () => {
      const c = +m.el.querySelector('#fd-val-col').value;
      const chosen = new Set(cur.values && cur.values.col === c ? cur.values.list : []);
      const vals = distinct(c);
      m.el.querySelector('#fd-vals').innerHTML = vals.length ? vals.slice(0, 200).map((v) => `<label class="check"><input type="checkbox" value="${App.esc(v)}"${chosen.has(v) ? ' checked' : ''}> ${App.esc(v)}</label>`).join('') : '<span class="sp-hint">Coluna sem valores.</span>';
      m.el.querySelectorAll('#fd-vals input').forEach((x) => (x.onchange = () => { if (x.checked) m.el.querySelector('#fd-val-on').checked = true; }));
    };
    m.el.querySelector('#fd-val-col').onchange = drawVals;
    drawVals();
  });
  def('toggleOldRows', 'Mostrar/ocultar linhas antigas', () => App.toggleOld(App.sheet()));
  // Container crítico (coluna T por padrão): a célula fica piscando como alerta. Funciona em lote (várias linhas).
  def('markCritical', 'Marcar container como crítico', (on) => {
    const sh = App.sheet(), R = App.selRect(), col = sh.critCol || 20;
    const rows = [];
    const real = (r) => { const p = App.realCell ? App.realCell(r, 1) : { r }; return p ? { r: p.r, c: col } : null; };
    for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 5000); r++) { const p = real(r); if (p && !App.isRowHidden(sh, p.r)) rows.push(r); }
    const isOn = (r) => { const p = real(r); const x = p && sh.cells[E.addrToStr(p.r, p.c)]; return !!(x && x.crit); };
    const mark = typeof on === 'boolean' ? on : !rows.every(isOn);
    App.change(mark ? 'Marcar como crítico' : 'Remover alerta de crítico', () => {
      for (const r of rows) {
        const p = real(r); if (!p) continue;
        const a = E.addrToStr(p.r, p.c);
        if (mark) { sh.cells[a] = sh.cells[a] || { v: '' }; sh.cells[a].crit = true; } else if (sh.cells[a]) { delete sh.cells[a].crit; App.cleanup(sh, a); }
      }
    });
    notify(mark ? `${rows.length} ${rows.length === 1 ? 'container marcado' : 'containers marcados'} como crítico (coluna ${E.numToCol(col)}).` : 'Alerta de crítico removido.');
  });
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
  // Filtro a partir da coluna: o botão fica no cabeçalho (A, B, C… ou o nome da coluna) e filtra desde a linha 1
  def('filterFromColumn', 'Criar um filtro a partir da coluna', (col) => {
    const sh = App.sheet(), R = App.selRect();
    const c1 = typeof col === 'number' ? col : R.c1, c2 = typeof col === 'number' ? col : R.c2;
    const f = sh.filter;
    if (f && f.r1 === 0) {
      if (c1 >= f.c1 && c2 <= f.c2) { App.change('Remover filtro', () => { sh.filter = null; }); return; }
      App.change('Filtro', () => { sh.filter = Object.assign({}, f, { c1: Math.min(f.c1, c1), c2: Math.max(f.c2, c2), r2: sh.rows }); });
      return;
    }
    App.change('Criar filtro', () => { sh.filter = { r1: 0, c1, c2, r2: sh.rows, crit: {} }; });
  });
  def('toggleFilter', 'Criar um filtro', () => {
    const sh = App.sheet();
    if (sh.filter) { App.change('Remover filtro', () => { sh.filter = null; }); return; }
    let R = App.selRect();
    // coluna inteira selecionada: filtro a partir da coluna
    if (R.r1 === 1 && R.r2 >= sh.rows && !(R.c1 === 1 && R.c2 >= sh.cols)) { App.run('filterFromColumn'); return; }
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
  // Ctrl+D: com uma linha selecionada, copia a célula de cima (não precisa selecionar a informação de origem)
  def('fillDown', 'Preencher para baixo', () => {
    const R = App.selRect();
    if (R.r1 === R.r2) {
      if (R.r1 <= 1) return;
      App.change('Preencher para baixo', () => App.fill(si(), { r1: R.r1 - 1, c1: R.c1, r2: R.r1 - 1, c2: R.c2 }, Object.assign({}, R, { r1: R.r1 - 1 }), 'down', true));
      return;
    }
    App.change('Preencher para baixo', () => App.fill(si(), { r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c2 }, R, 'down', true));
  }, 'Ctrl+D');
  def('fillRight', 'Preencher para a direita', () => {
    const R = App.selRect();
    if (R.c1 === R.c2) {
      if (R.c1 <= 1) return;
      App.change('Preencher para a direita', () => App.fill(si(), { r1: R.r1, c1: R.c1 - 1, r2: R.r2, c2: R.c1 - 1 }, Object.assign({}, R, { c1: R.c1 - 1 }), 'right', true));
      return;
    }
    App.change('Preencher para a direita', () => App.fill(si(), { r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c1 }, R, 'right', true));
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
    const isOn = ([r, c]) => App.cbIsOn(App.dvAt(sh, r, c), App.raw(sh, r, c), App.value(si(), r, c));
    const anyOff = boxes.some((b) => !isOn(b));
    const apply = () => App.change('Caixa de seleção', () => {
      for (const [r, c] of boxes) { const v = App.cbValues(App.dvAt(sh, r, c)); App.setRaw(sh, r, c, anyOff ? v.on : v.off); }
    });
    // pede confirmação antes de alterar (pode ser desligado na regra de validação)
    const ask = boxes.some(([r, c]) => App.dvAt(sh, r, c).confirm !== false);
    if (!ask) { apply(); return true; }
    const where = boxes.length === 1 ? E.addrToStr(boxes[0][0], boxes[0][1]) : `${boxes.length} células`;
    const first = App.cbValues(App.dvAt(sh, boxes[0][0], boxes[0][1]));
    const to = anyOff ? first.on : first.off;
    const label = to === 'TRUE' ? 'marcar' : to === 'FALSE' ? 'desmarcar' : `mudar para "${to || '(vazio)'}"`;
    App.ui.confirm('Confirmar alteração', `Deseja ${label} a caixa de seleção em ${where}?`, 'Confirmar', apply);
    return true;
  };
  // Remove as caixas de seleção da seleção (administradores)
  def('removeCheckbox', 'Remover caixa de seleção', () => {
    const sh = App.sheet(), R = App.selRect();
    const minus = (A, B) => {
      // partes de A fora de B
      if (B.r2 < A.r1 || B.r1 > A.r2 || B.c2 < A.c1 || B.c1 > A.c2) return [A];
      const out = [];
      if (A.r1 < B.r1) out.push({ r1: A.r1, c1: A.c1, r2: B.r1 - 1, c2: A.c2 });
      if (A.r2 > B.r2) out.push({ r1: B.r2 + 1, c1: A.c1, r2: A.r2, c2: A.c2 });
      const r1 = Math.max(A.r1, B.r1), r2 = Math.min(A.r2, B.r2);
      if (A.c1 < B.c1) out.push({ r1, c1: A.c1, r2, c2: B.c1 - 1 });
      if (A.c2 > B.c2) out.push({ r1, c1: B.c2 + 1, r2, c2: A.c2 });
      return out;
    };
    if (!sh.dv.some((d) => d.type === 'checkbox' && minus(d.range, R).length !== 1)) { notify('Não há caixas de seleção nas células selecionadas.'); return; }
    App.ui.confirm('Remover caixa de seleção?', 'As caixas de seleção das células selecionadas serão removidas, junto com os valores marcados/desmarcados.', 'Remover', () => {
      App.change('Remover caixa de seleção', () => {
        const next = [];
        for (const d of sh.dv) {
          if (d.type !== 'checkbox') { next.push(d); continue; }
          for (let r = Math.max(R.r1, d.range.r1); r <= Math.min(R.r2, d.range.r2); r++) for (let c = Math.max(R.c1, d.range.c1); c <= Math.min(R.c2, d.range.c2); c++) {
            if (App.cbValid(d, App.raw(sh, r, c))) App.setRaw(sh, r, c, '');
          }
          minus(d.range, R).forEach((part, i) => next.push(Object.assign({}, d, { id: i ? App.uid() : d.id, range: part })));
        }
        sh.dv = next;
      });
    });
  });

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
    // Alt+/ (pesquisar nos menus): no teclado brasileiro (ABNT2) a barra fica na tecla IntlRo ou no teclado numérico
    const slash = e.key === '/' || e.key === '?' || e.code === 'Slash' || e.code === 'IntlRo' || e.code === 'NumpadDivide';
    if (e.altKey && !ctrl && slash) { e.preventDefault(); App.run('menuSearch'); return; }
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
      else if (e.altKey && !ctrl && (e.key === '/' || e.key === '?' || e.code === 'Slash' || e.code === 'IntlRo' || e.code === 'NumpadDivide')) { e.preventDefault(); App.run('menuSearch'); }
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
