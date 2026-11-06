// PRÉ STACKING: as colunas P.S. CH e P.S. VZ das abas MAPA IMPO e MAPA EXPO.
// - Marcar P.S. CH: muda o STATUS (AG. REMOÇÃO na IMPO, AG. EMBARQUE na EXPO) e cria a linha na aba PRÉ STACKING CHEIO,
//   2 linhas depois da última informação, com CLIENTE, RESERVA / DI, NAVIO, VIAGEM, OPERAÇÃO, CONTAINER, TIPO, PESO,
//   TERMINAL, AGENDAMENTO e VISIT CODE.
// - Marcar P.S. VZ: muda o STATUS (AG. DEVOLUÇÃO na IMPO, AG. RETIRADA na EXPO) e cria a linha na aba PRÉ STACKING VAZIO.
//   Clientes da regra (Administrador › "PRÉ STACKING VAZIO: clientes com 1 - / 2 - CONTAINER") usam 1 - CONTAINER,
//   1 - ARMADOR e 1 - TIPO; com 2 - CONTAINER, 2 - ARMADOR ou 2 - TIPO preenchido, cria 2 linhas.
// - Depois de levada, mudar um campo de um lado (MAPA ou PRÉ STACKING) pergunta "Unidade em Pré-Stacking deseja
//   atualizar informação?" e, com Sim, atualiza o outro lado. A DATA do PRÉ STACKING VAZIO ↔ DATA ENTREGA VAZIO do MAPA IMPO.
// - DATA BAIXA (PRÉ STACKING VAZIO): sempre que entra um container, todas as DATA BAIXA vazias da aba são buscadas
//   na API carga_of_container (pelo servidor) e gravadas em dd/mm/aaaa.
// - Pré stacking concluído (STATUS FINALIZADO na aba do PRÉ STACKING): o STATUS do MAPA muda (CHEIO: EM ABERTO na IMPO, PROC. - FINALIZADO na EXPO;
//   VAZIO: AG. INTERCAMBIO na IMPO, EM ABERTO na EXPO).
// O vínculo fica marcado nas células (psl): na caixa P.S. do MAPA, o código do vínculo; no PRÉ STACKING, nas células
// CONTAINER e OPERAÇÃO, "idDaAbaDoMapa~código~ch|vz~0|1|2" (0 = colunas normais, 1/2 = colunas 1 - / 2 -).
// Tudo acontece dentro da mesma alteração (um Desfazer volta tudo).
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc;
  const notify = (m) => setTimeout(() => App.emit('notify', m), 60);
  const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/\b(DE|DA|DO|DAS|DOS)\b/g, ' ').replace(/[^A-Z0-9]/g, '');

  // ---------- Abas ----------
  const kindOfMapa = (sh) => { const n = norm(sh && sh.name); return !n.startsWith('MAPA') ? null : n.includes('IMPO') ? 'impo' : n.includes('EXPO') ? 'expo' : null; };
  const kindOfPS = (sh) => { const n = norm(sh && sh.name); return !(n.includes('STACKING') || n.startsWith('PS')) ? null : n.includes('CHEIO') ? 'ch' : n.includes('VAZIO') ? 'vz' : null; };
  const psSheet = (k) => doc.sheets.find((s) => kindOfPS(s) === k) || null;

  // ---------- Colunas (pelo nome, sem acentos/pontuação; aceita apelidos) ----------
  // linha do cabeçalho: a primeira (até a 15ª) que tenha CONTAINER; sem isso, a 1
  function headerRow(sh) {
    if (sh.filter && sh.filter.r1 > 0) return sh.filter.r1;
    let row = 0;
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (!p || p.row > 15 || (row && p.row >= row)) continue;
      if (norm(sh.cells[a].v) === 'CONTAINER') row = p.row;
    }
    return row || 1;
  }
  function colMap(sh) {
    const map = new Map();
    const hr = headerRow(sh), names = sh.colNames || {};
    const maxC = Math.max(App.usedRange(sh).maxC || 0, ...Object.keys(names).map(Number), 1);
    for (let c = 1; c <= maxC; c++) {
      const x = sh.cells[E.addrToStr(hr, c)];
      for (const label of [names[c], x && x.v]) { const k = norm(label); if (k && !map.has(k)) map.set(k, c); }
    }
    return map;
  }
  const findCol = (map, aliases) => { for (const a of aliases) { const c = map.get(norm(a)); if (c) return c; } return null; };

  // apelidos dos nomes de coluna
  const A = {
    CLIENTE: ['CLIENTE'], NAVIO: ['NAVIO'], VIAGEM: ['VIAGEM'], CONTAINER: ['CONTAINER'], TIPO: ['TIPO'], PESO: ['PESO'],
    ARMADOR: ['ARMADOR'], DEM: ['DEM', 'DEMURRAGE', 'DEMMURAGE'], STATUS: ['STATUS'],
    PSCH: ['P.S. CH', 'PS CH', 'P.S. CHEIO', 'PRE STACKING CHEIO'], PSVZ: ['P.S. VZ', 'PS VZ', 'P.S. VAZIO', 'PRE STACKING VAZIO'],
    C1: ['1 - CONTAINER'], C2: ['2 - CONTAINER'], A1: ['1 - ARMADOR'], A2: ['2 - ARMADOR'], T1: ['1 - TIPO'], T2: ['2 - TIPO'],
    // MAPA IMPO
    DIDTA: ['DI / DTA', 'DI/DTA', 'DI'], TCOLETA: ['TERMINAL COLETA', 'TERMINAL DE COLETA'], DHCOLETA: ['DATA / HORA - COLETA', 'DATA / HORA COLETA', 'DATA HORA COLETA'],
    NAGEND: ['N° AGEND.', 'N° AGENDAMENTO', 'NUMERO AGENDAMENTO'], TVAZIO: ['TERMINAL VAZIO', 'TERMINAL DE VAZIO'],
    DHDEPOT: ['DATA / HORA - DEPOT', 'DATA / HORA DEPOT', 'DATA HORA DEPOT'], DTENTVZ: ['DATA ENTREGA VAZIO', 'DATA DE ENTREGA DO VAZIO'],
    // MAPA EXPO
    RESERVA: ['RESERVA', 'BOOKING'], ENTREGA: ['ENTREGA'], AGENDAMENTO: ['AGENDAMENTO'], NAGENDAMENTO: ['N° AGENDAMENTO', 'N° AGEND.', 'NUMERO AGENDAMENTO'],
    RETIRADA: ['RETIRADA'], DHRETIRADA: ['DATA / HORA RETIRADA', 'DATA / HORA - RETIRADA', 'DATA HORA RETIRADA'],
    // PRÉ STACKING
    RESDI: ['RESERVA / DI', 'RESERVA/DI', 'DI / RESERVA', 'RESERVA DI'], OPERACAO: ['OPERAÇÃO', 'OPERACAO'], TERMINAL: ['TERMINAL'],
    VISIT: ['VISIT CODE', 'VISITCODE'], DEMPS: ['DEMMURAGE', 'DEMURRAGE', 'DEMURRAGEM', 'DEM'], DATABAIXA: ['DATA BAIXA', 'DATA DA BAIXA'], DATA: ['DATA'],
  };

  // Campos de cada PRÉ STACKING: [campo no PRÉ STACKING, apelido da origem na IMPO, na EXPO]
  // n = 1/2: nas linhas dos clientes da regra, CONTAINER, ARMADOR e TIPO vêm das colunas 1 - / 2 -
  const FIELDS = {
    ch: [
      ['CLIENTE', 'CLIENTE', 'CLIENTE'], ['RESDI', 'DIDTA', 'RESERVA'], ['NAVIO', 'NAVIO', 'NAVIO'], ['VIAGEM', 'VIAGEM', 'VIAGEM'],
      ['CONTAINER', 'CONTAINER', 'CONTAINER'], ['TIPO', 'TIPO', 'TIPO'], ['PESO', 'PESO', 'PESO'], ['TERMINAL', 'TCOLETA', 'ENTREGA'],
      ['AGENDAMENTO', 'DHCOLETA', 'AGENDAMENTO'], ['VISIT', 'NAGEND', 'NAGENDAMENTO'],
    ],
    vz: [
      ['CLIENTE', 'CLIENTE', 'CLIENTE'], ['ARMADOR', 'ARMADOR', 'ARMADOR'], ['DEMPS', 'DEM', 'DEM'], ['RESDI', 'DIDTA', 'RESERVA'],
      ['CONTAINER', 'CONTAINER', 'CONTAINER'], ['TIPO', 'TIPO', 'TIPO'], ['TERMINAL', 'TVAZIO', 'RETIRADA'], ['AGENDAMENTO', 'DHDEPOT', 'DHRETIRADA'],
    ],
  };
  const RULE_SRC = { CONTAINER: ['C1', 'C2'], ARMADOR: ['A1', 'A2'], TIPO: ['T1', 'T2'] };
  const OPERACAO = { ch: { impo: 'REMOÇÃO', expo: 'EMBARQUE' }, vz: { impo: 'DEVOLUÇÃO', expo: 'RETIRADA' } };
  const STATUS_AO_MARCAR = { ch: { impo: 'AG. REMOÇÃO', expo: 'AG. EMBARQUE' }, vz: { impo: 'AG. DEVOLUÇÃO', expo: 'AG. RETIRADA' } };
  const STATUS_CONCLUIDO = { ch: { impo: 'EM ABERTO', expo: 'PROC. - FINALIZADO' }, vz: { impo: 'AG. INTERCAMBIO', expo: 'EM ABERTO' } };
  const PS_NAME = { ch: 'PRÉ STACKING CHEIO', vz: 'PRÉ STACKING VAZIO' };

  const srcCol = (map, kind, f, n) => {
    const k = n && RULE_SRC[f[0]] ? RULE_SRC[f[0]][n - 1] : (kind === 'impo' ? f[1] : f[2]);
    return findCol(map, A[k]);
  };

  // ---------- Regra dos clientes (1 - / 2 - CONTAINER) ----------
  // fica na aba PRÉ STACKING VAZIO (psClientes); o administrador ajusta pelo menu Administrador
  const ruleList = () => { const s = psSheet('vz'); return (s && Array.isArray(s.psClientes) ? s.psClientes : []).map(norm).filter((x) => x.length >= 2); };
  const isRuleClient = (cliente) => { const c = norm(cliente); return !!c && ruleList().some((k) => c === k || (k.length >= 3 && c.includes(k))); };

  // ---------- Leitura e escrita ----------
  const hasText = (x) => x !== null && x !== undefined && String(x).trim() !== '';
  const rawAt = (sh, r, c) => { const x = c ? sh.cells[E.addrToStr(r, c)] : null; return x && x.v !== undefined && x.v !== null ? x.v : ''; };
  // valor para levar a outra aba: o texto da célula (fórmula vira o resultado) e o formato de número
  function readCell(sh, r, c) {
    if (!c) return null;
    const raw = rawAt(sh, r, c);
    const nf = ((sh.cells[E.addrToStr(r, c)] || {}).s || {}).nf;
    if (typeof raw === 'string' && raw[0] === '=') {
      const v = App.value(doc.sheets.indexOf(sh), r, c);
      if (v === null || v === undefined || (E.isErr && E.isErr(v))) return null;
      return { v: typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v), nf };
    }
    return hasText(raw) ? { v: String(raw), nf } : null;
  }
  function writeCell(sh, r, c, val) {
    if (!c) return;
    App.setRaw(sh, r, c, val ? val.v : '');
    // datas digitadas sem formato próprio (10/11/2026 14:00) continuam aparecendo como data
    let nf = val && (val.nf || App.autoFormatFor(val.v));
    if (nf === 'dd/mm/yyyy hh:mm:ss' && !(val && val.nf) && !/\d:\d\d:\d\d/.test(val.v)) nf = 'dd/mm/yyyy hh:mm';
    if (nf) App.setStyle(sh, r, c, (s) => { s.nf = nf; });
  }
  const sameRaw = (a, b) => String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b);
  const canEdit = (sh, r, c) => !c || !App.editGuard || !App.editGuard(sh, r, c, true);
  // texto do STATUS como está na lista suspensa da coluna (AG. INTERCAMBIO = AG. INTERCÂMBIO)
  function statusText(sh, r, c, want) {
    try {
      const d = App.dvAt(sh, r, c);
      if (d && (d.type === 'list' || d.type === 'range')) {
        const hit = (App.dvItems(sh, d) || []).find((x) => norm(x) === norm(want));
        if (hit) return String(hit);
      }
    } catch (e) { /* lista com erro: usa o texto combinado */ }
    return want;
  }
  // devolve o texto gravado (ou null se não mudou)
  function setStatus(sh, r, map, want) {
    const c = findCol(map, A.STATUS);
    if (!c || !canEdit(sh, r, c)) return null;
    const t = statusText(sh, r, c, want);
    if (sameRaw(rawAt(sh, r, c), t)) return null;
    App.setRaw(sh, r, c, t);
    return t;
  }
  const cbOn = (sh, r, c, cell) => {
    const d = App.dvAt(sh, r, c);
    const raw = cell && cell.v !== undefined && cell.v !== null ? cell.v : '';
    if (d && d.type === 'checkbox') return App.cbIsOn(d, raw, raw === true ? true : undefined);
    return raw === true || /^(true|verdadeiro|sim|x|ok)$/i.test(String(raw).trim());
  };

  // última linha com informação (depois do cabeçalho)
  function lastInfoRow(sh) {
    const hr = headerRow(sh), si = doc.sheets.indexOf(sh);
    let last = hr;
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (!p || p.row <= last) continue;
      const raw = sh.cells[a].v;
      if (!hasText(raw)) continue;
      if (typeof raw === 'string' && raw[0] === '=') { const v = App.value(si, p.row, p.col); if (!hasText(v) || (E.isErr && E.isErr(v))) continue; }
      last = p.row;
    }
    return last;
  }

  // ---------- Vínculo ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const linkOf = (s) => { const m = /^([^~]+)~([^~]+)~(ch|vz)~([012])$/.exec(String(s || '')); return m ? { sheetId: m[1], id: m[2], k: m[3], n: +m[4] } : null; };
  // vínculo de uma linha do PRÉ STACKING (células CONTAINER ou OPERAÇÃO)
  function rowLink(sh, map, r, cells) {
    for (const c of [findCol(map, A.CONTAINER), findCol(map, A.OPERACAO)]) {
      if (!c) continue;
      const x = (cells || sh.cells)[E.addrToStr(r, c)];
      const l = x && linkOf(x.psl);
      if (l) return l;
    }
    return null;
  }
  // linhas do PRÉ STACKING ligadas a um código
  function psRowsOf(ps, id) {
    const map = colMap(ps), out = [];
    for (const c of [findCol(map, A.CONTAINER), findCol(map, A.OPERACAO)]) {
      if (!c) continue;
      for (const a in ps.cells) {
        const p = E.parseAddr(a);
        if (!p || p.col !== c) continue;
        const l = linkOf(ps.cells[a].psl);
        if (l && l.id === id && !out.includes(p.row)) out.push(p.row);
      }
    }
    return out.sort((x, y) => x - y);
  }
  // linha do MAPA com o código (na coluna P.S. CH ou P.S. VZ)
  function mapaRowOf(sh, map, k, id) {
    const c = findCol(map, k === 'ch' ? A.PSCH : A.PSVZ);
    if (!c) return null;
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (p && p.col === c && sh.cells[a].psl === id) return p.row;
    }
    return null;
  }

  // ---------- Marcar P.S. CH / P.S. VZ ----------
  function levar(sh, kind, map, r, k, cbCol, msgs) {
    const ps = psSheet(k);
    const cbAddr = E.addrToStr(r, cbCol);
    const desfaz = (why) => {
      // sem a aba do PRÉ STACKING: desmarca a caixa (nada fica pela metade)
      const x = sh.cells[cbAddr];
      if (x) { x.v = App.cbValues(App.dvAt(sh, r, cbCol)).off; App.cleanup(sh, cbAddr); }
      msgs.push(why);
    };
    if (!ps) { desfaz(`A aba ${PS_NAME[k]} não existe ou não está liberada para você. A caixa foi desmarcada.`); return true; }
    const cell = sh.cells[cbAddr];
    // já levado antes (e a linha ainda está lá): não duplica
    if (cell.psl && psRowsOf(ps, cell.psl).length) { msgs.push(`Linha ${r}: já está no ${PS_NAME[k]} (linha ${psRowsOf(ps, cell.psl).join(' e ')}).`); return false; }
    const pm = colMap(ps);
    const cliente = readCell(sh, r, findCol(map, A.CLIENTE));
    // linhas a criar: 0 = colunas normais; clientes da regra (só no vazio): 1 e, se tiver 2 - preenchido, 2
    let parts = [0];
    if (k === 'vz' && cliente && isRuleClient(cliente.v)) {
      const has2 = ['C2', 'A2', 'T2'].some((x) => readCell(sh, r, findCol(map, A[x])));
      parts = has2 ? [1, 2] : [1];
    }
    const id = cell.psl || newId();
    let row = lastInfoRow(ps) + 2;
    const made = [], containers = [];
    for (const n of parts) {
      if (row > (ps.rows || 0)) ps.rows = row + 50;
      for (const f of FIELDS[k]) {
        const tc = findCol(pm, A[f[0]]);
        if (!tc) continue;
        const val = readCell(sh, r, srcCol(map, kind, f, n));
        if (val) writeCell(ps, row, tc, val);
        if (f[0] === 'CONTAINER' && val) containers.push(val.v);
      }
      const oc = findCol(pm, A.OPERACAO);
      if (oc) App.setRaw(ps, row, oc, OPERACAO[k][kind]);
      // vínculo nas células CONTAINER e OPERAÇÃO
      const link = `${sh.id}~${id}~${k}~${n}`;
      for (const c of [findCol(pm, A.CONTAINER), oc]) {
        if (!c) continue;
        const a = E.addrToStr(row, c);
        (ps.cells[a] || (ps.cells[a] = { v: '' })).psl = link;
      }
      made.push(row);
      if (k === 'vz' && containers.length) baixaPend = true;
      row++;
    }
    cell.psl = id;
    const st = setStatus(sh, r, map, STATUS_AO_MARCAR[k][kind]);
    const ct = containers.length ? containers.join(' e ') : 'o container';
    msgs.push(`${ct} → ${PS_NAME[k]} (linha ${made.join(' e ')})${st ? `; STATUS: ${st}` : ''}.`);
    return true;
  }

  // ---------- Pré stacking concluído ----------
  // concluído = coluna STATUS (ou SITUAÇÃO) da aba do PRÉ STACKING com FINALIZADO
  function concluidoCols(map) {
    const out = [];
    for (const [name, c] of map) if (name === 'STATUS' || name === 'SITUACAO') out.push({ c });
    return out;
  }
  function rowConcluida(ps, map, r) {
    for (const o of concluidoCols(map)) { const x = ps.cells[E.addrToStr(r, o.c)]; if (norm(x && x.v).includes('FINALIZ')) return true; }
    return false;
  }

  // ---------- DATA BAIXA (API carga_of_container, pelo servidor) ----------
  // Sempre que um container entra no PRÉ STACKING VAZIO (linha criada pelo P.S. VZ, digitado ou colado), a planilha
  // procura na API todos os containers da aba com a DATA BAIXA vazia (uma consulta para todos) e preenche dd/mm/aaaa.
  // Trocar o CONTAINER de uma linha busca de novo a DATA BAIXA dela. Também roda ao abrir a aba (no máximo a cada 10 min).
  let baixaPend = false, baixaRodando = false, baixaUltima = 0;
  const baixaForcar = new Map(); // "idDaAba:linha" -> container (linha cujo CONTAINER mudou: sobrescreve a DATA BAIXA)
  const naoAchou = new Map(); // container -> quando a API disse que não tem (não pergunta de novo por 10 min)
  const pedirBaixa = () => { baixaPend = true; setTimeout(buscaBaixa, 200); };
  async function buscaBaixa() {
    if (!baixaPend || baixaRodando) return;
    baixaPend = false;
    if (!App.cloudMode || !App.collab || !App.collab.api) return;
    const ps = psSheet('vz');
    if (!ps) return;
    const alvo = [];
    App.withReal(() => {
      const pm = colMap(ps), cc = findCol(pm, A.CONTAINER), dc = findCol(pm, A.DATABAIXA);
      if (!cc || !dc) return;
      for (const a in ps.cells) {
        const p = E.parseAddr(a);
        if (!p || p.col !== cc || p.row <= headerRow(ps)) continue;
        const cont = String(rawAt(ps, p.row, cc) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (cont.length < 6) continue;
        const forc = baixaForcar.get(ps.id + ':' + p.row);
        if (!forc && hasText(rawAt(ps, p.row, dc))) continue;
        if (!forc && naoAchou.has(cont) && Date.now() - naoAchou.get(cont) < 10 * 60e3) continue;
        if (!canEdit(ps, p.row, dc)) continue;
        alvo.push({ row: p.row, cont, forc: !!forc });
      }
    });
    baixaForcar.clear();
    if (!alvo.length) return;
    baixaRodando = true;
    baixaUltima = Date.now();
    let res;
    try { res = await App.collab.api('POST', '/api/carga/datas-baixa', { containers: [...new Set(alvo.map((x) => x.cont))] }); }
    catch (e) { App.emit('notify', `DATA BAIXA: ${e.message}`); baixaRodando = false; return; }
    baixaRodando = false;
    const r = (res && res.resultados) || {};
    const faltam = [];
    App.withReal(() => {
      const pm = colMap(ps), cc = findCol(pm, A.CONTAINER), dc = findCol(pm, A.DATABAIXA);
      if (!cc || !dc) return;
      const muda = [];
      for (const x of alvo) {
        const data = r[x.cont];
        if (!data) { naoAchou.set(x.cont, Date.now()); if (!faltam.includes(x.cont)) faltam.push(x.cont); continue; }
        // a linha ainda tem o mesmo container (e, se não era troca, a DATA BAIXA continua vazia)
        if (String(rawAt(ps, x.row, cc) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') !== x.cont) continue;
        if (!x.forc && hasText(rawAt(ps, x.row, dc))) continue;
        if (sameRaw(rawAt(ps, x.row, dc), data)) continue;
        muda.push([x.row, data]);
      }
      if (muda.length) App.change('DATA BAIXA (API)', () => { for (const [row, data] of muda) { App.setRaw(ps, row, dc, data); App.setStyle(ps, row, dc, (st) => { st.nf = 'dd/mm/yyyy'; }); } });
      if (muda.length) App.emit('notify', `DATA BAIXA preenchida em ${muda.length} ${muda.length === 1 ? 'linha' : 'linhas'} do PRÉ STACKING VAZIO.`);
      if (muda.length && App.logAuto) App.logAuto('DATA BAIXA', `Preenchida pela API em ${muda.length} ${muda.length === 1 ? 'linha' : 'linhas'}: ${muda.map(([row, data]) => `linha ${row} = ${data}`).slice(0, 8).join(', ')}`, ps.name);
    });
    if (faltam.length) App.emit('notify', `DATA BAIXA: ${faltam.length === 1 ? 'o container ' + faltam[0] + ' não foi encontrado' : faltam.length + ' containers não foram encontrados'} na API.`);
    if (baixaPend) setTimeout(buscaBaixa, 200);
  }
  // abrir a aba PRÉ STACKING VAZIO também confere as DATA BAIXA vazias (no máximo a cada 10 min)
  App.on('sheet', () => { const sh = doc.sheets[doc.active]; if (sh && kindOfPS(sh) === 'vz' && Date.now() - baixaUltima > 10 * 60e3) pedirBaixa(); });

  // ---------- Confirmação dos dois sentidos (MAPA ↔ PRÉ STACKING) ----------
  // Com a unidade já no PRÉ STACKING, mudar no MAPA um campo que foi levado (ou mudar no PRÉ STACKING um campo que veio
  // do MAPA) pergunta "Unidade em Pré-Stacking deseja atualizar informação?" antes de copiar para o outro lado.
  let pergunta = [];
  function perguntar() {
    const lista = pergunta.splice(0);
    if (!lista.length) return;
    const linhas = lista.slice(0, 8).map((x) => `<li>${App.esc(x.desc)}</li>`).join('') + (lista.length > 8 ? `<li>… e mais ${lista.length - 8}</li>` : '');
    App.ui.modal({
      title: 'Unidade em Pré-Stacking deseja atualizar informação?', width: '520px',
      body: `<p class="modal-text">A unidade já está no PRÉ STACKING. Atualizar também do outro lado?</p><ul class="modal-text" style="margin:8px 0 0 18px">${linhas}</ul>`,
      buttons: [{ label: 'Não' }, { label: 'Sim, atualizar', primary: true, action: () => aplicar(lista) }],
    });
  }
  let aplicando = false;
  function aplicar(lista) {
    const sem = new Set();
    let feitos = 0;
    aplicando = true; // a cópia confirmada não gera uma nova pergunta no sentido contrário
    try { App.withReal(() => {
      App.change('Atualizar MAPA / PRÉ STACKING', () => {
        for (const x of lista) {
          const alvo = x.alvo();
          if (!alvo) continue;
          if (!canEdit(alvo.sh, alvo.r, alvo.c)) { sem.add(`${alvo.sh.name} ${E.numToCol ? E.numToCol(alvo.c) : alvo.c}`); continue; }
          if (sameRaw(rawAt(alvo.sh, alvo.r, alvo.c), x.val ? x.val.v : '')) continue;
          writeCell(alvo.sh, alvo.r, alvo.c, x.val);
          feitos++;
          if (alvo.baixa) baixaForcar.set(alvo.sh.id + ':' + alvo.r, true);
        }
      });
    }); } finally { aplicando = false; }
    if (baixaForcar.size) pedirBaixa();
    if (feitos && App.logAuto) App.logAuto('Confirmação MAPA ↔ PRÉ STACKING', `Confirmado: ${lista.map((x) => x.desc).slice(0, 6).join('; ')}`);
    App.emit('notify', (feitos ? `${feitos} ${feitos === 1 ? 'campo atualizado' : 'campos atualizados'}.` : 'Nada a atualizar.') + (sem.size ? ` Sem permissão: ${[...sem].join(', ')}.` : ''));
  }

  // ---------- Gancho chamado por App.change ----------
  // fwd/inv: o que a pessoa mudou. Devolve true se mexeu em mais alguma coisa.
  function hook(fwd, inv) {
    if (!fwd || !fwd.sheets || fwd.order || aplicando) return false;
    if (Object.values(fwd.sheets).some((e) => e.created || e.removed || (e.props && 'rows' in e.props))) return false;
    App.invalidate();
    const msgs = [];
    let changed = false;
    App.withReal(() => {
      for (const id in fwd.sheets) {
        const e = fwd.sheets[id];
        if (!e.cells) continue;
        const sh = doc.sheets.find((x) => x.id === id);
        if (!sh) continue;
        const ic = (inv.sheets[id] && inv.sheets[id].cells) || {};
        const kind = kindOfMapa(sh), pk = kindOfPS(sh);
        if (kind) changed = fromMapa(sh, kind, e.cells, ic, msgs) || changed;
        else if (pk) changed = fromPS(sh, pk, e.cells, ic, msgs) || changed;
      }
    });
    if (msgs.length) notify(msgs.slice(0, 4).join(' ') + (msgs.length > 4 ? ` (+${msgs.length - 4})` : ''));
    if (msgs.length && App.logAuto) msgs.forEach((m) => App.logAuto('PRÉ STACKING', m));
    if (baixaPend) setTimeout(buscaBaixa, 200);
    if (pergunta.length) setTimeout(perguntar, 120);
    return changed;
  }

  function fromMapa(sh, kind, fc, ic, msgs) {
    const map = colMap(sh);
    const contCol = findCol(map, A.CONTAINER);
    let changed = false;
    const levadas = new Set();
    for (const k of ['ch', 'vz']) {
      const cbCol = findCol(map, k === 'ch' ? A.PSCH : A.PSVZ);
      if (!cbCol) continue;
      const rows = [];
      for (const a in fc) {
        const p = E.parseAddr(a);
        if (!p || p.col !== cbCol || p.row <= headerRow(sh)) continue;
        const after = sh.cells[a];
        if (!after || !cbOn(sh, p.row, cbCol, after) || cbOn(sh, p.row, cbCol, ic[a])) continue;
        // linha inteira trocada de lugar (ordenar, inserir/excluir linhas, colar a linha toda): não é uma marcação
        if (contCol) { const ca = E.addrToStr(p.row, contCol); if (ca in fc && !sameRaw(fc[ca] && fc[ca].v, ic[ca] && ic[ca].v)) continue; }
        if (ic[a] && ic[a].psl !== after.psl) continue;
        rows.push(p.row);
      }
      for (const r of rows.sort((x, y) => x - y)) { levadas.add(k + r); if (levar(sh, kind, map, r, k, cbCol, msgs)) changed = true; }
    }
    // campos levados mudados no MAPA (linha já no PRÉ STACKING): pergunta antes de atualizar o PRÉ STACKING
    const porLinha = new Map();
    for (const a in fc) {
      const p = E.parseAddr(a);
      if (!p || p.row <= headerRow(sh) || sameRaw(fc[a] && fc[a].v, ic[a] && ic[a].v)) continue;
      if (!porLinha.has(p.row)) porLinha.set(p.row, []);
      porLinha.get(p.row).push(p.col);
    }
    for (const [r, cs] of porLinha) {
      for (const k of ['ch', 'vz']) {
        if (levadas.has(k + r)) continue;
        const cbCol = findCol(map, k === 'ch' ? A.PSCH : A.PSVZ);
        if (!cbCol) continue;
        const ca = E.addrToStr(r, cbCol), cb = sh.cells[ca];
        if (!cb || !cb.psl) continue;
        if (ca in fc && (!ic[ca] || ic[ca].psl !== cb.psl)) continue; // a linha só mudou de lugar
        const ps = psSheet(k);
        if (!ps) continue;
        const id = cb.psl, pm = colMap(ps);
        for (const pr of psRowsOf(ps, id)) {
          const l = rowLink(ps, pm, pr);
          if (!l) continue;
          for (const c of cs) {
            let f = FIELDS[k].find((ff) => srcCol(map, kind, ff, l.n) === c);
            let tf = f ? f[0] : null;
            if (!tf && k === 'vz' && kind === 'impo' && c === findCol(map, A.DTENTVZ)) tf = 'DATA';
            if (!tf || !findCol(pm, A[tf])) continue;
            const val = readCell(sh, r, c), n = l.n, psId = ps.id;
            if (sameRaw(rawAt(ps, pr, findCol(pm, A[tf])), val ? val.v : '')) continue; // o outro lado já está igual
            pergunta.push({
              desc: `${PS_NAME[k]}: ${A[tf][0]} → ${val ? val.v : '(vazio)'}`, val,
              alvo: () => {
                const p2 = doc.sheets.find((x) => x.id === psId);
                if (!p2) return null;
                const m2 = colMap(p2);
                const row = psRowsOf(p2, id).find((x) => { const rl = rowLink(p2, m2, x); return rl && rl.n === n; });
                return row ? { sh: p2, r: row, c: findCol(m2, A[tf]), baixa: k === 'vz' && tf === 'CONTAINER' } : null;
              },
            });
          }
        }
      }
    }
    return changed;
  }

  function fromPS(ps, k, fc, ic, msgs) {
    const pm = colMap(ps);
    const hr = headerRow(ps);
    // colunas do PRÉ STACKING que vieram do MAPA (OPERAÇÃO e DATA BAIXA não voltam)
    const back = new Map();
    for (const f of FIELDS[k]) { const c = findCol(pm, A[f[0]]); if (c) back.set(c, f); }
    const dataCol = k === 'vz' ? findCol(pm, A.DATA) : null;
    const rows = new Map();
    for (const a in fc) {
      const p = E.parseAddr(a);
      if (!p || p.row <= hr) continue;
      if (!rows.has(p.row)) rows.set(p.row, []);
      rows.get(p.row).push(p.col);
    }
    let changed = false;
    const semPerm = new Set();
    const concl = concluidoCols(pm).map((o) => o.c);
    if (k === 'vz') {
      const cc = findCol(pm, A.CONTAINER);
      for (const [r, cs] of rows) {
        if (!cc || !cs.includes(cc)) continue;
        const a = E.addrToStr(r, cc);
        if (!hasText(rawAt(ps, r, cc)) || sameRaw(fc[a] && fc[a].v, ic[a] && ic[a].v)) continue;
        // container trocado (não só incluído): a DATA BAIXA antiga era do container anterior
        if (ic[a] && hasText(ic[a].v)) baixaForcar.set(ps.id + ':' + r, true);
        baixaPend = true;
      }
    }
    for (const [r, cs] of rows) {
      const link = rowLink(ps, pm, r);
      if (!link || link.k !== k) continue;
      // a linha só trocou de lugar (o vínculo mudou junto): nada a fazer
      const before = rowLink(ps, pm, r, Object.assign({}, ps.cells, ic));
      if (!before || before.id !== link.id || before.n !== link.n) continue;
      const sh = doc.sheets.find((x) => x.id === link.sheetId);
      const kind = kindOfMapa(sh);
      if (!kind) { msgs.push(`A aba do MAPA desta linha não está liberada para você; a mudança ficou só no ${PS_NAME[k]}.`); continue; }
      const map = colMap(sh);
      const mr = mapaRowOf(sh, map, k, link.id);
      if (!mr) continue;
      for (const c of cs) {
        const a = E.addrToStr(r, c);
        if (sameRaw(fc[a] && fc[a].v, ic[a] && ic[a].v)) continue;
        let target = null, nome = '';
        let dtEnt = false;
        if (back.has(c)) target = srcCol(map, kind, back.get(c), link.n);
        else if (c === dataCol && kind === 'impo') { target = findCol(map, A.DTENTVZ); dtEnt = true; }
        if (!target) continue;
        // na pergunta aparece o nome da coluna como está no MAPA (ex.: TERMINAL VAZIO)
        nome = String(rawAt(sh, headerRow(sh), target) || (sh.colNames || {})[target] || '').trim() || (dtEnt ? 'DATA ENTREGA VAZIO' : A[back.get(c)[0]][0]);
        const val = readCell(ps, r, c);
        if (sameRaw(rawAt(sh, mr, target), val ? val.v : '')) continue;
        // pergunta antes de mudar o MAPA (a unidade já está no PRÉ STACKING)
        const shId = sh.id, lk = link;
        pergunta.push({
          desc: `${sh.name}: ${nome} → ${val ? val.v : '(vazio)'}`, val,
          alvo: () => {
            const s2 = doc.sheets.find((x) => x.id === shId);
            const kd = kindOfMapa(s2);
            if (!kd) return null;
            const m2 = colMap(s2), row = mapaRowOf(s2, m2, lk.k, lk.id);
            if (!row) return null;
            const col = dtEnt ? findCol(m2, A.DTENTVZ) : srcCol(m2, kd, back.get(c), lk.n);
            return col ? { sh: s2, r: row, c: col } : null;
          },
        });
      }
      // concluído: muda o STATUS do MAPA (com 2 linhas no vazio, quando as duas estiverem concluídas)
      if (cs.some((c) => concl.includes(c))) {
        // quando a linha ficou FINALIZADO: guarda a hora (psf) para os indicadores e o aviso no celular
        if (rowConcluida(ps, pm, r) && !rowConcluidaAntes(ps, pm, r, ic)) {
          for (const lc of [findCol(pm, A.CONTAINER), findCol(pm, A.OPERACAO)]) { const x = lc && ps.cells[E.addrToStr(r, lc)]; if (x && x.psl && !x.psf) { x.psf = Date.now(); changed = true; } }
        }
        const linhas = psRowsOf(ps, link.id);
        const agora = linhas.every((x) => rowConcluida(ps, pm, x));
        const antes = rowConcluidaAntes(ps, pm, r, ic) && linhas.filter((x) => x !== r).every((x) => rowConcluida(ps, pm, x));
        const st = agora && !antes ? setStatus(sh, mr, map, STATUS_CONCLUIDO[k][kind]) : null;
        if (st) {
          msgs.push(`${PS_NAME[k]} concluído: STATUS da linha ${mr} do ${sh.name} → ${st}.`);
          changed = true;
        }
      }
    }
    if (semPerm.size) msgs.push(`Sem permissão para atualizar no MAPA a(s) coluna(s) ${[...semPerm].join(', ')}; a mudança ficou só no ${PS_NAME[k]}.`);
    return changed;
  }
  function rowConcluidaAntes(ps, pm, r, ic) {
    const saved = {};
    for (const a in ic) { saved[a] = ps.cells[a]; if (ic[a]) ps.cells[a] = ic[a]; else delete ps.cells[a]; }
    try { return rowConcluida(ps, pm, r); } finally { for (const a in saved) { if (saved[a]) ps.cells[a] = saved[a]; else delete ps.cells[a]; } }
  }

  // ---------- Administrador: clientes da regra ----------
  App.commands.def('psRegra', 'PRÉ STACKING VAZIO: clientes com 1 - / 2 - CONTAINER', () => {
    if (App.adminOnly && App.adminOnly()) return App.emit('notify', 'Somente administradores ajustam a regra dos clientes do PRÉ STACKING VAZIO.');
    const ps = psSheet('vz');
    if (!ps) return App.emit('notify', 'A aba PRÉ STACKING VAZIO não foi encontrada.');
    const cur = Array.isArray(ps.psClientes) ? ps.psClientes : [];
    App.ui.modal({
      title: 'PRÉ STACKING VAZIO — clientes da regra', width: '520px',
      body: `<p class="sp-hint">Para os clientes desta lista, ao marcar <b>P.S. VZ</b> o container, o armador e o tipo vêm das colunas
        <b>1 - CONTAINER</b>, <b>1 - ARMADOR</b> e <b>1 - TIPO</b>; se <b>2 - CONTAINER</b>, <b>2 - ARMADOR</b> ou <b>2 - TIPO</b> estiver preenchido,
        são criadas 2 linhas. Os demais clientes usam CONTAINER, ARMADOR e TIPO.</p>
        <label class="field"><span>Um cliente por linha (vale também o começo do nome, ex.: GLOVIS)</span>
        <textarea class="input" id="ps-regra" rows="8" style="width:100%;min-height:150px;resize:vertical">${App.esc(cur.join('\n'))}</textarea></label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (dd) => {
        const list = dd.querySelector('#ps-regra').value.split('\n').map((x) => x.trim()).filter(Boolean)
          .filter((x, i, a) => a.findIndex((y) => norm(y) === norm(x)) === i);
        App.change('Regra do PRÉ STACKING VAZIO', () => { if (list.length) ps.psClientes = list; else delete ps.psClientes; });
        App.emit('notify', list.length ? `Regra salva: ${list.length} ${list.length === 1 ? 'cliente' : 'clientes'}.` : 'Regra vazia: todos os clientes usam CONTAINER, ARMADOR e TIPO.');
      } }],
    });
    setTimeout(() => { const t = document.getElementById('ps-regra'); if (t) t.addEventListener('keydown', (ev) => ev.stopPropagation()); }, 0);
  });

  App.preStackingHook = (fwd, inv) => { try { return hook(fwd, inv); } catch (e) { console.error(e); App.emit('notify', 'PRÉ STACKING: não foi possível concluir a atualização automática.'); return false; } };
  App.preStacking = { isRuleClient, colMap, headerRow, lastInfoRow, findCol, A, linkOf, kindOfMapa, kindOfPS, psSheet, norm, rowConcluida };
})(window.App);
