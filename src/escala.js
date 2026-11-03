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
  const cavCell = (sh, r) => { const c = cols(sh).CAVALO; return c ? sh.cells[E.addrToStr(r, c)] || null : null; };

  function srcSheet(sh) {
    const cfg = sh.escala || {};
    let i = cfg.src ? doc.sheets.findIndex((s) => s.id === cfg.src) : -1;
    if (i < 0) i = doc.sheets.findIndex((s) => norm(s.name) === norm(SRC_NAME));
    return i >= 0 ? { si: i, sh: doc.sheets[i] } : null;
  }
  const perms = () => (App.cloudMode && App.cloud && App.cloud.perms) || null;
  // escalar e confirmar: administradores e os setores da escala
  function canEscalar(sh) { const p = perms(); return !p || p.admin || !!(sh.escala && (sh.escala.sectors || []).includes(p.sectorId)); }
  // bloquear e destravar: administradores e os setores do bloqueio
  function canLock(sh) { const p = perms(); return !p || p.admin || !!(sh.escala && (sh.escala.lockSectors || []).includes(p.sectorId)); }

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

    // veículos que já aparecem nesta página (pela placa do cavalo)
    const usedPlates = new Map();
    App.withReal(() => {
      const used = App.usedRange(sh);
      for (let r = 1; r <= used.maxR; r++) {
        const t = norm(text(doc.active, sh, r, tc.CAVALO));
        if (t && !rows.includes(r)) { if (!usedPlates.has(t)) usedPlates.set(t, []); usedPlates.get(t).push(r); }
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
        const done = App.change(ok ? 'Escalar veículo' : 'Escalar veículo (não confirmada)', () => App.withReal(() => {
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
        }));
        if (done === false) return;
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
    setFlags('Destravar veículo', rows, (x) => { delete x.lock; delete x.swap; }, `Veículo destravado para troca (${rowTxt(rows)}). Depois da troca, bloqueie de novo.`);
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
        if (!setFlags('Pedir troca', rows, (x) => { x.swap = true; })) return false;
        send(why);
      } }],
    });
    async function send(why) {
      if (!App.cloudMode || !App.cloud.id) return notify('Pedido marcado na planilha.');
      let people = [];
      try { people = await App.collab.api('GET', `/api/docs/${App.cloud.id}/contacts`); } catch (e) { return notify(e.message); }
      let to = people.filter((p) => p.sectorId && lockSectors.includes(p.sectorId));
      if (!to.length) to = people.filter((p) => p.admin);
      if (!to.length) return notify('Pedido marcado na planilha, mas não há ninguém do setor responsável para avisar pelo chat.');
      const addr = E.numToCol(tc.CAVALO) + rows[0];
      const msg = `🔒 Pedido de troca de veículo — ${plates.join(', ')} (${rowTxt(rows)}, página ${sh.name}). Motivo: ${why}`;
      let ok = 0;
      for (const p of to) {
        try { await App.collab.api('POST', '/api/messages', { to: p.id, text: msg, doc: App.cloud.id, ref: { sheet: sh.id, addr, label: `${sh.name}!${addr}`, act: 'unlock', rows } }); ok++; } catch (e) { /* tenta os outros */ }
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
    if (!st.locked.length) return notify('Este veículo já foi destravado.');
    const plates = App.withReal(() => st.locked.map((r) => text(doc.sheets.indexOf(st.sh), st.sh, r, cols(st.sh).CAVALO) || '—'));
    if (!setFlags('Destravar veículo', st.locked, (x) => { delete x.lock; delete x.swap; }, null, st.sh)) return false;
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
    let sectors = [];
    if (App.cloudMode && App.cloud && App.cloud.id) {
      try { const r = await App.collab.api('GET', `/api/docs/${App.cloud.id}/share`); sectors = (r.acl && r.acl.sectors) || []; } catch (e) { return notify(e.message); }
    }
    const cur = sh.escala || {};
    const srcNow = srcSheet(sh);
    const boxes = (key, list) => (sectors.length ? sectors.map((s) => `<label class="inline"><input type="checkbox" data-${key}="${esc(s.id)}"${(list || []).includes(s.id) ? ' checked' : ''}> ${esc(s.name)}</label>`).join('') : '<p class="sp-hint">Nenhum setor criado ainda (Compartilhar › Setores).</p>');
    App.ui.modal({
      title: 'Escala de veículos — quem pode usar', width: '500px',
      body: `<p class="sp-hint">Funções do botão direito na coluna <b>CAVALO</b> desta página. Administradores sempre podem usar tudo.</p>
        <p class="sp-label">Escalar veículo e confirmar escala</p><div class="esc-sectors">${boxes('s', cur.sectors)}</div>
        <p class="sp-label">Bloquear e destravar veículo para troca</p><div class="esc-sectors">${boxes('l', cur.lockSectors)}</div>
        <label class="field"><span>Aba com a escala</span><select class="input" id="esc-src">${doc.sheets.map((s) => `<option value="${esc(s.id)}"${srcNow && srcNow.sh.id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <p class="sp-hint">Os setores da escala precisam ver a aba da escala e editar CAVALO, CARRETA, MOTORISTA, CPF e CONTATO; o setor do bloqueio precisa editar a coluna CAVALO.</p>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const pick = (k) => [...d.querySelectorAll(`[data-${k}]`)].filter((x) => x.checked).map((x) => x.dataset[k]);
        const srcId = d.querySelector('#esc-src').value;
        App.change('Escala de veículos (setores)', () => { sh.escala = { sectors: pick('s'), lockSectors: pick('l'), src: srcId }; });
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
    const pp = perms();
    if (!pp || pp.admin) extra.push({ label: 'Escala de veículos: quem pode usar…', cmd: 'escalaConfig' });
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
