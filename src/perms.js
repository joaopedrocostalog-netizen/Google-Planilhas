// Regras de permissão das planilhas compartilhadas (usadas no navegador e no servidor).
// perms = { admin, manage, role, sectorId, sheets: { idDaPágina: 'none' | 'view' | 'edit' }, newSheetLevel }
(function (root) {
  'use strict';
  const RANK = { none: 0, view: 1, edit: 2 };
  const minLevel = (a, b) => (RANK[a] <= RANK[b] ? a : b);

  function defaultAcl() {
    return { link: 'none', linkSector: null, sectors: [], members: [] };
  }

  // Calcula as permissões de um usuário. doc: { ownerId, acl, data: { sheets } }; user: { id, email }
  function compute(doc, user) {
    const acl = Object.assign(defaultAcl(), doc.acl || {});
    const email = String(user.email || '').toLowerCase();
    const owner = doc.ownerId === user.id;
    const member = acl.members.find((m) => m.email === email) || null;
    let admin = owner || !!(member && member.role === 'admin');
    let cap, sector = null, viaLink = false;
    if (admin) cap = 'edit';
    else if (member) { cap = member.role === 'viewer' ? 'view' : 'edit'; sector = acl.sectors.find((s) => s.id === member.sector) || null; }
    else if (acl.link === 'view' || acl.link === 'edit') { cap = acl.link; sector = acl.sectors.find((s) => s.id === acl.linkSector) || null; viaLink = true; }
    else return null; // sem acesso
    const levelFor = (sheetId) => {
      if (admin) return 'edit';
      if (!sector) return cap;
      const lv = (sector.sheets && sector.sheets[sheetId]) || sector.default || 'none';
      return minLevel(lv, cap);
    };
    const sheets = {};
    for (const sh of (doc.data && doc.data.sheets) || []) sheets[sh.id] = levelFor(sh.id);
    const manage = admin || (cap === 'edit' && (sector ? !!sector.manage : true));
    return {
      admin, owner, manage, viaLink,
      role: admin ? 'admin' : cap === 'view' ? 'viewer' : 'editor',
      sectorId: sector ? sector.id : null,
      sectorName: sector ? sector.name : null,
      sheets,
      newSheetLevel: admin ? 'edit' : sector ? minLevel(sector.default || 'none', cap) : cap,
    };
  }

  const levelOf = (perms, sheetId) => (perms.sheets[sheetId] !== undefined ? perms.sheets[sheetId] : perms.newSheetLevel);

  function parseAddr(a) {
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return { r: +m[2], c };
  }
  // Intervalo protegido que impede a edição da célula por este usuário (ou null)
  function blockingProtection(perms, sheet, addr) {
    if (perms.admin || !sheet || !sheet.protected || !sheet.protected.length) return null;
    const p = parseAddr(addr);
    if (!p) return null;
    for (const pr of sheet.protected) {
      const R = pr.range;
      if (p.r >= R.r1 && p.r <= R.r2 && p.c >= R.c1 && p.c <= R.c2) {
        if (!(pr.sectors || []).includes(perms.sectorId)) return pr;
      }
    }
    return null;
  }

  // Valida uma alteração. data: documento atual (para ler intervalos protegidos). Retorna mensagem de erro ou null.
  function validate(patch, perms, data) {
    if (!perms) return 'Você não tem acesso a esta planilha.';
    if (perms.admin) return null;
    if (patch.title !== undefined && patch.title !== null && !perms.manage) return 'Somente quem gerencia a planilha pode renomeá-la.';
    if (patch.names !== undefined && !perms.manage) return 'Somente quem gerencia a planilha pode alterar intervalos nomeados.';
    for (const id in patch.sheets || {}) {
      const e = patch.sheets[id];
      const sheet = data.sheets.find((s) => s.id === id);
      const name = sheet ? `"${sheet.name}"` : 'esta página';
      if (e.created) {
        if (!perms.manage) return 'Você não tem permissão para criar páginas.';
        if (e.created.protected && e.created.protected.length) return 'Somente administradores podem proteger intervalos.';
        continue;
      }
      if (e.removed) {
        if (!perms.manage || levelOf(perms, id) !== 'edit') return `Você não tem permissão para excluir a página ${name}.`;
        continue;
      }
      const lv = levelOf(perms, id);
      if (lv !== 'edit') return lv === 'view' ? `Você só pode visualizar a página ${name}.` : 'Você não tem acesso a esta página.';
      if (e.props) {
        if ('protected' in e.props) return 'Somente administradores podem proteger intervalos.';
        if (('name' in e.props || 'hidden' in e.props) && !perms.manage) return 'Você não tem permissão para renomear ou ocultar páginas.';
      }
      if (e.cells && sheet) {
        for (const a in e.cells) {
          const pr = blockingProtection(perms, sheet, a);
          if (pr) return `A célula ${a} está protegida${pr.desc ? ' (' + pr.desc + ')' : ''}. Peça acesso a um administrador.`;
        }
      }
    }
    if (patch.order && !perms.manage) return 'Você não tem permissão para reorganizar as páginas.';
    return null;
  }

  // Remove do documento as páginas que o usuário não pode ver
  function filterDoc(data, perms) {
    return Object.assign({}, data, { sheets: data.sheets.filter((s) => levelOf(perms, s.id) !== 'none') });
  }
  // Remove de uma alteração o que o destinatário não pode ver
  function filterPatch(patch, perms) {
    const out = Object.assign({}, patch, { sheets: {} });
    let any = patch.title !== undefined || patch.names !== undefined;
    for (const id in patch.sheets || {}) {
      if (levelOf(perms, id) === 'none') continue;
      out.sheets[id] = patch.sheets[id];
      any = true;
    }
    if (patch.order) { out.order = patch.order.filter((id) => levelOf(perms, id) !== 'none'); any = true; }
    return any ? out : null;
  }

  const api = { compute, validate, filterDoc, filterPatch, levelOf, blockingProtection, defaultAcl, RANK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perms = api;
})(typeof window !== 'undefined' ? window : globalThis);
