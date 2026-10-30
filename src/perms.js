// Regras de permissão das planilhas compartilhadas (usadas no navegador e no servidor).
// perms = { admin, manage, role, sectorId, sheets: { idDaPágina: nível }, cols: { idDaPágina: { coluna: nível } }, ruled, newSheetLevel }
// Níveis: 'none' (oculto), 'view' (somente ver), 'edit' (editar).
// Regras por coluna ficam na própria página (sheet.access = { chaveDaRegra: { coluna: nível } }), para acompanharem
// inserções e exclusões de colunas. A chave é o id do setor, o id da pessoa (member.rid) ou 'link'.
(function (root) {
  'use strict';
  const RANK = { none: 0, view: 1, edit: 2 };
  const LEVELS = ['none', 'view', 'edit'];
  const minLevel = (a, b) => (RANK[a] <= RANK[b] ? a : b);
  const maxLevel = (a, b) => (RANK[a] >= RANK[b] ? a : b);
  const isLevel = (x) => LEVELS.includes(x);

  function defaultAcl() {
    return { link: 'none', linkSector: null, sectors: [], members: [] };
  }

  function colOf(a) {
    const m = /^([A-Z]+)\d+$/.exec(a);
    if (!m) return 0;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return c;
  }
  function parseAddr(a) {
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    return m ? { r: +m[2], c: colOf(a) } : null;
  }
  const colName = (c) => { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

  // Calcula as permissões de um usuário. doc: { ownerId, acl, data: { sheets } }; user: { id, email }
  function compute(doc, user) {
    const acl = Object.assign(defaultAcl(), doc.acl || {});
    const email = String(user.email || '').toLowerCase();
    const owner = doc.ownerId === user.id;
    const member = acl.members.find((m) => m.email === email) || null;
    const admin = owner || !!(member && member.role === 'admin');
    let cap, sector = null, viaLink = false;
    if (admin) cap = 'edit';
    else if (member) { cap = member.role === 'viewer' ? 'view' : 'edit'; sector = acl.sectors.find((s) => s.id === member.sector) || null; }
    else if (acl.link === 'view' || acl.link === 'edit') { cap = acl.link; sector = acl.sectors.find((s) => s.id === acl.linkSector) || null; viaLink = true; }
    else return null; // sem acesso
    // regras por coluna em ordem de prioridade: a pessoa, depois o setor, depois o link
    const keys = [];
    if (member && member.rid) keys.push(member.rid);
    if (sector) keys.push(sector.id);
    if (viaLink && !sector) keys.push('link');
    const own = (member && member.sheets) || {};
    const levelFor = (sheetId) => {
      if (admin) return 'edit';
      let lv;
      if (isLevel(own[sheetId])) lv = own[sheetId];
      else if (sector) lv = (sector.sheets && sector.sheets[sheetId]) || sector.default || 'none';
      else lv = cap;
      return minLevel(lv, cap);
    };
    const sheets = {}, cols = {}, ruled = {};
    for (const sh of (doc.data && doc.data.sheets) || []) {
      sheets[sh.id] = levelFor(sh.id);
      const access = sh.access || {};
      if (Object.keys(access).some((k) => access[k] && Object.keys(access[k]).length)) ruled[sh.id] = true;
      if (admin) continue;
      const map = {};
      for (const k of keys) {
        const rule = access[k];
        if (!rule) continue;
        for (const c in rule) if (map[c] === undefined && isLevel(rule[c])) map[c] = minLevel(rule[c], cap);
      }
      if (Object.keys(map).length) cols[sh.id] = map;
    }
    const manage = admin || (cap === 'edit' && (sector ? !!sector.manage : true));
    return {
      admin, owner, manage, viaLink,
      role: admin ? 'admin' : cap === 'view' ? 'viewer' : 'editor',
      sectorId: sector ? sector.id : null,
      sectorName: sector ? sector.name : null,
      ruleKeys: keys,
      sheets, cols, ruled,
      newSheetLevel: admin ? 'edit' : isLevel(own.__new) ? minLevel(own.__new, cap) : sector ? minLevel(sector.default || 'none', cap) : cap,
    };
  }

  // Nível da página (sem considerar regras por coluna)
  const levelOf = (perms, sheetId) => (perms.sheets[sheetId] !== undefined ? perms.sheets[sheetId] : perms.newSheetLevel);
  // Nível de uma coluna da página
  function colLevel(perms, sheetId, col) {
    if (perms.admin) return 'edit';
    const m = perms.cols && perms.cols[sheetId];
    if (m && m[col] !== undefined) return m[col];
    return levelOf(perms, sheetId);
  }
  // A página aparece se o nível dela não for "oculto" ou se alguma coluna estiver liberada
  function sheetVisible(perms, sheetId) {
    if (levelOf(perms, sheetId) !== 'none') return true;
    const m = perms.cols && perms.cols[sheetId];
    return !!m && Object.values(m).some((l) => l !== 'none');
  }
  // Maior nível que a pessoa tem em alguma parte da página
  function bestLevel(perms, sheetId) {
    let lv = levelOf(perms, sheetId);
    const m = perms.cols && perms.cols[sheetId];
    if (m) for (const c in m) lv = maxLevel(lv, m[c]);
    return lv;
  }
  // Há colunas ocultas para esta pessoa nesta página?
  function hasHiddenCols(perms, sheetId) {
    if (perms.admin) return false;
    if (levelOf(perms, sheetId) === 'none') return true;
    const m = perms.cols && perms.cols[sheetId];
    return !!m && Object.values(m).some((l) => l === 'none');
  }
  // Há qualquer restrição por coluna nesta página?
  function hasColRules(perms, sheetId) {
    const m = perms.cols && perms.cols[sheetId];
    return !!m && Object.keys(m).length > 0;
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
        if (e.created.access && Object.keys(e.created.access).length) return 'Somente administradores podem definir permissões por coluna.';
        continue;
      }
      if (e.removed) {
        if (!perms.manage || levelOf(perms, id) !== 'edit' || hasColRules(perms, id)) return `Você não tem permissão para excluir a página ${name}.`;
        continue;
      }
      if (!sheetVisible(perms, id)) return 'Você não tem acesso a esta página.';
      const lv = levelOf(perms, id);
      if (e.props) {
        // altura automática de linha acompanha a edição de uma célula liberada
        const keys = Object.keys(e.props).filter((k) => !(k === 'rowH' && bestLevel(perms, id) === 'edit'));
        const resize = 'rows' in e.props || 'cols' in e.props;
        if ('access' in e.props) {
          return 'cols' in e.props
            ? `A página ${name} tem permissões por coluna. Somente administradores podem inserir ou excluir colunas nela.`
            : 'Somente administradores podem definir permissões por coluna.';
        }
        if ('protected' in e.props) {
          return resize
            ? `A página ${name} tem intervalos protegidos que seriam deslocados. Somente administradores podem inserir ou excluir linhas e colunas antes deles.`
            : 'Somente administradores podem proteger intervalos.';
        }
        if (('name' in e.props || 'hidden' in e.props) && !perms.manage) return 'Você não tem permissão para renomear ou ocultar páginas.';
        if (keys.length && lv !== 'edit') {
          if (resize && hasColRules(perms, id)) return `Você não pode inserir ou excluir linhas e colunas na página ${name}.`;
          return lv === 'view' ? `Você só pode visualizar a formatação da página ${name}.` : 'Você não tem acesso a esta página.';
        }
        if ('cols' in e.props && perms.ruled && perms.ruled[id]) return `A página ${name} tem permissões por coluna. Somente administradores podem inserir ou excluir colunas nela.`;
      }
      if (e.cells) {
        for (const a in e.cells) {
          const c = colOf(a);
          const cl = colLevel(perms, id, c);
          if (cl !== 'edit') {
            if (cl === 'none') return `Esta operação alteraria dados em colunas que estão ocultas para você (por exemplo, ao ordenar, inserir ou excluir linhas). Peça a um administrador.`;
            return hasColRules(perms, id) ? `Você só pode visualizar a coluna ${colName(c)} da página ${name}.` : `Você só pode visualizar a página ${name}.`;
          }
          if (sheet) {
            const pr = blockingProtection(perms, sheet, a);
            if (pr) return `A célula ${a} está protegida${pr.desc ? ' (' + pr.desc + ')' : ''}. Peça acesso a um administrador.`;
          }
        }
      }
    }
    if (patch.order && !perms.manage) return 'Você não tem permissão para reorganizar as páginas.';
    return null;
  }

  // Esconde o conteúdo das células de colunas ocultas (a célula vira um marcador vazio)
  const MASK = { _h: 1 };
  function maskCells(cells, perms, sheetId) {
    if (perms.admin || !hasHiddenCols(perms, sheetId)) return cells;
    const out = {};
    for (const a in cells) {
      if (cells[a] === null) { out[a] = null; continue; }
      out[a] = colLevel(perms, sheetId, colOf(a)) === 'none' ? Object.assign({}, MASK) : cells[a];
    }
    return out;
  }
  // Remove do documento as páginas e colunas que o usuário não pode ver
  function filterDoc(data, perms) {
    return Object.assign({}, data, {
      sheets: data.sheets.filter((s) => sheetVisible(perms, s.id)).map((s) => (hasHiddenCols(perms, s.id) ? Object.assign({}, s, { cells: maskCells(s.cells || {}, perms, s.id) }) : s)),
    });
  }
  // Remove de uma alteração o que o destinatário não pode ver
  function filterPatch(patch, perms) {
    const out = Object.assign({}, patch, { sheets: {} });
    let any = patch.title !== undefined || patch.names !== undefined;
    for (const id in patch.sheets || {}) {
      const e = patch.sheets[id];
      if (!e.removed && !sheetVisible(perms, id)) continue;
      if (e.created) out.sheets[id] = { created: Object.assign({}, e.created, { cells: maskCells(e.created.cells || {}, perms, id) }) };
      else if (e.cells && hasHiddenCols(perms, id)) out.sheets[id] = Object.assign({}, e, { cells: maskCells(e.cells, perms, id) });
      else out.sheets[id] = e;
      any = true;
    }
    if (patch.order) { out.order = patch.order.filter((id) => sheetVisible(perms, id)); any = true; }
    return any ? out : null;
  }
  // Pode ver a célula?
  const canSee = (perms, sheetId, addr) => sheetVisible(perms, sheetId) && colLevel(perms, sheetId, colOf(addr)) !== 'none';

  const api = { compute, validate, filterDoc, filterPatch, levelOf, colLevel, sheetVisible, bestLevel, hasHiddenCols, hasColRules, blockingProtection, defaultAcl, canSee, colOf, colName, RANK, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perms = api;
})(typeof window !== 'undefined' ? window : globalThis);
