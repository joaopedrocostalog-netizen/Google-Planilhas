// Diálogos: localizar e substituir, link, nota, comentário, formato personalizado, lista de funções,
// atalhos, dividir texto, remover cópias e classificação avançada.
(function (App) {
  'use strict';
  const E = App.E;
  const doc = App.doc;
  const sel = App.sel;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const def = (id, label, fn, sc) => App.commands.def(id, label, fn, sc);

  // ---------- Localizar ----------
  const find = { list: [], idx: -1, opts: { scope: 'sheet', matchCase: false, whole: false, regex: false, formulas: false } };
  function matcher(q, o) {
    if (!q) return null;
    if (o.regex) {
      let re;
      try { re = new RegExp(o.whole ? '^(?:' + q + ')$' : q, o.matchCase ? '' : 'i'); } catch (e) { return null; }
      return (t) => re.test(t);
    }
    const qq = o.matchCase ? q : q.toLowerCase();
    return (t) => { const s = o.matchCase ? t : t.toLowerCase(); return o.whole ? s === qq : s.includes(qq); };
  }
  function cellText(si, r, c, o) {
    const sh = doc.sheets[si];
    const raw = App.raw(sh, r, c);
    if (o.formulas && typeof raw === 'string' && raw[0] === '=') return raw;
    return App.fmtValue(App.value(si, r, c), App.style(sh, r, c).nf);
  }
  function search(q, o) {
    const test = matcher(q, o);
    const out = [];
    if (!test) return out;
    const sheets = o.scope === 'all' ? doc.sheets.map((_, i) => i) : [doc.active];
    for (const si of sheets) {
      const sh = doc.sheets[si];
      const used = App.usedRange(sh);
      const R = o.scope === 'range' && o.range ? o.range : { r1: 1, c1: 1, r2: used.maxR, c2: used.maxC };
      for (let r = R.r1; r <= Math.min(R.r2, used.maxR); r++) for (let c = R.c1; c <= Math.min(R.c2, used.maxC); c++) {
        const t = cellText(si, r, c, o);
        if (t !== '' && test(t)) out.push({ si, r, c });
      }
    }
    return out;
  }
  function showFound() {
    const set = new Set(find.list.filter((m) => m.si === doc.active).map((m) => m.r + ':' + m.c));
    const cur = find.list[find.idx];
    App.grid.setFound(set.size ? set : null, cur && cur.si === doc.active ? cur.r + ':' + cur.c : null);
  }
  function gotoMatch(i) {
    if (!find.list.length) return;
    find.idx = ((i % find.list.length) + find.list.length) % find.list.length;
    const m = find.list[find.idx];
    if (m.si !== doc.active) { doc.active = m.si; App.emit('sheet'); }
    App.grid.select(m.r, m.c);
    showFound();
  }
  function openFindBar() {
    const bar = $('find-bar');
    bar.hidden = false;
    const input = bar.querySelector('input');
    const R = App.selRect();
    if (!input.value && App.selIsCell()) { /* mantém vazio */ }
    input.focus(); input.select();
    const update = () => {
      find.opts = Object.assign({}, find.opts, { scope: 'sheet' });
      find.list = search(input.value, find.opts);
      find.idx = -1;
      // começa a partir da seleção atual
      const after = find.list.findIndex((m) => m.r > R.r1 || (m.r === R.r1 && m.c >= R.c1));
      if (find.list.length) gotoMatch(after < 0 ? 0 : after); else showFound();
      count();
    };
    const count = () => { bar.querySelector('.fb-count').textContent = input.value ? (find.list.length ? `${find.idx + 1} de ${find.list.length}` : '0 de 0') : ''; };
    input.oninput = update;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gotoMatch(find.idx + (e.shiftKey ? -1 : 1)); count(); input.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
    };
    bar.querySelector('.fb-up').onclick = () => { gotoMatch(find.idx - 1); count(); };
    bar.querySelector('.fb-down').onclick = () => { gotoMatch(find.idx + 1); count(); };
    bar.querySelector('.fb-more').onclick = () => { closeFindBar(); findReplace(input.value); };
    bar.querySelector('.fb-x').onclick = closeFindBar;
    if (input.value) update();
  }
  function closeFindBar() { $('find-bar').hidden = true; find.list = []; App.grid.setFound(null); App.grid.focus(); }

  function findReplace(initial) {
    const o = find.opts;
    const R = App.selRect();
    const m = App.ui.modal({
      title: 'Localizar e substituir', width: '480px', enterSubmits: false,
      body: `<div class="fr-grid">
        <label>Localizar</label><input class="input" id="fr-q" value="${esc(initial || '')}">
        <label>Substituir por</label><input class="input" id="fr-r">
        <label>Pesquisar</label><select class="input" id="fr-scope"><option value="all"${o.scope === 'all' ? ' selected' : ''}>Todas as páginas</option><option value="sheet"${o.scope !== 'all' && o.scope !== 'range' ? ' selected' : ''}>Esta página</option><option value="range"${o.scope === 'range' ? ' selected' : ''}>Intervalo específico</option></select>
        <span></span><input class="input" id="fr-range" value="${esc(App.rangeText(R, App.sheet().name))}"${o.scope === 'range' ? '' : ' hidden'}>
        </div>
        <label class="check"><input type="checkbox" id="fr-case"${o.matchCase ? ' checked' : ''}> Diferenciar maiúsculas de minúsculas</label>
        <label class="check"><input type="checkbox" id="fr-whole"${o.whole ? ' checked' : ''}> Corresponder a todo o conteúdo da célula</label>
        <label class="check"><input type="checkbox" id="fr-regex"${o.regex ? ' checked' : ''}> Pesquisar usando expressões regulares</label>
        <label class="check"><input type="checkbox" id="fr-formulas"${o.formulas ? ' checked' : ''}> Pesquisar também nas fórmulas</label>
        <p class="fr-status" id="fr-status"></p>`,
      buttons: [
        { label: 'Localizar', action: (d) => { run(d, 'find'); return false; } },
        { label: 'Substituir', action: (d) => { run(d, 'replace'); return false; } },
        { label: 'Substituir tudo', action: (d) => { run(d, 'all'); return false; } },
        { label: 'Concluído', primary: true, action: () => { App.grid.setFound(null); } },
      ],
      onClose: () => App.grid.setFound(null),
    });
    const d = m.el;
    d.querySelector('#fr-scope').onchange = (e) => { d.querySelector('#fr-range').hidden = e.target.value !== 'range'; find.list = []; };
    d.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { find.list = []; }));
    d.querySelector('#fr-q').addEventListener('input', () => { find.list = []; });
    d.querySelector('#fr-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(d, 'find'); } });
    function readOpts() {
      const scope = d.querySelector('#fr-scope').value;
      const p = scope === 'range' ? App.parseRange(d.querySelector('#fr-range').value) : null;
      find.opts = { scope, range: p ? p.R : null, matchCase: d.querySelector('#fr-case').checked, whole: d.querySelector('#fr-whole').checked, regex: d.querySelector('#fr-regex').checked, formulas: d.querySelector('#fr-formulas').checked };
      if (p && scope === 'range' && p.si !== doc.active) { doc.active = p.si; App.emit('sheet'); }
      return find.opts;
    }
    function run(dlg, action) {
      const q = dlg.querySelector('#fr-q').value, rep = dlg.querySelector('#fr-r').value;
      const status = dlg.querySelector('#fr-status');
      const opts = readOpts();
      if (!q) { status.textContent = 'Digite o que deseja localizar.'; return; }
      if (opts.regex) { try { new RegExp(q); } catch (e) { status.textContent = 'Expressão regular inválida.'; return; } }
      if (action === 'all') {
        let n = 0;
        const reText = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(opts.whole ? '^(?:' + reText + ')$' : reText, opts.matchCase ? 'g' : 'gi');
        App.change('Substituir tudo', () => {
          const sheets = opts.scope === 'all' ? doc.sheets.map((_, i) => i) : [doc.active];
          for (const si of sheets) {
            const sh = doc.sheets[si];
            for (const a of Object.keys(sh.cells)) {
              const x = sh.cells[a];
              if (typeof x.v !== 'string' || x.v === '') continue;
              if (x.v[0] === '=' && !opts.formulas) continue;
              const p = E.parseAddr(a);
              if (opts.scope === 'range' && opts.range && !App.inRect(opts.range, p.row, p.col)) continue;
              re.lastIndex = 0;
              if (!re.test(x.v)) continue;
              re.lastIndex = 0;
              const nv = x.v.replace(re, opts.regex ? rep : () => rep);
              n += (x.v.match(re) || []).length;
              x.v = nv;
              App.cleanup(sh, a);
            }
          }
        });
        find.list = [];
        status.textContent = n ? `${n} ${n === 1 ? 'ocorrência substituída' : 'ocorrências substituídas'}.` : 'Nenhuma ocorrência encontrada.';
        return;
      }
      if (!find.list.length) { find.list = search(q, opts); find.idx = -1; }
      if (!find.list.length) { status.textContent = 'Nenhuma ocorrência encontrada.'; App.grid.setFound(null); return; }
      if (action === 'replace' && find.idx >= 0) {
        const mm = find.list[find.idx];
        const sh = doc.sheets[mm.si];
        const raw = App.raw(sh, mm.r, mm.c);
        if (!(raw[0] === '=' && !opts.formulas)) {
          const reText = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(opts.whole ? '^(?:' + reText + ')$' : reText, opts.matchCase ? '' : 'i');
          const nv = raw.replace(re, opts.regex ? rep : () => rep);
          if (nv !== raw) App.change('Substituir', () => App.setRaw(sh, mm.r, mm.c, nv));
        }
        find.list = search(q, opts);
        if (!find.list.length) { status.textContent = 'Todas as ocorrências foram substituídas.'; App.grid.setFound(null); return; }
        find.idx = Math.min(find.idx, find.list.length - 1) - 1;
      }
      gotoMatch(find.idx + 1);
      status.textContent = `${find.idx + 1} de ${find.list.length}`;
    }
    find.list = [];
  }

  // ---------- Popup ancorado na célula ativa ----------
  function cellAnchor() {
    const rc = App.grid.cellRect(sel.ar, sel.ac);
    const wr = $('grid-wrap').getBoundingClientRect();
    return { x: wr.left + rc.x + rc.w + 4, y: wr.top + rc.y, below: { x: wr.left + rc.x, y: wr.top + rc.y + rc.h + 4 } };
  }

  // ---------- Link ----------
  function insertLink() {
    const sh = App.sheet();
    const cell = App.cell(sh, sel.ar, sel.ac);
    const text = App.fmtValue(App.value(doc.active, sel.ar, sel.ac), App.style(sh, sel.ar, sel.ac).nf);
    const box = document.createElement('div');
    box.className = 'link-pop';
    const sheetLinks = doc.sheets.map((s) => `<option value="#planilha=${esc(s.name)}">${esc(s.name)}</option>`).join('');
    box.innerHTML = `<label class="field"><span>Texto</span><input class="input" id="lk-text" value="${esc(text)}"></label>
      <label class="field"><span>Link</span><input class="input" id="lk-url" placeholder="Cole um link ou escolha uma página" value="${esc((cell && cell.link) || '')}" list="lk-sheets"></label>
      <datalist id="lk-sheets">${sheetLinks}</datalist>
      <div class="pop-foot"><button class="btn btn-primary" id="lk-ok">Aplicar</button></div>`;
    const a = cellAnchor();
    App.ui.popup(a.below, box);
    const url = box.querySelector('#lk-url');
    url.focus();
    const apply = () => {
      let u = url.value.trim();
      const t = box.querySelector('#lk-text').value;
      if (u && !/^(https?:|mailto:|#)/i.test(u)) u = 'https://' + u;
      App.ui.closePopup();
      App.change('Inserir link', () => {
        const x = App.cell(sh, sel.ar, sel.ac) || {};
        if (u) x.link = u; else delete x.link;
        const cur = App.raw(sh, sel.ar, sel.ac);
        if (t !== text || (!cur && t)) x.v = t || u;
        else if (!cur) x.v = u;
        App.setCellObj(sh, sel.ar, sel.ac, x);
      });
    };
    box.querySelector('#lk-ok').onclick = apply;
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  }
  // links internos para páginas (#planilha=Nome)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#planilha="]');
    if (!a) return;
    e.preventDefault();
    const name = decodeURIComponent(a.getAttribute('href').slice(10));
    const i = doc.sheets.findIndex((s) => s.name === name);
    if (i >= 0) App.run('switchSheet', i);
  });

  // ---------- Nota ----------
  function insertNote() {
    const sh = App.sheet();
    const r = sel.ar, c = sel.ac;
    const cell = App.cell(sh, r, c);
    const box = document.createElement('div');
    box.className = 'note-pop';
    box.innerHTML = `<textarea class="note-text" placeholder="Digite uma nota">${esc((cell && cell.note) || '')}</textarea>`;
    const ta = box.querySelector('textarea');
    const save = () => {
      const t = ta.value.trim();
      const cur = (App.cell(sh, r, c) || {}).note || '';
      if (t === cur) return;
      App.change('Nota', () => { const x = App.cell(sh, r, c) || { v: '' }; if (t) x.note = t; else delete x.note; App.setCellObj(sh, r, c, x); });
    };
    App.ui.popup(cellAnchor(), box, { onClose: save });
    ta.focus();
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); App.ui.closePopup(); App.grid.focus(); } });
  }
  def('clearNotes', 'Excluir notas', () => {
    const sh = App.sheet(), R = App.selRect();
    App.change('Excluir notas', () => { for (const a of Object.keys(sh.cells)) { const p = E.parseAddr(a); if (App.inRect(R, p.row, p.col)) { delete sh.cells[a].note; App.cleanup(sh, a); } } });
  });

  // ---------- Comentários ----------
  function insertComment() {
    const sh = App.sheet();
    const r = sel.ar, c = sel.ac;
    const box = document.createElement('div');
    box.className = 'comment-pop';
    const render = () => {
      const cell = App.cell(sh, r, c);
      const list = (cell && cell.comments) || [];
      box.innerHTML = `${list.length ? `<div class="cm-actions"><button class="btn cm-resolve">${icon('check', 16)} Resolver</button></div>` : ''}
        ${list.map((cm, i) => `<div class="cm"><div class="cm-head"><span class="avatar">${esc((cm.author || 'V')[0])}</span><b>${esc(cm.author || 'Você')}</b><time>${esc(new Date(cm.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</time><button class="icon-btn cm-del" data-i="${i}" title="Excluir">${icon('close', 14)}</button></div><p>${esc(cm.text)}</p></div>`).join('')}
        <textarea class="note-text cm-input" placeholder="${list.length ? 'Responder' : 'Comentar'}"></textarea>
        <div class="pop-foot"><button class="btn cm-cancel">Cancelar</button><button class="btn btn-primary cm-ok">${list.length ? 'Responder' : 'Comentar'}</button></div>`;
      box.querySelector('.cm-input').focus();
      box.querySelector('.cm-cancel').onclick = () => App.ui.closePopup();
      box.querySelector('.cm-ok').onclick = () => {
        const t = box.querySelector('.cm-input').value.trim();
        if (!t) return;
        App.change('Comentário', () => { const x = App.cell(sh, r, c) || { v: '' }; x.comments = (x.comments || []).concat({ author: 'Você', time: Date.now(), text: t }); App.setCellObj(sh, r, c, x); });
        render();
      };
      box.querySelectorAll('.cm-del').forEach((b) => b.onclick = () => {
        App.change('Excluir comentário', () => { const x = App.cell(sh, r, c); x.comments.splice(+b.dataset.i, 1); if (!x.comments.length) delete x.comments; App.cleanup(sh, E.addrToStr(r, c)); });
        render();
      });
      const res = box.querySelector('.cm-resolve');
      if (res) res.onclick = () => { App.change('Resolver comentário', () => { const x = App.cell(sh, r, c); delete x.comments; App.cleanup(sh, E.addrToStr(r, c)); }); App.ui.closePopup(); notify('Comentário resolvido.'); };
      box.querySelector('.cm-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) box.querySelector('.cm-ok').click(); });
    };
    App.ui.popup(cellAnchor(), box);
    render();
  }

  // ---------- Formato personalizado ----------
  function customFormat() {
    const sh = App.sheet();
    const v = App.value(doc.active, sel.ar, sel.ac);
    const cur = App.style(sh, sel.ar, sel.ac).nf || '';
    const examples = ['#,##0.00', '0.0%', '"R$" #,##0.00', '#,##0;(#,##0)', '0.00E+00', 'dd/mm/yyyy', 'd "de" mmmm "de" yyyy', 'dddd', 'hh:mm', '[h]:mm:ss', '0 "un"', '@" (texto)"'];
    App.ui.modal({
      title: 'Formatos de número personalizados', width: '520px',
      body: `<input class="input" id="cf-code" value="${esc(cur)}" placeholder="Ex.: #,##0.00">
        <p class="cf-prev">Prévia: <b id="cf-prev"></b></p>
        <div class="cf-ex">${examples.map((x) => `<button class="cf-ex-item" data-code="${esc(x)}"><code>${esc(x)}</code><span>${esc(App.fmtValue(typeof v === 'number' ? v : 1234.5, x))}</span></button>`).join('')}</div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, action: (d) => { const code = d.querySelector('#cf-code').value.trim(); App.run('format', code || 'auto'); } }],
      onOpen: (d) => {
        const inp = d.querySelector('#cf-code'), prev = d.querySelector('#cf-prev');
        const up = () => { try { prev.textContent = inp.value ? App.fmtValue(typeof v === 'number' ? v : typeof v === 'string' ? v : 1234.5, inp.value) : App.fmtValue(v); } catch (e) { prev.textContent = 'Formato inválido'; } };
        inp.addEventListener('input', up); up();
        d.querySelectorAll('.cf-ex-item').forEach((b) => b.onclick = () => { inp.value = b.dataset.code; up(); inp.focus(); });
      },
    });
  }

  // ---------- Lista de funções ----------
  function functionList() {
    const cats = [...new Set(E.INFO.map((f) => f.cat || 'Outras'))].sort();
    App.ui.modal({
      title: `Lista de funções (${E.INFO.length})`, width: '760px', cls: 'modal-tall',
      body: `<div class="fl-bar"><input class="input" id="fl-q" placeholder="Pesquisar funções (ex.: soma, procv, data)"><select class="input" id="fl-cat"><option value="">Todas as categorias</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="fl-table"><table><thead><tr><th>Função</th><th>Sintaxe</th><th>Descrição</th></tr></thead><tbody id="fl-body"></tbody></table></div>`,
      onOpen: (d) => {
        const body = d.querySelector('#fl-body'), q = d.querySelector('#fl-q'), cat = d.querySelector('#fl-cat');
        const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const render = () => {
          const s = fold(q.value), cc = cat.value;
          const list = E.INFO.filter((f) => (!cc || (f.cat || 'Outras') === cc) && (!s || fold(f.pt + ' ' + f.name + ' ' + f.desc).includes(s))).sort((a, b) => a.pt.localeCompare(b.pt));
          body.innerHTML = list.map((f) => `<tr data-n="${esc(f.pt)}"><td><b>${esc(f.pt)}</b>${f.pt !== f.name ? `<small>${esc(f.name)}</small>` : ''}</td><td><code>${esc(f.pt)}(${esc(f.args)})</code></td><td>${esc(f.desc)}</td></tr>`).join('') || '<tr><td colspan="3">Nenhuma função encontrada.</td></tr>';
        };
        q.addEventListener('input', render); cat.addEventListener('change', render); render();
        body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-n]'); if (tr) { d.querySelector('.modal-x').click(); App.run('insertFunction', tr.dataset.n); } });
      },
    });
  }

  // ---------- Atalhos ----------
  const SHORTCUTS = [
    ['Ações comuns', [['Ctrl+Z', 'Desfazer'], ['Ctrl+Y / Ctrl+Shift+Z', 'Refazer'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copiar, recortar e colar'], ['Ctrl+Shift+V', 'Colar somente valores'], ['Ctrl+Alt+V', 'Colar somente a formatação'], ['Ctrl+F', 'Localizar'], ['Ctrl+H', 'Localizar e substituir'], ['Ctrl+P', 'Imprimir'], ['Ctrl+O', 'Abrir arquivo'], ['Alt+/', 'Pesquisar nos menus'], ['Ctrl+/', 'Atalhos do teclado']]],
    ['Formatação', [['Ctrl+B', 'Negrito'], ['Ctrl+I', 'Itálico'], ['Ctrl+U', 'Sublinhado'], ['Alt+Shift+5', 'Tachado'], ['Ctrl+Shift+E / L / R', 'Centralizar, alinhar à esquerda, à direita'], ['Ctrl+Shift+1', 'Formato de número'], ['Ctrl+Shift+2 / 3', 'Hora / data'], ['Ctrl+Shift+4 / 5 / 6', 'Moeda / porcentagem / científico'], ['Ctrl+Shift+7', 'Bordas externas'], ['Ctrl+\\', 'Limpar formatação'], ['Ctrl+Shift+. / ,', 'Aumentar / diminuir fonte']]],
    ['Navegação e seleção', [['Setas', 'Mover'], ['Ctrl+setas', 'Ir até a borda dos dados'], ['Shift+setas', 'Ampliar seleção'], ['Ctrl+Home / Ctrl+End', 'Início / fim dos dados'], ['Ctrl+A', 'Selecionar tudo'], ['Ctrl+Espaço', 'Selecionar coluna'], ['Shift+Espaço', 'Selecionar linha'], ['Ctrl+PageDown / PageUp', 'Próxima / anterior página'], ['Shift+F11', 'Nova página']]],
    ['Edição', [['Enter / F2', 'Editar célula'], ['Esc', 'Cancelar edição'], ['Tab / Shift+Tab', 'Confirmar e ir para a direita / esquerda'], ['Alt+Enter / Ctrl+Enter', 'Nova linha na célula'], ['F4', 'Alternar referência absoluta ($)'], ['Ctrl+D / Ctrl+R', 'Preencher para baixo / direita'], ['Ctrl+;', 'Inserir data'], ['Ctrl+Shift+;', 'Inserir hora'], ['Delete', 'Excluir valores'], ['Espaço', 'Marcar/desmarcar caixas de seleção']]],
    ['Linhas, colunas e células', [['Ctrl+Alt+=', 'Inserir linhas/colunas'], ['Ctrl+Alt+-', 'Excluir linhas/colunas'], ['Ctrl+Alt+9 / 0', 'Ocultar linhas / colunas'], ['Ctrl+Shift+9 / 0', 'Reexibir linhas / colunas'], ['Ctrl+K', 'Inserir link'], ['Ctrl+Alt+M', 'Comentário'], ['Shift+F2', 'Nota'], ['Ctrl+`', 'Mostrar fórmulas'], ['Ctrl+Shift+F', 'Ocultar menus']]],
  ];
  function shortcuts() {
    App.ui.modal({
      title: 'Atalhos do teclado', width: '860px', cls: 'modal-tall',
      body: `<div class="sc-grid">${SHORTCUTS.map(([g, list]) => `<section><h3>${esc(g)}</h3><table>${list.map(([k, d]) => `<tr><td>${esc(d)}</td><td><kbd>${esc(k)}</kbd></td></tr>`).join('')}</table></section>`).join('')}</div><p class="sp-hint">No Mac, use ⌘ no lugar de Ctrl.</p>`,
    });
  }

  // ---------- Sobre ----------
  function about() {
    App.ui.modal({
      title: 'Sobre o Planilhas', width: '460px',
      body: `<div class="about">${icon('sheetIcon', 48)}<div><p><b>Planilhas</b> é um editor de planilhas que roda inteiro no navegador.</p>
        <p>${E.INFO.length} funções, várias páginas, gráficos, filtros, formatação condicional, validação de dados, tabelas dinâmicas e arquivos .xlsx, .csv e .json.</p>
        <p class="sp-hint">Os dados ficam salvos neste navegador. Use Arquivo › Fazer download para guardar uma cópia.</p></div></div>`,
      buttons: [{ label: 'Fechar', primary: true }],
    });
  }

  // ---------- Dividir texto em colunas ----------
  function splitText() {
    const sh = App.sheet(), R = App.selRect();
    const c = R.c1;
    const rows = [];
    for (let r = R.r1; r <= Math.min(R.r2, App.usedRange(sh).maxR); r++) rows.push(r);
    if (!rows.length) return notify('Selecione uma coluna com texto para dividir.');
    const box = document.createElement('div');
    box.className = 'split-pop';
    box.innerHTML = `<label class="field"><span>Separador</span><select class="input" id="sp-sep"><option value="auto">Detectar automaticamente</option><option value=",">Vírgula</option><option value=";">Ponto e vírgula</option><option value=".">Ponto</option><option value=" ">Espaço</option><option value="custom">Personalizado</option></select></label>
      <input class="input" id="sp-custom" placeholder="Separador personalizado" hidden>
      <div class="pop-foot"><button class="btn btn-primary" id="sp-ok">Dividir</button></div>`;
    const wr = $('grid-wrap').getBoundingClientRect();
    const rc = App.grid.cellRect(R.r2, c);
    App.ui.popup({ x: wr.left + rc.x, y: wr.top + Math.min(rc.y + rc.h, App.gridState.vh) + 4 }, box);
    box.querySelector('#sp-sep').onchange = (e) => { box.querySelector('#sp-custom').hidden = e.target.value !== 'custom'; };
    box.querySelector('#sp-ok').onclick = () => {
      let sep = box.querySelector('#sp-sep').value;
      if (sep === 'custom') sep = box.querySelector('#sp-custom').value;
      const texts = rows.map((r) => App.raw(sh, r, c));
      if (sep === 'auto') {
        const cand = [',', ';', '\t', '|', ' '];
        sep = cand.find((s) => texts.filter((t) => t.includes(s)).length >= Math.ceil(texts.filter(Boolean).length / 2)) || ',';
      }
      if (!sep) return;
      const parts = texts.map((t) => (t && t[0] !== '=' ? t.split(sep).map((x) => x.trim()) : [t]));
      const maxN = Math.max(...parts.map((p) => p.length));
      const overwrite = rows.some((r) => { for (let k = 1; k < maxN; k++) if (App.raw(sh, r, c + k) !== '') return true; return false; });
      const go = () => {
        App.ui.closePopup();
        App.change('Dividir texto', () => {
          rows.forEach((r, i) => parts[i].forEach((p, k) => { App.setRaw(sh, r, c + k, p); if (!App.style(sh, r, c + k).nf) { const f = App.autoFormatFor(p); if (f) App.setStyle(sh, r, c + k, (s) => { s.nf = f; }); } }));
          if (c + maxN - 1 > sh.cols) sh.cols = c + maxN - 1;
        });
      };
      if (overwrite) App.ui.confirm('Substituir dados?', 'Já existem dados nas colunas ao lado. Deseja substituí-los?', 'Substituir', go); else go();
    };
  }

  // ---------- Remover cópias ----------
  function removeDuplicates() {
    const sh = App.sheet(), si = doc.active;
    let R = App.selRect();
    if (App.selIsCell()) R = App.dataRegion(si, sel.ar, sel.ac);
    if (R.r1 === 1 && R.r2 >= sh.rows) R = Object.assign({}, R, { r2: App.usedRange(sh).maxR });
    if (R.c1 === 1 && R.c2 >= sh.cols) R = Object.assign({}, R, { c2: App.usedRange(sh).maxC });
    const cols = [];
    for (let c = R.c1; c <= R.c2; c++) cols.push(c);
    const head = (c, hasHead) => (hasHead ? App.fmtValue(App.value(si, R.r1, c)) || 'Coluna ' + E.numToCol(c) : 'Coluna ' + E.numToCol(c));
    App.ui.modal({
      title: 'Remover cópias', width: '440px',
      body: `<p class="sp-hint">Intervalo: <b>${esc(App.rangeText(R))}</b></p>
        <label class="check"><input type="checkbox" id="rd-head"> Os dados têm linha de cabeçalho</label>
        <p class="sp-label">Colunas a analisar</p><label class="check"><input type="checkbox" id="rd-all" checked> Selecionar tudo</label>
        <div class="rd-cols">${cols.map((c) => `<label class="check"><input type="checkbox" data-c="${c}" checked> <span>${esc(head(c, false))}</span></label>`).join('')}</div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Remover cópias', primary: true, action: (d) => {
        const hasHead = d.querySelector('#rd-head').checked;
        const use = [...d.querySelectorAll('[data-c]')].filter((i) => i.checked).map((i) => +i.dataset.c);
        if (!use.length) { notify('Escolha pelo menos uma coluna.'); return false; }
        const start = hasHead ? R.r1 + 1 : R.r1;
        const seen = new Set(), keep = [];
        let removed = 0;
        for (let r = start; r <= R.r2; r++) {
          const key = use.map((c) => App.fmtValue(App.value(si, r, c))).join('\u0001');
          if (seen.has(key)) { removed++; continue; }
          seen.add(key);
          keep.push(r);
        }
        if (!removed) { notify('Nenhuma linha duplicada encontrada.'); return; }
        App.change('Remover cópias', () => {
          const block = keep.map((r) => cols.map((c) => App.cloneCell(App.cell(sh, r, c))));
          for (let r = start; r <= R.r2; r++) for (const c of cols) App.setCellObj(sh, r, c, null);
          block.forEach((row, i) => row.forEach((obj, j) => App.setCellObj(sh, start + i, cols[j], obj)));
        });
        notify(`${removed} ${removed === 1 ? 'linha duplicada removida' : 'linhas duplicadas removidas'}. ${keep.length} ${keep.length === 1 ? 'linha única permanece' : 'linhas únicas permanecem'}.`);
      } }],
      onOpen: (d) => {
        d.querySelector('#rd-all').onchange = (e) => d.querySelectorAll('[data-c]').forEach((i) => { i.checked = e.target.checked; });
        d.querySelector('#rd-head').onchange = (e) => d.querySelectorAll('[data-c]').forEach((i) => { i.nextElementSibling.textContent = head(+i.dataset.c, e.target.checked); });
      },
    });
  }

  // ---------- Classificação avançada ----------
  function sortAdvanced() {
    const sh = App.sheet(), si = doc.active;
    let R = App.selRect();
    if (App.selIsCell()) R = App.dataRegion(si, sel.ar, sel.ac);
    if (R.r1 === 1 && R.r2 >= sh.rows) R = Object.assign({}, R, { r2: App.usedRange(sh).maxR });
    const colName = (c, hasHead) => (hasHead ? App.fmtValue(App.value(si, R.r1, c)) || 'Coluna ' + E.numToCol(c) : 'Coluna ' + E.numToCol(c));
    const keys = [{ col: Math.min(Math.max(sel.ac, R.c1), R.c2), asc: true }];
    App.ui.modal({
      title: `Classificar intervalo de ${App.rangeText(R)}`, width: '480px',
      body: `<label class="check"><input type="checkbox" id="sa-head"> Os dados têm linha de cabeçalho</label><div id="sa-keys"></div><button class="btn" id="sa-add">${icon('plus', 16)} Adicionar outra coluna de classificação</button>`,
      onOpen: (d) => {
        const box = d.querySelector('#sa-keys');
        const render = () => {
          const hasHead = d.querySelector('#sa-head').checked;
          box.innerHTML = keys.map((k, i) => `<div class="sa-row"><span>${i ? 'e depois por' : 'Classificar por'}</span><select class="input" data-k="${i}">${Array.from({ length: R.c2 - R.c1 + 1 }, (_, j) => R.c1 + j).map((c) => `<option value="${c}"${k.col === c ? ' selected' : ''}>${esc(colName(c, hasHead))}</option>`).join('')}</select>
            <label class="check"><input type="radio" name="sa-o${i}" value="1"${k.asc ? ' checked' : ''}> A → Z</label><label class="check"><input type="radio" name="sa-o${i}" value="0"${!k.asc ? ' checked' : ''}> Z → A</label>${i ? `<button class="icon-btn" data-rm="${i}">${icon('close', 16)}</button>` : ''}</div>`).join('');
          box.querySelectorAll('[data-k]').forEach((s) => s.onchange = () => { keys[+s.dataset.k].col = +s.value; });
          box.querySelectorAll('input[type=radio]').forEach((r) => r.onchange = () => { keys[+r.name.slice(4)].asc = r.value === '1'; });
          box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { keys.splice(+b.dataset.rm, 1); render(); });
        };
        d.querySelector('#sa-head').onchange = render;
        d.querySelector('#sa-add').onclick = () => { keys.push({ col: R.c1, asc: true }); render(); };
        render();
      },
      buttons: [{ label: 'Cancelar' }, { label: 'Classificar', primary: true, action: (d) => {
        const hasHead = d.querySelector('#sa-head').checked;
        App.change('Classificar intervalo', () => App.sortRange(si, R, keys, hasHead));
      } }],
    });
  }

  def('find', 'Localizar', openFindBar, 'Ctrl+F');
  def('findReplace', 'Localizar e substituir', () => findReplace(''), 'Ctrl+H');
  def('insertLink', 'Inserir link', insertLink, 'Ctrl+K');
  def('insertNote', 'Inserir nota', insertNote, 'Shift+F2');
  def('insertComment', 'Inserir comentário', insertComment, 'Ctrl+Alt+M');
  def('customFormat', 'Formato de número personalizado', customFormat);
  def('functionList', 'Lista de funções', functionList);
  def('shortcuts', 'Atalhos do teclado', shortcuts, 'Ctrl+/');
  def('about', 'Sobre o Planilhas', about);
  def('sortAdvanced', 'Opções avançadas de classificação', sortAdvanced);
  def('renameDoc', 'Renomear', () => { const t = $('doc-title'); t.focus(); t.select(); });
  App.panels = Object.assign(App.panels || {}, { splitText, removeDuplicates });
})(window.App);
