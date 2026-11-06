// Ver › Painel do dia (e o botão de calendário no cabeçalho): o resumo da operação de hoje, pensado para o celular.
// - STATUS do MAPA IMPO e do MAPA EXPO (quantos em cada um);
// - PRÉ STACKING em aberto (sem FINALIZADO);
// - agendamentos de hoje (coleta, depot, entrega e retirada), pela hora;
// - atrasados no PRÉ STACKING (agendamento já passou e não está FINALIZADO);
// - demurrage do vazio: vencida ou vencendo em até 2 dias (DATA BAIXA + DEMMURAGE).
// Tocar num item leva até a linha. Tudo é calculado na hora, a partir da planilha aberta.
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc, esc = App.esc;
  const PS = () => App.preStacking;

  // ---------- datas ----------
  // valor da célula → número de série (dias desde 30/12/1899, com fração da hora) ou null
  function serial(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return v;
    const t = String(v === null || v === undefined ? '' : v).trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(t);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return E.dateToSerial(new Date(Date.UTC(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)))); }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
    if (m) return E.dateToSerial(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))));
    return null;
  }
  const agora = () => { const d = new Date(); return E.dateToSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()))); };
  const hoje = () => Math.floor(agora());
  const tsSerial = (ms) => { const d = new Date(ms); return E.dateToSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()))); };
  const p2 = (n) => String(n).padStart(2, '0');
  const fmtData = (s) => { const d = E.serialToDate(s); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
  const fmtHora = (s) => { const d = E.serialToDate(s); return s % 1 ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : '—'; };

  // ---------- leitura das abas (mesmas regras de nomes de coluna do PRÉ STACKING) ----------
  // linhas com container (ou cliente) depois do cabeçalho: [{ sh, si, r, get(alias) }]
  function linhas(sh) {
    const P = PS(), si = doc.sheets.indexOf(sh), map = P.colMap(sh), hr = P.headerRow(sh);
    const cc = P.findCol(map, P.A.CONTAINER), cl = P.findCol(map, P.A.CLIENTE);
    const rows = new Set();
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (!p || p.row <= hr || (p.col !== cc && p.col !== cl)) continue;
      const v = sh.cells[a].v;
      if (v !== '' && v !== null && v !== undefined) rows.add(p.row);
    }
    const cols = {};
    const col = (k) => (k in cols ? cols[k] : (cols[k] = P.findCol(map, P.A[k] || [k])));
    return [...rows].sort((x, y) => x - y).map((r) => ({
      sh, si, r, map,
      get: (k) => { const c = col(k); return c ? App.value(si, r, c) : null; },
      cell: (k) => { const c = col(k); return c ? sh.cells[E.addrToStr(r, c)] : null; },
      col,
    }));
  }
  const txt = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  const fin = (st) => PS().norm(st).includes('FINALIZ');
  const abas = () => {
    const P = PS(), o = { impo: null, expo: null, ch: null, vz: null };
    for (const sh of doc.sheets) { const k = P.kindOfMapa(sh) || P.kindOfPS(sh); if (k && !o[k]) o[k] = sh; }
    return o;
  };
  const linkDe = (L) => { for (const k of ['CONTAINER', 'OPERACAO']) { const x = L.cell(k); const l = x && PS().linkOf(x.psl); if (l) return Object.assign(l, { psf: x.psf || null }); } return null; };

  function goTo(sh, r, c) {
    const i = doc.sheets.indexOf(sh);
    if (i < 0) return;
    if (i !== doc.active) App.run('switchSheet', i);
    let rr = r, cc = c || 1;
    if (App.vm && App.dispCell) { const d = App.dispCell(r, cc); if (!d) return App.emit('notify', 'A linha está escondida pela sua visualização com filtro.'); rr = d.r; cc = d.c; }
    App.grid.select(rr, cc);
    App.grid.focus();
  }

  // ---------- cálculo ----------
  function calcula() {
    const ab = abas(), out = { status: [], abertos: { ch: 0, vz: 0 }, hoje: [], atrasados: [], demurrage: [], semAbas: [] };
    const H = hoje(), N = agora();
    const AGENDA = { impo: [['DHCOLETA', 'Coleta'], ['DHDEPOT', 'Depot']], expo: [['AGENDAMENTO', 'Entrega'], ['DHRETIRADA', 'Retirada']] };
    for (const k of ['impo', 'expo']) {
      const sh = ab[k];
      if (!sh) { out.semAbas.push(k === 'impo' ? 'MAPA IMPO' : 'MAPA EXPO'); continue; }
      const cont = {};
      let total = 0;
      for (const L of linhas(sh)) {
        total++;
        const st = txt(L.get('STATUS')) || '(sem STATUS)';
        cont[st] = (cont[st] || 0) + 1;
        for (const [campo, tipo] of AGENDA[k]) {
          const s = serial(L.get(campo));
          if (s !== null && Math.floor(s) === H) out.hoje.push({ s, tipo, sh, r: L.r, c: L.col(campo), cont: txt(L.get('CONTAINER')), cli: txt(L.get('CLIENTE')), st });
        }
      }
      out.status.push({ nome: sh.name, total, itens: Object.entries(cont).sort((a, b) => b[1] - a[1]) });
    }
    for (const k of ['ch', 'vz']) {
      const sh = ab[k];
      if (!sh) continue;
      for (const L of linhas(sh)) {
        const st = txt(L.get('STATUS'));
        if (fin(st)) continue;
        out.abertos[k]++;
        const ag = serial(L.get('AGENDAMENTO'));
        const base = { sh, r: L.r, cont: txt(L.get('CONTAINER')), cli: txt(L.get('CLIENTE')), op: txt(L.get('OPERACAO')) };
        if (ag !== null && ag < (ag % 1 ? N : H)) out.atrasados.push(Object.assign({ s: ag, c: L.col('AGENDAMENTO') }, base));
        if (k === 'vz') {
          const baixa = serial(L.get('DATABAIXA')), dem = Number(String(L.get('DEMPS') || '').replace(',', '.'));
          if (baixa !== null && dem > 0 && !serial(L.get('DATA'))) {
            const prazo = Math.floor(baixa) + dem, falta = prazo - H;
            if (falta <= 2) out.demurrage.push(Object.assign({ prazo, falta, c: L.col('DATABAIXA') }, base));
          }
        }
      }
    }
    out.hoje.sort((a, b) => a.s - b.s);
    out.atrasados.sort((a, b) => a.s - b.s);
    out.demurrage.sort((a, b) => a.falta - b.falta);
    return out;
  }

  // ---------- tela ----------
  const item = (x, i, meta) => `<button class="dia-it" data-i="${i}"><b>${esc(x.cont || '(sem container)')}</b><span>${esc(x.cli)}</span><small>${meta}</small></button>`;
  function render(box) {
    const d = App.withReal(calcula), H = hoje();
    const alertas = (document.querySelector('#btn-alert .al-n:not([hidden])') || {}).textContent || '0';
    const lista = [];
    const pega = (arr) => arr.map((x) => (lista.push(x), lista.length - 1));
    const secHoje = pega(d.hoje), secAtr = pega(d.atrasados), secDem = pega(d.demurrage);
    box.innerHTML = `
      <div class="dia-top"><span>${esc(fmtData(H))}</span>
        <button class="dia-chip ${+alertas ? 'on' : ''}" data-act="alertas">ALERTA <b>${esc(alertas)}</b></button>
        <span class="dia-chip">P.S. CHEIO em aberto <b>${d.abertos.ch}</b></span>
        <span class="dia-chip">P.S. VAZIO em aberto <b>${d.abertos.vz}</b></span></div>
      <div class="dia-cards">${d.status.map((m) => `<div class="dia-card"><h3>${esc(m.nome)} <small>${m.total} ${m.total === 1 ? 'linha' : 'linhas'}</small></h3>
        ${m.itens.slice(0, 8).map(([st, n]) => `<div class="dia-st"><span>${esc(st)}</span><b>${n}</b><i style="width:${Math.max(4, Math.round(100 * n / Math.max(1, m.total)))}%"></i></div>`).join('') || '<p class="sp-hint">Sem linhas.</p>'}</div>`).join('')}</div>
      <h3 class="dia-h">Agendamentos de hoje <small>${d.hoje.length}</small></h3>
      <div class="dia-list">${secHoje.map((i) => item(lista[i], i, `${esc(fmtHora(lista[i].s))} · ${esc(lista[i].tipo)} · ${esc(lista[i].sh.name)} · ${esc(lista[i].st)}`)).join('') || '<p class="sp-hint">Nenhum agendamento para hoje.</p>'}</div>
      <h3 class="dia-h bad">Atrasados no PRÉ STACKING <small>${d.atrasados.length}</small></h3>
      <div class="dia-list">${secAtr.map((i) => item(lista[i], i, `${esc(fmtData(lista[i].s))} ${esc(fmtHora(lista[i].s))} · ${esc(lista[i].op || lista[i].sh.name)}`)).join('') || '<p class="sp-hint">Nada atrasado.</p>'}</div>
      <h3 class="dia-h warn">Demurrage do vazio (vencida ou em até 2 dias) <small>${d.demurrage.length}</small></h3>
      <div class="dia-list">${secDem.map((i) => item(lista[i], i, lista[i].falta < 0 ? `<em class="bad">vencida há ${-lista[i].falta} ${lista[i].falta === -1 ? 'dia' : 'dias'}</em> · prazo ${esc(fmtData(lista[i].prazo))}` : `<em class="warn">${lista[i].falta === 0 ? 'vence hoje' : 'vence em ' + lista[i].falta + (lista[i].falta === 1 ? ' dia' : ' dias')}</em> · prazo ${esc(fmtData(lista[i].prazo))}`)).join('') || '<p class="sp-hint">Nenhuma demurrage vencendo.</p>'}</div>
      ${d.semAbas.length ? `<p class="sp-hint">Abas não encontradas: ${esc(d.semAbas.join(', '))}.</p>` : ''}`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { const x = lista[+b.dataset.i]; const m = box.closest('dialog'); if (m) m.querySelector('.modal-x').click(); goTo(x.sh, x.r, x.c); return; }
      if (e.target.closest('[data-act="alertas"]')) { const m = box.closest('dialog'); if (m) m.querySelector('.modal-x').click(); App.run('alerts'); }
    };
  }
  function abrir() {
    if (!PS()) return;
    const box = document.createElement('div');
    box.className = 'dia';
    render(box);
    App.ui.modal({ title: 'Painel do dia', width: '760px', cls: 'modal-tall', body: box, buttons: [{ label: 'Atualizar', action: () => { render(box); return false; } }, { label: 'Fechar', primary: true }] });
  }
  App.commands.def('painelDia', 'Painel do dia', abrir);
  // botão no cabeçalho (calendário), bom para o celular
  function botao() {
    const right = document.querySelector('.appbar-right');
    if (!right || document.getElementById('btn-dia')) return;
    const b = document.createElement('button');
    b.id = 'btn-dia'; b.className = 'icon-btn'; b.title = 'Painel do dia'; b.setAttribute('aria-label', 'Painel do dia');
    b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 6.5h14v13H5zM5 10.5h14M9 4v4M15 4v4M8.5 14h3v3h-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    b.onclick = () => App.run('painelDia');
    right.insertBefore(b, right.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', botao); else botao();
  App.opData = { serial, hoje, agora, tsSerial, fmtData, linhas, abas, txt, fin, linkDe, goTo };
})(window.App);
