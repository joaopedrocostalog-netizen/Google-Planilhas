// Ver › Indicadores do mês: o que o PRÉ STACKING registrou no mês escolhido.
// - Movimentações: REMOÇÃO e EMBARQUE (PRÉ STACKING CHEIO, pela data do AGENDAMENTO) e DEVOLUÇÃO e RETIRADA
//   (PRÉ STACKING VAZIO, pela DATA; sem ela, pelo AGENDAMENTO); por cliente e nos últimos 6 meses;
// - Demurrage: devoluções/retiradas do mês dentro e fora do prazo (DATA BAIXA + DEMMURAGE dias);
// - Tempo médio do P.S. até o FINALIZADO (a hora do FINALIZADO passou a ser guardada em 06/11/2026).
// Exporta CSV (Excel) com a tabela por cliente e a lista de demurrage fora do prazo.
(function (App) {
  'use strict';
  const E = App.E, esc = App.esc;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const OPS = ['REMOÇÃO', 'EMBARQUE', 'DEVOLUÇÃO', 'RETIRADA'];
  const mesDe = (s) => { const d = E.serialToDate(s); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
  const nomeMes = (ym) => `${MESES[ym % 100 - 1]} de ${Math.floor(ym / 100)}`;
  const curto = (ym) => MESES[ym % 100 - 1].slice(0, 3) + '/' + String(Math.floor(ym / 100)).slice(2);
  const voltaMes = (ym, n) => { let y = Math.floor(ym / 100), m = ym % 100 - n; while (m < 1) { m += 12; y--; } return y * 100 + m; };

  // todas as movimentações registradas no PRÉ STACKING (cada linha com data, cliente, operação…)
  function movimentos() {
    const O = App.opData, ab = O.abas(), out = [];
    for (const k of ['ch', 'vz']) {
      const sh = ab[k];
      if (!sh) continue;
      for (const L of O.linhas(sh)) {
        const link = O.linkDe(L);
        const opTxt = App.preStacking.norm(O.txt(L.get('OPERACAO')));
        const op = OPS.find((o) => App.preStacking.norm(o) === opTxt) || (k === 'ch' ? 'REMOÇÃO/EMBARQUE' : 'DEVOLUÇÃO/RETIRADA');
        const data = k === 'ch' ? O.serial(L.get('AGENDAMENTO')) : (O.serial(L.get('DATA')) ?? O.serial(L.get('AGENDAMENTO')));
        const criado = link ? parseInt(link.id.slice(0, -6), 36) : null;
        const quando = data ?? (link && link.psf ? O.tsSerial(link.psf) : criado ? O.tsSerial(criado) : null);
        if (quando === null) continue;
        const m = { k, sh, r: L.r, op, quando, cli: O.txt(L.get('CLIENTE')) || '(sem cliente)', cont: O.txt(L.get('CONTAINER')), fin: O.fin(O.txt(L.get('STATUS'))) };
        if (link && link.psf && criado && link.psf > criado) m.horas = (link.psf - criado) / 36e5, m.finEm = O.tsSerial(link.psf);
        if (k === 'vz') {
          const baixa = O.serial(L.get('DATABAIXA')), dem = Number(String(L.get('DEMPS') || '').replace(',', '.')), dt = O.serial(L.get('DATA'));
          if (baixa !== null && dem > 0 && dt !== null) { m.prazo = Math.floor(baixa) + dem; m.sobra = m.prazo - Math.floor(dt); }
          m.diaria = App.demDiaria ? App.demDiaria(O.txt(L.get('ARMADOR')), O.txt(L.get('TIPO'))) : 0;
        }
        out.push(m);
      }
    }
    return out;
  }

  function calcula(ym) {
    const todos = App.withReal(movimentos);
    const doMes = todos.filter((m) => mesDe(m.quando) === ym);
    const porOp = Object.fromEntries(OPS.map((o) => [o, 0]));
    const porCli = new Map();
    for (const m of doMes) {
      if (m.op in porOp) porOp[m.op]++;
      const c = porCli.get(m.cli) || { cli: m.cli, total: 0 };
      c[m.op] = (c[m.op] || 0) + 1; c.total++;
      porCli.set(m.cli, c);
    }
    const dem = doMes.filter((m) => m.k === 'vz' && m.sobra !== undefined);
    const fora = dem.filter((m) => m.sobra < 0).sort((a, b) => a.sobra - b.sobra);
    const tempos = todos.filter((m) => m.horas !== undefined && mesDe(m.finEm) === ym).map((m) => m.horas);
    const meses = [];
    for (let i = 5; i >= 0; i--) { const x = voltaMes(ym, i); meses.push({ ym: x, n: todos.filter((m) => mesDe(m.quando) === x).length }); }
    return {
      total: doMes.length, porOp, clientes: [...porCli.values()].sort((a, b) => b.total - a.total),
      dem: { total: dem.length, dentro: dem.length - fora.length, fora, sobraMedia: dem.length ? dem.reduce((s, m) => s + m.sobra, 0) / dem.length : null,
        // custo estimado (dias de atraso × diária) e evitado (devoluções no prazo × dias de referência × diária)
        custo: fora.reduce((s, m) => s + -m.sobra * (m.diaria || 0), 0),
        evitado: dem.filter((m) => m.sobra >= 0).reduce((s, m) => s + ((App.demCfg && App.demCfg().ref) || 3) * (m.diaria || 0), 0),
        semDiaria: dem.filter((m) => !m.diaria).length },
      tempo: tempos.length ? { n: tempos.length, media: tempos.reduce((a, b) => a + b, 0) / tempos.length } : null,
      meses,
    };
  }

  const nf = (n, d) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const moeda = (v) => `${(App.demCfg && App.demCfg().moeda) || 'US$'} ${nf(v || 0, 2)}`;
  const tempoTxt = (h) => (h < 48 ? nf(h, 1) + ' h' : nf(h / 24, 1) + ' dias');
  function render(box, ym) {
    const d = calcula(ym), O = App.opData;
    const maxM = Math.max(1, ...d.meses.map((m) => m.n));
    const pct = d.dem.total ? Math.round(100 * d.dem.dentro / d.dem.total) : null;
    box.innerHTML = `
      <div class="ind-kpis">
        <div class="ind-k"><b>${nf(d.total)}</b><span>movimentações</span></div>
        ${OPS.map((o) => `<div class="ind-k"><b>${nf(d.porOp[o])}</b><span>${esc(o.toLowerCase())}</span></div>`).join('')}
        <div class="ind-k ${pct === null ? '' : pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'bad'}"><b>${pct === null ? '—' : pct + '%'}</b><span>vazio no prazo da demurrage</span></div>
        <div class="ind-k"><b>${d.tempo ? tempoTxt(d.tempo.media) : '—'}</b><span>do P.S. ao FINALIZADO${d.tempo ? ` (${d.tempo.n})` : ''}</span></div>
        <div class="ind-k ${d.dem.custo ? 'bad' : ''}"><b>${moeda(d.dem.custo)}</b><span>custo estimado de demurrage</span></div>
        <div class="ind-k ok"><b>${moeda(d.dem.evitado)}</b><span>custo evitado (devolvido no prazo)</span></div>
      </div>
      ${d.dem.total && d.dem.semDiaria ? `<p class="sp-hint">${d.dem.semDiaria} ${d.dem.semDiaria === 1 ? 'devolução sem diária cadastrada' : 'devoluções sem diária cadastrada'} para o armador: ajuste em Administrador › Custos de demurrage.</p>` : ''}
      ${d.dem.total ? `<p class="sp-hint">Evitado = devoluções no prazo × ${(App.demCfg && App.demCfg().ref) || 3} dias de referência × diária do armador (o que seria pago se cada uma atrasasse esse tanto).</p>` : ''}`;
    box.innerHTML += `
      <h3 class="dia-h">Últimos 6 meses</h3>
      <div class="ind-bars">${d.meses.map((m) => `<div class="ind-bar${m.ym === ym ? ' sel' : ''}" title="${esc(nomeMes(m.ym))}: ${m.n}"><b>${m.n}</b><i style="height:${Math.round(100 * m.n / maxM)}%"></i><span>${esc(curto(m.ym))}</span></div>`).join('')}</div>
      <h3 class="dia-h">Por cliente <small>${d.clientes.length}</small></h3>
      <div class="ind-tbl"><table><thead><tr><th>Cliente</th>${OPS.map((o) => `<th class="n">${esc(o)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
        ${d.clientes.map((c) => `<tr><td>${esc(c.cli)}</td>${OPS.map((o) => `<td class="n">${c[o] || ''}</td>`).join('')}<td class="n"><b>${c.total}</b></td></tr>`).join('') || `<tr><td colspan="6" class="sp-hint">Nenhuma movimentação em ${esc(nomeMes(ym))}.</td></tr>`}
      </tbody></table></div>
      <h3 class="dia-h ${d.dem.fora.length ? 'bad' : ''}">Demurrage fora do prazo <small>${d.dem.fora.length} de ${d.dem.total}</small></h3>
      <div class="dia-list">${d.dem.fora.map((m, i) => `<button class="dia-it" data-f="${i}"><b>${esc(m.cont || '(sem container)')}</b><span>${esc(m.cli)}</span><small><em class="bad">${-m.sobra} ${m.sobra === -1 ? 'dia' : 'dias'} depois do prazo</em> · prazo ${esc(O.fmtData(m.prazo))}${m.diaria ? ' · ≈ ' + esc(moeda(-m.sobra * m.diaria)) : ''}</small></button>`).join('') || '<p class="sp-hint">Nenhuma devolução ou retirada fora do prazo neste mês.</p>'}</div>
      ${d.dem.sobraMedia !== null ? `<p class="sp-hint">Em média, o vazio voltou ${nf(Math.abs(d.dem.sobraMedia), 1)} ${d.dem.sobraMedia >= 0 ? 'dias antes' : 'dias depois'} do fim da demurrage.</p>` : ''}
      ${d.tempo ? '' : '<p class="sp-hint">O tempo do P.S. até o FINALIZADO começa a ser medido a partir de agora (linhas finalizadas depois desta atualização).</p>'}`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const m = d.dem.fora[+b.dataset.f]; const dl = box.closest('dialog'); if (dl) dl.querySelector('.modal-x').click(); O.goTo(m.sh, m.r, 1);
    };
    box._dados = d;
  }

  function csv(d, ym) {
    const q = (v) => { const s = String(v === null || v === undefined ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const L = [[`Indicadores de ${nomeMes(ym)}`], [], ['Cliente', ...OPS, 'Total'], ...d.clientes.map((c) => [c.cli, ...OPS.map((o) => c[o] || 0), c.total]), [],
      ['Demurrage'], ['Custo estimado', d.dem.custo.toFixed(2)], ['Custo evitado', d.dem.evitado.toFixed(2)], [],
      ['Demurrage fora do prazo'], ['Container', 'Cliente', 'Prazo', 'Dias depois do prazo', 'Custo estimado'], ...d.dem.fora.map((m) => [m.cont, m.cli, App.opData.fmtData(m.prazo), -m.sobra, (-m.sobra * (m.diaria || 0)).toFixed(2)])];
    const blob = new Blob(['\uFEFF' + L.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `indicadores-${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function abrir() {
    if (!App.opData || !App.preStacking) return;
    const atual = mesDe(App.opData.hoje());
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="ind-mes">Mês <select class="input">${Array.from({ length: 12 }, (_, i) => voltaMes(atual, i)).map((ym) => `<option value="${ym}">${esc(nomeMes(ym))}</option>`).join('')}</select></label><div class="dia"></div>`;
    const sel = wrap.querySelector('select'), box = wrap.querySelector('.dia');
    sel.onchange = () => render(box, +sel.value);
    render(box, atual);
    App.ui.modal({ title: 'Indicadores do mês', width: '820px', cls: 'modal-tall', body: wrap, buttons: [{ label: 'Exportar CSV', action: () => { csv(box._dados, +sel.value); return false; } }, { label: 'Fechar', primary: true }] });
  }
  App.commands.def('indicadores', 'Indicadores do mês', abrir);
})(window.App);
