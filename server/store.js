// Armazenamento: Postgres (quando DATABASE_URL existe) ou memória com arquivo JSON opcional (desenvolvimento e testes).
'use strict';
const fs = require('fs');

function memoryStore(file) {
  let db = { users: {}, sessions: {}, docs: {}, history: {}, messages: [], msgSeq: 0 };
  if (file && fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* começa vazio */ } }
  db.history = db.history || {};
  db.messages = db.messages || []; db.msgSeq = db.msgSeq || 0;
  let timer = null;
  const persist = () => {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(() => { try { fs.writeFileSync(file, JSON.stringify(db)); } catch (e) { console.error('Falha ao gravar', e.message); } }, 300);
  };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    kind: file ? 'arquivo' : 'memória',
    async init() {},
    async getUserByEmail(email) { return clone(Object.values(db.users).find((u) => u.email === email)); },
    async getUserById(id) { return clone(db.users[id]); },
    async createUser(u) { db.users[u.id] = Object.assign({ created_at: new Date().toISOString() }, u); persist(); return clone(u); },
    async updateUser(id, fields) { Object.assign(db.users[id], fields); persist(); },
    async savePrefs(id, prefs) { if (db.users[id]) { db.users[id].prefs = clone(prefs); persist(); } },
    async listUsers() { return Object.values(db.users).map((u) => ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at })); },
    async userColors() { return Object.values(db.users).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((u) => ({ id: u.id, color: u.color || null, avatar_v: u.avatar_v || null })); },
    async setAvatar(id, data, v) { if (db.users[id]) { db.users[id].avatar = data; db.users[id].avatar_v = data ? v : null; persist(); } },
    async getAvatar(id) { const u = db.users[id]; return u && u.avatar ? { avatar: u.avatar, avatar_v: u.avatar_v } : null; },
    async setUserColor(id, color) { if (db.users[id]) { db.users[id].color = color; persist(); } },
    // mensagens diretas entre pessoas
    async addMessage(m) { const x = Object.assign({ id: ++db.msgSeq, at: new Date().toISOString(), read_at: null }, clone(m)); db.messages.push(x); if (db.messages.length > 50000) db.messages.splice(0, db.messages.length - 50000); persist(); return clone(x); },
    async conversation(a, b, limit) { return db.messages.filter((m) => (m.from_id === a && m.to_id === b) || (m.from_id === b && m.to_id === a)).slice(-limit).map(clone); },
    async recentMessages(userId, limit) { return db.messages.filter((m) => m.from_id === userId || m.to_id === userId).slice(-limit).reverse().map(clone); },
    async markRead(userId, fromId) { const at = new Date().toISOString(); let n = 0; for (const m of db.messages) if (m.to_id === userId && m.from_id === fromId && !m.read_at) { m.read_at = at; n++; } if (n) persist(); return n; },
    async markRefDone(docId, req, done) { const out = []; for (const m of db.messages) if (m.doc_id === docId && m.ref && m.ref.req === req && !m.ref.done) { m.ref.done = clone(done); out.push({ id: m.id, from_id: m.from_id, to_id: m.to_id }); } if (out.length) persist(); return out; },
    async hasMessage(fromId, toId) { return db.messages.some((m) => m.from_id === fromId && m.to_id === toId); },
    async allDocAcls() { return Object.values(db.docs).map((d) => ({ owner_id: d.owner_id, acl: clone(d.acl) })); },
    async createSession(hash, userId) { db.sessions[hash] = { user_id: userId, created_at: Date.now() }; persist(); },
    async getSession(hash) { return clone(db.sessions[hash]); },
    async deleteSession(hash) { delete db.sessions[hash]; persist(); },
    async deleteUserSessions(userId) { let n = 0; for (const k of Object.keys(db.sessions)) if (db.sessions[k].user_id === userId) { delete db.sessions[k]; n++; } persist(); return n; },
    async listDocsFor(user) {
      return Object.values(db.docs)
        .filter((d) => d.owner_id === user.id || (d.acl.members || []).some((m) => m.email === user.email))
        .map((d) => ({ id: d.id, title: d.title, owner_id: d.owner_id, acl: clone(d.acl), updated_at: d.updated_at }));
    },
    async getDoc(id) { return clone(db.docs[id]); },
    async createDoc(d) { db.docs[d.id] = Object.assign({ version: 0, updated_at: new Date().toISOString() }, clone(d)); persist(); },
    async saveDoc(id, { title, data, version }) { const d = db.docs[id]; if (!d) return; d.title = title; d.data = clone(data); d.version = version; d.updated_at = new Date().toISOString(); persist(); },
    async saveAcl(id, acl) { if (db.docs[id]) { db.docs[id].acl = clone(acl); persist(); } },
    async deleteDoc(id) { delete db.docs[id]; delete db.history[id]; persist(); },
    // histórico de edições por célula
    async addHistory(docId, user, entries) {
      const list = db.history[docId] || (db.history[docId] = []);
      const at = new Date().toISOString();
      for (const e of entries) list.push({ sheet_id: e.s, addr: e.a, user_id: user.id, user_name: user.name, ip: user.ip || null, at, before: e.b, after: e.f });
      if (list.length > 20000) list.splice(0, list.length - 20000);
      persist();
    },
    // versões (backups) da planilha inteira
    async addVersion(docId, v) {
      db.versions = db.versions || {};
      const list = db.versions[docId] || (db.versions[docId] = []);
      const x = { id: ++db.verSeq || (db.verSeq = 1), at: new Date().toISOString(), name: v.name || '', by_name: v.by_name || '', auto: !!v.auto, data: clone(v.data) };
      db.verSeq = x.id;
      list.push(x);
      const autos = list.filter((y) => y.auto && !y.name);
      if (autos.length > 50) { const drop = new Set(autos.slice(0, autos.length - 50).map((y) => y.id)); db.versions[docId] = list.filter((y) => !drop.has(y.id)); }
      persist();
      return { id: x.id, at: x.at };
    },
    async listVersions(docId) { return ((db.versions || {})[docId] || []).slice().reverse().map((v) => ({ id: v.id, at: v.at, name: v.name, by_name: v.by_name, auto: v.auto })); },
    async getVersion(docId, id) { const v = ((db.versions || {})[docId] || []).find((x) => x.id === Number(id)); return v ? clone(v) : null; },
    async renameVersion(docId, id, name) { const v = ((db.versions || {})[docId] || []).find((x) => x.id === Number(id)); if (v) { v.name = name; persist(); } },
    async getHistory(docId, sheetId, addr, limit) {
      return (db.history[docId] || []).filter((h) => h.sheet_id === sheetId && h.addr === addr).slice(-limit).reverse().map(clone);
    },
  };
}

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);

