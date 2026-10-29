// Arquivos: abrir, importar (.xlsx, .ods, .csv, .tsv, .json), baixar, copiar, imprimir e compartilhar por link.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const def = (id, label, fn, sc) => App.commands.def(id, label, fn, sc);
  const safeName = (s) => (s || 'planilha').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'planilha';

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // ---------- SheetJS sob demanda ----------
  let xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxPromise = null; reject(new Error('Não foi possível carregar o leitor de Excel. Verifique a conexão.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  // ---------- Conversão de sintaxe de fórmulas (inglês <-> pt-BR) ----------
  // Inglês: separador "," e decimal "."; pt-BR: separador ";" e decimal ",". Matrizes: {1,2;3,4} <-> {1\2;3\4}
  function enToPt(f) {
    let out = '', q = false, brace = 0;
    for (let i = 0; i < f.length; i++) {
      const ch = f[i];
      if (ch === '"') { q = !q; out += ch; continue; }
      if (q) { out += ch; continue; }
      if (ch === "'" ) { const j = f.indexOf("'", i + 1); if (j > i) { out += f.slice(i, j + 1); i = j; continue; } }
      if (ch === '{') brace++;
      if (ch === '}') brace--;
      if (ch === ',') { out += brace ? '\\' : ';'; continue; }
      if (ch === '.' && /\d/.test(f[i - 1] || '') && /\d/.test(f[i + 1] || '') && !/[A-Za-z_]/.test(prevWordChar(f, i))) { out += ','; continue; }
      out += ch;
    }
    return out;
  }
  function prevWordChar(f, i) { let j = i - 1; while (j >= 0 && /\d/.test(f[j])) j--; return j >= 0 ? f[j] : ''; }
  function ptToEn(formula) {
    let body = formula.replace(/^=/, '');
    // nomes de função em inglês
    try {
      const toks = E.tokenize(body);
      let out = '', last = 0;
      for (const t of toks) if (t.t === 'func') { out += body.slice(last, t.s) + (E.ALIASES[t.v] || t.v) + '('; last = t.e; }
      body = out + body.slice(last);
    } catch (e) { /* mantém */ }
    let out = '', q = false, brace = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '"') { q = !q; out += ch; continue; }
      if (q) { out += ch; continue; }
      if (ch === "'") { const j = body.indexOf("'", i + 1); if (j > i) { out += body.slice(i, j + 1); i = j; continue; } }
      if (ch === '{') brace++;
      if (ch === '}') brace--;
      if (ch === ',' && /\d/.test(body[i - 1] || '') && /\d/.test(body[i + 1] || '')) { out += '.'; continue; }
      if (ch === ';') { out += brace ? ';' : ','; continue; }
      if (ch === '\\' && brace) { out += ','; continue; }
      out += ch;
    }
    return out;
  }
  App.formulaToEnglish = ptToEn;

  // ---------- Leitura de arquivos ----------
  function parseDelimited(text, sep) {
    text = text.replace(/^﻿/, '');
    if (!sep) {
      const first = text.split(/\r?\n/).slice(0, 5).join('\n');
      const counts = [[',', (first.match(/,/g) || []).length], [';', (first.match(/;/g) || []).length], ['\t', (first.match(/\t/g) || []).length]];
      sep = counts.sort((a, b) => b[1] - a[1])[0][1] ? counts[0][0] : ',';
    }
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"' && field === '') q = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function sheetFromRows(name, rows) {
    const sh = App.newSheet(name);
    let maxC = 0;
    rows.forEach((row, r) => row.forEach((v, c) => {
      if (v === '') return;
      const cell = { v };
      const f = App.autoFormatFor(v);
      if (f) cell.s = { nf: f };
      sh.cells[E.addrToStr(r + 1, c + 1)] = cell;
      maxC = Math.max(maxC, c + 1);
    }));
    sh.rows = Math.max(1000, rows.length + 100);
    sh.cols = Math.max(26, maxC);
    return sh;
  }
  const argb = (c) => (c && c.rgb && /^[0-9A-F]{6,8}$/i.test(c.rgb) ? '#' + c.rgb.slice(-6).toLowerCase() : null);
  function sheetFromXLSX(XLSX, ws, name) {
    const sh = App.newSheet(name);
    const ref = ws['!ref'];
    if (!ref) return sh;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const x = ws[XLSX.utils.encode_cell({ r, c })];
        if (!x) continue;
        const cell = {};
        if (x.f) cell.v = '=' + enToPt(x.f);
        else if (x.t === 'b') cell.v = x.v ? 'TRUE' : 'FALSE';
        else if (x.t === 'e') cell.v = x.w || '#N/A';
        else if (x.t === 'n') cell.v = String(x.v);
        else if (x.t === 'd') cell.v = String((x.v.getTime() - E.EPOCH) / 86400000);
        else if (x.v !== undefined && x.v !== null) { const s = String(x.v); cell.v = /^[=']/.test(s) || typeof E.parseLiteral(s).v === 'number' ? "'" + s : s; }
        const s = {};
        if (x.z && x.z !== 'General' && (x.t === 'n' || x.t === 'd' || x.f)) s.nf = x.z;
        if (x.s) {
          if (x.s.fgColor && argb(x.s.fgColor) && x.s.patternType !== 'none') s.bg = argb(x.s.fgColor);
          if (x.s.font) { if (x.s.font.bold) s.b = true; if (x.s.font.italic) s.i = true; if (argb(x.s.font.color)) s.color = argb(x.s.font.color); }
        }
        if (Object.keys(s).length) cell.s = s;
        if (x.l && x.l.Target) cell.link = x.l.Target;
        if (x.c && x.c.length) cell.note = x.c.map((cm) => cm.t).join('\n');
        if (cell.v !== undefined || cell.s || cell.note) sh.cells[E.addrToStr(r + 1, c + 1)] = Object.assign({ v: '' }, cell);
      }
    }
    for (const m of ws['!merges'] || []) sh.merges.push({ r1: m.s.r + 1, c1: m.s.c + 1, r2: m.e.r + 1, c2: m.e.c + 1 });
    (ws['!cols'] || []).forEach((col, i) => { if (!col) return; const px = col.wpx || (col.wch ? col.wch * 7 + 5 : null); if (px) sh.colW[i + 1] = Math.round(px); if (col.hidden) sh.hiddenCols[i + 1] = true; });
    (ws['!rows'] || []).forEach((row, i) => { if (!row) return; if (row.hpx) sh.rowH[i + 1] = Math.round(row.hpx); if (row.hidden) sh.hiddenRows[i + 1] = true; });
    sh.rows = Math.max(1000, range.e.r + 101);
    sh.cols = Math.max(26, range.e.c + 1);
    return sh;
  }
  // Lê um arquivo e retorna { title, sheets }
  function readFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const ext = (/\.([^.]+)$/.exec(file.name) || [, ''])[1].toLowerCase();
    if (ext === 'json') {
      return file.text().then((t) => {
        const d = JSON.parse(t);
        if (!d || !Array.isArray(d.sheets)) throw new Error('Este arquivo .json não é um backup do Planilhas.');
        return { title: d.title || name, sheets: d.sheets.map(App.normalizeSheet), names: d.names || {}, data: d };
      });
    }
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      return file.text().then((t) => ({ title: name, sheets: [sheetFromRows(name.slice(0, 90) || 'Página1', parseDelimited(t, ext === 'tsv' ? '\t' : null))] }));
    }
    return loadXLSX().then((XLSX) => file.arrayBuffer().then((buf) => {
      const wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellStyles: true, cellNF: true, cellDates: false });
      const sheets = wb.SheetNames.map((n) => sheetFromXLSX(XLSX, wb.Sheets[n], n));
      return { title: name, sheets: sheets.length ? sheets : [App.newSheet('Página1')] };
    }));
  }

  // ---------- Abrir / importar ----------
  function pickFile(accept, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept || '.xlsx,.xls,.ods,.csv,.tsv,.txt,.json';
    inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }
  function openAsNewDoc(file) {
    notify('Abrindo ' + file.name + '…');
    readFile(file).then((res) => {
      App.newDocument(res.data || { title: res.title, sheets: res.sheets, names: res.names || {} });
      notify(`"${res.title}" aberto.`);
    }).catch((e) => notify(e.message || 'Não foi possível abrir este arquivo.'));
  }
  function openDialog() {
    const list = App.readIndex();
    const fmt = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const m = App.ui.modal({
      title: 'Abrir um arquivo', width: '720px', cls: 'modal-tall',
      body: `<div class="sp-tabs open-tabs"><button class="on" data-t="recent">Neste navegador</button><button data-t="upload">Fazer upload</button></div>
        <div data-pane="recent"><input class="input" id="od-q" placeholder="Pesquisar planilhas"><div class="od-list" id="od-list"></div></div>
        <div data-pane="upload" hidden><div class="drop-zone" id="od-drop">${icon('cloud', 40)}<p>Arraste um arquivo para cá</p><p class="sp-hint">.xlsx, .xls, .ods, .csv, .tsv ou backup .json</p><button class="btn btn-primary" id="od-pick">Procurar no dispositivo</button></div></div>`,
      onOpen: (d) => {
        const render = () => {
          const q = d.querySelector('#od-q').value.toLowerCase();
          const items = App.readIndex().filter((x) => (x.title || '').toLowerCase().includes(q));
          d.querySelector('#od-list').innerHTML = items.length ? items.map((x) => `<div class="od-item${x.id === App.docId ? ' cur' : ''}" data-id="${x.id}">${icon('sheetIcon', 26)}<div><b>${esc(x.title || 'Sem título')}</b><small>Modificado em ${fmt(x.updated)}${x.id === App.docId ? ' · aberto agora' : ''}</small></div>${x.id !== App.docId ? `<button class="icon-btn od-del" title="Excluir do navegador">${icon('close', 16)}</button>` : ''}</div>`).join('') : '<p class="sp-hint">Nenhuma planilha encontrada.</p>';
        };
        render();
        d.querySelector('#od-q').addEventListener('input', render);
        d.querySelector('#od-list').addEventListener('click', (e) => {
          const it = e.target.closest('.od-item');
          if (!it) return;
          if (e.target.closest('.od-del')) {
            const entry = list.find((x) => x.id === it.dataset.id) || App.readIndex().find((x) => x.id === it.dataset.id);
            App.ui.confirm('Excluir planilha?', `"${entry ? entry.title : ''}" será removida deste navegador. Essa ação não pode ser desfeita.`, 'Excluir', () => { App.deleteDoc(it.dataset.id); openDialog(); });
            m.close();
            return;
          }
          m.close();
          if (it.dataset.id !== App.docId) { App.openDoc(it.dataset.id); notify('Planilha aberta.'); }
        });
        d.querySelectorAll('.open-tabs button').forEach((b) => b.onclick = () => {
          d.querySelectorAll('.open-tabs button').forEach((x) => x.classList.toggle('on', x === b));
          d.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.t; });
        });
        const drop = d.querySelector('#od-drop');
        d.querySelector('#od-pick').onclick = () => pickFile(null, (f) => { m.close(); openAsNewDoc(f); });
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { m.close(); openAsNewDoc(f); } });
      },
    });
  }
  function importDialog() {
    pickFile(null, (file) => {
      App.ui.modal({
        title: 'Importar arquivo', width: '460px',
        body: `<p class="sp-hint">Arquivo: <b>${esc(file.name)}</b></p>
          <label class="check"><input type="radio" name="imp" value="new" checked> Criar nova planilha</label>
          <label class="check"><input type="radio" name="imp" value="insert"> Inserir novas páginas</label>
          <label class="check"><input type="radio" name="imp" value="replaceSheet"> Substituir a página atual</label>
          <label class="check"><input type="radio" name="imp" value="replaceAll"> Substituir a planilha inteira</label>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Importar dados', primary: true, action: (d) => {
          const mode = d.querySelector('input[name=imp]:checked').value;
          if (mode === 'new') { openAsNewDoc(file); return; }
          readFile(file).then((res) => {
            App.change('Importar', () => {
              if (mode === 'insert') {
                for (const sh of res.sheets) { sh.name = App.uniqueSheetName(sh.name); doc.sheets.push(sh); }
                doc.active = doc.sheets.length - res.sheets.length;
              } else if (mode === 'replaceSheet') {
                const keepName = App.sheet().name;
                doc.sheets[doc.active] = Object.assign(res.sheets[0], { name: keepName });
              } else {
                doc.sheets = res.sheets; doc.active = 0;
                if (res.names) doc.names = res.names;
              }
            });
            App.emit('sheet');
            notify('Dados importados.');
          }).catch((e) => notify(e.message || 'Não foi possível importar este arquivo.'));
        } }],
      });
    });
  }

  // ---------- Download ----------
  function sheetMatrix(sh, si, display) {
    const used = App.usedRange(sh);
    const rows = [];
    for (let r = 1; r <= used.maxR; r++) {
      const row = [];
      for (let c = 1; c <= used.maxC; c++) {
        const v = App.value(si, r, c);
        row.push(display ? App.fmtValue(v, App.style(sh, r, c).nf || (typeof App.raw(sh, r, c) === 'string' && App.raw(sh, r, c)[0] === '=' ? App.inferFormat(si, App.raw(sh, r, c)) : null)) : v);
      }
      rows.push(row);
    }
    return rows;
  }
  function download(kind) {
    const sh = App.sheet(), si = doc.active;
    const base = safeName(doc.title);
    if (kind === 'json') { downloadBlob(new Blob([App.serialize()], { type: 'application/json' }), base + '.json'); return; }
    if (kind === 'csv' || kind === 'tsv') {
      const sep = kind === 'csv' ? ',' : '\t';
      const text = sheetMatrix(sh, si, true).map((row) => row.map((t) => (/[",\n\r\t]/.test(t) || (sep === ',' && t.includes(',')) ? '"' + t.replace(/"/g, '""') + '"' : t)).join(sep)).join('\r\n');
      downloadBlob(new Blob(['﻿' + text], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8' }), `${base} - ${safeName(sh.name)}.${kind}`);
      return;
    }
    if (kind === 'html') {
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse}td{border:1px solid #d0d0d0;padding:3px 6px;font-size:13px}h2{font-size:16px}</style></head><body>` +
        doc.sheets.map((s, i) => `<h2>${esc(s.name)}</h2>${tableHtml(s, i)}`).join('') + '</body></html>';
      downloadBlob(new Blob([html], { type: 'text/html' }), base + '.html');
      return;
    }
    if (kind === 'xlsx') {
      notify('Gerando arquivo .xlsx…');
      loadXLSX().then((XLSX) => {
        const wb = XLSX.utils.book_new();
        doc.sheets.forEach((s, i) => {
          const ws = {};
          const used = App.usedRange(s);
          for (const a in s.cells) {
            const x = s.cells[a];
            const p = E.parseAddr(a);
            if (!p) continue;
            const key = XLSX.utils.encode_cell({ r: p.row - 1, c: p.col - 1 });
            const v = App.value(i, p.row, p.col);
            const raw = x.v;
            let cell;
            if (typeof raw === 'string' && raw[0] === '=') {
              cell = { f: ptToEn(raw) };
              if (typeof v === 'number') { cell.t = 'n'; cell.v = v; } else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; } else if (E.isErr(v)) { cell.t = 'e'; cell.v = 0x2a; } else { cell.t = 's'; cell.v = v === null ? '' : String(v); }
            } else if (v === null || v === '') { if (!x.s) continue; cell = { t: 's', v: '' }; }
            else if (typeof v === 'number') cell = { t: 'n', v };
            else if (typeof v === 'boolean') cell = { t: 'b', v };
            else cell = { t: 's', v: String(v) };
            const nf = (x.s && x.s.nf) || (typeof raw === 'string' && raw[0] === '=' ? App.inferFormat(i, raw) : null);
            if (nf && nf !== '@') cell.z = nf;
            if (x.link) cell.l = { Target: x.link };
            if (x.note) cell.c = [{ a: 'Planilhas', t: x.note }];
            ws[key] = cell;
          }
          ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, used.maxR - 1), c: Math.max(0, used.maxC - 1) } });
          if (s.merges.length) ws['!merges'] = s.merges.map((g) => ({ s: { r: g.r1 - 1, c: g.c1 - 1 }, e: { r: g.r2 - 1, c: g.c2 - 1 } }));
          const cols = [];
          for (let c = 1; c <= Math.max(used.maxC, 1); c++) cols.push(Object.assign({ wpx: s.colW[c] || App.DEF_W }, s.hiddenCols[c] ? { hidden: true } : {}));
          ws['!cols'] = cols;
          const rows = [];
          for (let r = 1; r <= Math.max(used.maxR, 1); r++) rows.push(s.rowH[r] || s.hiddenRows[r] ? Object.assign({}, s.rowH[r] ? { hpx: s.rowH[r] } : {}, s.hiddenRows[r] ? { hidden: true } : {}) : null);
          ws['!rows'] = rows;
          XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31).replace(/[[\]*?/\\:]/g, '_'));
        });
        XLSX.writeFile(wb, base + '.xlsx');
      }).catch((e) => notify(e.message));
    }
  }
  function tableHtml(sh, si, R) {
    const used = App.usedRange(sh);
    R = R || { r1: 1, c1: 1, r2: Math.max(1, used.maxR), c2: Math.max(1, used.maxC) };
    const skip = new Set();
    let html = '<table>';
    for (let r = R.r1; r <= R.r2; r++) {
      if (App.isRowHidden(sh, r)) continue;
      html += `<tr style="height:${sh.rowH[r] || App.DEF_H}px">`;
      for (let c = R.c1; c <= R.c2; c++) {
        if (App.isColHidden(sh, c) || skip.has(r + ':' + c)) continue;
        const info = App.cellInfo ? cellInfoFor(sh, si, r, c) : null;
        const s = info.s;
        const g = App.mergeAt(sh, r, c);
        let span = '';
        if (g && g.r1 === r && g.c1 === c) {
          span = ` rowspan="${g.r2 - g.r1 + 1}" colspan="${g.c2 - g.c1 + 1}"`;
          for (let rr = g.r1; rr <= g.r2; rr++) for (let cc = g.c1; cc <= g.c2; cc++) if (rr !== r || cc !== c) skip.add(rr + ':' + cc);
        }
        const bd = (b) => (b ? `${b.style === 'thick' ? 3 : b.style === 'medium' ? 2 : 1}px ${b.style === 'dashed' || b.style === 'dotted' || b.style === 'double' ? b.style : 'solid'} ${b.color || '#000'}` : '');
        const css = [`width:${sh.colW[c] || App.DEF_W}px`, s.bg ? 'background:' + s.bg : '', s.color ? 'color:' + s.color : '', s.b ? 'font-weight:bold' : '', s.i ? 'font-style:italic' : '',
          s.u || s.st ? 'text-decoration:' + [s.u ? 'underline' : '', s.st ? 'line-through' : ''].join(' ') : '', `text-align:${{ l: 'left', c: 'center', r: 'right' }[info.align]}`,
          s.fs ? `font-size:${s.fs}pt` : '', s.ff ? `font-family:${s.ff}` : '', s.wrap === 'wrap' ? 'white-space:pre-wrap' : 'white-space:nowrap',
          s.va === 't' ? 'vertical-align:top' : s.va === 'm' ? 'vertical-align:middle' : 'vertical-align:bottom',
          s.bd && s.bd.t ? 'border-top:' + bd(s.bd.t) : '', s.bd && s.bd.b ? 'border-bottom:' + bd(s.bd.b) : '', s.bd && s.bd.l ? 'border-left:' + bd(s.bd.l) : '', s.bd && s.bd.r ? 'border-right:' + bd(s.bd.r) : ''].filter(Boolean).join(';');
        html += `<td${span} style="${css}">${info.link ? `<a href="${esc(info.link)}">${esc(info.text)}</a>` : esc(info.text)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table>';
  }
  function cellInfoFor(sh, si, r, c) {
    if (si === doc.active) return App.cellInfo(r, c);
    const prev = doc.active;
    doc.active = si;
    const info = App.cellInfo(r, c);
    doc.active = prev;
    return info;
  }

  // ---------- Impressão ----------
  function print() {
    const sh = App.sheet(), si = doc.active;
    const sel = App.selRect();
    const useSel = !App.selIsCell() && !(sel.r1 === 1 && sel.r2 >= sh.rows);
    App.ui.modal({
      title: 'Configurações de impressão', width: '420px',
      body: `<label class="field"><span>Imprimir</span><select class="input" id="pr-what"><option value="sheet">Página atual</option>${useSel ? '<option value="sel">Células selecionadas</option>' : ''}<option value="all">Planilha inteira</option></select></label>
        <label class="field"><span>Orientação</span><select class="input" id="pr-orient"><option value="portrait">Retrato</option><option value="landscape">Paisagem</option></select></label>
        <label class="check"><input type="checkbox" id="pr-grid" checked> Mostrar linhas de grade</label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Imprimir', primary: true, action: (d) => {
        const what = d.querySelector('#pr-what').value;
        const grid = d.querySelector('#pr-grid').checked;
        const area = $('print-area');
        const parts = what === 'all' ? doc.sheets.map((s, i) => [s, i, null]).filter(([s]) => !s.hidden) : [[sh, si, what === 'sel' ? sel : null]];
        area.className = 'print-area' + (grid ? ' grid' : '');
        area.innerHTML = parts.map(([s, i, R]) => `<section><h2>${esc(doc.title)} · ${esc(s.name)}</h2>${tableHtml(s, i, R)}</section>`).join('');
        let st = document.getElementById('print-page-style');
        if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
        st.textContent = `@page { size: A4 ${d.querySelector('#pr-orient').value}; margin: 12mm; }`;
        setTimeout(() => window.print(), 50);
      } }],
    });
  }

  // ---------- Compartilhar por link (os dados vão no endereço) ----------
  const b64url = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64url = (s) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
  async function compress(text) {
    if (!window.CompressionStream) return 'u' + b64url(new TextEncoder().encode(text));
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  async function decompress(s) {
    const bytes = fromB64url(s.slice(1));
    if (s[0] === 'u') return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }
  function share() {
    App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '520px',
      body: `<p class="modal-text">Este site não usa servidor: as planilhas ficam salvas no seu navegador. Para enviar uma cópia a outra pessoa, use uma das opções abaixo.</p>
        <div class="share-opts">
          <button class="share-opt" data-a="link">${icon('link', 22)}<div><b>Copiar link com os dados</b><small>Quem abrir o link recebe uma cópia desta planilha.</small></div></button>
          <button class="share-opt" data-a="xlsx">${icon('sheetIcon', 22)}<div><b>Baixar como Excel (.xlsx)</b><small>Abre no Excel, no Google Planilhas e no LibreOffice.</small></div></button>
          <button class="share-opt" data-a="json">${icon('cloud', 22)}<div><b>Baixar backup (.json)</b><small>Guarda tudo: formatação, gráficos, regras e notas.</small></div></button>
        </div><input class="input share-link" id="share-link" readonly hidden>`,
      buttons: [{ label: 'Concluído', primary: true }],
      onOpen: (d) => {
        d.querySelectorAll('.share-opt').forEach((b) => b.onclick = async () => {
          if (b.dataset.a === 'xlsx') return download('xlsx');
          if (b.dataset.a === 'json') return download('json');
          const code = await compress(App.serialize());
          const url = location.origin + location.pathname + '#importar=' + code;
          const inp = d.querySelector('#share-link');
          inp.hidden = false; inp.value = url; inp.select();
          if (url.length > 60000) notify('A planilha é grande; o link pode não funcionar em todos os aplicativos. Prefira enviar o arquivo .xlsx.');
          navigator.clipboard.writeText(url).then(() => notify('Link copiado.'), () => notify('Selecione e copie o link exibido.'));
        });
      },
    });
  }
  async function checkImportHash() {
    const m = /#importar=([\w-]+)/.exec(location.hash);
    if (!m) return;
    try {
      const d = JSON.parse(await decompress(m[1]));
      App.ui.modal({
        title: 'Abrir planilha compartilhada', width: '440px',
        body: `<p class="modal-text">O link contém a planilha <b>${esc(d.title || 'Sem título')}</b>. Deseja abrir uma cópia neste navegador?</p>`,
        buttons: [{ label: 'Cancelar', action: () => { history.replaceState(null, '', '#doc=' + App.docId); } }, { label: 'Abrir cópia', primary: true, action: () => { App.newDocument(d); notify('Planilha compartilhada aberta.'); } }],
      });
    } catch (e) { notify('O link de compartilhamento está incompleto ou corrompido.'); }
  }

  // Arrastar um arquivo para a janela abre como nova planilha
  function initDrop() {
    window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('dragging-file'); } });
    window.addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('dragging-file'); });
    window.addEventListener('drop', (e) => {
      document.body.classList.remove('dragging-file');
      if (!e.dataTransfer || !e.dataTransfer.files.length || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      openAsNewDoc(e.dataTransfer.files[0]);
    });
  }

  def('newDoc', 'Nova planilha', () => { App.newDocument(); notify('Nova planilha criada. Use Arquivo › Abrir para voltar às anteriores.'); });
  def('open', 'Abrir', openDialog, 'Ctrl+O');
  def('importFile', 'Importar', importDialog);
  def('makeCopy', 'Fazer uma cópia', () => {
    const data = JSON.parse(App.serialize());
    data.title = 'Cópia de ' + doc.title;
    App.newDocument(data);
    notify('Cópia criada.');
  });
  def('download', 'Fazer download', download);
  def('print', 'Imprimir', print, 'Ctrl+P');
  def('share', 'Compartilhar', share);
  App.io = { init: () => { initDrop(); checkImportHash(); }, downloadBlob, readFile, enToPt, ptToEn, download, tableHtml };
})(window.App);
