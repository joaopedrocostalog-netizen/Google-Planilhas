// Servidor do Planilhas: site, contas, planilhas na nuvem, compartilhamento por setores e edição em tempo real.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { accept } = require('./ws');
const createStore = require('./store');
const Patch = require('../src/patch.js');
const Perms = require('../src/perms.js');
const mail = require('./mail.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://joaopedrocostalog-netizen.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const store = createStore();
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
  return room;
}
const permDoc = (room) => ({ ownerId: room.ownerId, acl: room.acl, data: room.data });
// Gravação no banco: no máximo a cada ~10 s por planilha (planilhas grandes pesam no banco gratuito),
// uma gravação por vez e sempre a versão mais nova. Ao sair o último usuário ou ao desligar, grava na hora.
const SAVE_EVERY = 10000;
function scheduleSave(room) {
  room.dirty = true;
  if (room.timer || room.saving) return;
  const wait = Math.max(2500, SAVE_EVERY - (Date.now() - (room.lastSave || 0)));
  room.timer = setTimeout(() => { room.timer = null; saveRoom(room); }, wait);
}
async function saveRoom(room) {
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
// uma versão automática a cada 30 min de edição (e sempre antes de restaurar uma versão antiga)
const VERSION_EVERY = Number(process.env.VERSION_EVERY_MS || 30 * 60 * 1000);
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
function sendInit(c) {
  const room = c.room;
  c.ws.send({
    type: 'init', doc: Perms.filterDoc(room.data, c.perms), version: room.version, perms: c.perms,
    me: Object.assign(publicUser(c.user), { cid: c.cid }),
    peers: [...room.clients].filter((x) => x !== c && x.user && seesPeer(c, x)).map(peerInfo),
  });
}
function broadcast(room, except, msg) { for (const c of room.clients) if (c !== except) c.ws.send(msg); }

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
  c.user = user; c.room = room; c.perms = perms;
  room.clients.add(c);
  sendInit(c);
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
  Patch.apply(room.data, p);
  room.version++;
  if (hist.length) store.addHistory(room.id, Object.assign({}, c.user, { ip: c.ip }), hist).catch((e) => console.error('Falha ao gravar histórico', e.message));
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
  for (const o of room.clients) {
    if (o === c) continue;
    if (reinit.has(o)) { sendInit(o); continue; }
    const fp = Perms.filterPatch(p, o.perms, room.data);
    if (fp) o.ws.send({ type: 'patch', patch: fp, version: room.version, by: { cid: c.cid, name: c.user.name } });
  }
  if (accessChanged && !c.perms.admin) sendInit(c);
  // completa o CPF/CNPJ do motorista (DSS) e avisa todos, inclusive quem digitou
  const fill = lookupFills(room, p, clears);
  if (fill) {
    Patch.apply(room.data, fill);
    room.version++;
    for (const o of room.clients) { const fp = Perms.filterPatch(fill, o.perms, room.data); if (fp) o.ws.send({ type: 'patch', patch: fp, version: room.version, by: { cid: 'dss', name: 'DSS' } }); }
  }
  scheduleSave(room);
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
  return { with: await userBrief(p.uid), messages: list.map(pubMsg) };
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
  const out = Object.assign(pubMsg(m), { fromUser: await userBrief(user.id) });
  deliver([to, user.id], { type: 'dm', msg: out });
  return out;
});

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
  try { th = await mail.findThread(cfg, ref, b.mailbox ? String(b.mailbox) : 'INBOX'); }
  catch (e) { throw httpError(502, 'Não foi possível falar com o servidor de e-mail: ' + e.message); }
  if (!th) return { achou: false, ref };
  return { achou: true, ref, thread: th, destinatarios: replyAllOf(th, cfg.from) };
});
const MAX_ANEXOS = Number(process.env.MAIL_MAX_ANEXOS || 20 * 1024 * 1024);
route('POST', '/api/docs/:id/mail/send', async (req, p) => {
  const b = await readBody(req, MAX_ANEXOS + 2 * 1024 * 1024);
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
  const total = anexos.reduce((n, a) => n + a.data.length, 0);
  if (total > MAX_ANEXOS) throw httpError(413, 'Os anexos somam mais do que o limite permitido.');
  let r;
  try {
    r = await mail.send(mail.config(), {
      to, cc, subject,
      html: String(b.html || ''), text: String(b.text || ''),
      inReplyTo: String(b.inReplyTo || '').trim() || null,
      references: String(b.references || '').trim() || null,
      attachments: anexos,
    });
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
async function loadDrivers(force) {
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
      drivers = { items: [...seen.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), expires: Date.now() + 15 * 60e3, error: null, loading: null, at: new Date().toISOString() };
      console.log(`[DSS] motoristas carregados: ${drivers.items.length}`);
    } catch (e) {
      drivers = Object.assign({}, drivers, { expires: Date.now() + 60e3, error: e.message || String(e), status: e.status || 502, loading: null });
      console.error('[DSS] motoristas:', drivers.error);
    }
    return drivers;
  })();
  return drivers.loading;
}
route('GET', '/api/dss/motoristas', async (req) => {
  await requireUser(req);
  const d = await loadDrivers(new URL(req.url, 'http://x').searchParams.get('atualizar') === '1');
  if (!d.items.length && d.error) throw httpError(d.status || 502, d.error);
  return { motoristas: d.items, atualizado: d.at || null, aviso: d.error || null };
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/favicon.ico') pathname = '/assets/favicon.svg';
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  const allowed = file === path.join(ROOT, 'index.html') || file.startsWith(path.join(ROOT, 'src') + path.sep) || file.startsWith(path.join(ROOT, 'assets') + path.sep);
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

(async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await store.init(); await loadColors(); break; }
    catch (e) {
      console.error(`Não foi possível iniciar o banco de dados (tentativa ${attempt}/6): ${describeDbError(e)}`);
      if (attempt >= 6) process.exit(1);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  server.listen(PORT, () => console.log(`Planilhas no ar na porta ${PORT} (armazenamento: ${store.kind})`));
})();

module.exports = { server };
