// Editor de células e barra de fórmulas: referências coloridas, modo apontar,
// autocompletar de funções, ajuda de argumentos e F4 para referências absolutas.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  App.esc = esc;

  const ed = { active: false, si: 0, r: 1, c: 1, mode: 'enter', point: null, pointCell: null, ac: [], acIndex: 0, original: '' };
  let box, ta, mirror, bar, barMirror, acEl, helpEl;

  App.editing = () => ed.active;
  App.editState = ed;

  // ---------- Início e fim da edição ----------
  function start(opts) {
    opts = opts || {};
    if (ed.active) return;
    const sh = App.sheet();
    const g = App.mergeAt(sh, App.sel.ar, App.sel.ac);
    const er = g ? g.r1 : App.sel.ar, ec = g ? g.c1 : App.sel.ac;
    if (App.editGuard) { const err = App.editGuard(sh, er, ec); if (err) { App.emit('notify', err); if (opts.from === 'bar') bar.blur(); App.grid.focus(); return; } }
    ed.r = er; ed.c = ec;
    ed.si = doc.active;
    ed.mode = opts.mode || 'enter';
    ed.point = null; ed.pointCell = null;
    const raw = App.raw(sh, ed.r, ed.c);
    ed.original = raw;
    const text = opts.initial !== undefined ? opts.initial : raw;
    ed.active = true;
    App.grid.reveal(ed.r, ed.c);
    setText(text, text.length);
    place();
    box.hidden = false;
    if (opts.from === 'bar') { bar.focus(); }
    else { ta.focus({ preventScroll: true }); ta.setSelectionRange(text.length, text.length); }
    update();
    App.grid.draw();
    App.emit('editStart');
  }
  function place() {
    if (!ed.active) return;
    if (doc.active !== ed.si) { box.style.visibility = 'hidden'; return; }
    const rc = App.grid.cellRect(ed.r, ed.c);
    const st = App.gridState;
    const s = App.effectiveStyle(App.sheet(), ed.si, ed.r, ed.c, App.style(App.sheet(), ed.r, ed.c));
    const visible = rc.x + 4 >= st.hdrW && rc.y + 4 >= st.hdrH && rc.x < st.vw && rc.y < st.vh;
    box.style.visibility = visible ? 'visible' : 'hidden';
    const font = App.fontFor(s);
    for (const el of [ta, mirror]) {
      el.style.font = font;
      el.style.textAlign = 'left';
      el.style.textDecoration = [s.u ? 'underline' : '', s.st ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    }
    mirror.style.color = s.color || '#000';
    box.style.background = s.bg || '#ffffff';
    box.style.left = rc.x + 'px';
    box.style.top = rc.y + 'px';
    box.style.minWidth = rc.w + 1 + 'px';
    box.style.minHeight = rc.h + 1 + 'px';
    // cresce para a direita conforme o texto, depois quebra a linha
    const maxW = Math.max(rc.w + 1, st.vw - rc.x - 8);
    // mede a largura do texto em si (com width:auto o espelho herdava a largura da caixa e ela crescia sem parar)
    mirror.style.width = 'max-content';
    mirror.style.whiteSpace = 'pre';
    const natural = Math.ceil(mirror.getBoundingClientRect().width) + 16;
    const w = Math.min(maxW, Math.max(rc.w + 1, natural));
    mirror.style.whiteSpace = 'pre-wrap';
    box.style.width = w + 'px';
    mirror.style.width = '100%';
    ta.style.height = '0px';
    const hgt = Math.max(rc.h + 1, mirror.scrollHeight);
    box.style.height = hgt + 'px';
    ta.style.height = '100%';
  }
  function close() {
    ed.active = false;
    box.hidden = true;
    hideAc(); hideHelp();
    App.grid.setRefs([]);
    bar.blur();
    if (doc.active !== ed.si) { doc.active = ed.si; App.emit('sheet'); }
    App.grid.focus();
    App.grid.draw();
    App.emit('editEnd');
    App.emit('selection');
  }

  // Normaliza a fórmula: nomes de função e referências em maiúsculas, parênteses fechados
  function normalizeFormula(text) {
    if (text[0] !== '=' || text.length < 2) return text;
    let body = text.slice(1);
    let toks;
    try { toks = E.tokenize(body); } catch (e) { return text; }
    let out = '', last = 0;
    for (const t of toks) {
      if (t.t === 'func' || (t.t === 'ref' && t.sheet === null) || t.t === 'bool') {
        const frag = body.slice(t.s, t.e);
        out += body.slice(last, t.s) + frag.toUpperCase();
        last = t.e;
      }
    }
    body = out + body.slice(last);
    let depth = 0, inStr = false;
    for (const ch of body) { if (ch === '"') inStr = !inStr; else if (!inStr) { if (ch === '(') depth++; else if (ch === ')') depth--; } }
    if (!inStr && depth > 0) body += ')'.repeat(depth);
    return '=' + body;
  }

  function commit(dr, dc) {
    if (!ed.active) return true;
    let text = ta.value;
    const sh = App.doc.sheets[ed.si];
    if (text !== ed.original) {
      if (text[0] === '=') text = normalizeFormula(text);
      const dv = App.dvAt(sh, ed.r, ed.c);
      if (dv && dv.reject && !App.validate(sh, ed.r, ed.c, text)) {
        App.emit('notify', dv.help || 'Entrada inválida: o conteúdo não atende à regra de validação desta célula.');
        return false;
      }
      const r = ed.r, c = ed.c;
      App.change('Editar célula', () => {
        App.setRaw(sh, r, c, text);
        const st = App.style(sh, r, c);
        if (!st.nf) { const f = App.autoFormatFor(text); if (f) App.setStyle(sh, r, c, (s) => { s.nf = f; }); }
        if (r > sh.rows) sh.rows = r;
        // linhas com quebra de texto crescem automaticamente
        if (text.includes('\n') || st.wrap === 'wrap' || (sh.rowH[r] && sh.rowH[r] > App.DEF_H)) App.autoFitRows(sh, [r]);
      });
    }
    const { r, c } = ed;
    close();
    if (dr || dc) App.moveAfterCommit(r, c, dr, dc);
    return true;
  }
  function cancel() { if (ed.active) close(); }

  // ---------- Texto, espelho colorido e realces ----------
  function setText(text, caret) {
    ta.value = text; bar.value = text;
    if (caret !== undefined) {
      const el = document.activeElement === bar ? bar : ta;
      el.setSelectionRange(caret, caret);
    }
    renderMirrors();
  }
  // Em outra página (apontando referências), o editor da célula fica oculto e a barra de fórmulas assume
  function activeInput() { return document.activeElement === bar || (ed.active && doc.active !== ed.si) ? bar : ta; }
  function caretPos() { return activeInput().selectionStart; }

  function refColors(text) {
    const refs = E.refsInFormula(text);
    const keys = new Map();
    return refs.map((r) => {
      const k = r.text.replace(/\$/g, '').toUpperCase();
      if (!keys.has(k)) keys.set(k, App.REF_COLORS[keys.size % App.REF_COLORS.length]);
      return Object.assign(r, { color: keys.get(k) });
    });
  }
  function renderMirrors() {
    const text = ta.value;
    let html;
    if (text[0] === '=') {
      const refs = refColors(text);
      html = '';
      let last = 0;
      for (const r of refs) {
        html += esc(text.slice(last, r.s)) + `<span style="color:${r.color}">${esc(text.slice(r.s, r.e))}</span>`;
        last = r.e;
      }
      html += esc(text.slice(last));
    } else html = esc(text);
    mirror.innerHTML = html + '​';
    barMirror.innerHTML = html + '​';
    barMirror.scrollLeft = bar.scrollLeft;
  }
  function updateRefHighlights() {
    const text = ta.value;
    if (text[0] !== '=') { App.grid.setRefs([]); return; }
    const list = [];
    for (const r of refColors(text)) {
      const si = r.sheet ? App.wb.sheetIndex(r.sheet) : ed.si;
      if (si < 0) continue;
      const sh = doc.sheets[si];
      const ref = r.ref;
      let R;
      if (ref.kind === 'cell') R = { r1: ref.r1, c1: ref.c1, r2: ref.r1, c2: ref.c1 };
      else if (ref.kind === 'range') R = { r1: ref.r1, c1: ref.c1, r2: ref.r2 === null ? sh.rows : ref.r2, c2: ref.c2 };
      else if (ref.kind === 'cols') R = { r1: 1, c1: ref.c1, r2: sh.rows, c2: ref.c2 };
      else R = { r1: ref.r1, c1: 1, r2: ref.r2, c2: sh.cols };
      R = { r1: Math.min(R.r1, R.r2), r2: Math.max(R.r1, R.r2), c1: Math.min(R.c1, R.c2), c2: Math.max(R.c1, R.c2) };
      list.push({ si, R, color: r.color, active: ed.point && ed.point.start === r.s });
    }
    App.grid.setRefs(list);
  }
  function update() {
    renderMirrors();
    place();
    updateRefHighlights();
    updateAc();
    updateHelp();
    App.emit('editText', ta.value);
  }

  // ---------- Modo apontar ----------
  function wantsPoint() {
    if (!ed.active || ta.value[0] !== '=') return false;
    const el = activeInput();
    if (el.selectionStart !== el.selectionEnd && !(ed.point && el.selectionStart === ed.point.start)) return false;
    const caret = el.selectionStart;
    if (ed.point && caret === ed.point.end) return true;
    const before = ta.value.slice(0, caret).replace(/\s+$/, '');
    return /[=(+\-*/^&<>;,:{\\]$/.test(before);
  }
  App.editorWantsPoint = wantsPoint;
  function refTextFor(a, b) {
    const sh = doc.sheets[doc.active];
    let txt;
    if (a.area === 'colHdr') txt = E.numToCol(Math.min(a.c, b.c)) + ':' + E.numToCol(Math.max(a.c, b.c));
    else if (a.area === 'rowHdr') txt = Math.min(a.r, b.r) + ':' + Math.max(a.r, b.r);
    else {
      let R = { r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
      R = App.expandToMerges(sh, R);
      txt = App.rangeText(R);
    }
    if (doc.active !== ed.si) txt = E.quoteSheet(sh.name) + '!' + txt;
    return txt;
  }
  function insertPoint(txt) {
    const el = activeInput();
    const text = ta.value;
    let s, e;
    if (ed.point && (el.selectionStart === ed.point.end || el.selectionStart === ed.point.start)) { s = ed.point.start; e = ed.point.end; }
    else { s = el.selectionStart; e = el.selectionEnd; }
    const nt = text.slice(0, s) + txt + text.slice(e);
    ed.point = { start: s, end: s + txt.length };
    setText(nt, s + txt.length);
    update();
  }
  // Chamado pela grade ao clicar/arrastar durante a edição de fórmula
  App.pointRef = (a, b, extending, finished) => {
    if (finished) { activeInput().focus({ preventScroll: true }); return; }
    if (!a) return;
    ed.pointCell = { r: b.r, c: b.c, ar: a.r, ac: a.c, area: a.area };
    insertPoint(refTextFor(a, b));
    activeInput().focus({ preventScroll: true });
  };
  function keyPoint(dr, dc, extend) {
    let pc = ed.pointCell;
    if (!pc || !ed.point || activeInput().selectionStart !== ed.point.end) {
      pc = { r: ed.r, c: ed.c, ar: ed.r, ac: ed.c, area: 'cell' };
      if (doc.active !== ed.si) pc = { r: App.sel.ar, c: App.sel.ac, ar: App.sel.ar, ac: App.sel.ac, area: 'cell' };
      ed.point = null;
    }
    const sh = App.sheet();
    let r = pc.r + dr, c = pc.c + dc;
    r = Math.max(1, Math.min(sh.rows, r)); c = Math.max(1, Math.min(sh.cols, c));
    if (!extend) { pc.ar = r; pc.ac = c; }
    pc.r = r; pc.c = c;
    ed.pointCell = pc;
    insertPoint(refTextFor({ area: 'cell', r: pc.ar, c: pc.ac }, { area: 'cell', r, c }));
    App.grid.reveal(r, c);
  }

  // F4: alterna A1 -> $A$1 -> A$1 -> $A1 -> A1 na referência sob o cursor
  function cycleAbsolute() {
    const text = ta.value;
    if (text[0] !== '=') return;
    const caret = caretPos();
    const ref = E.refsInFormula(text).find((r) => caret >= r.s && caret <= r.e);
    if (!ref) return;
    const t = ref.text;
    const bang = t.lastIndexOf('!');
    const prefix = bang >= 0 ? t.slice(0, bang + 1) : '';
    const parts = (bang >= 0 ? t.slice(bang + 1) : t).split(':').map((p) => {
      const m = /^(\$?)([A-Za-z]{0,3})(\$?)(\d*)$/.exec(p);
      return m ? { col: m[2], row: m[4], ac: !!m[1] && !!m[2], ar: m[2] ? !!m[3] : !!m[1] } : null;
    });
    if (parts.some((p) => !p)) return;
    // estado (bit 2 = coluna fixa, bit 1 = linha fixa): A1 -> $A$1 -> A$1 -> $A1 -> A1
    const p0 = parts[0];
    let next;
    if (p0.col && p0.row) next = { 0: 3, 3: 1, 1: 2, 2: 0 }[(p0.ac ? 2 : 0) + (p0.ar ? 1 : 0)];
    else if (p0.col) next = p0.ac ? 0 : 2;
    else next = p0.ar ? 0 : 1;
    const fmt = (p) => (p.col ? (next & 2 ? '$' : '') + p.col : '') + (p.row ? (next & 1 ? '$' : '') + p.row : '');
    const out = parts.map(fmt).join(':');
    const nt = text.slice(0, ref.s) + prefix + out + text.slice(ref.e);
    setText(nt, ref.s + prefix.length + out.length);
    update();
  }

  // ---------- Autocompletar ----------
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  function currentWord() {
    const text = ta.value;
    if (text[0] !== '=') return null;
    const caret = caretPos();
    const before = text.slice(0, caret);
    // não sugere dentro de textos entre aspas
    if ((before.match(/"/g) || []).length % 2) return null;
    const m = /([\p{L}_][\p{L}\p{N}_.]*)$/u.exec(before);
    if (!m) return null;
    const pre = before.slice(0, before.length - m[1].length);
    if (!/[=(+\-*/^&<>;,{\s]$/.test(pre) && pre !== '=') return null;
    if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
    return { word: m[1], start: before.length - m[1].length, end: caret };
  }
  function updateAc() {
    const w = currentWord();
    if (!w || w.word.length < 1) { hideAc(); return; }
    const q = fold(w.word);
    const list = [];
    const seen = new Set();
    for (const info of E.INFO) {
      const pt = fold(info.pt), en = info.name;
      if ((pt.startsWith(q) || en.startsWith(q)) && !seen.has(info.name)) {
        seen.add(info.name);
        list.push(Object.assign({ show: pt.startsWith(q) ? info.pt : info.name }, info));
      }
    }
    for (const n of Object.keys(doc.names)) if (fold(n).startsWith(q)) list.push({ show: n, args: null, desc: 'Intervalo nomeado: ' + doc.names[n], named: true });
    list.sort((a, b) => (a.show.length - b.show.length) || a.show.localeCompare(b.show));
    ed.ac = list.slice(0, 8);
    ed.acWord = w;
    if (!ed.ac.length || (ed.ac.length === 1 && fold(ed.ac[0].show) === q && !ed.ac[0].args)) { hideAc(); return; }
    ed.acIndex = Math.min(ed.acIndex, ed.ac.length - 1);
    renderAc();
  }
  function renderAc() {
    acEl.innerHTML = ed.ac.map((it, i) =>
      `<div class="ac-item${i === ed.acIndex ? ' on' : ''}" data-i="${i}"><div class="ac-name"><b>${esc(it.show)}</b>${it.args !== null ? `<span>(${esc(it.args)})</span>` : ''}</div>${i === ed.acIndex ? `<div class="ac-desc">${esc(it.desc)}</div>` : ''}</div>`
    ).join('');
    positionPopup(acEl);
    acEl.hidden = false;
  }
  function hideAc() { ed.ac = []; ed.acIndex = 0; if (acEl) acEl.hidden = true; }
  function acceptAc() {
    const it = ed.ac[ed.acIndex];
    if (!it) return false;
    const w = ed.acWord;
    const text = ta.value;
    const ins = it.named ? it.show : it.show + '(';
    const after = text.slice(w.end);
    const skipParen = !it.named && after[0] === '(';
    const nt = text.slice(0, w.start) + (skipParen ? it.show : ins) + after;
    setText(nt, w.start + ins.length);
    hideAc();
    update();
    return true;
  }
  function positionPopup(el) {
    const onBar = document.activeElement === bar;
    const ref = onBar ? bar.getBoundingClientRect() : box.getBoundingClientRect();
    el.style.left = Math.min(ref.left, window.innerWidth - 380) + 'px';
    el.style.top = ref.bottom + 2 + 'px';
  }

  // ---------- Ajuda de argumentos ----------
  function updateHelp() {
    const text = ta.value;
    if (text[0] !== '=' || (ed.ac.length && !acEl.hidden)) { hideHelp(); return; }
    const caret = caretPos();
    const before = text.slice(1, caret);
    // encontra a chamada de função mais interna aberta antes do cursor
    const stack = [];
    let inStr = false, m;
    const re = /"|([\p{L}_][\p{L}\p{N}_.]*)\s*\(|\(|\)|[;,\\]/gu;
    while ((m = re.exec(before))) {
      const t = m[0];
      if (t === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (m[1]) stack.push({ name: m[1].toUpperCase(), arg: 0 });
      else if (t === '(') stack.push({ name: null, arg: 0 });
      else if (t === ')') stack.pop();
      else if (stack.length && (t === ';' || t === ',')) stack[stack.length - 1].arg++;
    }
    const fnCall = [...stack].reverse().find((s) => s.name);
    if (!fnCall) { hideHelp(); return; }
    const canon = E.ALIASES[fnCall.name] || fnCall.name;
    const info = E.FUNCTIONS[canon];
    if (!info) { hideHelp(); return; }
    const args = info.args ? info.args.split(/;\s*/) : [];
    let idx = fnCall.arg;
    const repeatAt = args.findIndex((a) => a.includes('…'));
    if (repeatAt >= 0 && idx >= repeatAt) idx = repeatAt;
    const argHtml = args.map((a, i) => (i === Math.min(idx, args.length - 1) ? `<b class="cur">${esc(a)}</b>` : esc(a))).join('; ');
    helpEl.innerHTML = `<div class="help-sig"><b>${esc(info.pt)}</b>(${argHtml})</div><div class="help-desc">${esc(info.desc)}</div>` +
      (info.pt !== canon ? `<div class="help-en">Em inglês: ${esc(canon)}</div>` : '');
    positionPopup(helpEl);
    helpEl.hidden = false;
  }
  function hideHelp() { if (helpEl) helpEl.hidden = true; }

  // ---------- Teclado ----------
  function onKey(e) {
    if (!ed.active) return;
    const isBar = e.target === bar;
    if (!acEl.hidden && ed.ac.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); ed.acIndex = (ed.acIndex + 1) % ed.ac.length; renderAc(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); ed.acIndex = (ed.acIndex - 1 + ed.ac.length) % ed.ac.length; renderAc(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.altKey && !e.ctrlKey)) { e.preventDefault(); acceptAc(); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideAc(); return; }
    }
    switch (e.key) {
      case 'Enter':
        if (e.altKey || e.ctrlKey || e.metaKey) { e.preventDefault(); insertText('\n'); return; }
        e.preventDefault(); commit(e.shiftKey ? -1 : 1, 0); return;
      case 'Tab': e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); return;
      case 'Escape': e.preventDefault(); cancel(); return;
      case 'F2': e.preventDefault(); ed.mode = ed.mode === 'enter' ? 'edit' : 'enter'; App.emit('notify', ed.mode === 'edit' ? 'Modo de edição' : 'Modo de entrada'); return;
      case 'F4': e.preventDefault(); cycleAbsolute(); return;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (wantsPoint() && (ed.mode === 'enter' || ed.point)) { e.preventDefault(); keyPoint(d[0], d[1], e.shiftKey); return; }
        if (ed.mode === 'enter' && !isBar && ta.value.indexOf('\n') < 0) { e.preventDefault(); commit(d[0], d[1]); return; }
        return;
      }
    }
  }
  function insertText(s) {
    const el = activeInput();
    const a = el.selectionStart, b = el.selectionEnd;
    const nt = ta.value.slice(0, a) + s + ta.value.slice(b);
    setText(nt, a + s.length);
    update();
  }
  function onInput(e) {
    const src = e.target;
    const other = src === ta ? bar : ta;
    other.value = src.value;
    ed.point = null; ed.pointCell = null;
    if (src === bar && ed.mode === 'enter') ed.mode = 'edit';
    update();
  }

  // ---------- Inicialização ----------
  function init() {
    box = $('cell-editor-box'); ta = $('cell-editor'); mirror = $('cell-editor-mirror');
    bar = $('formula-input'); barMirror = $('formula-mirror');
    acEl = $('autocomplete'); helpEl = $('fn-help');
    ta.addEventListener('keydown', onKey);
    bar.addEventListener('keydown', onKey);
    ta.addEventListener('input', onInput);
    bar.addEventListener('input', onInput);
    for (const el of [ta, bar]) {
      el.addEventListener('click', () => { if (ed.active) { ed.point = null; if (el === ta) ed.mode = 'edit'; updateHelp(); updateAc(); } });
      el.addEventListener('keyup', (e) => { if (/^(Arrow|Home|End)/.test(e.key) && ed.active && !wantsPoint()) { updateHelp(); } });
    }
    bar.addEventListener('scroll', () => { barMirror.scrollLeft = bar.scrollLeft; });
    bar.addEventListener('focus', () => { if (!ed.active) start({ mode: 'edit', from: 'bar' }); });
    acEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const it = e.target.closest('.ac-item');
      if (it) { ed.acIndex = +it.dataset.i; acceptAc(); }
    });
    App.on('viewport', place);
    App.on('selection', () => { if (!ed.active) { const sh = App.sheet(); const g = App.mergeAt(sh, App.sel.ar, App.sel.ac); const v = App.raw(sh, g ? g.r1 : App.sel.ar, g ? g.c1 : App.sel.ac); bar.value = v; renderBarOnly(v); } });
    App.on('sheet', () => {
      if (!ed.active) return;
      place();
      if (doc.active !== ed.si && document.activeElement !== bar) {
        const a = ta.selectionStart, b = ta.selectionEnd;
        bar.focus();
        bar.setSelectionRange(a, b);
      }
    });
  }
  function renderBarOnly(text) {
    let html;
    if (text[0] === '=') {
      html = ''; let last = 0;
      for (const r of refColors(text)) { html += esc(text.slice(last, r.s)) + `<span style="color:${r.color}">${esc(text.slice(r.s, r.e))}</span>`; last = r.e; }
      html += esc(text.slice(last));
    } else html = esc(text);
    barMirror.innerHTML = html + '​';
    barMirror.scrollLeft = 0;
  }

  App.startEdit = start;
  App.commitEdit = (dr, dc) => commit(dr || 0, dc || 0);
  App.cancelEdit = cancel;
  App.editor = { init, insertText, place };
})(window.App);
