// Minha visualização: cada pessoa monta a própria tela da página, sem mudar nada para os outros.
// - escolhe quais colunas ver (entre as liberadas para ela) e em que ordem;
// - agrupa por qualquer coluna (cliente, status…), com grupos que abrem e fecham com + e −;
// - ordena pelo status (ex.: finalizados sobem), atualizando ao vivo;
// - edita os valores com duplo clique (respeitando as permissões).
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = App.esc, E = App.E;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const LOCAL = 'planilhas:myviews';
  const MAX_ROWS = 3000;

  let box = null, cfg = null, open = false;

  // ---------- Preferências (salvas na conta quando há login; senão neste navegador) ----------
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || '{}'); } catch (e) { return {}; } };
  const allCfg = () => Object.assign({}, readLocal(), (App.userPrefs && App.userPrefs().views) || {});
  const key = () => (App.docId || 'local') + '|' + App.sheet().id;
  function saveCfg() {
    const all = allCfg();
    all[key()] = cfg;
    try { localStorage.setItem(LOCAL, JSON.stringify(all)); } catch (e) { /* ignora */ }
    if (App.savePrefs) App.savePrefs({ views: all });
  }

  // ---------- Dados da página ----------
  const sheet = () => App.sheet();
  const si = () => App.sheetIndex(sheet());
  const canSee = (sh, c) => !(App.colBlocked && App.colBlocked(sh, c));
  function lastCol(sh) {
    let n = App.usedRange(sh).maxC;
    for (const k in sh.colNames || {}) n = Math.max(n, +k);
    return Math.max(1, Math.min(sh.cols, n));
  }
  const headerText = (sh, c) => {
    const nm = sh.colNames && sh.colNames[c];
    if (nm) return String(nm);
    if (cfg && cfg.header === 1) { const v = App.value(si(), 1, c); if (v !== null && v !== undefined && v !== '') return String(App.fmtValue(v, App.style(sh, 1, c).nf)); }
    return E.numToCol(c);
  };
  const text = (sh, r, c) => { const v = App.value(si(), r, c); return v === null || v === undefined ? '' : E.isErr(v) ? v.code : String(App.fmtValue(v, App.style(sh, r, c).nf)); };
  const isFinal = (s) => /finaliz|conclu|entregue|encerrad|ok\b/i.test(s);

  function defaults(sh) {
    const cols = [];
    for (let c = 1; c <= lastCol(sh); c++) if (canSee(sh, c)) cols.push(c);
    // a linha 1 é cabeçalho quando tem só textos (ex.: Data, Cliente, Status)
    const row1 = cols.map((c) => App.value(si(), 1, c)).filter((v) => v !== null && v !== undefined && v !== '');
    const header = row1.length && row1.every((v) => typeof v === 'string') ? 1 : 0;
    return { cols, header, groupCol: 0, statusCol: 0, statusOrder: [], collapsed: [] };
  }
  function distinct(sh, c) {
    const seen = new Map();
    const start = cfg.header ? 2 : 1, end = App.usedRange(sh).maxR;
    for (let r = start; r <= end; r++) { const t = text(sh, r, c); seen.set(t, (seen.get(t) || 0) + 1); }
    return seen;
  }
  // ordem dos status: a escolhida pela pessoa; valores novos entram depois (finalizados primeiro)
  function statusOrder(sh) {
    const vals = [...distinct(sh, cfg.statusCol).keys()];
    const order = (cfg.statusOrder || []).filter((v) => vals.includes(v));
    const rest = vals.filter((v) => !order.includes(v)).sort((a, b) => (isFinal(b) - isFinal(a)) || (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR')));
    return order.concat(rest);
  }

  // ---------- Tela ----------
  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'myview';
    box.hidden = true;
    document.querySelector('.main').appendChild(box);
    box.addEventListener('dblclick', onDbl);
    box.addEventListener('click', onClick);
    return box;
  }
  function render() {
    if (!open) return;
    const sh = sheet();
    cfg = allCfg()[key()] || cfg && cfg._sheet === sh.id && cfg || defaults(sh);
    cfg._sheet = sh.id;
    cfg.cols = cfg.cols.filter((c) => c <= sh.cols && canSee(sh, c));
    if (!cfg.cols.length) cfg.cols = defaults(sh).cols;
    const wrap = box.querySelector('.mv-table-wrap');
    const scroll = wrap ? [wrap.scrollLeft, wrap.scrollTop] : [0, 0];
    const allCols = []; for (let c = 1; c <= lastCol(sh); c++) if (canSee(sh, c)) allCols.push(c);
    const colOpt = (cur, none) => `<option value="0">${none}</option>` + allCols.map((c) => `<option value="${c}"${cur === c ? ' selected' : ''}>${esc(E.numToCol(c) + (headerText(sh, c) !== E.numToCol(c) ? ' · ' + headerText(sh, c) : ''))}</option>`).join('');

    // linhas
    const start = cfg.header ? 2 : 1, end = Math.min(App.usedRange(sh).maxR, start + MAX_ROWS - 1);
    let rows = [];
    for (let r = start; r <= end; r++) {
      if (App.filterHidden(sh).has(r) || App.oldRows(sh).has(r)) continue;
      if (cfg.cols.every((c) => App.raw(sh, r, c) === '')) continue;
      rows.push(r);
    }
    let order = null;
    if (cfg.statusCol) {
      order = statusOrder(sh);
      const rank = new Map(order.map((v, i) => [v, i]));
      rows.sort((a, b) => (rank.get(text(sh, a, cfg.statusCol)) - rank.get(text(sh, b, cfg.statusCol))) || a - b);
    }
    const cellHtml = (r, c) => {
      const s = App.effectiveStyle ? App.effectiveStyle(sh, si(), r, c, App.style(sh, r, c)) : App.style(sh, r, c);
      const st = [s.bg ? `background:${s.bg}` : '', s.color ? `color:${s.color}` : '', s.b ? 'font-weight:700' : '', s.i ? 'font-style:italic' : ''].filter(Boolean).join(';');
      const d = App.dvAt(sh, r, c);
      if (d && d.type === 'checkbox') {
        const on = App.cbIsOn(d, App.raw(sh, r, c), App.value(si(), r, c));
        return `<td class="mv-cb" data-r="${r}" data-c="${c}" style="${st}"><span class="mv-check${on ? ' on' : ''}">${on ? '✓' : ''}</span></td>`;
      }
      const v = App.value(si(), r, c);
      return `<td data-r="${r}" data-c="${c}" class="${typeof v === 'number' ? 'num' : ''}" style="${st}">${esc(text(sh, r, c))}</td>`;
    };
    const rowHtml = (r) => `<tr><th class="mv-rn" data-go="${r}" title="Ir para a linha ${r} na planilha">${r}</th>${cfg.cols.map((c) => cellHtml(r, c)).join('')}</tr>`;
    let body = '';
    if (cfg.groupCol) {
      const groups = new Map();
      for (const r of rows) { const g = text(sh, r, cfg.groupCol); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
      let names = [...groups.keys()];
      if (cfg.groupCol === cfg.statusCol && order) names.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      else names.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR', { numeric: true })));
      for (const g of names) {
        const closed = (cfg.collapsed || []).includes(g);
        body += `<tr class="mv-group"><td colspan="${cfg.cols.length + 1}"><button class="mv-tog" data-grp="${esc(g)}">${closed ? '+' : '−'}</button> <b>${g === '' ? '(Vazio)' : esc(g)}</b> <span>${groups.get(g).length}</span></td></tr>`;
        if (!closed) body += groups.get(g).map(rowHtml).join('');
      }
    } else body = rows.map(rowHtml).join('');

    box.innerHTML = `<div class="mv-bar">
        <span class="mv-title">${icon('filterViews', 18)} Minha visualização</span>
        <label>Agrupar por <select class="input" id="mv-group">${colOpt(cfg.groupCol, 'Sem agrupar')}</select></label>
        <label>Ordenar por status <select class="input" id="mv-status">${colOpt(cfg.statusCol, 'Ordem da planilha')}</select></label>
        ${cfg.statusCol ? '<button class="btn btn-sm" id="mv-order">Ordem dos status</button>' : ''}
        <button class="btn btn-sm" id="mv-cols">Colunas e ordem</button>
        <span class="mv-hint">Só você vê. Duplo clique para editar.</span>
        <button class="icon-btn" id="mv-close" title="Fechar e voltar à planilha">${icon('close', 18)}</button>
      </div>
      <div class="mv-table-wrap"><table class="mv-table"><thead><tr><th class="mv-rn">#</th>${cfg.cols.map((c) => { const hs = (sh.colHdr && sh.colHdr[c]) || {}; return `<th style="${hs.bg ? `background:${hs.bg};` : ''}${hs.color ? `color:${hs.color};` : ''}${hs.b ? 'font-weight:700' : ''}">${esc(headerText(sh, c))}</th>`; }).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cfg.cols.length + 1}" class="mv-empty">Nenhuma linha com dados.</td></tr>`}</tbody></table></div>`;
    const w2 = box.querySelector('.mv-table-wrap');
    w2.scrollLeft = scroll[0]; w2.scrollTop = scroll[1];
    box.querySelector('#mv-group').onchange = (e) => { cfg.groupCol = +e.target.value; cfg.collapsed = []; saveCfg(); render(); };
    box.querySelector('#mv-status').onchange = (e) => { cfg.statusCol = +e.target.value; saveCfg(); render(); };
    box.querySelector('#mv-cols').onclick = columnsDialog;
    if (box.querySelector('#mv-order')) box.querySelector('#mv-order').onclick = orderDialog;
    box.querySelector('#mv-close').onclick = close;
  }
  function onClick(e) {
    const tog = e.target.closest('[data-grp]');
    if (tog) {
      const g = tog.dataset.grp;
      cfg.collapsed = cfg.collapsed || [];
      if (cfg.collapsed.includes(g)) cfg.collapsed = cfg.collapsed.filter((x) => x !== g); else cfg.collapsed.push(g);
      saveCfg(); render(); return;
    }
    const go = e.target.closest('[data-go]');
    if (go) { const r = +go.dataset.go; close(); App.grid.select(r, cfg.cols[0] || 1); App.grid.focus(); return; }
    const cb = e.target.closest('.mv-cb');
    if (cb) {
      const r = +cb.dataset.r, c = +cb.dataset.c, sh = sheet();
      const err = App.editGuard && App.editGuard(sh, r, c);
      if (err) return notify(err);
      App.grid.select(r, c, false, true);
      App.toggleCheckboxes([[r, c]]);
    }
  }
  function onDbl(e) {
    const td = e.target.closest('td[data-r]');
    if (!td || td.classList.contains('mv-cb')) return;
    const r = +td.dataset.r, c = +td.dataset.c, sh = sheet();
    const err = App.editGuard && App.editGuard(sh, r, c);
    if (err) return notify(err);
    const input = document.createElement('input');
    input.className = 'mv-input';
    input.value = App.raw(sh, r, c);
    td.textContent = '';
    td.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save && input.value !== App.raw(sh, r, c)) {
        if (!App.validate(sh, r, c, input.value) && App.dvAt(sh, r, c) && App.dvAt(sh, r, c).reject) { notify('Valor inválido para esta célula.'); render(); return; }
        App.change('Editar', () => App.setRaw(sh, r, c, input.value));
      }
      render();
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); ev.stopPropagation(); });
    input.addEventListener('blur', () => commit(true));
  }

  // ---------- Diálogos ----------
  function listEditor(title, hint, items, onSave) {
    // items: [{ id, label, on }] — on === undefined: sem caixa de marcar
    const m = App.ui.modal({
      title, width: '480px', cls: 'modal-tall', enterSubmits: false,
      body: `<p class="sp-hint">${hint}</p><div class="mv-list"></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => onSave(items) }],
    });
    const list = m.el.querySelector('.mv-list');
    const draw = () => {
      list.innerHTML = items.map((it, i) => `<div class="mv-li">${it.on !== undefined ? `<input type="checkbox" data-on="${i}"${it.on ? ' checked' : ''}>` : ''}<span>${esc(it.label)}</span>
        <button class="icon-btn" data-up="${i}" title="Subir"${i === 0 ? ' disabled' : ''}>▲</button><button class="icon-btn" data-down="${i}" title="Descer"${i === items.length - 1 ? ' disabled' : ''}>▼</button></div>`).join('');
      list.querySelectorAll('[data-on]').forEach((x) => (x.onchange = () => { items[+x.dataset.on].on = x.checked; }));
      list.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }));
      list.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { const i = +b.dataset.down; [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); }));
    };
    draw();
    return { el: m.el, draw };
  }
  function columnsDialog() {
    const sh = sheet();
    const all = []; for (let c = 1; c <= lastCol(sh); c++) if (canSee(sh, c)) all.push(c);
    const items = cfg.cols.map((c) => ({ id: c, on: true })).concat(all.filter((c) => !cfg.cols.includes(c)).map((c) => ({ id: c, on: false })));
    items.forEach((it) => { const h = headerText(sh, it.id); it.label = E.numToCol(it.id) + (h !== E.numToCol(it.id) ? ' · ' + h : ''); });
    const ed = listEditor('Colunas e ordem', 'Marque as colunas que quer ver e use as setas para mudar a ordem. Aparecem só as colunas liberadas para você.', items, (list) => {
      const cols = list.filter((x) => x.on).map((x) => x.id);
      if (!cols.length) { notify('Escolha pelo menos uma coluna.'); return false; }
      cfg.cols = cols; saveCfg(); render();
    });
    const extra = document.createElement('label');
    extra.className = 'check';
    extra.innerHTML = `<input type="checkbox" id="mv-head"${cfg.header ? ' checked' : ''}> A linha 1 é o cabeçalho (não entra nos dados)`;
    ed.el.querySelector('.modal-body').appendChild(extra);
    extra.querySelector('input').onchange = (e) => { cfg.header = e.target.checked ? 1 : 0; };
  }
  function orderDialog() {
    const sh = sheet();
    const items = statusOrder(sh).map((v) => ({ id: v, label: v === '' ? '(Vazio)' : v }));
    const ed = listEditor('Ordem dos status', 'Os status de cima aparecem primeiro. Quando uma linha muda de status, ela muda de lugar na hora.', items, (list) => {
      cfg.statusOrder = list.map((x) => x.id); saveCfg(); render();
    });
    const b = document.createElement('button');
    b.className = 'btn btn-sm'; b.textContent = 'Finalizados primeiro';
    b.onclick = () => { items.sort((x, y) => isFinal(y.id) - isFinal(x.id)); ed.draw(); };
    ed.el.querySelector('.modal-body').appendChild(b);
  }

  // ---------- Abrir / fechar ----------
  function show() {
    ensureBox();
    open = true;
    cfg = null;
    box.hidden = false;
    document.body.classList.add('myview-on');
    render();
  }
  function close() {
    open = false;
    if (box) box.hidden = true;
    document.body.classList.remove('myview-on');
    App.grid.layout();
  }
  let t = null;
  App.on('change', (e) => { if (!open || (e && e.view)) return; clearTimeout(t); t = setTimeout(render, 250); });
  App.on('sheet', () => { if (open) { cfg = null; render(); } });
  App.commands.def('myView', 'Minha visualização', () => (open ? close() : show()));
  App.myView = { show, close };
})(window.App);
