// Alterações (patches) de documento: calcula o que mudou entre duas versões e aplica a mudança.
// Usado no navegador (sincronização e desfazer) e no servidor (Node.js).
(function (root) {
  'use strict';
  const J = (x) => JSON.stringify(x === undefined ? null : x);
  const clone = (x) => (x === undefined || x === null ? null : JSON.parse(JSON.stringify(x)));
  const strip = (s) => { const o = {}; for (const k in s) if (k[0] !== '_') o[k] = s[k]; return o; };

  // Retorna [alteração, alteração inversa] entre B (antes) e A (depois); null quando nada mudou.
  // Documento: { title, names, sheets: [{ id, cells: { A1: {...} }, ...propriedades }] }
  function diffPair(B, A) {
    const f = { sheets: {} }, r = { sheets: {} };
    let changed = false;
    if ((B.title || '') !== (A.title || '')) { f.title = A.title; r.title = B.title; changed = true; }
    if (J(B.names || {}) !== J(A.names || {})) { f.names = clone(A.names || {}); r.names = clone(B.names || {}); changed = true; }
    const bo = B.sheets.map((s) => s.id), ao = A.sheets.map((s) => s.id);
    if (J(bo) !== J(ao)) { f.order = ao; r.order = bo; changed = true; }
    const bm = new Map(B.sheets.map((s) => [s.id, s])), am = new Map(A.sheets.map((s) => [s.id, s]));
    for (const [id, s] of am) {
      const o = bm.get(id);
      if (!o) { f.sheets[id] = { created: clone(strip(s)) }; r.sheets[id] = { removed: true }; changed = true; continue; }
      const fc = {}, rc = {}, fp = {}, rp = {};
      let nc = 0, np = 0;
      const bc = o.cells || {}, ac = s.cells || {};
      for (const a in ac) if (J(ac[a]) !== J(bc[a])) { fc[a] = clone(ac[a]); rc[a] = a in bc ? clone(bc[a]) : null; nc++; }
      for (const a in bc) if (!(a in ac)) { fc[a] = null; rc[a] = clone(bc[a]); nc++; }
      const keys = new Set(Object.keys(o).concat(Object.keys(s)));
      for (const k of keys) {
        if (k === 'cells' || k[0] === '_') continue;
        if (J(o[k]) !== J(s[k])) { fp[k] = clone(s[k]); rp[k] = clone(o[k]); np++; }
      }
      if (nc || np) {
        f.sheets[id] = {}; r.sheets[id] = {};
        if (nc) { f.sheets[id].cells = fc; r.sheets[id].cells = rc; }
        if (np) { f.sheets[id].props = fp; r.sheets[id].props = rp; }
        changed = true;
      }
    }
    for (const [id, o] of bm) if (!am.has(id)) { f.sheets[id] = { removed: true }; r.sheets[id] = { created: clone(strip(o)) }; changed = true; }
    return changed ? [f, r] : [null, null];
  }

  // Aplica uma alteração ao documento (modifica no lugar). norm: função opcional para normalizar páginas criadas.
  function apply(doc, p, norm) {
    if (!p) return doc;
    if (p.title !== undefined && p.title !== null) doc.title = p.title;
    if (p.names !== undefined) doc.names = clone(p.names) || {};
    for (const id in p.sheets || {}) {
      const e = p.sheets[id];
      const idx = doc.sheets.findIndex((s) => s.id === id);
      if (e.removed) { if (idx >= 0) doc.sheets.splice(idx, 1); continue; }
      if (e.created) {
        const s = norm ? norm(clone(e.created)) : clone(e.created);
        if (idx >= 0) doc.sheets[idx] = s; else doc.sheets.push(s);
        continue;
      }
      if (idx < 0) continue;
      const s = doc.sheets[idx];
      if (e.cells) {
        s.cells = s.cells || {};
        for (const a in e.cells) { if (e.cells[a] === null) delete s.cells[a]; else s.cells[a] = clone(e.cells[a]); }
      }
      if (e.props) for (const k in e.props) { if (e.props[k] === null) delete s[k]; else s[k] = clone(e.props[k]); }
      if (norm) doc.sheets[idx] = norm(s);
    }
    if (p.order) {
      const m = new Map(doc.sheets.map((s) => [s.id, s]));
      const out = [];
      for (const id of p.order) if (m.has(id)) { out.push(m.get(id)); m.delete(id); }
      for (const s of m.values()) out.push(s);
      doc.sheets.splice(0, doc.sheets.length, ...out);
    }
    return doc;
  }

  // Lista de páginas e células tocadas por uma alteração (usado para checar permissões)
  function touched(p) {
    const out = [];
    for (const id in p.sheets || {}) {
      const e = p.sheets[id];
      out.push({ id, created: !!e.created, removed: !!e.removed, cells: e.cells ? Object.keys(e.cells) : [], props: e.props ? Object.keys(e.props) : [] });
    }
    return out;
  }

  const api = { diffPair, apply, touched, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Patch = api;
})(typeof window !== 'undefined' ? window : globalThis);
