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

  // Colunas da escala de veículos pelo nome (nome dado pelo administrador ou texto da linha 1)
  const nrm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\b(DE|DA|DO|DAS|DOS)\b/g, ' ').replace(/[^A-Z0-9]/g, '');
  const ESC_FIELDS = ['CAVALO', 'CARRETA', 'MOTORISTA', 'CPF', 'CONTATO'];
  const escCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function escalaCols(sheet) {
    if (!sheet) return {};
    const names = sheet.colNames || {}, cells = sheet.cells || {};
    const maxC = Math.min(Math.max(sheet.cols || 26, ...Object.keys(names).map(Number)), 400);
    const labels = [];
    for (let c = 1; c <= maxC; c++) labels.push(names[c] || (cells[colName(c) + '1'] && cells[colName(c) + '1'].v) || '');
    const key = labels.join('\u0001');
    const hit = escCache && escCache.get(sheet);
    if (hit && hit.key === key) return hit.cols;
    const cols = {};
    labels.forEach((l, i) => { const k = nrm(l); if (ESC_FIELDS.includes(k) && !cols[k]) cols[k] = i + 1; });
    if (escCache) escCache.set(sheet, { key, cols });
    return cols;
  }
  // Lista de "quem pode" (setores e/ou pessoas): vale para o setor da pessoa e para a própria pessoa (member.rid)
  function inList(list, perms) {
    if (!Array.isArray(list) || !perms) return false;
    if (perms.sectorId && list.includes(perms.sectorId)) return true;
    return (perms.ruleKeys || []).some((k) => k !== 'link' && list.includes(k));
  }
  const CRIT_MSG = 'Marcar container como crítico não está liberado para o seu setor. Peça a um administrador.';
  const LOCK_MSG = 'Veículo bloqueado para troca. Peça ao setor responsável para destravar (use "Pedir troca" no botão direito ou o chat).';
  // colunas que travam junto com o veículo
  const lockedCol = (cols, c) => !!c && [cols.CAVALO, cols.CARRETA, cols.MOTORISTA, cols.CPF, cols.CONTATO].includes(c);
  const truthy = (x) => x !== undefined && x !== null && x !== false && x !== '';
  // Regras da escala de veículos para quem não é administrador:
  // escalar/confirmar = setores da escala; bloquear/destravar = setores do bloqueio; veículo bloqueado não troca
  function escalaCheck(perms, sheet, a, before, after, beforeOf) {
    const cols = escalaCols(sheet);
    if (!cols.CAVALO) return null;
    const p = parseAddr(a);
    if (!p) return null;
    const cfg = sheet.escala || {};
    const inEsc = inList(cfg.sectors || [], perms), inLock = inList(cfg.lockSectors || [], perms);
    const b = before || {}, f = after || {};
    if (p.c === cols.CAVALO) {
      if (truthy(b.lock) !== truthy(f.lock) && !inLock) return 'Somente o setor responsável pode bloquear ou destravar o veículo.';
      if (truthy(b.swap) && !truthy(f.swap) && !inLock) return 'Somente o setor responsável pode encerrar o pedido de troca (destravando o veículo).';
      // qualquer um pode deixar "aguardando confirmação" (ao mexer no veículo fora do Escalar); confirmar é do setor da escala
      if ((b.esc || '') !== (f.esc || '') && !inEsc && f.esc !== 'p') return 'Somente o setor responsável pela escala pode escalar ou confirmar a escala.';
      // marca do par do rodotrem: posta ao escalar (setor da escala); qualquer um pode tirar (ao apagar o veículo)
      if (f.rodo && (b.rodo || '') !== f.rodo && !inEsc) return 'Somente o setor responsável pela escala pode escalar ou confirmar a escala.';
    }
    if (lockedCol(cols, p.c)) {
      const cav = beforeOf(colName(cols.CAVALO) + p.r);
      const bv = b.v === undefined || b.v === null ? '' : String(b.v), fv = f.v === undefined || f.v === null ? '' : String(f.v);
      // bloqueado vale para todos (o setor responsável também destrava antes de trocar)
      if (cav && truthy(cav.lock) && bv !== fv) return LOCK_MSG;
    }
    return null;
  }

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
      admin, owner, manage, viaLink, userId: user.id || null,
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
        if (!inList(pr.sectors || [], perms)) return pr;
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
  // marcas de linha que os setores podem mudar (quem pode cada uma é conferido em escalaCheck); psl = vínculo do PRÉ STACKING
  const FLAG_KEYS = ['crit', 'esc', 'lock', 'swap', 'city', 'rodo', 'sc', 'spot', 'psl', 'psf'];
  function execMerge(before, after) {
    const out = {}, s = {};
    if (before) for (const k in before) if (k !== 'v' && k !== 's' && !FLAG_KEYS.includes(k) && k[0] !== '_') out[k] = before[k];
    // container crítico e marcas da escala de veículos
    if (after) for (const k of FLAG_KEYS) if (after[k] !== undefined && after[k] !== null && after[k] !== false && after[k] !== '') out[k] = after[k];
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
        let keys = Object.keys(e.props);
        // visualizações de filtro compartilhadas: qualquer pessoa salva ou apaga as suas; as dos outros não mudam
        if (keys.includes('sharedViews')) {
          const err = sharedViewsCheck(perms, sheet, e.props.sharedViews);
          if (err) return err;
          keys = keys.filter((k) => k !== 'sharedViews');
        }
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
          const beforeOf = (x) => (invCells && x in invCells ? invCells[x] : sheet ? (sheet.cells || {})[x] || null : null);
          const before = invCells ? (a in invCells ? invCells[a] : null) : sheet ? (sheet.cells || {})[a] || null : null;
          // container crítico: se o administrador escolheu os setores, só eles marcam ou desmarcam
          if (sheet && Array.isArray(sheet.critSectors) && truthy((before || {}).crit) !== truthy((e.cells[a] || {}).crit) && !inList(sheet.critSectors, perms)) return CRIT_MSG;
          if (sheet) { const ee = escalaCheck(perms, sheet, a, before, e.cells[a], beforeOf); if (ee) return ee; }
          if (!execAllowed(before, e.cells[a])) return FORMAT_MSG;
        }
      }
    }
    if (patch.order) return 'Somente administradores podem reorganizar as páginas.';
    return null;
  }

  function sharedViewsCheck(perms, sheet, list) {
    if (list !== null && list !== undefined && !Array.isArray(list)) return 'Visualizações inválidas.';
    if (JSON.stringify(list || []).length > 200000) return 'Visualizações salvas demais nesta página.';
    const mine = (x) => x && x.by && x.by === perms.userId;
    const before = ((sheet && sheet.sharedViews) || []).filter((x) => !mine(x));
    const after = (list || []).filter((x) => !mine(x));
    if (stable(before) !== stable(after)) return 'Você só pode salvar ou apagar as suas próprias visualizações compartilhadas.';
    if ((list || []).some((x) => !x || typeof x.name !== 'string' || !x.v || typeof x.v !== 'object')) return 'Visualizações inválidas.';
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
  // Abas de consulta sem acesso (ex.: BASE GERAL, ou abas usadas por menus suspensos e formatação condicional):
  // vão só com os valores, escondidas e sem edição, para que menus, validações e avisos funcionem para todos
  function shadowSheetIds(data, perms) {
    const out = new Set();
    if (!perms || perms.admin) return out;
    const hidden = data.sheets.filter((s) => !sheetVisible(perms, s.id));
    if (!hidden.length) return out;
    const refs = [];
    for (const s of data.sheets) {
      if (!sheetVisible(perms, s.id)) continue;
      for (const d of s.dv || []) if (d && d.src) refs.push(String(d.src));
      for (const r of s.cf || []) if (r && r.cond) refs.push(String(r.cond.a || '') + ' ' + String(r.cond.b || ''));
    }
    const txt = refs.join('\n');
    for (const h of hidden) if (nrm(h.name) === 'BASEGERAL' || (h.name && txt.includes(h.name))) out.add(h.id);
    return out;
  }
  const valuesOnly = (cells) => {
    const out = {};
    for (const a in cells || {}) { const x = cells[a]; out[a] = x && x.v !== undefined && x.v !== null && x.v !== '' ? { v: x.v } : null; }
    return out;
  };
  function shadowOf(s) {
    const cells = {};
    for (const a in s.cells || {}) { const x = s.cells[a]; if (x && x.v !== undefined && x.v !== null && x.v !== '') cells[a] = { v: x.v }; }
    return { id: s.id, name: s.name, shadow: true, hidden: true, rows: s.rows, cols: s.cols, colNames: s.colNames || {}, cells };
  }
  // Remove do documento as páginas e colunas que o usuário não pode ver
  function filterDoc(data, perms) {
    const shadows = shadowSheetIds(data, perms);
    return Object.assign({}, data, { sheets: data.sheets.map((s) => (sheetVisible(perms, s.id) ? maskSheet(s, perms) : shadows.has(s.id) ? shadowOf(s) : null)).filter(Boolean) });
  }
  // Remove de uma alteração o que o destinatário não pode ver
  function filterPatch(patch, perms, data) {
    const out = Object.assign({}, patch, { sheets: {} });
    let any = patch.title !== undefined || patch.names !== undefined;
    let shadows = null;
    for (const id in patch.sheets || {}) {
      const e = patch.sheets[id];
      if (!e.removed && !sheetVisible(perms, id)) {
        // aba de consulta sem acesso: só os valores
        if (data && e.created) {
          shadows = shadows || shadowSheetIds(data, perms);
          if (shadows.has(id)) { out.sheets[id] = { created: shadowOf(Object.assign({ id }, e.created)) }; any = true; }
        } else if (data) {
          shadows = shadows || shadowSheetIds(data, perms);
          if (shadows.has(id)) {
            const o = {};
            if (e.cells) o.cells = valuesOnly(e.cells);
            if (e.props) { const pr = {}; for (const k of ['name', 'rows', 'cols', 'colNames']) if (k in e.props) pr[k] = e.props[k]; if (Object.keys(pr).length) o.props = pr; }
            if (o.cells || o.props) { out.sheets[id] = o; any = true; }
          }
        }
        continue;
      }
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

  const api = { inList, LOCK_MSG, lockedCol, escalaCols, escalaCheck, ESC_FIELDS, normName: nrm, COLS_MSG, FORMAT_MSG, nonValue, execMerge, execAllowed, stable, normCell, EXEC_STYLE, compute, validate, filterDoc, filterPatch, levelOf, colLevel, sheetVisible, bestLevel, hasHiddenCols, hasColRules, blockingProtection, defaultAcl, canSee, colOf, colName, RANK, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perms = api;
})(typeof window !== 'undefined' ? window : globalThis);