function pgStore(url) {
  const { Pool } = require('pg');
  // URL interna da Render (host sem pontos) e localhost dispensam SSL; a externa exige
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { /* mantém vazio */ }
  const noSsl = process.env.PGSSL === '0' || !host.includes('.') || host === '127.0.0.1';
  // PGSCHEMA: espaço separado dentro de um banco compartilhado com outros sistemas
  const schema = process.env.PGSCHEMA || '';
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('PGSCHEMA inválido: ' + schema);
  const pool = new Pool({
    connectionString: url, ssl: noSsl ? false : { rejectUnauthorized: false }, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, keepAlive: true,
    options: schema ? `-c search_path=${schema}` : undefined,
  });
  pool.on('error', (e) => console.error('Erro na conexão com o banco:', e.code || '', e.message));
  const q = (text, params) => pool.query(text, params);
  const row = async (text, params) => { const r = await q(text, params); return r.rows[0] || null; };
  return {
    kind: 'postgres' + (schema ? ` (schema ${schema})` : ''),
    async init() {
      if (schema) await q(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await q(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs JSONB');
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS color TEXT');
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT');
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_v BIGINT');
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
        data JSONB NOT NULL, acl JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner_id)');
      await q("CREATE INDEX IF NOT EXISTS docs_members ON docs USING GIN ((acl->'members'))");
      // conteúdo da planilha compactado (gzip): o banco não precisa interpretar um JSON enorme a cada gravação
      await q('ALTER TABLE docs ADD COLUMN IF NOT EXISTS data_gz BYTEA');
      await q(`CREATE TABLE IF NOT EXISTS cell_history (
        id BIGSERIAL PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        sheet_id TEXT NOT NULL, addr TEXT NOT NULL, user_id TEXT, user_name TEXT,
        at TIMESTAMPTZ NOT NULL DEFAULT now(), before TEXT, after TEXT)`);
      await q('CREATE INDEX IF NOT EXISTS cell_history_cell ON cell_history(doc_id, sheet_id, addr, id DESC)');
      await q('ALTER TABLE cell_history ADD COLUMN IF NOT EXISTS ip TEXT');
      await q(`CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, doc_id TEXT,
        text TEXT NOT NULL, ref JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ)`);
      await q(`CREATE TABLE IF NOT EXISTS doc_versions (
        id BIGSERIAL PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        at TIMESTAMPTZ NOT NULL DEFAULT now(), name TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '', auto BOOLEAN NOT NULL DEFAULT false, data_gz BYTEA NOT NULL)`);
      await q('CREATE INDEX IF NOT EXISTS doc_versions_doc ON doc_versions(doc_id, id DESC)');
      await q('CREATE INDEX IF NOT EXISTS messages_to ON messages(to_id, id DESC)');
      await q('CREATE INDEX IF NOT EXISTS messages_from ON messages(from_id, id DESC)');
    },
    getUserByEmail: (email) => row('SELECT * FROM users WHERE email = $1', [email]),
    getUserById: (id) => row('SELECT * FROM users WHERE id = $1', [id]),
    async createUser(u) { await q('INSERT INTO users (id, email, name, pass) VALUES ($1, $2, $3, $4)', [u.id, u.email, u.name, u.pass]); return u; },
    async updateUser(id, f) { if (f.name) await q('UPDATE users SET name = $2 WHERE id = $1', [id, f.name]); if (f.pass) await q('UPDATE users SET pass = $2 WHERE id = $1', [id, f.pass]); },
    async listUsers() { const r = await q('SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 1000'); return r.rows; },
    async allDocAcls() { const r = await q('SELECT owner_id, acl FROM docs'); return r.rows; },
    async userColors() { const r = await q('SELECT id, color, avatar_v FROM users ORDER BY created_at, id'); return r.rows; },
    async setAvatar(id, data, v) { await q('UPDATE users SET avatar = $2, avatar_v = $3 WHERE id = $1', [id, data, data ? v : null]); },
    async getAvatar(id) { return row('SELECT avatar, avatar_v FROM users WHERE id = $1 AND avatar IS NOT NULL', [id]); },
    async setUserColor(id, color) { await q('UPDATE users SET color = $2 WHERE id = $1', [id, color]); },
    async addMessage(m) {
      const r = await q('INSERT INTO messages (from_id, to_id, doc_id, text, ref) VALUES ($1, $2, $3, $4, $5) RETURNING id, at', [m.from_id, m.to_id, m.doc_id || null, m.text, m.ref ? JSON.stringify(m.ref) : null]);
      return Object.assign({}, m, { id: Number(r.rows[0].id), at: r.rows[0].at, read_at: null });
    },
    async conversation(a, b, limit) {
      const r = await q(`SELECT * FROM (SELECT * FROM messages WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) ORDER BY id DESC LIMIT $3) x ORDER BY id`, [a, b, limit]);
      return r.rows.map((m) => Object.assign(m, { id: Number(m.id) }));
    },
    async recentMessages(userId, limit) {
      const r = await q('SELECT * FROM messages WHERE from_id = $1 OR to_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit]);
      return r.rows.map((m) => Object.assign(m, { id: Number(m.id) }));
    },
    async markRead(userId, fromId) { const r = await q('UPDATE messages SET read_at = now() WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL', [userId, fromId]); return r.rowCount; },
    async markRefDone(docId, req, done) {
      const r = await q(`UPDATE messages SET ref = jsonb_set(ref, '{done}', $3::jsonb) WHERE doc_id = $1 AND ref->>'req' = $2 AND NOT (ref ? 'done') RETURNING id, from_id, to_id`, [docId, req, JSON.stringify(done)]);
      return r.rows.map((m) => ({ id: Number(m.id), from_id: m.from_id, to_id: m.to_id }));
    },
    async hasMessage(fromId, toId) { const r = await q('SELECT 1 FROM messages WHERE from_id = $1 AND to_id = $2 LIMIT 1', [fromId, toId]); return r.rows.length > 0; },
    async savePrefs(id, prefs) { await q('UPDATE users SET prefs = $2 WHERE id = $1', [id, JSON.stringify(prefs)]); },
    async createSession(hash, userId) { await q('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [hash, userId]); },
    async getSession(hash) { const r = await row('SELECT user_id, extract(epoch from created_at) * 1000 AS created_at FROM sessions WHERE token = $1', [hash]); return r ? { user_id: r.user_id, created_at: Number(r.created_at) } : null; },
    async deleteSession(hash) { await q('DELETE FROM sessions WHERE token = $1', [hash]); },
    async deleteUserSessions(userId) { const r = await q('DELETE FROM sessions WHERE user_id = $1', [userId]); return r.rowCount || 0; },
    async listDocsFor(user) {
      const r = await q(`SELECT id, title, owner_id, acl, updated_at FROM docs
        WHERE owner_id = $1 OR acl->'members' @> $2::jsonb ORDER BY updated_at DESC LIMIT 500`, [user.id, JSON.stringify([{ email: user.email }])]);
      return r.rows;
    },
    async getDoc(id) {
      const r = await row('SELECT id, title, owner_id, acl, version, created_at, updated_at, data_gz, CASE WHEN data_gz IS NULL THEN data END AS data FROM docs WHERE id = $1', [id]);
      if (r && r.data_gz) { r.data = JSON.parse((await gunzip(r.data_gz)).toString('utf8')); }
      if (r) delete r.data_gz;
      return r;
    },
    async createDoc(d) { await q("INSERT INTO docs (id, title, owner_id, data, data_gz, acl, version) VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, 0)", [d.id, d.title, d.owner_id, await gzip(JSON.stringify(d.data)), JSON.stringify(d.acl)]); },
    async saveDoc(id, { title, data, version }) { await q("UPDATE docs SET title = $2, data_gz = $3, data = '{}'::jsonb, version = $4, updated_at = now() WHERE id = $1", [id, title, await gzip(JSON.stringify(data)), version]); },
    async saveAcl(id, acl) { await q('UPDATE docs SET acl = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(acl)]); },
    async deleteDoc(id) { await q('DELETE FROM docs WHERE id = $1', [id]); },
    async addHistory(docId, user, entries) {
      await q(`INSERT INTO cell_history (doc_id, sheet_id, addr, user_id, user_name, ip, before, after)
        SELECT $1, x.s, x.a, $2, $3, $5, x.b, x.f FROM jsonb_to_recordset($4::jsonb) AS x(s text, a text, b text, f text)`,
      [docId, user.id, user.name, JSON.stringify(entries), user.ip || null]);
    },
    async addVersion(docId, v) {
      const r = await q('INSERT INTO doc_versions (doc_id, name, by_name, auto, data_gz) VALUES ($1, $2, $3, $4, $5) RETURNING id, at', [docId, v.name || '', v.by_name || '', !!v.auto, await gzip(JSON.stringify(v.data))]);
      // guarda todas as versões com nome e as 50 automáticas mais recentes
      await q(`DELETE FROM doc_versions WHERE doc_id = $1 AND auto AND name = '' AND id NOT IN (SELECT id FROM doc_versions WHERE doc_id = $1 AND auto AND name = '' ORDER BY id DESC LIMIT 50)`, [docId]);
      return { id: Number(r.rows[0].id), at: r.rows[0].at };
    },
    async listVersions(docId) {
      const r = await q('SELECT id, at, name, by_name, auto FROM doc_versions WHERE doc_id = $1 ORDER BY id DESC LIMIT 200', [docId]);
      return r.rows.map((v) => Object.assign(v, { id: Number(v.id) }));
    },
    async getVersion(docId, id) {
      const v = await row('SELECT id, at, name, by_name, auto, data_gz FROM doc_versions WHERE doc_id = $1 AND id = $2', [docId, Number(id)]);
      if (!v) return null;
      v.data = JSON.parse((await gunzip(v.data_gz)).toString('utf8'));
      delete v.data_gz; v.id = Number(v.id);
      return v;
    },
    async renameVersion(docId, id, name) { await q('UPDATE doc_versions SET name = $3 WHERE doc_id = $1 AND id = $2', [docId, Number(id), name]); },
    async getHistory(docId, sheetId, addr, limit) {
      const r = await q('SELECT user_id, user_name, ip, at, before, after FROM cell_history WHERE doc_id = $1 AND sheet_id = $2 AND addr = $3 ORDER BY id DESC LIMIT $4', [docId, sheetId, addr, limit]);
      return r.rows;
    },
  };
}

module.exports = function createStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return memoryStore(process.env.DATA_FILE || null);
};
