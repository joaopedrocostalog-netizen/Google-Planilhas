// Escalar veículo: clique com o botão direito numa célula da coluna CAVALO (1 célula, ou 2 para rodotrem),
// escolha um veículo da aba ESCALA DE FROTA com a data de hoje e preencha CAVALO, CARRETA, MOTORISTA, CPF e CONTATO.
// O administrador escolhe quais setores podem usar.
(function (App) {
  'use strict';
  const E = App.E;
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);
  const doc = App.doc;
  const SRC_NAME = 'ESCALA DE FROTA';
  const FIELDS = ['CAVALO', 'CARRETA', 'MOTORISTA', 'CPF', 'CONTATO'];
  const norm = (s) => (App.normName ? App.normName(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
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

  function srcSheet(sh) {
    const cfg = sh.escala || {};
    let i = cfg.src ? doc.sheets.findIndex((s) => s.id === cfg.src) : -1;
    if (i < 0) i = doc.sheets.findIndex((s) => norm(s.name) === norm(SRC_NAME));
    return i >= 0 ? { si: i, sh: doc.sheets[i] } : null;
  }
  const perms = () => (App.cloudMode && App.cloud && App.cloud.perms) || null;
  // quem pode escalar: administradores e os setores escolhidos
  function canEscalar(sh) {
    const p = perms();
    if (!p || p.admin) return true;
    return !!(sh.escala && (sh.escala.sectors || []).includes(p.sectorId));
  }
  const cavaloCol = (sh) => (App.colByName ? App.colByName(sh, 'CAVALO') : null);

  // linhas reais selecionadas na coluna CAVALO
  function selectedRows(sh, col) {
    const rows = new Set();
    let outside = false;
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) {
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 10); r++) for (let c = R.c1; c <= R.c2; c++) {
        const p = App.realCell ? App.realCell(r, c) : { r, c };
        if (!p) continue;
        if (p.c !== col) { outside = true; continue; }
        rows.add(p.r);
      }
    }
    return { rows: [...rows].sort((a, b) => a - b), outside };
  }

  function vehiclesToday(src) {
    return App.withReal(() => {
      const s = src.sh, si = src.si;
      const col = {};
      for (const f of ['DATA', 'TIPO'].concat(FIELDS)) col[f] = App.colByName(s, f);
      const today = todayKey();
      const used = App.usedRange(s);
      const list = [];
      for (let r = 1; r <= used.maxR; r++) {
        if (!col.DATA || dateKey(App.value(si, r, col.DATA)) !== today) continue;
        const o = { row: r, tipo: text(si, s, r, col.TIPO) || 'Sem tipo' };
        for (const f of FIELDS) o[f] = text(si, s, r, col[f]);
        if (o.CAVALO || o.MOTORISTA) list.push(o);
      }
      return { list, col, today };
    });
  }

  function escalar() {
    const sh = App.sheet();
    if (!canEscalar(sh)) return notify('Escalar veículo não está liberado para o seu setor. Peça a um administrador.');
    const col = cavaloCol(sh);
    if (!col) return notify('Esta página não tem a coluna CAVALO.');
    const { rows, outside } = selectedRows(sh, col);
    if (!rows.length || outside) return notify('Selecione a célula da coluna CAVALO (uma, ou duas para rodotrem).');
    if (rows.length > 2) return notify('Selecione no máximo 2 células da coluna CAVALO (2 para rodotrem).');
    const src = srcSheet(sh);
    if (!src) return notify(`A aba ${SRC_NAME} não foi encontrada${perms() && !perms().admin ? ' ou não está liberada para o seu setor (peça ao administrador para liberar ao menos a visualização)' : ''}.`);
    const { list, col: scol, today } = vehiclesToday(src);
    if (!scol.DATA) return notify(`A aba ${SRC_NAME} não tem a coluna DATA.`);
    if (!list.length) return notify(`Nenhum veículo na ${SRC_NAME} com a data de hoje (${keyLabel(today)}).`);

    // veículos já escalados nesta página (pela placa do cavalo)
    const usedPlates = new Map();
    App.withReal(() => {
      const si = doc.active;
      const used = App.usedRange(sh);
      for (let r = 1; r <= used.maxR; r++) {
        const t = norm(text(si, sh, r, col));
        if (t && !rows.includes(r)) { if (!usedPlates.has(t)) usedPlates.set(t, []); usedPlates.get(t).push(r); }
      }
    });

    const tipos = [...new Set(list.map((v) => v.tipo))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const rodo = rows.length === 2 ? tipos.find((t) => /RODO/i.test(t)) : null;
    let tipo = rodo || (tipos.length === 1 ? tipos[0] : '');
    let picked = null;
    const m = App.ui.modal({
      title: `Escalar veículo — ${rows.length === 2 ? `linhas ${rows[0]} e ${rows[1]} (rodotrem)` : `linha ${rows[0]}`}`, width: 'min(980px, 96vw)', cls: 'modal-tall esc-modal', enterSubmits: false,
      body: `<p class="sp-hint">Veículos da aba <b>${esc(src.sh.name)}</b> com a data de hoje (<b>${keyLabel(today)}</b>). Escolha o tipo e clique no veículo.</p>
        <div class="esc-tipos" id="esc-tipos"></div>
        <input class="input" id="esc-find" placeholder="Procurar placa, motorista, CPF…" autocomplete="off">
        <div class="esc-list" id="esc-list"></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Escalar', primary: true, action: () => { if (!picked) { notify('Escolha um veículo da lista.'); return false; } fill(picked); } }],
    });
    const el = m.el, find = el.querySelector('#esc-find'), box = el.querySelector('#esc-list'), tbox = el.querySelector('#esc-tipos');
    const drawTipos = () => {
      tbox.innerHTML = [['', `Todos (${list.length})`]].concat(tipos.map((t) => [t, `${t} (${list.filter((v) => v.tipo === t).length})`]))
        .map(([t, l]) => `<button class="esc-tipo${t === tipo ? ' on' : ''}" data-t="${esc(t)}">${esc(l)}</button>`).join('');
      tbox.querySelectorAll('.esc-tipo').forEach((b) => (b.onclick = () => { tipo = b.dataset.t; picked = null; drawTipos(); drawList(); }));
    };
    const drawList = () => {
      const q = norm(find.value);
      const vis = list.filter((v) => (!tipo || v.tipo === tipo) && (!q || norm(FIELDS.map((f) => v[f]).join(' ')).includes(q)));
      box.innerHTML = vis.length ? `<table class="esc-table"><thead><tr>${FIELDS.map((f) => `<th>${f}</th>`).join('')}<th>TIPO</th></tr></thead><tbody>${vis.map((v) => {
        const busy = usedPlates.get(norm(v.CAVALO));
        return `<tr data-row="${v.row}" class="${picked === v ? 'on' : ''}${busy ? ' busy' : ''}">${FIELDS.map((f) => `<td>${esc(v[f])}${f === 'CAVALO' && busy ? `<em title="Já aparece nesta página">já escalado (linha ${busy.slice(0, 3).join(', ')})</em>` : ''}</td>`).join('')}<td>${esc(v.tipo)}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="sp-hint">Nenhum veículo encontrado.</p>';
      box.querySelectorAll('tr[data-row]').forEach((tr) => {
        const v = list.find((x) => String(x.row) === tr.dataset.row);
        tr.onclick = () => { picked = v; box.querySelectorAll('tr.on').forEach((x) => x.classList.remove('on')); tr.classList.add('on'); };
        tr.ondblclick = () => { picked = v; m.close(); fill(v); };
      });
    };
    find.oninput = drawList;
    drawTipos(); drawList();
    setTimeout(() => find.focus(), 30);

    function fill(v) {
      const target = {};
      for (const f of FIELDS) target[f] = f === 'CAVALO' ? col : App.colByName(sh, f);
      const missing = FIELDS.filter((f) => !target[f]);
      const blocked = [], conflicts = [];
      App.withReal(() => {
        for (const r of rows) for (const f of FIELDS) {
          const c = target[f];
          if (!c) continue;
          if (App.editGuard && App.editGuard(sh, r, c, true)) { if (!blocked.includes(f)) blocked.push(f); continue; }
          const cur = text(doc.active, sh, r, c);
          if (cur && norm(cur) !== norm(v[f])) conflicts.push(`linha ${r}, ${f}: "${cur}"`);
        }
      });
      const go = () => {
        const ok = App.change('Escalar veículo', () => App.withReal(() => {
          for (const r of rows) for (const f of FIELDS) {
            const c = target[f];
            if (!c || blocked.includes(f) || !v[f]) continue;
            App.setRaw(sh, r, c, v[f]);
          }
        }));
        if (ok === false) return;
        notify(`Veículo ${v.CAVALO || ''} escalado ${rows.length === 2 ? `nas linhas ${rows[0]} e ${rows[1]}` : `na linha ${rows[0]}`}.` +
          (missing.length ? ` Colunas não encontradas: ${missing.join(', ')}.` : '') + (blocked.length ? ` Sem permissão em: ${blocked.join(', ')}.` : ''));
      };
      // nunca apaga o que já está preenchido sem perguntar
      if (conflicts.length) {
        App.ui.modal({
          title: 'Já existe informação nestas células', width: '480px',
          body: `<p class="modal-text">Estas células já estão preenchidas e serão substituídas:</p><ul class="esc-conf">${conflicts.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join('')}${conflicts.length > 15 ? `<li>… e mais ${conflicts.length - 15}</li>` : ''}</ul><p class="modal-text">Deseja substituir?</p>`,
          buttons: [{ label: 'Cancelar' }, { label: 'Substituir', primary: true, action: go }],
        });
      } else go();
    }
  }

  // Administrador: quais setores podem escalar veículo nesta página
  async function config() {
    const sh = App.sheet();
    const p = perms();
    if (p && !p.admin) return notify('Somente administradores configuram quem pode escalar veículo.');
    let sectors = [];
    if (App.cloudMode && App.cloud && App.cloud.id) {
      try { const r = await App.collab.api('GET', `/api/docs/${App.cloud.id}/share`); sectors = (r.acl && r.acl.sectors) || []; } catch (e) { return notify(e.message); }
    }
    const cur = sh.escala || { sectors: [] };
    const srcNow = srcSheet(sh);
    App.ui.modal({
      title: 'Escalar veículo — quem pode usar', width: '460px',
      body: `<p class="sp-hint">Na coluna <b>CAVALO</b> desta página, clicando com o botão direito aparece "Escalar veículo". Administradores sempre podem usar; marque os setores que também podem.</p>
        <div class="esc-sectors">${sectors.length ? sectors.map((s) => `<label class="inline"><input type="checkbox" data-s="${esc(s.id)}"${(cur.sectors || []).includes(s.id) ? ' checked' : ''}> ${esc(s.name)}</label>`).join('') : '<p class="sp-hint">Nenhum setor criado ainda (Compartilhar › Setores).</p>'}</div>
        <label class="field"><span>Aba com a escala</span><select class="input" id="esc-src">${doc.sheets.map((s) => `<option value="${esc(s.id)}"${srcNow && srcNow.sh.id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <p class="sp-hint">Os setores precisam poder ver a aba da escala e editar as colunas CAVALO, CARRETA, MOTORISTA, CPF e CONTATO desta página.</p>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const list = [...d.querySelectorAll('[data-s]')].filter((x) => x.checked).map((x) => x.dataset.s);
        const srcId = d.querySelector('#esc-src').value;
        App.change('Escalar veículo (setores)', () => { sh.escala = { sectors: list, src: srcId }; });
        notify(list.length ? 'Setores liberados para escalar veículo.' : 'Só administradores podem escalar veículo nesta página.');
      } }],
    });
  }

  App.on('contextItems', ({ hit, items }) => {
    if (hit.area !== 'cell' && hit.area !== 'fill') return;
    const sh = App.sheet();
    const col = cavaloCol(sh);
    if (!col) return;
    const p = App.realCell ? App.realCell(hit.r, hit.c) : { c: hit.c };
    if (!p || p.c !== col) return;
    const extra = [];
    if (canEscalar(sh)) extra.push({ label: 'Escalar veículo', icon: 'plus', cmd: 'escalarVeiculo' });
    const pp = perms();
    if (!pp || pp.admin) extra.push({ label: 'Escalar veículo: quem pode usar…', cmd: 'escalaConfig' });
    if (extra.length) items.splice(Math.min(items.length, 4), 0, ...extra, '-');
  });

  App.commands.def('escalarVeiculo', 'Escalar veículo', escalar);
  App.commands.def('escalaConfig', 'Escalar veículo: quem pode usar', config);
  App.escala = { dateKey, vehiclesToday, srcSheet, canEscalar };
})(window.App);
