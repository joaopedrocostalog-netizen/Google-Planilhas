// Modelo do documento: planilhas, células, estilos, histórico, persistência e operações estruturais.
// Cria window.App, usado pelos demais módulos.
(function () {
  'use strict';
  const E = window.GridEngine;
  const DEF_ROWS = 1000, DEF_COLS = 26, DEF_W = 100, DEF_H = 21;
  const STORAGE_KEY = 'planilhas:v2';

  // ---------- Eventos ----------
  const listeners = {};
  const App = (window.App = {
    E, DEF_W, DEF_H, DEF_ROWS, DEF_COLS,
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); },
  });
  const addr = E.addrToStr;
  const uid = () => Math.random().toString(36).slice(2, 10);
  App.uid = uid;

  // ---------- Documento ----------
  function newSheet(name) {
    return {
      id: uid(), name, rows: DEF_ROWS, cols: DEF_COLS, cells: {}, colW: {}, rowH: {},
      hiddenRows: {}, hiddenCols: {}, merges: [], freeze: { rows: 0, cols: 0 }, filter: null,
      cf: [], dv: [], charts: [], banding: [], gridlines: true, color: null, hidden: false,
    };
  }
  function normalizeSheet(s) {
    const sh = Object.assign(newSheet(s.name || 'Página'), s);
    sh.freeze = Object.assign({ rows: 0, cols: 0 }, s.freeze || {});
    return sh;
  }
  const doc = (App.doc = { title: 'Planilha sem título', sheets: [newSheet('Página1')], active: 0, zoom: 100, names: {}, showFormulas: false, showGrid: true });
  App.newSheet = newSheet;
  App.normalizeSheet = normalizeSheet;
  App.sheet = () => doc.sheets[doc.active];
  App.sheetIndex = (sh) => doc.sheets.indexOf(sh);

  // ---------- Motor de cálculo ----------
  function usedRange(sh) {
    if (sh._used) return sh._used;
    let maxR = 0, maxC = 0;
    for (const a in sh.cells) {
      const c = sh.cells[a];
      if (!c || ((c.v === '' || c.v === undefined || c.v === null) && !c._h)) continue;
      const p = E.parseAddr(a);
      if (!p) continue;
      if (p.row > maxR) maxR = p.row;
      if (p.col > maxC) maxC = p.col;
    }
    sh._used = { maxR, maxC };
    return sh._used;
  }
  App.usedRange = usedRange;
  const provider = {
    count: () => doc.sheets.length,
    name: (i) => doc.sheets[i].name,
    raw: (i, r, c) => {
      const sh = doc.sheets[i];
      if (!sh) return '';
      const cell = sh.cells[addr(r, c)];
      return cell && cell.v !== undefined && cell.v !== null ? cell.v : '';
    },
    formulas: (i) => {
      const out = [];
      const cells = doc.sheets[i].cells;
      for (const a in cells) {
        const v = cells[a].v;
        if (typeof v === 'string' && v[0] === '=') { const p = E.parseAddr(a); if (p) out.push({ r: p.row, c: p.col }); }
      }
      return out;
    },
    used: (i) => usedRange(doc.sheets[i]),
    // células de colunas ocultas por permissão (planilhas compartilhadas)
    blocked: (i, r, c) => { const sh = doc.sheets[i]; const x = sh && sh.cells[addr(r, c)]; return !!(x && x._h); },
    namedRange: (name) => {
      const key = Object.keys(doc.names).find((k) => k.toUpperCase() === name);
      return key ? doc.names[key] : null;
    },
  };
  App.wb = new E.Workbook(provider);

  // ---------- Acesso a células ----------
  App.cell = (sh, r, c) => sh.cells[addr(r, c)];
  App.raw = (sh, r, c) => { const x = sh.cells[addr(r, c)]; return x && x.v !== undefined && x.v !== null ? x.v : ''; };
  App.style = (sh, r, c) => { const x = sh.cells[addr(r, c)]; return (x && x.s) || {}; };
  App.value = (si, r, c) => App.wb.value(si, r, c);
  function cleanup(sh, a) {
    const x = sh.cells[a];
    if (!x) return;
    if (x.s && !Object.keys(x.s).length) delete x.s;
    if ((x.v === '' || x.v === undefined || x.v === null) && !x.s && !x.note && !x.link && !(x.comments && x.comments.length)) delete sh.cells[a];
  }
  App.cleanup = cleanup;
  App.setRaw = (sh, r, c, text) => {
    const a = addr(r, c);
    const x = sh.cells[a] || (sh.cells[a] = {});
    x.v = text === null || text === undefined ? '' : String(text);
    cleanup(sh, a);
  };
  App.setStyle = (sh, r, c, fn) => {
    const a = addr(r, c);
    const x = sh.cells[a] || (sh.cells[a] = { v: '' });
    x.s = x.s || {};
    fn(x.s);
    cleanup(sh, a);
  };
  App.setCellObj = (sh, r, c, obj) => {
    const a = addr(r, c);
    if (!obj) delete sh.cells[a];
    else { sh.cells[a] = obj; cleanup(sh, a); }
  };
  App.cloneCell = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);

  // ---------- Histórico ----------
  // O histórico guarda alterações (patches) e suas inversas: desfazer só mexe no que você alterou,
  // sem apagar edições feitas ao mesmo tempo por outras pessoas.
  const hist = { undo: [], redo: [] };
  const replacer = (k, v) => (k[0] === '_' ? undefined : v);
  const docView = () => ({ title: doc.title, names: doc.names, sheets: doc.sheets });
  function snapshot() { return JSON.stringify({ title: doc.title, sheets: doc.sheets, active: doc.active, names: doc.names }, replacer); }
  function restore(snap) {
    const d = JSON.parse(snap);
    doc.sheets = d.sheets.map(normalizeSheet);
    doc.active = Math.min(d.active || 0, doc.sheets.length - 1);
    doc.names = d.names || {};
    if (d.title !== undefined) doc.title = d.title;
    invalidate();
    App.emit('sheet');
    App.emit('change', { undo: true });
    scheduleSave();
  }
  function invalidate() {
    for (const sh of doc.sheets) { sh._used = null; sh._mm = null; sh._fh = null; sh._old = null; }
    App.wb.invalidate();
    App._fmtCache = new Map();
    App._cfCache = new Map();
  }
  App.invalidate = invalidate;
  // Aplica uma alteração ao documento mantendo a página ativa
  function applyPatch(p) {
    const activeId = doc.sheets[doc.active] && doc.sheets[doc.active].id;
    const view = docView();
    window.Patch.apply(view, p, normalizeSheet);
    doc.title = view.title; doc.names = view.names || {};
    let idx = doc.sheets.findIndex((s) => s.id === activeId);
    if (idx < 0) idx = Math.min(doc.active, doc.sheets.length - 1);
    doc.active = Math.max(0, idx);
    invalidate();
  }
  App.applyPatch = applyPatch;
  // Executa uma alteração com registro no histórico. fn pode retornar false para cancelar.
  App.change = (label, fn) => {
    const snap = snapshot();
    let res;
    try { res = fn(); } catch (e) { console.error(e); restore(snap); App.emit('notify', 'Não foi possível concluir a operação.'); return false; }
    if (res === false) return false;
    const before = JSON.parse(snap);
    let [fwd, inv] = window.Patch.diffPair(before, JSON.parse(JSON.stringify(docView(), replacer)));
    // quem só preenche valores (planilhas compartilhadas): mantém apenas os valores das células,
    // descartando formatação, notas e links que viriam junto (ao colar, arrastar o preenchimento etc.)
    if (fwd && App.valuesOnly && App.valuesOnly()) {
      let dropped = false;
      for (const id in fwd.sheets) {
        const e = fwd.sheets[id];
        if (!e.cells) continue;
        const sh = doc.sheets.find((x) => x.id === id);
        if (!sh) continue;
        for (const a in e.cells) {
          const b = inv.sheets[id].cells[a], f = e.cells[a];
          if (window.Perms.execAllowed(b, f)) continue;
          // mantém o valor e a formatação liberada; descarta bordas, alinhamento, notas, links…
          const keep = window.Perms.execMerge(b, f);
          dropped = true;
          if (keep) sh.cells[a] = JSON.parse(JSON.stringify(keep)); else delete sh.cells[a];
        }
      }
      if (dropped) {
        [fwd, inv] = window.Patch.diffPair(before, JSON.parse(JSON.stringify(docView(), replacer)));
        invalidate();
        if (!fwd) { App.emit('change', {}); App.emit('notify', window.Perms.FORMAT_MSG); return false; }
      }
    }
    // permissões (planilhas compartilhadas): desfaz a alteração se não for permitida
    if (fwd && App.validatePatch) {
      const err = App.validatePatch(fwd, inv);
      if (err) { applyPatch(inv); if (isStructural(inv)) App.emit('sheet'); App.emit('change', {}); App.emit('notify', err); return false; }
    }
    if (fwd) {
      hist.undo.push({ label, fwd, inv });
      if (hist.undo.length > 200) hist.undo.shift();
      hist.redo = [];
    }
    invalidate();
    App.emit('change', { label });
    if (fwd) App.emit('localPatch', fwd);
    scheduleSave();
    return true;
  };
  const isStructural = (p) => !!(p && (p.order || Object.values(p.sheets || {}).some((e) => e.created || e.removed)));
  // Depois de desfazer/refazer, mostra a página afetada
  function focusPatch(p) {
    for (const id in p.sheets || {}) {
      const i = doc.sheets.findIndex((s) => s.id === id);
      if (i >= 0) { doc.active = i; return; }
    }
  }
  function step(from, to, key, back) {
    const h = from.pop();
    if (!h) return App.emit('notify', key === 'inv' ? 'Nada para desfazer' : 'Nada para refazer');
    const p = h[key];
    if (App.validatePatch) {
      const err = App.validatePatch(p, h[key === 'inv' ? 'fwd' : 'inv']);
      if (err) { from.push(h); return App.emit('notify', err); }
    }
    const before = doc.active;
    applyPatch(p);
    focusPatch(p);
    to.push(h);
    if (before !== doc.active || isStructural(p)) App.emit('sheet');
    App.emit('change', { undo: back });
    App.emit('localPatch', p);
    scheduleSave();
  }
  App.undo = () => step(hist.undo, hist.redo, 'inv', true);
  App.redo = () => step(hist.redo, hist.undo, 'fwd', false);
  // Alteração vinda de outra pessoa (não entra no histórico local)
  App.applyRemote = (p) => {
    applyPatch(p);
    if (isStructural(p)) App.emit('sheet');
    App.emit('change', { remote: true });
    if (p.title !== undefined) App.emit('title');
  };
  App.clearHistory = () => { hist.undo = []; hist.redo = []; };
  App.snapshot = snapshot;
  App.restore = restore;
  App.canUndo = () => hist.undo.length > 0;
  App.canRedo = () => hist.redo.length > 0;

  // ---------- Persistência ----------
  let saveTimer = null;
  function scheduleSave() {
    App.emit('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }
  function serialize() {
    return JSON.stringify({ v: 2, title: doc.title, zoom: doc.zoom, active: doc.active, names: doc.names, showGrid: doc.showGrid, sheets: doc.sheets }, replacer);
  }
  // Vários documentos no navegador: índice + um registro por documento
  const INDEX_KEY = 'planilhas:index';
  const docKey = (id) => 'planilhas:doc:' + id;
  App.docId = null;
  App.readIndex = () => { try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch (e) { return []; } };
  function updateIndex() {
    const idx = App.readIndex().filter((x) => x.id !== App.docId);
    idx.unshift({ id: App.docId, title: doc.title, updated: Date.now(), sheets: doc.sheets.length });
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx.slice(0, 200)));
    localStorage.setItem('planilhas:last', App.docId);
  }
  function save() {
    if (App.cloudMode) return; // planilhas da nuvem são salvas no servidor
    try {
      if (!App.docId) App.docId = uid();
      localStorage.setItem(docKey(App.docId), serialize());
      updateIndex();
      App.emit('saved');
    } catch (e) { App.emit('saveError'); }
  }
  App.readDoc = (id) => { try { return JSON.parse(localStorage.getItem(docKey(id)) || 'null'); } catch (e) { return null; } };
  App.deleteDoc = (id) => {
    try {
      localStorage.removeItem(docKey(id));
      localStorage.removeItem('planilhas:versions:' + id);
      localStorage.setItem(INDEX_KEY, JSON.stringify(App.readIndex().filter((x) => x.id !== id)));
    } catch (e) { /* ignora */ }
  };
  function loadData(d) {
    if (!d || !Array.isArray(d.sheets) || !d.sheets.length) return false;
    doc.title = d.title || doc.title;
    doc.zoom = d.zoom || 100;
    doc.names = d.names || {};
    doc.showGrid = d.showGrid !== false;
    doc.sheets = d.sheets.map(normalizeSheet);
    doc.active = Math.min(d.active || 0, doc.sheets.length - 1);
    hist.undo = []; hist.redo = [];
    invalidate();
    return true;
  }
  App.load = () => {
    try {
      const m = /[#&]doc=([\w-]+)/.exec(location.hash);
      let id = m ? m[1] : localStorage.getItem('planilhas:last');
      let data = id ? App.readDoc(id) : null;
      if (!data && !m) {
        // migra o formato antigo (um único documento)
        const old = localStorage.getItem(STORAGE_KEY);
        if (old) { data = JSON.parse(old); id = uid(); }
      }
      if (data) loadData(data);
      App.docId = data ? id : (m ? m[1] : uid());
    } catch (e) { App.docId = uid(); }
  };
  // Troca o documento aberto
  App.openDoc = (id, data) => {
    const wasCloud = App.cloudMode;
    App.emit('localDoc');
    if (!wasCloud) save();
    const d = data || App.readDoc(id);
    if (!d) return false;
    App.docId = id;
    loadData(d);
    if (App.sel) Object.assign(App.sel, { ar: 1, ac: 1, er: 1, ec: 1 });
    try { history.replaceState(null, '', '#doc=' + id); } catch (e) { /* ignora */ }
    App.emit('sheet'); App.emit('change', {}); App.emit('title');
    save();
    return true;
  };
  App.newDocument = (data) => {
    const wasCloud = App.cloudMode;
    App.emit('localDoc');
    if (!wasCloud) save();
    App.docId = uid();
    loadData(data || { title: 'Planilha sem título', sheets: [newSheet('Página1')] });
    if (App.sel) Object.assign(App.sel, { ar: 1, ac: 1, er: 1, ec: 1 });
    try { history.replaceState(null, '', '#doc=' + App.docId); } catch (e) { /* ignora */ }
    App.emit('sheet'); App.emit('change', {}); App.emit('title');
    save();
  };
  App.loadData = (d) => { const ok = loadData(d); if (ok) { App.emit('sheet'); App.emit('change', {}); scheduleSave(); } return ok; };
  App.serialize = serialize;
  App.save = save;
  App.scheduleSave = scheduleSave;
  App.setTitle = (t) => { App.change('Renomear planilha', () => { doc.title = t || 'Planilha sem título'; }); App.emit('title'); };

  // ---------- Formatos de número ----------
  App.FORMATS = {
    auto: { label: 'Automático', code: null },
    text: { label: 'Texto simples', code: '@' },
    number: { label: 'Número', code: '#,##0.00', ex: '1.000,12' },
    percent: { label: 'Porcentagem', code: '0.00%', ex: '10,12%' },
    scientific: { label: 'Notação científica', code: '0.00E+00', ex: '1,01E+03' },
    accounting: { label: 'Contábil', code: '"R$" #,##0.00;"R$" (#,##0.00);"R$" -', ex: 'R$ (1.000,12)' },
    financial: { label: 'Financeiro', code: '#,##0.00;(#,##0.00)', ex: '(1.000,12)' },
    currency: { label: 'Moeda', code: '"R$" #,##0.00', ex: 'R$ 1.000,12' },
    currency0: { label: 'Moeda arredondada', code: '"R$" #,##0', ex: 'R$ 1.000' },
    date: { label: 'Data', code: 'dd/mm/yyyy', ex: '26/09/2008' },
    time: { label: 'Hora', code: 'hh:mm:ss', ex: '15:59:00' },
    datetime: { label: 'Data e hora', code: 'dd/mm/yyyy hh:mm:ss', ex: '26/09/2008 15:59:00' },
    duration: { label: 'Duração', code: '[h]:mm:ss', ex: '24:01:00' },
  };
  const AUTO_FMT = { percent: '0%', currency: '"R$" #,##0.00', date: 'dd/mm/yyyy', time: 'hh:mm:ss', datetime: 'dd/mm/yyyy hh:mm:ss' };
  App.autoFormatFor = (text) => {
    if (typeof text !== 'string' || text[0] === '=' || text[0] === "'") return null;
    const lit = E.parseLiteral(text);
    if (!lit.fmt) return null;
    if (lit.fmt === 'percent') return /[.,]\d+\s*%$/.test(text) ? '0.00%' : '0%';
    return AUTO_FMT[lit.fmt];
  };

  // Formato inferido para fórmulas sem formato próprio (como o Sheets: =HOJE() vira data, =A1 herda o formato de A1)
  const DATE_FUNCS = { TODAY: 'dd/mm/yyyy', DATE: 'dd/mm/yyyy', EDATE: 'dd/mm/yyyy', EOMONTH: 'dd/mm/yyyy', WORKDAY: 'dd/mm/yyyy', DATEVALUE: 'dd/mm/yyyy', NOW: 'dd/mm/yyyy hh:mm:ss', TIME: 'hh:mm:ss', TIMEVALUE: 'hh:mm:ss' };
  const INHERIT = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'MEDIAN', 'SUMIF', 'SUMIFS', 'AVERAGEIF', 'AVERAGEIFS', 'MINIFS', 'MAXIFS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'LARGE', 'SMALL', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'IF', 'IFERROR', 'MROUND', 'TRUNC', 'CEILING', 'FLOOR', 'FILTER', 'SORT', 'UNIQUE', 'TRANSPOSE', 'ARRAYFORMULA']);
  App.inferFormat = (si, text) => {
    const key = si + '|' + text;
    if (App._fmtCache.has(key)) return App._fmtCache.get(key);
    let res = null;
    try {
      let ast = E.parseFormula(text.slice(1));
      const refFmt = (node) => {
        if (node.k !== 'ref') return null;
        const tsi = node.sheet ? App.wb.sheetIndex(node.sheet) : si;
        const sh = doc.sheets[tsi];
        if (!sh || node.ref.r1 === undefined) return null;
        const st = App.style(sh, node.ref.r1, node.ref.c1);
        if (st.nf) return st.nf;
        const raw = App.raw(sh, node.ref.r1, node.ref.c1);
        if (typeof raw === 'string' && raw[0] === '=' && raw !== text) return App.inferFormat(tsi, raw);
        return App.autoFormatFor(raw);
      };
      const walk = (node, depth) => {
        if (depth > 6 || !node) return null;
        if (node.k === 'ref') return refFmt(node);
        if (node.k === 'call') {
          if (DATE_FUNCS[node.name]) return DATE_FUNCS[node.name];
          if (INHERIT.has(node.name)) {
            const args = node.name === 'IF' || node.name === 'IFERROR' ? node.args.slice(node.name === 'IF' ? 1 : 0) :
              node.name === 'VLOOKUP' || node.name === 'HLOOKUP' || node.name === 'INDEX' ? [node.args[node.name === 'INDEX' ? 0 : 1]] :
                node.name === 'XLOOKUP' ? [node.args[2]] : node.name === 'SUMIF' || node.name === 'AVERAGEIF' ? [node.args[2] || node.args[0]] : node.args;
            for (const a of args) { const f = walk(a, depth + 1); if (f) return f; }
          }
          return null;
        }
        if (node.k === 'bin' && (node.op === '+' || node.op === '-')) return walk(node.a, depth + 1) || walk(node.b, depth + 1);
        if (node.k === 'bin' && (node.op === '*' || node.op === '/')) {
          const fa = walk(node.a, depth + 1), fb = node.op === '*' ? walk(node.b, depth + 1) : null;
          const ok = (f) => f && !/%/.test(f) && !/[dyhs]/i.test(f.replace(/"[^"]*"/g, ''));
          return ok(fa) ? fa : ok(fb) ? fb : null;
        }
        if (node.k === 'un') return node.op === '%' ? null : walk(node.e, depth + 1);
        return null;
      };
      res = walk(ast, 0);
    } catch (e) { res = null; }
    App._fmtCache.set(key, res);
    return res;
  };

  // Texto de exibição de um valor
  function fmtAuto(v) {
    if (!isFinite(v)) return '#NUM!';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return v.toExponential(4).replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
    return Number(v.toPrecision(11)).toLocaleString('pt-BR', { maximumFractionDigits: 10, useGrouping: false });
  }
  App.fmtValue = (v, nf) => {
    if (v === null || v === undefined) return '';
    if ((E.Sparkline && v instanceof E.Sparkline) || (E.CellImage && v instanceof E.CellImage)) return '';
    if (E.isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    if (typeof v === 'number') return nf && nf !== '@' ? E.formatValue(v, nf) : fmtAuto(v);
    if (nf && nf.includes('@') && nf !== '@') return E.formatValue(v, nf);
    return String(v);
  };
  App.fmtAuto = fmtAuto;

  // ---------- Mesclagens ----------
  App.mergeMap = (sh) => {
    if (sh._mm) return sh._mm;
    const m = new Map();
    for (const g of sh.merges) {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) m.set(r + ':' + c, g);
    }
    sh._mm = m;
    return m;
  };
  App.mergeAt = (sh, r, c) => App.mergeMap(sh).get(r + ':' + c) || null;
  // Expande um retângulo para conter mesclagens que o cruzam
  App.expandToMerges = (sh, R) => {
    let changed = true;
    R = Object.assign({}, R);
    while (changed) {
      changed = false;
      for (const g of sh.merges) {
        if (g.r2 < R.r1 || g.r1 > R.r2 || g.c2 < R.c1 || g.c1 > R.c2) continue;
        if (g.r1 < R.r1) { R.r1 = g.r1; changed = true; }
        if (g.r2 > R.r2) { R.r2 = g.r2; changed = true; }
        if (g.c1 < R.c1) { R.c1 = g.c1; changed = true; }
        if (g.c2 > R.c2) { R.c2 = g.c2; changed = true; }
      }
    }
    return R;
  };
  App.merge = (sh, R, mode) => {
    const inter = (g) => !(g.r2 < R.r1 || g.r1 > R.r2 || g.c2 < R.c1 || g.c1 > R.c2);
    sh.merges = sh.merges.filter((g) => !inter(g));
    if (mode === 'none') return;
    const add = (g) => {
      if (g.r1 === g.r2 && g.c1 === g.c2) return;
      sh.merges.push(g);
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        if (r === g.r1 && c === g.c1) continue;
        const a = addr(r, c);
        if (sh.cells[a]) { sh.cells[a].v = ''; cleanup(sh, a); }
      }
    };
    if (mode === 'all') add({ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 });
    else if (mode === 'h') for (let r = R.r1; r <= R.r2; r++) add({ r1: r, c1: R.c1, r2: r, c2: R.c2 });
    else if (mode === 'v') for (let c = R.c1; c <= R.c2; c++) add({ r1: R.r1, c1: c, r2: R.r2, c2: c });
  };

  // ---------- Filtros ----------
  // última linha filtrada (no filtro a partir da coluna, acompanha os dados preenchidos)
  // Visualizações com filtro: pessoais (só para quem criou), não alteram a planilha dos outros
  App.views = new Map();
  App.activeFilter = (sh) => (sh && App.views.get(sh.id)) || (sh && sh.filter) || null;
  App.filterEnd = (sh) => { const f = App.activeFilter(sh); return !f ? 0 : f.r1 === 0 || f.dyn ? Math.max(1, f.r1 + 1, usedRange(sh).maxR) : f.r2; };
  App.filterHidden = (sh) => {
    if (sh._fh) return sh._fh;
    const set = new Set();
    const f = App.activeFilter(sh);
    if (f && f.crit) {
      const si = App.sheetIndex(sh);
      for (let r = f.r1 + 1, end = App.filterEnd(sh); r <= end; r++) {
        for (const k in f.crit) {
          const c = +k, cr = f.crit[k];
          const v = App.value(si, r, c);
          const txt = App.fmtValue(v, App.style(sh, r, c).nf);
          if (cr.hidden && cr.hidden.includes(txt)) { set.add(r); break; }
          if (cr.cond && !App.testCondition(cr.cond, v, si, r, c)) { set.add(r); break; }
        }
      }
    }
    sh._fh = set;
    return set;
  };
  App.isRowHidden = (sh, r) => !!sh.hiddenRows[r] || App.filterHidden(sh).has(r) || App.oldRows(sh).has(r);

  // ---------- Grupos pessoais: abrir/fechar vale só para quem clicou ----------
  const openKey = () => 'planilhas:open:' + (App.docId || '');
  let openState = null;
  const loadOpen = () => { if (!openState || openState.key !== openKey()) { let v = {}; try { v = JSON.parse(localStorage.getItem(openKey()) || '{}'); } catch (e) { /* vazio */ } openState = { key: openKey(), v }; } return openState.v; };
  const saveOpen = () => { try { localStorage.setItem(openKey(), JSON.stringify(openState.v)); } catch (e) { /* ignora */ } };
  App.isGroupOpen = (sh, g) => !!loadOpen()[sh.id + ':' + g.id];
  App.toggleGroup = (sh, id) => {
    const o = loadOpen(), k = sh.id + ':' + id;
    if (o[k]) delete o[k]; else o[k] = 1;
    saveOpen(); invalidate(); App.emit('change', { view: true });
  };
  App.colCollapsed = (sh, c) => !!(sh.colGroups && sh.colGroups.some((g) => c >= g.c1 && c <= g.c2 && !App.isGroupOpen(sh, g)));
  // Linhas antigas (regra "últimos N dias"): ficam recolhidas até a pessoa clicar em +
  App.showOld = (sh) => !!loadOpen()[sh.id + ':__old'];
  App.toggleOld = (sh) => App.toggleGroup(sh, '__old');
  const dateOf = (v, raw) => {
    if (typeof v === 'number' && v > 20000 && v < 80000) return E.serialToDate(v);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(raw || '').trim());
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, +m[2] - 1, +m[1])); }
    return null;
  };
  App.oldRowsAll = (sh) => {
    if (sh._old) return sh._old;
    const set = new Set();
    const rule = sh.recent;
    if (rule && rule.col) {
      const si = App.sheetIndex(sh), used = usedRange(sh);
      const now = new Date(), cutoff = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - (rule.days || 30) * 864e5;
      for (let r = 1; r <= used.maxR; r++) {
        const d = dateOf(App.value(si, r, rule.col), App.raw(sh, r, rule.col));
        if (d && d.getTime() < cutoff) set.add(r);
      }
    }
    sh._old = set;
    return set;
  };
  const EMPTY = new Set();
  App.oldRows = (sh) => (sh.recent && !App.showOld(sh) ? App.oldRowsAll(sh) : EMPTY);
  // rótulo da coluna: letra e, se houver, o nome dado a ela (ex.: "A · CLIENTE")
  App.colLabel = (sh, c) => { const n = sh && sh.colNames && sh.colNames[c]; return n ? `${E.numToCol(c)} · ${n}` : E.numToCol(c); };
  App.isColHidden = (sh, c) => !!sh.hiddenCols[c] || !!(App.colBlocked && App.colBlocked(sh, c)) || App.colCollapsed(sh, c);

  // Condições usadas por filtros, formatação condicional e validação
  App.CONDITIONS = [
    ['empty', 'A célula está vazia', 0], ['notEmpty', 'A célula não está vazia', 0],
    ['contains', 'O texto contém', 1], ['notContains', 'O texto não contém', 1],
    ['startsWith', 'O texto começa com', 1], ['endsWith', 'O texto termina com', 1], ['textIs', 'O texto é exatamente', 1],
    ['gt', 'Maior que', 1], ['gte', 'Maior ou igual a', 1], ['lt', 'Menor que', 1], ['lte', 'Menor ou igual a', 1],
    ['eq', 'É igual a', 1], ['neq', 'Não é igual a', 1], ['between', 'Está entre', 2], ['notBetween', 'Não está entre', 2],
    ['formula', 'A fórmula personalizada é', 1],
  ];
  const numOf = (x) => { const l = E.parseLiteral(String(x)); return typeof l.v === 'number' ? l.v : NaN; };
  App.testCondition = (cond, v, si, r, c, anchor) => {
    const s = v === null || v === undefined ? '' : E.isErr(v) ? v.code : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : typeof v === 'number' ? App.fmtAuto(v) : String(v);
    const low = s.toLowerCase(), a = String(cond.a ?? '').toLowerCase();
    const n = typeof v === 'number' ? v : numOf(s);
    switch (cond.type) {
      case 'empty': return s === '';
      case 'notEmpty': return s !== '';
      case 'contains': return low.includes(a);
      case 'notContains': return !low.includes(a);
      case 'startsWith': return low.startsWith(a);
      case 'endsWith': return low.endsWith(a);
      case 'textIs': return low === a;
      case 'gt': return n > numOf(cond.a);
      case 'gte': return n >= numOf(cond.a);
      case 'lt': return n < numOf(cond.a);
      case 'lte': return n <= numOf(cond.a);
      case 'eq': return isNaN(numOf(cond.a)) ? low === a : n === numOf(cond.a);
      case 'neq': return isNaN(numOf(cond.a)) ? low !== a : n !== numOf(cond.a);
      case 'between': { const x = numOf(cond.a), y = numOf(cond.b); return n >= Math.min(x, y) && n <= Math.max(x, y); }
      case 'notBetween': { const x = numOf(cond.a), y = numOf(cond.b); return !(n >= Math.min(x, y) && n <= Math.max(x, y)); }
      case 'formula': {
        let f = String(cond.a || '');
        if (f[0] !== '=') f = '=' + f;
        if (anchor) f = E.shiftFormula(f, r - anchor.r, c - anchor.c);
        const res = App.evalAt(si, r, c, f);
        try { return E.toBool(res); } catch (e) { return false; }
      }
    }
    return false;
  };
  // Avalia uma fórmula como se estivesse na célula (r,c), sem gravá-la
  App.evalAt = (si, r, c, formula) => {
    try {
      const ast = E.parseFormula(formula.replace(/^=/, ''));
      return E.scalarOf(E.evaluate(ast, { wb: App.wb, si, row: r, col: c, vars: null }));
    } catch (e) { return E.isErr(e) ? e : E.ERR.ERROR; }
  };

  // ---------- Formatação condicional ----------
  const inRect = (R, r, c) => r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2;
  App.inRect = inRect;
  function scaleStats(sh, si, rule) {
    const key = si + ':' + rule.id;
    if (App._cfCache.has(key)) return App._cfCache.get(key);
    let min = Infinity, max = -Infinity;
    const R = rule.range;
    const maxR = Math.min(R.r2, usedRange(sh).maxR || R.r2);
    for (let r = R.r1; r <= maxR; r++) for (let c = R.c1; c <= R.c2; c++) {
      const v = App.value(si, r, c);
      if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; }
    }
    const st = { min, max };
    App._cfCache.set(key, st);
    return st;
  }
  const hex = (h) => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.substr(i, 2), 16)); };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  App.mixColor = mix;
  // Estilo efetivo: estilo da célula + cores alternadas + regras condicionais
  App.effectiveStyle = (sh, si, r, c, base) => {
    let st = base;
    if (sh.banding && sh.banding.length) {
      for (const b of sh.banding) {
        if (!inRect(b.range, r, c)) continue;
        const idx = r - b.range.r1;
        const bg = b.header && idx === 0 ? b.headerColor : (idx - (b.header ? 1 : 0)) % 2 === 0 ? b.color1 : b.color2;
        if (!st.bg) st = Object.assign({}, st, { bg });
        if (b.header && idx === 0) st = Object.assign({}, st, { b: true, color: st.color || b.headerText || '#ffffff' });
      }
    }
    if (!sh.cf.length) return st;
    let v;
    for (const rule of sh.cf) {
      if (!inRect(rule.range, r, c)) continue;
      if (v === undefined) v = App.value(si, r, c);
      if (rule.kind === 'scale') {
        if (typeof v !== 'number') continue;
        const { min, max } = scaleStats(sh, si, rule);
        if (!isFinite(min)) continue;
        const t = max === min ? 0.5 : (v - min) / (max - min);
        let bg;
        if (rule.mid) bg = t < 0.5 ? mix(rule.min, rule.mid, t * 2) : mix(rule.mid, rule.max, (t - 0.5) * 2);
        else bg = mix(rule.min, rule.max, t);
        st = Object.assign({}, st, { bg });
        continue;
      }
      if (App.testCondition(rule.cond, v, si, r, c, { r: rule.range.r1, c: rule.range.c1 })) {
        st = Object.assign({}, st, rule.style);
        break;
      }
    }
    return st;
  };

  // ---------- Validação de dados ----------
  App.dvAt = (sh, r, c) => sh.dv.find((d) => inRect(d.range, r, c)) || null;
  // Caixa de seleção: valores personalizados (ex.: SIM / NÃO) ou VERDADEIRO / FALSO
  App.cbValues = (d) => (d && d.custom && d.checked ? { on: String(d.checked), off: String(d.unchecked || '') } : { on: 'TRUE', off: 'FALSE' });
  App.cbIsOn = (d, raw, v) => {
    if (d && d.custom && d.checked) return String(raw).trim().toLowerCase() === String(d.checked).trim().toLowerCase();
    return v === true || (typeof raw === 'string' && /^(true|verdadeiro)$/i.test(raw.trim()));
  };
  App.cbValid = (d, text) => {
    if (d && d.custom && d.checked) { const t = String(text).trim().toLowerCase(); return t === String(d.checked).trim().toLowerCase() || t === String(d.unchecked || '').trim().toLowerCase(); }
    return /^(TRUE|FALSE|VERDADEIRO|FALSO)$/i.test(text);
  };
  App.dvItems = (sh, d) => {
    if (d.type === 'list') return d.items || [];
    if (d.type === 'range' && d.src) {
      try {
        const v = App.evalRange(App.sheetIndex(sh), d.src);
        return Array.from(new Set(v.flat().filter((x) => x !== null && x !== '').map((x) => App.fmtValue(x))));
      } catch (e) { return []; }
    }
    return [];
  };
  App.evalRange = (si, text) => {
    const ast = E.parseFormula(String(text).replace(/^=/, ''));
    return E.toMatrix(E.evaluate(ast, { wb: App.wb, si, row: 1, col: 1, vars: null }));
  };
  App.validate = (sh, r, c, text) => {
    const d = App.dvAt(sh, r, c);
    if (!d || text === '' || (typeof text === 'string' && text[0] === '=')) return true;
    if (d.type === 'checkbox') return App.cbValid(d, text);
    if (d.type === 'list' || d.type === 'range') return App.dvItems(sh, d).some((x) => x.toLowerCase() === String(text).toLowerCase());
    if (d.type === 'number') {
      const n = numOf(text);
      if (isNaN(n)) return false;
      return App.testCondition(d.cond, n, App.sheetIndex(sh), r, c);
    }
    if (d.type === 'text') return App.testCondition(d.cond, text, App.sheetIndex(sh), r, c);
    if (d.type === 'date') return !isNaN(numOf(text)) && !!App.autoFormatFor(text);
    return true;
  };

  // ---------- Operações estruturais ----------
  // Desloca um retângulo ao inserir/excluir; retorna null se for totalmente excluído
  function shiftRect(R, axis, at, count) {
    const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
    const out = Object.assign({}, R);
    if (count > 0) {
      if (out[k1] >= at) out[k1] += count;
      if (out[k2] >= at) out[k2] += count;
      return out;
    }
    const d1 = at, d2 = at - count - 1, n = -count;
    if (out[k1] >= d1 && out[k2] <= d2) return null;
    if (out[k1] > d2) out[k1] -= n; else if (out[k1] >= d1) out[k1] = d1;
    if (out[k2] > d2) out[k2] -= n; else if (out[k2] >= d1) out[k2] = d1 - 1;
    return out;
  }
  function shiftMap(map, at, count) {
    const out = {};
    for (const k in map) {
      const i = +k;
      if (count > 0) out[i >= at ? i + count : i] = map[k];
      else if (i < at) out[i] = map[k];
      else if (i > at - count - 1) out[i + count] = map[k];
    }
    return out;
  }
  function shiftRangeText(text, sheetName, axis, at, count) {
    const f = E.structuralShift('=' + text, sheetName, sheetName, axis, at, count);
    return f.slice(1);
  }
  // count > 0 insere antes de `at`; count < 0 exclui -count linhas/colunas a partir de `at`
  App.structural = (si, axis, at, count) => {
    const sh = doc.sheets[si];
    const cells = {};
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      let { row, col } = p;
      const pos = axis === 'row' ? row : col;
      let np = pos;
      if (count > 0) { if (pos >= at) np = pos + count; }
      else if (pos >= at && pos <= at - count - 1) continue;
      else if (pos > at - count - 1) np = pos + count;
      if (axis === 'row') row = np; else col = np;
      cells[addr(row, col)] = sh.cells[a];
    }
    sh.cells = cells;
    if (axis === 'row') {
      sh.rowH = shiftMap(sh.rowH, at, count);
      sh.hiddenRows = shiftMap(sh.hiddenRows, at, count);
      sh.rows = Math.max(1, sh.rows + count);
      if (sh.freeze.rows >= at) sh.freeze.rows = Math.max(0, count > 0 ? sh.freeze.rows + count : Math.max(at - 1, sh.freeze.rows + count));
    } else {
      sh.colW = shiftMap(sh.colW, at, count);
      sh.hiddenCols = shiftMap(sh.hiddenCols, at, count);
      if (sh.colNames) sh.colNames = shiftMap(sh.colNames, at, count);
      if (sh.colHdr) sh.colHdr = shiftMap(sh.colHdr, at, count);
      if (sh.colGroups && sh.colGroups.length) sh.colGroups = sh.colGroups.map((g) => { const R = shiftRect({ r1: 1, r2: 1, c1: g.c1, c2: g.c2 }, 'col', at, count); return R ? Object.assign({}, g, { c1: R.c1, c2: R.c2 }) : null; }).filter(Boolean);
      if (sh.access) { const acc = {}; for (const k in sh.access) acc[k] = shiftMap(sh.access[k], at, count); sh.access = acc; }
      sh.cols = Math.max(1, sh.cols + count);
      if (sh.freeze.cols >= at) sh.freeze.cols = Math.max(0, count > 0 ? sh.freeze.cols + count : Math.max(at - 1, sh.freeze.cols + count));
    }
    if (sh.protected && sh.protected.length) sh.protected = sh.protected.map((x) => { const R = shiftRect(x.range, axis, at, count); return R ? Object.assign({}, x, { range: R }) : null; }).filter(Boolean);
    sh.merges = sh.merges.map((g) => shiftRect(g, axis, at, count)).filter((g) => g && (g.r1 !== g.r2 || g.c1 !== g.c2));
    sh.cf = sh.cf.map((x) => { const R = shiftRect(x.range, axis, at, count); return R ? Object.assign(x, { range: R }) : null; }).filter(Boolean);
    sh.dv = sh.dv.map((x) => { const R = shiftRect(x.range, axis, at, count); return R ? Object.assign(x, { range: R }) : null; }).filter(Boolean);
    sh.banding = (sh.banding || []).map((x) => { const R = shiftRect(x.range, axis, at, count); return R ? Object.assign(x, { range: R }) : null; }).filter(Boolean);
    if (sh.filter) {
      const R = shiftRect(sh.filter, axis, at, count);
      if (!R) sh.filter = null;
      else {
        const crit = axis === 'col' ? shiftMap(sh.filter.crit || {}, at, count) : sh.filter.crit;
        sh.filter = Object.assign(R, { crit });
      }
    }
    for (const ch of sh.charts) ch.range = shiftRangeText(ch.range, sh.name, axis, at, count);
    // reescreve fórmulas de todas as planilhas
    for (const other of doc.sheets) {
      for (const a in other.cells) {
        const x = other.cells[a];
        if (typeof x.v === 'string' && x.v[0] === '=') x.v = E.structuralShift(x.v, other.name, sh.name, axis, at, count);
      }
      for (const ch of other.charts) if (other !== sh && ch.range.includes('!')) ch.range = E.structuralShift('=' + ch.range, other.name, sh.name, axis, at, count).slice(1);
    }
    for (const n in doc.names) doc.names[n] = E.structuralShift('=' + doc.names[n], sh.name, sh.name, axis, at, count).slice(1);
  };
  App.renameSheet = (si, newName) => {
    const sh = doc.sheets[si], old = sh.name;
    sh.name = newName;
    for (const other of doc.sheets) {
      for (const a in other.cells) {
        const x = other.cells[a];
        if (typeof x.v === 'string' && x.v[0] === '=') x.v = E.renameSheetRefs(x.v, old, newName);
      }
    }
    for (const n in doc.names) doc.names[n] = E.renameSheetRefs('=' + doc.names[n], old, newName).slice(1);
  };
  App.uniqueSheetName = (base) => {
    const names = new Set(doc.sheets.map((s) => s.name.toUpperCase()));
    if (!names.has(base.toUpperCase())) return base;
    let n = 2;
    const stem = base.replace(/\s*\d+$/, '') || base;
    while (names.has((stem + n).toUpperCase()) || names.has((stem + ' ' + n).toUpperCase())) n++;
    return /\d+$/.test(base) ? stem + n : stem + ' ' + n;
  };
  App.nextSheetName = () => {
    let n = doc.sheets.length + 1;
    const names = new Set(doc.sheets.map((s) => s.name.toUpperCase()));
    while (names.has(('Página' + n).toUpperCase())) n++;
    return 'Página' + n;
  };

  // ---------- Ordenação ----------
  App.sortRange = (si, R, keys, hasHeader) => {
    const sh = doc.sheets[si];
    const start = hasHeader ? R.r1 + 1 : R.r1;
    const rows = [];
    for (let r = start; r <= R.r2; r++) {
      const cells = [];
      for (let c = R.c1; c <= R.c2; c++) cells.push(App.cloneCell(App.cell(sh, r, c)));
      rows.push({ r, cells, keys: keys.map((k) => App.value(si, r, k.col)) });
    }
    rows.sort((x, y) => {
      for (let i = 0; i < keys.length; i++) {
        const a = x.keys[i], b = y.keys[i];
        const ea = a === null || a === '', eb = b === null || b === '';
        if (ea || eb) { if (ea && eb) continue; return ea ? 1 : -1; } // vazios sempre no fim
        const d = E.cmpValues(a, b);
        if (d) return keys[i].asc ? d : -d;
      }
      return x.r - y.r;
    });
    rows.forEach((row, i) => {
      const r = start + i;
      row.cells.forEach((obj, j) => {
        if (obj && typeof obj.v === 'string' && obj.v[0] === '=' && row.r !== r) obj.v = E.shiftFormula(obj.v, r - row.r, 0);
        App.setCellObj(sh, r, R.c1 + j, obj);
      });
    });
  };

  // ---------- Preenchimento (alça e Ctrl+D/Ctrl+R) ----------
  const SERIES = [
    ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
    ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  ];
  function matchCase(sample, word) {
    if (sample === sample.toUpperCase()) return word.toUpperCase();
    if (sample[0] === sample[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }
  // Gera os valores de uma sequência a partir das células de origem
  function seriesFor(srcCells, srcVals, n) {
    const k = srcCells.length;
    const raws = srcCells.map((x) => (x && x.v !== undefined ? String(x.v) : ''));
    const nums = srcVals.map((v) => (typeof v === 'number' ? v : null));
    const isFormula = raws.some((t) => t[0] === '=');
    if (!isFormula && k >= 1 && nums.every((v) => v !== null) && raws.every((t) => t !== '')) {
      if (k === 1) return null; // número único: copia (como o Sheets)
      // tendência linear (mínimos quadrados, igual ao Sheets)
      const xs = nums.map((_, i) => i);
      const mx = (k - 1) / 2, my = nums.reduce((s, x) => s + x, 0) / k;
      let sxy = 0, sxx = 0;
      xs.forEach((x, i) => { sxy += (x - mx) * (nums[i] - my); sxx += (x - mx) * (x - mx); });
      const slope = sxx ? sxy / sxx : 0;
      return (i) => String(+(my + slope * (k + i - mx)).toPrecision(15));
    }
    if (!isFormula && raws.every((t) => /^(.*?)(\d+)$/.test(t)) && raws.every((t) => t.replace(/\d+$/, '') === raws[0].replace(/\d+$/, '')) && !raws.every((t) => /^\d+$/.test(t))) {
      const pre = raws[0].replace(/\d+$/, '');
      const ns = raws.map((t) => +/\d+$/.exec(t)[0]);
      const step = k > 1 ? ns[k - 1] - ns[k - 2] : 1;
      const width = /\d+$/.exec(raws[k - 1])[0].length;
      return (i) => pre + String(ns[k - 1] + step * (i + 1)).padStart(width, '0');
    }
    for (const list of SERIES) {
      const idx = raws.map((t) => list.indexOf(t.toLowerCase()));
      if (raws[0] && idx.every((x) => x >= 0)) {
        const step = k > 1 ? idx[k - 1] - idx[k - 2] : 1;
        return (i) => matchCase(raws[0], list[(((idx[k - 1] + step * (i + 1)) % list.length) + list.length) % list.length]);
      }
    }
    return null;
  }
  // Preenche `dst` a partir de `src` (mesma largura ou altura). dir: 'down' | 'up' | 'right' | 'left'
  App.fill = (si, src, dst, dir) => {
    const sh = doc.sheets[si];
    const vertical = dir === 'down' || dir === 'up';
    const lines = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
    for (let line = lines[0]; line <= lines[1]; line++) {
      const srcPos = [];
      if (vertical) for (let r = src.r1; r <= src.r2; r++) srcPos.push([r, line]);
      else for (let c = src.c1; c <= src.c2; c++) srcPos.push([line, c]);
      const ordered = dir === 'up' || dir === 'left' ? srcPos.slice().reverse() : srcPos;
      const srcCells = ordered.map(([r, c]) => App.cell(sh, r, c));
      const srcVals = ordered.map(([r, c]) => App.value(si, r, c));
      const gen = seriesFor(srcCells, srcVals, 0);
      const targets = [];
      if (dir === 'down') for (let r = src.r2 + 1; r <= dst.r2; r++) targets.push([r, line]);
      if (dir === 'up') for (let r = src.r1 - 1; r >= dst.r1; r--) targets.push([r, line]);
      if (dir === 'right') for (let c = src.c2 + 1; c <= dst.c2; c++) targets.push([line, c]);
      if (dir === 'left') for (let c = src.c1 - 1; c >= dst.c1; c--) targets.push([line, c]);
      targets.forEach(([r, c], i) => {
        const k = i % ordered.length;
        const [sr, sc] = ordered[k];
        const obj = App.cloneCell(App.cell(sh, sr, sc)) || {};
        delete obj.note; delete obj.comments;
        if (gen) obj.v = gen(i);
        else if (typeof obj.v === 'string' && obj.v[0] === '=') obj.v = E.shiftFormula(obj.v, r - sr, c - sc);
        App.setCellObj(sh, r, c, Object.keys(obj).length ? obj : null);
      });
    }
  };

  // ---------- Bloco copiado (área de transferência interna) ----------
  App.readBlock = (si, R) => {
    const sh = doc.sheets[si];
    const cells = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const row = [];
      for (let c = R.c1; c <= R.c2; c++) row.push(App.cloneCell(App.cell(sh, r, c)));
      cells.push(row);
    }
    const merges = sh.merges.filter((g) => g.r1 >= R.r1 && g.r2 <= R.r2 && g.c1 >= R.c1 && g.c2 <= R.c2)
      .map((g) => ({ r1: g.r1 - R.r1, c1: g.c1 - R.c1, r2: g.r2 - R.r1, c2: g.c2 - R.c1 }));
    return { si, R, cells, merges };
  };
  // mode: 'all' | 'values' | 'format' | 'formula'; transpose: boolean
  App.writeBlock = (si, r0, c0, block, mode, transpose, cut) => {
    const sh = doc.sheets[si];
    let cells = block.cells;
    if (transpose) cells = cells[0].map((_, j) => cells.map((row) => row[j]));
    const h = cells.length, w = cells[0].length;
    if (cut) {
      const ssh = doc.sheets[block.si];
      for (let r = block.R.r1; r <= block.R.r2; r++) for (let c = block.R.c1; c <= block.R.c2; c++) App.setCellObj(ssh, r, c, null);
      ssh.merges = ssh.merges.filter((g) => !(g.r1 >= block.R.r1 && g.r2 <= block.R.r2 && g.c1 >= block.R.c1 && g.c2 <= block.R.c2));
    }
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const r = r0 + i, c = c0 + j;
        const src = cells[i][j];
        const srcR = transpose ? block.R.r1 + j : block.R.r1 + i;
        const srcC = transpose ? block.R.c1 + i : block.R.c1 + j;
        const cur = App.cell(sh, r, c);
        let obj;
        if (mode === 'values') {
          obj = App.cloneCell(cur) || {};
          const v = App.value(block.si, srcR, srcC);
          obj.v = cut ? (src ? src.v : '') : v === null ? '' : E.isErr(v) ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : (/^[=']/.test(v) || typeof E.parseLiteral(v).v === 'number' ? "'" + v : v);
        } else if (mode === 'format') {
          obj = App.cloneCell(cur) || { v: '' };
          if (src && src.s) obj.s = App.cloneCell(src.s); else delete obj.s;
        } else if (mode === 'formula') {
          obj = App.cloneCell(cur) || {};
          obj.v = src ? src.v : '';
          if (!cut && typeof obj.v === 'string' && obj.v[0] === '=') obj.v = E.shiftFormula(obj.v, r - srcR, c - srcC);
        } else {
          obj = App.cloneCell(src);
          if (obj && !cut && typeof obj.v === 'string' && obj.v[0] === '=') obj.v = E.shiftFormula(obj.v, r - srcR, c - srcC);
        }
        if (r <= sh.rows + 5000 && c <= 18278) App.setCellObj(sh, r, c, obj && Object.keys(obj).length ? obj : null);
      }
    }
    if (mode === 'all' && !transpose) for (const g of block.merges) sh.merges.push({ r1: g.r1 + r0, c1: g.c1 + c0, r2: g.r2 + r0, c2: g.c2 + c0 });
    if (r0 + h - 1 > sh.rows) sh.rows = r0 + h - 1;
    if (c0 + w - 1 > sh.cols) sh.cols = c0 + w - 1;
    return { r1: r0, c1: c0, r2: r0 + h - 1, c2: c0 + w - 1 };
  };

  // Região contígua de dados ao redor de uma célula (para filtros, Ctrl+A etc.)
  App.dataRegion = (si, r, c) => {
    const sh = doc.sheets[si];
    const filled = (rr, cc) => rr >= 1 && cc >= 1 && App.raw(sh, rr, cc) !== '';
    let R = { r1: r, c1: c, r2: r, c2: c };
    let grew = true, guard = 0;
    while (grew && guard++ < 500) {
      grew = false;
      const tryEdge = (fn) => { if (fn()) grew = true; };
      tryEdge(() => { for (let cc = R.c1 - 1; cc <= R.c2 + 1; cc++) if (filled(R.r1 - 1, cc)) { R.r1--; return true; } return false; });
      tryEdge(() => { for (let cc = R.c1 - 1; cc <= R.c2 + 1; cc++) if (filled(R.r2 + 1, cc)) { R.r2++; return true; } return false; });
      tryEdge(() => { for (let rr = R.r1 - 1; rr <= R.r2 + 1; rr++) if (filled(rr, R.c1 - 1)) { R.c1--; return true; } return false; });
      tryEdge(() => { for (let rr = R.r1 - 1; rr <= R.r2 + 1; rr++) if (filled(rr, R.c2 + 1)) { R.c2++; return true; } return false; });
    }
    return R;
  };

  // Converte "A1:B5" ou "Página2!A1" em retângulo
  App.parseRange = (text) => {
    let toks;
    try { toks = E.tokenize(String(text).trim().replace(/^=/, '')); } catch (e) { return null; }
    if (toks.length !== 2 || toks[0].t !== 'ref') return null;
    const { ref, sheet } = toks[0];
    const si = sheet ? App.wb.sheetIndex(sheet) : doc.active;
    if (si < 0) return null;
    const sh = doc.sheets[si];
    let R;
    if (ref.kind === 'cell') R = { r1: ref.r1, c1: ref.c1, r2: ref.r1, c2: ref.c1 };
    else if (ref.kind === 'range') R = { r1: ref.r1, c1: ref.c1, r2: ref.r2 === null ? sh.rows : ref.r2, c2: ref.c2 };
    else if (ref.kind === 'cols') R = { r1: 1, c1: ref.c1, r2: sh.rows, c2: ref.c2 };
    else R = { r1: ref.r1, c1: 1, r2: ref.r2, c2: sh.cols };
    return { si, R: { r1: Math.min(R.r1, R.r2), r2: Math.max(R.r1, R.r2), c1: Math.min(R.c1, R.c2), c2: Math.max(R.c1, R.c2) } };
  };
  App.rangeText = (R, sheetName) => {
    const a = addr(R.r1, R.c1), b = addr(R.r2, R.c2);
    return (sheetName ? E.quoteSheet(sheetName) + '!' : '') + (a === b ? a : a + ':' + b);
  };
})();
