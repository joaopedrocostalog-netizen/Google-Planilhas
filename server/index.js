// Servidor do Planilhas: site, contas, planilhas na nuvem, compartilhamento por setores e edição em tempo real.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { accept, prepare, join } = require('./ws.js');
const createStore = require('./store');
const Patch = require('../src/patch.js');
const Perms = require('../src/perms.js');
const mail = require('./mail.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://joaopedrocostalog-netizen.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const store = createStore();
const push = require('./push.js').createPush(store, { juntar: Number(process.env.PUSH_JUNTAR_MS) || 20000 });
// administradores gerais: podem criar e salvar planilhas na nuvem (além de quem já é dono ou administrador de alguma)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'joao.pedro@costalog.com.br').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ---------- Utilidades ----------
const uid = (n) => crypto.randomBytes(n || 12).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function hashPass(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(p, salt, 32).toString('hex');
}
function checkPass(p, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(String(p), salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// ---------- Cores: cada pessoa tem uma cor só dela (cursor, avatar, histórico e mensagens) ----------
const COLORS = ['#1a73e8', '#188038', '#9334e6', '#e37400', '#d01884', '#00897b', '#5e35b1', '#c62828', '#0277bd', '#7cb342',
  '#f4511e', '#8e24aa', '#3949ab', '#00acc1', '#6d4c41', '#afb42b', '#ad1457', '#2e7d32', '#ef6c00', '#546e7a', '#039be5', '#6a1b9a', '#00695c', '#bf360c'];
const userColors = new Map();
const HEX = /^#[0-9a-f]{6}$/;
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const f = (n) => { const k = (n + h / 30) % 12; const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
function nextColor() {
  const used = new Set(userColors.values());
  for (const c of COLORS) if (!used.has(c)) return c;
  for (let i = 0; ; i++) { const c = hsl((i * 137.508 + 23) % 360, 60 + (i % 3) * 10, 36 + (i % 4) * 5); if (!used.has(c)) return c; }
}
const colorTaken = (color, exceptId) => [...userColors].some(([id, c]) => c === color && id !== exceptId);
async function loadColors() {
  const rows = await store.userColors();
  const fix = [];
  for (const r of rows) {
    const c = String(r.color || '').toLowerCase();
    if (HEX.test(c) && !colorTaken(c)) userColors.set(r.id, c); else fix.push(r.id);
    if (r.avatar_v) avatarVer.set(r.id, String(r.avatar_v));
  }
  for (const id of fix) { const c = nextColor(); userColors.set(id, c); await store.setUserColor(id, c); }
}
async function giveColor(id) { if (userColors.has(id)) return; const c = nextColor(); userColors.set(id, c); await store.setUserColor(id, c); }
const colorFor = (id) => userColors.get(id) || COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
// foto do perfil: o endereço leva a versão, para o navegador guardar a imagem e atualizar quando mudar
const avatarVer = new Map();
const avatarOf = (id) => avatarVer.get(id) || null;
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, color: colorFor(u.id), avatar: avatarOf(u.id) });
async function isGlobalAdmin(u) {
  if (ADMIN_EMAILS.includes(String(u.email).toLowerCase())) return true;
  const rows = await store.listDocsFor(u);
  return rows.some((r) => r.owner_id === u.id || ((r.acl && r.acl.members) || []).some((m) => m.email === u.email && m.role === 'admin'));
}
const meUser = async (u) => Object.assign(publicUser(u), { admin: await isGlobalAdmin(u), prefs: u.prefs || {} });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  limit = limit || 30 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpError(413, 'Conteúdo grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(httpError(400, 'Dados inválidos.')); }
    });
    req.on('error', reject);
  });
}
function cors(req, res) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || ORIGINS.includes('*') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

// ---------- Sessões ----------
const SESSION_DAYS = 60;
// Guarda as sessões já conferidas por alguns minutos: menos consultas ao banco e, se o banco cair por um tempo,
// quem já estava conectado continua trabalhando (as alterações ficam no servidor e são salvas quando ele voltar).
const sessionCache = new Map();
const SESSION_FRESH = 10 * 60e3, SESSION_GRACE = 12 * 3600e3;
async function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const key = sha(token);
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_FRESH) return hit.user;
  try {
    const s = await store.getSession(key);
    if (!s) { sessionCache.delete(key); return null; }
    if (Date.now() - s.created_at > SESSION_DAYS * 864e5) { sessionCache.delete(key); await store.deleteSession(key); return null; }
    const user = await store.getUserById(s.user_id);
    if (user) sessionCache.set(key, { user, at: Date.now() }); else sessionCache.delete(key);
    if (sessionCache.size > 5000) sessionCache.delete(sessionCache.keys().next().value);
    return user;
  } catch (e) {
    if (hit && isDbError(e) && Date.now() - hit.at < SESSION_GRACE) return hit.user;
    throw e;
  }
}
// Falhas de conexão com o banco (banco reiniciando, fora do ar ou rede instável)
function isDbError(e) {
  const code = String((e && e.code) || ''), msg = String((e && e.message) || '');
  return ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', '57P01', '57P02', '57P03', '53300'].includes(code) || /Connection terminated|timeout exceeded|connect ETIMEDOUT|the database system is (starting|shutting)/i.test(msg);
}
const DB_DOWN_MSG = 'O banco de dados está temporariamente fora do ar. Suas alterações ficam guardadas no servidor e são salvas quando ele voltar. Tente de novo em instantes.';
let lastDbLog = 0;
function logDbError(where, e) {
  if (Date.now() - lastDbLog < 60e3) return;
  lastDbLog = Date.now();
  console.error(`[banco] indisponível (${where}): ${e.code || ''} ${e.message || e}`);
}
const tokenOf = (req) => { const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };
async function requireUser(req) {
  const u = await userFromToken(tokenOf(req));
  if (!u) throw httpError(401, 'Faça login para continuar.');
  return u;
}
async function newSession(user) { const token = uid(32); await store.createSession(sha(token), user.id); return token; }
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  attempts.set(key, list);
  return list.length > 20;
}

// ---------- Salas de edição ----------
const rooms = new Map();
async function getRoom(id) {
  if (rooms.has(id)) return rooms.get(id);
  const row = await store.getDoc(id);
  if (!row) return null;
  if (rooms.has(id)) return rooms.get(id);
  const data = row.data || { sheets: [] };
  data.title = row.title;
  const room = { id, ownerId: row.owner_id, acl: Object.assign(Perms.defaultAcl(), row.acl || {}), data, version: row.version || 0, clients: new Set(), dirty: false, timer: null };
  rooms.set(id, room);
  if (rotinasSrv) rotinasSrv.marcaAtivo(id).catch(() => {});
  return room;
}
let rotinasSrv = null;
const permDoc = (room) => ({ ownerId: room.ownerId, acl: room.acl, data: room.data });
// Gravação no banco: no máximo a cada ~10 s por planilha (planilhas grandes pesam no banco gratuito),
// uma gravação por vez e sempre a versão mais nova. Ao sair o último usuário ou ao desligar, grava na hora.
const SAVE_EVERY = 10000;
function scheduleSave(room) {
  if (room.temp) return; // sala do teste de carga: só na memória
  room.dirty = true;
  if (room.timer || room.saving) return;
  const wait = Math.max(2500, SAVE_EVERY - (Date.now() - (room.lastSave || 0)));
  room.timer = setTimeout(() => { room.timer = null; saveRoom(room); }, wait);
}
async function saveRoom(room) {
  if (room.temp) return;
  if (room.saving) { room.again = true; return room.saving; }
  if (!room.dirty) return;
  clearTimeout(room.timer); room.timer = null;
  room.dirty = false;
  room.saving = (async () => {
    try {
      await store.saveDoc(room.id, { title: String(room.data.title || 'Planilha sem título').slice(0, 200), data: room.data, version: room.version });
      room.lastSave = Date.now();
      await autoVersion(room);
      if (room.failures) { console.log(`[banco] planilha ${room.id} salva de novo após ${room.failures} tentativa(s).`); room.failures = 0; }
    } catch (e) {
      room.dirty = true;
      room.failures = (room.failures || 0) + 1;
      if (isDbError(e)) logDbError('salvar ' + room.id, e); else console.error('Falha ao salvar', room.id, e.message);
      room.timer = setTimeout(() => { room.timer = null; saveRoom(room); }, Math.min(60e3, 5000 * room.failures));
    }
  })();
  await room.saving;
  room.saving = null;
  if (room.again || (room.dirty && !room.timer)) { room.again = false; if (room.dirty && !room.timer) scheduleSave(room); }
}
// ---------- Versões (backups) ----------
// uma versão automática a cada 3 h, e só quando alguém alterou a planilha desde a última (sem alteração a planilha
// nem é salva, então nada é guardado); e sempre antes de restaurar uma versão antiga
const VERSION_EVERY = Number(process.env.VERSION_EVERY_MS || 3 * 60 * 60 * 1000);
async function autoVersion(room, force) {
  try {
    if (room.lastVersionAt === undefined) { const l = await store.listVersions(room.id); room.lastVersionAt = l.length ? new Date(l[0].at).getTime() : 0; }
    if (!force && Date.now() - room.lastVersionAt < VERSION_EVERY) return null;
    room.lastVersionAt = Date.now();
    return await store.addVersion(room.id, Object.assign({ auto: true, data: room.data }, force || {}));
  } catch (e) { console.error('Falha ao guardar versão', room.id, e.message); return null; }
}
// células que mudaram entre duas versões: { idDaPágina: { endereço: valor anterior } } (e páginas novas/excluídas)
function versionDiff(prev, cur) {
  const out = { cells: {}, added: [], removed: [] };
  const val = (x) => (x && x.v !== undefined && x.v !== null ? String(x.v) : '');
  const prevBy = new Map(((prev && prev.sheets) || []).map((s) => [s.id, s]));
  let n = 0;
  for (const s of (cur && cur.sheets) || []) {
    const p = prevBy.get(s.id);
    if (!p) { out.added.push(s.id); continue; }
    const a = s.cells || {}, b = p.cells || {}, ch = {};
    for (const k in a) if (val(a[k]) !== val(b[k])) { ch[k] = val(b[k]); n++; }
    for (const k in b) if (!(k in a) && val(b[k]) !== '') { ch[k] = val(b[k]); n++; }
    if (Object.keys(ch).length) out.cells[s.id] = ch;
    prevBy.delete(s.id);
  }
  out.removed = [...prevBy.values()].map((s) => ({ id: s.id, name: s.name }));
  out.count = n;
  return out;
}
async function versionRoom(req, id) {
  const user = await requireUser(req);
  const room = await getRoom(id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms || !perms.admin) throw httpError(403, 'Somente administradores veem e restauram as versões da planilha.');
  return { user, room };
}
// quem vê quem: administradores veem todos; os demais só veem pessoas do mesmo setor
const seesPeer = (viewer, peer) => !!(viewer.perms && peer.perms) && (viewer.perms.admin || (!peer.perms.admin && viewer.perms.sectorId === peer.perms.sectorId));
const peerInfo = (c) => ({ cid: c.cid, uid: c.user.id, name: c.user.name, email: c.user.email, color: colorFor(c.user.id), avatar: avatarOf(c.user.id), presence: c.presence });

