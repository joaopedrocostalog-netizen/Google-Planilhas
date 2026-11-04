// Escala de veículos (botão direito numa célula da coluna CAVALO):
// - Escalar veículo: lista os veículos de hoje da aba ESCALA DE FROTA (rodotrem = mesmo cavalo com 2 carretas,
//   mostrado como um veículo só) e preenche CAVALO, CARRETA, MOTORISTA, CPF e CONTATO (2 linhas no rodotrem).
//   Escala não confirmada fica em vermelho até alguém do setor confirmar.
// - Bloquear veículo para troca (depois da escala confirmada): CAVALO, CARRETA e MOTORISTA só mudam depois que o
//   setor responsável destravar. Quem precisa trocar usa "Pedir troca": o setor recebe mensagem no chat e as
//   células piscam em azul até ele destravar; depois da troca, ele bloqueia de novo.
// As marcas ficam na célula do CAVALO: esc ('p' = não confirmada, 'ok' = confirmada), lock e swap (pedido de troca).
(function (App) {
  'use strict';
  const E = App.E;
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);
  const doc = App.doc;
  const SRC_NAME = 'ESCALA DE FROTA';
  const FIELDS = ['CAVALO', 'CARRETA', 'MOTORISTA', 'CPF', 'CONTATO'];
  const norm = (s) => (window.Perms && window.Perms.normName ? window.Perms.normName(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const keyLabel = (k) => k.split('-').reverse().join('/');

  // data da célula (número de série, texto dd/mm/aaaa ou aaaa-mm-dd) → aaaa-mm-dd
  function dateKey(v) {
    if (typeof v === 'number' && isFinite(v) && v > 20000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const t = String(v === null || v === undefined ? '' : v).trim();
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    return '';
  }
  const text = (si, sh, r, c) => {
    if (!c) return '';
    const v = App.value(si, r, c);
    if (v === null || v === undefined || (E.isErr && E.isErr(v))) return '';
    return String(App.fmtValue(v, App.style(sh, r, c).nf)).trim();
  };
  const cols = (sh) => (window.Perms ? window.Perms.escalaCols(sh) : {});
  // primeira linha de dados: com o nome da coluna definido pelo administrador (A = CAVALO), a linha 1 já é dado;
  // sem nome, a linha 1 é o cabeçalho
  const firstRow = (sh, c) => (c && sh.colNames && sh.colNames[c] ? 1 : 2);
  const cavCell = (sh, r) => { const c = cols(sh).CAVALO; return c ? sh.cells[E.addrToStr(r, c)] || null : null; };

  function srcSheet(sh) {
    const cfg = sh.escala || {};
    let i = cfg.src ? doc.sheets.findIndex((s) => s.id === cfg.src) : -1;
    if (i < 0) i = doc.sheets.findIndex((s) => norm(s.name) === norm(SRC_NAME));
    return i >= 0 ? { si: i, sh: doc.sheets[i] } : null;
  }
  const perms = () => (App.cloudMode && App.cloud && App.cloud.perms) || null;
  // escalar e confirmar: administradores e os setores da escala
  function canEscalar(sh) { const p = perms(); return !p || p.admin || !!(sh.escala && window.Perms.inList(sh.escala.sectors || [], p)); }
  // bloquear e destravar: administradores e os setores do bloqueio
  function canLock(sh) { const p = perms(); return !p || p.admin || !!(sh.escala && window.Perms.inList(sh.escala.lockSectors || [], p)); }

  // linhas reais da seleção (todas as seleções, inclusive Ctrl+clique)
  function selRows(limit) {
    const rows = new Set();
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) {
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + (limit || 200)); r++) {
        const p = App.realCell ? App.realCell(r, R.c1) : { r };
        if (p) rows.add(p.r);
      }
    }
    return [...rows].sort((a, b) => a - b);
  }
  function selectionInCavalo(sh) {
    const col = cols(sh).CAVALO;
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) for (let c = R.c1; c <= R.c2; c++) {
      const p = App.realCell ? App.realCell(R.r1, c) : { c };
      if (!p || p.c !== col) return false;
    }
    return true;
  }

  // veículos de hoje; o mesmo cavalo em mais de uma linha (rodotrem) vira um veículo com várias carretas
  function vehiclesToday(src) {
    return App.withReal(() => {
      const s = src.sh, si = src.si;
      const col = {};
      for (const f of ['DATA', 'TIPO'].concat(FIELDS)) col[f] = App.colByName(s, f);
      const today = todayKey();
      const used = App.usedRange(s);
      const byCav = new Map(), list = [];
      for (let r = 1; r <= used.maxR; r++) {
        if (!col.DATA || dateKey(App.value(si, r, col.DATA)) !== today) continue;
        const o = { rows: [r], tipo: text(si, s, r, col.TIPO) || 'Sem tipo' };
        for (const f of FIELDS) o[f] = text(si, s, r, col[f]);
        if (!o.CAVALO && !o.MOTORISTA) continue;
        o.carretas = o.CARRETA ? [o.CARRETA] : [];
        const k = norm(o.CAVALO);
        const same = k && byCav.get(k);
        if (same) {
          same.rows.push(r);
          if (o.CARRETA && !same.carretas.includes(o.CARRETA)) same.carretas.push(o.CARRETA);
          for (const f of ['MOTORISTA', 'CPF', 'CONTATO']) if (!same[f] && o[f]) same[f] = o[f];
          continue;
        }
        if (k) byCav.set(k, o);
        list.push(o);
      }
      for (const v of list) { v.rodo = v.carretas.length > 1; v.CARRETA = v.carretas.join(' + '); }
      return { list, col, today };
    });
  }

  // data da linha (coluna DATA da página); sem data, vale o dia de hoje
  function rowDate(sh, r) {
    const c = App.colByName ? App.colByName(sh, 'DATA') : null;
    if (!c) return todayKey();
    const si = doc.sheets.indexOf(sh);
    const k = App.withReal(() => dateKey(App.value(si, r, c)));
    return k || todayKey();
  }

  function escalar() {
    const sh = App.sheet();
    if (!canEscalar(sh)) return notify('Escalar veículo não está liberado para o seu setor. Peça a um administrador.');
    const tc = cols(sh);
    if (!tc.CAVALO) return notify('Esta página não tem a coluna CAVALO.');
    if (!selectionInCavalo(sh)) return notify('Selecione a célula da coluna CAVALO (uma, ou duas para rodotrem).');
    let rows = selRows(10);
    if (rows.length > 2) return notify('Selecione no máximo 2 células da coluna CAVALO (2 para rodotrem).');
    const src = srcSheet(sh);
    if (!src) return notify(`A aba ${SRC_NAME} não foi encontrada${perms() && !perms().admin ? ' ou não está liberada para o seu setor (peça ao administrador para liberar ao menos a visualização)' : ''}.`);
    const { list, col: scol, today } = vehiclesToday(src);
    if (!scol.DATA) return notify(`A aba ${SRC_NAME} não tem a coluna DATA.`);
    if (!list.length) return notify(`Nenhum veículo na ${SRC_NAME} com a data de hoje (${keyLabel(today)}).`);

    // veículos já escalados nesta página NA MESMA DATA da linha que está sendo escalada (pela placa do cavalo)
    const usedPlates = new Map();
    const day = rowDate(sh, rows[0]);
    App.withReal(() => {
      const used = App.usedRange(sh);
      for (let r = 1; r <= used.maxR; r++) {
        if (rows.includes(r)) continue;
        const t = norm(text(doc.active, sh, r, tc.CAVALO));
        if (!t || rowDate(sh, r) !== day) continue;
        if (!usedPlates.has(t)) usedPlates.set(t, []); usedPlates.get(t).push(r);
      }
    });

    const tipos = [...new Set(list.map((v) => v.tipo))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const hasRodo = list.some((v) => v.rodo);
    let tipo = rows.length === 2 && hasRodo ? '__rodo' : tipos.length === 1 ? tipos[0] : '';
    let picked = null;
    const title = () => `Escalar veículo — ${rows.length === 2 ? `linhas ${rows[0]} e ${rows[1]} (rodotrem)` : `linha ${rows[0]}`}`;
    const m = App.ui.modal({
      title: title(), width: 'min(1020px, 96vw)', cls: 'modal-tall esc-modal', enterSubmits: false,
      body: `<p class="sp-hint">Veículos da aba <b>${esc(src.sh.name)}</b> com a data de hoje (<b>${keyLabel(today)}</b>). Rodotrem (mesmo cavalo com 2 carretas) aparece como um veículo só e preenche 2 linhas.</p>
        <div class="esc-tipos" id="esc-tipos"></div>
        <input class="input" id="esc-find" placeholder="Procurar placa, motorista, CPF…" autocomplete="off">
        <div class="esc-list" id="esc-list"></div>
        <label class="esc-ok"><input type="checkbox" id="esc-confirm"> <b>Escala confirmada</b> <span>— sem confirmar, as células ficam em vermelho até alguém do setor confirmar</span></label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Escalar', primary: true, action: () => { if (!picked) { notify('Escolha um veículo da lista.'); return false; } start(picked); } }],
    });
    const el = m.el, find = el.querySelector('#esc-find'), box = el.querySelector('#esc-list'), tbox = el.querySelector('#esc-tipos');
    const confirmed = () => el.querySelector('#esc-confirm').checked;
    const drawTipos = () => {
      const chips = [['', `Todos (${list.length})`]];
      if (hasRodo) chips.push(['__rodo', `Rodotrem · 2 carretas (${list.filter((v) => v.rodo).length})`]);
      for (const t of tipos) chips.push([t, `${t} (${list.filter((v) => v.tipo === t).length})`]);
      tbox.innerHTML = chips.map(([t, l]) => `<button class="esc-tipo${t === tipo ? ' on' : ''}${t === '__rodo' ? ' rodo' : ''}" data-t="${esc(t)}">${esc(l)}</button>`).join('');
      tbox.querySelectorAll('.esc-tipo').forEach((b) => (b.onclick = () => { tipo = b.dataset.t; picked = null; drawTipos(); drawList(); }));
    };
    const drawList = () => {
      const q = norm(find.value);
      const vis = list.filter((v) => (!tipo || (tipo === '__rodo' ? v.rodo : v.tipo === tipo)) && (!q || norm(FIELDS.map((f) => v[f]).join(' ')).includes(q)))
        .sort((a, b) => (rows.length === 2 ? b.rodo - a.rodo : a.rodo - b.rodo));
      box.innerHTML = vis.length ? `<table class="esc-table"><thead><tr>${FIELDS.map((f) => `<th>${f}</th>`).join('')}<th>TIPO</th></tr></thead><tbody>${vis.map((v) => {
        const busy = usedPlates.get(norm(v.CAVALO));
        return `<tr data-k="${v.rows[0]}" class="${picked === v ? 'on' : ''}${busy ? ' busy' : ''}">${FIELDS.map((f) => `<td>${f === 'CARRETA' && v.rodo ? v.carretas.map((c) => `<span class="esc-car">${esc(c)}</span>`).join('') : esc(v[f])}${f === 'CAVALO' && v.rodo ? '<i class="esc-rodo">rodotrem</i>' : ''}${f === 'CAVALO' && busy ? `<em title="Já aparece nesta página">já escalado (linha ${busy.slice(0, 3).join(', ')})</em>` : ''}</td>`).join('')}<td>${esc(v.tipo)}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="sp-hint">Nenhum veículo encontrado.</p>';
      box.querySelectorAll('tr[data-k]').forEach((tr) => {
        const v = list.find((x) => String(x.rows[0]) === tr.dataset.k);
        tr.onclick = () => { picked = v; box.querySelectorAll('tr.on').forEach((x) => x.classList.remove('on')); tr.classList.add('on'); };
        tr.ondblclick = () => { picked = v; m.close(); start(v); };
      });
    };
    find.oninput = drawList;
    drawTipos(); drawList();
    setTimeout(() => find.focus(), 30);

    // rodotrem com 1 célula selecionada: oferece usar também a linha de baixo
    function start(v) {
      const ok = confirmed();
      if (v.rodo && rows.length === 1) {
        const next = rows[0] + 1;
        App.ui.modal({
          title: 'Rodotrem: 2 carretas', width: '460px',
          body: `<p class="modal-text">O cavalo <b>${esc(v.CAVALO)}</b> puxa 2 carretas (${v.carretas.map(esc).join(' e ')}). Cada carreta vai numa linha.</p><p class="modal-text">Usar também a linha <b>${next}</b>?</p>`,
          buttons: [{ label: 'Cancelar' }, { label: 'Só a linha ' + rows[0], action: () => fill(v, ok) }, { label: `Usar linhas ${rows[0]} e ${next}`, primary: true, action: () => { rows = [rows[0], next]; fill(v, ok); } }],
        });
        return;
      }
      fill(v, ok);
    }

    function fill(v, ok) {
      // valor de cada campo em cada linha (no rodotrem, uma carreta por linha)
      const valueFor = (f, i) => (f === 'CARRETA' ? (v.carretas.length ? (rows.length > 1 && v.carretas.length > 1 ? v.carretas[i] || v.carretas[v.carretas.length - 1] : v.carretas.join(' + ')) : '') : v[f]);
      const missing = FIELDS.filter((f) => !tc[f]);
      const blocked = [], conflicts = [];
      App.withReal(() => {
        rows.forEach((r, i) => {
          for (const f of FIELDS) {
            const c = tc[f];
            if (!c) continue;
            if (App.editGuard && App.editGuard(sh, r, c, true)) { if (!blocked.includes(f)) blocked.push(f); continue; }
            const cur = text(doc.active, sh, r, c);
            if (cur && norm(cur) !== norm(valueFor(f, i))) conflicts.push(`linha ${r}, ${f}: "${cur}"`);
          }
        });
      });
      const go = () => {
        App._escalando = true;
        let done;
        try { done = App.change(ok ? 'Escalar veículo' : 'Escalar veículo (não confirmada)', () => App.withReal(() => {
          rows.forEach((r, i) => {
            for (const f of FIELDS) {
              const c = tc[f];
              if (!c || blocked.includes(f)) continue;
              const val = valueFor(f, i);
              if (val) App.setRaw(sh, r, c, val);
            }
            const a = E.addrToStr(r, tc.CAVALO);
            sh.cells[a] = sh.cells[a] || { v: '' };
            sh.cells[a].esc = ok ? 'ok' : 'p';
            delete sh.cells[a].swap;
          });
        })); } finally { App._escalando = false; }
        if (done === false) return;
        jornada(sh, rows, v, valueFor);
        notify(`Veículo ${v.CAVALO || ''} escalado ${rows.length === 2 ? `nas linhas ${rows[0]} e ${rows[1]}` : `na linha ${rows[0]}`}${ok ? '' : ' — escala NÃO confirmada (em vermelho até confirmar)'}.` +
          (missing.length ? ` Colunas não encontradas: ${missing.join(', ')}.` : '') + (blocked.length ? ` Sem permissão em: ${blocked.join(', ')}.` : ''));
      };
      // nunca substitui o que já está preenchido sem perguntar
      if (conflicts.length) {
        App.ui.modal({
          title: 'Já existe informação nestas células', width: '480px',
          body: `<p class="modal-text">Estas células já estão preenchidas e serão substituídas:</p><ul class="esc-conf">${conflicts.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join('')}${conflicts.length > 15 ? `<li>… e mais ${conflicts.length - 15}</li>` : ''}</ul><p class="modal-text">Deseja substituir?</p>`,
          buttons: [{ label: 'Cancelar' }, { label: 'Substituir', primary: true, action: go }],
        });
      } else go();
    }
  }

  // rodotrem: a linha de cima ou de baixo com o mesmo CAVALO entra junto (bloquear, destravar, pedir troca)
  function withPair(sh, rows) {
    const c = cols(sh).CAVALO, si = doc.sheets.indexOf(sh);
    if (!c || si < 0) return rows;
    const out = new Set(rows);
    App.withReal(() => {
      for (const r of rows) {
        const plate = norm(text(si, sh, r, c));
        if (!plate) continue;
        for (const d of [-1, 1]) if (r + d >= 1 && norm(text(si, sh, r + d, c)) === plate) out.add(r + d);
      }
    });
    return [...out].sort((a, b) => a - b);
  }
  // 2ª viagem: o mesmo motorista já escalado em outra linha na mesma data → registra na aba JORNADA
  function jornada(sh, rows, v, valueFor) {
    const tc = cols(sh), si = doc.sheets.indexOf(sh);
    const key = (r) => norm(text(si, sh, r, tc.CPF)) || norm(text(si, sh, r, tc.MOTORISTA));
    const me = norm(v.CPF) || norm(v.MOTORISTA);
    if (!me) return;
    const day = rowDate(sh, rows[0]);
    let first = null;
    App.withReal(() => {
      const used = App.usedRange(sh);
      for (let r = 1; r <= used.maxR && !first; r++) if (!rows.includes(r) && key(r) === me && rowDate(sh, r) === day) first = r;
    });
    if (!first) return;
    const ji = doc.sheets.findIndex((x) => norm(x.name) === norm('JORNADA'));
    if (ji < 0) { setTimeout(() => notify(`${v.MOTORISTA || 'O motorista'} já tem viagem neste dia (linha ${first}), mas a aba JORNADA não existe ou não está liberada para você.`), 60); return; }
    const js = doc.sheets[ji];
    const jc = {};
    for (const f of ['DATA', 'CLIENTE', 'CAVALO', 'CARRETA', 'MOTORISTA', 'CPF', 'CONTATO']) jc[f] = App.colByName(js, f);
    const clienteCol = App.colByName(sh, 'CLIENTE');
    const joinCar = (list) => list.filter((x, i, a) => x && a.indexOf(x) === i).join(' + ');
    // 1ª viagem: lida da própria página (com as 2 carretas, se for rodotrem)
    const firstRows = withPair(sh, [first]);
    const firstTrip = App.withReal(() => ({
      DATA: keyLabel(day), CLIENTE: clienteCol ? text(si, sh, first, clienteCol) : '',
      CAVALO: text(si, sh, first, tc.CAVALO), CARRETA: joinCar(firstRows.map((r) => text(si, sh, r, tc.CARRETA))),
      MOTORISTA: text(si, sh, first, tc.MOTORISTA), CPF: text(si, sh, first, tc.CPF), CONTATO: text(si, sh, first, tc.CONTATO),
    }));
    const thisTrip = {
      DATA: keyLabel(day), CLIENTE: clienteCol ? App.withReal(() => text(si, sh, rows[0], clienteCol)) : '',
      CAVALO: v.CAVALO, CARRETA: joinCar(rows.map((r, i) => valueFor('CARRETA', i))),
      MOTORISTA: v.MOTORISTA, CPF: v.CPF, CONTATO: v.CONTATO,
    };
    // não repete uma viagem que já está na JORNADA (mesma data, motorista, cavalo e cliente)
    const tripKey = (o) => [o.DATA, norm(o.CPF) || norm(o.MOTORISTA), norm(o.CAVALO), norm(o.CLIENTE)].join('|');
    const have = new Set();
    App.withReal(() => {
      const used = App.usedRange(js);
      for (let r = firstRow(js, jc.DATA || jc.CAVALO); r <= used.maxR; r++) {
        const o = {};
        for (const f in jc) o[f] = jc[f] ? text(ji, js, r, jc[f]) : '';
        const dk = dateKey(App.value(ji, r, jc.DATA));
        if (dk) o.DATA = keyLabel(dk);
        have.add(tripKey(o));
      }
    });
    const add = [firstTrip, thisTrip].filter((o) => !have.has(tripKey(o)));
    if (!add.length) return;
    App._escalando = true;
    let done;
    try { done = App.change('2ª viagem (JORNADA)', () => App.withReal(() => {
      let r = Math.max(1, App.usedRange(js).maxR) + 1;
      for (const values of add) {
        if (r > js.rows) js.rows = r + 50;
        for (const f in jc) if (jc[f] && values[f]) {
          App.setRaw(js, r, jc[f], String(values[f]));
          if (f === 'DATA') { const fm = App.autoFormatFor(String(values[f])); if (fm) App.setStyle(js, r, jc[f], (x) => { x.nf = fm; }); }
        }
        r++;
      }
    })); } finally { App._escalando = false; }
    if (done !== false) setTimeout(() => notify(`2ª viagem de ${v.MOTORISTA || 'motorista'} no dia ${keyLabel(day)} (a 1ª está na linha ${first}): as viagens foram registradas na aba JORNADA.`), 60);
  }

  // ---------- Veículo bloqueado: parece normal; ao tentar mexer, aparece o cadeado fechando ----------
  function lockedAt(sh, r, c) {
    const tc = cols(sh);
    if (!window.Perms.lockedCol(tc, c)) return false;
    const cav = cavCell(sh, r);
    return !!(cav && cav.lock);
  }
  // usado pelo editor antes de abrir a célula (coordenadas de tela)
  App.lockGuard = (sh, r, c) => {
    const p = App.realCell ? App.realCell(r, c) : { r, c };
    if (!p || !lockedAt(sh, p.r, p.c)) return false;
    App.emit('lockedAttempt', { sheetId: sh.id, r: p.r, c: p.c });
    return true;
  };
  // usado por App.change: CAVALO, CARRETA, MOTORISTA, CPF ou CONTATO mudados fora do Escalar → aguardando confirmação
  App.autoPendingEscala = (fwd, inv) => {
    let changed = false;
    for (const id in fwd.sheets || {}) {
      const e = fwd.sheets[id];
      if (!e.cells) continue;
      const sh = doc.sheets.find((x) => x.id === id);
      // abas de apoio (escala, jornada, base) não usam confirmação
      if (!sh || ['ESCALAFROTA', 'JORNADA', 'BASEGERAL'].includes(norm(sh.name))) continue;
      const tc = cols(sh);
      if (!tc.CAVALO) continue;
      const ic = (inv.sheets[id] && inv.sheets[id].cells) || {};
      const valOf = (cells, a) => (cells[a] && cells[a].v !== undefined && cells[a].v !== null ? String(cells[a].v).trim() : '');
      // placa (CAVALO) ou MOTORISTA apagados: apaga também CARRETA, MOTORISTA/CAVALO, CPF e CONTATO da linha
      for (const a in e.cells) {
        const p = E.parseAddr(a);
        if (!p || (p.col !== tc.CAVALO && p.col !== tc.MOTORISTA) || p.row < firstRow(sh, tc.CAVALO)) continue;
        if (!(a in ic) || !valOf(ic, a) || valOf(e.cells, a)) continue;
        for (const c of [tc.CAVALO, tc.CARRETA, tc.MOTORISTA, tc.CPF, tc.CONTATO]) {
          if (!c || (App.colReadonly && App.colReadonly(sh, c)) || (App.colBlocked && App.colBlocked(sh, c))) continue;
          const b = E.addrToStr(p.row, c);
          const x = sh.cells[b];
          if (!x || x.v === undefined || x.v === null || x.v === '') continue;
          x.v = '';
          App.cleanup(sh, b);
          changed = true;
        }
      }
      const rows = new Set(), cleared = new Set();
      for (const a in e.cells) {
        const p = E.parseAddr(a);
        if (!p || !window.Perms.lockedCol(tc, p.col) || p.row < firstRow(sh, tc.CAVALO)) continue;
        const bv = ic[a] && ic[a].v !== undefined && ic[a].v !== null ? String(ic[a].v) : '';
        const fv = e.cells[a] && e.cells[a].v !== undefined && e.cells[a].v !== null ? String(e.cells[a].v) : '';
        if (bv !== fv && fv.trim()) rows.add(p.row);
        else if (bv !== fv) cleared.add(p.row);
      }
      // linhas apagadas pelo cascade também contam
      for (const a in e.cells) { const p = E.parseAddr(a); if (p && (p.col === tc.CAVALO || p.col === tc.MOTORISTA) && valOf(ic, a) && !valOf(e.cells, a)) cleared.add(p.row); }
      // veículo todo apagado (CAVALO, CARRETA e MOTORISTA vazios): a linha deixa de ter escala
      const has = (r, c) => c && String((sh.cells[E.addrToStr(r, c)] || {}).v || '').trim() !== '';
      for (const r of (canEscalar(sh) ? cleared : [])) {
        if (rows.has(r) || has(r, tc.CAVALO) || has(r, tc.CARRETA) || has(r, tc.MOTORISTA)) continue;
        const cav = sh.cells[E.addrToStr(r, tc.CAVALO)];
        if (cav && cav.esc && !cav.lock) { delete cav.esc; delete cav.swap; App.cleanup(sh, E.addrToStr(r, tc.CAVALO)); changed = true; }
      }
      for (const r of rows) {
        const a = E.addrToStr(r, tc.CAVALO);
        const cav = sh.cells[a];
        if (cav && cav.esc === 'p') continue;
        sh.cells[a] = cav || { v: '' };
        sh.cells[a].esc = 'p';
        changed = true;
      }
    }
    return changed;
  };
  // Com CAVALO preenchido, CARRETA, MOTORISTA, CPF e CONTATO são obrigatórios: os que faltam ficam destacados
  App.vehicleMissing = (sh, si, r, c) => {
    if (['ESCALAFROTA', 'JORNADA', 'BASEGERAL'].includes(norm(sh.name))) return false;
    const tc = cols(sh);
    if (!tc.CAVALO || ![tc.CARRETA, tc.MOTORISTA, tc.CPF, tc.CONTATO].includes(c) || r < firstRow(sh, tc.CAVALO)) return false;
    const has = (col) => { const v = App.value(si, r, col); return v !== null && v !== undefined && String(v).trim() !== ''; };
    return has(tc.CAVALO) && !has(c);
  };
  App.vehicleMissingFields = (sh, si, r) => {
    const tc = cols(sh);
    return ['CARRETA', 'MOTORISTA', 'CPF', 'CONTATO'].filter((f) => tc[f] && App.vehicleMissing(sh, si, r, tc[f]));
  };
  // usado por App.change: desfaz qualquer troca de valor nas células bloqueadas
  App.lockViolation = (fwd, inv) => {
    for (const id in fwd.sheets || {}) {
      const e = fwd.sheets[id];
      if (!e.cells) continue;
      const sh = doc.sheets.find((x) => x.id === id);
      if (!sh) continue;
      const tc = cols(sh);
      if (!tc.CAVALO) continue;
      const ic = (inv.sheets[id] && inv.sheets[id].cells) || {};
      for (const a in e.cells) {
        const p = E.parseAddr(a);
        if (!p || !window.Perms.lockedCol(tc, p.col)) continue;
        const ca = E.addrToStr(p.row, tc.CAVALO);
        const cav = ca in ic ? ic[ca] : sh.cells[ca];
        if (!cav || !cav.lock) continue;
        const bv = ic[a] && ic[a].v !== undefined && ic[a].v !== null ? String(ic[a].v) : '';
        const fv = e.cells[a] && e.cells[a].v !== undefined && e.cells[a].v !== null ? String(e.cells[a].v) : '';
        if (bv !== fv) return { sheetId: id, r: p.row, c: p.col };
      }
    }
    return null;
  };
  let lockAnim = null;
  App.on('lockedAttempt', (lv) => {
    const sh = App.sheet();
    let r, c;
    if (lv && lv.sheetId === sh.id) { const d = App.dispCell ? App.dispCell(lv.r, lv.c) : { r: lv.r, c: lv.c }; if (d) { r = d.r; c = d.c; } }
    if (!r) { r = App.sel.ar; c = App.sel.ac; }
    const rc = App.grid.cellRect(r, c);
    const wrap = document.getElementById('grid-wrap');
    if (!lockAnim) { lockAnim = document.createElement('div'); lockAnim.className = 'lock-anim'; wrap.appendChild(lockAnim); }
    const size = Math.max(24, Math.min(36, rc.h * 1.5));
    lockAnim.style.left = rc.x + rc.w / 2 - size / 2 + 'px';
    lockAnim.style.top = rc.y + rc.h / 2 - size / 2 + 'px';
    lockAnim.style.width = lockAnim.style.height = size + 'px';
    lockAnim.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path class="la-shackle" d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="5" y="11" width="14" height="10" rx="2.2" fill="currentColor"/><circle cx="12" cy="16" r="1.6" fill="#fff"/></svg>';
    lockAnim.classList.remove('play'); void lockAnim.offsetWidth; lockAnim.classList.add('play');
  });

  // ---------- BASE GERAL: dados do cavalo ao clicar e FRETE obrigatório para terceiros ----------
  let baseVer = 0, baseCache = null;
  App.on('change', () => { baseVer++; });
  App.on('sheet', () => { baseVer++; });
  function baseMap() {
    if (baseCache && baseCache.ver === baseVer) return baseCache.map;
    const bi = doc.sheets.findIndex((x) => norm(x.name) === norm('BASE GERAL'));
    let map = null;
    if (bi >= 0) {
      const bs = doc.sheets[bi];
      map = new Map();
      App.withReal(() => {
        const bc = {};
        for (const f of ['CAVALO', 'MARCA', 'TIPO', 'CATEGORIA']) bc[f] = App.colByName(bs, f);
        if (!bc.CAVALO) { map = null; return; }
        const used = App.usedRange(bs);
        for (let r = firstRow(bs, bc.CAVALO); r <= used.maxR; r++) {
          const k = norm(text(bi, bs, r, bc.CAVALO));
          if (!k || map.has(k)) continue;
          map.set(k, { MARCA: text(bi, bs, r, bc.MARCA), TIPO: text(bi, bs, r, bc.TIPO), CATEGORIA: text(bi, bs, r, bc.CATEGORIA) });
        }
      });
    }
    baseCache = { ver: baseVer, map };
    return map;
  }
  // placa no padrão brasileiro (antigo ou Mercosul): ABC1234 / ABC1D23
  const isPlate = (t) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(norm(t));
  // sem a aba BASE GERAL (ou sem acesso a ela) não dá para saber: não marca nada
  function vehicleInfo(plate) {
    const map = baseMap();
    if (!map || !plate || !isPlate(plate)) return null;
    return map.get(norm(plate)) || { CATEGORIA: 'Terceiro', terceiro: true };
  }
  // rótulo de cada coluna de uma aba (nome dado pelo administrador ou texto da linha 1)
  function labels(sh) {
    const names = sh.colNames || {};
    const maxC = Math.max(App.usedRange(sh).maxC || 0, ...Object.keys(names).map(Number), 1);
    const out = [null];
    for (let c = 1; c <= maxC; c++) out.push(norm(names[c] || App.raw(sh, 1, c)));
    return out;
  }
  let lookCache = null;
  // clientes (CLIENTES IMPO / CLIENTES EXPO, cada um com CIDADE e ENDEREÇO ao lado) e terminais com as cidades
  function baseLookups() {
    if (lookCache && lookCache.ver === baseVer) return lookCache;
    const out = { ver: baseVer, clients: [], coleta: [], vazio: [], ok: false };
    const bi = doc.sheets.findIndex((x) => norm(x.name) === norm('BASE GERAL'));
    if (bi >= 0) {
      const bs = doc.sheets[bi];
      App.withReal(() => {
        const L = labels(bs), used = App.usedRange(bs);
        const near = (c, prefix) => { for (let k = c + 1; k <= Math.min(L.length - 1, c + 4); k++) if (L[k] && L[k].startsWith(prefix)) return k; return null; };
        for (let c = 1; c < L.length; c++) {
          const kind = /^CLIENTES?IMP/.test(L[c] || '') ? 'IMPO' : /^CLIENTES?EXP/.test(L[c] || '') ? 'EXPO' : null;
          if (!kind) continue;
          const cc = near(c, 'CIDADE'), ac = near(c, 'ENDERECO');
          for (let r = firstRow(bs, c); r <= used.maxR; r++) {
            const name = text(bi, bs, r, c);
            if (name) out.clients.push({ name, kind, city: cc ? text(bi, bs, r, cc) : '', addr: ac ? text(bi, bs, r, ac) : '' });
          }
        }
        for (const [key, tcol, ccol] of [['coleta', 'TERMINALCOLETA', 'CIDADECOLETA'], ['vazio', 'TERMINALVAZIO', 'CIDADEVAZIO']]) {
          const t = L.indexOf(tcol), ci = L.indexOf(ccol);
          if (t < 1) continue;
          const seen = new Set();
          for (let r = firstRow(bs, t); r <= used.maxR; r++) {
            const name = text(bi, bs, r, t), city = ci > 0 ? text(bi, bs, r, ci) : '';
            const k = norm(name) + '|' + norm(city);
            if (name && !seen.has(k)) { seen.add(k); out[key].push({ name, city }); }
          }
        }
        out.ok = true;
      });
    }
    lookCache = out;
    return out;
  }
  // tipo de coluna da página: cliente, terminal de coleta ou terminal de vazio
  function columnKind(sh, c) {
    if (!App.colByName) return null;
    const L = App.withReal(() => labels(sh));
    const k = L[c] || '';
    if (k === 'CLIENTE' || k === 'CLIENTES') return 'cliente';
    if (k === 'TERMINALCOLETA') return 'coleta';
    if (k === 'TERMINALVAZIO') return 'vazio';
    return null;
  }
  const fold = (t) => norm(t);
  // sugestões ao digitar (ou ao abrir o menu suspenso) nessas colunas; usadas pelo editor
  App.cellSuggest = (sh, r, c, typed, all) => {
    const kind = columnKind(sh, c);
    if (!kind) return null;
    const look = baseLookups();
    if (!look.ok) return null;
    const q = all ? '' : fold(typed);
    const match = (t) => !q || fold(t).includes(q);
    const starts = (t) => !q || fold(t).startsWith(q);
    if (kind === 'cliente') {
      if (!look.clients.length) return null;
      const entregaCol = App.colByName(sh, 'ENTREGA');
      const addrCol = App.colByName(sh, 'ENDEREÇO - ENTREGA - 1') || App.colByName(sh, 'ENDEREÇO ENTREGA');
      const list = look.clients.filter((x) => match(x.name)).sort((a, b) => (starts(b.name) - starts(a.name)) || a.name.localeCompare(b.name, 'pt-BR'));
      return list.slice(0, all ? 300 : 30).map((x) => ({
        show: x.name, desc: [x.kind, x.city, x.addr].filter(Boolean).join(' · '),
        fills: [entregaCol && x.city ? { c: entregaCol, v: x.city } : null, addrCol && x.addr ? { c: addrCol, v: x.addr } : null].filter(Boolean),
      }));
    }
    const list = look[kind];
    if (!list.length) return null;
    return list.filter((x) => match(x.name) || match(x.city)).sort((a, b) => (starts(b.name) - starts(a.name)) || a.name.localeCompare(b.name, 'pt-BR') || a.city.localeCompare(b.city, 'pt-BR'))
      .slice(0, all ? 300 : 30).map((x) => ({ show: x.name, desc: x.city ? 'Cidade: ' + x.city : '', props: x.city ? { city: x.city } : null }));
  };
  // ---------- Alertas por linha ----------
  let colCache = { ver: -1 };
  const colsOf = (sh) => {
    if (colCache.ver !== baseVer || colCache.sh !== sh) {
      const L = App.withReal(() => labels(sh));
      colCache = { ver: baseVer, sh, chegada: L.indexOf('CHEGADANOCLIENTE'), arm: L.indexOf('ARM'), dem: L.indexOf('DEM'), prog: L.indexOf('PROG') >= 0 ? L.indexOf('PROG') : L.indexOf('PROGRAMACAO') };
    }
    return colCache;
  };
  // container crítico e IMO só piscam até preencherem CHEGADA NO CLIENTE
  App.rowArrived = (sh, si, r) => {
    const c = colsOf(sh).chegada;
    if (!(c > 0)) return false;
    const v = App.value(si, r, c);
    return v !== null && v !== undefined && String(v).trim() !== '';
  };
  // ARM e DEM (datas dd/mm): piscam em vermelho quando a data é hoje ou amanhã (vence hoje ou falta 1 dia)
  const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function ddmmKey(v) {
    if (typeof v === 'number') return dateKey(v);
    const m = /^\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s*$/.exec(String(v === null || v === undefined ? '' : v));
    if (!m) return '';
    const now = new Date();
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    if (!m[3]) {
      // sem ano: o ano que deixa a data mais perto de hoje (virada do ano)
      const best = [y - 1, y, y + 1].map((yy) => [yy, Math.abs(new Date(yy, +m[2] - 1, +m[1]) - now)]).sort((a, b) => a[1] - b[1])[0];
      y = best[0];
    }
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  App.deadlineAlert = (sh, si, r, c) => {
    const cc = colsOf(sh);
    if (!(c > 0) || (c !== cc.arm && c !== cc.dem)) return false;
    const k = ddmmKey(App.value(si, r, c));
    if (!k) return false;
    const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return k === dayKeyOf(now) || k === dayKeyOf(tomorrow);
  };

  // PROG. (número da programação) repetido em mais de uma linha: destaca para a pessoa corrigir
  let dupCache = { ver: -1 };
  const dupMap = (sh, si) => {
    if (dupCache.ver === baseVer && dupCache.sh === sh) return dupCache;
    const c = colsOf(sh).prog;
    const map = new Map();
    if (c > 0) App.withReal(() => {
      const used = App.usedRange(sh);
      for (let r = firstRow(sh, c); r <= used.maxR; r++) {
        const k = norm(text(si, sh, r, c));
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      }
    });
    for (const [k, rows] of map) if (rows.length < 2) map.delete(k);
    dupCache = { ver: baseVer, sh, col: c, map };
    return dupCache;
  };
  App.progDuplicates = (sh, si, r, c) => {
    const d = dupMap(sh, si);
    if (!(d.col > 0) || c !== d.col || !d.map.size) return null;
    const rows = d.map.get(norm(text(si, sh, r, c)));
    return rows && rows.includes(r) ? rows : null;
  };
  // ao digitar/colar um PROG. que já existe, avisa na hora
  App.on('localPatch', (fwd) => {
    const sh = App.sheet();
    if (!sh || !fwd.sheets || !fwd.sheets[sh.id] || !fwd.sheets[sh.id].cells) return;
    const si = doc.active, d = dupMap(sh, si);
    if (!(d.col > 0) || !d.map.size) return;
    const msgs = [];
    for (const a in fwd.sheets[sh.id].cells) {
      const p = E.parseAddr(a);
      if (!p || p.col !== d.col) continue;
      const rows = App.withReal(() => App.progDuplicates(sh, si, p.row, p.col));
      if (rows) { const o = rows.filter((x) => x !== p.row); msgs.push(`PROG. ${App.withReal(() => text(si, sh, p.row, p.col))} já existe (${o.length === 1 ? 'linha' : 'linhas'} ${o.join(', ')})`); }
      if (msgs.length >= 3) break;
    }
    if (msgs.length) setTimeout(() => notify('Programação duplicada: ' + msgs.join('; ') + '. Confira e ajuste.'), 80);
  });

  // listas da BASE GERAL para outros painéis (ex.: Incluir processo): 'cliente', 'coleta' ou 'vazio'
  App.baseSuggest = (kind, typed, all) => {
    const look = baseLookups();
    if (!look.ok) return null;
    const list = kind === 'cliente' ? look.clients : look[kind];
    if (!list || !list.length) return null;
    const q = all ? '' : fold(typed);
    const starts = (t) => !q || fold(t).startsWith(q);
    return list.filter((x) => !q || fold(x.name).includes(q) || (kind !== 'cliente' && fold(x.city).includes(q)))
      .sort((a, b) => (starts(b.name) - starts(a.name)) || a.name.localeCompare(b.name, 'pt-BR') || String(a.city).localeCompare(String(b.city), 'pt-BR'))
      .slice(0, 60);
  };
  // cidade do terminal: a escolhida na lista (guardada na célula) ou a(s) da BASE GERAL
  function terminalInfo(sh, kind, r, c) {
    const cell = sh.cells[E.addrToStr(r, c)];
    const name = text(doc.sheets.indexOf(sh), sh, r, c);
    if (!name) return null;
    if (cell && cell.city) return { cities: [cell.city] };
    const look = baseLookups();
    if (!look.ok) return null;
    const cities = look[kind].filter((x) => norm(x.name) === norm(name) && x.city).map((x) => x.city);
    return cities.length ? { cities } : { cities: [], missing: true };
  }
  function canSeeInfo(sh) { const p = perms(); return !p || p.admin || !!(sh.escala && window.Perms.inList(sh.escala.infoSectors || [], p)); }
  // FRETE vazio numa linha com cavalo de terceiro: pisca até preencher (usado pela grade)
  let freteCache = { ver: -1 };
  App.freteAlert = (sh, si, r, c) => {
    if (freteCache.ver !== baseVer || freteCache.sh !== sh) freteCache = { ver: baseVer, sh, col: App.colByName ? App.colByName(sh, 'FRETE') : null, cav: cols(sh).CAVALO };
    if (!freteCache.col || c !== freteCache.col || !freteCache.cav) return false;
    const fv = App.value(si, r, c);
    if (fv !== null && fv !== undefined && String(fv).trim() !== '') return false;
    if (r < firstRow(sh, freteCache.cav) || norm(sh.name) === norm('BASE GERAL')) return false;
    const plate = text(si, sh, r, freteCache.cav);
    if (!plate || !isPlate(plate)) return false;
    const info = vehicleInfo(plate);
    return !!(info && info.terceiro);
  };
  // balão discreto com MARCA, TIPO e CATEGORIA ao clicar numa célula do CAVALO
  let infoEl = null;
  function hideInfo() { if (infoEl) infoEl.hidden = true; }
  function showInfo() {
    const sh = App.sheet();
    if (!sh) return hideInfo();
    const R = App.selRect();
    if (!(R.r1 === R.r2 && R.c1 === R.c2) || (App.editing && App.editing())) return hideInfo();
    const p = App.realCell ? App.realCell(R.r1, R.c1) : { r: R.r1, c: R.c1 };
    const tc = cols(sh);
    if (!p || !canSeeInfo(sh) || norm(sh.name) === norm('BASE GERAL')) return hideInfo();
    const kind = columnKind(sh, p.c);
    if (kind === 'coleta' || kind === 'vazio') {
      const ti = App.withReal(() => terminalInfo(sh, kind, p.r, p.c));
      if (!ti || (!ti.cities.length && !ti.missing)) return hideInfo();
      place(R, ti.missing ? '<span><i>Terminal fora da BASE GERAL</i></span>' : `<span><i>${ti.cities.length > 1 ? 'Cidades' : 'Cidade'}</i> <b>${ti.cities.map(esc).join(' · ')}</b></span>`);
      return;
    }
    if (!tc.CAVALO || p.c !== tc.CAVALO) return hideInfo();
    const plate = App.withReal(() => text(doc.active, sh, p.r, tc.CAVALO));
    const info = plate ? vehicleInfo(plate) : null;
    if (!info) return hideInfo();
    place(R, info.terceiro ? '<span><i>Categoria</i> <b class="t3">Terceiro</b></span><span class="cav-warn">preencha o FRETE</span>'
      : ['MARCA', 'TIPO', 'CATEGORIA'].filter((f) => info[f]).map((f) => `<span><i>${f[0] + f.slice(1).toLowerCase()}</i> <b>${esc(info[f])}</b></span>`).join('') || '<span><i>Sem dados na BASE GERAL</i></span>');
  }
  function place(R, html) {
    if (!infoEl) { infoEl = document.createElement('div'); infoEl.className = 'cav-info'; document.getElementById('grid-wrap').appendChild(infoEl); }
    infoEl.innerHTML = html;
    const rc = App.grid.cellRect(R.r1, R.c1);
    infoEl.style.left = rc.x + 'px';
    infoEl.style.top = rc.y + rc.h + 2 + 'px';
    infoEl.hidden = false;
  }
  App.on('selection', () => setTimeout(showInfo, 0));
  App.on('viewport', () => { if (infoEl && !infoEl.hidden) showInfo(); });
  App.on('editStart', hideInfo);
  App.on('sheet', hideInfo);

  // muda as marcas da célula do CAVALO nas linhas indicadas
  function setFlags(label, rows, fn, okMsg, target) {
    const sh = target || App.sheet(), c = cols(sh).CAVALO;
    const done = App.change(label, () => App.withReal(() => {
      for (const r of rows) {
        const a = E.addrToStr(r, c);
        sh.cells[a] = sh.cells[a] || { v: '' };
        fn(sh.cells[a], r);
        App.cleanup(sh, a);
      }
    }));
    if (done !== false && okMsg) notify(okMsg);
    return done !== false;
  }
  const rowsWith = (sh, pred, pair) => App.withReal(() => (pair ? withPair(sh, selRows()) : selRows()).filter((r) => pred(cavCell(sh, r) || {})));
  const rowTxt = (rows) => (rows.length === 1 ? `linha ${rows[0]}` : `${rows.length} linhas`);

  function confirmarEscala() {
    const sh = App.sheet();
    if (!canEscalar(sh)) return notify('Confirmar escala não está liberado para o seu setor.');
    const rows = rowsWith(sh, (x) => x.esc === 'p');
    if (!rows.length) return notify('Não há escala esperando confirmação na seleção.');
    const falta = App.withReal(() => rows.map((r) => [r, App.vehicleMissingFields(sh, doc.active, r)]).filter((x) => x[1].length));
    if (falta.length) return notify(`Preencha antes de confirmar: ${falta.map(([r, f]) => `linha ${r} (${f.join(', ')})`).join('; ')}.`);
    setFlags('Confirmar escala', rows, (x) => { x.esc = 'ok'; }, `Escala confirmada (${rowTxt(rows)}).`);
  }
  function bloquear() {
    const sh = App.sheet();
    if (!canLock(sh)) return notify('Bloquear veículo não está liberado para o seu setor.');
    const sel = rowsWith(sh, (x) => x.esc === 'ok' && !x.lock);
    if (!sel.length) return notify('Só dá para bloquear depois que a escala estiver confirmada.');
    const rows = withPair(sh, sel).filter((r) => !(cavCell(sh, r) || {}).lock);
    setFlags('Bloquear veículo', rows, (x) => { x.lock = true; delete x.swap; }, `Veículo bloqueado para troca (${rowTxt(rows)}). CAVALO, CARRETA e MOTORISTA só mudam depois de destravar.`);
  }
  function destravar() {
    const sh = App.sheet();
    if (!canLock(sh)) return notify('Destravar veículo não está liberado para o seu setor.');
    const rows = rowsWith(sh, (x) => x.lock, true);
    if (!rows.length) return notify('Nenhum veículo bloqueado na seleção.');
    const reqs = swapReqs(sh, rows);
    if (setFlags('Destravar veículo', rows, (x) => { delete x.lock; delete x.swap; }, `Veículo destravado para troca (${rowTxt(rows)}). Depois da troca, bloqueie de novo.`)) closeReqs(reqs);
  }
  // pedidos de troca em aberto nessas linhas (o id do pedido fica na marca "swap" do CAVALO)
  function swapReqs(sh, rows) {
    return [...new Set(App.withReal(() => rows.map((r) => (cavCell(sh, r) || {}).swap)).filter((x) => typeof x === 'string'))];
  }
  // marca as mensagens do pedido como "efetuado" para todos que receberam
  function closeReqs(reqs) {
    if (!App.cloudMode || !App.cloud.id) return;
    for (const req of reqs) App.collab.api('POST', '/api/messages/done', { doc: App.cloud.id, req }).catch(() => {});
  }
  // pede a troca ao setor que destrava: manda mensagem no chat e faz as células piscarem em azul
  function pedirTroca() {
    const sh = App.sheet();
    const rows = rowsWith(sh, (x) => x.lock, true);
    if (!rows.length) return notify('Este veículo não está bloqueado: a troca pode ser feita direto.');
    const tc = cols(sh);
    const plates = [...new Set(App.withReal(() => rows.map((r) => text(doc.active, sh, r, tc.CAVALO) || '—')))];
    const lockSectors = (sh.escala && sh.escala.lockSectors) || [];
    App.ui.modal({
      title: 'Pedir troca do veículo', width: '480px',
      body: `<p class="modal-text">O veículo ${plates.map((p) => `<b>${esc(p)}</b>`).join(', ')} (${rowTxt(rows)}) está bloqueado. O setor responsável recebe sua mensagem no chat e as células ficam piscando em azul até ele destravar.</p>
        <label class="field"><span>Motivo da troca</span><textarea class="input" id="pt-why" rows="3" placeholder="Ex.: motorista passou mal, trocar pelo João"></textarea></label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Enviar pedido', primary: true, action: (d) => {
        const why = d.querySelector('#pt-why').value.trim();
        if (!why) { notify('Escreva o motivo da troca.'); return false; }
        const req = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        if (!setFlags('Pedir troca', rows, (x) => { x.swap = req; })) return false;
        send(why, req);
      } }],
    });
    async function send(why, req) {
      if (!App.cloudMode || !App.cloud.id) return notify('Pedido marcado na planilha.');
      let people = [];
      try { people = await App.collab.api('GET', `/api/docs/${App.cloud.id}/contacts`); } catch (e) { return notify(e.message); }
      let to = people.filter((p) => (p.sectorId && lockSectors.includes(p.sectorId)) || (p.keys || []).some((k) => lockSectors.includes(k)));
      if (!to.length) to = people.filter((p) => p.admin);
      if (!to.length) return notify('Pedido marcado na planilha, mas não há ninguém do setor responsável para avisar pelo chat.');
      const addr = E.numToCol(tc.CAVALO) + rows[0];
      const msg = `🔒 Pedido de troca de veículo — ${plates.join(', ')} (${rowTxt(rows)}, página ${sh.name}). Motivo: ${why}`;
      let ok = 0;
      for (const p of to) {
        try { await App.collab.api('POST', '/api/messages', { to: p.id, text: msg, doc: App.cloud.id, ref: { sheet: sh.id, addr, label: `${sh.name}!${addr}`, act: 'unlock', rows, req } }); ok++; } catch (e) { /* tenta os outros */ }
      }
      notify(ok ? `Pedido enviado no chat para ${to.filter((_, i) => i < ok).map((p) => p.name.split(' ')[0]).join(', ')}. As células ficam piscando em azul até destravarem.` : 'Não foi possível enviar a mensagem do pedido.');
    }
  }

  // Destravar direto pela mensagem do pedido de troca (no chat); avisa quem pediu
  function chatUnlockState(ref) {
    if (!ref || ref.act !== 'unlock' || (ref.doc && App.cloud && ref.doc !== App.cloud.id)) return null;
    const sh = doc.sheets.find((x) => x.id === ref.sheet);
    if (!sh) return null;
    const rows = App.withReal(() => withPair(sh, (ref.rows || []).filter((r) => r > 0)));
    const locked = rows.filter((r) => (cavCell(sh, r) || {}).lock);
    return { sh, rows, locked, can: canLock(sh) };
  }
  async function unlockFromChat(ref, requesterId) {
    const st = chatUnlockState(ref);
    if (!st) return notify('Abra a planilha do pedido para destravar.');
    if (!st.can) return notify('Destravar veículo não está liberado para o seu setor.');
    if (ref.done) return notify('Este pedido de troca já foi atendido.');
    if (!st.locked.length) { if (ref.req) closeReqs([ref.req]); return notify('Este veículo já foi destravado.'); }
    const plates = App.withReal(() => st.locked.map((r) => text(doc.sheets.indexOf(st.sh), st.sh, r, cols(st.sh).CAVALO) || '—'));
    const reqs = [...new Set(swapReqs(st.sh, st.locked).concat(ref.req ? [ref.req] : []))];
    if (!setFlags('Destravar veículo', st.locked, (x) => { delete x.lock; delete x.swap; }, null, st.sh)) return false;
    closeReqs(reqs);
    notify(`Veículo ${[...new Set(plates)].join(', ')} destravado para troca (${rowTxt(st.locked)}). Depois da troca, bloqueie de novo.`);
    if (requesterId && App.cloudMode) {
      const c = cols(st.sh).CAVALO, addr = E.numToCol(c) + st.locked[0];
      try { await App.collab.api('POST', '/api/messages', { to: requesterId, text: `🔓 Veículo ${[...new Set(plates)].join(', ')} destravado para troca (${rowTxt(st.locked)}). Pode fazer a troca; depois o veículo será bloqueado de novo.`, doc: App.cloud.id, ref: { sheet: st.sh.id, addr, label: `${st.sh.name}!${addr}` } }); } catch (e) { /* o destravamento já foi feito */ }
    }
    return true;
  }

  // Administrador: quem escala/confirma e quem bloqueia/destrava nesta página
  async function config() {
    const sh = App.sheet();
    const p = perms();
    if (p && !p.admin) return notify('Somente administradores configuram a escala de veículos.');
    let who = { sectors: [], people: [] };
    try { if (App.whoOptions) who = await App.whoOptions(); } catch (e) { return notify(e.message); }
    const cur = sh.escala || {};
    const srcNow = srcSheet(sh);
    const boxes = (key, list) => App.whoBoxes(key, list, who);
    App.ui.modal({
      title: 'Escala de veículos — quem pode usar', width: '500px',
      body: `<p class="sp-hint">Funções do botão direito na coluna <b>CAVALO</b> desta página. Administradores sempre podem usar tudo.</p>
        <p class="sp-label">Escalar veículo e confirmar escala</p>${boxes('s', cur.sectors)}
        <p class="sp-label">Bloquear e destravar veículo para troca</p>${boxes('l', cur.lockSectors)}
        <p class="sp-label">Ver os dados do cavalo (BASE GERAL) ao clicar na célula</p>${boxes('v', cur.infoSectors)}
        <label class="field"><span>Aba com a escala</span><select class="input" id="esc-src">${doc.sheets.map((s) => `<option value="${esc(s.id)}"${srcNow && srcNow.sh.id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <p class="sp-hint">Os setores da escala precisam ver a aba da escala e editar CAVALO, CARRETA, MOTORISTA, CPF e CONTATO; o setor do bloqueio precisa editar a coluna CAVALO.</p>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const pick = (k) => [...d.querySelectorAll(`[data-${k}]`)].filter((x) => x.checked).map((x) => x.dataset[k]);
        const srcId = d.querySelector('#esc-src').value;
        App.change('Escala de veículos (setores)', () => { sh.escala = { sectors: pick('s'), lockSectors: pick('l'), infoSectors: pick('v'), src: srcId }; });
        notify('Permissões da escala de veículos salvas.');
      } }],
    });
  }

  App.on('contextItems', ({ hit, items }) => {
    if (hit.area !== 'cell' && hit.area !== 'fill') return;
    const sh = App.sheet();
    const tc = cols(sh);
    if (!tc.CAVALO) return;
    const p = App.realCell ? App.realCell(hit.r, hit.c) : { r: hit.r, c: hit.c };
    if (!p || p.c !== tc.CAVALO) return;
    const flags = App.withReal(() => selRows().map((r) => cavCell(sh, r) || {}));
    const extra = [];
    if (canEscalar(sh)) {
      extra.push({ label: 'Escalar veículo', icon: 'plus', cmd: 'escalarVeiculo' });
      if (flags.some((x) => x.esc === 'p')) extra.push({ label: 'Confirmar escala', icon: 'check', cmd: 'confirmarEscala' });
    }
    if (canLock(sh)) {
      if (flags.some((x) => x.lock)) extra.push({ label: flags.some((x) => x.swap) ? 'Destravar para troca (há pedido de troca)' : 'Destravar para troca', icon: 'lock', cmd: 'destravarVeiculo' });
      if (flags.some((x) => x.esc === 'ok' && !x.lock)) extra.push({ label: 'Bloquear veículo para troca', icon: 'lock', cmd: 'bloquearVeiculo' });
    }
    if (flags.some((x) => x.lock) && !canLock(sh)) extra.push({ label: flags.some((x) => x.swap) ? 'Pedir troca (pedido já enviado)' : 'Pedir troca do veículo', icon: 'comment', cmd: 'pedirTroca' });
    if (extra.length) items.splice(Math.min(items.length, 4), 0, ...extra, '-');
  });

  const def = (id, label, fn) => App.commands.def(id, label, fn);
  def('escalarVeiculo', 'Escalar veículo', escalar);
  def('confirmarEscala', 'Confirmar escala', confirmarEscala);
  def('bloquearVeiculo', 'Bloquear veículo para troca', bloquear);
  def('destravarVeiculo', 'Destravar veículo para troca', destravar);
  def('pedirTroca', 'Pedir troca do veículo', pedirTroca);
  def('escalaConfig', 'Escala de veículos: quem pode usar', config);
  App.escala = { dateKey, vehiclesToday, srcSheet, canEscalar, canLock, chatUnlockState, unlockFromChat, withPair };
})(window.App);
