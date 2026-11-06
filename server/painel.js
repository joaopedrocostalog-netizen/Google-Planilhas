// Painel do administrador (Administrador › Métricas da planilha):
// - linha do tempo do dia: pessoas conectadas, sessões (entrada e saída de cada pessoa) e edições por hora;
// - edições por dia (últimos 7 dias) e linhas com informação em cada página;
// - teste de carga: uma CÓPIA da planilha só na memória (sala "teste~…"), onde o navegador do administrador abre
//   várias conexões que editam ao mesmo tempo. Nada da sala de teste vai para o banco, para o histórico nem para as
//   métricas, e ela some sozinha ao terminar.
'use strict';

module.exports = function painel(ctx) {
  const { store, rooms, route, requireUser, getRoom, httpError, readBody, Perms, permDoc, uid } = ctx;
  // formatadores criados uma vez só: criar um a cada edição custava ~0,5 ms por edição
  const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
  const FMT_HORA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  const hojeBR = () => FMT_DIA.format(new Date());
  const horaBR = (t) => Number(FMT_HORA.format(new Date(t || Date.now()))) % 24;
  const ehTeste = (room) => !!(room && room.temp);

  // ---------- Linha do tempo do dia (settings › painel_dia:<id>) ----------
  const dias = new Map();
  async function dia(id) {
    const hoje = hojeBR();
    let d = dias.get(id);
    if (!d) {
      try { d = await store.getSetting('painel_dia:' + id); } catch (e) { d = null; }
      if (d) dias.set(id, d);
    }
    if (!d || d.dia !== hoje) { d = { dia: hoje, desde: Date.now(), amostras: [], sessoes: [], edHora: new Array(24).fill(0) }; dias.set(id, d); }
    return d;
  }
  const timers = new Map();
  function salvar(id) {
    if (timers.has(id)) return;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const d = dias.get(id);
      if (d) store.setSetting('painel_dia:' + id, d).catch((e) => console.error('[painel] não consegui guardar:', e.message));
    }, 5000));
  }
  const pessoas = (room, soNaoAdmin) => { const s = new Set(); for (const c of room.clients) if (c.user && (!soNaoAdmin || !(c.perms && c.perms.admin))) s.add(c.user.id); return s; };
  async function amostrar(room, forcar) {
    const d = await dia(room.id);
    const a = { t: Date.now(), p: pessoas(room).size, n: pessoas(room, true).size, a: room.clients.size };
    const u = d.amostras[d.amostras.length - 1];
    // guarda só quando muda (ou a cada 5 min, para o gráfico não ficar com buracos)
    if (!forcar && u && u.p === a.p && u.n === a.n && u.a === a.a && a.t - u.t < 5 * 60e3) return;
    d.amostras.push(a);
    if (d.amostras.length > 800) d.amostras.splice(0, d.amostras.length - 800);
    salvar(room.id);
  }
  async function entrou(room, c) {
    if (ehTeste(room)) return;
    const d = await dia(room.id);
    const abas = [...room.clients].filter((x) => x.user && x.user.id === c.user.id).length;
    if (abas === 1 && !d.sessoes.some((s) => s.uid === c.user.id && !s.fim)) {
      d.sessoes.push({ uid: c.user.id, name: c.user.name, admin: !!(c.perms && c.perms.admin), ini: Date.now(), fim: null });
      if (d.sessoes.length > 600) d.sessoes.splice(0, d.sessoes.length - 600);
    }
    await amostrar(room);
  }
  async function saiu(room, c) {
    if (ehTeste(room) || !c.user) return;
    const d = await dia(room.id);
    const restam = [...room.clients].some((x) => x.user && x.user.id === c.user.id);
    if (!restam) { const s = d.sessoes.slice().reverse().find((x) => x.uid === c.user.id && !x.fim); if (s) s.fim = Date.now(); }
    await amostrar(room);
  }
  async function editou(room, n) {
    if (ehTeste(room)) { if (room.teste) room.teste.patches++; return; }
    if (!n) return;
    const d = await dia(room.id);
    d.edHora[horaBR()] += n;
    salvar(room.id);
  }
  // a cada 5 min registra quem está conectado (mesmo sem ninguém entrar ou sair)
  setInterval(() => { for (const r of rooms.values()) if (!ehTeste(r) && r.clients.size) amostrar(r, true).catch(() => {}); }, 5 * 60e3).unref();

  // linhas que têm pelo menos uma célula preenchida, por página
  function linhasComInfo(sheet) {
    const rows = new Set();
    for (const a in sheet.cells || {}) {
      const v = sheet.cells[a] && sheet.cells[a].v;
      if (v === undefined || v === null || v === '') continue;
      const m = /\d+$/.exec(a);
      if (m) rows.add(Number(m[0]));
    }
    return rows.size;
  }

  // edições por dia (últimos 7), com cache de 5 min para não pesar no banco gratuito
  const cacheDias = new Map();
  async function edicoesPorDia(id) {
    const c = cacheDias.get(id);
    if (c && Date.now() - c.t < 5 * 60e3) return c.v;
    const inicio = (k) => { const d = FMT_DIA.format(new Date(Date.now() - k * 86400e3)); return { d, iso: new Date(d + 'T00:00:00-03:00').toISOString() }; };
    const out = [];
    for (let k = 0; k <= 6; k++) {
      const { d, iso } = inicio(k);
      const s = await store.historyStats(id, iso);
      out.push({ dia: d, desde: s.edicoes, pessoas: s.pessoas });
    }
    // historyStats conta "desde"; o dia k é a diferença entre desde(k) e desde(k-1)
    const v = out.map((x, k) => ({ dia: x.dia, edicoes: x.desde - (k ? out[k - 1].desde : 0) })).reverse();
    cacheDias.set(id, { t: Date.now(), v });
    return v;
  }

  async function adminRoom(req, id) {
    const user = await requireUser(req);
    const room = await getRoom(id);
    if (!room || ehTeste(room)) throw httpError(404, 'Planilha não encontrada.');
    const perms = Perms.compute(permDoc(room), user);
    if (!perms || !perms.admin) throw httpError(403, 'Somente administradores veem o painel e fazem o teste de carga.');
    return { user, room };
  }

  route('GET', '/api/docs/:id/painel', async (req, p) => {
    const { room } = await adminRoom(req, p.id);
    const d = await dia(room.id);
    const agora = Date.now();
    let porDia = [], erro = null;
    try { porDia = await edicoesPorDia(room.id); } catch (e) { erro = 'Não consegui contar as edições por dia agora.'; }
    return {
      dia: d.dia, desde: d.desde, agora,
      amostras: d.amostras.concat([{ t: agora, p: pessoas(room).size, n: pessoas(room, true).size, a: room.clients.size }]),
      sessoes: d.sessoes, edHora: d.edHora, porDia, erro,
      linhas: room.data.sheets.map((s) => ({ name: s.name, hidden: !!s.hidden, linhas: linhasComInfo(s) })),
    };
  });

  // ---------- Teste de carga ----------
  // Uma sala de teste por vez no servidor. Limites: até 60 pessoas simuladas, até 120 s, até 60 edições/min por pessoa.
  let teste = null;
  let lag = 0, ultimoTick = Date.now(), cpuAnt = process.cpuUsage(), tAnt = Date.now(), cpuPct = 0;
  setInterval(() => {
    const t = Date.now();
    lag = Math.max(0, t - ultimoTick - 500); ultimoTick = t;
    const cu = process.cpuUsage(cpuAnt), dt = (t - tAnt) * 1000;
    cpuPct = dt ? Math.round(((cu.user + cu.system) / dt) * 100) : 0;
    cpuAnt = process.cpuUsage(); tAnt = t;
  }, 500).unref();
  function encerrar(motivo) {
    if (!teste) return null;
    const t = teste;
    teste = null;
    clearTimeout(t.timer);
    const room = rooms.get(t.sala) || t.room;
    if (room) {
      for (const c of [...room.clients]) { try { c.ws.send({ type: 'error', code: 'teste', message: 'Teste de carga encerrado.' }); c.ws.close(4000, 'fim do teste'); } catch (e) { /* já fechou */ } }
      rooms.delete(t.sala);
    }
    console.log(`[teste] sala ${t.sala} encerrada (${motivo}); ${t.room.teste.patches} edições processadas`);
    return t;
  }
  route('POST', '/api/docs/:id/teste-carga', async (req, p) => {
    const { user, room } = await adminRoom(req, p.id);
    const b = await readBody(req, 10000);
    if (teste && rooms.has(teste.sala)) throw httpError(409, `Já há um teste de carga rodando (iniciado por ${teste.por}). Aguarde terminar.`);
    const n = Math.min(60, Math.max(1, Math.floor(Number(b.pessoas) || 30)));
    const seg = Math.min(120, Math.max(10, Math.floor(Number(b.segundos) || 30)));
    const ritmo = Math.min(60, Math.max(1, Math.floor(Number(b.ritmo) || 20)));
    const sala = 'teste~' + uid(8);
    const data = JSON.parse(JSON.stringify(room.data)); // cópia: a planilha real não é tocada
    const tmp = { id: sala, temp: true, ownerId: room.ownerId, acl: JSON.parse(JSON.stringify(room.acl)), data, version: 0, clients: new Set(), dirty: false, timer: null, teste: { patches: 0 } };
    rooms.set(sala, tmp);
    teste = { sala, room: tmp, doc: room.id, por: user.name, inicio: Date.now(), n, seg, ritmo, timer: setTimeout(() => encerrar('tempo esgotado'), (seg + 45) * 1000) };
    const vis = data.sheets.find((s) => !s.hidden) || data.sheets[0];
    console.log(`[teste] ${user.email} iniciou teste de carga: ${n} pessoas, ${seg} s, ${ritmo} edições/min (sala ${sala})`);
    return { sala, pessoas: n, segundos: seg, ritmo, pagina: vis ? vis.id : null, linhas: Math.max(2, Math.min(200, (vis && vis.rows) || 100)), colunas: Math.max(1, Math.min(12, (vis && vis.cols) || 10)) };
  });
  route('GET', '/api/docs/:id/teste-carga', async (req, p) => {
    await adminRoom(req, p.id);
    const room = teste && rooms.get(teste.sala);
    const mem = process.memoryUsage();
    return { ativo: !!room, conexoes: room ? room.clients.size : 0, patches: room ? room.teste.patches : 0, lagMs: lag, cpu: cpuPct, memoriaMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576), t: Date.now() };
  });
  route('DELETE', '/api/docs/:id/teste-carga', async (req, p) => {
    await adminRoom(req, p.id);
    const t = encerrar('encerrado pelo administrador');
    return { ok: true, encerrado: !!t };
  });

  return { ehTeste, entrou, saiu, editou };
};
