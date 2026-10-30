// Armazenamento: Postgres (quando DATABASE_URL existe) ou memória com arquivo JSON opcional (desenvolvimento e testes).
'use strict';
const fs = require('fs');

function memoryStore(file) {
  let db = { users: {}, sessions: {}, docs: {} };
  if (file && fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* começa vazio */ } }
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
    async createSession(hash, userId) { db.sessions[hash] = { user_id: userId, created_at: Date.now() }; persist(); },
    async getSession(hash) { return clone(db.sessions[hash]); },
    async deleteSession(hash) { delete db.sessions[hash]; persist(); },
    async listDocsFor(user) {
      return Object.values(db.docs)
        .filter((d) => d.owner_id === user.id || (d.acl.members || []).some((m) => m.email === user.email))
        .map((d) => ({ id: d.id, title: d.title, owner_id: d.owner_id, acl: clone(d.acl), updated_at: d.updated_at }));
    },
    async getDoc(id) { return clone(db.docs[id]); },
    async createDoc(d) { db.docs[d.id] = Object.assign({ version: 0, updated_at: new Date().toISOString() }, clone(d)); persist(); },
    async saveDoc(id, { title, data, version }) { const d = db.docs[id]; if (!d) return; d.title = title; d.data = clone(data); d.version = version; d.updated_at = new Date().toISOString(); persist(); },
    async saveAcl(id, acl) { if (db.docs[id]) { db.docs[id].acl = clone(acl); persist(); } },
    async deleteDoc(id) { delete db.docs[id]; persist(); },
  };
}

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
    connectionString: url, ssl: noSsl ? false : { rejectUnauthorized: false }, max: 8,
    options: schema ? `-c search_path=${schema}` : undefined,
  });
  const q = (text, params) => pool.query(text, params);
  const row = async (text, params) => { const r = await q(text, params); return r.rows[0] || null; };
  return {
    kind: 'postgres' + (schema ? ` (schema ${schema})` : ''),
    async init() {
      if (schema) await q(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await q(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
        data JSONB NOT NULL, acl JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner_id)');
      await q("CREATE INDEX IF NOT EXISTS docs_members ON docs USING GIN ((acl->'members'))");
    },
    getUserByEmail: (email) => row('SELECT * FROM users WHERE email = $1', [email]),
    getUserById: (id) => row('SELECT * FROM users WHERE id = $1', [id]),
    async createUser(u) { await q('INSERT INTO users (id, email, name, pass) VALUES ($1, $2, $3, $4)', [u.id, u.email, u.name, u.pass]); return u; },
    async updateUser(id, f) { if (f.name) await q('UPDATE users SET name = $2 WHERE id = $1', [id, f.name]); if (f.pass) await q('UPDATE users SET pass = $2 WHERE id = $1', [id, f.pass]); },
    async createSession(hash, userId) { await q('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [hash, userId]); },
    async getSession(hash) { const r = await row('SELECT user_id, extract(epoch from created_at) * 1000 AS created_at FROM sessions WHERE token = $1', [hash]); return r ? { user_id: r.user_id, created_at: Number(r.created_at) } : null; },
    async deleteSession(hash) { await q('DELETE FROM sessions WHERE token = $1', [hash]); },
    async listDocsFor(user) {
      const r = await q(`SELECT id, title, owner_id, acl, updated_at FROM docs
        WHERE owner_id = $1 OR acl->'members' @> $2::jsonb ORDER BY updated_at DESC LIMIT 500`, [user.id, JSON.stringify([{ email: user.email }])]);
      return r.rows;
    },
    getDoc: (id) => row('SELECT * FROM docs WHERE id = $1', [id]),
    async createDoc(d) { await q('INSERT INTO docs (id, title, owner_id, data, acl, version) VALUES ($1, $2, $3, $4, $5, 0)', [d.id, d.title, d.owner_id, JSON.stringify(d.data), JSON.stringify(d.acl)]); },
    async saveDoc(id, { title, data, version }) { await q('UPDATE docs SET title = $2, data = $3, version = $4, updated_at = now() WHERE id = $1', [id, title, JSON.stringify(data), version]); },
    async saveAcl(id, acl) { await q('UPDATE docs SET acl = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(acl)]); },
    async deleteDoc(id) { await q('DELETE FROM docs WHERE id = $1', [id]); },
  };
}

module.exports = function createStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return memoryStore(process.env.DATA_FILE || null);
};
