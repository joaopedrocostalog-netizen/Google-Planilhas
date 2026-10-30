// Painéis laterais: formatação condicional, cores alternadas, validação de dados,
// estatísticas da coluna, intervalos nomeados, histórico de versões e tabela dinâmica.
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
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---------- Estrutura do painel ----------
  let current = null;
  function openPanel(title, render, onClose) {
    closePanel();
    const p = $('side-panel');
    p.hidden = false;
    p.innerHTML = `<div class="sp-head"><h2>${esc(title)}</h2><button class="icon-btn sp-x" aria-label="Fechar">${icon('close', 20)}</button></div><div class="sp-body"></div>`;
    current = { onClose, body: p.querySelector('.sp-body'), render };
    p.querySelector('.sp-x').onclick = closePanel;
    render(current.body);
    document.body.classList.add('panel-open');
    App.grid.layout();
    return current;
  }
  function closePanel() {
    const p = $('side-panel');
    if (!current) { p.hidden = true; return; }
    const c = current;
    current = null;
    if (c.onClose) c.onClose();
    p.hidden = true; p.innerHTML = '';
    document.body.classList.remove('panel-open');
    App.grid.layout();
    App.grid.focus();
  }
  const preview = () => { App.invalidate(); App.grid.draw(); };
  const curRangeText = () => App.rangeText(App.selRect());
  const condSelect = (cur, opts) => `<select class="input" data-f="type">${(opts || App.CONDITIONS).map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const argsFor = (type) => { const d = App.CONDITIONS.find((x) => x[0] === type); return d ? d[2] : 0; };
  function rangeFromInput(text) {
    const p = App.parseRange(text);
    if (!p || p.si !== doc.active) { notify('Intervalo inválido. Use algo como A1:B10.'); return null; }
    return p.R;
  }
  const styleChip = (s) => `<span class="cf-chip" style="${s.bg ? 'background:' + s.bg + ';' : ''}${s.color ? 'color:' + s.color + ';' : ''}${s.b ? 'font-weight:700;' : ''}${s.i ? 'font-style:italic;' : ''}${s.u || s.st ? 'text-decoration:' + [s.u ? 'underline' : '', s.st ? 'line-through' : ''].join(' ') + ';' : ''}">123</span>`;

  // ---------- Formatação condicional ----------
  const CF_PRESETS = [
    { bg: '#b7e1cd', color: '#000000' }, { bg: '#fce8b2', color: '#000000' }, { bg: '#f4c7c3', color: '#000000' },
    { bg: '#e30613', color: '#ffffff' }, { bg: '#0d0d0d', color: '#ffffff' }, { color: '#e30613', b: true },
  ];
  function condFormat() {
    const sh = App.sheet();
    const original = clone(sh.cf);
    let editing = null;
    const finish = () => {
      const final = clone(sh.cf);
      sh.cf = original;
      if (JSON.stringify(final) !== JSON.stringify(original)) App.change('Formatação condicional', () => { sh.cf = final; });
      else preview();
    };
    const render = (body) => {
      if (editing) return renderRule(body);
      const R = App.selRect();
      const rules = sh.cf.filter((r) => !(r.range.r2 < R.r1 || r.range.r1 > R.r2 || r.range.c2 < R.c1 || r.range.c1 > R.c2));
      body.innerHTML = `<p class="sp-hint">${rules.length ? 'Regras que se aplicam à seleção atual:' : 'Nenhuma regra na seleção atual.'}</p>
        <div class="cf-list">${(rules.length ? rules : sh.cf).map((r) => `<div class="cf-item" data-id="${r.id}">${r.kind === 'scale' ? `<span class="cf-chip" style="background:linear-gradient(90deg,${r.min},${r.mid || r.min},${r.max})">&nbsp;</span>` : styleChip(r.style)}<div><b>${esc(r.kind === 'scale' ? 'Escala de cores' : (App.CONDITIONS.find((c) => c[0] === r.cond.type) || [, ''])[1] + (r.cond.a ? ' ' + r.cond.a : '') + (r.cond.b ? ' e ' + r.cond.b : ''))}</b><small>${esc(App.rangeText(r.range))}</small></div><button class="icon-btn cf-del" title="Excluir regra">${icon('close', 16)}</button></div>`).join('')}</div>
        <button class="btn sp-add">${icon('plus', 16)} Adicionar outra regra</button>
        <div class="sp-foot"><button class="btn btn-primary sp-done">Concluído</button></div>`;
      body.querySelector('.sp-add').onclick = () => {
        editing = { id: App.uid(), range: Object.assign({}, App.selRect()), kind: 'single', cond: { type: 'notEmpty', a: '', b: '' }, style: Object.assign({}, CF_PRESETS[0]) };
        sh.cf.push(editing); preview(); render(body);
      };
      body.querySelectorAll('.cf-item').forEach((el) => {
        el.onclick = (e) => {
          if (e.target.closest('.cf-del')) { sh.cf = sh.cf.filter((r) => r.id !== el.dataset.id); preview(); render(body); return; }
          editing = sh.cf.find((r) => r.id === el.dataset.id); render(body);
        };
      });
      body.querySelector('.sp-done').onclick = closePanel;
    };
    const renderRule = (body) => {
      const r = editing;
      body.innerHTML = `
        <div class="sp-tabs"><button data-k="single" class="${r.kind !== 'scale' ? 'on' : ''}">Cor única</button><button data-k="scale" class="${r.kind === 'scale' ? 'on' : ''}">Escala de cores</button></div>
        <label class="field"><span>Aplicar ao intervalo</span><input class="input" data-f="range" value="${esc(App.rangeText(r.range))}"></label>
        ${r.kind === 'scale' ? `
          <div class="cf-scale-prev" style="background:linear-gradient(90deg,${r.min},${r.mid || r.min},${r.max})"></div>
          <div class="cf-scale-presets">${[['#ffffff', null, '#e30613'], ['#e30613', '#ffffff', '#57bb8a'], ['#57bb8a', '#ffd666', '#e67c73'], ['#ffffff', null, '#0d0d0d'], ['#f3f3f3', null, '#4a86e8']].map((p, i) => `<button class="cf-sp" data-p="${i}" style="background:linear-gradient(90deg,${p[0]},${p[1] || p[0]},${p[2]})"></button>`).join('')}</div>
          <div class="field-row"><label class="field"><span>Ponto mínimo</span><input type="color" data-f="min" value="${r.min}"></label>
          <label class="field"><span>Ponto médio</span><span class="inline"><input type="checkbox" data-f="useMid"${r.mid ? ' checked' : ''}> <input type="color" data-f="mid" value="${r.mid || '#ffffff'}"></span></label>
          <label class="field"><span>Ponto máximo</span><input type="color" data-f="max" value="${r.max}"></label></div>` : `
          <label class="field"><span>Formatar células se…</span>${condSelect(r.cond.type)}</label>
          <input class="input" data-f="a" placeholder="${r.cond.type === 'formula' ? '=A1>10' : 'Valor ou fórmula'}" value="${esc(r.cond.a || '')}"${argsFor(r.cond.type) < 1 ? ' hidden' : ''}>
          <input class="input" data-f="b" placeholder="Valor" value="${esc(r.cond.b || '')}"${argsFor(r.cond.type) < 2 ? ' hidden' : ''}>
          <span class="sp-label">Estilo de formatação</span>
          <div class="cf-presets">${CF_PRESETS.map((p, i) => `<button class="cf-pre" data-p="${i}">${styleChip(p)}</button>`).join('')}</div>
          <div class="cf-style">${[['b', '<b>B</b>', 'Negrito'], ['i', '<i>I</i>', 'Itálico'], ['u', '<u>U</u>', 'Sublinhado'], ['st', '<s>S</s>', 'Tachado']].map(([k, label, t]) => `<button class="tb tb-txt${r.style[k] ? ' active' : ''}" data-s="${k}" title="${t}">${label}</button>`).join('')}
            <label class="tb tb-color" title="Cor do texto">${icon('textColor')}<i class="color-bar" style="background:${r.style.color || '#000'}"></i><input type="color" data-s="color" value="${r.style.color || '#000000'}"></label>
            <label class="tb tb-color" title="Cor de preenchimento">${icon('fill')}<i class="color-bar" style="background:${r.style.bg || 'transparent'}"></i><input type="color" data-s="bg" value="${r.style.bg || '#ffffff'}"></label></div>
          <div class="cf-preview">Prévia: ${styleChip(r.style)}</div>`}
        <div class="sp-foot"><button class="btn sp-remove">Remover regra</button><button class="btn btn-primary sp-back">Concluído</button></div>`;
      body.querySelectorAll('.sp-tabs button').forEach((b) => b.onclick = () => {
        r.kind = b.dataset.k;
        if (r.kind === 'scale' && !r.min) { r.min = '#ffffff'; r.max = '#e30613'; r.mid = null; }
        preview(); renderRule(body);
      });
      const q = (f) => body.querySelector(`[data-f="${f}"]`);
      q('range').onchange = () => { const R = rangeFromInput(q('range').value); if (R) { r.range = R; preview(); } };
      if (r.kind === 'scale') {
        body.querySelectorAll('.cf-sp').forEach((b) => b.onclick = () => { const p = [['#ffffff', null, '#e30613'], ['#e30613', '#ffffff', '#57bb8a'], ['#57bb8a', '#ffd666', '#e67c73'], ['#ffffff', null, '#0d0d0d'], ['#f3f3f3', null, '#4a86e8']][+b.dataset.p]; r.min = p[0]; r.mid = p[1]; r.max = p[2]; preview(); renderRule(body); });
        q('min').oninput = () => { r.min = q('min').value; preview(); };
        q('max').oninput = () => { r.max = q('max').value; preview(); };
        q('mid').oninput = () => { if (q('useMid').checked) { r.mid = q('mid').value; preview(); } };
        q('useMid').onchange = () => { r.mid = q('useMid').checked ? q('mid').value : null; preview(); renderRule(body); };
      } else {
        q('type').onchange = () => { r.cond.type = q('type').value; preview(); renderRule(body); };
        q('a').oninput = () => { r.cond.a = q('a').value; preview(); };
        q('b').oninput = () => { r.cond.b = q('b').value; preview(); };
        body.querySelectorAll('.cf-pre').forEach((b) => b.onclick = () => { r.style = Object.assign({}, CF_PRESETS[+b.dataset.p]); preview(); renderRule(body); });
        body.querySelectorAll('[data-s]').forEach((b) => {
          if (b.tagName === 'INPUT') b.oninput = () => { r.style[b.dataset.s] = b.value; preview(); b.previousElementSibling.style.background = b.value; body.querySelector('.cf-preview').innerHTML = 'Prévia: ' + styleChip(r.style); };
          else b.onclick = () => { const k = b.dataset.s; if (r.style[k]) delete r.style[k]; else r.style[k] = true; preview(); renderRule(body); };
        });
      }
      body.querySelector('.sp-remove').onclick = () => { sh.cf = sh.cf.filter((x) => x !== r); editing = null; preview(); render(body); };
      body.querySelector('.sp-back').onclick = () => { editing = null; render(body); };
    };
    openPanel('Regras de formatação condicional', render, finish);
  }

  // ---------- Cores alternadas ----------
  const BAND_STYLES = [
    ['#e30613', '#ffffff', '#fde8ea'], ['#0d0d0d', '#ffffff', '#f2f2f2'], ['#5f6368', '#ffffff', '#f3f3f3'], ['#bd4d4d', '#ffffff', '#f4cccc'],
    ['#e69138', '#ffffff', '#fce5cd'], ['#6aa84f', '#ffffff', '#d9ead3'], ['#3c78d8', '#ffffff', '#e8f0fe'], ['#674ea7', '#ffffff', '#ead1dc'],
  ];
  function altColors() {
    const sh = App.sheet();
    sh.banding = sh.banding || [];
    const original = clone(sh.banding);
    const R = App.selRect();
    let band = sh.banding.find((b) => !(b.range.r2 < R.r1 || b.range.r1 > R.r2 || b.range.c2 < R.c1 || b.range.c1 > R.c2));
    if (!band) {
      let range = R;
      if (App.selIsCell()) range = App.dataRegion(doc.active, sel.ar, sel.ac);
      band = { id: App.uid(), range: Object.assign({}, range), header: true, headerColor: BAND_STYLES[0][0], headerText: '#ffffff', color1: BAND_STYLES[0][1], color2: BAND_STYLES[0][2] };
      sh.banding.push(band);
      preview();
    }
    const finish = () => {
      const final = clone(sh.banding);
      sh.banding = original;
      if (JSON.stringify(final) !== JSON.stringify(original)) App.change('Cores alternadas', () => { sh.banding = final; }); else preview();
    };
    const render = (body) => {
      body.innerHTML = `
        <label class="field"><span>Aplicar ao intervalo</span><input class="input" data-f="range" value="${esc(App.rangeText(band.range))}"></label>
        <label class="check"><input type="checkbox" data-f="header"${band.header ? ' checked' : ''}> Cabeçalho</label>
        <span class="sp-label">Estilos padrão</span>
        <div class="band-styles">${BAND_STYLES.map((s, i) => `<button class="band-st" data-i="${i}"><i style="background:${s[0]}"></i><i style="background:${s[1]}"></i><i style="background:${s[2]}"></i></button>`).join('')}</div>
        <span class="sp-label">Estilo personalizado</span>
        <div class="field-row"><label class="field"><span>Cabeçalho</span><input type="color" data-f="headerColor" value="${band.headerColor}"></label>
        <label class="field"><span>Cor 1</span><input type="color" data-f="color1" value="${band.color1}"></label>
        <label class="field"><span>Cor 2</span><input type="color" data-f="color2" value="${band.color2}"></label></div>
        <div class="sp-foot"><button class="btn sp-remove">Remover cores alternadas</button><button class="btn btn-primary sp-done">Concluído</button></div>`;
      const q = (f) => body.querySelector(`[data-f="${f}"]`);
      q('range').onchange = () => { const r = rangeFromInput(q('range').value); if (r) { band.range = r; preview(); } };
      q('header').onchange = () => { band.header = q('header').checked; preview(); };
      for (const f of ['headerColor', 'color1', 'color2']) q(f).oninput = () => { band[f] = q(f).value; preview(); };
      body.querySelectorAll('.band-st').forEach((b) => b.onclick = () => { const s = BAND_STYLES[+b.dataset.i]; band.headerColor = s[0]; band.headerText = '#ffffff'; band.color1 = s[1]; band.color2 = s[2]; preview(); render(body); });
      body.querySelector('.sp-remove').onclick = () => { sh.banding = sh.banding.filter((b) => b !== band); closePanel(); };
      body.querySelector('.sp-done').onclick = closePanel;
    };
    openPanel('Cores alternadas', render, finish);
  }

  // ---------- Validação de dados ----------
  const DV_TYPES = [['list', 'Menu suspenso'], ['range', 'Menu suspenso (de um intervalo)'], ['checkbox', 'Caixa de seleção'], ['number', 'Número'], ['text', 'Texto'], ['date', 'É uma data válida']];
  const CHIP_COLORS = ['#ececec', '#fde3e5', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#0d0d0d'];
  function dataValidation(opts) {
    const sh = App.sheet();
    const original = clone(sh.dv);
    let editing = null;
    const R0 = App.selRect();
    const newRule = (type) => ({ id: App.uid(), range: Object.assign({}, R0), type: type || 'list', items: ['Opção 1', 'Opção 2'], colors: {}, src: '', cond: { type: 'between', a: '', b: '' }, reject: false, help: '', style: 'chip' });
    if (opts && opts.newType) { editing = newRule(opts.newType); sh.dv.push(editing); }
    const finish = () => {
      const final = clone(sh.dv);
      sh.dv = original;
      if (JSON.stringify(final) !== JSON.stringify(original)) {
        App.change('Validação de dados', () => {
          sh.dv = final;
          for (const d of final) if (d.type === 'checkbox') for (let r = d.range.r1; r <= Math.min(d.range.r2, d.range.r1 + 5000); r++) for (let c = d.range.c1; c <= d.range.c2; c++) {
            const raw = App.raw(sh, r, c);
            if (!App.cbValid(d, raw)) { const v = App.cbValues(d); App.setRaw(sh, r, c, /^(true|verdadeiro)$/i.test(raw) || (d.prevOn && raw === d.prevOn) ? v.on : v.off); }
          }
          for (const d of final) delete d.prevOn;
        });
      } else preview();
    };
    const render = (body) => {
      if (editing) return renderRule(body);
      body.innerHTML = `<div class="cf-list">${sh.dv.map((d) => `<div class="cf-item" data-id="${d.id}"><span class="cf-chip">${icon(d.type === 'checkbox' ? 'checkbox' : 'dropdown', 16)}</span><div><b>${esc((DV_TYPES.find((t) => t[0] === d.type) || [, ''])[1])}</b><small>${esc(App.rangeText(d.range))}</small></div><button class="icon-btn cf-del" title="Excluir regra">${icon('close', 16)}</button></div>`).join('') || '<p class="sp-hint">Nenhuma regra de validação nesta página.</p>'}</div>
        <button class="btn sp-add">${icon('plus', 16)} Adicionar regra</button>
        <div class="sp-foot"><button class="btn btn-primary sp-done">Concluído</button></div>`;
      body.querySelector('.sp-add').onclick = () => { editing = newRule(); sh.dv.push(editing); preview(); render(body); };
      body.querySelectorAll('.cf-item').forEach((el) => el.onclick = (e) => {
        if (e.target.closest('.cf-del')) { sh.dv = sh.dv.filter((d) => d.id !== el.dataset.id); preview(); render(body); return; }
        editing = sh.dv.find((d) => d.id === el.dataset.id); render(body);
      });
      body.querySelector('.sp-done').onclick = closePanel;
    };
    const renderRule = (body) => {
      const d = editing;
      const numConds = App.CONDITIONS.filter((c) => ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'notBetween'].includes(c[0]));
      const textConds = App.CONDITIONS.filter((c) => ['contains', 'notContains', 'textIs', 'startsWith', 'endsWith'].includes(c[0]));
      body.innerHTML = `
        <label class="field"><span>Aplicar ao intervalo</span><input class="input" data-f="range" value="${esc(App.rangeText(d.range))}"></label>
        <label class="field"><span>Critérios</span><select class="input" data-f="type">${DV_TYPES.map(([k, l]) => `<option value="${k}"${d.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${d.type === 'list' ? `<div class="dv-items">${d.items.map((it, i) => `<div class="dv-row"><label class="dv-color" style="background:${d.colors[it] || '#ececec'}" data-i="${i}"></label><input class="input" data-item="${i}" value="${esc(it)}"><button class="icon-btn" data-rm="${i}" title="Remover item">${icon('close', 16)}</button></div>`).join('')}</div><button class="btn sp-add-item">${icon('plus', 16)} Adicionar outro item</button>` : ''}
        ${d.type === 'checkbox' ? `<label class="check"><input type="checkbox" data-f="custom"${d.custom ? ' checked' : ''}> Usar valores personalizados nas células</label>
          <div class="field-row cb-values"${d.custom ? '' : ' hidden'}><label class="field"><span>Marcada</span><input class="input" data-f="checked" value="${esc(d.checked || '')}" placeholder="Ex.: SIM"></label><label class="field"><span>Desmarcada</span><input class="input" data-f="unchecked" value="${esc(d.unchecked || '')}" placeholder="Ex.: NÃO"></label></div>
          <label class="check"><input type="checkbox" data-f="confirm"${d.confirm !== false ? ' checked' : ''}> Pedir confirmação ao marcar ou desmarcar</label>` : ''}
        ${d.type === 'range' ? `<label class="field"><span>Intervalo com os itens</span><input class="input" data-f="src" placeholder="Página1!A1:A10" value="${esc(d.src)}"></label>` : ''}
        ${d.type === 'number' ? `<label class="field"><span>Condição</span>${condSelect(d.cond.type, numConds).replace('data-f="type"', 'data-f="ctype"')}</label><div class="field-row"><input class="input" data-f="ca" placeholder="Valor" value="${esc(d.cond.a)}"><input class="input" data-f="cb" placeholder="Valor" value="${esc(d.cond.b)}"${argsFor(d.cond.type) < 2 ? ' hidden' : ''}></div>` : ''}
        ${d.type === 'text' ? `<label class="field"><span>Condição</span>${condSelect(d.cond.type, textConds).replace('data-f="type"', 'data-f="ctype"')}</label><input class="input" data-f="ca" placeholder="Texto" value="${esc(d.cond.a)}">` : ''}
        ${d.type === 'list' || d.type === 'range' ? `<label class="field"><span>Estilo de exibição</span><select class="input" data-f="style"><option value="chip"${d.style !== 'arrow' ? ' selected' : ''}>Ícone</option><option value="arrow"${d.style === 'arrow' ? ' selected' : ''}>Seta</option></select></label>` : ''}
        <details class="sp-adv"><summary>Opções avançadas</summary>
          <label class="field"><span>Se os dados forem inválidos:</span><select class="input" data-f="reject"><option value="0"${!d.reject ? ' selected' : ''}>Mostrar um aviso</option><option value="1"${d.reject ? ' selected' : ''}>Rejeitar a entrada</option></select></label>
          <label class="field"><span>Texto de ajuda</span><input class="input" data-f="help" value="${esc(d.help || '')}" placeholder="Mensagem exibida para entradas inválidas"></label></details>
        <div class="sp-foot"><button class="btn sp-remove">Remover regra</button><button class="btn btn-primary sp-back">Concluído</button></div>`;
      const q = (f) => body.querySelector(`[data-f="${f}"]`);
      q('range').onchange = () => { const R = rangeFromInput(q('range').value); if (R) { d.range = R; preview(); } };
      q('type').onchange = () => { d.type = q('type').value; d.cond.type = d.type === 'text' ? 'contains' : 'between'; preview(); renderRule(body); };
      if (q('src')) q('src').onchange = () => { d.src = q('src').value; preview(); };
      if (q('custom')) q('custom').onchange = () => { d.prevOn = App.cbValues(d).on; d.custom = q('custom').checked; body.querySelector('.cb-values').hidden = !d.custom; if (d.custom && !d.checked) { d.checked = 'SIM'; d.unchecked = 'NÃO'; q('checked').value = 'SIM'; q('unchecked').value = 'NÃO'; } preview(); };
      if (q('checked')) q('checked').oninput = () => { d.checked = q('checked').value; preview(); };
      if (q('unchecked')) q('unchecked').oninput = () => { d.unchecked = q('unchecked').value; preview(); };
      if (q('confirm')) q('confirm').onchange = () => { d.confirm = q('confirm').checked; };
      if (q('style')) q('style').onchange = () => { d.style = q('style').value; preview(); };
      if (q('ctype')) q('ctype').onchange = () => { d.cond.type = q('ctype').value; renderRule(body); };
      if (q('ca')) q('ca').oninput = () => { d.cond.a = q('ca').value; preview(); };
      if (q('cb')) q('cb').oninput = () => { d.cond.b = q('cb').value; preview(); };
      q('reject').onchange = () => { d.reject = q('reject').value === '1'; };
      q('help').oninput = () => { d.help = q('help').value; };
      body.querySelectorAll('[data-item]').forEach((inp) => inp.onchange = () => {
        const i = +inp.dataset.item, old = d.items[i];
        d.items[i] = inp.value;
        if (d.colors[old]) { d.colors[inp.value] = d.colors[old]; delete d.colors[old]; }
        preview();
      });
      body.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { d.items.splice(+b.dataset.rm, 1); preview(); renderRule(body); });
      body.querySelectorAll('.dv-color').forEach((b) => b.onclick = () => {
        const it = d.items[+b.dataset.i];
        const box = document.createElement('div');
        box.className = 'pal-row chip-colors';
        box.innerHTML = CHIP_COLORS.map((c) => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join('');
        box.onclick = (e) => { const s = e.target.closest('[data-c]'); if (!s) return; App.ui.closePopup(); d.colors[it] = s.dataset.c; preview(); renderRule(body); };
        App.ui.popup(b, box);
      });
      const addItem = body.querySelector('.sp-add-item');
      if (addItem) addItem.onclick = () => { d.items.push('Opção ' + (d.items.length + 1)); preview(); renderRule(body); const inputs = body.querySelectorAll('[data-item]'); inputs[inputs.length - 1].select(); };
      body.querySelector('.sp-remove').onclick = () => { sh.dv = sh.dv.filter((x) => x !== d); editing = null; preview(); render(body); };
      body.querySelector('.sp-back').onclick = () => { editing = null; render(body); };
    };
    openPanel('Regras de validação de dados', render, finish);
  }

  // ---------- Estatísticas da coluna ----------
  function columnStats() {
    let col = sel.ac;
    const render = (body) => {
      const sh = App.sheet(), si = doc.active, used = App.usedRange(sh);
      const vals = [];
      let blanks = 0;
      const start = sh.freeze.rows ? sh.freeze.rows + 1 : 1;
      for (let r = start; r <= Math.max(used.maxR, 1); r++) {
        const v = App.value(si, r, col);
        if (v === null || v === '') blanks++; else vals.push(v);
      }
      const nums = vals.filter((v) => typeof v === 'number');
      const freq = new Map();
      for (const v of vals) { const t = App.fmtValue(v, App.style(sh, 1, col).nf); freq.set(t, (freq.get(t) || 0) + 1); }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const maxF = top.length ? top[0][1] : 1;
      const sum = nums.reduce((a, b) => a + b, 0);
      const sorted = nums.slice().sort((a, b) => a - b);
      const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
      const f = (x) => (x === null || !nums.length ? '—' : App.fmtAuto(+x.toPrecision(10)));
      body.innerHTML = `
        <div class="cs-nav"><button class="icon-btn" data-d="-1" title="Coluna anterior">‹</button><b>Coluna ${E.numToCol(col)}</b><button class="icon-btn" data-d="1" title="Próxima coluna">›</button></div>
        <h3 class="sp-sub">Frequência</h3>
        <div class="cs-freq">${top.map(([t, n]) => `<div class="cs-bar"><span title="${esc(t)}">${esc(t || '(vazio)')}</span><i style="width:${(n / maxF) * 100}%"></i><em>${n}</em></div>`).join('') || '<p class="sp-hint">Coluna vazia.</p>'}</div>
        <h3 class="sp-sub">Resumo</h3>
        <table class="cs-table"><tr><td>Contagem</td><td>${vals.length}</td></tr><tr><td>Valores únicos</td><td>${freq.size}</td></tr><tr><td>Células vazias</td><td>${blanks}</td></tr>
        <tr><td>Soma</td><td>${f(nums.length ? sum : null)}</td></tr><tr><td>Média</td><td>${f(nums.length ? sum / nums.length : null)}</td></tr><tr><td>Mediana</td><td>${f(med)}</td></tr>
        <tr><td>Mínimo</td><td>${f(nums.length ? sorted[0] : null)}</td></tr><tr><td>Máximo</td><td>${f(nums.length ? sorted[sorted.length - 1] : null)}</td></tr></table>`;
      body.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { col = Math.max(1, Math.min(sh.cols, col + +b.dataset.d)); App.grid.selectCols(col, col); render(body); });
    };
    const p = openPanel('Estatísticas da coluna', render);
    const refresh = () => { if (current === p) render(p.body); };
    App.on('change', refresh);
  }

  // ---------- Intervalos nomeados ----------
  function namedRanges() {
    const render = (body) => {
      const names = Object.keys(doc.names);
      body.innerHTML = `<div class="cf-list">${names.map((n) => `<div class="cf-item" data-n="${esc(n)}"><div><b>${esc(n)}</b><small>${esc(doc.names[n])}</small></div><button class="icon-btn cf-del" title="Excluir">${icon('close', 16)}</button></div>`).join('') || '<p class="sp-hint">Nomeie intervalos para usá-los em fórmulas, como =SOMA(Vendas).</p>'}</div>
        <div class="nr-form"><input class="input" data-f="name" placeholder="Nome (ex.: Vendas)"><input class="input" data-f="range" value="${esc(App.rangeText(App.selRect(), App.sheet().name))}"><button class="btn btn-primary nr-add">Adicionar</button></div>`;
      body.querySelectorAll('.cf-item').forEach((el) => el.onclick = (e) => {
        const n = el.dataset.n;
        if (e.target.closest('.cf-del')) { App.change('Excluir intervalo nomeado', () => { delete doc.names[n]; }); render(body); return; }
        const t = App.parseRange(doc.names[n]);
        if (t) { if (t.si !== doc.active) { doc.active = t.si; App.emit('sheet'); } App.grid.selectRange(t.R); }
      });
      body.querySelector('.nr-add').onclick = () => {
        const name = body.querySelector('[data-f="name"]').value.trim(), range = body.querySelector('[data-f="range"]').value.trim();
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name) || E.FUNCTIONS[name.toUpperCase()]) return notify('Nome inválido. Use letras, números e "_", começando por uma letra, e não use endereços como A1.');
        if (!App.parseRange(range)) return notify('Intervalo inválido.');
        const p = App.parseRange(range);
        App.change('Intervalo nomeado', () => { doc.names[name] = App.rangeText(p.R, doc.sheets[p.si].name); });
        render(body);
      };
    };
    openPanel('Intervalos nomeados', render);
  }

  // ---------- Histórico de versões ----------
  const vkey = () => 'planilhas:versions:' + App.docId;
  const loadVersions = () => { try { return JSON.parse(localStorage.getItem(vkey()) || '[]'); } catch (e) { return []; } };
  function saveVersion(name, auto) {
    const list = loadVersions();
    const data = App.serialize();
    if (auto && list.length && list[0].data === data) return;
    list.unshift({ id: App.uid(), time: Date.now(), name: name || '', auto: !!auto, data });
    // mantém as versões nomeadas e as 30 mais recentes
    const keep = list.filter((v, i) => v.name || i < 30).slice(0, 60);
    try { localStorage.setItem(vkey(), JSON.stringify(keep)); }
    catch (e) { try { localStorage.setItem(vkey(), JSON.stringify(keep.slice(0, 8))); } catch (e2) { /* sem espaço */ } }
  }
  function versionHistory() {
    saveVersion('', true);
    const render = (body) => {
      const list = loadVersions();
      body.innerHTML = `<p class="sp-hint">As versões ficam guardadas neste navegador. Uma versão é salva automaticamente a cada 5 minutos de edição.</p>
        <div class="vh-list">${list.map((v, i) => `<div class="vh-item" data-i="${i}"><div><b>${esc(v.name || new Date(v.time).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }))}</b>${v.name ? `<small>${esc(new Date(v.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</small>` : ''}${i === 0 ? '<small class="vh-cur">Versão atual</small>' : ''}</div>
          ${i > 0 ? '<button class="btn vh-restore">Restaurar</button>' : ''}</div>`).join('')}</div>
        <button class="btn sp-add">Nomear versão atual</button>`;
      body.querySelectorAll('.vh-restore').forEach((b) => b.onclick = () => {
        const v = loadVersions()[+b.closest('.vh-item').dataset.i];
        App.ui.confirm('Restaurar esta versão?', 'A planilha voltará a esta versão. Você pode desfazer com Ctrl+Z.', 'Restaurar', () => {
          const d = JSON.parse(v.data);
          App.change('Restaurar versão', () => {
            doc.sheets = d.sheets.map(App.normalizeSheet);
            doc.active = Math.min(d.active || 0, doc.sheets.length - 1);
            doc.names = d.names || {};
          });
          App.emit('sheet');
          render(body);
        });
      });
      body.querySelector('.sp-add').onclick = () => App.run('nameVersion');
    };
    openPanel('Histórico de versões', render);
  }
  let lastAuto = Date.now();
  App.on('change', () => { if (Date.now() - lastAuto > 5 * 60 * 1000) { lastAuto = Date.now(); saveVersion('', true); } });

  // ---------- Tabela dinâmica (com fórmulas, atualiza sozinha) ----------
  const AGG = [['SUM', 'SOMA'], ['COUNTA', 'CONT.VALORES'], ['AVERAGE', 'MÉDIA'], ['MAX', 'MÁXIMO'], ['MIN', 'MÍNIMO'], ['COUNTUNIQUE', 'CONTAR.ÚNICOS']];
  function pivotTable() {
    const srcSi = doc.active;
    let R = App.selRect();
    if (App.selIsCell()) R = App.dataRegion(srcSi, sel.ar, sel.ac);
    App.ui.modal({
      title: 'Criar tabela dinâmica', width: '460px',
      body: `<label class="field"><span>Intervalo de dados</span><input class="input" id="pv-range" value="${esc(App.rangeText(R, App.sheet().name))}"></label>
        <label class="check"><input type="radio" name="pv-dest" value="new" checked> Nova página</label>
        <label class="check"><input type="radio" name="pv-dest" value="cur"> Página atual, a partir da célula selecionada</label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Criar', primary: true, action: (d) => {
        const p = App.parseRange(d.querySelector('#pv-range').value);
        if (!p || p.R.r2 <= p.R.r1) { notify('Selecione um intervalo com cabeçalho e pelo menos uma linha de dados.'); return false; }
        const dest = d.querySelector('input[name=pv-dest]:checked').value;
        const cfg = { src: App.rangeText(p.R, doc.sheets[p.si].name), rows: [], cols: [], values: [], si: p.si };
        if (dest === 'new') {
          App.change('Tabela dinâmica', () => {
            const sh = App.newSheet(App.uniqueSheetName('Tabela dinâmica 1'));
            sh.pivot = Object.assign(cfg, { at: { r: 1, c: 1 } });
            doc.sheets.splice(doc.active + 1, 0, sh); doc.active++;
          });
          App.emit('sheet');
        } else {
          App.change('Tabela dinâmica', () => { App.sheet().pivot = Object.assign(cfg, { at: { r: sel.ar, c: sel.ac } }); });
        }
        setTimeout(pivotEditor, 0);
      } }],
    });
  }
  function pivotHeaders(cfg) {
    const p = App.parseRange(cfg.src);
    if (!p) return [];
    const out = [];
    for (let c = p.R.c1; c <= p.R.c2; c++) out.push({ c, name: App.fmtValue(App.value(p.si, p.R.r1, c)) || 'Coluna ' + E.numToCol(c) });
    return out;
  }
  function buildPivot(sh) {
    const cfg = sh.pivot;
    const p = App.parseRange(cfg.src);
    if (!p) return;
    const srcName = E.quoteSheet(doc.sheets[p.si].name);
    const colRange = (c) => `${srcName}!$${E.numToCol(c)}$${p.R.r1 + 1}:$${E.numToCol(c)}$${p.R.r2}`;
    const uniques = (c) => {
      const set = new Map();
      for (let r = p.R.r1 + 1; r <= p.R.r2; r++) { const v = App.value(p.si, r, c); if (v !== null && v !== '') set.set(typeof v + ':' + String(v).toLowerCase(), v); }
      return [...set.values()].sort(E.cmpValues);
    };
    // limpa a área anterior
    const at = cfg.at || { r: 1, c: 1 };
    if (cfg.area) for (let r = cfg.area.r1; r <= cfg.area.r2; r++) for (let c = cfg.area.c1; c <= cfg.area.c2; c++) App.setCellObj(sh, r, c, null);
    const lit = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : '"' + String(v).replace(/"/g, '""') + '"');
    const rowField = cfg.rows[0], colField = cfg.cols[0];
    const vals = cfg.values.length ? cfg.values : [];
    const heads = pivotHeaders(cfg);
    const hname = (c) => (heads.find((h) => h.c === c) || {}).name || E.numToCol(c);
    let r = at.r;
    const set = (rr, cc, v, s) => { App.setRaw(sh, rr, cc, v); if (s) App.setStyle(sh, rr, cc, (st) => Object.assign(st, s)); };
    const hdrStyle = { b: true, bg: '#fde8ea' };
    if (!rowField && !vals.length) { set(r, at.c, 'Adicione linhas e valores no editor da tabela dinâmica.', { i: true, color: '#6b6b6b' }); cfg.area = { r1: r, c1: at.c, r2: r, c2: at.c }; return; }
    const rowKeys = rowField ? uniques(rowField) : [null];
    const colKeys = colField ? uniques(colField) : [null];
    const agg = (v, crit) => {
      const name = (AGG.find((a) => a[0] === v.fn) || AGG[0])[1];
      if (!crit.length) return v.fn === 'COUNTA' ? `=CONT.VALORES(${colRange(v.c)})` : v.fn === 'COUNTUNIQUE' ? `=CONTAR.ÚNICOS(${colRange(v.c)})` : `=${name}(${colRange(v.c)})`;
      const pairs = crit.map(([c, key]) => `${colRange(c)};${lit(key)}`).join(';');
      if (v.fn === 'SUM') return `=SOMASES(${colRange(v.c)};${pairs})`;
      if (v.fn === 'AVERAGE') return `=SEERRO(MÉDIASES(${colRange(v.c)};${pairs});"")`;
      if (v.fn === 'MAX') return `=MÁXIMOSES(${colRange(v.c)};${pairs})`;
      if (v.fn === 'MIN') return `=MÍNIMOSES(${colRange(v.c)};${pairs})`;
      if (v.fn === 'COUNTUNIQUE') return `=CONTAR.ÚNICOS(FILTER(${colRange(v.c)};${crit.map(([c, key]) => `${colRange(c)}=${lit(key)}`).join(';')}))`;
      return `=CONT.SES(${pairs})`;
    };
    // cabeçalho
    let c = at.c;
    set(r, c, rowField ? hname(rowField) : '', hdrStyle);
    const valCols = [];
    for (const ck of colKeys) for (const v of vals) {
      c++;
      const label = (colField ? App.fmtValue(ck) + ' - ' : '') + `${(AGG.find((a) => a[0] === v.fn) || AGG[0])[1]} de ${hname(v.c)}`;
      set(r, c, label, hdrStyle);
      valCols.push({ ck, v, c });
    }
    r++;
    for (const rk of rowKeys) {
      if (rowField) set(r, at.c, rk === null ? '' : typeof rk === 'number' ? String(rk) : String(rk));
      for (const vc of valCols) {
        const crit = [];
        if (rowField) crit.push([rowField, rk]);
        if (colField) crit.push([colField, vc.ck]);
        set(r, vc.c, agg(vc.v, crit));
      }
      r++;
    }
    if (rowField) {
      set(r, at.c, 'Total geral', { b: true });
      for (const vc of valCols) set(r, vc.c, agg(vc.v, colField ? [[colField, vc.ck]] : []), { b: true });
      r++;
    }
    cfg.area = { r1: at.r, c1: at.c, r2: r - 1, c2: Math.max(at.c, c) };
  }
  function pivotEditor() {
    const sh = App.sheet();
    if (!sh.pivot) return notify('Esta página não tem uma tabela dinâmica.');
    const cfg = sh.pivot;
    const render = (body) => {
      const heads = pivotHeaders(cfg);
      const opt = (cur) => `<option value="">Nenhum</option>` + heads.map((h) => `<option value="${h.c}"${cur === h.c ? ' selected' : ''}>${esc(h.name)}</option>`).join('');
      body.innerHTML = `<label class="field"><span>Intervalo de dados</span><input class="input" data-f="src" value="${esc(cfg.src)}"></label>
        <label class="field"><span>Linhas</span><select class="input" data-f="rows">${opt(cfg.rows[0])}</select></label>
        <label class="field"><span>Colunas</span><select class="input" data-f="cols">${opt(cfg.cols[0])}</select></label>
        <span class="sp-label">Valores</span>
        <div class="pv-vals">${cfg.values.map((v, i) => `<div class="dv-row"><select class="input" data-vc="${i}">${heads.map((h) => `<option value="${h.c}"${v.c === h.c ? ' selected' : ''}>${esc(h.name)}</option>`).join('')}</select><select class="input" data-vf="${i}">${AGG.map(([k, l]) => `<option value="${k}"${v.fn === k ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="icon-btn" data-vr="${i}" title="Remover">${icon('close', 16)}</button></div>`).join('')}</div>
        <button class="btn sp-add">${icon('plus', 16)} Adicionar valor</button>
        <p class="sp-hint">Os valores usam fórmulas (SOMASES, CONT.SES…) e se atualizam quando os dados mudam. Reabra este editor para incluir categorias novas.</p>
        <div class="sp-foot"><button class="btn btn-primary sp-done">Concluído</button></div>`;
      const q = (f) => body.querySelector(`[data-f="${f}"]`);
      const apply = () => { App.change('Tabela dinâmica', () => buildPivot(sh)); render(body); };
      q('src').onchange = () => { if (App.parseRange(q('src').value)) { cfg.src = q('src').value; apply(); } else notify('Intervalo inválido.'); };
      q('rows').onchange = () => { cfg.rows = q('rows').value ? [+q('rows').value] : []; apply(); };
      q('cols').onchange = () => { cfg.cols = q('cols').value ? [+q('cols').value] : []; apply(); };
      body.querySelectorAll('[data-vc]').forEach((s) => s.onchange = () => { cfg.values[+s.dataset.vc].c = +s.value; apply(); });
      body.querySelectorAll('[data-vf]').forEach((s) => s.onchange = () => { cfg.values[+s.dataset.vf].fn = s.value; apply(); });
      body.querySelectorAll('[data-vr]').forEach((b) => b.onclick = () => { cfg.values.splice(+b.dataset.vr, 1); apply(); });
      body.querySelector('.sp-add').onclick = () => {
        const heads2 = pivotHeaders(cfg);
        const numCol = heads2.find((h) => { const p = App.parseRange(cfg.src); return p && typeof App.value(p.si, p.R.r1 + 1, h.c) === 'number'; }) || heads2[heads2.length - 1];
        cfg.values.push({ c: numCol ? numCol.c : 1, fn: 'SUM' });
        apply();
      };
      body.querySelector('.sp-done').onclick = closePanel;
    };
    App.change('Tabela dinâmica', () => buildPivot(sh));
    openPanel('Editor da tabela dinâmica', render);
  }

  def('condFormat', 'Formatação condicional', condFormat);
  def('altColors', 'Cores alternadas', altColors);
  def('dataValidation', 'Validação de dados', () => dataValidation());
  def('insertDropdown', 'Menu suspenso', () => dataValidation({ newType: 'list' }));
  def('columnStats', 'Estatísticas da coluna', columnStats);
  def('namedRanges', 'Intervalos nomeados', namedRanges);
  def('versionHistory', 'Ver histórico de versões', versionHistory);
  def('nameVersion', 'Nomear versão atual', () => App.ui.prompt('Nomear versão atual', 'Nome da versão', '', (n) => { saveVersion(n.trim() || 'Versão sem nome', false); notify('Versão salva.'); if (current) current.render(current.body); }));
  def('pivotTable', 'Tabela dinâmica', pivotTable);
  def('pivotEditor', 'Editar tabela dinâmica', pivotEditor);
  App.on('sheet', () => { const sh = App.sheet(); const btn = $('pivot-chip'); if (btn) btn.hidden = !sh.pivot; });

  App.panels = Object.assign(App.panels || {}, { open: openPanel, close: closePanel, saveVersion });
})(window.App);
