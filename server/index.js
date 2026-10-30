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
const COLORS = ['#e30613', '#1a73e8', '#188038', '#9334e6', '#e37400', '#d01884', '#12b5cb', '#5f6368', '#b06000', '#0b8043'];
const colorFor = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, color: colorFor(u.id) });
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
async function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const s = await store.getSession(sha(token));
  if (!s) return null;
  if (Date.now() - s.created_at > SESSION_DAYS * 864e5) { await store.deleteSession(sha(token)); return null; }
  return store.getUserById(s.user_id);
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
function scheduleSave(room) {
  room.dirty = true;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => saveRoom(room), 1500);
}
async function saveRoom(room) {
  if (!room.dirty) return;
  room.dirty = false;
  try { await store.saveDoc(room.id, { title: String(room.data.title || 'Planilha sem título').slice(0, 200), data: room.data, version: room.version }); }
  catch (e) {
    room.dirty = true;
    console.error('Falha ao salvar', room.id, e.message);
    clearTimeout(room.timer);
    room.timer = setTimeout(() => saveRoom(room), 5000);
  }
}
// quem vê quem: administradores veem todos; os demais só veem pessoas do mesmo setor
const seesPeer = (viewer, peer) => !!(viewer.perms && peer.perms) && (viewer.perms.admin || (!peer.perms.admin && viewer.perms.sectorId === peer.perms.sectorId));
const peerInfo = (c) => ({ cid: c.cid, name: c.user.name, email: c.user.email, color: colorFor(c.user.id), presence: c.presence });
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
    if (e.props && ('rows' in e.props || 'cols' in e.props)) continue;
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
  Patch.apply(room.data, p);
  room.version++;
  if (hist.length) store.addHistory(room.id, c.user, hist).catch((e) => console.error('Falha ao gravar histórico', e.message));
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
    const fp = Perms.filterPatch(p, o.perms);
    if (fp) o.ws.send({ type: 'patch', patch: fp, version: room.version, by: { cid: c.cid, name: c.user.name } });
  }
  if (accessChanged && !c.perms.admin) sendInit(c);
  // completa o CPF/CNPJ do motorista (DSS) e avisa todos, inclusive quem digitou
  const fill = lookupFills(room, p);
  if (fill) {
    Patch.apply(room.data, fill);
    room.version++;
    for (const o of room.clients) { const fp = Perms.filterPatch(fill, o.perms); if (fp) o.ws.send({ type: 'patch', patch: fp, version: room.version, by: { cid: 'dss', name: 'DSS' } }); }
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
function onConnection(ws) {
  const c = { ws, cid: uid(6), user: null, room: null, perms: null, presence: null };
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
route('POST', '/api/logout', async (req) => { const t = tokenOf(req); if (t) await store.deleteSession(sha(t)); return { ok: true }; });
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
  await store.savePrefs(user.id, prefs);
  return prefs;
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
  const rows = await store.getHistory(room.id, sheet, addr, 100);
  return rows.map((h) => ({ at: h.at, name: h.user_name || 'Alguém', color: colorFor(h.user_id || ''), before: h.before, after: h.after }));
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
        const doc = pick(it, ['cnpj_cpf', 'cpf_cnpj', 'cpf', 'cnpj', 'motorista_cpf']);
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
function lookupFills(room, p) {
  const out = {};
  for (const id in p.sheets || {}) {
    const e = p.sheets[id];
    const sh = room.data.sheets.find((s) => s.id === id);
    const lk = sh && sh.lookup;
    if (!e.cells || !lk || !lk.col || !lk.cpfCol) continue;
    if (!drivers.items.length) { loadDrivers(); continue; }
    const byName = new Map(drivers.items.map((d) => [d.nome.toUpperCase(), d]));
    for (const a in e.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
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
    try { return sendJson(res, 200, await r.fn(req, m.groups || {})); }
    catch (e) {
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
  if (ws) onConnection(ws);
});
// mantém as conexões vivas (proxies costumam encerrar conexões ociosas)
setInterval(() => {
  for (const room of rooms.values()) for (const c of room.clients) { if (!c.ws.alive) c.ws.close(1001, 'sem resposta'); else c.ws.ping(); }
}, 25000);

async function shutdown() {
  for (const room of rooms.values()) await saveRoom(room);
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
    try { await store.init(); break; }
    catch (e) {
      console.error(`Não foi possível iniciar o banco de dados (tentativa ${attempt}/6): ${describeDbError(e)}`);
      if (attempt >= 6) process.exit(1);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  server.listen(PORT, () => console.log(`Planilhas no ar na porta ${PORT} (armazenamento: ${store.kind})`));
})();

module.exports = { server };
