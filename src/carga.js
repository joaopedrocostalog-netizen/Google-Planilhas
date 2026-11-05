// Containers da Carga OF (API carga_of_container), no mesmo jeito dos Motoristas do DSS:
// Administrador › "Containers da Carga OF (DATA BAIXA)" escolhe, na página, a coluna do CONTAINER e a da data.
// Ao digitar ou colar um container nessa coluna, a planilha procura na API e preenche a data (dd/mm/aaaa).
// A mesma tela mostra se a API está respondendo e permite consultar um container.
(function (App) {
  'use strict';
  const E = App.E, esc = App.esc, doc = App.doc;
  const notify = (m) => App.emit('notify', m);
  const api = (...a) => App.collab.api(...a);
  const nro = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const firstRow = (sh) => (sh.colNames && Object.keys(sh.colNames).length ? 1 : 2);

  // ---------- preenchimento automático ----------
  const fila = new Map(); // "sheetId|linha" → container
  let timer = null;
  function agenda(sh, r, cont) { fila.set(sh.id + '|' + r, cont); clearTimeout(timer); timer = setTimeout(processa, 250); }
  async function processa() {
    const itens = [...fila].map(([k, cont]) => { const [id, r] = k.split('|'); return { id, r: +r, cont }; });
    fila.clear();
    let falhas = 0, naoAchou = [];
    for (const it of itens.slice(0, 60)) {
      const sh = doc.sheets.find((x) => x.id === it.id);
      const cf = sh && sh.carga;
      if (!cf) continue;
      let res;
      try { res = await api('GET', '/api/carga/data-baixa?container=' + encodeURIComponent(it.cont)); }
      catch (e) { if (!falhas++) notify(`Carga OF: ${e.message}`); continue; }
      if (!res || !res.achou) { naoAchou.push(it.cont); continue; }
      App.withReal(() => {
        // o container pode ter mudado enquanto a API respondia
        if (nro(App.raw(sh, it.r, cf.col)) !== nro(it.cont)) return;
        if (App.editGuard && App.editGuard(sh, it.r, cf.dataCol, true)) return;
        if (String(App.raw(sh, it.r, cf.dataCol) || '').trim() === res.data) return;
        App.change('Data da Carga OF', () => { App.setRaw(sh, it.r, cf.dataCol, res.data); App.setStyle(sh, it.r, cf.dataCol, (s) => { s.nf = 'dd/mm/yyyy'; }); });
      });
    }
    if (naoAchou.length) notify(`Carga OF: ${naoAchou.length === 1 ? 'o container ' + naoAchou[0] + ' não foi encontrado' : naoAchou.length + ' containers não foram encontrados'} na API.`);
    if (itens.length > 60) notify('Carga OF: procurei os 60 primeiros; os outros podem ser preenchidos em Administrador › Containers da Carga OF › Preencher vazios.');
  }
  App.on('localPatch', (fwd) => {
    if (!App.cloudMode || !fwd || !fwd.sheets) return;
    for (const id in fwd.sheets) {
      const e = fwd.sheets[id];
      const sh = doc.sheets.find((x) => x.id === id);
      if (!e.cells || !sh || !sh.carga) continue;
      for (const a in e.cells) {
        const p = E.parseAddr(a);
        if (!p || p.col !== sh.carga.col || p.row < firstRow(sh)) continue;
        const c = e.cells[a];
        const cont = nro(c && c.v);
        if (cont.length >= 10) agenda(sh, p.row, cont);
      }
    }
  });

  // ---------- tela do administrador ----------
  const fmtCampo = (k) => String(k).replace(/_/g, ' ').toUpperCase();
  function tabela(regs) {
    if (!regs.length) return '<p class="sp-hint">Nenhum registro.</p>';
    // os campos mais úteis primeiro (a API traz mais de 30, em ordem alfabética)
    const PRIMEIRO = ['nro_container', 'data_hora_entrada', 'data_hora_saida', 'situacao', 'status', 'modelo_container', 'importador_exportador', 'ref_cliente', 'nro_documento', 'tipo_documento', 'navio', 'armazem', 'local_armazenagem', 'placa_entrada', 'condutor_entrada', 'placa_saida', 'condutor_saida', 'qtd_dias'];
    const ks = [];
    for (const r of regs) for (const k of Object.keys(r)) if (!ks.includes(k)) ks.push(k);
    ks.sort((a, b) => { const ia = PRIMEIRO.indexOf(a), ib = PRIMEIRO.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    const cols = ks.slice(0, 14);
    return `<div class="cg-tab"><table><thead><tr>${cols.map((k) => `<th>${esc(fmtCampo(k))}</th>`).join('')}</tr></thead><tbody>${regs.map((r) => `<tr>${cols.map((k) => `<td>${esc(r[k] === null || r[k] === undefined ? '' : String(r[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function dialog() {
    const sh = App.sheet();
    const byName = (n) => (App.colByName ? App.colByName(sh, n) : null);
    const cur = sh.carga || { col: byName('CONTAINER') || 1, dataCol: byName('DATA BAIXA') || byName('DATA ENTRADA') || 2 };
    const colOpts = (sel) => { let o = ''; for (let c = 1; c <= Math.max(sh.cols, 64); c++) { const n = sh.colNames && sh.colNames[c]; o += `<option value="${c}"${c === sel ? ' selected' : ''}>${E.numToCol(c)}${n ? ' · ' + esc(n) : App.raw(sh, 1, c) ? ' · ' + esc(String(App.raw(sh, 1, c)).slice(0, 30)) : ''}</option>`; } return o; };
    const m = App.ui.modal({
      title: 'Containers da Carga OF', width: 'min(900px, 96vw)', enterSubmits: false,
      body: `<p class="sp-hint">Igual aos Motoristas do DSS: ao digitar ou colar um container na coluna escolhida, a planilha procura na API Carga OF Container e preenche a data de entrada (dd/mm/aaaa) na outra coluna. O container pode estar com ou sem espaço, ponto e traço.</p>
        <div class="field-row"><label class="field"><span>Coluna do CONTAINER</span><select class="input" id="cg-col">${colOpts(cur.col)}</select></label>
        <label class="field"><span>Coluna da data (DATA BAIXA)</span><select class="input" id="cg-dat">${colOpts(cur.dataCol)}</select></label></div>
        <div class="cg-status" id="cg-status">Testando a API…</div>
        <div class="cg-busca"><input class="input" id="cg-q" placeholder="Consultar um container (ex.: TRHU 861.819-1)"><button class="btn" id="cg-go">Consultar</button><button class="btn" id="cg-rec">Últimas entradas</button></div>
        <div id="cg-res"></div>`,
      buttons: [
        ...(sh.carga ? [{ label: 'Desativar', action: () => { App.change('Containers da Carga OF', () => { delete sh.carga; }); notify('Containers da Carga OF desativados nesta página.'); } }] : []),
        { label: 'Preencher vazios', action: (d) => { preencherVazios(sh, +d.querySelector('#cg-col').value, +d.querySelector('#cg-dat').value); return false; } },
        { label: 'Cancelar' },
        { label: 'Salvar', primary: true, action: (d) => {
          const col = +d.querySelector('#cg-col').value, dataCol = +d.querySelector('#cg-dat').value;
          if (col === dataCol) { notify('Escolha colunas diferentes para o container e a data.'); return false; }
          App.change('Containers da Carga OF', () => { sh.carga = { col, dataCol }; });
          notify(`Containers da Carga OF ativados: container na coluna ${E.numToCol(col)}, data na ${E.numToCol(dataCol)}.`);
        } },
      ],
    });
    const d = m.el, q = (x) => d.querySelector(x);
    q('#cg-q').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); consulta(); } });
    const res = q('#cg-res');
    async function consulta(recentes) {
      const c = recentes ? '' : q('#cg-q').value.trim();
      if (!recentes && nro(c).length < 4) return notify('Digite ao menos 4 letras ou números do container.');
      res.innerHTML = '<p class="sp-hint">Consultando…</p>';
      try {
        const r = await api('GET', '/api/carga/consulta' + (c ? '?container=' + encodeURIComponent(c) : ''));
        res.innerHTML = `<p class="sp-label">${recentes ? `Últimas entradas (${Math.min(100, r.total)} de ${r.total})` : `${r.total} ${r.total === 1 ? 'registro' : 'registros'} para ${esc(c)}`}</p>` + tabela(r.registros);
      } catch (e) { res.innerHTML = `<p class="auth-err">${esc(e.message)}</p>`; }
    }
    q('#cg-go').onclick = (e) => { e.preventDefault(); consulta(false); };
    q('#cg-rec').onclick = (e) => { e.preventDefault(); consulta(true); };
    api('GET', '/api/carga/diag').then((g) => {
      const el = q('#cg-status');
      if (!el) return;
      const ok = g.json && g.http < 400 && g.registros > 0;
      el.className = 'cg-status ' + (ok ? 'ok' : 'err');
      el.innerHTML = ok
        ? `✓ API respondendo: <b>${g.registros}</b> registros · campos <b>${esc(g.campoContainer || '?')}</b> e <b>${esc(g.campoData || '?')}</b> · ${g.ms} ms`
        : `✗ A API não trouxe registros. ${g.erro ? 'Erro: ' + esc(g.erro) + '. ' : ''}${g.http ? 'HTTP ' + g.http + (g.json === false ? ' (não é JSON)' : '') + '. ' : ''}${g.formato ? 'Resposta: ' + esc(g.formato) + '. ' : ''}${g.inicio ? 'Início: <code>' + esc(g.inicio) + '</code>' : ''}`;
      el.innerHTML += `<small>URL ${esc(g.url)} · variável ${esc(g.variavel)} · ${esc(g.login)} · ${esc(g.metodo)}${g.periodo ? ' · período: ' + esc(g.periodo) : ''}${g.mensagem ? ' · resposta da API: ' + esc(g.mensagem) : ''}</small>`;
    }).catch((e) => { const el = q('#cg-status'); if (el) { el.className = 'cg-status err'; el.textContent = e.message; } });
  }
  // procura todos os containers da coluna que estão sem data
  function preencherVazios(sh, col, dataCol) {
    if (col === dataCol) return notify('Escolha colunas diferentes para o container e a data.');
    const used = App.usedRange(sh);
    let n = 0;
    App.withReal(() => {
      for (let r = firstRow(sh); r <= used.maxR; r++) {
        const cont = nro(App.raw(sh, r, col));
        if (cont.length >= 10 && !String(App.raw(sh, r, dataCol) || '').trim()) { fila.set(sh.id + '|' + r, cont); n++; }
      }
    });
    if (!n) return notify('Nenhum container sem data nesta coluna.');
    if (!sh.carga || sh.carga.col !== col || sh.carga.dataCol !== dataCol) App.change('Containers da Carga OF', () => { sh.carga = { col, dataCol }; });
    notify(`Carga OF: procurando ${n} ${n === 1 ? 'container' : 'containers'}…`);
    clearTimeout(timer); timer = setTimeout(processa, 50);
  }
  App.commands.def('cargaLookup', 'Containers da Carga OF', () => {
    if (!App.cloudMode || !App.collab || !App.collab.api) return notify('Disponível nas planilhas da nuvem.');
    dialog();
  });
  App.carga = { dialog, preencherVazios };
})(window.App);