// ---------- Limite de usuários e métricas da planilha ----------
// Limite: quantas pessoas (sem contar administradores) podem estar com a planilha aberta ao mesmo tempo.
// 0 = sem limite. Abas repetidas da mesma pessoa contam uma vez. Quem já está dentro nunca é derrubado:
// ao baixar o limite, só quem chega depois espera vaga. Administradores sempre entram e não ocupam vaga.
const LIMITE_MAX = 1000;
const limites = new Map(); // id da planilha -> limite (cache do banco: settings › limite_usuarios:<id>)
async function limiteDe(id) {
  if (!limites.has(id)) {
    let v = null;
    try { v = await store.getSetting('limite_usuarios:' + id); } catch (e) { /* sem banco: sem limite */ }
    limites.set(id, Math.min(LIMITE_MAX, Math.max(0, Math.floor(Number(v && v.max) || 0))));
  }
  return limites.get(id);
}
// pessoas diferentes conectadas (opcionalmente só quem não é administrador)
function pessoasNaSala(room, soNaoAdmin) {
  const s = new Set();
  for (const c of room.clients) if (c.user && (!soNaoAdmin || !(c.perms && c.perms.admin))) s.add(c.user.id);
  return s;
}
// contadores do dia (horário de Brasília), guardados no banco (settings › metricas_dia:<id>) para não sumir quando o
// servidor gratuito dorme: pico de pessoas ao mesmo tempo, quem entrou hoje e quem esperou vaga.
// formatador criado uma vez só (criar um a cada chamada custa caro e acontecia a cada entrada)
const FMT_DIA_BR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const hojeBR = () => FMT_DIA_BR.format(new Date()); // aaaa-mm-dd
const inicioHojeISO = () => new Date(hojeBR() + 'T00:00:00-03:00').toISOString();
const diasMetricas = new Map();
async function diaDe(id) {
  const hoje = hojeBR();
  let d = diasMetricas.get(id);
  if (!d) {
    try { d = await store.getSetting('metricas_dia:' + id); } catch (e) { d = null; }
    if (d) diasMetricas.set(id, d);
  }
  if (!d || d.dia !== hoje) { d = { dia: hoje, pico: 0, picoEm: null, quem: [], bloqueados: 0, ultimosBloqueados: [] }; diasMetricas.set(id, d); }
  return d;
}
const salvarDiaTimers = new Map();
function salvarDia(id) {
  if (salvarDiaTimers.has(id)) return;
  salvarDiaTimers.set(id, setTimeout(() => {
    salvarDiaTimers.delete(id);
    const d = diasMetricas.get(id);
    if (d) store.setSetting('metricas_dia:' + id, d).catch((e) => console.error('[métricas] não consegui guardar:', e.message));
  }, 3000));
}
async function registrarEntrada(room, user) {
  const d = await diaDe(room.id);
  const n = pessoasNaSala(room).size;
  let mudou = false;
  if (n > d.pico) { d.pico = n; d.picoEm = new Date().toISOString(); mudou = true; }
  if (!d.quem.includes(user.id) && d.quem.length < 5000) { d.quem.push(user.id); mudou = true; }
  if (mudou) salvarDia(room.id);
}
async function registrarBloqueio(room, user) {
  const d = await diaDe(room.id);
  d.bloqueados++;
  d.ultimosBloqueados = [{ name: user.name, email: user.email, at: new Date().toISOString() }, ...d.ultimosBloqueados].slice(0, 10);
  salvarDia(room.id);
}
// Quem tem as mesmas páginas e colunas visíveis recebe exatamente o mesmo conteúdo: a chave junta só o que os
// filtros de permissão leem (admin, páginas e colunas), para o texto ser convertido e compactado uma vez só.
const chavesPerms = new WeakMap();
function chavePerms(perms) {
  let k = chavesPerms.get(perms);
  if (k === undefined) { k = JSON.stringify([!!perms.admin, perms.sheets, perms.cols]); chavesPerms.set(perms, k); }
  return k;
}
// A planilha filtrada, já convertida em texto (e compactada na primeira entrada que pedir), fica guardada enquanto
// ninguém editar: quem entra em seguida (ex.: todos reconectando depois de um deploy) reaproveita.
function docPreparado(room, perms) {
  if (!room.initCache || room.initCache.version !== room.version) room.initCache = { version: room.version, map: new Map() };
  const k = chavePerms(perms);
  let d = room.initCache.map.get(k);
  if (!d) { d = prepare(Perms.filterDoc(room.data, perms)); room.initCache.map.set(k, d); }
  return d;
}
function sendInit(c) {
  const room = c.room;
  const resto = JSON.stringify({
    version: room.version, perms: c.perms,
    me: Object.assign(publicUser(c.user), { cid: c.cid }),
    peers: [...room.clients].filter((x) => x !== c && x.user && seesPeer(c, x)).map(peerInfo),
  });
  // {"type":"init","doc":<planilha guardada>,"version":…} — o mesmo conteúdo de antes, montado em pedaços
  c.ws.sendPrepared(join([prepare('{"type":"init","doc":'), docPreparado(room, c.perms), prepare(',' + resto.slice(1))]));
}
function broadcast(room, except, msg) { const p = prepare(msg); for (const c of room.clients) if (c !== except) c.ws.sendPrepared(p); }
// manda uma alteração a todos (menos "except"), filtrada pelas permissões de cada um: o filtro e a conversão em
// texto acontecem uma vez por grupo de permissões, não uma vez por pessoa
function enviarPatch(room, except, patch, by, pular) {
  const porChave = new Map();
  for (const o of room.clients) {
    if (o === except || (pular && pular.has(o))) continue;
    const k = chavePerms(o.perms);
    let pp = porChave.get(k);
    if (pp === undefined) { const fp = Perms.filterPatch(patch, o.perms, room.data); pp = fp ? prepare({ type: 'patch', patch: fp, version: room.version, by }) : null; porChave.set(k, pp); }
    if (pp) o.ws.sendPrepared(pp);
  }
}

// Recalcula permissões de todos na sala (após mudar compartilhamento ou páginas)
function refreshRoom(room, reinit) {
  for (const c of [...room.clients]) {
    const p = Perms.compute(permDoc(room), c.user);
    if (!p) {
      c.ws.send({ type: 'error', code: 'denied', message: 'Seu acesso a esta planilha foi removido.' });
      c.ws.close(4003, 'sem acesso');
      continue;
    }
    c.perms = p;
    if (reinit) sendInit(c);
  }
}

async function onHello(c, msg) {
  if (c.room) return;
  const user = await userFromToken(msg.token);
  if (!user) { c.ws.send({ type: 'error', code: 'auth', message: 'Faça login para abrir esta planilha.' }); return c.ws.close(4001, 'login'); }
  const room = await getRoom(String(msg.doc || ''));
  if (!room) { c.ws.send({ type: 'error', code: 'notfound', message: 'Planilha não encontrada. Ela pode ter sido excluída.' }); return c.ws.close(4004, 'inexistente'); }
  const perms = Perms.compute(permDoc(room), user);
  if (!perms) { c.ws.send({ type: 'error', code: 'denied', message: 'Você não tem acesso a esta planilha. Peça acesso ao administrador.' }); return c.ws.close(4003, 'sem acesso'); }
  // limite de pessoas ao mesmo tempo (administradores sempre entram; quem já está dentro abre mais abas)
  if (!perms.admin && !room.temp) {
    const max = await limiteDe(room.id);
    const dentro = pessoasNaSala(room, true);
    if (max > 0 && !dentro.has(user.id) && dentro.size >= max) {
      registrarBloqueio(room, user).catch(() => {});
      console.log(`[limite] ${user.email} esperou vaga na planilha ${room.id} (${dentro.size}/${max})`);
      c.ws.send({ type: 'error', code: 'limit', message: `Esta planilha atingiu o limite de ${max} ${max === 1 ? 'pessoa conectada' : 'pessoas conectadas'} ao mesmo tempo. Tente de novo em alguns minutos ou fale com o administrador.` });
      return c.ws.close(4029, 'limite');
    }
  }
  c.user = user; c.room = room; c.perms = perms; c.since = Date.now();
  room.clients.add(c);
  sendInit(c);
  if (!room.temp) registrarEntrada(room, user).catch(() => {});
  painel.entrou(room, c).catch(() => {});
  for (const o of room.clients) if (o !== c && seesPeer(o, c)) o.ws.send({ type: 'join', peer: peerInfo(c) });
}
// Valores alterados (para o histórico de edições). Inserções/exclusões de linhas e colunas não entram.
function historyEntries(room, p) {
  const out = [];
  const val = (x) => (x && x.v !== undefined && x.v !== null && x.v !== '' ? String(x.v).slice(0, 2000) : null);
  for (const id in p.sheets || {}) {
    const e = p.sheets[id];
    if (!e.cells || e.created || e.removed) continue;
    if (e.props && ('rows' in e.props || 'cols' in e.props || 'colMoveSeq' in e.props)) continue;
    const sh = room.data.sheets.find((s) => s.id === id);
    if (!sh) continue;
    for (const a in e.cells) {
      const b = val((sh.cells || {})[a]), f = val(e.cells[a]);
      if (b !== f) out.push({ s: id, a, b, f });
      if (out.length >= 5000) return out;
    }
  }
  return out;
}
function onPatch(c, msg) {
  const room = c.room, p = msg.patch;
  if (!p || typeof p !== 'object' || (p.sheets && typeof p.sheets !== 'object')) return;
  const err = Perms.validate(p, c.perms, room.data);
  if (err) { c.ws.send({ type: 'reject', id: msg.id, reason: err }); sendInit(c); return; }
  const hist = historyEntries(room, p);
  const clears = lookupClears(room, p);
  const avisos = pushEventos(room, p);
  Patch.apply(room.data, p);
  room.version++;
  painel.editou(room, hist.length).catch(() => {});
  if (hist.length && !room.temp) store.addHistory(room.id, Object.assign({}, c.user, { ip: c.ip }), hist).catch((e) => console.error('Falha ao gravar histórico', e.message));
  const structural = !!(p.order || Object.values(p.sheets || {}).some((e) => e.created || e.removed));
  const accessChanged = Object.values(p.sheets || {}).some((e) => (e.props && 'access' in e.props) || (e.created && e.created.access));
  // quem teve as permissões por coluna alteradas recebe a planilha de novo (com as colunas certas)
  const reinit = new Set();
  if (structural || accessChanged) {
    for (const o of [...room.clients]) {
      const np = Perms.compute(permDoc(room), o.user);
      if (!np) continue;
      if (accessChanged && o !== c && JSON.stringify([np.cols, np.sheets]) !== JSON.stringify([o.perms.cols, o.perms.sheets])) reinit.add(o);
      o.perms = np;
    }
  }
  c.ws.send({ type: 'ack', id: msg.id, version: room.version });
  for (const o of reinit) if (o !== c) sendInit(o);
  enviarPatch(room, c, p, { cid: c.cid, name: c.user.name }, reinit);
  if (accessChanged && !c.perms.admin) sendInit(c);
  // completa o CPF/CNPJ do motorista (DSS) e avisa todos, inclusive quem digitou
  const fill = lookupFills(room, p, clears);
  if (fill) {
    Patch.apply(room.data, fill);
    room.version++;
    enviarPatch(room, null, fill, { cid: 'dss', name: 'DSS' });
  }
  scheduleSave(room);
  if (avisos.length) pushAvisa(room, c.user, avisos).catch((e) => console.error('[push]', e.message));
}
// ---------- Notificações no celular: o que muda numa edição ----------
// marca de crítico ligada, pedido de troca ligado, PRÉ STACKING finalizado (psf) — só o que passou de "não" para "sim"
function pushEventos(room, p) {
  const out = [];
  for (const id in p.sheets || {}) {
    const e = p.sheets[id];
    if (!e || !e.cells) continue;
    const sh = room.data.sheets.find((x) => x.id === id);
    if (!sh) continue;
    for (const a in e.cells) {
      const novo = e.cells[a], velho = sh.cells[a];
      if (!novo) continue;
      const lig = (k) => !!novo[k] && !(velho && velho[k]);
      const valor = String((novo.v !== undefined ? novo.v : velho && velho.v) || '').slice(0, 40);
      const linha = (a.match(/\d+/) || [''])[0];
      if (lig('crit')) out.push({ tipo: 'critico', sheetId: id, title: 'Container crítico', plural: '{n} containers críticos', body: `${sh.name} linha ${linha}${valor ? ': ' + valor : ''}` });
      if (lig('swap')) out.push({ tipo: 'troca', sheetId: id, title: 'Pedido de troca de veículo', plural: '{n} pedidos de troca de veículo', body: `${sh.name} linha ${linha}` });
      if (lig('psf')) out.push({ tipo: 'prestacking', sheetId: id, title: 'PRÉ STACKING finalizado', plural: '{n} PRÉ STACKING finalizados', body: `${sh.name} linha ${linha}${valor ? ': ' + valor : ''}` });
    }
  }
  return out.slice(0, 30);
}
// para quem tem notificações ligadas e acesso à página (membro ou dono, não só o link), menos quem fez a mudança
async function pushAvisa(room, autor, avisos) {
  const ids = await push.inscritos();
  for (const uid of ids) {
    if (uid === autor.id) continue;
    const u = await store.getUserById(uid);
    if (!u) continue;
    const pm = Perms.compute(permDoc(room), u);
    if (!pm || pm.viaLink) continue;
    for (const av of avisos) {
      if (!Perms.sheetVisible(pm, av.sheetId)) continue;
      push.avisa(uid, av.tipo, { title: av.title, plural: av.plural, body: av.body + ` (${autor.name || 'alguém'})`, tag: av.tipo + '-' + room.id, doc: room.id, hash: '#nuvem=' + room.id });
    }
  }
}
function onPresence(c, msg) {
  c.presence = { sheetId: String(msg.sheetId || ''), sel: msg.sel || null, editing: !!msg.editing };
  for (const o of c.room.clients) {
    if (o === c || !seesPeer(o, c)) continue;
    if (c.presence.sheetId && !Perms.sheetVisible(o.perms, c.presence.sheetId)) continue;
    o.ws.send({ type: 'presence', peer: peerInfo(c) });
  }
}
function onLeave(c) {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c);
  broadcast(room, c, { type: 'leave', cid: c.cid });
  painel.saiu(room, c).catch(() => {});
  if (!room.clients.size) {
    saveRoom(room).then(() => { if (!room.clients.size && !room.dirty) { clearTimeout(room.timer); rooms.delete(room.id); } });
  }
}
// IP de quem está conectado (atrás do proxy do Render vem em X-Forwarded-For)
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = xf || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip.slice(0, 64);
}
function onConnection(ws, ip) {
  const c = { ws, cid: uid(6), user: null, room: null, perms: null, presence: null, ip: ip || '' };
  const authTimer = setTimeout(() => { if (!c.user) ws.close(4001, 'sem login'); }, 20000);
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    try {
      if (msg.type === 'hello') return await onHello(c, msg);
      if (!c.room) return;
      if (msg.type === 'patch') return onPatch(c, msg);
      if (msg.type === 'presence') return onPresence(c, msg);
      if (msg.type === 'ping') return ws.send({ type: 'pong' });
    } catch (e) {
      if (isDbError(e)) { logDbError('ws ' + msg.type, e); ws.send({ type: 'error', code: 'db', message: DB_DOWN_MSG }); if (msg.type === 'hello' && !c.room) setTimeout(() => ws.close(4503, 'banco'), 100); return; }
      console.error(e);
      ws.send({ type: 'error', code: 'server', message: 'Erro no servidor. Tente recarregar a página.' });
    }
  });
  ws.on('close', () => { clearTimeout(authTimer); onLeave(c); });
}

