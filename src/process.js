// Inserir › Incluir processo (importação): um painel com os dados da abertura do processo e de cada carregamento.
// Cria uma linha por carregamento, sempre 2 linhas depois da última informação da coluna B, com o status NOVO.
(function (App) {
  'use strict';
  const E = App.E;
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);

  const PROC_FIELDS = ['DATA', 'ATENDENTE', 'MODALIDADE', 'DI/DTA', 'ARM', 'DEM', 'CLIENTE', 'REFERENCIA', 'BL', 'NAVIO', 'TERMINAL COLETA', 'ENTREGA', 'ENDEREÇO', 'ARMADOR',
    'TERMINAL DE VAZIO', 'DATA / HORA - DEPOT'];
  // campos que puxam da BASE GERAL (cliente com cidade e endereço; terminais com a cidade)
  const BASE_KIND = { CLIENTE: 'cliente', 'TERMINAL COLETA': 'coleta', 'TERMINAL DE VAZIO': 'vazio' };
  const LOAD_FIELDS = ['CONTAINER', 'TIPO', 'VALORES', 'PESO', 'QTD', 'IMO'];
  const WIDE = new Set(['CLIENTE', 'ENDEREÇO', 'ENTREGA']);
  const HINT = { 'DATA': 'dd/mm/aaaa', 'DATA / HORA - DEPOT': 'dd/mm/aaaa hh:mm' };
  const STATUS_VALUE = 'NOVO';
  // estilos que passam da última linha para as novas (sem cores de status, negrito etc.)
  const KEEP_STYLE = ['nf', 'al', 'va', 'ff', 'fs', 'wrap', 'bd', 'indent'];

  // compara nomes de coluna sem acentos, espaços, pontuação e preposições (TERMINAL DE COLETA = TERMINAL COLETA)
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(DE|DA|DO|DAS|DOS)\b/g, ' ').replace(/[^A-Z0-9]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

  // nome de cada coluna: o nome dado pelo administrador ou, se não houver, o texto do cabeçalho
  function columnMap(sh) {
    const map = new Map();
    const hdrRow = sh.filter && sh.filter.r1 > 0 ? sh.filter.r1 : 1;
    const names = sh.colNames || {};
    const maxC = Math.max(App.usedRange(sh).maxC || 0, ...Object.keys(names).map(Number), 1);
    for (let c = 1; c <= maxC; c++) {
      const label = names[c] || App.raw(sh, hdrRow, c);
      const k = norm(label);
      if (k && !map.has(k)) map.set(k, c);
    }
    return map;
  }
  function findCol(map, field) {
    const k = norm(field);
    if (map.has(k)) return map.get(k);
    for (const [name, c] of map) if (name.startsWith(k) || (k.length > 3 && name.includes(k))) return c;
    return null;
  }
  function statusCol(map) {
    for (const [name, c] of map) if (name === 'STATUS') return c;
    for (const [name, c] of map) if (name.includes('STATUS')) return c;
    return null;
  }
  // última linha com informação na coluna B
  function lastRowB(sh) {
    let last = 0;
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (!p || p.col !== 2) continue;
      const v = sh.cells[a].v;
      if (v !== undefined && v !== null && String(v).trim() !== '' && p.row > last) last = p.row;
    }
    return last;
  }
  // por que a pessoa não pode preencher a coluna (oculta, somente leitura ou protegida)
  function blockedReason(sh, c, r) {
    if (App.colBlocked && App.colBlocked(sh, c)) return 'coluna oculta para você';
    if (App.editGuard) { const err = App.editGuard(sh, r || 2, c, true); if (err) return 'sem permissão para editar'; }
    return null;
  }

  function open() {
    const sh = App.sheet();
    if (!sh) return;
    let info;
    App.withReal(() => {
      const map = columnMap(sh);
      const cols = {};
      for (const f of PROC_FIELDS.concat(LOAD_FIELDS)) cols[f] = findCol(map, f);
      const st = statusCol(map);
      const last = lastRowB(sh);
      const start = Math.max(2, last + 2);
      const dvOf = (c) => (c ? App.dvAt(sh, start, c) || App.dvAt(sh, Math.max(2, last), c) : null);
      const fieldInfo = {};
      for (const f of Object.keys(cols)) {
        const c = cols[f];
        const dv = dvOf(c);
        let items = null;
        if (dv && (dv.type === 'list' || dv.type === 'range')) { try { items = App.dvItems(sh, dv); } catch (e) { items = null; } }
        fieldInfo[f] = { c, dv, items, checkbox: !!(dv && dv.type === 'checkbox'), blocked: c ? blockedReason(sh, c, start) : 'coluna não encontrada' };
      }
      info = { cols, st, last, start, fieldInfo, stBlocked: st ? blockedReason(sh, st, start) : 'coluna STATUS não encontrada' };
    });

    const user = App.cloud && App.cloud.user ? App.cloud.user.name : '';
    const defaults = { DATA: today(), ATENDENTE: user };
    const fi = info.fieldInfo;
    const lists = [];
    const input = (f, idx) => {
      const x = fi[f];
      const id = `pf-${norm(f)}${idx === undefined ? '' : '-' + idx}`;
      const dis = x.blocked ? ' disabled' : '';
      if (x.checkbox) return `<label class="pf-check"><input type="checkbox" id="${id}" data-f="${esc(f)}"${idx === undefined ? '' : ` data-i="${idx}"`}${dis}> Sim</label>`;
      let list = '';
      const fromBase = BASE_KIND[f] && App.baseSuggest && App.baseSuggest(BASE_KIND[f], '', true);
      if (x.items && x.items.length && !fromBase) {
        const lid = 'pl-' + norm(f);
        if (!lists.includes(lid)) lists.push(lid);
        list = ` list="${lid}"`;
      }
      const val = idx === undefined && defaults[f] && !x.blocked ? defaults[f] : '';
      const ph = x.blocked ? x.blocked : (x.items && x.items.length) || fromBase ? 'Digite para ver as opções' : HINT[f] || '';
      return `<input class="input" id="${id}" data-f="${esc(f)}"${idx === undefined ? '' : ` data-i="${idx}"`} value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off"${list}${dis}>`;
    };
    const colTag = (f) => (fi[f].c ? `<small class="pf-col">${E.numToCol(fi[f].c)}</small>` : '<small class="pf-col miss">?</small>');
    const missing = PROC_FIELDS.concat(LOAD_FIELDS).filter((f) => !fi[f].c);
    const procOrder = PROC_FIELDS.slice().sort((a, b) => (fi[a].c || 9999) - (fi[b].c || 9999));
    const loadOrder = LOAD_FIELDS.slice().sort((a, b) => (fi[a].c || 9999) - (fi[b].c || 9999));

    const body = `<p class="sp-hint">As linhas são criadas a partir da linha <b>${info.start}</b> (2 linhas depois da última informação da coluna B${info.last ? `, que está na linha ${info.last}` : ''}), uma por carregamento, com o status <b>${STATUS_VALUE}</b>.
        ${missing.length ? `<br><span class="pf-warn">Colunas não encontradas: ${missing.map(esc).join(', ')}. Confira o nome das colunas (cabeçalho).</span>` : ''}
        ${info.stBlocked ? `<br><span class="pf-warn">Status: ${esc(info.stBlocked)} — o status ${STATUS_VALUE} não será preenchido.</span>` : ''}</p>
      <h3 class="pf-h">Abertura do processo</h3>
      <div class="pf-grid">${procOrder.map((f) => `<label class="field${WIDE.has(f) ? ' pf-wide' : ''}${fi[f].blocked ? ' pf-off' : ''}"><span>${esc(f)} ${colTag(f)}</span>${input(f)}</label>`).join('')}</div>
      <h3 class="pf-h">Carregamentos</h3>
      <div class="pf-qty"><label class="field"><span>Quantidade de carregamentos</span><input class="input" id="pf-qtd" type="number" min="1" max="60" value="1"></label>
        <p class="sp-hint">Cada carregamento vira uma linha, com os dados da abertura repetidos.</p></div>
      <div class="pf-loads" id="pf-loads"></div>
      ${lists.map((lid) => { const f = Object.keys(fi).find((k) => 'pl-' + norm(k) === lid); return `<datalist id="${lid}">${(fi[f].items || []).map((it) => `<option value="${esc(it)}">`).join('')}</datalist>`; }).join('')}`;

    const m = App.ui.modal({
      title: 'Incluir processo (importação)', width: 'min(1320px, 97vw)', cls: 'pf-modal', enterSubmits: false,
      body,
      buttons: [{ label: 'Cancelar' }, { label: 'Criar linhas', primary: true, action: (d) => submit(d) }],
    });
    const el = m.el;
    const loadsBox = el.querySelector('#pf-loads');
    let kept = [];
    const readLoads = () => [...loadsBox.querySelectorAll('.pf-load')].map((row) => {
      const o = {};
      row.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
      return o;
    });
    const drawLoads = () => {
      kept = readLoads().length ? readLoads() : kept;
      const n = Math.max(1, Math.min(60, +el.querySelector('#pf-qtd').value || 1));
      loadsBox.innerHTML = `<table class="pf-table"><thead><tr><th>#</th>${loadOrder.map((f) => `<th>${esc(f)} ${colTag(f)}${fi[f].blocked ? '' : ` <button class="pf-rep" data-rep="${esc(f)}" title="Repetir o valor do 1º carregamento em todos">⇣</button>`}</th>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: n }, (_, i) => `<tr class="pf-load"><td class="pf-n">${i + 1}</td>${loadOrder.map((f) => `<td>${input(f, i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      // mantém o que já foi digitado
      loadsBox.querySelectorAll('.pf-load').forEach((row, i) => {
        const o = kept[i];
        if (!o) return;
        row.querySelectorAll('[data-f]').forEach((inp) => { const v = o[inp.dataset.f]; if (v === undefined) return; if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v; });
      });
      loadsBox.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = (e) => {
        e.preventDefault();
        const f = b.dataset.rep;
        const all = [...loadsBox.querySelectorAll(`[data-f="${CSS.escape(f)}"]`)];
        const first = all[0];
        all.slice(1).forEach((i) => { if (i.type === 'checkbox') i.checked = first.checked; else i.value = first.value; });
      }));
      loadsBox.querySelectorAll('[data-f="CONTAINER"]').forEach((i) => {
        i.oninput = () => { const p = i.selectionStart; i.value = i.value.toUpperCase().replace(/\s+/g, ''); i.setSelectionRange(p, p); i.classList.toggle('pf-bad', !!i.value && !/^[A-Z]{4}\d{7}$/.test(i.value)); };
        i.title = 'Formato: 4 letras e 7 números (ex.: MSCU1234567)';
      });
    };
    el.querySelector('#pf-qtd').oninput = drawLoads;
    drawLoads();
    // lista da BASE GERAL nos campos de cliente e terminais (igual ao menu suspenso da planilha)
    const picked = {};
    let pop = null, popOwner = null;
    const closePop = (owner) => { if (pop && (!owner || owner === popOwner)) { pop.remove(); pop = null; popOwner = null; } };
    const setField = (f, v) => { const i = el.querySelector(`.pf-grid [data-f="${CSS.escape(f)}"]`); if (i && !i.disabled && v) i.value = v; };
    for (const f of Object.keys(BASE_KIND)) {
      const inp = el.querySelector(`.pf-grid [data-f="${CSS.escape(f)}"]`);
      if (!inp || inp.disabled || !App.baseSuggest || !App.baseSuggest(BASE_KIND[f], '', true)) continue;
      let idx = 0, items = [];
      const draw = (all) => {
        items = App.baseSuggest(BASE_KIND[f], inp.value, all) || [];
        closePop();
        if (!items.length) return;
        pop = document.createElement('div');
        pop.className = 'pf-sug';
        popOwner = inp;
        pop.innerHTML = items.map((x, i) => `<div class="pf-sug-i${i === idx ? ' on' : ''}" data-i="${i}"><b>${esc(x.name)}</b><small>${esc(BASE_KIND[f] === 'cliente' ? [x.kind, x.city, x.addr].filter(Boolean).join(' · ') : (x.city ? 'Cidade: ' + x.city : ''))}</small></div>`).join('');
        const r = inp.getBoundingClientRect();
        pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 2 + 'px'; pop.style.minWidth = Math.max(260, r.width) + 'px';
        el.appendChild(pop);
        pop.querySelectorAll('.pf-sug-i').forEach((it) => (it.onmousedown = (e) => { e.preventDefault(); choose(items[+it.dataset.i]); }));
        const on = pop.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      };
      const choose = (x) => {
        if (!x) return;
        inp.value = x.name;
        picked[f] = x;
        if (BASE_KIND[f] === 'cliente') { setField('ENTREGA', x.city); setField('ENDEREÇO', x.addr); }
        closePop();
      };
      inp.addEventListener('focus', () => { idx = 0; draw(!inp.value); });
      inp.addEventListener('input', () => { idx = 0; delete picked[f]; draw(false); });
      inp.addEventListener('blur', () => setTimeout(() => closePop(inp), 120));
      inp.addEventListener('keydown', (e) => {
        if (!pop) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); draw(!inp.value); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(!inp.value); }
        else if (e.key === 'Enter' || e.key === 'Tab') { if (items[idx]) { e.preventDefault(); choose(items[idx]); } }
        else if (e.key === 'Escape') { e.stopPropagation(); closePop(); }
      });
    }
    el.querySelector('.modal-body').addEventListener('scroll', closePop);
    const first = el.querySelector('.pf-grid input:not([disabled])');
    if (first) setTimeout(() => first.focus(), 30);

    function submit(d) {
      const proc = {};
      d.querySelectorAll('.pf-grid [data-f]').forEach((i) => { proc[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
      const loads = readLoads();
      const filled = Object.values(proc).some((v) => v && v !== defaults.DATA && v !== defaults.ATENDENTE) || loads.some((o) => Object.values(o).some((v) => v === true || (typeof v === 'string' && v.trim())));
      if (!filled) { notify('Preencha os dados do processo antes de criar as linhas.'); return false; }
      const badCont = loads.map((o) => o.CONTAINER).filter((v) => v && !/^[A-Z]{4}\d{7}$/.test(v));
      if (badCont.length && !d.dataset.okCont) {
        d.dataset.okCont = '1';
        notify(`Container fora do padrão (4 letras + 7 números): ${badCont.join(', ')}. Clique em "Criar linhas" de novo para criar mesmo assim.`);
        return false;
      }
      const sh = App.sheet();
      const start = Math.max(2, lastRowB(sh) + 2); // recalcula: alguém pode ter incluído linhas enquanto o painel estava aberto
      const end = start + loads.length - 1;
      if (end > sh.rows && App.adminOnly && App.adminOnly()) { notify(`A página só tem ${sh.rows} linhas. Peça a um administrador para adicionar mais linhas.`); return false; }
      const tpl = info.last;
      const write = (r, c, value, f) => {
        if (!c || fi[f] && fi[f].blocked) return;
        const x = fi[f] || {};
        let v = value;
        if (x.checkbox) { const cv = App.cbValues(x.dv); v = value ? cv.on : cv.off; }
        if (v === undefined || v === null || (v === '' && !x.checkbox)) return;
        App.setRaw(sh, r, c, String(v));
        const st = App.style(sh, r, c);
        if (!st.nf && typeof v === 'string') { const fm = App.autoFormatFor(v); if (fm) App.setStyle(sh, r, c, (s) => { s.nf = fm; }); }
      };
      const ok = App.change('Incluir processo', () => App.withReal(() => {
        if (end > sh.rows) sh.rows = end + 10;
        for (let i = 0; i < loads.length; i++) {
          const r = start + i;
          // formatação da última linha (bordas, formato de número, alinhamento) passa para as novas
          if (tpl) {
            const usedC = Math.max(App.usedRange(sh).maxC || 0, info.st || 0);
            for (let c = 1; c <= usedC; c++) {
              const s = App.style(sh, tpl, c);
              const keep = {};
              for (const k of KEEP_STYLE) if (s[k] !== undefined) keep[k] = JSON.parse(JSON.stringify(s[k]));
              if (Object.keys(keep).length) App.setStyle(sh, r, c, (t) => Object.assign(t, keep));
            }
          }
          for (const f of PROC_FIELDS) write(r, info.cols[f], proc[f], f);
          for (const f of ['TERMINAL COLETA', 'TERMINAL DE VAZIO']) {
            const pk = picked[f], c = info.cols[f];
            if (pk && pk.city && c && !(fi[f] && fi[f].blocked) && proc[f] === pk.name) { const a = E.addrToStr(r, c); if (sh.cells[a]) sh.cells[a].city = pk.city; }
          }
          for (const f of LOAD_FIELDS) write(r, info.cols[f], loads[i][f], f);
          if (info.st && !info.stBlocked) App.setRaw(sh, r, info.st, STATUS_VALUE);
        }
      }));
      if (ok === false) return false;
      // mostra as linhas novas
      const p = App.dispCell ? App.dispCell(start, 1) : { r: start, c: 1 };
      if (p) { App.grid.selectRange({ r1: p.r, c1: 1, r2: p.r + loads.length - 1, c2: Math.max(1, App.usedRange(sh).maxC) }); App.grid.reveal(p.r, 1); }
      notify(`Processo incluído: ${loads.length} ${loads.length === 1 ? 'linha criada (linha ' + start + ')' : 'linhas criadas (' + start + ' a ' + end + ')'}, status ${STATUS_VALUE}.`);
      return true;
    }
  }

  App.commands.def('insertProcess', 'Incluir processo', open);
  App.processFields = { PROC_FIELDS, LOAD_FIELDS, norm };
  // usado também por outras funções (ex.: Escalar veículo): coluna pelo nome
  App.colByName = (sh, name) => App.withReal(() => findCol(columnMap(sh), name));
  App.normName = norm;
})(window.App);
