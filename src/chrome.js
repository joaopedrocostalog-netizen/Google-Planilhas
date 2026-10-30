// Interface: barra de menus, barra de ferramentas, menus suspensos, paleta de cores,
// caixa de nome, busca nos menus e resumo da seleção.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const sel = App.sel;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const run = (id, arg) => App.run(id, arg);

  // ---------- Ícones (desenhos próprios, traço 24x24) ----------
  const P = (d, extra) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}/>`;
  const ICONS = {
    search: P('M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5'),
    undo: P('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
    redo: P('m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
    print: P('M7 8V3.5h10V8M6.5 17H4.5v-7.5h15V17h-2M7 13.5h10V20.5H7z'),
    paint: P('M5 4h11v4H5zM16 6h3v5h-7v3M11 14h2v6h-2z'),
    bold: '<text x="12" y="18" text-anchor="middle" font-size="18" font-weight="700" font-family="Arial" fill="currentColor">B</text>',
    italic: '<text x="12" y="18" text-anchor="middle" font-size="18" font-style="italic" font-family="Georgia, serif" fill="currentColor">I</text>',
    strike: '<text x="12" y="18" text-anchor="middle" font-size="17" font-family="Arial" fill="currentColor">S</text>' + P('M5 12h14'),
    textColor: '<text x="12" y="16" text-anchor="middle" font-size="17" font-weight="600" font-family="Arial" fill="currentColor">A</text>',
    fill: P('m5.5 11.5 6-6 6 6-6 6zM11.5 5.5 9 3M19 14s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z'),
    borders: P('M4 4h16v16H4zM4 12h16M12 4v16', 'stroke-dasharray="0"'),
    merge: P('M4 6v12M20 6v12M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3'),
    alignLeft: P('M4 6h16M4 10h10M4 14h16M4 18h10'),
    alignCenter: P('M4 6h16M7 10h10M4 14h16M7 18h10'),
    alignRight: P('M4 6h16M10 10h10M4 14h16M10 18h10'),
    valignTop: P('M4 4h16M12 20V8M8 12l4-4 4 4'),
    valignMiddle: P('M4 12h16M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3'),
    valignBottom: P('M4 20h16M12 4v12M8 12l4 4 4-4'),
    wrap: P('M4 6h16M4 12h12.5a3 3 0 0 1 0 6H12M14 15.5 11.5 18l2.5 2.5M4 18h4'),
    overflow: P('M4 12h16M17 9l3 3-3 3M4 5v14'),
    clip: P('M4 12h11M15 5v14M4 5v14'),
    rotate: '<text x="9" y="17" font-size="12" font-family="Arial" fill="currentColor" transform="rotate(-35 12 12)">ab</text>' + P('M18 6l2 2-2 2'),
    link: P('M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.8M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66L12.5 17.2'),
    comment: P('M4.5 5h15v11h-9l-4.5 3.5V16h-1.5z'),
    chart: P('M5 20V11M10 20V5M15 20v-6M20 20V9M3 20.5h18'),
    filter: P('M4 5h16l-6 7.5V19l-4 1.5v-8z'),
    sigma: '<text x="12" y="18" text-anchor="middle" font-size="19" font-family="Arial" fill="currentColor">Σ</text>',
    chevDown: P('m7 10 5 5 5-5'),
    chevUp: P('m7 14 5-5 5 5'),
    plus: P('M12 5v14M5 12h14'),
    menu: P('M4 7h16M4 12h16M4 17h16'),
    close: P('M6 6l12 12M18 6 6 18'),
    check: P('m5 12 4.5 4.5L19 7'),
    more: '<circle cx="12" cy="5.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor"/>',
    note: P('M5 4h14v11l-5 5H5zM14 20v-5h5'),
    lock: P('M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z'),
    history: P('M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 7.5V12l3 2'),
    star: P('m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z'),
    cloud: P('M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z'),
    checkbox: P('M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5'),
    dropdown: P('M4 7h16v10H4zM14 11l2 2 2-2'),
    function: '<text x="12" y="17" text-anchor="middle" font-size="14" font-style="italic" font-family="Georgia, serif" fill="currentColor">fx</text>',
    sheetIcon: '<rect x="3" y="3" width="18" height="18" rx="3" fill="#e30613"/>' + '<path d="M7 8h10M7 12h10M7 16h10M11 8v8" stroke="#fff" stroke-width="1.8" fill="none"/>',
  };
  const icon = (name, size) => `<svg class="ic" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  App.icon = icon;

  // ---------- Popups genéricos ----------
  let openPop = null;
  function closePopup() {
    if (openPop) { openPop.el.remove(); if (openPop.anchor) openPop.anchor.classList.remove('open'); if (openPop.onClose) openPop.onClose(); openPop = null; }
  }
  // Abre um popup ancorado a um elemento (ou coordenadas {x,y})
  function popup(anchor, content, opts) {
    closePopup();
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'popup ' + (opts.cls || '');
    if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
    document.body.appendChild(el);
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      anchor.classList.add('open');
      x = opts.right ? r.right - el.offsetWidth : r.left;
      y = opts.above ? r.top - el.offsetHeight - 4 : r.bottom + 4;
    } else { x = anchor.x; y = anchor.y; }
    x = Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4));
    if (y + el.offsetHeight > window.innerHeight - 4) y = Math.max(4, (anchor instanceof Element ? anchor.getBoundingClientRect().top : y) - el.offsetHeight - 4);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    openPop = { el, anchor: anchor instanceof Element ? anchor : null, onClose: opts.onClose };
    return el;
  }
  document.addEventListener('mousedown', (e) => {
    if (openPop && !openPop.el.contains(e.target) && !(openPop.anchor && openPop.anchor.contains(e.target))) closePopup();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPop) { closePopup(); App.grid.focus(); } });

  // Menu (lista com submenus) a partir de uma especificação
  // item: { label, cmd, arg, sc, action, sub, check, disabled, icon } | '-'
  function buildMenu(items, onDone) {
    const ul = document.createElement('div');
    ul.className = 'menu';
    for (const it of items) {
      if (it === '-') { ul.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
      if (!it) continue;
      if (it.header) { ul.insertAdjacentHTML('beforeend', `<div class="menu-header">${esc(it.header)}</div>`); continue; }
      const row = document.createElement('div');
      const disabled = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
      const checked = typeof it.check === 'function' ? it.check() : it.check;
      const label = typeof it.label === 'function' ? it.label() : it.label || (App.cmds[it.cmd] && App.cmds[it.cmd].label) || it.cmd;
      const sc = it.sc !== undefined ? it.sc : it.cmd && App.cmds[it.cmd] ? App.cmds[it.cmd].sc : '';
      row.className = 'menu-item' + (disabled ? ' disabled' : '') + (it.sub ? ' has-sub' : '');
      row.innerHTML = `<span class="mi-check">${checked ? icon('check', 16) : it.icon ? icon(it.icon, 16) : ''}</span><span class="mi-label">${esc(label)}</span>` +
        (it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : '') +
        (sc ? `<span class="mi-sc">${esc(sc)}</span>` : '') + (it.sub ? `<span class="mi-arrow">›</span>` : '');
      if (it.swatch) row.querySelector('.mi-check').innerHTML = `<i class="swatch-dot" style="background:${it.swatch}"></i>`;
      if (it.sub && !disabled) {
        let subEl = null;
        const open = () => {
          if (subEl) return;
          ul.querySelectorAll(':scope > .menu-item.sub-open').forEach((x) => x !== row && x.dispatchEvent(new Event('closesub')));
          const subItems = typeof it.sub === 'function' ? it.sub() : it.sub;
          subEl = buildMenu(subItems, onDone);
          subEl.classList.add('submenu');
          document.body.appendChild(subEl);
          const r = row.getBoundingClientRect();
          let x = r.right - 2, y = r.top - 6;
          if (x + subEl.offsetWidth > window.innerWidth - 4) x = r.left - subEl.offsetWidth + 2;
          if (y + subEl.offsetHeight > window.innerHeight - 4) y = Math.max(4, window.innerHeight - subEl.offsetHeight - 4);
          subEl.style.left = x + 'px'; subEl.style.top = y + 'px';
          row.classList.add('sub-open');
          if (openPop) { const prev = openPop.onClose; openPop.onClose = () => { if (subEl) subEl.remove(); if (prev) prev(); }; }
        };
        const close = () => { if (subEl) { subEl.querySelectorAll('.sub-open').forEach((x) => x.dispatchEvent(new Event('closesub'))); subEl.remove(); subEl = null; row.classList.remove('sub-open'); } };
        row.addEventListener('mouseenter', open);
        row.addEventListener('click', open);
        row.addEventListener('closesub', close);
      } else if (!disabled) {
        row.addEventListener('mouseenter', () => ul.querySelectorAll(':scope > .menu-item.sub-open').forEach((x) => x.dispatchEvent(new Event('closesub'))));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.submenu').forEach((s) => s.remove());
          closePopup();
          if (onDone) onDone();
          if (it.action) it.action(); else if (it.cmd) run(it.cmd, it.arg);
        });
      }
      ul.appendChild(row);
    }
    return ul;
  }
  function menuPopup(anchor, items, opts) {
    const el = popup(anchor, buildMenu(items), Object.assign({ cls: 'menu-pop' }, opts || {}));
    const prev = openPop.onClose;
    openPop.onClose = () => { document.querySelectorAll('.submenu').forEach((s) => s.remove()); if (prev) prev(); };
    return el;
  }

  // ---------- Paleta de cores ----------
  const GRAYS = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'];
  const HUES = ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'];
  const BRAND = ['#e30613', '#b8000c', '#0d0d0d', '#ffffff'];
  function palette(onPick, current, resetLabel) {
    const box = document.createElement('div');
    box.className = 'palette';
    const sw = (c) => `<button class="sw${current && current.toLowerCase() === c ? ' on' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`;
    const tints = [0.8, 0.6, 0.4].map((t) => HUES.map((h) => App.mixColor(h, '#ffffff', t)))
      .concat([0.25, 0.5].map((t) => HUES.map((h) => App.mixColor(h, '#000000', t))));
    box.innerHTML = `<button class="pal-reset" data-c="">${icon('close', 14)} ${esc(resetLabel || 'Redefinir')}</button>` +
      `<div class="pal-row">${GRAYS.map(sw).join('')}</div><div class="pal-row">${HUES.map(sw).join('')}</div>` +
      tints.map((row) => `<div class="pal-row">${row.map(sw).join('')}</div>`).join('') +
      `<div class="pal-label">MARCA</div><div class="pal-row">${BRAND.map(sw).join('')}</div>` +
      `<label class="pal-custom">${icon('plus', 14)} Personalizado <input type="color" value="${current || '#e30613'}"></label>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      closePopup(); onPick(b.dataset.c || null);
    });
    box.querySelector('input[type=color]').addEventListener('change', (e) => { closePopup(); onPick(e.target.value); });
    return box;
  }
  App.palette = palette;

  // ---------- Barra de menus ----------
  const R = () => App.selRect();
  const nRows = () => { const x = R(); return x.r2 - x.r1 + 1; };
  const nCols = () => { const x = R(); return x.c2 - x.c1 + 1; };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const fnCats = () => {
    const cats = {};
    for (const f of E.INFO) (cats[f.cat || 'Outras'] = cats[f.cat || 'Outras'] || []).push(f);
    return Object.keys(cats).sort().map((c) => ({ label: c, sub: () => cats[c].slice().sort((a, b) => a.pt.localeCompare(b.pt)).map((f) => ({ label: f.pt, action: () => run('insertFunction', f.pt) })) }));
  };
  const fmtItems = () => [
    { label: 'Automático', cmd: 'format', arg: 'auto', check: () => !App.style(App.sheet(), sel.ar, sel.ac).nf },
    { label: 'Texto simples', cmd: 'format', arg: 'text' }, '-',
    ...['number', 'percent', 'scientific'].map((k) => ({ label: App.FORMATS[k].label, hint: App.FORMATS[k].ex, cmd: 'format', arg: k })), '-',
    ...['accounting', 'financial', 'currency', 'currency0'].map((k) => ({ label: App.FORMATS[k].label, hint: App.FORMATS[k].ex, cmd: 'format', arg: k })), '-',
    ...['date', 'time', 'datetime', 'duration'].map((k) => ({ label: App.FORMATS[k].label, hint: App.FORMATS[k].ex, cmd: 'format', arg: k })), '-',
    { label: 'Formato de número personalizado', cmd: 'customFormat' },
  ];
  const sheetFrozen = () => App.sheet().freeze;
  const MENUS = [
    { label: 'Arquivo', items: () => [
      { label: 'Novo', icon: 'sheetIcon', sub: [{ label: 'Planilha', cmd: 'newDoc' }] },
      { label: 'Abrir', cmd: 'open', sc: 'Ctrl+O' },
      { label: 'Importar', cmd: 'importFile' },
      { label: 'Fazer uma cópia', cmd: 'makeCopy' }, '-',
      { label: 'Compartilhar', icon: 'lock', cmd: 'share' },
      { label: 'Fazer download', sub: [
        { label: 'Microsoft Excel (.xlsx)', cmd: 'download', arg: 'xlsx' },
        { label: 'PDF (.pdf)', cmd: 'print' },
        { label: 'Página da Web (.html)', cmd: 'download', arg: 'html' },
        { label: 'Valores separados por vírgula (.csv)', cmd: 'download', arg: 'csv' },
        { label: 'Valores separados por tabulação (.tsv)', cmd: 'download', arg: 'tsv' },
        { label: 'Backup do Planilhas (.json)', cmd: 'download', arg: 'json' },
      ] }, '-',
      { label: 'Renomear', cmd: 'renameDoc' },
      { label: 'Histórico de versões', icon: 'history', sub: [{ label: 'Nomear versão atual', cmd: 'nameVersion' }, { label: 'Ver histórico de versões', cmd: 'versionHistory' }] }, '-',
      { label: 'Imprimir', icon: 'print', cmd: 'print' },
    ] },
    { label: 'Editar', items: () => [
      { label: 'Desfazer', icon: 'undo', cmd: 'undo', disabled: () => !App.canUndo() },
      { label: 'Refazer', icon: 'redo', cmd: 'redo', disabled: () => !App.canRedo() }, '-',
      { cmd: 'cut' }, { cmd: 'copy' }, { cmd: 'paste' },
      { label: 'Colar especial', sub: [{ label: 'Somente valores', cmd: 'pasteValues' }, { label: 'Somente a formatação', cmd: 'pasteFormat' }, { label: 'Somente a fórmula', cmd: 'pasteFormula' }, { label: 'Transposto', cmd: 'pasteTranspose' }] }, '-',
      { label: 'Excluir', sub: () => [
        { label: 'Valores', cmd: 'clearValues' },
        { label: `${nRows() === 1 ? 'Linha' : 'Linhas'} ${R().r1}${nRows() > 1 ? ' - ' + R().r2 : ''}`, cmd: 'deleteRows' },
        { label: `${nCols() === 1 ? 'Coluna' : 'Colunas'} ${E.numToCol(R().c1)}${nCols() > 1 ? ' - ' + E.numToCol(R().c2) : ''}`, cmd: 'deleteCols' },
        { label: 'Notas', cmd: 'clearNotes' },
        { label: 'Tudo (valores e formatação)', cmd: 'clearAll' },
      ] }, '-',
      { label: 'Localizar e substituir', icon: 'search', cmd: 'findReplace', sc: 'Ctrl+H' },
    ] },
    { label: 'Ver', items: () => [
      { label: 'Mostrar', sub: () => [
        { label: 'Barra de fórmulas', cmd: 'toggleFormulaBar', check: () => !document.body.classList.contains('no-formula-bar') },
        { label: 'Linhas de grade', cmd: 'toggleGridlines', check: () => doc.showGrid },
        { label: 'Fórmulas', cmd: 'toggleFormulas', check: () => doc.showFormulas },
      ] },
      { label: 'Congelar', sub: () => [
        { label: 'Nenhuma linha', cmd: 'freezeRows', arg: 0, check: () => !sheetFrozen().rows },
        { label: '1 linha', cmd: 'freezeRows', arg: 1, check: () => sheetFrozen().rows === 1 },
        { label: '2 linhas', cmd: 'freezeRows', arg: 2, check: () => sheetFrozen().rows === 2 },
        { label: `Até a linha atual (${sel.ar})`, cmd: 'freezeRows', arg: 'current', check: () => sheetFrozen().rows > 2 && sheetFrozen().rows === sel.ar }, '-',
        { label: 'Nenhuma coluna', cmd: 'freezeCols', arg: 0, check: () => !sheetFrozen().cols },
        { label: '1 coluna', cmd: 'freezeCols', arg: 1, check: () => sheetFrozen().cols === 1 },
        { label: '2 colunas', cmd: 'freezeCols', arg: 2, check: () => sheetFrozen().cols === 2 },
        { label: `Até a coluna atual (${E.numToCol(sel.ac)})`, cmd: 'freezeCols', arg: 'current', check: () => sheetFrozen().cols > 2 && sheetFrozen().cols === sel.ac },
      ] }, '-',
      { label: 'Zoom', sub: () => [50, 75, 90, 100, 125, 150, 200].map((z) => ({ label: z + '%', cmd: 'zoom', arg: z, check: () => doc.zoom === z })) },
      { label: 'Ocultar menus', cmd: 'toggleMenus' },
      { label: 'Tela cheia', cmd: 'fullscreen' },
    ] },
    { label: 'Inserir', items: () => [
      { label: 'Linhas', sub: () => [{ label: `Inserir ${plural(nRows(), 'linha', 'linhas')} acima`, cmd: 'insertRowsAbove' }, { label: `Inserir ${plural(nRows(), 'linha', 'linhas')} abaixo`, cmd: 'insertRowsBelow' }] },
      { label: 'Colunas', sub: () => [{ label: `Inserir ${plural(nCols(), 'coluna', 'colunas')} à esquerda`, cmd: 'insertColsLeft' }, { label: `Inserir ${plural(nCols(), 'coluna', 'colunas')} à direita`, cmd: 'insertColsRight' }] },
      { label: 'Página', cmd: 'newSheet' }, '-',
      { label: 'Gráfico', icon: 'chart', cmd: 'insertChart' },
      { label: 'Tabela dinâmica', cmd: 'pivotTable' },
      { label: 'Imagem', sub: [{ label: 'Inserir imagem sobre as células', cmd: 'insertImage' }, { label: 'Inserir imagem na célula', cmd: 'insertCellImage' }] }, '-',
      { label: 'Função', icon: 'sigma', sub: () => [
        { label: 'SOMA', action: () => run('autoSum', 'SOMA') }, { label: 'MÉDIA', action: () => run('autoSum', 'MÉDIA') },
        { label: 'CONT.NÚM', action: () => run('autoSum', 'CONT.NÚM') }, { label: 'MÁXIMO', action: () => run('autoSum', 'MÁXIMO') },
        { label: 'MÍNIMO', action: () => run('autoSum', 'MÍNIMO') }, '-', ...fnCats(), '-', { label: 'Lista completa de funções', cmd: 'functionList' },
      ] }, '-',
      { label: 'Link', icon: 'link', cmd: 'insertLink', sc: 'Ctrl+K' },
      { label: 'Caixa de seleção', icon: 'checkbox', cmd: 'insertCheckbox' },
      { label: 'Menu suspenso', icon: 'dropdown', cmd: 'insertDropdown' }, '-',
      { label: 'Comentário', icon: 'comment', cmd: 'insertComment', sc: 'Ctrl+Alt+M' },
      { label: 'Nota', icon: 'note', cmd: 'insertNote', sc: 'Shift+F2' },
    ] },
    { label: 'Formatar', items: () => [
      { label: 'Número', icon: 'number', sub: fmtItems },
      { label: 'Texto', sub: [{ cmd: 'bold', icon: 'bold' }, { cmd: 'italic', icon: 'italic' }, { cmd: 'underline' }, { cmd: 'strike', icon: 'strike' }] },
      { label: 'Alinhamento', sub: [{ label: 'Esquerda', icon: 'alignLeft', cmd: 'alignLeft' }, { label: 'Centro', icon: 'alignCenter', cmd: 'alignCenter' }, { label: 'Direita', icon: 'alignRight', cmd: 'alignRight' }, '-', { label: 'Em cima', icon: 'valignTop', cmd: 'valignTop' }, { label: 'No meio', icon: 'valignMiddle', cmd: 'valignMiddle' }, { label: 'Embaixo', icon: 'valignBottom', cmd: 'valignBottom' }] },
      { label: 'Ajuste de texto', sub: [{ label: 'Transbordar', icon: 'overflow', cmd: 'wrapOverflow' }, { label: 'Ajustar', icon: 'wrap', cmd: 'wrapWrap' }, { label: 'Cortar', icon: 'clip', cmd: 'wrapClip' }] },
      { label: 'Rotação', sub: [{ label: 'Nenhuma', cmd: 'rotNone' }, { label: 'Inclinar para cima', cmd: 'rot45' }, { label: 'Girar para cima', cmd: 'rotUp' }, { label: 'Girar para baixo', cmd: 'rotDown' }] },
      { label: 'Tamanho da fonte', sub: () => [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36].map((n) => ({ label: String(n), cmd: 'fontSize', arg: n, check: () => (App.style(App.sheet(), sel.ar, sel.ac).fs || 10) === n })) },
      { label: 'Mesclar células', icon: 'merge', sub: [{ label: 'Mesclar tudo', cmd: 'merge', arg: 'all' }, { label: 'Mesclar verticalmente', cmd: 'merge', arg: 'v' }, { label: 'Mesclar horizontalmente', cmd: 'merge', arg: 'h' }, { label: 'Desfazer mesclagem', cmd: 'merge', arg: 'none' }] }, '-',
      { label: 'Formatação condicional', cmd: 'condFormat' },
      { label: 'Cores alternadas', cmd: 'altColors' }, '-',
      { label: 'Limpar formatação', cmd: 'clearFormat' },
    ] },
    { label: 'Dados', items: () => [
      { label: 'Classificar página', sub: () => [{ label: `Classificar página por coluna ${E.numToCol(sel.ac)} (A a Z)`, cmd: 'sortSheet', arg: false }, { label: `Classificar página por coluna ${E.numToCol(sel.ac)} (Z a A)`, cmd: 'sortSheet', arg: true }] },
      { label: 'Classificar intervalo', sub: () => [{ label: `Classificar intervalo por coluna ${E.numToCol(sel.ac)} (A a Z)`, cmd: 'sortRange', arg: false }, { label: `Classificar intervalo por coluna ${E.numToCol(sel.ac)} (Z a A)`, cmd: 'sortRange', arg: true }, { label: 'Opções avançadas de classificação de intervalo', cmd: 'sortAdvanced' }] }, '-',
      { label: () => (App.sheet().filter ? 'Remover filtro' : 'Criar um filtro'), icon: 'filter', cmd: 'toggleFilter' }, '-',
      { label: 'Validação de dados', cmd: 'dataValidation' },
      { label: 'Estatísticas da coluna', cmd: 'columnStats' },
      { label: 'Intervalos nomeados', cmd: 'namedRanges' }, '-',
      { label: 'Limpeza de dados', sub: [{ label: 'Remover cópias', cmd: 'removeDuplicates' }, { label: 'Cortar espaço em branco', cmd: 'trimWhitespace' }] },
      { label: 'Dividir texto em colunas', cmd: 'splitText' },
    ] },
    { label: 'Ferramentas', items: () => [
      { label: 'Localizar e substituir', icon: 'search', cmd: 'findReplace', sc: 'Ctrl+H' },
      { label: 'Estatísticas da coluna', cmd: 'columnStats' },
      { label: 'Intervalos nomeados', cmd: 'namedRanges' },
      { label: 'Histórico de versões', icon: 'history', cmd: 'versionHistory' },
    ] },
    { label: 'Extensões', items: () => [{ label: 'Nenhuma extensão instalada', disabled: true }] },
    { label: 'Ajuda', items: () => [
      { label: 'Pesquisar nos menus', icon: 'search', cmd: 'menuSearch', sc: 'Alt+/' },
      { label: 'Lista de funções', icon: 'function', cmd: 'functionList' },
      { label: 'Atalhos do teclado', cmd: 'shortcuts', sc: 'Ctrl+/' }, '-',
      { label: 'Sobre o Planilhas', cmd: 'about' },
    ] },
  ];
  App.MENUS = MENUS;

  function buildMenubar() {
    const bar = $('menubar');
    bar.innerHTML = MENUS.map((m, i) => `<button class="mb" data-i="${i}">${m.label}</button>`).join('');
    let active = false;
    const open = (b) => {
      const m = MENUS[+b.dataset.i];
      if (App.editing()) App.commitEdit();
      menuPopup(b, m.items(), { onClose: () => { active = false; } });
      active = true;
    };
    bar.addEventListener('mousedown', (e) => {
      const b = e.target.closest('.mb');
      if (!b) return;
      e.preventDefault();
      if (openPop && openPop.anchor === b) { closePopup(); return; }
      open(b);
    });
    bar.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.mb');
      if (b && active && openPop && openPop.anchor !== b) open(b);
    });
  }

  // ---------- Barra de ferramentas ----------
  const FONTS = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Inconsolata', 'Lato', 'Lora', 'Merriweather', 'Montserrat', 'Open Sans', 'Oswald', 'Roboto', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  function buildToolbar() {
    const tb = $('toolbar');
    const btn = (id, ic, title, extra) => `<button class="tb" data-cmd="${id}" title="${esc(title)}" ${extra || ''}>${icon(ic)}</button>`;
    const dd = (id, html, title, cls) => `<button class="tb tb-dd ${cls || ''}" data-dd="${id}" title="${esc(title)}">${html}${icon('chevDown', 14)}</button>`;
    tb.innerHTML = `
      <div class="tb-search"><button class="tb-search-btn" id="menu-search-btn" title="Pesquisar nos menus (Alt+/)">${icon('search', 16)}<span>Menus</span></button></div>
      ${btn('undo', 'undo', 'Desfazer (Ctrl+Z)')}${btn('redo', 'redo', 'Refazer (Ctrl+Y)')}${btn('print', 'print', 'Imprimir (Ctrl+P)')}${btn('paintFormat', 'paint', 'Pintar formatação', 'id="tb-paint"')}
      ${dd('zoom', '<span id="tb-zoom">100%</span>', 'Zoom', 'tb-zoom')}
      <span class="tb-sep"></span>
      <button class="tb tb-txt" data-cmd="fmt_currency" title="Formatar como moeda">R$</button>
      <button class="tb tb-txt" data-cmd="fmt_percent" title="Formatar como porcentagem">%</button>
      <button class="tb tb-txt" data-cmd="decDec" title="Diminuir casas decimais"><span class="dec">.0</span><span class="arr">←</span></button>
      <button class="tb tb-txt" data-cmd="decInc" title="Aumentar casas decimais"><span class="dec">.00</span><span class="arr">→</span></button>
      ${dd('formats', '<span class="tb-123">123</span>', 'Mais formatos')}
      <span class="tb-sep"></span>
      ${dd('font', '<span id="tb-font" class="tb-font">Arial</span>', 'Fonte', 'tb-wide')}
      <span class="tb-sep"></span>
      <button class="tb" data-cmd="fontSizeDec" title="Diminuir tamanho da fonte (Ctrl+Shift+,)">${icon('plus').replace(ICONS.plus, P('M5 12h14'))}</button>
      <input id="tb-size" class="tb-size" value="10" aria-label="Tamanho da fonte" title="Tamanho da fonte">
      <button class="tb" data-cmd="fontSizeInc" title="Aumentar tamanho da fonte (Ctrl+Shift+.)">${icon('plus')}</button>
      <span class="tb-sep"></span>
      ${btn('bold', 'bold', 'Negrito (Ctrl+B)')}${btn('italic', 'italic', 'Itálico (Ctrl+I)')}${btn('strike', 'strike', 'Tachado (Alt+Shift+5)')}
      <button class="tb tb-color" data-dd="textColor" title="Cor do texto">${icon('textColor')}<i class="color-bar" id="tb-text-bar"></i></button>
      <span class="tb-sep"></span>
      <button class="tb tb-color" data-dd="fillColor" title="Cor de preenchimento">${icon('fill')}<i class="color-bar" id="tb-fill-bar" style="background:transparent"></i></button>
      ${dd('borders', icon('borders'), 'Bordas')}
      <button class="tb" data-cmd="mergeToggle" title="Mesclar células">${icon('merge')}</button><button class="tb tb-arrow" data-dd="merge" title="Tipos de mesclagem">${icon('chevDown', 14)}</button>
      <span class="tb-sep"></span>
      ${dd('align', `<span id="tb-align">${icon('alignLeft')}</span>`, 'Alinhamento horizontal')}
      ${dd('valign', `<span id="tb-valign">${icon('valignBottom')}</span>`, 'Alinhamento vertical')}
      ${dd('wrap', `<span id="tb-wrap">${icon('overflow')}</span>`, 'Ajuste de texto')}
      ${dd('rotate', icon('rotate'), 'Rotação do texto')}
      <span class="tb-sep"></span>
      ${btn('insertLink', 'link', 'Inserir link (Ctrl+K)')}${btn('insertComment', 'comment', 'Inserir comentário (Ctrl+Alt+M)')}${btn('insertChart', 'chart', 'Inserir gráfico')}
      ${btn('toggleFilter', 'filter', 'Criar um filtro', 'id="tb-filter"')}
      ${dd('functions', icon('sigma'), 'Funções')}
      <span class="tb-spacer"></span>
      <button class="tb" data-cmd="toggleMenus" title="Ocultar os menus (Ctrl+Shift+F)" id="tb-collapse">${icon('chevUp')}</button>`;
    tb.addEventListener('mousedown', (e) => { if (e.target.closest('.tb')) e.preventDefault(); });
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('.tb');
      if (!b) return;
      if (b.dataset.cmd === 'mergeToggle') {
        const g = App.mergeAt(App.sheet(), sel.ar, sel.ac);
        run('merge', g ? 'none' : 'all');
        return;
      }
      if (b.dataset.cmd) { run(b.dataset.cmd); return; }
      if (b.dataset.dd) openToolbarDropdown(b.dataset.dd, b);
    });
    const size = $('tb-size');
    size.addEventListener('focus', () => size.select());
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run('fontSize', parseFloat(size.value.replace(',', '.'))); } if (e.key === 'Escape') App.grid.focus(); });
    size.addEventListener('click', () => {
      menuPopup(size, [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36].map((n) => ({ label: String(n), cmd: 'fontSize', arg: n })));
    });
    $('menu-search-btn').addEventListener('click', () => run('menuSearch'));
  }

  function openToolbarDropdown(id, anchor) {
    if (App.editing()) App.commitEdit();
    const st = App.style(App.sheet(), sel.ar, sel.ac);
    switch (id) {
      case 'zoom': menuPopup(anchor, [50, 75, 90, 100, 125, 150, 200].map((z) => ({ label: z + '%', cmd: 'zoom', arg: z, check: doc.zoom === z }))); break;
      case 'formats': menuPopup(anchor, fmtItems()); break;
      case 'font': menuPopup(anchor, FONTS.map((f) => ({ label: f, cmd: 'fontFamily', arg: f === 'Arial' ? null : f, check: (st.ff || 'Arial') === f }))).classList.add('font-menu'); break;
      case 'textColor': popup(anchor, palette((c) => run('textColor', c), st.color, 'Redefinir')); break;
      case 'fillColor': popup(anchor, palette((c) => run('fillColor', c), st.bg, 'Redefinir')); break;
      case 'borders': popup(anchor, bordersPanel()); break;
      case 'merge': menuPopup(anchor, [{ label: 'Mesclar tudo', cmd: 'merge', arg: 'all' }, { label: 'Mesclar verticalmente', cmd: 'merge', arg: 'v' }, { label: 'Mesclar horizontalmente', cmd: 'merge', arg: 'h' }, { label: 'Desfazer mesclagem', cmd: 'merge', arg: 'none' }]); break;
      case 'align': iconRow(anchor, [['alignLeft', 'alignLeft', 'Esquerda'], ['alignCenter', 'alignCenter', 'Centro'], ['alignRight', 'alignRight', 'Direita']]); break;
      case 'valign': iconRow(anchor, [['valignTop', 'valignTop', 'Em cima'], ['valignMiddle', 'valignMiddle', 'No meio'], ['valignBottom', 'valignBottom', 'Embaixo']]); break;
      case 'wrap': iconRow(anchor, [['wrapOverflow', 'overflow', 'Transbordar'], ['wrapWrap', 'wrap', 'Ajustar'], ['wrapClip', 'clip', 'Cortar']]); break;
      case 'rotate': menuPopup(anchor, [{ label: 'Nenhuma', cmd: 'rotNone' }, { label: 'Inclinar para cima', cmd: 'rot45' }, { label: 'Girar para cima', cmd: 'rotUp' }, { label: 'Girar para baixo', cmd: 'rotDown' }]); break;
      case 'functions': menuPopup(anchor, [
        { label: 'SOMA', action: () => run('autoSum', 'SOMA') }, { label: 'MÉDIA', action: () => run('autoSum', 'MÉDIA') },
        { label: 'CONT.NÚM', action: () => run('autoSum', 'CONT.NÚM') }, { label: 'MÁXIMO', action: () => run('autoSum', 'MÁXIMO') },
        { label: 'MÍNIMO', action: () => run('autoSum', 'MÍNIMO') }, '-', ...fnCats(), '-', { label: 'Lista completa de funções', cmd: 'functionList' }]); break;
    }
  }
  function iconRow(anchor, items) {
    const box = document.createElement('div');
    box.className = 'icon-row';
    box.innerHTML = items.map(([cmd, ic, t]) => `<button class="tb" data-cmd="${cmd}" title="${t}">${icon(ic)}</button>`).join('');
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) { closePopup(); run(b.dataset.cmd); } });
    popup(anchor, box);
  }
  let borderColor = '#000000', borderStyle = 'solid';
  function bordersPanel() {
    const box = document.createElement('div');
    box.className = 'borders-panel';
    const types = [['all', 'M4 4h16v16H4zM4 12h16M12 4v16'], ['inner', 'M4 12h16M12 4v16'], ['h', 'M4 12h16'], ['v', 'M12 4v16'], ['outer', 'M4 4h16v16H4z'],
      ['left', 'M4 4v16'], ['top', 'M4 4h16'], ['right', 'M20 4v16'], ['bottom', 'M4 20h16'], ['none', 'M4 4h16v16H4z']];
    const names = { all: 'Todas as bordas', inner: 'Bordas internas', h: 'Bordas horizontais', v: 'Bordas verticais', outer: 'Bordas externas', left: 'Borda esquerda', top: 'Borda superior', right: 'Borda direita', bottom: 'Borda inferior', none: 'Limpar bordas' };
    box.innerHTML = `<div class="bp-grid">${types.map(([t, d]) => `<button class="tb" data-t="${t}" title="${names[t]}"><svg class="ic" width="18" height="18" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 12h16M12 4v16" stroke="#c9c9c9" stroke-width="1" stroke-dasharray="2 2" fill="none"/><path d="${d}" stroke="${t === 'none' ? '#c9c9c9' : 'currentColor'}" stroke-width="2" fill="none"/></svg></button>`).join('')}</div>
      <div class="bp-side"><button class="tb bp-color" title="Cor da borda">${icon('fill')}<i class="color-bar" style="background:${borderColor}"></i></button>
      <button class="tb bp-style" title="Estilo da borda"><svg width="22" height="18" viewBox="0 0 22 18"><path d="M2 9h18" stroke="currentColor" stroke-width="2"/></svg></button></div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (b) { closePopup(); run('border', { type: b.dataset.t, color: borderColor, style: borderStyle }); return; }
      if (e.target.closest('.bp-color')) {
        const pal = palette((c) => { borderColor = c || '#000000'; }, borderColor, 'Padrão');
        const r = e.target.closest('.bp-color').getBoundingClientRect();
        popup({ x: r.left, y: r.bottom + 4 }, pal);
      }
      if (e.target.closest('.bp-style')) {
        const styles = [['solid', 'M2 9h18', 1], ['medium', 'M2 9h18', 2], ['thick', 'M2 9h18', 3], ['dashed', 'M2 9h18', 1, '4 2'], ['dotted', 'M2 9h18', 1, '1 2'], ['double', 'M2 7h18M2 11h18', 1]];
        const list = document.createElement('div');
        list.className = 'menu';
        list.innerHTML = styles.map(([s, d, w, dash]) => `<div class="menu-item" data-s="${s}"><span class="mi-check">${borderStyle === s ? icon('check', 16) : ''}</span><svg width="80" height="18"><path d="${d.replace(/18/g, '78')}" stroke="#000" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg></div>`).join('');
        list.addEventListener('click', (ev) => { const it = ev.target.closest('[data-s]'); if (it) { borderStyle = it.dataset.s; closePopup(); } });
        const r = e.target.closest('.bp-style').getBoundingClientRect();
        popup({ x: r.left, y: r.bottom + 4 }, list, { cls: 'menu-pop' });
      }
    });
    return box;
  }

  // Estado visual da barra de ferramentas conforme a célula ativa
  function syncToolbar() {
    const sh = App.sheet();
    const st = App.style(sh, sel.ar, sel.ac);
    const on = (cmd, v) => document.querySelectorAll(`.tb[data-cmd="${cmd}"]`).forEach((b) => b.classList.toggle('active', !!v));
    on('bold', st.b); on('italic', st.i); on('strike', st.st);
    on('toggleFilter', !!sh.filter);
    on('mergeToggle', !!App.mergeAt(sh, sel.ar, sel.ac));
    on('paintFormat', !!App.paint);
    $('tb-font').textContent = st.ff || 'Arial';
    const size = $('tb-size');
    if (document.activeElement !== size) size.value = String(st.fs || 10);
    $('tb-text-bar').style.background = st.color || '#000000';
    $('tb-fill-bar').style.background = st.bg || 'transparent';
    $('tb-align').innerHTML = icon(st.al === 'c' ? 'alignCenter' : st.al === 'r' ? 'alignRight' : 'alignLeft');
    $('tb-valign').innerHTML = icon(st.va === 't' ? 'valignTop' : st.va === 'm' ? 'valignMiddle' : 'valignBottom');
    $('tb-wrap').innerHTML = icon(st.wrap === 'wrap' ? 'wrap' : st.wrap === 'clip' ? 'clip' : 'overflow');
    $('tb-zoom').textContent = doc.zoom + '%';
    document.querySelector('.tb[data-cmd="undo"]').classList.toggle('disabled', !App.canUndo());
    document.querySelector('.tb[data-cmd="redo"]').classList.toggle('disabled', !App.canRedo());
  }

  // ---------- Caixa de nome ----------
  function syncNameBox() {
    const nb = $('name-box');
    if (document.activeElement === nb) return;
    const R = App.selRect();
    const sh = App.sheet();
    const named = Object.keys(doc.names).find((n) => { const p = App.parseRange(doc.names[n]); return p && p.si === doc.active && p.R.r1 === R.r1 && p.R.r2 === R.r2 && p.R.c1 === R.c1 && p.R.c2 === R.c2; });
    if (named) nb.value = named;
    else if (App.selIsCell()) nb.value = E.addrToStr(sel.ar, sel.ac);
    else if (R.r1 === 1 && R.r2 >= sh.rows && R.c1 === 1 && R.c2 >= sh.cols) nb.value = 'Tudo';
    else if (R.r1 === 1 && R.r2 >= sh.rows) nb.value = E.numToCol(R.c1) + ':' + E.numToCol(R.c2);
    else if (R.c1 === 1 && R.c2 >= sh.cols) nb.value = R.r1 + ':' + R.r2;
    else nb.value = App.rangeText(R);
  }
  function initNameBox() {
    const nb = $('name-box');
    nb.addEventListener('focus', () => nb.select());
    nb.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { syncNameBox(); App.grid.focus(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const text = nb.value.trim();
      const nameKey = Object.keys(doc.names).find((n) => n.toUpperCase() === text.toUpperCase());
      const target = App.parseRange(nameKey ? doc.names[nameKey] : text);
      if (!target) {
        // nome novo para a seleção atual
        if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(text) && !/^[A-Za-z]{1,3}\d+$/.test(text)) {
          const R = App.selRect();
          App.change('Intervalo nomeado', () => { doc.names[text] = App.rangeText(R, App.sheet().name); });
          App.emit('notify', `Intervalo nomeado "${text}" criado.`);
        } else App.emit('notify', 'Referência inválida.');
        App.grid.focus();
        return;
      }
      if (target.si !== doc.active) { doc.active = target.si; App.emit('sheet'); }
      App.grid.selectRange(target.R);
      App.grid.focus();
    });
    $('name-box-dd').addEventListener('click', () => {
      const items = Object.keys(doc.names).map((n) => ({ label: n, hint: doc.names[n], action: () => { const t = App.parseRange(doc.names[n]); if (t) { if (t.si !== doc.active) { doc.active = t.si; App.emit('sheet'); } App.grid.selectRange(t.R); } } }));
      menuPopup($('name-box'), [...(items.length ? items : [{ label: 'Nenhum intervalo nomeado', disabled: true }]), '-', { label: 'Gerenciar intervalos nomeados', cmd: 'namedRanges' }]);
    });
  }

  // ---------- Busca nos menus (Alt+/) ----------
  function flattenMenus() {
    const out = [];
    const walk = (items, path) => {
      for (const it of items) {
        if (!it || it === '-' || it.header || it.disabled === true) continue;
        const label = typeof it.label === 'function' ? it.label() : it.label || (App.cmds[it.cmd] && App.cmds[it.cmd].label) || '';
        if (it.sub) { try { walk(typeof it.sub === 'function' ? it.sub() : it.sub, path.concat(label)); } catch (e) { /* ignora */ } continue; }
        out.push({ label, path: path.join(' › '), it });
      }
    };
    for (const m of MENUS) walk(m.items(), [m.label]);
    return out;
  }
  function menuSearch() {
    const anchor = $('menu-search-btn');
    const box = document.createElement('div');
    box.className = 'menu-search';
    box.innerHTML = `<div class="ms-input">${icon('search', 16)}<input placeholder="Pesquisar nos menus (Alt+/)" autocomplete="off"></div><div class="ms-list"></div>`;
    const input = box.querySelector('input'), list = box.querySelector('.ms-list');
    const all = flattenMenus();
    let items = [], idx = 0;
    const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const render = () => {
      const q = fold(input.value.trim());
      items = (q ? all.filter((x) => fold(x.label + ' ' + x.path).includes(q)) : all.slice(0, 0)).slice(0, 12);
      idx = Math.min(idx, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map((x, i) => `<div class="ms-item${i === idx ? ' on' : ''}" data-i="${i}"><b>${esc(x.label)}</b><span>${esc(x.path)}</span></div>`).join('')
        : `<div class="ms-empty">${q ? 'Nenhum resultado' : 'Digite para pesquisar comandos, como "mesclar" ou "congelar".'}</div>`;
    };
    const exec = (x) => { if (!x) return; closePopup(); if (x.it.action) x.it.action(); else run(x.it.cmd, x.it.arg); };
    input.addEventListener('input', () => { idx = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); exec(items[idx]); }
      else if (e.key === 'Escape') { closePopup(); App.grid.focus(); }
    });
    list.addEventListener('click', (e) => { const it = e.target.closest('.ms-item'); if (it) exec(items[+it.dataset.i]); });
    popup(anchor, box, { cls: 'ms-pop' });
    render();
    input.focus();
  }

  // ---------- Resumo da seleção (rodapé) ----------
  let summaryKind = 'sum';
  try { summaryKind = localStorage.getItem('planilhas:summary') || 'sum'; } catch (e) { /* sem armazenamento */ }
  function selectionStats() {
    const sh = App.sheet(), R = App.selRect(), si = doc.active;
    const used = App.usedRange(sh);
    const r2 = Math.min(R.r2, used.maxR), c2 = Math.min(R.c2, used.maxC);
    let sum = 0, n = 0, cnt = 0, min = Infinity, max = -Infinity;
    for (let r = R.r1; r <= r2; r++) {
      if (App.isRowHidden(sh, r)) continue;
      for (let c = R.c1; c <= c2; c++) {
        const v = App.value(si, r, c);
        if (v === null || v === '') continue;
        cnt++;
        if (typeof v === 'number') { sum += v; n++; if (v < min) min = v; if (v > max) max = v; }
      }
    }
    return { sum, avg: n ? sum / n : 0, min: n ? min : 0, max: n ? max : 0, count: cnt, countNums: n };
  }
  const SUMMARY = { sum: 'Soma', avg: 'Média', min: 'Mín', max: 'Máx', count: 'Contagem', countNums: 'Contagem numérica' };
  function syncSummary() {
    const el = $('summary');
    if (App.selIsCell()) { el.hidden = true; return; }
    const s = selectionStats();
    if (!s.count) { el.hidden = true; return; }
    el.hidden = false;
    const kind = s.countNums ? summaryKind : 'count';
    const st = App.style(App.sheet(), App.selRect().r1, App.selRect().c1);
    const val = kind === 'count' || kind === 'countNums' ? String(s[kind]) : App.fmtValue(s[kind], st.nf && !/[dyhs]/i.test(st.nf) ? st.nf : null);
    el.innerHTML = `${SUMMARY[kind]}: ${esc(val)} ${icon('chevDown', 14)}`;
    el.onclick = () => {
      const st2 = selectionStats();
      menuPopup(el, Object.keys(SUMMARY).map((k) => ({
        label: `${SUMMARY[k]}: ${k === 'count' || k === 'countNums' ? st2[k] : App.fmtValue(st2[k], null)}`,
        check: k === kind,
        action: () => { summaryKind = k; try { localStorage.setItem('planilhas:summary', k); } catch (e) { /* ignora */ } syncSummary(); },
      })), { above: true, right: true });
    };
  }

  // ---------- Título e status de salvamento ----------
  function initTitle() {
    const t = $('doc-title');
    const sync = () => { t.value = doc.title; document.title = doc.title + ' - Planilhas'; t.style.width = Math.min(480, Math.max(120, t.value.length * 9 + 24)) + 'px'; };
    sync();
    App.on('title', sync);
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') t.value = doc.title; t.blur(); App.grid.focus(); } });
    t.addEventListener('blur', () => { if (t.value.trim() !== doc.title) App.setTitle(t.value.trim()); sync(); });
    t.addEventListener('input', () => { t.style.width = Math.min(480, Math.max(120, t.value.length * 9 + 24)) + 'px'; });
    const status = $('save-status');
    App.on('saving', () => { if (App.cloudMode) return; status.innerHTML = `${icon('cloud', 16)} Salvando…`; });
    App.on('saved', () => { if (App.cloudMode) return; status.innerHTML = `${icon('cloud', 16)} Salvo no navegador`; status.title = 'Todas as alterações foram salvas neste navegador.'; });
    App.on('saveError', () => { status.innerHTML = `${icon('cloud', 16)} Não foi possível salvar`; status.title = 'O armazenamento do navegador está cheio ou bloqueado. Baixe uma cópia em Arquivo > Fazer download.'; });
    $('btn-share').addEventListener('click', () => run('share'));
    $('btn-history').addEventListener('click', () => run('versionHistory'));
    $('btn-star').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
  }

  function init() {
    buildMenubar();
    buildToolbar();
    initNameBox();
    initTitle();
    App.commands.def('menuSearch', 'Pesquisar nos menus', menuSearch, 'Alt+/');
    App.on('selection', () => { syncToolbar(); syncNameBox(); syncSummary(); });
    App.on('change', () => { syncToolbar(); syncSummary(); });
    App.on('paint', syncToolbar);
    App.on('zoom', syncToolbar);
    syncToolbar();
    syncNameBox();
  }

  App.ui = Object.assign(App.ui || {}, { init, popup, menuPopup, buildMenu, closePopup, icon, palette, syncToolbar });
})(window.App);
