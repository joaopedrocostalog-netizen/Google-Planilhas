// Histórico do container (botão direito na célula › Histórico do container, ou Ferramentas): ficha com as linhas
// atuais do container em todas as abas (MAPA, PRÉ STACKING…) e a linha do tempo de tudo o que mudou nelas, com quem e
// quando — inclusive mudanças em que o número aparece mesmo antes de trocar de linha.
// Personalizar: escolher as colunas que aparecem, esconder campos vazios, pessoas, mudanças de colunas
// específicas e itens um a um. As escolhas ficam guardadas neste aparelho. Dá para imprimir o relatório.
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc, esc = App.esc;
  const KEY = 'planilhas:histcont';
  const norm = (s) => String(s === null || s === undefined ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefsLe = () => { try { return Object.assign({ cols: null, vazios: true, ocultos: [], pessoas: [], colsTempo: null }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { cols: null, vazios: true, ocultos: [], pessoas: [], colsTempo: null }; } };
  const prefsGrava = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignora */ } };

  // cabeçalho de cada coluna da aba (pela linha do cabeçalho do PRÉ STACKING/MAPA)
  function cabecalho(sh) {
    const P = App.preStacking, hr = P ? P.headerRow(sh) : 1, out = {};
    const maxC = App.usedRange(sh).maxC || 1;
    for (let c = 1; c <= maxC; c++) { const n = (sh.colNames || {})[c] || (sh.cells[E.addrToStr(hr, c)] || {}).v; if (n !== undefined && n !== null && String(n).trim()) out[c] = String(n).trim(); }
    return { hr, out };
  }
  // linhas atuais com o container (colunas de container de cada aba)
  function achaLinhas(cont) {
    const res = [];
    App.withReal(() => doc.sheets.forEach((sh, si) => {
      if (sh.shadow) return;
      const { hr, out } = cabecalho(sh);
      const cc = Object.keys(out).map(Number).filter((c) => /CONTAINER$/.test(norm(out[c])));
      if (!cc.length) return;
      const rows = new Set();
      for (const a in sh.cells) {
        const p = E.parseAddr(a);
        if (!p || p.row <= hr || !cc.includes(p.col)) continue;
        if (norm(sh.cells[a].v).includes(cont)) rows.add(p.row);
      }
      for (const r of rows) {
        const campos = Object.keys(out).map(Number).map((c) => ({ c, nome: out[c], v: App.fmtValue ? App.fmtValue(App.value(si, r, c), App.style(sh, r, c).nf) : String(App.value(si, r, c) ?? '') }));
        res.push({ sh, si, r, campos, cab: out });
      }
    }));
    return res;
  }

  async function abrir(inicial) {
    let cont = norm(inicial || '');
    if (!cont) {
      const s = App.sel, i = s ? App.cellInfo(s.ar, s.ac) : null;
      if (i && /[A-Z]{4}\d{6}/.test(norm(i.text))) cont = norm(i.text).match(/[A-Z]{4}\d{6,7}/)[0];
    }
    const wrap = document.createElement('div');
    wrap.className = 'hc';
    wrap.innerHTML = `<div class="hc-bar"><input class="input" id="hc-c" placeholder="Número do container (ex.: CSQU3054383)" value="${esc(cont)}"><button class="btn btn-primary" id="hc-ir">Ver</button><button class="btn" id="hc-pers">Personalizar</button></div><div id="hc-res"><p class="sp-hint">Digite o número e toque em Ver.</p></div>`;
    const m = App.ui.modal({ title: 'Histórico do container', width: '900px', cls: 'modal-tall', body: wrap, buttons: [{ label: 'Imprimir', action: () => { imprimir(wrap); return false; } }, { label: 'Fechar', primary: true }] });
    let dados = null;
    const res = wrap.querySelector('#hc-res');
    const carrega = async () => {
      cont = norm(wrap.querySelector('#hc-c').value);
      if (cont.length < 6) { res.innerHTML = '<p class="sp-hint">Informe o número do container.</p>'; return; }
      res.innerHTML = '<p class="sp-hint">Procurando…</p>';
      const linhas = achaLinhas(cont);
      let tempo = [];
      if (App.cloudMode && App.cloud && App.cloud.id) {
        try { tempo = await App.collab.api('POST', `/api/docs/${App.cloud.id}/historico-container`, { container: cont, linhas: linhas.map((l) => ({ sheetId: l.sh.id, rows: [l.r] })) }); }
        catch (e) { res.innerHTML = `<p class="sp-hint">${esc(e.message)}</p>`; return; }
      }
      dados = { cont, linhas, tempo };
      desenha();
    };
    function desenha() {
      if (!dados) return;
      const pr = prefsLe();
      const nomeCol = (s, a) => { const l = dados.linhas.find((x) => x.sh.id === s); const sh = doc.sheets.find((x) => x.id === s); const p = E.parseAddr(a); const cab = l ? l.cab : sh ? cabecalho(sh).out : {}; return (p && cab[p.col]) || (p ? E.numToCol(p.col) : a); };
      const abaNome = (s) => (doc.sheets.find((x) => x.id === s) || {}).name || '?';
      const ficha = dados.linhas.map((l) => {
        const campos = l.campos.filter((f) => (!pr.cols || pr.cols.includes(f.nome)) && (!pr.vazios || String(f.v).trim()));
        return `<section class="hc-card"><h3>${esc(l.sh.name)} <small>linha ${l.r}</small> <button class="btn btn-sm" data-ir="${l.sh.id}:${l.r}">Ir para a linha</button></h3><dl>${campos.map((f) => `<dt>${esc(f.nome)}</dt><dd>${esc(f.v)}</dd>`).join('')}</dl></section>`;
      }).join('') || '<p class="sp-hint">O container não está em nenhuma linha agora.</p>';
      const itens = dados.tempo.filter((h) => {
        const id = h.s + h.a + h.at;
        if (pr.ocultos.includes(id) || pr.pessoas.includes(h.name)) return false;
        if (pr.colsTempo && !pr.colsTempo.includes(nomeCol(h.s, h.a))) return false;
        return String(h.before ?? '') !== String(h.after ?? '');
      });
      const tempo = itens.map((h) => `<li><time>${esc(new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</time> <b>${esc(h.name)}</b> · ${esc(abaNome(h.s))} › <b>${esc(nomeCol(h.s, h.a))}</b>: <span class="hc-de">${esc(h.before || '(vazio)')}</span> → <span class="hc-para">${esc(h.after || '(vazio)')}</span> <button class="hc-x" data-oc="${esc(h.s + h.a + h.at)}" title="Ocultar este item do relatório">ocultar</button></li>`).join('');
      const esc_ = dados.tempo.length - itens.length;
      res.innerHTML = `<h3 class="dia-h">${esc(dados.cont)}${App.containerConfere && App.containerConfere(dados.cont) ? ' <em class="bad">· número com dígito verificador errado</em>' : ''}</h3>${ficha}
        <h3 class="dia-h">Linha do tempo <small>${itens.length}${esc_ ? ` (${esc_} ocultos)` : ''}</small></h3>
        ${App.cloudMode ? `<ul class="hc-tempo">${tempo || '<li class="sp-hint">Nenhuma mudança registrada.</li>'}</ul>` : '<p class="sp-hint">A linha do tempo vem do servidor: abra a planilha na nuvem.</p>'}`;
      res.querySelectorAll('[data-oc]').forEach((b) => (b.onclick = () => { const p = prefsLe(); p.ocultos.push(b.dataset.oc); p.ocultos = p.ocultos.slice(-2000); prefsGrava(p); desenha(); }));
      res.querySelectorAll('[data-ir]').forEach((b) => (b.onclick = () => { const [s, r] = b.dataset.ir.split(':'); m.close ? m.close() : m.el.querySelector('.modal-x').click(); App.opData.goTo(doc.sheets.find((x) => x.id === s), +r, 1); }));
    }
    function personalizar() {
      if (!dados) return App.emit('notify', 'Procure um container primeiro.');
      const pr = prefsLe();
      const colsFicha = [...new Set(dados.linhas.flatMap((l) => l.campos.map((f) => f.nome)))];
      const colsT = [...new Set(dados.tempo.map((h) => { const l = dados.linhas.find((x) => x.sh.id === h.s); const p = E.parseAddr(h.a); return (l && p && l.cab[p.col]) || h.a.replace(/\d+/, ''); }))];
      const pessoas = [...new Set(dados.tempo.map((h) => h.name))];
      const box = (id, lista, marcados) => `<div class="hc-boxes">${lista.map((x) => `<label class="check"><input type="checkbox" data-${id}="${esc(x)}"${!marcados || marcados.includes(x) ? ' checked' : ''}> ${esc(x)}</label>`).join('') || '<span class="sp-hint">—</span>'}</div>`;
      App.ui.modal({
        title: 'Personalizar o relatório', width: '640px',
        body: `<p class="sp-label">Campos da ficha</p>${box('f', colsFicha, pr.cols)}
          <label class="check"><input type="checkbox" id="hp-v"${pr.vazios ? ' checked' : ''}> Esconder campos vazios</label>
          <p class="sp-label">Mudanças que aparecem na linha do tempo (por coluna)</p>${box('t', colsT, pr.colsTempo)}
          <p class="sp-label">Pessoas (desmarque para esconder as mudanças delas)</p>${box('p', pessoas, pessoas.filter((x) => !pr.pessoas.includes(x)))}
          <p class="sp-hint">${pr.ocultos.length} ${pr.ocultos.length === 1 ? 'item ocultado' : 'itens ocultados'} um a um. <button class="btn btn-sm" id="hp-r">Mostrar de novo</button></p>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, action: (d) => {
          const marc = (k) => [...d.querySelectorAll(`[data-${k}]`)].filter((x) => x.checked).map((x) => x.getAttribute('data-' + k));
          const f = marc('f'), t = marc('t'), p = marc('p');
          const np = prefsLe();
          np.cols = f.length === colsFicha.length ? null : f;
          np.colsTempo = t.length === colsT.length ? null : t;
          np.pessoas = pessoas.filter((x) => !p.includes(x));
          np.vazios = d.querySelector('#hp-v').checked;
          if (d.dataset.reset) np.ocultos = [];
          prefsGrava(np); desenha();
        } }],
      });
      const r = document.getElementById('hp-r');
      if (r) r.onclick = () => { r.closest('dialog').dataset.reset = '1'; r.textContent = 'Serão mostrados ao aplicar'; r.disabled = true; };
    }
    wrap.querySelector('#hc-ir').onclick = carrega;
    wrap.querySelector('#hc-c').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') carrega(); });
    wrap.querySelector('#hc-pers').onclick = personalizar;
    if (cont) carrega();
  }
  function imprimir(wrap) {
    const w = window.open('', '_blank');
    if (!w) return App.emit('notify', 'O navegador bloqueou a janela de impressão.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Histórico do container</title><style>body{font:13px Arial;margin:24px}h3{margin:14px 0 6px}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0}dt{color:#555}dd{margin:0}li{margin:3px 0}button{display:none}.hc-de{color:#b3261e}.hc-para{color:#188038}section{border:1px solid #ccc;border-radius:6px;padding:8px 12px;margin:8px 0}</style></head><body><h2>Histórico do container</h2>${wrap.querySelector('#hc-res').innerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
  App.commands.def('containerHistorico', 'Histórico do container', () => abrir());
  App.on('contextItems', ({ hit, items }) => {
    if (hit.area !== 'cell') return;
    const i = App.cellInfo(hit.r, hit.c);
    if (!i || !/[A-Z]{4}\d{6}/.test(norm(i.text))) return;
    const at = items.findIndex((x) => x === '-');
    items.splice(at >= 0 ? at : items.length, 0, { label: 'Histórico do container', icon: 'history', cmd: 'containerHistorico' });
  });
  App.containerHistorico = abrir;
})(window.App);
