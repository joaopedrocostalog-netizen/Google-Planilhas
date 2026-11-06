// Rotinas do servidor (Planilhas Costalog):
// - Registro de automações: tudo o que a planilha ou o servidor faz sozinho (PRÉ STACKING, DATA BAIXA, confirmações,
//   avisos no celular, status automático), com quem e quando. Fica em settings › auto_log (até 3000 por planilha).
// - Alertas (botão ALERTA): as regras são calculadas na tela de quem está com a planilha aberta; cada alerta novo é
//   enviado ao servidor, que avisa no celular uma vez só (settings › push_alertas guarda o que já foi avisado).
// - Demurrage do vazio: a cada 30 min o servidor confere o PRÉ STACKING VAZIO (DATA BAIXA + DEMMURAGE) e avisa no
//   celular quando vence em 2 dias, hoje ou venceu (uma vez por etapa).
// - Status automático: o administrador agenda (aba, filtro, horários, dias, setor). Na hora, o servidor cria uma
//   pendência e avisa o setor; o e-mail só sai depois que alguém do setor confere e confirma na tela de envio.
'use strict';

const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/\b(DE|DA|DO|DAS|DOS)\b/g, ' ').replace(/[^A-Z0-9]/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// hora de Brasília (sem horário de verão desde 2019)
const agoraBR = () => { const d = new Date(Date.now() - 3 * 3600e3); return { d, hm: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`, dia: d.getUTCDay(), data: d.toISOString().slice(0, 10) }; };
const serialHoje = () => Math.floor((Date.now() - 3 * 3600e3) / 86400000) + 25569;
function serialDe(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return Math.floor(v);
  const t = String(v === null || v === undefined ? '' : v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return Math.floor(Date.UTC(y, +m[2] - 1, +m[1]) / 86400000) + 25569; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569;
  if (/^\d{5}(\.\d+)?$/.test(t)) return Math.floor(+t);
  return null;
}
const fmtSerial = (s) => { const d = new Date((s - 25569) * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
function addrToStr(r, c) { let s = ''; let n = c; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s + r; }
function parseAddr(a) { const m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { row: +m[2], col: c }; }

// colunas de uma aba pelo cabeçalho (linha com CONTAINER até a 15ª)
function colunas(sh) {
  let hr = 0;
  for (const a in sh.cells) { const p = parseAddr(a); if (p && p.row <= 15 && norm(sh.cells[a].v) === 'CONTAINER' && (!hr || p.row < hr)) hr = p.row; }
  hr = hr || 1;
  const map = new Map();
  for (const a in sh.cells) { const p = parseAddr(a); if (p && p.row === hr) { const k = norm(sh.cells[a].v); if (k && !map.has(k)) map.set(k, p.col); } }
  for (const k in sh.colNames || {}) { const n = norm(sh.colNames[k]); if (n && !map.has(n)) map.set(n, +k); }
  const col = (...nomes) => { for (const n of nomes) { const c = map.get(norm(n)); if (c) return c; } return null; };
  return { hr, map, col };
}
const valor = (sh, r, c) => { if (!c) return ''; const x = sh.cells[addrToStr(r, c)]; return x && x.v !== undefined && x.v !== null ? x.v : ''; };

module.exports = function rotinas(d) {
  const { store, push, Perms, getRoom, permDoc, route, readBody, requireUser, httpError } = d;
  const log = d.log || console;

  // ---------- planilhas ativas (as que já foram abertas): o servidor confere demurrage e status nelas ----------
  let ativas = null;
  async function docsAtivos() { if (!ativas) { try { ativas = new Set((await store.getSetting('docs_ativos')) || []); } catch (e) { ativas = new Set(); } } return ativas; }
  async function marcaAtivo(id) { const s = await docsAtivos(); if (!s.has(id)) { s.add(id); await store.setSetting('docs_ativos', [...s].slice(-50)).catch(() => {}); } }

  // ---------- registro de automações ----------
  async function autoLog(docId, itens, by) {
    if (!itens.length) return;
    const all = (await store.getSetting('auto_log').catch(() => null)) || {};
    const lista = all[docId] || [];
    const at = new Date().toISOString();
    for (const it of itens) lista.push({ at, tipo: String(it.tipo || 'Automação').slice(0, 60), desc: String(it.desc || '').slice(0, 400), aba: String(it.aba || '').slice(0, 80), por: by ? String(by.name || '').slice(0, 80) : 'Servidor', origem: by ? 'planilha' : 'servidor' });
    all[docId] = lista.slice(-3000);
    await store.setSetting('auto_log', all);
  }
  async function salaDe(req, id, precisaAdmin) {
    const user = await requireUser(req);
    const room = await getRoom(id);
    if (!room) throw httpError(404, 'Planilha não encontrada.');
    const perms = Perms.compute(permDoc(room), user);
    if (!perms) throw httpError(403, 'Você não tem acesso a esta planilha.');
    if (precisaAdmin && !perms.admin) throw httpError(403, 'Somente administradores.');
    marcaAtivo(room.id).catch(() => {});
    return { user, room, perms };
  }
  route('POST', '/api/docs/:id/automacoes', async (req, p) => {
    const { user, room } = await salaDe(req, p.id);
    const b = await readBody(req, 60000);
    const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 50);
    await autoLog(room.id, itens, user);
    return { ok: true };
  });
  route('GET', '/api/docs/:id/automacoes', async (req, p) => {
    const { room } = await salaDe(req, p.id, true);
    const all = (await store.getSetting('auto_log').catch(() => null)) || {};
    return (all[room.id] || []).slice().reverse();
  });

  // quem recebe um aviso desta planilha: inscritos com acesso (membro/dono), que veem a aba e estão na lista "who"
  async function destinatarios(room, sheetId, who) {
    const out = [];
    for (const uidX of await push.inscritos()) {
      const u = await store.getUserById(uidX);
      if (!u) continue;
      const pm = Perms.compute(permDoc(room), u);
      if (!pm || pm.viaLink) continue;
      if (sheetId && !Perms.sheetVisible(pm, sheetId)) continue;
      if (who && who.length && !pm.admin && !Perms.inList(who, pm)) continue;
      out.push(uidX);
    }
    return out;
  }

  // ---------- alertas novos (vindos da tela de quem está com a planilha aberta) ----------
  route('POST', '/api/docs/:id/alertas/novos', async (req, p) => {
    const { room } = await salaDe(req, p.id);
    const b = await readBody(req, 120000);
    const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 200).filter((x) => x && x.k);
    const todos = (await store.getSetting('push_alertas').catch(() => null)) || {};
    const primeira = !todos[room.id];
    const vistos = todos[room.id] || {};
    const limite = Date.now() - 36 * 3600e3;
    for (const k in vistos) if (vistos[k] < limite) delete vistos[k];
    const novos = itens.filter((x) => !vistos[String(x.k).slice(0, 300)]);
    for (const x of novos) vistos[String(x.k).slice(0, 300)] = Date.now();
    todos[room.id] = vistos;
    await store.setSetting('push_alertas', todos);
    // primeira vez desta planilha: só guarda o que já existia (não manda uma enxurrada de avisos antigos)
    if (primeira || !novos.length) return { novos: 0, base: primeira };
    for (const x of novos) {
      const sh = room.data.sheets.find((s) => s.id === x.sheetId);
      const regra = sh && (sh.alertRules || []).find((r) => r.id === x.regra);
      for (const u of await destinatarios(room, x.sheetId, regra ? regra.who : null)) {
        push.avisa(u, 'alerta', { title: 'ALERTA: ' + String(x.title || 'alerta').slice(0, 80), plural: '{n} alertas novos', body: String(x.body || '').slice(0, 160), tag: 'alerta-' + room.id, doc: room.id, hash: '#nuvem=' + room.id });
      }
    }
    autoLog(room.id, [{ tipo: 'Aviso no celular', desc: `${novos.length} ${novos.length === 1 ? 'alerta novo avisado' : 'alertas novos avisados'}: ${novos.slice(0, 3).map((x) => x.title).join(', ')}` }]).catch(() => {});
    return { novos: novos.length };
  });

  // ---------- demurrage do vazio (servidor, a cada 30 min) ----------
  async function confereDemurrage() {
    const enviados = (await store.getSetting('push_dem').catch(() => null)) || {};
    const hoje = serialHoje();
    let mudou = false;
    for (const docId of await docsAtivos()) {
      const room = await getRoom(docId).catch(() => null);
      if (!room) continue;
      for (const sh of room.data.sheets || []) {
        const n = norm(sh.name);
        if (!(n.includes('STACKING') && n.includes('VAZIO'))) continue;
        const C = colunas(sh);
        const cc = C.col('CONTAINER'), cb = C.col('DATA BAIXA'), cd = C.col('DEMMURAGE', 'DEMURRAGE', 'DEMURRAGEM', 'DEM'), cdt = C.col('DATA'), cs = C.col('STATUS'), ccl = C.col('CLIENTE');
        if (!cc || !cb || !cd) continue;
        const linhas = new Set();
        for (const a in sh.cells) { const p = parseAddr(a); if (p && p.col === cc && p.row > C.hr && String(sh.cells[a].v || '').trim()) linhas.add(p.row); }
        const avisos = [];
        for (const r of linhas) {
          if (norm(valor(sh, r, cs)).includes('FINALIZ') || String(valor(sh, r, cdt)).trim()) continue;
          const baixa = serialDe(valor(sh, r, cb)), dem = Number(String(valor(sh, r, cd)).replace(',', '.'));
          if (baixa === null || !(dem > 0)) continue;
          const prazo = baixa + dem, falta = prazo - hoje;
          const etapa = falta < 0 ? 'vencida' : falta === 0 ? 'hoje' : falta <= 2 ? '2dias' : null;
          if (!etapa) continue;
          const cont = String(valor(sh, r, cc)).trim();
          const k = `${docId}|${norm(cont)}|${prazo}|${etapa}`;
          if (enviados[k]) continue;
          enviados[k] = Date.now(); mudou = true;
          avisos.push({ cont, cli: String(valor(sh, r, ccl)).trim(), etapa, falta, prazo });
        }
        if (!avisos.length) continue;
        const us = await destinatarios(room, sh.id, null);
        for (const a of avisos) {
          const txt = a.etapa === 'vencida' ? `vencida há ${-a.falta} ${a.falta === -1 ? 'dia' : 'dias'}` : a.etapa === 'hoje' ? 'vence hoje' : `vence em ${a.falta} ${a.falta === 1 ? 'dia' : 'dias'}`;
          for (const u of us) push.avisa(u, 'demurrage', { title: 'Demurrage do vazio', plural: '{n} demurrages do vazio', body: `${a.cont}${a.cli ? ' (' + a.cli + ')' : ''}: ${txt} · prazo ${fmtSerial(a.prazo)}`, tag: 'dem-' + room.id, doc: room.id, hash: '#nuvem=' + room.id });
        }
        autoLog(room.id, [{ tipo: 'Demurrage', aba: sh.name, desc: `Aviso no celular: ${avisos.map((a) => a.cont).slice(0, 6).join(', ')}${avisos.length > 6 ? '…' : ''} (${avisos.length})` }]).catch(() => {});
      }
    }
    if (mudou) {
      const lim = Date.now() - 20 * 86400e3;
      for (const k in enviados) if (enviados[k] < lim) delete enviados[k];
      await store.setSetting('push_dem', enviados).catch(() => {});
    }
  }

  // ---------- status automático ----------
  const limpaAg = (a) => ({
    id: String(a.id || uid()).slice(0, 40), nome: String(a.nome || 'Status').slice(0, 80), ativo: a.ativo !== false,
    sheetId: String(a.sheetId || ''), filtroCol: String(a.filtroCol || 'CLIENTE').slice(0, 60),
    valores: (Array.isArray(a.valores) ? a.valores : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 100),
    ignorar: (Array.isArray(a.ignorar) ? a.ignorar : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
    horarios: (Array.isArray(a.horarios) ? a.horarios : []).filter((h) => /^\d{2}:\d{2}$/.test(h)).slice(0, 8),
    dias: (Array.isArray(a.dias) ? a.dias : [1, 2, 3, 4, 5]).map(Number).filter((x) => x >= 0 && x <= 6),
    who: (Array.isArray(a.who) ? a.who : []).map(String).slice(0, 50), obs: String(a.obs || '').slice(0, 300),
  });
  route('GET', '/api/docs/:id/status-auto', async (req, p) => {
    const { room } = await salaDe(req, p.id, true);
    return ((await store.getSetting('status_auto').catch(() => null)) || {})[room.id] || [];
  });
  route('PUT', '/api/docs/:id/status-auto', async (req, p) => {
    const { room, user } = await salaDe(req, p.id, true);
    const b = await readBody(req, 100000);
    const all = (await store.getSetting('status_auto').catch(() => null)) || {};
    all[room.id] = (Array.isArray(b.agendamentos) ? b.agendamentos : []).slice(0, 50).map(limpaAg);
    await store.setSetting('status_auto', all);
    autoLog(room.id, [{ tipo: 'Status automático', desc: `Agendamentos salvos (${all[room.id].length})` }], user).catch(() => {});
    return all[room.id];
  });
  const visivel = (pm, x) => pm.admin || !x.who || !x.who.length || Perms.inList(x.who, pm);
  route('GET', '/api/docs/:id/status-auto/pendentes', async (req, p) => {
    const { room, perms } = await salaDe(req, p.id);
    const all = (await store.getSetting('status_pend').catch(() => null)) || {};
    return (all[room.id] || []).filter((x) => !x.feito && visivel(perms, x) && Perms.sheetVisible(perms, x.sheetId));
  });
  route('POST', '/api/docs/:id/status-auto/pendentes/:pid/feito', async (req, p) => {
    const { room, perms, user } = await salaDe(req, p.id);
    const all = (await store.getSetting('status_pend').catch(() => null)) || {};
    const x = (all[room.id] || []).find((y) => y.id === p.pid);
    if (!x || !visivel(perms, x)) throw httpError(404, 'Pendência não encontrada.');
    x.feito = { at: new Date().toISOString(), por: user.name };
    await store.setSetting('status_pend', all);
    autoLog(room.id, [{ tipo: 'Status automático', desc: `"${x.nome}" conferido por ${user.name}` }], user).catch(() => {});
    return { ok: true };
  });
  async function confereStatus() {
    const cfg = (await store.getSetting('status_auto').catch(() => null)) || {};
    const agora = agoraBR();
    const [hh, mm] = agora.hm.split(':').map(Number), minAgora = hh * 60 + mm;
    let fired = (await store.getSetting('status_fired').catch(() => null)) || {};
    let pend = null, mudou = false;
    for (const docId in cfg) {
      for (const ag of cfg[docId] || []) {
        if (!ag.ativo || !ag.dias.includes(agora.dia)) continue;
        for (const h of ag.horarios) {
          const [a, b] = h.split(':').map(Number), m = a * 60 + b;
          // na hora ou até 30 min depois (se o servidor estava dormindo), uma vez por dia e horário
          if (minAgora < m || minAgora - m > 30) continue;
          const k = `${docId}|${ag.id}|${agora.data}|${h}`;
          if (fired[k]) continue;
          fired[k] = Date.now(); mudou = true;
          const room = await getRoom(docId).catch(() => null);
          if (!room) continue;
          pend = pend || (await store.getSetting('status_pend').catch(() => null)) || {};
          const lista = pend[docId] || [];
          // a do mesmo agendamento ainda não conferida é substituída pela nova
          for (const y of lista) if (y.agId === ag.id && !y.feito) y.feito = { at: new Date().toISOString(), por: 'substituída' };
          const x = { id: uid(), agId: ag.id, nome: ag.nome, sheetId: ag.sheetId, filtroCol: ag.filtroCol, valores: ag.valores, ignorar: ag.ignorar, who: ag.who, obs: ag.obs, at: new Date().toISOString(), horario: h, feito: null };
          lista.push(x);
          pend[docId] = lista.slice(-200);
          for (const u of await destinatarios(room, ag.sheetId, ag.who)) push.avisa(u, 'status', { title: 'Status automático para conferir', plural: '{n} status automáticos para conferir', body: `${ag.nome} (${h}) — toque para conferir e enviar`, tag: 'status-' + room.id, doc: room.id, hash: '#nuvem=' + room.id });
          autoLog(docId, [{ tipo: 'Status automático', desc: `"${ag.nome}" das ${h} pronto para conferir (aviso ao setor)` }]).catch(() => {});
        }
      }
    }
    if (pend) await store.setSetting('status_pend', pend).catch(() => {});
    if (mudou) {
      const lim = Date.now() - 3 * 86400e3;
      for (const k in fired) if (fired[k] < lim) delete fired[k];
      await store.setSetting('status_fired', fired).catch(() => {});
    }
  }

  // ---------- histórico do container ----------
  // linhas atuais do container (enviadas pela tela) + mudanças em que o número aparece (mesmo que tenha mudado de linha)
  route('POST', '/api/docs/:id/historico-container', async (req, p) => {
    const { room, perms } = await salaDe(req, p.id);
    const b = await readBody(req, 20000);
    const cont = norm(b.container);
    if (cont.length < 6) throw httpError(400, 'Informe o número do container.');
    const out = [], vistos = new Set();
    const junta = (rows) => { for (const h of rows) { const k = h.sheet_id + h.addr + h.at + h.after; if (vistos.has(k) || !Perms.canSee(perms, h.sheet_id, h.addr)) continue; vistos.add(k); out.push({ s: h.sheet_id, a: h.addr, at: h.at, uid: h.user_id || null, name: h.user_name || 'Alguém', before: h.before, after: h.after }); } };
    for (const ped of (Array.isArray(b.linhas) ? b.linhas : []).slice(0, 10)) {
      const sh = room.data.sheets.find((s) => s.id === ped.sheetId);
      if (!sh || !Perms.sheetVisible(perms, sh.id)) continue;
      let maxC = 1;
      for (const a in sh.cells) { const q = parseAddr(a); if (q && q.col > maxC) maxC = q.col; }
      const addrs = [];
      for (const r of (Array.isArray(ped.rows) ? ped.rows : []).slice(0, 4)) for (let c = 1; c <= Math.min(maxC, 120); c++) addrs.push(addrToStr(Number(r), c));
      if (addrs.length) junta(await store.getHistoryCells(room.id, sh.id, addrs, 3000));
    }
    junta(await store.getHistoryByText(room.id, cont, 500));
    out.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return out.slice(0, 3000);
  });

  if (process.env.ROTINAS_TESTE === '1') route('POST', '/api/_rotinas', async (req) => { await requireUser(req); await confereDemurrage(); await confereStatus(); return { ok: true }; });
  // relógios (o Render gratuito dorme sem acesso: o monitor do GitHub mantém acordado)
  if (!process.env.ROTINAS_OFF) {
    setInterval(() => { confereStatus().catch((e) => log.error('[status auto]', e.message)); }, 60e3).unref();
    setInterval(() => { confereDemurrage().catch((e) => log.error('[demurrage]', e.message)); }, 30 * 60e3).unref();
    setTimeout(() => { confereDemurrage().catch(() => {}); confereStatus().catch(() => {}); }, 20e3).unref();
  }
  return { autoLog, marcaAtivo, confereDemurrage, confereStatus, _serialDe: serialDe };
};
