// ALERTA: botão no centro do cabeçalho com tudo o que precisa de atenção, conforme regras criadas pelo administrador.
// Cada regra fica na página que ela olha (sheet.alertRules) e pode valer para todos ou só para alguns setores/pessoas.
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = App.esc, E = App.E, doc = App.doc;
  const notify = (m) => App.emit('notify', m);
  const icon = (n, s) => App.icon(n, s);
  const norm = (s) => (window.Perms && window.Perms.normName ? window.Perms.normName(s) : String(s || '').toUpperCase());

  // regras prontas (usam as marcações que a planilha já tem)
  const BUILTIN = {
    crit: { label: 'Container crítico (até a chegada no cliente)', msg: 'Container crítico' },
    deadline: { label: 'ARM ou DEM vencendo (hoje ou amanhã)', msg: 'ARM/DEM vencendo' },
    pending: { label: 'Escala aguardando confirmação', msg: 'Escala aguardando confirmação' },
    swap: { label: 'Pedido de troca de veículo', msg: 'Pedido de troca de veículo' },
    prog: { label: 'PROG. duplicado', msg: 'PROG. duplicado' },
    frete: { label: 'FRETE faltando (cavalo de terceiro)', msg: 'Preencher o FRETE' },
    vehicle: { label: 'Veículo incompleto (falta CARRETA, MOTORISTA, CPF ou CONTATO)', msg: 'Veículo incompleto' },
    demurrage: { label: 'Demurrage do vazio vencida ou vencendo (até 2 dias)', msg: 'Devolver o vazio: DATA BAIXA + DEMMURAGE' },
  };
  // condições da regra personalizada
  const OPS = [
    ['empty', 'está vazia'], ['notEmpty', 'não está vazia'], ['eq', 'é igual a'], ['neq', 'é diferente de'], ['contains', 'contém'], ['notContains', 'não contém'],
    ['gt', 'é maior que'], ['lt', 'é menor que'], ['today', 'é a data de hoje'], ['within', 'data vence em até (dias)'], ['past', 'data já passou'], ['dup', 'está repetida em outra linha'],
  ];
  const NEEDS_VAL = new Set(['eq', 'neq', 'contains', 'notContains', 'gt', 'lt', 'within']);
  const COLORS = ['#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#8e24aa', '#5f6368'];

  const perms = () => (App.cloudMode && App.cloud && App.cloud.perms) || null;
  const isAdmin = () => { const p = perms(); return !p || p.admin; };
  const canSee = (rule) => { const p = perms(); if (!p || p.admin) return true; return !rule.who || !rule.who.length || window.Perms.inList(rule.who, p); };

  // ---------- Avaliação ----------
  const today = () => { const d = new Date(); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - E.EPOCH) / 86400000; };
  function dateOf(v) {
    if (typeof v === 'number') return Math.floor(v);
    const s = String(v || '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(s);
    if (!m) return null;
    const now = new Date();
    let y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    let d = (Date.UTC(y, +m[2] - 1, +m[1]) - E.EPOCH) / 86400000;
    // dd/mm sem ano: o ano mais perto de hoje
    if (!m[3]) { const t = today(); const alt = [d - 365, d + 365].find((x) => Math.abs(x - t) < Math.abs(d - t)); if (alt !== undefined) d = (Date.UTC(y + (alt > d ? 1 : -1), +m[2] - 1, +m[1]) - E.EPOCH) / 86400000; }
    return d;
  }
  const numOf = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.')));
  function testCond(cond, txt, raw, dupSet) {
    const t = txt.trim(), low = t.toLowerCase(), val = String(cond.val || '').trim().toLowerCase();
    switch (cond.op) {
      case 'empty': return t === '';
      case 'notEmpty': return t !== '';
      case 'eq': return low === val;
      case 'neq': return low !== val;
      case 'contains': return t !== '' && low.includes(val);
      case 'notContains': return !low.includes(val);
      case 'gt': return t !== '' && numOf(raw) > numOf(cond.val);
      case 'lt': return t !== '' && numOf(raw) < numOf(cond.val);
      case 'today': { const d = dateOf(raw); return d !== null && d === today(); }
      case 'within': { const d = dateOf(raw); const n = numOf(cond.val) || 0; return d !== null && d >= today() && d <= today() + n; }
      case 'past': { const d = dateOf(raw); return d !== null && d < today(); }
      case 'dup': return t !== '' && dupSet.has(low);
    }
    return false;
  }
  const colOf = (sh, name) => (App.colByName ? App.colByName(sh, name) : null);
  function keyCols(sh, rule) {
    if (rule.show && rule.show.length) return rule.show.filter((c) => c >= 1);
    return ['CONTAINER', 'CLIENTE', 'REFERENCIA'].map((n) => colOf(sh, n)).filter(Boolean).slice(0, 2);
  }
  // linhas que disparam a regra: [{ r, cols }]
  function evalRule(sh, si, rule) {
    const out = [];
    App.withReal(() => {
      const used = App.usedRange(sh);
      const named = !!(sh.colNames && Object.keys(sh.colNames).length);
      const r0 = Math.max(1, rule.from || (named ? 1 : 2));
      const txt = (r, c) => { const v = App.value(si, r, c); return v === null || v === undefined || E.isErr(v) ? '' : String(App.fmtValue(v, App.style(sh, r, c).nf)); };
      const tc = window.Perms.escalaCols(sh);
      let test;
      if (rule.kind && rule.kind !== 'cond') {
        const k = rule.kind;
        if (k === 'crit') { const c = App.critCol(sh); test = (r) => !!(sh.cells[E.addrToStr(r, c)] || {}).crit && !(App.rowArrived && App.rowArrived(sh, si, r)); }
        else if (k === 'deadline') { const cs = ['ARM', 'DEM'].map((n) => colOf(sh, n)).filter(Boolean); test = (r) => cs.some((c) => App.deadlineAlert && App.deadlineAlert(sh, si, r, c)); }
        else if (k === 'pending') test = (r) => tc.CAVALO && (sh.cells[E.addrToStr(r, tc.CAVALO)] || {}).esc === 'p' && txt(r, tc.CAVALO).trim() !== '';
        else if (k === 'swap') test = (r) => tc.CAVALO && !!(sh.cells[E.addrToStr(r, tc.CAVALO)] || {}).swap;
        else if (k === 'prog') { const c = colOf(sh, 'PROG'); test = (r) => c && App.progDuplicates && !!App.progDuplicates(sh, si, r, c); }
        else if (k === 'frete') { const c = colOf(sh, 'FRETE'); test = (r) => c && App.freteAlert && App.freteAlert(sh, si, r, c); }
        else if (k === 'vehicle') test = (r) => App.vehicleMissingFields && App.vehicleMissingFields(sh, si, r).length > 0;
        else if (k === 'demurrage') test = (r) => !!(App.demurrageInfo && App.demurrageInfo(sh, si, r));
        else return;
      } else {
        const conds = (rule.conds || []).filter((x) => x.col >= 1 && x.op);
        if (!conds.length) return;
        // colunas usadas em "repetida": valores que aparecem mais de uma vez
        const dups = new Map();
        for (const cd of conds) if (cd.op === 'dup' && !dups.has(cd.col)) {
          const cnt = new Map();
          for (let r = r0; r <= used.maxR; r++) { const t = txt(r, cd.col).trim().toLowerCase(); if (t) cnt.set(t, (cnt.get(t) || 0) + 1); }
          dups.set(cd.col, new Set([...cnt].filter(([, n]) => n > 1).map(([t]) => t)));
        }
        // a linha precisa ter algum dado (não avisa linhas vazias)
        test = (r) => {
          let any = false;
          for (let c = 1; c <= Math.min(used.maxC, 60) && !any; c++) if (txt(r, c).trim()) any = true;
          if (!any) return false;
          const res = conds.map((cd) => testCond(cd, txt(r, cd.col), App.value(si, r, cd.col), dups.get(cd.col) || new Set()));
          return rule.any ? res.some(Boolean) : res.every(Boolean);
        };
      }
      const kc = keyCols(sh, rule);
      const hits = [];
      for (let r = r0; r <= used.maxR && hits.length < 1000; r++) {
        let hit = false;
        try { hit = test(r); } catch (e) { hit = false; }
        if (hit) hits.push(r);
      }
      // rodotrem (2 linhas com a mesma placa): conta como 1 alerta só
      const hitSet = new Set(hits), done = new Set();
      const pair = tc.CAVALO && App.escala && App.escala.withPair;
      for (const r of hits) {
        if (done.has(r) || out.length >= 500) continue;
        let rows = [r];
        if (pair) { try { rows = rows.concat(pair(sh, [r]).filter((x) => x !== r && hitSet.has(x) && !done.has(x))); } catch (e) { /* sem par */ } }
        rows.forEach((x) => done.add(x));
        const cols = kc.map((c) => ({ c, t: [...new Set(rows.map((x) => txt(x, c)).filter(Boolean))].join(' / ') })).filter((x) => x.t);
        out.push({ r, rows, rodo: rows.length > 1, cols });
      }
    });
    return out;
  }
  let last = { list: [], total: 0 };
  function evaluate() {
    const list = [];
    doc.sheets.forEach((sh, si) => {
      if (sh.shadow) return;
      // demurrage do vazio entra sozinha no ALERTA (sem precisar criar a regra)
      const auto = App.demurrageCols && App.demurrageCols(sh) && !(sh.alertRules || []).some((x) => x.kind === 'demurrage')
        ? [{ id: 'auto-demurrage', name: 'Demurrage do vazio', kind: 'demurrage', color: '#e8710a', msg: 'Vencida ou vencendo em até 2 dias (DATA BAIXA + DEMMURAGE). Devolver o vazio.', who: [], show: [] }] : [];
      for (const rule of (sh.alertRules || []).concat(auto)) {
        if (rule.off || !canSee(rule)) continue;
        const rows = evalRule(sh, si, rule);
        if (rows.length) list.push({ sh, si, rule, rows });
      }
    });
    last = { list, total: list.reduce((s, x) => s + x.rows.length, 0) };
    if (App.reportaAlertas) App.reportaAlertas(list);
    renderButton();
    renderTicker();
    if (panel && !panel.hidden) renderPanel();
    return last;
  }
  App.alerts = { evaluate, evalRule, BUILTIN };

  // ---------- Botão no centro do cabeçalho ----------
  let btn = null;
  function renderButton() {
    if (!btn) return;
    const any = doc.sheets.some((s) => (s.alertRules || []).length);
    btn.hidden = !any && !isAdmin();
    btn.classList.toggle('on', last.total > 0);
    btn.querySelector('.al-n').textContent = last.total > 999 ? '999+' : String(last.total);
    btn.querySelector('.al-n').hidden = !last.total;
    btn.title = last.total ? `${last.total} ${last.total === 1 ? 'alerta' : 'alertas'} — clique para ver` : 'Nenhum alerta agora';
    if (btn.hidden && ticker) ticker.hidden = true;
  }

  // ---------- Letreiro ao lado do botão: os alertas do momento passando ----------
  let ticker = null, tickerSig = '';
  function renderTicker() {
    if (!btn) return;
    if (!ticker) {
      ticker = document.createElement('div');
      ticker.id = 'al-ticker';
      ticker.className = 'al-ticker';
      ticker.innerHTML = '<div class="al-track"></div>';
      btn.parentNode.appendChild(ticker);
      ticker.addEventListener('click', (e) => {
        const it = e.target.closest('.al-tk');
        if (!it) return togglePanel();
        const g = last.list[+it.dataset.g];
        if (!g) return;
        const c = (g.rule.conds && g.rule.conds[0] && g.rule.conds[0].col) || (g.rows[0].cols[0] || {}).c || 1;
        goTo(g.sh, +it.dataset.r, c);
      });
      window.addEventListener('resize', placeTicker);
    }
    const items = [];
    last.list.forEach((g, gi) => g.rows.slice(0, 40).forEach((x) => items.push(`<button class="al-tk" data-g="${gi}" data-r="${x.r}" style="--al:${esc(g.rule.color || '#d93025')}"><b>${esc(g.rule.name)}</b> <span>${x.rodo ? 'Linhas ' + x.rows.join(' e ') + ' (rodotrem)' : 'Linha ' + x.r}${x.cols.length ? ' · ' + x.cols.map((y) => esc(y.t.slice(0, 30))).join(' · ') : ''}</span></button>`)));
    const sig = items.join('');
    ticker.hidden = !items.length;
    if (sig !== tickerSig) {
      tickerSig = sig;
      const track = ticker.querySelector('.al-track');
      // o conteúdo vai duas vezes, para o letreiro rodar sem emenda
      track.innerHTML = `<div class="al-run">${sig}</div><div class="al-run" aria-hidden="true">${sig}</div>`;
      requestAnimationFrame(() => {
        const w = track.firstChild ? track.firstChild.scrollWidth : 0;
        track.style.animationDuration = Math.max(12, Math.round(w / 55)) + 's';
      });
    }
    placeTicker();
  }
  // entre o botão ALERTA e os botões da direita; some quando não há espaço
  function placeTicker() {
    if (!ticker || !btn || ticker.hidden && !last.total) return;
    const bar = btn.parentNode, right = bar.querySelector('.appbar-right');
    const b = bar.getBoundingClientRect(), a = btn.getBoundingClientRect();
    const lim = right ? right.getBoundingClientRect().left : b.right;
    const left = a.right - b.left + 10, width = Math.min(560, lim - a.right - 20);
    ticker.style.left = left + 'px';
    ticker.style.width = Math.max(0, width) + 'px';
    ticker.classList.toggle('al-off', width < 90 || !last.total);
  }

  // ---------- Painel com os alertas ----------
  let panel = null;
  function goTo(sh, r, c) {
    const i = doc.sheets.indexOf(sh);
    if (i < 0) return;
    if (i !== doc.active) App.run('switchSheet', i);
    let rr = r, cc = c || 1;
    if (App.vm && App.dispCell) { const d = App.dispCell(r, cc); if (!d) return notify('A linha está escondida pela sua visualização com filtro.'); rr = d.r; cc = d.c; }
    App.grid.select(rr, cc);
    App.grid.focus();
  }
  function renderPanel() {
    const body = panel.querySelector('.al-body');
    const q = (panel.querySelector('#al-q') || {}).value || '';
    const k = q.trim().toLowerCase();
    if (!last.list.length) {
      body.innerHTML = `<p class="al-empty">✅ Nenhum alerta agora.</p>${isAdmin() && !doc.sheets.some((s) => (s.alertRules || []).length) ? '<p class="sp-hint">Ainda não há regras. Clique em "Regras" para criar.</p>' : ''}`;
      return;
    }
    body.innerHTML = last.list.map((g, gi) => {
      const rows = g.rows.filter((x) => !k || x.cols.some((y) => y.t.toLowerCase().includes(k)) || (x.rows || [x.r]).some((n) => String(n).includes(k)) || g.rule.name.toLowerCase().includes(k));
      if (!rows.length) return '';
      return `<section class="al-group" style="--al:${esc(g.rule.color || '#d93025')}"><div class="al-gh"><b>${esc(g.rule.name)}</b><span class="al-cnt">${rows.length}</span><small>${esc(g.sh.name)}</small></div>
        ${g.rule.msg ? `<p class="al-msg">${esc(g.rule.msg)}</p>` : ''}
        <div class="al-rows">${rows.slice(0, 200).map((x) => `<button class="al-row" data-g="${gi}" data-r="${x.r}"><span class="al-ln">${x.rodo ? `Linhas ${x.rows.join(' e ')} <i class="al-rodo">rodotrem</i>` : `Linha ${x.r}`}</span>${x.cols.map((y) => `<span class="al-v">${esc(y.t.slice(0, 40))}</span>`).join('')}</button>`).join('')}
        ${rows.length > 200 ? `<p class="sp-hint">+ ${rows.length - 200} linhas</p>` : ''}</div></section>`;
    }).join('') || '<p class="sp-hint">Nada encontrado.</p>';
    body.querySelectorAll('.al-row').forEach((b) => (b.onclick = () => { const g = last.list[+b.dataset.g]; const c = (g.rule.conds && g.rule.conds[0] && g.rule.conds[0].col) || (g.rows[0].cols[0] || {}).c || 1; goTo(g.sh, +b.dataset.r, c); }));
  }
  function togglePanel() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'al-panel';
      panel.innerHTML = `<div class="al-head"><b>${icon('bell', 18)} ALERTA</b><input class="input al-q" id="al-q" placeholder="Procurar (container, cliente, linha…)" autocomplete="off">
        ${isAdmin() ? '<button class="btn btn-sm" id="al-rules">Regras</button>' : ''}<button class="icon-btn" id="al-x" title="Fechar">${icon('close', 18)}</button></div><div class="al-body"></div>`;
      document.body.appendChild(panel);
      panel.querySelector('#al-x').onclick = () => { panel.hidden = true; };
      const qi = panel.querySelector('#al-q');
      qi.oninput = renderPanel;
      qi.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') panel.hidden = true; };
      const rb = panel.querySelector('#al-rules');
      if (rb) rb.onclick = () => App.run('alertRules');
      panel.hidden = true;
    }
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { evaluate(); renderPanel(); }
  }

  // ---------- Regras (administrador) ----------
  function rulesDialog() {
    if (!isAdmin()) return notify('Somente administradores criam as regras de alerta.');
    const all = () => doc.sheets.flatMap((sh) => (sh.alertRules || []).map((rule) => ({ sh, rule })));
    const m = App.ui.modal({
      title: 'Regras de alerta', width: '720px', enterSubmits: false,
      body: `<p class="sp-hint">Cada regra olha uma página e mostra no ALERTA as linhas que precisam de atenção. Escolha quem vê cada regra (setores ou pessoas); sem escolha, todos veem.</p>
        <div id="ar-list"></div><button class="btn" id="ar-new">${icon('plus', 16)} Nova regra</button>`,
      buttons: [{ label: 'Fechar', primary: true }],
    });
    let who = { sectors: [], people: [] };
    if (App.whoOptions) App.whoOptions().then((w) => { who = w; draw(); }).catch(() => {});
    const box = m.el.querySelector('#ar-list');
    const draw = () => {
      const list = all();
      box.innerHTML = list.length ? list.map(({ sh, rule }, i) => `<div class="cf-item ar-item${rule.off ? ' off' : ''}"><span class="cf-chip" style="background:${esc(rule.color || '#d93025')}">&nbsp;</span>
        <div><b>${esc(rule.name)}</b><small>${esc(sh.name)} · ${esc(rule.kind && rule.kind !== 'cond' ? BUILTIN[rule.kind].label : describe(sh, rule))} · ${rule.who && rule.who.length ? 'vê: ' + esc(rule.who.map((id) => App.whoName ? App.whoName(id, who) : id).join(', ')) : 'todos veem'}</small></div>
        <label class="inline ar-on" title="Ligar/desligar"><input type="checkbox" data-on="${i}"${rule.off ? '' : ' checked'}> ativa</label>
        <button class="btn btn-sm" data-ed="${i}">Editar</button><button class="icon-btn" data-del="${i}" title="Excluir">${icon('close', 16)}</button></div>`).join('')
        : '<p class="sp-hint">Nenhuma regra ainda.</p>';
      box.querySelectorAll('[data-on]').forEach((b) => (b.onchange = () => { const { sh, rule } = all()[+b.dataset.on]; App.change('Regra de alerta', () => { const x = sh.alertRules.find((y) => y.id === rule.id); if (b.checked) delete x.off; else x.off = true; }); evaluate(); draw(); }));
      box.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { const x = all()[+b.dataset.ed]; editRule(x.sh, x.rule, who, draw); }));
      box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { const { sh, rule } = all()[+b.dataset.del]; App.change('Excluir regra de alerta', () => { sh.alertRules = sh.alertRules.filter((y) => y.id !== rule.id); if (!sh.alertRules.length) delete sh.alertRules; }); evaluate(); draw(); }));
    };
    m.el.querySelector('#ar-new').onclick = () => editRule(App.sheet(), null, who, draw);
    draw();
  }
  function describe(sh, rule) {
    const lbl = (c) => (App.colLabelOf ? App.colLabelOf(sh, c) : E.numToCol(c));
    return (rule.conds || []).map((cd) => `${lbl(cd.col)} ${(OPS.find((o) => o[0] === cd.op) || [, cd.op])[1]}${NEEDS_VAL.has(cd.op) ? ' "' + cd.val + '"' : ''}`).join(rule.any ? ' OU ' : ' E ') || 'sem condição';
  }
  function editRule(sh0, rule, who, done) {
    const isNew = !rule;
    const r = JSON.parse(JSON.stringify(rule || { id: App.uid(), name: '', kind: 'cond', conds: [{ col: 0, op: 'notEmpty', val: '' }], color: '#d93025', who: [], show: [] }));
    let sh = sh0;
    const colsOf = (s) => { const used = App.usedRange(s); const n = Math.max(1, used.maxC, ...Object.keys(s.colNames || {}).map(Number)); const out = []; for (let c = 1; c <= Math.min(n, 200); c++) out.push(c); return out; };
    const colOpts = (s, sel) => '<option value="0">Coluna…</option>' + colsOf(s).map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(App.colLabelOf ? App.colLabelOf(s, c) : E.numToCol(c))}</option>`).join('');
    const m = App.ui.modal({
      title: isNew ? 'Nova regra de alerta' : 'Editar regra de alerta', width: '640px', enterSubmits: false,
      body: `<label class="field"><span>Nome do alerta</span><input class="input" id="re-name" value="${esc(r.name)}" placeholder="Ex.: Container sem motorista"></label>
        <div class="field-row"><label class="field"><span>Página</span><select class="input" id="re-sheet">${doc.sheets.filter((s) => !s.shadow).map((s) => `<option value="${esc(s.id)}"${s === sh ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Tipo</span><select class="input" id="re-kind"><option value="cond"${r.kind === 'cond' ? ' selected' : ''}>Condições nas colunas (personalizada)</option>${Object.keys(BUILTIN).map((k) => `<option value="${k}"${r.kind === k ? ' selected' : ''}>${esc(BUILTIN[k].label)}</option>`).join('')}</select></label></div>
        <div id="re-conds"></div>
        <label class="field"><span>Mensagem (opcional)</span><input class="input" id="re-msg" value="${esc(r.msg || '')}" placeholder="Ex.: Escalar o veículo antes das 16h"></label>
        <div class="field-row"><label class="field"><span>Mostrar no alerta as colunas</span><select class="input" id="re-show1">${colOpts(sh, (r.show || [])[0] || 0)}</select></label><label class="field"><span>&nbsp;</span><select class="input" id="re-show2">${colOpts(sh, (r.show || [])[1] || 0)}</select></label></div>
        <p class="sp-label">Cor</p><div class="re-colors">${COLORS.map((c) => `<button class="sw${c === r.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
        <p class="sp-label">Quem vê este alerta (sem escolher ninguém = todos)</p><div id="re-who">${App.whoBoxes ? App.whoBoxes('rw', r.who || [], who) : ''}</div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar regra', primary: true, action: (d) => {
        r.name = d.querySelector('#re-name').value.trim();
        if (!r.name) { notify('Dê um nome para o alerta.'); return false; }
        r.kind = d.querySelector('#re-kind').value;
        r.msg = d.querySelector('#re-msg').value.trim();
        r.show = [+d.querySelector('#re-show1').value, +d.querySelector('#re-show2').value].filter((x) => x > 0);
        r.who = [...d.querySelectorAll('[data-rw]')].filter((x) => x.checked).map((x) => x.dataset.rw);
        if (r.kind === 'cond') {
          r.conds = r.conds.filter((x) => x.col > 0);
          if (!r.conds.length) { notify('Escolha ao menos uma coluna e condição.'); return false; }
        } else delete r.conds;
        const target = doc.sheets.find((s) => s.id === d.querySelector('#re-sheet').value) || sh;
        App.change(isNew ? 'Nova regra de alerta' : 'Editar regra de alerta', () => {
          for (const s of doc.sheets) if (s.alertRules && s.alertRules.some((y) => y.id === r.id)) { s.alertRules = s.alertRules.filter((y) => y.id !== r.id); if (!s.alertRules.length) delete s.alertRules; }
          target.alertRules = (target.alertRules || []).concat([r]);
        });
        evaluate();
        if (done) done();
        const n = evalRule(target, doc.sheets.indexOf(target), r).length;
        notify(`Regra "${r.name}" salva. Agora: ${n} ${n === 1 ? 'linha' : 'linhas'} em alerta.`);
      } }],
    });
    const d = m.el;
    const drawConds = () => {
      const box = d.querySelector('#re-conds');
      if (d.querySelector('#re-kind').value !== 'cond') { box.innerHTML = '<p class="sp-hint">Usa as marcações que a planilha já faz (piscando ou destacadas).</p>'; return; }
      box.innerHTML = `<p class="sp-label">Condições</p>${r.conds.map((cd, i) => `<div class="re-cond" data-i="${i}">${i ? `<span class="re-join">${r.any ? 'OU' : 'E'}</span>` : '<span class="re-join">SE</span>'}
          <select class="input re-col">${colOpts(sh, cd.col)}</select>
          <select class="input re-op">${OPS.map(([k, t]) => `<option value="${k}"${k === cd.op ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <input class="input re-val" value="${esc(cd.val || '')}" placeholder="valor"${NEEDS_VAL.has(cd.op) ? '' : ' hidden'}>
          <button class="icon-btn re-rm" title="Tirar condição"${r.conds.length < 2 ? ' disabled' : ''}>${icon('close', 14)}</button></div>`).join('')}
        <div class="re-tools"><button class="btn btn-sm" id="re-add">+ Condição</button><label class="inline"><input type="checkbox" id="re-any"${r.any ? ' checked' : ''}> Basta uma condição (OU)</label></div>`;
      box.querySelectorAll('.re-cond').forEach((row) => {
        const i = +row.dataset.i;
        row.querySelector('.re-col').onchange = (e) => { r.conds[i].col = +e.target.value; };
        row.querySelector('.re-op').onchange = (e) => { r.conds[i].op = e.target.value; drawConds(); };
        row.querySelector('.re-val').oninput = (e) => { r.conds[i].val = e.target.value; };
        row.querySelector('.re-val').onkeydown = (e) => e.stopPropagation();
        row.querySelector('.re-rm').onclick = () => { r.conds.splice(i, 1); drawConds(); };
      });
      box.querySelector('#re-add').onclick = () => { r.conds.push({ col: 0, op: 'notEmpty', val: '' }); drawConds(); };
      box.querySelector('#re-any').onchange = (e) => { r.any = e.target.checked; drawConds(); };
    };
    d.querySelector('#re-kind').onchange = (e) => {
      const k = e.target.value;
      if (k !== 'cond' && !d.querySelector('#re-name').value.trim()) d.querySelector('#re-name').value = BUILTIN[k].msg;
      if (k === 'cond' && !r.conds) r.conds = [{ col: 0, op: 'notEmpty', val: '' }];
      drawConds();
    };
    d.querySelector('#re-sheet').onchange = (e) => {
      sh = doc.sheets.find((s) => s.id === e.target.value) || sh;
      r.conds = (r.conds || []).map((x) => Object.assign(x, { col: 0 }));
      d.querySelector('#re-show1').innerHTML = colOpts(sh, 0); d.querySelector('#re-show2').innerHTML = colOpts(sh, 0);
      drawConds();
    };
    d.querySelectorAll('.re-colors .sw').forEach((b) => (b.onclick = (e) => { e.preventDefault(); r.color = b.dataset.c; d.querySelectorAll('.re-colors .sw').forEach((x) => x.classList.toggle('on', x === b)); }));
    if (!r.conds) r.conds = [{ col: 0, op: 'notEmpty', val: '' }];
    d.querySelectorAll('input.input').forEach((x) => x.addEventListener('keydown', (e) => e.stopPropagation()));
    drawConds();
  }

  // ---------- Início ----------
  function init() {
    const bar = document.querySelector('.appbar');
    if (!bar || $('btn-alert')) return;
    btn = document.createElement('button');
    btn.id = 'btn-alert';
    btn.className = 'alert-btn';
    btn.innerHTML = `${icon('bell', 18)}<span class="al-lbl">ALERTA</span><span class="al-n" hidden>0</span>`;
    btn.onclick = togglePanel;
    bar.appendChild(btn);
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(evaluate, 600); };
    App.on('change', later);
    App.on('sheet', later);
    setInterval(evaluate, 60000); // datas (hoje / vencendo) mudam com o tempo
    later();
  }
  App.commands.def('alerts', 'ALERTA', () => togglePanel());
  App.commands.def('alertRules', 'Regras de alerta', rulesDialog);
  App.alertsInit = init;
  if (document.readyState !== 'loading') setTimeout(init, 0); else document.addEventListener('DOMContentLoaded', init);
})(window.App);
