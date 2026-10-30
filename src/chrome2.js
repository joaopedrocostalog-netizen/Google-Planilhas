// Interface (parte 2): abas, avisos, diálogos, dicas, cartão de link, menus de contexto,
// lista suspensa de validação e menu de filtro.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const sel = App.sel;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const run = (id, arg) => App.run(id, arg);
  const icon = (n, s) => App.icon(n, s);

  // ---------- Avisos (rodapé) ----------
  let toastTimer = null;
  function notify(msg) {
    const t = $('toast');
    const o = typeof msg === 'string' ? { text: msg } : msg;
    t.innerHTML = `<span>${esc(o.text)}</span>` + (o.action ? `<button class="toast-btn">${esc(o.action.label)}</button>` : '') + `<button class="toast-x" aria-label="Fechar">${icon('close', 16)}</button>`;
    t.hidden = false;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    if (o.action) t.querySelector('.toast-btn').onclick = () => { t.hidden = true; o.action.fn(); };
    t.querySelector('.toast-x').onclick = () => { t.hidden = true; };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, o.action ? 6000 : 3200);
  }

  // ---------- Diálogos ----------
  function modal(opts) {
    const d = document.createElement('dialog');
    d.className = 'modal ' + (opts.cls || '');
    if (opts.width) d.style.width = opts.width;
    d.innerHTML = `<div class="modal-head"><h2>${esc(opts.title)}</h2><button class="icon-btn modal-x" aria-label="Fechar">${icon('close', 20)}</button></div>
      <div class="modal-body"></div><div class="modal-foot"></div>`;
    const body = d.querySelector('.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const foot = d.querySelector('.modal-foot');
    for (const b of opts.buttons || []) {
      const el = document.createElement('button');
      el.className = b.primary ? 'btn btn-primary' : 'btn';
      el.textContent = b.label;
      el.onclick = () => { if (b.action && b.action(d) === false) return; close(); };
      foot.appendChild(el);
    }
    if (!(opts.buttons || []).length) foot.remove();
    const close = () => { d.close(); d.remove(); if (opts.onClose) opts.onClose(); if (!App.editing()) App.grid.focus(); };
    d.querySelector('.modal-x').onclick = close;
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT' && opts.enterSubmits !== false) {
        const primary = (opts.buttons || []).find((b) => b.primary);
        if (primary) { e.preventDefault(); if (!primary.action || primary.action(d) !== false) close(); }
      }
    });
    document.body.appendChild(d);
    d.showModal();
    const first = d.querySelector('input:not([type=checkbox]):not([type=color]), textarea, select');
    if (first) { first.focus(); if (first.select) first.select(); }
    if (opts.onOpen) opts.onOpen(d);
    return { el: d, close };
  }
  function prompt(title, label, value, cb, okLabel) {
    modal({
      title, width: '420px',
      body: `<label class="field"><span>${esc(label)}</span><input class="input" id="dlg-prompt" value="${esc(value || '')}"></label>`,
      buttons: [{ label: 'Cancelar' }, { label: okLabel || 'OK', primary: true, action: (d) => cb(d.querySelector('#dlg-prompt').value) }],
    });
  }
  function confirm(title, msg, okLabel, cb) {
    modal({ title, width: '440px', body: `<p class="modal-text">${esc(msg)}</p>`, buttons: [{ label: 'Cancelar' }, { label: okLabel || 'OK', primary: true, action: () => cb() }] });
  }

  // ---------- Abas ----------
  function renderTabs() {
    const box = $('tabs');
    box.innerHTML = doc.sheets.map((s, i) => s.hidden ? '' :
      `<div class="tab${i === doc.active ? ' active' : ''}" data-i="${i}" draggable="true" title="${esc(s.name)}">
        ${s.color ? `<i class="tab-color" style="background:${s.color}"></i>` : ''}<span class="tab-name">${esc(s.name)}</span>
        ${i === doc.active ? `<button class="tab-caret" data-caret="${i}" aria-label="Opções da planilha">${icon('chevDown', 14)}</button>` : ''}</div>`).join('');
    const act = box.querySelector('.tab.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function tabMenu(i, anchor) {
    const n = doc.sheets.length;
    App.ui.menuPopup(anchor, [
      { label: 'Excluir', need: 'deleteSheet', action: () => run('deleteSheet', i) },
      { label: 'Duplicar', need: 'duplicateSheet', action: () => { run('switchSheet', i); run('duplicateSheet'); } },
      { label: 'Renomear', need: 'renameSheet', action: () => startRename(i) },
      { label: 'Mudar cor', need: 'sheetColor', sub: () => [{ label: 'Redefinir', action: () => run('sheetColor', { i, color: null }) }, ...['#e30613', '#b8000c', '#0d0d0d', '#ff9900', '#f1c232', '#6aa84f', '#3c78d8', '#674ea7', '#a64d79', '#999999'].map((c) => ({ label: c, swatch: c, action: () => run('sheetColor', { i, color: c }) }))] },
      { label: 'Ocultar página', need: 'hideSheet', action: () => run('hideSheet', i) }, '-',
      { label: 'Mover para a direita', need: 'moveSheet', disabled: i >= n - 1, action: () => run('moveSheet', { i, to: i + 1 }) },
      { label: 'Mover para a esquerda', need: 'moveSheet', disabled: i <= 0, action: () => run('moveSheet', { i, to: i - 1 }) },
    ], { above: true });
  }
  function startRename(i) {
    if (App.adminOnly && App.adminOnly()) return;
    const tab = document.querySelector(`.tab[data-i="${i}"] .tab-name`);
    if (!tab) return;
    tab.contentEditable = 'true';
    tab.focus();
    const range = document.createRange(); range.selectNodeContents(tab);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    const done = (save) => {
      tab.contentEditable = 'false';
      const name = tab.textContent.trim();
      if (save && name && name !== doc.sheets[i].name) {
        if (doc.sheets.some((sh, k) => k !== i && sh.name.toUpperCase() === name.toUpperCase())) notify(`Já existe uma página chamada "${name}". Escolha outro nome.`);
        else if (/[[\]*?/\\:]/.test(name)) notify('O nome da página não pode conter os caracteres [ ] * ? / \\ :');
        else { App.change('Renomear página', () => App.renameSheet(i, name.slice(0, 100))); }
      }
      renderTabs();
      App.grid.focus();
    };
    tab.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tab.onblur = null; done(true); } else if (e.key === 'Escape') { tab.onblur = null; done(false); } };
    tab.onblur = () => done(true);
  }
  function initTabs() {
    const box = $('tabs');
    box.addEventListener('mousedown', (e) => {
      const t = e.target.closest('.tab');
      if (!t || e.target.isContentEditable) return;
      const i = +t.dataset.i;
      // durante a edição de fórmula, trocar de página serve para apontar referências
      if (App.editing() && App.editorWantsPoint && App.editorWantsPoint()) {
        e.preventDefault();
        if (i !== doc.active) { doc.active = i; App.emit('sheet'); }
        return;
      }
      if (e.button === 2) return;
      if (e.target.closest('[data-caret]')) { e.preventDefault(); tabMenu(i, t); return; }
      if (i !== doc.active) run('switchSheet', i);
    });
    box.addEventListener('dblclick', (e) => { const t = e.target.closest('.tab'); if (t) startRename(+t.dataset.i); });
    box.addEventListener('contextmenu', (e) => { const t = e.target.closest('.tab'); if (!t) return; e.preventDefault(); const i = +t.dataset.i; if (i !== doc.active) run('switchSheet', i); tabMenu(i, { x: e.clientX, y: e.clientY - 280 }); });
    let dragFrom = null;
    box.addEventListener('dragstart', (e) => { const t = e.target.closest('.tab'); if (!t) return; dragFrom = +t.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
    box.addEventListener('dragover', (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      box.querySelectorAll('.tab').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const t = e.target.closest('.tab');
      if (t) { const r = t.getBoundingClientRect(); t.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
    });
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = e.target.closest('.tab');
      box.querySelectorAll('.tab').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      if (!t || dragFrom === null) return;
      const r = t.getBoundingClientRect();
      let to = +t.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1);
      if (to > dragFrom) to--;
      run('moveSheet', { i: dragFrom, to });
      dragFrom = null;
    });
    box.addEventListener('dragend', () => { dragFrom = null; box.querySelectorAll('.tab').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
    $('tab-add').addEventListener('click', () => run('newSheet'));
    $('tab-list').addEventListener('click', (e) => {
      App.ui.menuPopup(e.currentTarget, doc.sheets.map((s, i) => ({ label: s.name + (s.hidden ? ' (oculta)' : ''), check: i === doc.active, swatch: s.color || undefined, action: () => (s.hidden ? run('showSheet', i) : run('switchSheet', i)) })), { above: true });
    });
    App.on('sheet', renderTabs);
    App.on('change', renderTabs);
    App.on('renameTab', (i) => { if (doc.sheets[i].hidden) return; if (i !== doc.active) run('switchSheet', i); setTimeout(() => startRename(i), 0); });
    renderTabs();
  }

  // ---------- Dicas ao passar o mouse ----------
  function initHover() {
    const tip = $('cell-tip');
    App.on('hover', (h) => {
      if (!h || App.gridState.drag) { tip.hidden = true; return; }
      const info = App.cellInfo(h.r, h.c);
      const sh = App.sheet();
      let html = '';
      if (info.isErr) html += `<div class="tip-err"><b>Erro</b><p>${esc(info.v.msg || info.v.code)}</p></div>`;
      else if (info.dv && info.raw !== '' && info.dv.type !== 'checkbox' && !App.validate(sh, h.r, h.c, String(info.raw))) html += `<div class="tip-err"><b>Entrada inválida</b><p>${esc(info.dv.help || 'O conteúdo não atende à regra de validação de dados.')}</p></div>`;
      if (info.comment) html += info.cell.comments.map((cm) => `<div class="tip-comment"><div class="cm-head"><span class="avatar">${esc((cm.author || 'V')[0])}</span><b>${esc(cm.author || 'Você')}</b><time>${esc(new Date(cm.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</time></div><p>${esc(cm.text)}</p></div>`).join('');
      if (info.note) html += `<div class="tip-note">${esc(info.note)}</div>`;
      if (!html) { tip.hidden = true; return; }
      tip.innerHTML = html;
      tip.hidden = false;
      const wr = $('grid-wrap').getBoundingClientRect();
      let x = wr.left + h.x + 6, y = wr.top + h.y;
      if (x + tip.offsetWidth > window.innerWidth - 8) x = wr.left + h.rect.x - tip.offsetWidth - 6;
      if (y + tip.offsetHeight > window.innerHeight - 8) y = window.innerHeight - tip.offsetHeight - 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    App.on('viewport', () => { tip.hidden = true; });
  }

  // ---------- Cartão de link ----------
  function initLinkCard() {
    const card = $('link-card');
    const place = () => {
      if (App.editing()) { card.hidden = true; return; }
      const info = App.cellInfo(sel.ar, sel.ac);
      if (!info.link || !App.selIsCell()) { card.hidden = true; return; }
      const rc = App.grid.cellRect(sel.ar, sel.ac);
      const st = App.gridState;
      if (rc.y + rc.h > st.vh || rc.x > st.vw || rc.y < st.hdrH) { card.hidden = true; return; }
      let host = info.link;
      try { host = new URL(info.link).hostname; } catch (e) { /* mantém o texto */ }
      card.innerHTML = `<div class="lc-main">${icon('link', 16)}<a href="${esc(info.link)}" target="_blank" rel="noopener noreferrer">${esc(info.link.length > 48 ? info.link.slice(0, 48) + '…' : info.link)}</a></div><div class="lc-host">${esc(host)}</div>
        <div class="lc-actions"><button class="icon-btn" data-a="copy" title="Copiar link">Copiar</button><button class="icon-btn" data-a="edit" title="Editar link">Editar</button><button class="icon-btn" data-a="remove" title="Remover link">Remover</button></div>`;
      card.hidden = false;
      const wr = $('grid-wrap').getBoundingClientRect();
      card.style.left = Math.min(wr.left + rc.x, window.innerWidth - 340) + 'px';
      card.style.top = wr.top + rc.y + rc.h + 4 + 'px';
      card.onclick = (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'copy') { navigator.clipboard.writeText(info.link).then(() => notify('Link copiado.'), () => notify('Não foi possível copiar o link.')); }
        if (a.dataset.a === 'edit') run('insertLink');
        if (a.dataset.a === 'remove') {
          const sh = App.sheet();
          App.change('Remover link', () => {
            const cell = App.cell(sh, sel.ar, sel.ac);
            if (cell) { delete cell.link; if (typeof cell.v === 'string' && /^=\s*(HYPERLINK|HIPERLINK)\(/i.test(cell.v)) cell.v = App.fmtValue(App.value(doc.active, sel.ar, sel.ac)); }
          });
        }
      };
    };
    App.on('selection', place);
    App.on('viewport', place);
    App.on('editStart', () => { card.hidden = true; });
  }

  // ---------- Menus de contexto ----------
  function initContextMenus() {
    App.on('contextMenu', ({ hit, x, y }) => {
      if (App.editing()) App.commitEdit();
      const R = App.selRect(), sh = App.sheet();
      const nr = R.r2 - R.r1 + 1, nc = R.c2 - R.c1 + 1;
      const rowsTxt = (n) => `${n} ${n === 1 ? 'linha' : 'linhas'}`, colsTxt = (n) => `${n} ${n === 1 ? 'coluna' : 'colunas'}`;
      const rl = nr === 1 ? `linha ${R.r1}` : `linhas ${R.r1} - ${R.r2}`;
      const cl = nc === 1 ? `coluna ${E.numToCol(R.c1)}` : `colunas ${E.numToCol(R.c1)} - ${E.numToCol(R.c2)}`;
      const base = [{ cmd: 'cut' }, { cmd: 'copy' }, { cmd: 'paste' },
        { label: 'Colar especial', sub: [{ label: 'Somente valores', cmd: 'pasteValues' }, { label: 'Somente a formatação', cmd: 'pasteFormat' }, { label: 'Somente a fórmula', cmd: 'pasteFormula' }, { label: 'Transposto', cmd: 'pasteTranspose' }] }, '-'];
      let items;
      if (hit.area === 'colHdr' || hit.area === 'colEdge') {
        items = [...base,
          { label: `Renomear coluna ${E.numToCol(R.c1)}`, cmd: 'renameCol', arg: R.c1 },
          { label: `Inserir ${colsTxt(nc)} à esquerda`, cmd: 'insertColsLeft' }, { label: `Inserir ${colsTxt(nc)} à direita`, cmd: 'insertColsRight' },
          { label: `Excluir ${cl}`, cmd: 'deleteCols' }, { label: `Limpar ${cl}`, cmd: 'clearValues' }, { label: `Ocultar ${cl}`, cmd: 'hideCols' },
          { label: `Redimensionar ${cl}`, cmd: 'resizeCols' }, { label: 'Ajustar ao conteúdo', cmd: 'autofitCols' }, '-',
          { label: `Classificar página de A a Z`, cmd: 'sortSheet', arg: false }, { label: `Classificar página de Z a A`, cmd: 'sortSheet', arg: true }, '-',
          { label: sh.filter && sh.filter.r1 === 0 && R.c1 >= sh.filter.c1 && R.c2 <= sh.filter.c2 ? 'Remover filtro' : sh.filter && sh.filter.r1 === 0 ? `Filtrar também a ${cl}` : sh.filter ? 'Remover filtro' : `Criar um filtro a partir da ${cl}`, cmd: sh.filter && sh.filter.r1 !== 0 ? 'toggleFilter' : 'filterFromColumn', arg: undefined },
          { label: `Congelar até a coluna ${E.numToCol(R.c2)}`, need: 'freezeCols', action: () => run('freezeCols', R.c2) },
          { label: 'Estatísticas da coluna', cmd: 'columnStats' }, { label: 'Validação de dados', cmd: 'dataValidation' }, { label: 'Formatação condicional', cmd: 'condFormat' }];
      } else if (hit.area === 'rowHdr' || hit.area === 'rowEdge') {
        items = [...base,
          { label: `Inserir ${rowsTxt(nr)} acima`, cmd: 'insertRowsAbove' }, { label: `Inserir ${rowsTxt(nr)} abaixo`, cmd: 'insertRowsBelow' },
          { label: `Excluir ${rl}`, cmd: 'deleteRows' }, { label: `Limpar ${rl}`, cmd: 'clearValues' }, { label: `Ocultar ${rl}`, cmd: 'hideRows' },
          { label: `Redimensionar ${rl}`, cmd: 'resizeRows' }, '-',
          { label: `Congelar até a linha ${R.r2}`, need: 'freezeRows', action: () => run('freezeRows', R.r2) },
          { label: 'Formatação condicional', cmd: 'condFormat' }, { label: 'Validação de dados', cmd: 'dataValidation' }];
      } else if (hit.area === 'cell' || hit.area === 'fill') {
        items = [...base,
          { label: `Inserir ${rowsTxt(nr)} acima`, cmd: 'insertRowsAbove' }, { label: `Inserir ${colsTxt(nc)} à esquerda`, cmd: 'insertColsLeft' },
          { label: 'Inserir células', sub: [{ label: `Inserir ${rowsTxt(nr)} abaixo`, cmd: 'insertRowsBelow' }, { label: `Inserir ${colsTxt(nc)} à direita`, cmd: 'insertColsRight' }] },
          { label: `Excluir ${rl}`, cmd: 'deleteRows' }, { label: `Excluir ${cl}`, cmd: 'deleteCols' }, '-',
          { label: 'Criar um filtro', cmd: 'toggleFilter', disabled: !!sh.filter }, { label: 'Classificar intervalo', sub: [{ label: 'A a Z', cmd: 'sortRange', arg: false }, { label: 'Z a A', cmd: 'sortRange', arg: true }, { label: 'Opções avançadas', cmd: 'sortAdvanced' }] }, '-',
          { label: 'Inserir link', icon: 'link', cmd: 'insertLink' }, { label: 'Comentário', icon: 'comment', cmd: 'insertComment' }, { label: 'Inserir nota', icon: 'note', cmd: 'insertNote' },
          { label: 'Menu suspenso', icon: 'dropdown', cmd: 'insertDropdown' }, '-',
          { label: 'Ver mais ações da célula', sub: [{ label: 'Formatação condicional', cmd: 'condFormat' }, { label: 'Validação de dados', cmd: 'dataValidation' }, { label: 'Estatísticas da coluna', cmd: 'columnStats' }, { label: 'Limpar tudo', cmd: 'clearAll' }] }];
      } else return;
      App.emit('contextItems', { hit, items, R });
      App.ui.menuPopup({ x, y }, items);
    });
  }

  // ---------- Lista suspensa (validação) ----------
  function initDropdown() {
    App.on('dropdown', ({ r, c, x, y, w }) => {
      const sh = App.sheet();
      const d = App.dvAt(sh, r, c);
      if (!d) return;
      const items = App.dvItems(sh, d);
      const cur = App.raw(sh, r, c);
      const box = document.createElement('div');
      box.className = 'dv-pop';
      box.innerHTML = `<input class="input dv-search" placeholder="Pesquisar" autocomplete="off"><div class="dv-list"></div>`;
      const list = box.querySelector('.dv-list'), search = box.querySelector('input');
      const render = () => {
        const q = search.value.toLowerCase();
        const vis = items.filter((it) => it.toLowerCase().includes(q));
        list.innerHTML = vis.length ? vis.map((it) => `<div class="dv-item${it === cur ? ' on' : ''}" data-v="${esc(it)}"><span class="dv-chip" style="background:${(d.colors && d.colors[it]) || '#ececec'}">${esc(it)}</span></div>`).join('') : '<div class="dv-empty">Nenhum item</div>';
      };
      render();
      search.addEventListener('input', render);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = list.querySelector('.dv-item'); if (f) f.click(); } });
      list.addEventListener('click', (e) => {
        const it = e.target.closest('.dv-item');
        if (!it) return;
        App.ui.closePopup();
        App.change('Lista suspensa', () => App.setRaw(sh, r, c, it.dataset.v));
        App.grid.focus();
      });
      const wr = $('grid-wrap').getBoundingClientRect();
      const pop = App.ui.popup({ x: wr.left + x, y: wr.top + y + 2 }, box);
      pop.style.minWidth = Math.max(180, w) + 'px';
      search.focus();
    });
  }

  // ---------- Menu de filtro ----------
  function initFilterMenu() {
    App.on('filterMenu', ({ c, x, y }) => {
      const sh = App.sheet(), si = doc.active, f = sh.filter;
      if (!f) return;
      const crit = (f.crit && f.crit[c]) || {};
      const counts = new Map();
      for (let r = f.r1 + 1, end = App.filterEnd(sh); r <= end; r++) {
        // valores das linhas visíveis pelos outros filtros
        let hiddenByOther = false;
        for (const k in f.crit) {
          if (+k === c) continue;
          const cr = f.crit[k], v = App.value(si, r, +k), t = App.fmtValue(v, App.style(sh, r, +k).nf);
          if ((cr.hidden && cr.hidden.includes(t)) || (cr.cond && !App.testCondition(cr.cond, v, si, r, +k))) { hiddenByOther = true; break; }
        }
        if (hiddenByOther) continue;
        const t = App.fmtValue(App.value(si, r, c), App.style(sh, r, c).nf);
        counts.set(t, (counts.get(t) || 0) + 1);
      }
      const values = [...counts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR', { numeric: true })));
      const hidden = new Set(crit.hidden || []);
      const box = document.createElement('div');
      box.className = 'filter-pop';
      const condOpts = App.CONDITIONS.map(([k, label]) => `<option value="${k}"${crit.cond && crit.cond.type === k ? ' selected' : ''}>${esc(label)}</option>`).join('');
      box.innerHTML = `
        <button class="fp-sort" data-sort="asc">Classificar de A a Z</button><button class="fp-sort" data-sort="desc">Classificar de Z a A</button>
        <details class="fp-sec"${crit.cond ? ' open' : ''}><summary>Filtrar por condição</summary>
          <select class="input fp-cond"><option value="">Nenhuma</option>${condOpts}</select>
          <input class="input fp-a" placeholder="Valor ou fórmula" value="${esc((crit.cond && crit.cond.a) || '')}">
          <input class="input fp-b" placeholder="Segundo valor" value="${esc((crit.cond && crit.cond.b) || '')}"></details>
        <details class="fp-sec" open><summary>Filtrar por valores</summary>
          <div class="fp-links"><a href="#" data-all="1">Selecionar tudo (${values.length})</a> · <a href="#" data-all="0">Limpar</a></div>
          <input class="input fp-search" placeholder="Pesquisar">
          <div class="fp-values">${values.map((v, i) => `<label class="fp-val"><input type="checkbox" data-i="${i}"${hidden.has(v) ? '' : ' checked'}><span>${v === '' ? '(Vazias)' : esc(v)}</span><em>${counts.get(v)}</em></label>`).join('')}</div></details>
        <div class="fp-foot"><button class="btn fp-cancel">Cancelar</button><button class="btn btn-primary fp-ok">OK</button></div>`;
      const condSel = box.querySelector('.fp-cond');
      const showArgs = () => {
        const def = App.CONDITIONS.find((x) => x[0] === condSel.value);
        box.querySelector('.fp-a').hidden = !def || def[2] < 1;
        box.querySelector('.fp-b').hidden = !def || def[2] < 2;
      };
      condSel.addEventListener('change', showArgs); showArgs();
      box.querySelector('.fp-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        box.querySelectorAll('.fp-val').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(q); });
      });
      box.querySelectorAll('[data-all]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        box.querySelectorAll('.fp-val:not([hidden]) input').forEach((i) => { i.checked = a.dataset.all === '1'; });
      }));
      box.querySelectorAll('.fp-sort').forEach((b) => b.addEventListener('click', () => {
        App.ui.closePopup();
        App.change('Classificar', () => App.sortRange(si, { r1: f.r1, c1: f.c1, r2: App.filterEnd(sh), c2: f.c2 }, [{ col: c, asc: b.dataset.sort === 'asc' }], true));
      }));
      box.querySelector('.fp-cancel').addEventListener('click', () => App.ui.closePopup());
      box.querySelector('.fp-ok').addEventListener('click', () => {
        const hid = [];
        box.querySelectorAll('.fp-values input').forEach((i) => { if (!i.checked) hid.push(values[+i.dataset.i]); });
        const cond = condSel.value ? { type: condSel.value, a: box.querySelector('.fp-a').value, b: box.querySelector('.fp-b').value } : null;
        App.ui.closePopup();
        App.change('Filtrar', () => {
          f.crit = f.crit || {};
          if (!hid.length && !cond) delete f.crit[c];
          else f.crit[c] = { hidden: hid, cond };
        });
      });
      const wr = $('grid-wrap').getBoundingClientRect();
      App.ui.popup({ x: wr.left + x - 260, y: wr.top + y + 2 }, box);
    });
  }

  function init() {
    initTabs();
    initHover();
    initLinkCard();
    initContextMenus();
    initDropdown();
    initFilterMenu();
    App.on('notify', notify);
  }
  App.ui = Object.assign(App.ui || {}, { init2: init, notify, modal, prompt, confirm, renderTabs, startRename });
})(window.App);