// ---------- Compartilhamento ----------
const LEVEL = new Set(['none', 'view', 'edit']);
function sanitizeAcl(input, room) {
  const acl = Perms.defaultAcl();
  acl.link = ['none', 'view', 'edit'].includes(input.link) ? input.link : 'none';
  const sheetIds = new Set(room.data.sheets.map((s) => s.id));
  acl.sectors = (Array.isArray(input.sectors) ? input.sectors : []).slice(0, 100).map((s) => {
    const sheets = {};
    for (const k in (s && s.sheets) || {}) if (sheetIds.has(k) && LEVEL.has(s.sheets[k])) sheets[k] = s.sheets[k];
    return { id: (s.id && s.id !== 'link' ? String(s.id) : 's' + uid(5)).slice(0, 40), name: String(s.name || 'Setor').trim().slice(0, 60) || 'Setor', default: LEVEL.has(s.default) ? s.default : 'none', sheets, manage: !!s.manage };
  });
  const sectorIds = new Set(acl.sectors.map((s) => s.id));
  acl.linkSector = sectorIds.has(input.linkSector) ? input.linkSector : null;
  const seen = new Set();
  const rids = new Set();
  acl.members = (Array.isArray(input.members) ? input.members : []).slice(0, 1000).map((m) => {
    const out = {
      email: String(m.email || '').trim().toLowerCase(),
      role: ['admin', 'editor', 'viewer'].includes(m.role) ? m.role : 'editor',
      sector: sectorIds.has(m.sector) ? m.sector : null,
    };
    // id da pessoa para as regras por coluna (sheet.access)
    let rid = /^m[\w-]{3,40}$/.test(m.rid || '') ? m.rid : 'm' + uid(6);
    while (rids.has(rid) || sectorIds.has(rid)) rid = 'm' + uid(6);
    rids.add(rid); out.rid = rid;
    const sheets = {};
    for (const k in (m && m.sheets) || {}) if (sheetIds.has(k) && LEVEL.has(m.sheets[k])) sheets[k] = m.sheets[k];
    if (Object.keys(sheets).length) out.sheets = sheets;
    return out;
  }).filter((m) => emailOk(m.email) && !seen.has(m.email) && seen.add(m.email));
  return acl;
}

// ---------- API ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// ao subir, testa a API carga_of_container uma vez e deixa o resultado no log (ajuda a achar URL ou login errados)
setTimeout(() => { if (!process.env.CARGA_DIAG_OFF) cargaDiag().then((d) => console.log('[carga] diagnóstico:', JSON.stringify(Object.assign({}, d, { inicio: undefined })))).catch(() => {}); }, 4000);
// Administrador › Métricas: gráficos e teste de carga (server/painel.js)
const painel = require('./painel.js')({ store, rooms, route, requireUser, getRoom, httpError, readBody, Perms, permDoc, uid });
route('GET', '/api/health', async () => ({ ok: true, store: store.kind, rooms: rooms.size, dss: !!(process.env.DSS_TOKEN || ((process.env.DSS_USUARIO || process.env.DSS_USERNAME) && (process.env.DSS_SENHA || process.env.DSS_PASSWORD))), dssMotoristas: drivers.items.length, dssErro: drivers.error || null }));
route('POST', '/api/register', async (req) => {
  const b = await readBody(req, 100000);
  const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 80), pass = String(b.password || '');
  if (rateLimited('reg:' + (req.socket.remoteAddress || ''))) throw httpError(429, 'Muitas tentativas. Aguarde um minuto.');
  if (!name) throw httpError(400, 'Informe seu nome.');
  if (!emailOk(email)) throw httpError(400, 'Informe um e-mail válido.');
  if (pass.length < 6) throw httpError(400, 'A senha precisa ter pelo menos 6 caracteres.');
  if (await store.getUserByEmail(email)) throw httpError(409, 'Já existe uma conta com este e-mail. Use "Entrar".');
  const user = { id: uid(9), email, name, pass: hashPass(pass) };
  await store.createUser(user);
  await giveColor(user.id);
  return { token: await newSession(user), user: await meUser(user) };
});
route('POST', '/api/login', async (req) => {
  const b = await readBody(req, 100000);
  const email = String(b.email || '').trim().toLowerCase();
  if (rateLimited('login:' + email) || rateLimited('ip:' + (req.socket.remoteAddress || ''))) throw httpError(429, 'Muitas tentativas. Aguarde um minuto.');
  const user = await store.getUserByEmail(email);
  if (!user || !checkPass(b.password || '', user.pass)) throw httpError(401, 'E-mail ou senha incorretos.');
  return { token: await newSession(user), user: await meUser(user) };
});
route('POST', '/api/logout', async (req) => { const t = tokenOf(req); if (t) { sessionCache.delete(sha(t)); await store.deleteSession(sha(t)); } return { ok: true }; });
route('GET', '/api/me', async (req) => meUser(await requireUser(req)));
route('PUT', '/api/me', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 100000);
  const f = {};
  if (b.name) f.name = String(b.name).trim().slice(0, 80);
  if (b.password) {
    if (!checkPass(b.current || '', user.pass)) throw httpError(400, 'A senha atual está incorreta.');
    if (String(b.password).length < 6) throw httpError(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
    f.pass = hashPass(String(b.password));
  }
  await store.updateUser(user.id, f);
  userCache.delete(user.id);
  return meUser(Object.assign(user, f));
});
// pessoas que criaram conta e ainda não têm acesso a nenhuma planilha (para o administrador liberar)
route('GET', '/api/users/pending', async (req) => {
  const user = await requireUser(req);
  if (!(await isGlobalAdmin(user))) throw httpError(403, 'Somente administradores.');
  const docs = await store.allDocAcls();
  const owners = new Set(docs.map((d) => d.owner_id));
  const emails = new Set();
  for (const d of docs) for (const m of (d.acl && d.acl.members) || []) emails.add(m.email);
  const users = await store.listUsers();
  return users.filter((u) => !owners.has(u.id) && !emails.has(u.email) && !ADMIN_EMAILS.includes(u.email)).map((u) => ({ email: u.email, name: u.name, desde: u.created_at }));
});
// preferências da pessoa (ex.: cores personalizadas da paleta)
route('PUT', '/api/me/prefs', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 100000);
  const prefs = Object.assign({}, user.prefs || {});
  if (Array.isArray(b.colors)) prefs.colors = b.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(-30);
  if (b.views && typeof b.views === 'object' && JSON.stringify(b.views).length < 200000) prefs.views = b.views;
  if (b.fviews && typeof b.fviews === 'object' && JSON.stringify(b.fviews).length < 300000) prefs.fviews = b.fviews;
  if (b.savedViews && typeof b.savedViews === 'object' && JSON.stringify(b.savedViews).length < 300000) prefs.savedViews = b.savedViews;
  await store.savePrefs(user.id, prefs);
  user.prefs = prefs;
  return prefs;
});
// a pessoa pode trocar a própria cor, desde que nenhuma outra pessoa use a mesma
route('GET', '/api/me/color', async (req) => {
  const user = await requireUser(req);
  return { color: colorFor(user.id), palette: COLORS, taken: [...userColors].filter(([id]) => id !== user.id).map(([, c]) => c) };
});
route('PUT', '/api/me/color', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 10000);
  const color = String(b.color || '').toLowerCase();
  if (!HEX.test(color)) throw httpError(400, 'Cor inválida.');
  if (colorTaken(color, user.id)) throw httpError(409, 'Essa cor já é de outra pessoa. Escolha outra.');
  userColors.set(user.id, color);
  await store.setUserColor(user.id, color);
  for (const room of rooms.values()) for (const c of room.clients) {
    if (!c.user || c.user.id !== user.id) continue;
    for (const o of room.clients) if (o !== c && seesPeer(o, c)) o.ws.send({ type: 'presence', peer: peerInfo(c) });
  }
  return { color };
});

// foto do perfil (imagem pequena, já recortada e reduzida no navegador)
route('PUT', '/api/me/avatar', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 400000);
  let data = b.data === null ? null : String(b.data || '');
  if (data !== null && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw httpError(400, 'Imagem inválida. Use uma foto JPG ou PNG.');
  if (data && data.length > 300000) throw httpError(400, 'A foto é grande demais.');
  const v = String(Date.now());
  await store.setAvatar(user.id, data, v);
  if (data) avatarVer.set(user.id, v); else avatarVer.delete(user.id);
  for (const room of rooms.values()) for (const c of room.clients) {
    if (!c.user || c.user.id !== user.id) continue;
    for (const o of room.clients) if (o !== c && seesPeer(o, c)) o.ws.send({ type: 'presence', peer: peerInfo(c) });
  }
  return { avatar: avatarOf(user.id) };
});
route('GET', '/api/avatar/:uid', async (req, p) => {
  const a = await store.getAvatar(p.uid);
  if (!a || !a.avatar) throw httpError(404, 'Sem foto.');
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(a.avatar);
  if (!m) throw httpError(404, 'Sem foto.');
  return { __raw: { type: m[1], body: Buffer.from(m[2], 'base64'), cache: 'public, max-age=31536000, immutable' } };
});

// ---------- Mensagens diretas ----------
// Com quem a pessoa pode conversar nesta planilha: administradores falam com todos; os demais, com o próprio setor e com os administradores
async function contactsFor(user, room) {
  const me = Perms.compute(permDoc(room), user);
  if (!me) throw httpError(403, 'Você não tem acesso a esta planilha.');
  const byEmail = new Map((await store.listUsers()).map((u) => [u.email, u]));
  const cand = new Map();
  const owner = await store.getUserById(room.ownerId);
  if (owner) cand.set(owner.id, owner);
  for (const m of room.acl.members || []) { const u = byEmail.get(m.email); if (u) cand.set(u.id, u); }
  for (const c of room.clients) if (c.user) cand.set(c.user.id, c.user);
  cand.delete(user.id);
  const online = new Set([...room.clients].map((c) => c.user && c.user.id));
  // setores que destravam veículos (escala): qualquer pessoa pode pedir troca a eles pelo chat
  const lockSectors = new Set();
  for (const sh of room.data.sheets || []) for (const id of (sh.escala && sh.escala.lockSectors) || []) lockSectors.add(id);
  const out = [];
  for (const u of cand.values()) {
    const p = Perms.compute(permDoc(room), u);
    if (!p) continue;
    const inLock = (x) => Perms.inList([...lockSectors], x);
    if (!(me.admin || p.admin || (p.sectorId && p.sectorId === me.sectorId) || inLock(p) || inLock(me))) continue;
    out.push({ id: u.id, name: u.name, email: u.email, color: colorFor(u.id), avatar: avatarOf(u.id), admin: !!p.admin, sector: p.sectorName || null, sectorId: p.sectorId || null, keys: (p.ruleKeys || []).filter((k) => k !== 'link'), online: online.has(u.id) });
  }
  return out.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'pt-BR'));
}
const userCache = new Map();
async function userBrief(id) {
  if (!userCache.has(id)) { const u = await store.getUserById(id); userCache.set(id, u ? { id: u.id, name: u.name, email: u.email } : { id, name: 'Pessoa removida', email: '' }); }
  return Object.assign({}, userCache.get(id), { color: colorFor(id), avatar: avatarOf(id) });
}
const pubMsg = (m) => ({ id: m.id, from: m.from_id, to: m.to_id, doc: m.doc_id || null, text: m.text, ref: m.ref || null, at: m.at, read: !!m.read_at });
function deliver(userIds, msg) {
  const ids = new Set(userIds);
  for (const room of rooms.values()) for (const c of room.clients) if (c.user && ids.has(c.user.id)) c.ws.send(msg);
}
route('GET', '/api/docs/:id/contacts', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  return contactsFor(user, room);
});
route('GET', '/api/messages', async (req) => {
  const user = await requireUser(req);
  const list = await store.recentMessages(user.id, 1000);
  const conv = new Map();
  for (const m of list) {
    const other = m.from_id === user.id ? m.to_id : m.from_id;
    if (!conv.has(other)) conv.set(other, { last: m, unread: 0 });
    if (m.to_id === user.id && !m.read_at) conv.get(other).unread++;
  }
  const out = [];
  for (const [id, x] of conv) out.push({ with: await userBrief(id), last: Object.assign(pubMsg(x.last), { mine: x.last.from_id === user.id }), unread: x.unread });
  return { conversations: out, unread: out.reduce((a, x) => a + x.unread, 0) };
});
route('GET', '/api/messages/:uid', async (req, p) => {
  const user = await requireUser(req);
  const list = await store.conversation(user.id, p.uid, 300);
  const other = await store.getUserById(p.uid);
  return { with: Object.assign(await userBrief(p.uid), { admin: !!other && await isGlobalAdmin(other) }), messages: list.map(pubMsg) };
});
route('POST', '/api/messages/:uid/read', async (req, p) => {
  const user = await requireUser(req);
  const n = await store.markRead(user.id, p.uid);
  if (n) deliver([p.uid, user.id], { type: 'dmRead', by: user.id, with: p.uid });
  return { ok: true, n };
});
route('POST', '/api/messages', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 20000);
  const text = String(b.text || '').trim().slice(0, 2000);
  const to = String(b.to || '');
  if (!text) throw httpError(400, 'Escreva a mensagem.');
  if (!to || to === user.id) throw httpError(400, 'Escolha para quem enviar.');
  if (rateLimited('msg:' + user.id)) throw httpError(429, 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  // pode enviar para quem é contato nesta planilha ou para quem já mandou mensagem para a pessoa (responder)
  let ok = await store.hasMessage(to, user.id);
  const room = b.doc ? await getRoom(String(b.doc)) : null;
  if (!ok && room) ok = (await contactsFor(user, room)).some((c) => c.id === to);
  if (!ok) throw httpError(403, 'Você não pode enviar mensagem para esta pessoa.');
  let ref = null;
  if (b.ref && typeof b.ref === 'object') {
    ref = { sheet: String(b.ref.sheet || '').slice(0, 40), addr: String(b.ref.addr || '').slice(0, 30), label: String(b.ref.label || '').slice(0, 120), doc: room ? room.id : null, title: room ? String(room.data.title || '').slice(0, 120) : '' };
    // pedido de troca de veículo: o setor responsável destrava pela própria mensagem
    if (b.ref.act === 'unlock' && Array.isArray(b.ref.rows)) {
      ref.act = 'unlock'; ref.rows = b.ref.rows.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1e6).slice(0, 10);
      if (typeof b.ref.req === 'string' && /^[a-z0-9]{4,40}$/i.test(b.ref.req)) ref.req = b.ref.req;
    }
  }
  const m = await store.addMessage({ from_id: user.id, to_id: to, doc_id: room ? room.id : null, text, ref });
  // mensagem de administrador (geral ou desta planilha): chega destacada e notifica na hora (sem juntar com outras)
  const p = room ? Perms.compute(permDoc(room), user) : null;
  const fromAdmin = !!(p && p.admin) || await isGlobalAdmin(user);
  const out = Object.assign(pubMsg(m), { fromUser: await userBrief(user.id), fromAdmin });
  deliver([to, user.id], { type: 'dm', msg: out });
  if (fromAdmin) push.paraPessoa(to, 'admin', { title: `Administrador: ${user.name || 'mensagem'}`, body: String(text).slice(0, 180), tag: 'adm-' + user.id + '-' + m.id, forte: true, hash: room ? '#nuvem=' + room.id : '' }).catch((e) => console.error('[push]', e.message));
  else push.avisa(to, 'chat', { title: `Mensagem de ${user.name || 'alguém'}`, plural: '{n} mensagens novas', body: String(text).slice(0, 140), tag: 'chat-' + user.id, doc: 'chat-' + user.id, hash: room ? '#nuvem=' + room.id : '' });
  return out;
});

