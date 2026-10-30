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
  const COLS_MSG = 'Somente administradores podem renomear, inserir, excluir, ocultar ou redimensionar colunas.';

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
    const manage = admin; // a estrutura da planilha é só dos administradores
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
  // Texto estável (chaves ordenadas) para comparar células
  function stable(x) {
    if (x === null || typeof x !== 'object') return JSON.stringify(x === undefined ? null : x);
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  }
  // Tudo da célula menos o valor (formatação, nota, link, comentários…)
  function nonValue(x) {
    const o = {};
    if (x) for (const k in x) if (k !== 'v' && k[0] !== '_') o[k] = x[k];
    return stable(o);
  }
  // Mensagem para cada tipo de alteração de página que só administradores podem fazer
  const PROP_MSG = {
    freeze: 'Somente administradores podem congelar linhas e colunas.',
    rowH: 'Somente administradores podem alterar o tamanho das linhas.',
    hiddenRows: 'Somente administradores podem ocultar ou reexibir linhas.',
    rows: 'Somente administradores podem inserir ou excluir linhas.',
    colNames: 'Somente administradores podem renomear colunas.',
    access: 'Somente administradores podem definir permissões por coluna.',
    protected: 'Somente administradores podem proteger intervalos.',
    filter: 'Somente administradores podem criar ou alterar filtros.',
    cf: 'Somente administradores podem criar formatação condicional.',
    dv: 'Somente administradores podem criar regras de validação.',
    banding: 'Somente administradores podem alterar a formatação.',
    merges: 'Somente administradores podem mesclar células.',
    charts: 'Somente administradores podem criar ou alterar gráficos.',
    name: 'Somente administradores podem renomear páginas.',
    hidden: 'Somente administradores podem ocultar páginas.',
    color: 'Somente administradores podem mudar a cor das páginas.',
  };
  const FORMAT_MSG = 'Somente administradores podem usar essa formatação (bordas, alinhamento, ajuste de texto, mesclagem), notas, links e regras.';
  // Formatação liberada para os setores (a mesma da barra de ferramentas deles):
  // formato de número, fonte, tamanho, negrito, itálico, tachado, cor do texto e cor de preenchimento
  const EXEC_STYLE = ['nf', 'ff', 'fs', 'b', 'i', 'st', 'color', 'bg'];
  // Célula resultante quando um setor altera "before" para "after": só o valor e a formatação liberada mudam
  function execMerge(before, after) {
    const out = {}, s = {};
    if (before) for (const k in before) if (k !== 'v' && k !== 's' && k !== 'crit' && k[0] !== '_') out[k] = before[k];
    // marcação de container crítico também é liberada para os setores
    if (after && after.crit) out.crit = true;
    if (before && before.s) for (const k in before.s) if (!EXEC_STYLE.includes(k)) s[k] = before.s[k];
    if (after && after.s) for (const k of EXEC_STYLE) if (after.s[k] !== undefined && after.s[k] !== null) s[k] = after.s[k];
    if (Object.keys(s).length) out.s = s;
    if (after && after.v !== undefined && after.v !== null && after.v !== '') out.v = after.v;
    return Object.keys(out).length ? out : null;
  }
  function normCell(x) {
    if (!x) return null;
    const o = {};
    for (const k in x) if (k[0] !== '_' && x[k] !== undefined && x[k] !== null) o[k] = x[k];
    if (o.v === '') delete o.v;
    if (o.s && !Object.keys(o.s).length) delete o.s;
    return Object.keys(o).length ? o : null;
  }
  const execAllowed = (before, after) => stable(execMerge(before, after)) === stable(normCell(after));

  // Valida uma alteração. data: documento atual. inv (opcional): alteração inversa, de onde vêm os valores anteriores.
  // Quem não é administrador só preenche valores nas colunas liberadas; o resto da planilha é dos administradores.
  function validate(patch, perms, data, inv) {
    if (!perms) return 'Você não tem acesso a esta planilha.';
    if (perms.admin) return null;
    if (patch.title !== undefined && patch.title !== null) return 'Somente administradores podem renomear a planilha.';
    if (patch.names !== undefined) return 'Somente administradores podem alterar intervalos nomeados.';
    for (const id in patch.sheets || {}) {
      const e = patch.sheets[id];
      const sheet = data.sheets.find((s) => s.id === id);
      const name = sheet ? `"${sheet.name}"` : 'esta página';
      if (e.created) return 'Somente administradores podem criar páginas.';
      if (e.removed) return 'Somente administradores podem excluir páginas.';
      if (!sheetVisible(perms, id)) return 'Você não tem acesso a esta página.';
      if (e.props) {
        const keys = Object.keys(e.props);
        if (keys.length) {
          if ('cols' in e.props || 'colW' in e.props || 'hiddenCols' in e.props) return COLS_MSG;
          const k = keys.find((x) => PROP_MSG[x]);
          return k ? PROP_MSG[k] : 'Somente administradores podem alterar a estrutura e a formatação da planilha.';
        }
      }
      if (e.cells) {
        const invCells = inv && inv.sheets && inv.sheets[id] && inv.sheets[id].cells;
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
          const before = invCells ? (a in invCells ? invCells[a] : null) : sheet ? (sheet.cells || {})[a] || null : null;
          if (!execAllowed(before, e.cells[a])) return FORMAT_MSG;
        }
      }
    }
    if (patch.order) return 'Somente administradores podem reorganizar as páginas.';
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
  // Nomes das colunas sem os das colunas ocultas
  function maskNames(names, perms, sheetId) {
    if (!names || perms.admin || !hasHiddenCols(perms, sheetId)) return names;
    const out = {};
    for (const c in names) if (colLevel(perms, sheetId, +c) !== 'none') out[c] = names[c];
    return out;
  }
  function maskSheet(s, perms) {
    if (!hasHiddenCols(perms, s.id)) return s;
    const o = Object.assign({}, s, { cells: maskCells(s.cells || {}, perms, s.id) });
    if (s.colNames) o.colNames = maskNames(s.colNames, perms, s.id);
    return o;
  }
  // Remove do documento as páginas e colunas que o usuário não pode ver
  function filterDoc(data, perms) {
    return Object.assign({}, data, { sheets: data.sheets.filter((s) => sheetVisible(perms, s.id)).map((s) => maskSheet(s, perms)) });
  }
  // Remove de uma alteração o que o destinatário não pode ver
  function filterPatch(patch, perms) {
    const out = Object.assign({}, patch, { sheets: {} });
    let any = patch.title !== undefined || patch.names !== undefined;
    for (const id in patch.sheets || {}) {
      const e = patch.sheets[id];
      if (!e.removed && !sheetVisible(perms, id)) continue;
      if (e.created) out.sheets[id] = { created: maskSheet(Object.assign({ id }, e.created), perms) };
      else if (hasHiddenCols(perms, id) && (e.cells || (e.props && e.props.colNames))) {
        const o = Object.assign({}, e);
        if (e.cells) o.cells = maskCells(e.cells, perms, id);
        if (e.props && e.props.colNames) o.props = Object.assign({}, e.props, { colNames: maskNames(e.props.colNames, perms, id) });
        out.sheets[id] = o;
      } else out.sheets[id] = e;
      any = true;
    }
    if (patch.order) { out.order = patch.order.filter((id) => sheetVisible(perms, id)); any = true; }
    return any ? out : null;
  }
  // Pode ver a célula?
  const canSee = (perms, sheetId, addr) => sheetVisible(perms, sheetId) && colLevel(perms, sheetId, colOf(addr)) !== 'none';

  const api = { COLS_MSG, FORMAT_MSG, nonValue, execMerge, execAllowed, stable, normCell, EXEC_STYLE, compute, validate, filterDoc, filterPatch, levelOf, colLevel, sheetVisible, bestLevel, hasHiddenCols, hasColRules, blockingProtection, defaultAcl, canSee, colOf, colName, RANK, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perms = api;
})(typeof window !== 'undefined' ? window : globalThis);
