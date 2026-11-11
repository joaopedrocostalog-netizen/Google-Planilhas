// Demurrage do vazio (PRÉ STACKING VAZIO): prazo = DATA BAIXA + DEMMURAGE (dias livres). Enquanto a DATA (devolução /
// retirada) estiver vazia e o STATUS não for FINALIZADO:
// - vence em até 2 dias: CONTAINER, DATA BAIXA e DEMMURAGE ficam em amarelo;  - vencida: em vermelho (sem piscar);
// - entra no botão ALERTA (regra "Demurrage do vazio", automática) e no aviso do celular (servidor, a cada 30 min).
// Administrador › Custos de demurrage: diária por armador (20' e 40') para os Indicadores do mês calcularem o custo
// estimado (devoluções fora do prazo) e o evitado (devoluções no prazo × dias de referência × diária).
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc, esc = App.esc;
  const P = () => App.preStacking;
  const serial = (v) => (App.opData ? App.opData.serial(v) : null);
  const hoje = () => { const d = new Date(); return Math.floor(E.dateToSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())))); };

  // colunas do vazio (cache por alteração)
  let cache = new Map();
  App.on('change', () => { cache = new Map(); });
  App.on('sheet', () => { cache = new Map(); });
  function cols(sh) {
    if (cache.has(sh.id)) return cache.get(sh.id);
    let c = null;
    if (P() && P().kindOfPS(sh) === 'vz') {
      const m = P().colMap(sh), f = (k) => P().findCol(m, P().A[k]);
      c = { hr: P().headerRow(sh), cont: f('CONTAINER'), baixa: f('DATABAIXA'), dem: f('DEMPS'), data: f('DATA'), status: f('STATUS'), arm: f('ARMADOR'), tipo: f('TIPO'), cli: f('CLIENTE') };
      if (!c.cont || !c.baixa || !c.dem) c = null;
    }
    cache.set(sh.id, c);
    return c;
  }
  const raw = (sh, si, r, c) => { if (!c) return ''; const x = sh.cells[E.addrToStr(r, c)]; const v = x ? x.v : ''; return typeof v === 'string' && v[0] === '=' ? App.value(si, r, c) : v; };
  // { falta, prazo } quando vence em até 2 dias ou já venceu (linha real); senão null
  App.demurrageInfo = (sh, si, r) => {
    const c = cols(sh);
    if (!c || r <= c.hr) return null;
    if (!String(raw(sh, si, r, c.cont) || '').trim()) return null;
    if (String(raw(sh, si, r, c.data) || '').trim()) return null;
    const stt = P().norm(raw(sh, si, r, c.status));
    if (stt.includes('FINALIZ') || stt === 'CANCELADO') return null;
    const b = serial(raw(sh, si, r, c.baixa)), d = Number(String(raw(sh, si, r, c.dem) || '').replace(',', '.'));
    if (b === null || !(d > 0)) return null;
    const prazo = Math.floor(b) + d, falta = prazo - hoje();
    return falta <= 2 ? { falta, prazo } : null;
  };
  // estilo das células CONTAINER, DATA BAIXA e DEMMURAGE da linha
  App.demurrageCell = (sh, si, r, c) => {
    const k = cols(sh);
    if (!k || (c !== k.cont && c !== k.baixa && c !== k.dem)) return null;
    const i = App.demurrageInfo(sh, si, r);
    if (!i) return null;
    return i.falta < 0 ? { bg: '#fce8e6', color: '#b3261e', b: true } : { bg: '#fef3c7', color: '#92400e', b: true };
  };
  App.demurrageCols = cols;

  // ---------- custos (Administrador › Custos de demurrage) ----------
  const vz = () => doc.sheets.find((s) => P() && P().kindOfPS(s) === 'vz');
  const cfg = () => { const s = vz(); return (s && s.demCustos) || { moeda: 'US$', ref: 3, padrao: { d20: 0, d40: 0 }, tabela: [] }; };
  // diária do armador para o tipo (20 ou 40 pés)
  App.demDiaria = (armador, tipo) => {
    const c = cfg(), a = P().norm(armador), t = /^\s*20/.test(String(tipo || '')) ? 'd20' : 'd40';
    const lin = (c.tabela || []).find((x) => { const n = P().norm(x.armador); return n && (a === n || (n.length >= 3 && a.includes(n))); });
    return Number((lin && lin[t]) || (c.padrao && c.padrao[t]) || 0);
  };
  App.demCfg = cfg;
  App.commands.def('demCustos', 'Custos de demurrage', () => {
    if (App.adminOnly && App.adminOnly()) return App.emit('notify', 'Somente administradores ajustam os custos de demurrage.');
    const s = vz();
    if (!s) return App.emit('notify', 'A aba PRÉ STACKING VAZIO não foi encontrada.');
    const c = JSON.parse(JSON.stringify(cfg()));
    const linha = (x) => `<tr><td><input class="input" data-a value="${esc(x.armador || '')}" placeholder="MSC"></td><td><input class="input" data-20 type="number" min="0" step="0.01" value="${x.d20 || ''}"></td><td><input class="input" data-40 type="number" min="0" step="0.01" value="${x.d40 || ''}"></td><td><button class="icon-btn" data-x title="Tirar">✕</button></td></tr>`;
    const m = App.ui.modal({
      title: 'Custos de demurrage', width: '600px',
      body: `<p class="sp-hint">Diária cobrada por armador depois dos dias livres (DEMMURAGE). Usada nos Indicadores do mês: <b>custo estimado</b> = dias de atraso × diária; <b>custo evitado</b> = devoluções no prazo × dias de referência × diária.</p>
        <div class="dc-top"><label class="field"><span>Moeda</span><select class="input" id="dc-moeda">${['US$', 'R$', '€'].map((x) => `<option${c.moeda === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field"><span>Dias de referência (evitado)</span><input class="input" id="dc-ref" type="number" min="1" max="60" value="${c.ref || 3}"></label>
        <label class="field"><span>Padrão 20'</span><input class="input" id="dc-p20" type="number" min="0" step="0.01" value="${(c.padrao || {}).d20 || ''}"></label>
        <label class="field"><span>Padrão 40'</span><input class="input" id="dc-p40" type="number" min="0" step="0.01" value="${(c.padrao || {}).d40 || ''}"></label></div>
        <div class="ind-tbl"><table><thead><tr><th>Armador</th><th>Diária 20'</th><th>Diária 40'</th><th></th></tr></thead><tbody id="dc-rows">${(c.tabela || []).map(linha).join('')}</tbody></table></div>
        <button class="btn btn-sm" id="dc-add" style="margin-top:8px">+ Armador</button>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const num = (sel) => Number((d.querySelector(sel) || {}).value) || 0;
        const tabela = [...d.querySelectorAll('#dc-rows tr')].map((tr) => ({ armador: tr.querySelector('[data-a]').value.trim(), d20: Number(tr.querySelector('[data-20]').value) || 0, d40: Number(tr.querySelector('[data-40]').value) || 0 })).filter((x) => x.armador);
        const novo = { moeda: d.querySelector('#dc-moeda').value, ref: Math.max(1, num('#dc-ref') || 3), padrao: { d20: num('#dc-p20'), d40: num('#dc-p40') }, tabela };
        App.change('Custos de demurrage', () => { s.demCustos = novo; });
        App.emit('notify', 'Custos de demurrage salvos.');
      } }],
    });
    const rows = m.el.querySelector('#dc-rows');
    const liga = () => rows.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => b.closest('tr').remove()));
    m.el.querySelector('#dc-add').onclick = () => { rows.insertAdjacentHTML('beforeend', linha({})); liga(); };
    liga();
  });
})(window.App);