// ---------- Notificações no celular (Web Push) ----------
route('GET', '/api/push/chave', async (req) => { await requireUser(req); return { chave: (await push.chaves()).pub }; });
route('POST', '/api/push/estado', async (req) => { const user = await requireUser(req); const b = await readBody(req, 4000); return push.estado(user.id, String(b.endpoint || '')); });
route('POST', '/api/push/inscrever', async (req) => { const user = await requireUser(req); const b = await readBody(req, 8000); return push.inscreve(user.id, b); });
route('POST', '/api/push/cancelar', async (req) => { const user = await requireUser(req); const b = await readBody(req, 4000); return push.cancela(user.id, String(b.endpoint || '')); });
// teste: uma notificação simples ou um exemplo de cada tipo de aviso (exemplos: true)
const EXEMPLOS_PUSH = [
  ['critico', 'Container crítico', 'Exemplo: MAPA IMPO linha 12: MSCU1234565 (Ana)'],
  ['troca', 'Pedido de troca de veículo', 'Exemplo: MAPA IMPO linha 8 (Bruno)'],
  ['chat', 'Mensagem de Ana', 'Exemplo: O container da linha 12 já saiu do terminal?'],
  ['prestacking', 'PRÉ STACKING finalizado', 'Exemplo: PRÉ STACKING VAZIO linha 5: TGHU3000005 (Carla)'],
  ['alerta', 'ALERTA: Agendamento vencido', 'Exemplo: MAPA EXPO: CSQU3054383 · ACME LTDA'],
  ['demurrage', 'Demurrage do vazio', 'Exemplo: TRHU 861.819-1 (GLOVIS): vence em 2 dias · prazo 08/11/2026'],
  ['status', 'Status automático para conferir', 'Exemplo: Status ACME (08:00) — toque para conferir e enviar'],
];
route('POST', '/api/push/teste', async (req) => {
  const user = await requireUser(req);
  if (rateLimited('push:' + user.id)) throw httpError(429, 'Aguarde um pouco antes de testar de novo.');
  const b = await readBody(req, 2000).catch(() => ({}));
  if (b && b.exemplos) {
    let n = 0;
    for (const [tipo, title, body] of EXEMPLOS_PUSH) n += await push.paraPessoa(user.id, 'teste', { title, body, tag: 'exemplo-' + tipo });
    return { enviadas: n, exemplos: EXEMPLOS_PUSH.length };
  }
  const n = await push.paraPessoa(user.id, 'teste', { title: 'Planilhas Costalog', body: 'As notificações estão funcionando neste aparelho.', tag: 'teste' });
  return { enviadas: n };
});
rotinasSrv = require('./rotinas.js')({ store, push, Perms, getRoom, permDoc, route, readBody, requireUser, httpError });

// ---------- Rotas das versões ----------
route('GET', '/api/docs/:id/versions', async (req, p) => {
  const { room } = await versionRoom(req, p.id);
  let list = await store.listVersions(room.id);
  // primeira vez: guarda a versão atual para já ter algo no histórico
  if (!list.length) { await saveRoom(room); await autoVersion(room, { auto: true }); list = await store.listVersions(room.id); }
  return { versions: list };
});
route('POST', '/api/docs/:id/versions', async (req, p) => {
  const { user, room } = await versionRoom(req, p.id);
  const b = await readBody(req, 4000);
  await saveRoom(room);
  const v = await autoVersion(room, { auto: !b.name, name: String(b.name || '').trim().slice(0, 120), by_name: user.name });
  if (!v) throw httpError(500, 'Não foi possível guardar a versão.');
  return v;
});
route('PUT', '/api/docs/:id/versions/:vid', async (req, p) => {
  const { room } = await versionRoom(req, p.id);
  const b = await readBody(req, 4000);
  await store.renameVersion(room.id, p.vid, String(b.name || '').trim().slice(0, 120));
  return { ok: true };
});
// uma versão com o que mudou nela em relação à versão anterior
route('GET', '/api/docs/:id/versions/:vid', async (req, p) => {
  const { room } = await versionRoom(req, p.id);
  const v = await store.getVersion(room.id, p.vid);
  if (!v) throw httpError(404, 'Versão não encontrada.');
  const list = await store.listVersions(room.id);
  const i = list.findIndex((x) => x.id === v.id);
  const prevMeta = i >= 0 ? list[i + 1] : null;
  const prev = prevMeta ? await store.getVersion(room.id, prevMeta.id) : null;
  return { id: v.id, at: v.at, name: v.name, by_name: v.by_name, auto: v.auto, data: v.data, diff: prev ? versionDiff(prev.data, v.data) : null, prevAt: prev ? prev.at : null };
});
// cria uma planilha nova a partir de uma versão (fica só com quem criou; depois é só compartilhar)
route('POST', '/api/docs/:id/versions/:vid/copy', async (req, p) => {
  const { user, room } = await versionRoom(req, p.id);
  const v = await store.getVersion(room.id, p.vid);
  if (!v) throw httpError(404, 'Versão não encontrada.');
  const when = new Date(v.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const title = `Cópia de ${room.data.title || 'Planilha'} (${v.name || when})`.slice(0, 200);
  const data = Object.assign({}, v.data, { title });
  const id = uid(9);
  await store.createDoc({ id, title, owner_id: user.id, data, acl: Perms.defaultAcl() });
  return { id, title };
});

// pedido de troca atendido: todas as mensagens do pedido passam a mostrar "efetuado"
route('POST', '/api/messages/done', async (req) => {
  const user = await requireUser(req);
  const b = await readBody(req, 2000);
  const reqId = String(b.req || '');
  if (!/^[a-z0-9]{4,40}$/i.test(reqId)) throw httpError(400, 'Pedido inválido.');
  const room = await getRoom(String(b.doc || ''));
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  if (!Perms.compute(permDoc(room), user)) throw httpError(403, 'Sem acesso a esta planilha.');
  const done = { by: user.id, name: user.name, at: new Date().toISOString() };
  const list = await store.markRefDone(room.id, reqId, done);
  if (list.length) {
    const who = new Set();
    for (const m of list) { who.add(m.from_id); who.add(m.to_id); }
    deliver([...who], { type: 'dmDone', ids: list.map((m) => m.id), done });
  }
  return { ok: true, n: list.length };
});

route('GET', '/api/docs', async (req) => {
  const user = await requireUser(req);
  const rows = await store.listDocsFor(user);
  const owners = new Map();
  for (const r of rows) if (!owners.has(r.owner_id)) { const o = await store.getUserById(r.owner_id); owners.set(r.owner_id, o ? o.name : ''); }
  return rows.map((r) => {
    const p = Perms.compute({ ownerId: r.owner_id, acl: r.acl, data: { sheets: [] } }, user);
    return { id: r.id, title: r.title, updated: r.updated_at, owner: owners.get(r.owner_id), mine: r.owner_id === user.id, role: p ? p.role : 'viewer' };
  });
});
route('POST', '/api/docs', async (req) => {
  const user = await requireUser(req);
  if (!(await isGlobalAdmin(user))) throw httpError(403, 'Somente administradores podem criar planilhas na nuvem.');
  const b = await readBody(req);
  const data = b.data && Array.isArray(b.data.sheets) && b.data.sheets.length ? b.data : { sheets: [{ id: uid(6), name: 'Página1', rows: 1000, cols: 26, cells: {} }] };
  for (const s of data.sheets) if (!s.id) s.id = uid(6);
  const title = String(b.title || data.title || 'Planilha sem título').slice(0, 200);
  data.title = title;
  const id = uid(9);
  await store.createDoc({ id, title, owner_id: user.id, data, acl: Perms.defaultAcl() });
  return { id, title };
});
route('GET', '/api/docs/:id', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms) throw httpError(403, 'Você não tem acesso a esta planilha.');
  return { id: room.id, title: room.data.title, perms };
});
route('DELETE', '/api/docs/:id', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  if (room.ownerId !== user.id) throw httpError(403, 'Somente o dono pode excluir a planilha.');
  for (const c of [...room.clients]) { c.ws.send({ type: 'error', code: 'deleted', message: 'Esta planilha foi excluída pelo dono.' }); c.ws.close(4004, 'excluída'); }
  clearTimeout(room.timer);
  rooms.delete(room.id);
  await store.deleteDoc(room.id);
  return { ok: true };
});
route('GET', '/api/docs/:id/share', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms || !perms.admin) throw httpError(403, 'Somente administradores podem gerenciar o compartilhamento.');
  const owner = await store.getUserById(room.ownerId);
  const members = [];
  for (const m of room.acl.members) {
    const u = await store.getUserByEmail(m.email);
    members.push(Object.assign({}, m, { name: u ? u.name : null, registered: !!u }));
  }
  const online = [...room.clients].map((c) => c.user.email);
  return { acl: Object.assign({}, room.acl, { members }), owner: owner ? publicUser(owner) : null, sheets: room.data.sheets.map((s) => ({ id: s.id, name: s.name })), online, isOwner: room.ownerId === user.id };
});
// ---------- Sessões: o administrador desloga todos ou pessoas escolhidas ----------
async function sessionsRoom(req, id) {
  const user = await requireUser(req);
  const room = await getRoom(id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms || !perms.admin) throw httpError(403, 'Somente administradores encerram sessões.');
  return { user, room };
}
// pessoas com acesso à planilha (dono, membros com conta e quem está conectado agora)
async function docPeople(room) {
  const byId = new Map();
  const add = (u, extra) => { if (u && !byId.has(u.id)) byId.set(u.id, Object.assign({ id: u.id, name: u.name, email: u.email }, extra || {})); };
  add(await store.getUserById(room.ownerId), { owner: true });
  for (const m of room.acl.members || []) { const u = await store.getUserByEmail(m.email); add(u, { sector: m.sector || null }); }
  for (const c of room.clients) add(c.user);
  return [...byId.values()];
}
route('GET', '/api/docs/:id/sessions', async (req, p) => {
  const { user, room } = await sessionsRoom(req, p.id);
  const online = new Map();
  for (const r of rooms.values()) for (const c of r.clients) if (c.user) online.set(c.user.id, (online.get(c.user.id) || 0) + (r === room ? 1 : 0));
  const people = await docPeople(room);
  const sectors = new Map((room.acl.sectors || []).map((s) => [s.id, s.name]));
  return people.map((x) => Object.assign(x, { online: online.get(x.id) || 0, conectado: online.has(x.id), setor: x.sector ? sectors.get(x.sector) || null : null, eu: x.id === user.id }))
    .sort((a, b) => (b.online - a.online) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
});
route('POST', '/api/docs/:id/logout', async (req, p) => {
  const { user, room } = await sessionsRoom(req, p.id);
  const b = await readBody(req, 100000);
  const people = await docPeople(room);
  const souGlobal = await isGlobalAdmin(user), souDono = room.ownerId === user.id;
  const pedidos = b.all ? people.map((x) => x.id) : (Array.isArray(b.users) ? b.users.map(String) : []);
  const alvos = [], pulados = [];
  for (const id of pedidos) {
    const pessoa = people.find((x) => x.id === id);
    if (!pessoa || id === user.id) continue; // só quem tem acesso a esta planilha; nunca a própria pessoa
    if ((pessoa.owner && !souDono && !souGlobal) || (!souGlobal && await isGlobalAdmin(pessoa))) { pulados.push(pessoa.name); continue; }
    alvos.push(pessoa);
  }
  for (const a of alvos) {
    await store.deleteUserSessions(a.id);
    for (const [k, v] of sessionCache) if (v.user && v.user.id === a.id) sessionCache.delete(k);
    for (const r of rooms.values()) for (const c of [...r.clients]) if (c.user && c.user.id === a.id) {
      c.ws.send({ type: 'error', code: 'auth', message: 'Sua sessão foi encerrada pelo administrador. Entre de novo para continuar.' });
      c.ws.close(4001, 'deslogado');
    }
  }
  if (alvos.length) console.log(`[sessões] ${user.email} deslogou ${alvos.map((a) => a.email).join(', ')} (planilha ${room.id})`);
  return { ok: true, deslogados: alvos.map((a) => a.name), pulados };
});
// ---------- Administrador › Métricas da planilha e limite de usuários ----------
async function metricasRoom(req, id) {
  const user = await requireUser(req);
  const room = await getRoom(id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms || !perms.admin) throw httpError(403, 'Somente administradores veem as métricas e mudam o limite de usuários.');
  return { user, room };
}
route('GET', '/api/docs/:id/metricas', async (req, p) => {
  const { room } = await metricasRoom(req, p.id);
  const sectors = new Map((room.acl.sectors || []).map((s) => [s.id, s.name]));
  const setorDe = new Map((room.acl.members || []).map((m) => [m.email, m.sector ? sectors.get(m.sector) || null : null]));
  const nomePagina = new Map(room.data.sheets.map((s) => [s.id, s.name]));
  // quem está conectado agora (uma linha por pessoa, com o número de abas)
  const porPessoa = new Map();
  for (const c of room.clients) {
    if (!c.user) continue;
    const x = porPessoa.get(c.user.id) || { id: c.user.id, name: c.user.name, email: c.user.email, setor: setorDe.get(c.user.email) || null, admin: !!(c.perms && c.perms.admin), abas: 0, desde: c.since || Date.now(), pagina: null };
    x.abas++;
    x.desde = Math.min(x.desde, c.since || Date.now());
    if (c.presence && c.presence.sheetId) x.pagina = nomePagina.get(c.presence.sheetId) || x.pagina;
    porPessoa.set(c.user.id, x);
  }
  const lista = [...porPessoa.values()].sort((a, b) => (a.admin - b.admin) || a.desde - b.desde)
    .map((x) => Object.assign(x, { desde: new Date(x.desde).toISOString() }));
  const naoAdmins = lista.filter((x) => !x.admin).length;
  const max = await limiteDe(room.id);
  const dia = await diaDe(room.id);
  let hoje = { edicoes: 0, pessoas: 0, top: [] }, semana = { edicoes: 0, pessoas: 0, top: [] }, erroEdicoes = null;
  try {
    hoje = await store.historyStats(room.id, inicioHojeISO());
    semana = await store.historyStats(room.id, new Date(Date.now() - 7 * 86400e3).toISOString());
  } catch (e) { erroEdicoes = 'Não consegui contar as edições agora.'; }
  const paginas = room.data.sheets.map((s) => {
    let n = 0;
    for (const a in s.cells || {}) { const v = s.cells[a] && s.cells[a].v; if (v !== undefined && v !== null && v !== '') n++; }
    return { name: s.name, celulas: n, hidden: !!s.hidden };
  });
  let conexoes = 0;
  for (const r of rooms.values()) conexoes += r.clients.size;
  return {
    agora: { pessoas: lista.length, abas: room.clients.size, naoAdmins, lista },
    limite: { max, vagas: max ? Math.max(0, max - naoAdmins) : null },
    hoje: { dia: dia.dia, pico: dia.pico, picoEm: dia.picoEm, acessos: dia.quem.length, bloqueados: dia.bloqueados, ultimosBloqueados: dia.ultimosBloqueados, edicoes: hoje.edicoes, editores: hoje.pessoas, top: hoje.top },
    semana: { edicoes: semana.edicoes, editores: semana.pessoas, top: semana.top },
    erroEdicoes,
    planilha: {
      titulo: room.data.title || '', paginas, celulas: paginas.reduce((t, x) => t + x.celulas, 0),
      tamanhoKB: Math.round(Buffer.byteLength(JSON.stringify(room.data)) / 1024), versao: room.version,
      salvoEm: room.lastSave ? new Date(room.lastSave).toISOString() : null, aSalvar: !!room.dirty,
      membros: (room.acl.members || []).length + 1, setores: (room.acl.sectors || []).length,
    },
    servidor: { ligadoHaMin: Math.round(process.uptime() / 60), memoriaMB: Math.round(process.memoryUsage().rss / 1048576), salas: rooms.size, conexoes, armazenamento: store.kind },
  };
});
route('PUT', '/api/docs/:id/limite', async (req, p) => {
  const { user, room } = await metricasRoom(req, p.id);
  const b = await readBody(req, 10000);
  const max = Math.floor(Number(b.max));
  if (!Number.isFinite(max) || max < 0 || max > LIMITE_MAX) throw httpError(400, `O limite deve ser um número de 0 (sem limite) a ${LIMITE_MAX}.`);
  await store.setSetting('limite_usuarios:' + room.id, max ? { max, por: user.email, em: new Date().toISOString() } : null);
  limites.set(room.id, max);
  console.log(`[limite] ${user.email} mudou o limite da planilha ${room.id} para ${max || 'sem limite'}`);
  return { ok: true, max };
});
route('PUT', '/api/docs/:id/share', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms || !perms.admin) throw httpError(403, 'Somente administradores podem gerenciar o compartilhamento.');
  const b = await readBody(req, 2 * 1024 * 1024);
  const acl = sanitizeAcl(b.acl || {}, room);
  const owner = await store.getUserById(room.ownerId);
  if (owner) acl.members = acl.members.filter((m) => m.email !== owner.email);
  room.acl = acl;
  await store.saveAcl(room.id, acl);
  refreshRoom(room, true);
  return { ok: true, acl };
});

route('GET', '/api/docs/:id/history', async (req, p) => {
  const user = await requireUser(req);
  const room = await getRoom(p.id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms) throw httpError(403, 'Você não tem acesso a esta planilha.');
  const q = new URL(req.url, 'http://x').searchParams;
  const sheet = String(q.get('sheet') || ''), addr = String(q.get('addr') || '').toUpperCase();
  if (!/^[A-Z]{1,3}\d{1,7}$/.test(addr)) throw httpError(400, 'Célula inválida.');
  if (!Perms.canSee(perms, sheet, addr)) throw httpError(403, 'Você não tem permissão para ver esta célula.');
  const all = q.get('all') === '1';
  const rows = await store.getHistory(room.id, sheet, addr, all ? 5000 : 100);
  // o IP só aparece para administradores
  return rows.map((h) => ({ at: h.at, uid: h.user_id || null, name: h.user_name || 'Alguém', color: colorFor(h.user_id || ''), avatar: avatarOf(h.user_id || ''), before: h.before, after: h.after, ip: perms.admin ? h.ip || null : undefined }));
});

// ---------- Enviar status por e-mail (IMAP para achar a conversa, SMTP para responder) ----------
// Quem pode enviar: administradores e os setores/pessoas escolhidos pelo administrador (sheet.mailSectors).
function canSendMail(perms, sheet) {
  if (!perms) return false;
  if (perms.admin) return true;
  return Array.isArray(sheet && sheet.mailSectors) && Perms.inList(sheet.mailSectors, perms);
}
async function mailRoom(req, id, sheetId) {
  const user = await requireUser(req);
  const room = await getRoom(id);
  if (!room) throw httpError(404, 'Planilha não encontrada.');
  const perms = Perms.compute(permDoc(room), user);
  if (!perms) throw httpError(403, 'Você não tem acesso a esta planilha.');
  const sheet = (room.data.sheets || []).find((x) => x.id === sheetId) || null;
  return { user, room, perms, sheet };
}
// endereços da resposta a todos: quem escreveu vai no Para; o resto vai em Cópia (menos a nossa própria conta)
function replyAllOf(th, myAddr) {
  const me = String(myAddr || '').toLowerCase();
  const seen = new Set([me]);
  const pick = (list) => String(list || '').split(',').map((a) => a.trim()).filter(Boolean).filter((a) => {
    const m = /<([^>]+)>/.exec(a);
    const addr = (m ? m[1] : a).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(addr) || seen.has(addr)) return false;
    seen.add(addr);
    return true;
  });
  // a última mensagem da conversa foi nossa: a resposta vai de novo para as mesmas pessoas
  if (th.fromMe) { const to2 = pick(th.to), cc2 = pick(th.cc); return { to: to2.join(', '), cc: cc2.join(', ') }; }
  const to = pick(th.from);
  const cc = pick(th.to).concat(pick(th.cc));
  return { to: to.join(', '), cc: cc.join(', ') };
}
route('GET', '/api/docs/:id/mail', async (req, p) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const { perms, sheet } = await mailRoom(req, p.id, String(q.get('sheet') || ''));
  const cfg = mail.config();
  return {
    configurado: mail.configured(),
    podeEnviar: canSendMail(perms, sheet),
    remetente: mail.configured() ? cfg.from : null,
    quem: (sheet && sheet.mailSectors) || null,
    // por onde sai o envio: 'api' (HTTPS) quando há chave, senão 'smtp' (sem revelar a chave)
    envio: cfg.transport || (cfg.apiKey ? 'api' : 'smtp'),
  };
});
// procura a conversa pelo assunto (a REFERENCIA) e devolve a mensagem mais recente
route('POST', '/api/docs/:id/mail/find', async (req, p) => {
  const b = await readBody(req, 4000);
  const { perms, sheet } = await mailRoom(req, p.id, String(b.sheet || ''));
  if (!canSendMail(perms, sheet)) throw httpError(403, 'Enviar status por e-mail não está liberado para você.');
  if (!mail.configured()) throw httpError(503, 'O e-mail ainda não está configurado no servidor.');
  const ref = String(b.ref || '').trim();
  if (ref.length < 3) throw httpError(400, 'Referência muito curta para procurar no e-mail.');
  const cfg = mail.config();
  let th;
  try { th = await mail.findThread(cfg, ref, b.mailbox ? String(b.mailbox) : null, { withBody: true }); }
  catch (e) { throw httpError(502, 'Não foi possível falar com o servidor de e-mail: ' + e.message); }
  if (!th) return { achou: false, ref };
  const citada = !!th.body;
  // a última mensagem, para mostrar na tela como ela é (com as imagens da assinatura)
  const preview = th.body ? mail.previewHtml(th.body, 2.5e6) : '';
  delete th.body;
  return { achou: true, ref, thread: Object.assign(th, { citada, preview }), destinatarios: replyAllOf(th, cfg.from) };
});
// limite dos anexos (somados, em bytes): 15 MB, com tolerância até 17 MB
const MAX_ANEXOS = Number(process.env.MAIL_MAX_ANEXOS || 15 * 1024 * 1024);
const TOLERANCIA_ANEXOS = Number(process.env.MAIL_TOLERANCIA_ANEXOS || 17 * 1024 * 1024);
const tamanhoB64 = (s) => Math.floor(String(s || '').replace(/=+$/, '').length * 3 / 4);
// assinatura do e-mail (guardada no servidor; vem do webmail ou é enviada pela tela)
const SIG_KEY = 'mailSignature';
const MAX_ASSINATURA = 1.5 * 1024 * 1024;
async function assinatura() { try { return await store.getSetting(SIG_KEY); } catch (e) { return null; } }
const sigComImagens = (sig) => (sig ? (sig.images || []).reduce((h, im) => h.split('cid:' + im.cid).join('data:' + im.type + ';base64,' + im.data), sig.html || '') : '');
route('GET', '/api/docs/:id/mail/signature', async (req, p) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const { perms, sheet } = await mailRoom(req, p.id, String(q.get('sheet') || ''));
  if (!canSendMail(perms, sheet)) throw httpError(403, 'Enviar status por e-mail não está liberado para você.');
  const sig = await assinatura();
  return sig ? { tem: true, html: sigComImagens(sig), origem: sig.origem || '', por: sig.by || '', em: sig.at || '' } : { tem: false };
});
// lê a assinatura configurada no webmail da conta (para a tela reduzir as imagens e salvar)
route('POST', '/api/docs/:id/mail/signature/webmail', async (req, p) => {
  const b = await readBody(req, 4000);
  const { perms, sheet } = await mailRoom(req, p.id, String(b.sheet || ''));
  if (!canSendMail(perms, sheet)) throw httpError(403, 'Enviar status por e-mail não está liberado para você.');
  if (!mail.configured()) throw httpError(503, 'O e-mail ainda não está configurado no servidor.');
  try { return await mail.webmailSignature(mail.config()); }
  catch (e) { throw httpError(502, 'Não foi possível ler a assinatura do webmail: ' + e.message); }
});
route('PUT', '/api/docs/:id/mail/signature', async (req, p) => {
  const b = await readBody(req, 4 * 1024 * 1024);
  const { user, perms, sheet } = await mailRoom(req, p.id, String(b.sheet || ''));
  if (!canSendMail(perms, sheet)) throw httpError(403, 'Enviar status por e-mail não está liberado para você.');
  const html = String(b.html || '').trim();
  if (!html) { await store.setSetting(SIG_KEY, null); return { ok: true, tem: false }; }
  const sp = mail.splitInlineImages(mail.quotableHtml({ html: '<body>' + html + '</body>' }).replace(/<img[^>]+src\s*=\s*["']?cid:[^>]*>/gi, ''), 'assinatura');
  const peso = sp.images.reduce((n, im) => n + tamanhoB64(im.data), 0) + sp.html.length;
  if (peso > MAX_ASSINATURA) throw httpError(413, 'A assinatura está grande demais (limite de 1,5 MB). Use uma imagem menor.');
  await store.setSetting(SIG_KEY, { html: sp.html, images: sp.images, origem: b.origem === 'webmail' ? 'webmail' : 'manual', by: user.name, at: new Date().toISOString() });
  return { ok: true, tem: true };
});
route('POST', '/api/docs/:id/mail/send', async (req, p) => {
  const b = await readBody(req, Math.ceil(Math.max(MAX_ANEXOS, TOLERANCIA_ANEXOS) * 1.4) + 2 * 1024 * 1024);
  const { user, perms, sheet, room } = await mailRoom(req, p.id, String(b.sheet || ''));
  if (!canSendMail(perms, sheet)) throw httpError(403, 'Enviar status por e-mail não está liberado para você.');
  if (!mail.configured()) throw httpError(503, 'O e-mail ainda não está configurado no servidor.');
  if (rateLimited('mail:' + user.id)) throw httpError(429, 'Muitos e-mails em pouco tempo. Aguarde um minuto.');
  const subject = String(b.subject || '').trim().slice(0, 300);
  const to = String(b.to || '').trim(), cc = String(b.cc || '').trim();
  if (!subject) throw httpError(400, 'O e-mail precisa de um assunto.');
  if (!mail.addressesOf(to).length) throw httpError(400, 'O e-mail precisa de ao menos um destinatário.');
  const anexos = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 20).map((a) => ({
    name: String(a.name || 'anexo').slice(0, 150), type: String(a.type || 'application/octet-stream').slice(0, 100),
    data: String(a.data || '').replace(/\s+/g, ''),
  }));
  const total = anexos.reduce((n, a) => n + tamanhoB64(a.data), 0);
  if (total > Math.max(MAX_ANEXOS, TOLERANCIA_ANEXOS)) throw httpError(413, `Os anexos somam mais de ${Math.round(MAX_ANEXOS / 1048576)} MB (a tolerância vai até ${Math.round(TOLERANCIA_ANEXOS / 1048576)} MB).`);
  const cfg = mail.config();
  let html = String(b.html || ''), text = String(b.text || '');
  let inReplyTo = String(b.inReplyTo || '').trim() || null, references = String(b.references || '').trim() || null;
  // resposta na conversa: o servidor acha de novo a última mensagem com a REFERENCIA no assunto,
  // responde a ela (In-Reply-To/References) e cita o histórico embaixo, como o Outlook faz
  const inline = [];
  // assinatura (logo abaixo do texto e da tabela, antes do histórico, como no webmail)
  if (b.signature !== false) {
    const sig = await assinatura();
    if (sig && sig.html) { html += '<div class="assinatura">' + sig.html + '</div>'; inline.push(...(sig.images || [])); }
  }
  const ref = String(b.ref || '').trim();
  if (ref.length >= 3) {
    let th = null;
    try { th = await mail.findThread(cfg, ref, null, { withBody: b.quote !== false }); }
    catch (e) { throw httpError(502, 'Não foi possível falar com o servidor de e-mail: ' + e.message); }
    if (th) {
      if (th.messageId) { inReplyTo = th.messageId; references = [th.references, th.messageId].filter(Boolean).join(' '); }
      // histórico citado, com as imagens (assinaturas) das mensagens anteriores
      if (b.quote !== false && th.body) { const qb = mail.quoteBlock(th); html += qb.html; text += qb.text; for (const im of qb.images) if (!inline.some((x) => x.cid === im.cid)) inline.push(im); }
    }
  }
  let r;
  try {
    r = await mail.send(cfg, { to, cc, subject, html, text, inReplyTo, references, attachments: anexos, inline });
  } catch (e) { throw httpError(502, 'O servidor de e-mail recusou o envio: ' + e.message); }
  console.log(`[e-mail] ${user.email} enviou "${subject}" para ${r.rcpt.length} destinatário(s) na planilha ${room.id}`);
  return { ok: true, messageId: r.messageId, destinatarios: r.rcpt, por: user.name };
});
// Diagnóstico: descobre em qual host/porta o IMAP e o SMTP respondem (só administradores do sistema)
route('GET', '/api/mail/diag', async (req) => {
  const user = await requireUser(req);
  const q = new URL(req.url, 'http://x').searchParams;
  const hosts = String(q.get('hosts') || '').split(',').map((h) => h.trim()).filter(Boolean);
  // testar hosts livremente é só do administrador do sistema; sem ?hosts qualquer administrador
  // de alguma planilha pode conferir o que já está configurado aqui
  if (hosts.length) { if (!(await isGlobalAdmin(user))) throw httpError(403, 'Somente administradores do sistema podem testar outros endereços.'); }
  else if (!(await isGlobalAdmin(user))) {
    const acls = await store.allDocAcls();
    const ok = acls.some((d) => d.owner_id === user.id || (d.acl && (d.acl.members || []).some((m) => m.email === user.email && m.role === 'admin')));
    if (!ok) throw httpError(403, 'Somente administradores.');
  }
  const cfg = mail.config();
  const base = hosts.length ? hosts : [cfg.imapHost, cfg.smtpHost].filter(Boolean);
  const alvos = [];
  for (const h of [...new Set(base)]) {
    alvos.push({ nome: 'IMAP TLS', host: h, port: 993, secure: true });
    alvos.push({ nome: 'IMAP STARTTLS', host: h, port: 143, secure: false });
    alvos.push({ nome: 'SMTP TLS', host: h, port: 465, secure: true });
    alvos.push({ nome: 'SMTP STARTTLS', host: h, port: 587, secure: false });
    // portas alternativas: alguns provedores oferecem a 2525 quando a 465/587 está bloqueada na saída
    alvos.push({ nome: 'SMTP alt', host: h, port: 2525, secure: false });
    alvos.push({ nome: 'SMTP 25', host: h, port: 25, secure: false });
  }
  if (!alvos.length) return { erro: 'Nenhum host para testar. Passe ?hosts=a.com,b.com' };
  return { configurado: mail.configured(), testes: await mail.diag(cfg, alvos) };
});

// ---------- DSS: catálogo de motoristas (GET {DSS_BASE_URL}/listarMotoristas, Basic) ----------
const DSS_BASE = (process.env.DSS_BASE_URL || 'https://costalog.dssinformatica.com.br/wsdss').replace(/\/$/, '');
const DSS_USER = process.env.DSS_USUARIO || process.env.DSS_USERNAME || '';
const DSS_PASS = process.env.DSS_SENHA || process.env.DSS_PASSWORD || '';
const DSS_TOKEN = process.env.DSS_TOKEN || '';
const DSS_DRIVERS_PATH = process.env.DSS_MOTORISTAS_PATH || '/listarMotoristas';
let drivers = { items: [], expires: 0, error: null, loading: null };
const pick = (o, keys) => { for (const k of keys) { const v = o && o[k]; if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null') return String(v).trim(); } return ''; };
// Motoristas: o DSS é consultado uma vez por dia (horário de Brasília) e a lista fica guardada no banco
// (settings › dss_motoristas). Ao reiniciar, o servidor usa a lista do banco; se ela for de outro dia, busca de novo.
// "Atualizar agora" (?atualizar=1) continua forçando a consulta.
const DRIVERS_KEY = 'dss_motoristas';
const diaBR = (d) => new Date(d || Date.now()).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
let driversDoBanco = false;
async function driversFromStore() {
  if (driversDoBanco) return;
  driversDoBanco = true;
  try {
    const sv = await store.getSetting(DRIVERS_KEY);
    if (sv && Array.isArray(sv.items) && sv.items.length && !drivers.items.length) {
      drivers = Object.assign({}, drivers, { items: sv.items, at: sv.at, day: diaBR(sv.at), expires: 0, error: null });
      console.log(`[DSS] motoristas do banco: ${sv.items.length} (de ${sv.at})`);
    }
  } catch (e) { console.error('[DSS] não consegui ler os motoristas do banco:', e.message); }
}
async function loadDrivers(force) {
  await driversFromStore();
  // já tem a lista de hoje: não consulta o DSS de novo
  if (!force && drivers.items.length && drivers.day === diaBR()) return drivers;
  // erro recente: espera a próxima tentativa (1 h) usando a lista que já tem
  if (!force && Date.now() < drivers.expires) return drivers;
  if (drivers.loading) return drivers.loading;
  drivers.loading = (async () => {
    try {
      if (!DSS_TOKEN && !(DSS_USER && DSS_PASS)) throw httpError(503, 'A integração com o DSS não está configurada: cadastre DSS_USUARIO e DSS_SENHA no servidor.');
      const url = DSS_BASE + (DSS_DRIVERS_PATH.startsWith('/') ? DSS_DRIVERS_PATH : '/' + DSS_DRIVERS_PATH);
      const headers = { Accept: 'application/json', Authorization: DSS_TOKEN ? 'Bearer ' + DSS_TOKEN : 'Basic ' + Buffer.from(DSS_USER + ':' + DSS_PASS).toString('base64') };
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch (e) { throw httpError(502, `O DSS respondeu algo que não é JSON (HTTP ${r.status}). Confira DSS_BASE_URL.`); }
      if (!r.ok || (typeof j.status === 'number' && j.status !== 200)) throw httpError(502, `O DSS recusou a consulta de motoristas (HTTP ${r.status}${j.mensagemErro ? ': ' + j.mensagemErro : ''}).`);
      const rows = Array.isArray(j) ? j : j.registros || j.motoristas || j.data || [];
      const seen = new Map();
      for (const it of rows) {
        const nome = pick(it, ['nome_motorista', 'nome', 'motorista_nome', 'motorista', 'razao_social']);
        // CPF/CNPJ só com os números (sem pontos, traços e barra)
        const doc = String(pick(it, ['cnpj_cpf', 'cpf_cnpj', 'cpf', 'cnpj', 'motorista_cpf']) || '').replace(/\D/g, '');
        if (!nome || nome.length > 150) continue;
        const key = nome.toUpperCase() + '|' + doc;
        if (!seen.has(key)) seen.set(key, { nome, cpf: doc, id: pick(it, ['id', 'motorista_id']) });
      }
      const at = new Date().toISOString();
      drivers = { items: [...seen.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), expires: 0, error: null, loading: null, at, day: diaBR(at) };
      console.log(`[DSS] motoristas carregados: ${drivers.items.length}`);
      try { await store.setSetting(DRIVERS_KEY, { items: drivers.items, at }); } catch (e) { console.error('[DSS] não consegui guardar os motoristas no banco:', e.message); }
    } catch (e) {
      drivers = Object.assign({}, drivers, { expires: Date.now() + 60 * 60e3, error: e.message || String(e), status: e.status || 502, loading: null });
      console.error('[DSS] motoristas:', drivers.error);
    }
    return drivers;
  })();
  return drivers.loading;
}
// confere de hora em hora: virou o dia, busca a lista nova (uma vez por dia)
if (!process.env.DSS_DIARIO_OFF) setInterval(() => { loadDrivers().catch(() => {}); }, 60 * 60e3).unref();
route('GET', '/api/dss/motoristas', async (req) => {
  await requireUser(req);
  const d = await loadDrivers(new URL(req.url, 'http://x').searchParams.get('atualizar') === '1');
  if (!d.items.length && d.error) throw httpError(d.status || 502, d.error);
  return { motoristas: d.items, atualizado: d.at || null, aviso: d.error || null };
});
// ---------- carga_of_container (Carga OF Container): DATA BAIXA e consulta de containers ----------
// A API devolve registros com "nro_container" ("TRHU 861.819-1") e "data_hora_entrada" ("2026-11-05 01:11:17").
// URL: variável carga_of_container / CARGA_OF_CONTAINER_URL (o nome pode vir em qualquer caixa: Carga_OF_Container…);
// sem ela, {DSS_BASE_URL}/carga_of_container. Login: CARGA_OF_CONTAINER_TOKEN / _USUARIO / _SENHA, ou o mesmo do DSS.
const nroContainer = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtNroContainer = (n) => (/^[A-Z]{4}\d{7}$/.test(n) ? `${n.slice(0, 4)} ${n.slice(4, 7)}.${n.slice(7, 10)}-${n.slice(10)}` : n);
// variável de ambiente sem diferenciar maiúsculas, "_" ou "-" (Carga_OF_Container = carga_of_container = CARGA-OF-CONTAINER)
const envKey = (k) => String(k).toUpperCase().replace(/[^A-Z0-9]/g, '');
function envAny(...names) {
  const want = names.map(envKey);
  for (const w of want) for (const k of Object.keys(process.env)) if (envKey(k) === w && String(process.env[k]).trim()) return { name: k, value: String(process.env[k]).trim() };
  return null;
}
function cargaConf() {
  const v = envAny('CARGA_OF_CONTAINER_URL', 'carga_of_container', 'CARGA_OF_CONTAINER_API', 'CARGAOFCONTAINER');
  let url = v ? v.value : '';
  if (url && !/^https?:\/\//i.test(url)) url = DSS_BASE + '/' + url.replace(/^\/+/, '');
  if (!url) url = DSS_BASE + '/carga_of_container';
  const tk = envAny('CARGA_OF_CONTAINER_TOKEN');
  const us = envAny('CARGA_OF_CONTAINER_USUARIO', 'CARGA_OF_CONTAINER_USER'), ps = envAny('CARGA_OF_CONTAINER_SENHA', 'CARGA_OF_CONTAINER_PASSWORD');
  const metodo = (envAny('CARGA_OF_CONTAINER_METODO', 'CARGA_OF_CONTAINER_METHOD') || { value: 'GET' }).value.toUpperCase() === 'POST' ? 'POST' : 'GET';
  const h = { Accept: 'application/json' };
  if (tk) h.Authorization = /^(bearer|basic|token)\s/i.test(tk.value) ? tk.value : 'Bearer ' + tk.value;
  else if (us && ps) h.Authorization = 'Basic ' + Buffer.from(us.value + ':' + ps.value).toString('base64');
  else if (DSS_TOKEN) h.Authorization = 'Bearer ' + DSS_TOKEN;
  else if (DSS_USER && DSS_PASS) h.Authorization = 'Basic ' + Buffer.from(DSS_USER + ':' + DSS_PASS).toString('base64');
  return { url, headers: h, metodo, origem: v ? v.name : `(padrão: DSS_BASE_URL + /carga_of_container)`, login: tk ? 'token' : us && ps ? 'usuário próprio' : DSS_TOKEN || (DSS_USER && DSS_PASS) ? 'login do DSS' : 'sem login' };
}
// URL para mostrar em log/diagnóstico, sem senha nem parâmetros
const urlSegura = (u) => { try { const x = new URL(u); return x.origin + x.pathname + (x.search ? ' (com parâmetros)' : ''); } catch (e) { return '(URL inválida)'; } };

// os campos podem vir com outros nomes ou em outra caixa (NRO_CONTAINER, nroContainer, container, numero_container…)
const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const CAMPO_CONT = ['nrocontainer', 'numerocontainer', 'nrcontainer', 'numcontainer', 'container', 'conteiner', 'nrocntr', 'cntr', 'containernumero'];
const CAMPO_DATA = ['datahoraentrada', 'dthoraentrada', 'dataentrada', 'dtentrada', 'entrada', 'datahorabaixa', 'databaixa', 'dtbaixa', 'datahora', 'data'];
function campo(obj, lista) {
  const ks = Object.keys(obj), nk = ks.map(normKey);
  for (const want of lista) { const i = nk.indexOf(want); if (i >= 0) return ks[i]; }
  return null;
}
// todos os objetos da resposta que têm um campo de container (a lista pode vir solta ou dentro de registros/data/...)
function cargaRegistros(j, out, depth) {
  out = out || [];
  if ((depth || 0) > 6) return out;
  if (Array.isArray(j)) { for (const x of j) cargaRegistros(x, out, (depth || 0) + 1); return out; }
  if (j && typeof j === 'object') {
    const kc = campo(j, CAMPO_CONT);
    if (kc && typeof j[kc] !== 'object') out.push(j);
    else for (const k in j) if (j[k] && typeof j[k] === 'object') cargaRegistros(j[k], out, (depth || 0) + 1);
  }
  return out;
}
const regContainer = (it) => { const k = campo(it, CAMPO_CONT); return k ? it[k] : ''; };
const regDataHora = (it) => { const k = campo(it, CAMPO_DATA); return k ? it[k] : ''; };
// "2026-11-05 01:11:17" (ou 05/11/2026 01:11, ou /Date(…)/, ou ISO) → { data: '05/11/2026', ts }
function cargaData(v) {
  const t = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return { data: `${m[3]}/${m[2]}/${m[1]}`, ts: `${m[1]}${m[2]}${m[3]}${m[4] || '00'}${m[5] || '00'}${m[6] || '00'}` };
  m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return { data: `${m[1]}/${m[2]}/${m[3]}`, ts: `${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}${m[6] || '00'}` };
  m = /\/Date\((\d+)/.exec(t);
  if (m) { const d = new Date(+m[1]); const p = (n) => String(n).padStart(2, '0'); return { data: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, ts: d.toISOString().replace(/\D/g, '').slice(0, 14) }; }
  return null;
}
// erro de rede/HTTPS com o motivo real (certificado, conexão recusada, tempo esgotado…)
function motivoRede(e) {
  const c = (e && e.cause) || {};
  const code = c.code || e.code || '';
  const MAP = {
    ECONNREFUSED: 'conexão recusada', ECONNRESET: 'a conexão caiu no meio', ENOTFOUND: 'endereço não encontrado (DNS)', ETIMEDOUT: 'tempo esgotado',
    UND_ERR_CONNECT_TIMEOUT: 'tempo esgotado para conectar', UND_ERR_SOCKET: 'a conexão caiu no meio', CERT_HAS_EXPIRED: 'certificado HTTPS vencido',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificado HTTPS incompleto (falta a cadeia intermediária)', DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado HTTPS autoassinado',
    SELF_SIGNED_CERT_IN_CHAIN: 'certificado HTTPS autoassinado na cadeia', ERR_TLS_CERT_ALTNAME_INVALID: 'o certificado HTTPS é de outro nome', EPROTO: 'falha no HTTPS',
  };
  if (e && e.name === 'TimeoutError') return 'tempo esgotado (20 s)';
  return (MAP[code] || c.message || e.message || 'falha de rede') + (code ? ` [${code}]` : '');
}
// ---------- período (a API exige "Data de Início") ----------
// O nome do parâmetro não vem documentado: o servidor descobre sozinho, testando os nomes comuns e lendo a mensagem
// de erro da API; ou use CARGA_OF_CONTAINER_PARAMS, ex.: dataInicio={ini}&dataFim={fim} (formato em CARGA_OF_CONTAINER_FORMATO).
const pad2 = (n) => String(n).padStart(2, '0');
const FMT_DATA = {
  br: (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
  iso: (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
  isoh: (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 00:00:00`,
  ymd: (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`,
};
const NOMES_INI = ['data_inicio', 'dataInicio', 'dataInicial', 'data_inicial', 'dt_inicio', 'dtInicio', 'dtInicial', 'dt_inicial', 'inicio', 'data_ini', 'dataIni', 'dt_ini', 'dtIni', 'datainicio', 'data_de', 'de'];
const NOMES_FIM = ['data_fim', 'dataFim', 'dataFinal', 'data_final', 'dt_fim', 'dtFim', 'dtFinal', 'dt_final', 'fim', 'data_ate', 'dataAte', 'datafim', 'ate'];
const cargaDias = () => Math.max(1, Math.min(365, Number((envAny('CARGA_OF_CONTAINER_DIAS') || {}).value) || 60));
let cargaParams = null, cargaDescobrindo = null;
// uma consulta "crua": devolve { http, msg, regs }
async function cargaTenta(url) {
  const cf = cargaConf();
  const r = await fetch(url, { method: cf.metodo, headers: cf.headers, signal: AbortSignal.timeout(20000), redirect: 'follow', body: cf.metodo === 'POST' ? '{}' : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { /* não é JSON */ }
  const msg = j && typeof j === 'object' && !Array.isArray(j) ? String(j.mensagemErro || j.mensagem || j.message || j.erro || '') : '';
  const st = j && typeof j.status === 'number' ? j.status : r.status;
  return { http: st, msg, regs: j ? cargaRegistros(j) : [], json: !!j };
}
const comParams = (base, q) => base + (base.includes('?') ? '&' : '?') + q;
function periodoQuery(p, ini, fim) {
  if (p.template) return p.template.replace('{ini}', encodeURIComponent(FMT_DATA[p.fmt](ini))).replace('{fim}', encodeURIComponent(FMT_DATA[p.fmt](fim)));
  let q = p.ini + '=' + encodeURIComponent(FMT_DATA[p.fmt](ini));
  if (p.fim) q += '&' + p.fim + '=' + encodeURIComponent(FMT_DATA[p.fmt](fim));
  return q;
}
async function cargaPeriodo() {
  const tpl = envAny('CARGA_OF_CONTAINER_PARAMS');
  if (tpl) return { template: tpl.value.replace(/^\?/, ''), fmt: FMT_DATA[(envAny('CARGA_OF_CONTAINER_FORMATO') || {}).value] ? envAny('CARGA_OF_CONTAINER_FORMATO').value : 'br' };
  if (cargaParams) return cargaParams;
  if (cargaDescobrindo) return cargaDescobrindo;
  cargaDescobrindo = (async () => {
    const base = cargaConf().url, hoje = new Date(), ini = new Date(Date.now() - 7 * 864e5);
    const pede = /in[ií]cio|inicial/i;
    const primeira = await cargaTenta(base);
    if (!(primeira.http === 400 && pede.test(primeira.msg))) return (cargaParams = { nenhum: true });
    const log = [];
    // 1) o nome do início: a mensagem deixa de pedir a Data de Início
    let achou = null;
    for (const nome of NOMES_INI) {
      const t = await cargaTenta(comParams(base, nome + '=' + encodeURIComponent(FMT_DATA.br(ini))));
      log.push(`${nome}: ${t.http} ${t.msg.slice(0, 60)}`);
      if (!(t.http === 400 && pede.test(t.msg) && /n[aã]o informad/i.test(t.msg))) { achou = { ini: nome, t }; break; }
    }
    if (!achou) { console.error('[carga] não achei o parâmetro da Data de Início:', log.join(' | ')); cargaDescobrindo = null; throw httpError(502, 'A API carga_of_container pede a Data de Início e não reconheci o nome do parâmetro. Configure CARGA_OF_CONTAINER_PARAMS no Render (ex.: dataInicio={ini}&dataFim={fim}).'); }
    // 2) o formato da data (se a API reclamar do formato)
    let fmt = 'br';
    if (/inv[aá]lid|formato/i.test(achou.t.msg)) {
      for (const f of ['iso', 'isoh', 'ymd']) {
        const t = await cargaTenta(comParams(base, achou.ini + '=' + encodeURIComponent(FMT_DATA[f](ini))));
        log.push(`${achou.ini} ${f}: ${t.http} ${t.msg.slice(0, 60)}`);
        if (!/inv[aá]lid|formato/i.test(t.msg)) { fmt = f; achou.t = t; break; }
      }
    }
    // 3) o fim do período, se a API pedir
    let fim = null;
    if (/fim|final|t[eé]rmino/i.test(achou.t.msg) && achou.t.http >= 400) {
      for (const nome of NOMES_FIM) {
        const t = await cargaTenta(comParams(base, achou.ini + '=' + encodeURIComponent(FMT_DATA[fmt](ini)) + '&' + nome + '=' + encodeURIComponent(FMT_DATA[fmt](hoje))));
        log.push(`${nome}: ${t.http} ${t.msg.slice(0, 60)}`);
        if (!(t.http >= 400 && /fim|final|t[eé]rmino/i.test(t.msg) && /n[aã]o informad/i.test(t.msg))) { fim = nome; break; }
      }
    }
    cargaParams = { ini: achou.ini, fim, fmt };
    console.log('[carga] período descoberto:', JSON.stringify(cargaParams), '·', log.join(' | '));
    return cargaParams;
  })();
  try { return await cargaDescobrindo; } finally { cargaDescobrindo = null; }
}
// URL com o período (últimos N dias até amanhã) e, opcionalmente, o container
async function cargaUrlCom(extra) {
  const base = cargaConf().url, p = await cargaPeriodo();
  const fim = new Date(Date.now() + 864e5), ini = new Date(Date.now() - cargaDias() * 864e5);
  const q = [p.nenhum ? '' : periodoQuery(p, ini, fim), extra || ''].filter(Boolean).join('&');
  return q ? comParams(base, q) : base;
}

let cargaLista = { at: 0, regs: null };
async function cargaFetch(url, extra) {
  const cf = cargaConf();
  let ultimo = null;
  // a API às vezes falha por instantes (rede ou HTTP 5xx): tenta de novo 2 vezes
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa) await new Promise((r) => setTimeout(r, 600 * tentativa));
    let r, text;
    try {
      const opts = { method: cf.metodo, headers: Object.assign({}, cf.headers), signal: AbortSignal.timeout(20000), redirect: 'follow' };
      if (cf.metodo === 'POST') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(extra || {}); }
      r = await fetch(url, opts);
      text = await r.text();
    } catch (e) {
      ultimo = httpError(502, `Não foi possível falar com a API carga_of_container: ${motivoRede(e)}.`);
      console.error('[carga]', urlSegura(url), motivoRede(e));
      continue;
    }
    if (r.status >= 500) { ultimo = httpError(502, `A API carga_of_container falhou (HTTP ${r.status}).`); console.error('[carga]', urlSegura(url), 'HTTP', r.status, text.slice(0, 200).replace(/\s+/g, ' ')); continue; }
    let j;
    try { j = JSON.parse(text.replace(/^﻿/, '')); }
    catch (e) { console.error('[carga]', urlSegura(url), 'HTTP', r.status, 'não é JSON:', text.slice(0, 200).replace(/\s+/g, ' ')); throw httpError(502, `A API carga_of_container respondeu algo que não é JSON (HTTP ${r.status}). Confira a URL no Render.`); }
    if (!r.ok) { console.error('[carga]', urlSegura(url), 'HTTP', r.status, text.slice(0, 200).replace(/\s+/g, ' ')); throw httpError(502, `A API carga_of_container recusou a consulta (HTTP ${r.status}${j && (j.mensagemErro || j.message || j.erro) ? ': ' + (j.mensagemErro || j.message || j.erro) : ''}).`); }
    if (j && typeof j.status === 'number' && j.status >= 400) throw httpError(502, `A API carga_of_container recusou a consulta (${j.status}${j.mensagemErro ? ': ' + j.mensagemErro : ''}).`);
    return cargaRegistros(j);
  }
  throw ultimo;
}
async function cargaTodos() {
  if (!cargaLista.regs || Date.now() - cargaLista.at > 120e3) cargaLista = { at: Date.now(), regs: await cargaFetch(await cargaUrlCom('')) };
  return cargaLista.regs;
}
// registros de um container (pergunta direto pela API; se ela ignorar o filtro, procura na lista completa)
async function cargaDoContainer(n) {
  const deste = (regs) => regs.filter((it) => nroContainer(regContainer(it)) === n);
  let erro = null;
  for (const q of [n, fmtNroContainer(n)]) {
    try { const regs = deste(await cargaFetch(await cargaUrlCom('nro_container=' + encodeURIComponent(q)), { nro_container: q })); if (regs.length) return regs; } catch (e) { erro = e; }
    if (q === fmtNroContainer(q)) break;
  }
  try { return deste(await cargaTodos()); } catch (e) { throw erro || e; }
}
async function dataBaixa(container) {
  const n = nroContainer(container);
  if (n.length < 6) throw httpError(400, 'Container inválido.');
  let best = null;
  for (const it of await cargaDoContainer(n)) {
    const d = cargaData(regDataHora(it));
    if (d && (!best || d.ts > best.ts)) best = Object.assign(d, { dataHora: String(regDataHora(it)) });
  }
  return best;
}
route('GET', '/api/carga/data-baixa', async (req) => {
  await requireUser(req);
  const c = String(new URL(req.url, 'http://x').searchParams.get('container') || '');
  const b = await dataBaixa(c);
  return b ? { achou: true, container: nroContainer(c), data: b.data, dataHora: b.dataHora } : { achou: false, container: nroContainer(c) };
});
// vários containers de uma vez (PRÉ STACKING VAZIO: preencher todas as DATA BAIXA vazias).
// Busca a lista da API uma vez; os que não estiverem nela são consultados um a um (até 10 por vez).
route('POST', '/api/carga/datas-baixa', async (req) => {
  await requireUser(req);
  const b = await readBody(req, 200000);
  const lista = [...new Set((Array.isArray(b.containers) ? b.containers : []).map(nroContainer).filter((n) => n.length >= 6))].slice(0, 300);
  const out = {};
  if (!lista.length) return { resultados: out };
  const melhor = (regs, n) => {
    let best = null;
    for (const it of regs) {
      if (nroContainer(regContainer(it)) !== n) continue;
      const d = cargaData(regDataHora(it));
      if (d && (!best || d.ts > best.ts)) best = d;
    }
    return best;
  };
  let todos = [], erro = null;
  try { todos = await cargaTodos(); } catch (e) { erro = e; }
  let avulsas = 0;
  for (const n of lista) {
    let d = melhor(todos, n);
    if (!d && avulsas < 10) { avulsas++; try { d = melhor(await cargaDoContainer(n), n); } catch (e) { erro = erro || e; } }
    out[n] = d ? d.data : null;
  }
  if (erro && !Object.values(out).some(Boolean)) throw erro;
  return { resultados: out };
});
// consulta para a tela (Administrador › Containers da Carga OF): registros de um container, ou os mais recentes
route('GET', '/api/carga/consulta', async (req) => {
  await requireUser(req);
  const q = new URL(req.url, 'http://x').searchParams;
  const n = nroContainer(q.get('container') || '');
  const limpa = (it) => { const o = {}; for (const k in it) if (it[k] === null || typeof it[k] !== 'object') o[k] = it[k]; return o; };
  if (n) {
    if (n.length < 4) throw httpError(400, 'Digite ao menos 4 letras ou números do container.');
    // parte do número: procura na lista completa
    const regs = n.length >= 10 ? await cargaDoContainer(n) : (await cargaTodos()).filter((it) => nroContainer(regContainer(it)).includes(n));
    return { registros: regs.slice(0, 200).map(limpa), total: regs.length };
  }
  const todos = await cargaTodos();
  const ord = todos.slice().sort((a, b) => String((cargaData(regDataHora(b)) || {}).ts || '').localeCompare(String((cargaData(regDataHora(a)) || {}).ts || '')));
  return { registros: ord.slice(0, 100).map(limpa), total: todos.length, atualizado: new Date(cargaLista.at).toISOString() };
});
// diagnóstico: de onde vem a URL, o que a API respondeu e quais campos vieram (sem valores)
async function cargaDiag() {
  const cf = cargaConf();
  const out = { url: urlSegura(cf.url), variavel: cf.origem, login: cf.login, metodo: cf.metodo };
  const t0 = Date.now();
  try {
    let url = cf.url;
    try { const p = await cargaPeriodo(); if (!p.nenhum) { out.periodo = p.template ? p.template : `${p.ini}${p.fim ? ' e ' + p.fim : ''} (${p.fmt}), últimos ${cargaDias()} dias`; url = await cargaUrlCom(''); } }
    catch (e) { out.periodo = 'não descoberto: ' + e.message; }
    const r = await fetch(url, { method: cf.metodo, headers: cf.headers, signal: AbortSignal.timeout(20000), redirect: 'follow', body: cf.metodo === 'POST' ? '{}' : undefined });
    const text = await r.text();
    Object.assign(out, { http: r.status, tipo: r.headers.get('content-type') || '', ms: Date.now() - t0, redirecionou: r.redirected ? urlSegura(r.url) : null });
    let j = null;
    try { j = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { out.json = false; out.inicio = text.slice(0, 160).replace(/\s+/g, ' '); return out; }
    out.json = true;
    const regs = cargaRegistros(j);
    out.registros = regs.length;
    if (j && typeof j === 'object' && !Array.isArray(j)) { const msg = j.mensagemErro || j.mensagem || j.message || j.erro || j.error; if (msg) out.mensagem = String(msg).slice(0, 300); if (j.status !== undefined) out.statusApi = j.status; }
    out.formato = Array.isArray(j) ? `lista com ${j.length} itens` : j && typeof j === 'object' ? 'objeto com ' + Object.keys(j).slice(0, 12).join(', ') : typeof j;
    if (regs.length) { out.campos = Object.keys(regs[0]); out.campoContainer = campo(regs[0], CAMPO_CONT); out.campoData = campo(regs[0], CAMPO_DATA); }
    else if (j && typeof j === 'object') out.inicio = JSON.stringify(j).slice(0, 160);
  } catch (e) { Object.assign(out, { erro: motivoRede(e), ms: Date.now() - t0 }); }
  return out;
}
route('GET', '/api/carga/diag', async (req) => {
  const user = await requireUser(req);
  const d = await cargaDiag();
  if (!(await isGlobalAdmin(user))) delete d.inicio;
  return d;
});
// Ao digitar um motorista conhecido na coluna configurada, o servidor completa o CPF/CNPJ (vale também para quem não edita a coluna do CPF)
// Nome do motorista apagado: o CPF/CNPJ da mesma linha também é apagado (o contrário não: apagar o CPF não mexe no nome)
function lookupClears(room, p) {
  const list = [];
  for (const id in p.sheets || {}) {
    const e = p.sheets[id];
    const sh = room.data.sheets.find((s) => s.id === id);
    const lk = sh && sh.lookup;
    if (!e.cells || !lk || !lk.col || !lk.cpfCol) continue;
    for (const a in e.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      if (!m || Perms.colOf(a) !== lk.col) continue;
      const before = String(((sh.cells || {})[a] || {}).v || '').trim(), after = String((e.cells[a] || {}).v || '').trim();
      if (before && !after) list.push({ id, target: Perms.colName(lk.cpfCol) + m[2] });
    }
  }
  return list;
}
function lookupFills(room, p, clears) {
  const out = {};
  for (const c of clears || []) {
    const sh = room.data.sheets.find((s) => s.id === c.id);
    const cur = sh && (sh.cells || {})[c.target];
    if (!cur || cur.v === undefined || cur.v === null || cur.v === '') continue;
    const keep = Object.assign({}, cur); delete keep.v;
    (out[c.id] = out[c.id] || { cells: {} }).cells[c.target] = Object.keys(keep).length ? Object.assign(keep, { v: '' }) : null;
  }
  for (const id in p.sheets || {}) {
    const e = p.sheets[id];
    const sh = room.data.sheets.find((s) => s.id === id);
    const lk = sh && sh.lookup;
    if (!e.cells || !lk || !lk.col || !lk.cpfCol) continue;
    if (!drivers.items.length) { loadDrivers(); continue; }
    const byName = new Map(drivers.items.map((d) => [d.nome.toUpperCase(), d]));
    for (const a in e.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      // CPF/CNPJ apagado com o motorista preenchido: volta sozinho
      if (m && Perms.colOf(a) === lk.cpfCol && !String((e.cells[a] || {}).v || '').trim()) {
        const nameCell = (sh.cells || {})[Perms.colName(lk.col) + m[2]];
        const dn = nameCell && byName.get(String(nameCell.v || '').trim().toUpperCase());
        if (dn && dn.cpf) (out[id] = out[id] || { cells: {} }).cells[a] = Object.assign({}, (sh.cells || {})[a] || {}, { v: dn.cpf });
        continue;
      }
      if (!m || Perms.colOf(a) !== lk.col) continue;
      const d = e.cells[a] && byName.get(String(e.cells[a].v || '').trim().toUpperCase());
      if (!d || !d.cpf) continue;
      const target = Perms.colName(lk.cpfCol) + m[2];
      const cur = (sh.cells || {})[target];
      if (cur && String(cur.v || '') === d.cpf) continue;
      (out[id] = out[id] || { cells: {} }).cells[target] = Object.assign({}, cur || {}, { v: d.cpf });
    }
  }
  return Object.keys(out).length ? { sheets: out } : null;
}

// ---------- Arquivos do site ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/favicon.ico') pathname = '/assets/favicon.svg';
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  // sw.js e manifest.webmanifest: sem eles as notificações não ligam para quem abre a planilha pelo endereço do servidor
  const allowed = ['index.html', 'sw.js', 'manifest.webmanifest'].some((f) => file === path.join(ROOT, f)) || file.startsWith(path.join(ROOT, 'src') + path.sep) || file.startsWith(path.join(ROOT, 'assets') + path.sep);
  if (!allowed) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    try {
      const out = await r.fn(req, m.groups || {});
      if (out && out.__raw) { res.writeHead(200, { 'Content-Type': out.__raw.type, 'Cache-Control': out.__raw.cache || 'no-store' }); return res.end(out.__raw.body); }
      return sendJson(res, 200, out);
    }
    catch (e) {
      if (!e.status && isDbError(e)) { logDbError(url.pathname, e); return sendJson(res, 503, { error: DB_DOWN_MSG }); }
      if (!e.status) console.error(e);
      return sendJson(res, e.status || 500, { error: e.status ? e.message : 'Erro no servidor. Tente novamente.' });
    }
  }
  sendJson(res, 404, { error: 'Rota não encontrada.' });
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const ws = accept(req, socket, head);
  if (ws) onConnection(ws, clientIp(req));
});
// mantém as conexões vivas (proxies costumam encerrar conexões ociosas)
setInterval(() => {
  for (const room of rooms.values()) for (const c of room.clients) { if (!c.ws.alive) c.ws.close(1001, 'sem resposta'); else c.ws.ping(); }
}, 25000);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // grava o que estiver pendente antes de desligar (novas publicações reiniciam o servidor)
  const t = setTimeout(() => process.exit(0), 20000);
  for (const room of rooms.values()) { try { if (room.saving) await room.saving; room.saving = null; await saveRoom(room); } catch (e) { /* tenta as outras */ } }
  if (store.flushHistory) await store.flushHistory().catch((e) => console.error('Falha ao gravar histórico', e.message));
  clearTimeout(t);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Descreve o erro de conexão sem expor a senha
function describeDbError(e) {
  const parts = [];
  if (e.code) parts.push('código ' + e.code);
  if (e.message) parts.push(e.message);
  for (const sub of e.errors || []) parts.push((sub.code ? sub.code + ' ' : '') + (sub.message || ''));
  if (!parts.length) parts.push(String(e));
  try {
    const u = new URL(process.env.DATABASE_URL || '');
    parts.push(`(servidor ${u.hostname}${u.port ? ':' + u.port : ''}, banco ${u.pathname.slice(1)}, usuário ${u.username})`);
  } catch (err) { parts.push('(DATABASE_URL não é um endereço válido: confira se colou o "Internal Database URL" inteiro)'); }
  return parts.join(' | ');
}

// MIGRAR_DE: endereço de um banco antigo; na subida, copia tudo dele para o banco atual (uma vez só)
async function migrarSePedido() {
  const de = process.env.MIGRAR_DE;
  if (!de || !process.env.DATABASE_URL) return;
  try { await require('./migrar.js').migrar(de, process.env.DATABASE_URL); }
  catch (e) { console.error('Migração NÃO foi feita (o banco atual ficou como estava): ' + describeDbError(e)); }
}

(async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await store.init(); await migrarSePedido(); await loadColors(); if (!process.env.DSS_DIARIO_OFF) setTimeout(() => { loadDrivers().catch(() => {}); }, 3000); break; }
    catch (e) {
      // o banco gratuito às vezes demora a acordar: até 12 tentativas, esperando até 15 s entre elas
      console.error(`Não foi possível iniciar o banco de dados (tentativa ${attempt}/12): ${describeDbError(e)}`);
      if (attempt >= 12) process.exit(1);
      await new Promise((r) => setTimeout(r, Math.min(15000, attempt * 3000)));
    }
  }
  server.listen(PORT, () => console.log(`Planilhas no ar na porta ${PORT} (armazenamento: ${store.kind})`));
})();

module.exports = { server };
