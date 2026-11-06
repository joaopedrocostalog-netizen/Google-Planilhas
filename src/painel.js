// Administrador › Métricas da planilha: abas "Agora" (limite e quem está conectado), "Gráficos" (pessoas ao longo do
// dia, sessões, edições por hora e por dia, linhas com informação) e "Teste de pico" (várias conexões editando ao mesmo
// tempo numa cópia temporária da planilha, só na memória do servidor: nada é gravado).
(function () {
  'use strict';
  const App = window.App;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m) => App.emit('notify', m);
  const api = (...a) => App.collab.api(...a);
  const n = (x) => Number(x || 0).toLocaleString('pt-BR');
  const hora = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const ha = (t) => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? 'agora' : 'há ' + dur(Date.now() - new Date(t).getTime()); };

  // ---------- Gráficos em SVG (sem bibliotecas), com detalhe ao passar o mouse ----------
  // cada elemento com data-tip mostra o texto na dica; a dica segue o mouse dentro do painel
  function dica(root) {
    let tip = root.querySelector('.pn-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'pn-tip'; tip.hidden = true; root.appendChild(tip); }
    root.onmousemove = (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el || !root.contains(el)) { tip.hidden = true; return; }
      tip.innerHTML = el.getAttribute('data-tip');
      tip.hidden = false;
      const box = root.getBoundingClientRect();
      let x = e.clientX - box.left + 12, y = e.clientY - box.top + 12;
      if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 12;
      tip.style.left = x + 'px'; tip.style.top = (y + root.scrollTop) + 'px';
    };
    root.onmouseleave = () => { tip.hidden = true; };
  }
  const W = 620, PADL = 34, PADB = 22;
  const escala = (max) => { const m = Math.max(1, max); const p = Math.pow(10, Math.floor(Math.log10(m))); const s = [1, 2, 5, 10].map((k) => k * p).find((k) => k >= m / 4) || m; return { top: Math.ceil(m / s) * s, passo: s }; };
  function eixoY(top, passo, H) {
    let g = '';
    for (let v = 0; v <= top; v += passo) { const y = H - PADB - (v / top) * (H - PADB - 8); g += `<line x1="${PADL}" x2="${W}" y1="${y}" y2="${y}" class="pn-grid"/><text x="${PADL - 6}" y="${y + 4}" class="pn-ax" text-anchor="end">${n(v)}</text>`; }
    return g;
  }
  // barras verticais: itens = [{rotulo, valor, tip}]
  function barras(itens, H, cls) {
    H = H || 170;
    const { top, passo } = escala(Math.max(...itens.map((x) => x.valor), 1));
    const bw = (W - PADL) / itens.length;
    const pulo = itens.length > 12 ? Math.ceil(itens.length / 12) : 1;
    let g = eixoY(top, passo, H);
    itens.forEach((x, i) => {
      const h = (x.valor / top) * (H - PADB - 8), xx = PADL + i * bw;
      g += `<rect x="${xx + bw * 0.15}" y="${H - PADB - h}" width="${bw * 0.7}" height="${Math.max(h, x.valor ? 1 : 0)}" class="${cls || 'pn-bar'}${x.destaque ? ' hl' : ''}"/>`;
      g += `<rect x="${xx}" y="0" width="${bw}" height="${H - PADB}" fill="transparent" data-tip="${esc(x.tip)}"/>`;
      if (i % pulo === 0) g += `<text x="${xx + bw / 2}" y="${H - 6}" class="pn-ax" text-anchor="middle">${esc(x.rotulo)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="pn-svg" role="img">${g}</svg>`;
  }
  // linhas no tempo: series = [{nome, cls, pontos:[{t, v}]}]; degrau = mantém o valor até o próximo ponto
  function linhas(series, t0, t1, H, opts) {
    H = H || 180; opts = opts || {};
    const max = Math.max(1, ...series.flatMap((s) => s.pontos.map((p) => p.v)));
    const { top, passo } = escala(max);
    const X = (t) => PADL + ((t - t0) / Math.max(1, t1 - t0)) * (W - PADL);
    const Y = (v) => H - PADB - (v / top) * (H - PADB - 8);
    let g = eixoY(top, passo, H);
    // marcas de hora no eixo X
    const span = t1 - t0, passoT = span > 6 * 3600e3 ? 3 * 3600e3 : span > 2 * 3600e3 ? 3600e3 : span > 20 * 60e3 ? 15 * 60e3 : span > 120e3 ? 60e3 : 10e3;
    const passoS = span > 60e3 ? 15e3 : span > 25e3 ? 10e3 : 5e3;
    if (opts.seg) for (let t = t0; t <= t1; t += passoS) g += `<text x="${X(t)}" y="${H - 6}" class="pn-ax" text-anchor="middle">${Math.round((t - t0) / 1000)}s</text>`;
    else for (let t = Math.ceil(t0 / passoT) * passoT; t <= t1; t += passoT) g += `<text x="${X(t)}" y="${H - 6}" class="pn-ax" text-anchor="middle">${hora(t)}</text>`;
    for (const s of series) {
      if (!s.pontos.length) continue;
      let d = '';
      s.pontos.forEach((p, i) => {
        if (!i) d += `M${X(p.t)},${Y(p.v)}`;
        else d += opts.degrau ? `H${X(p.t)}V${Y(p.v)}` : `L${X(p.t)},${Y(p.v)}`;
      });
      if (opts.degrau) d += `H${X(t1)}`;
      if (s.area) g += `<path d="${d}V${Y(0)}H${X(s.pontos[0].t)}Z" class="${s.cls} pn-area"/>`;
      g += `<path d="${d}" class="${s.cls} pn-line"/>`;
    }
    // faixas invisíveis para a dica: o valor de cada série naquele momento
    const fx = 40;
    for (let i = 0; i < fx; i++) {
      const ta = t0 + (span * i) / fx, tb = t0 + (span * (i + 1)) / fx, tm = (ta + tb) / 2;
      const val = (s) => { let v = null; for (const p of s.pontos) { if (p.t <= tm) v = p.v; else break; } return v; };
      const tx = series.map((s) => { const v = val(s); return v === null ? '' : `<span class="pn-dot ${s.cls}"></span>${esc(s.nome)}: <b>${opts.fmt ? opts.fmt(v) : n(v)}</b>`; }).filter(Boolean).join('<br>');
      if (tx) g += `<rect x="${X(ta)}" y="0" width="${X(tb) - X(ta)}" height="${H - PADB}" fill="transparent" data-tip="${esc((opts.seg ? Math.round((tm - t0) / 1000) + ' s' : hora(tm)) + '<br>' + tx)}"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="pn-svg" role="img">${g}</svg>`;
  }
  // sessões: uma linha por pessoa, uma barra por sessão (entrada → saída)
  function gantt(sessoes, t0, t1) {
    const pessoas = [...new Map(sessoes.map((s) => [s.uid, s])).values()];
    const RH = 22, H = pessoas.length * RH + PADB + 4, L = 130;
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L);
    let g = '';
    const span = t1 - t0, passoT = span > 6 * 3600e3 ? 3 * 3600e3 : span > 2 * 3600e3 ? 3600e3 : 15 * 60e3;
    for (let t = Math.ceil(t0 / passoT) * passoT; t <= t1; t += passoT) g += `<line x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H - PADB}" class="pn-grid"/><text x="${X(t)}" y="${H - 6}" class="pn-ax" text-anchor="middle">${hora(t)}</text>`;
    pessoas.forEach((p, i) => {
      const y = i * RH + 4;
      g += `<text x="${L - 8}" y="${y + 14}" class="pn-lb" text-anchor="end">${esc(p.name.length > 18 ? p.name.slice(0, 17) + '…' : p.name)}</text>`;
      for (const s of sessoes.filter((x) => x.uid === p.uid)) {
        const fim = s.fim || t1, x1 = X(Math.max(s.ini, t0)), x2 = Math.max(x1 + 3, X(fim));
        g += `<rect x="${x1}" y="${y + 3}" width="${x2 - x1}" height="${RH - 8}" rx="3" class="pn-sess${s.fim ? '' : ' on'}${s.admin ? ' adm' : ''}" data-tip="${esc(`<b>${esc(p.name)}</b><br>Entrou às ${hora(s.ini)}<br>${s.fim ? 'Saiu às ' + hora(s.fim) : 'Ainda conectado'}<br>${dur(fim - s.ini)}`)}"/>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="pn-svg" role="img">${g}</svg>`;
  }

  // ---------- Painel ----------
  async function painel() {
    const cloud = App.cloud;
    if (!App.cloudMode || !cloud.id) return notify('Disponível nas planilhas da nuvem.');
    if (!cloud.realPerms || !cloud.realPerms.admin) return notify('Somente administradores veem as métricas da planilha.');
    const docId = cloud.id;
    let met, pn;
    try { [met, pn] = await Promise.all([api('GET', `/api/docs/${docId}/metricas`), api('GET', `/api/docs/${docId}/painel`)]); } catch (e) { return notify(e.message); }
    let aba = 'agora', timer = null, testeAtivo = null;
    const m = App.ui.modal({
      title: 'Métricas da planilha', width: '720px', cls: 'mt-modal pn-modal', enterSubmits: false,
      body: `<div class="pn-tabs" role="tablist">
          <button class="pn-tab" data-a="agora" role="tab">Agora</button><button class="pn-tab" data-a="graficos" role="tab">Gráficos</button><button class="pn-tab" data-a="teste" role="tab">Teste de pico</button>
        </div><div class="pn-body"></div>`,
      buttons: [{ label: 'Fechar' }],
      onClose: () => { clearInterval(timer); if (testeAtivo) testeAtivo.parar('janela fechada'); },
    });
    const body = m.el.querySelector('.pn-body');
    const foot = m.el.querySelector('.modal-foot');
    const bUp = document.createElement('button'); bUp.className = 'btn'; bUp.textContent = 'Atualizar';
    foot.prepend(bUp);
    dica(m.el.querySelector('.modal-body'));
    const abas = m.el.querySelectorAll('.pn-tab');
    function ir(a) {
      aba = a;
      abas.forEach((b) => { b.classList.toggle('on', b.dataset.a === a); b.setAttribute('aria-selected', b.dataset.a === a); });
      bUp.hidden = a === 'teste';
      draw();
    }
    abas.forEach((b) => (b.onclick = () => { if (testeAtivo && b.dataset.a !== 'teste') return notify('Aguarde o teste de pico terminar.'); ir(b.dataset.a); }));
    const dl = (rows) => `<dl class="mt-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const top3 = (t) => (t && t.length ? t.slice(0, 3).map((x) => `<span class="mt-nm">${esc(x.name)} (${n(x.n)})</span>`).join('') : '—');

    function drawAgora() {
      const A = met.agora, H = met.hoje, S = met.semana, P = met.planilha, max = met.limite.max, oc = A.naoAdmins;
      const cheio = max && oc >= max;
      const seg = !max ? '' : max <= 40
        ? `<div class="mt-segs" style="--n:${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < oc ? 'on' : ''}"></i>`).join('')}</div>`
        : `<div class="mt-bar"><i style="width:${Math.min(100, (oc / max) * 100)}%"></i></div>`;
      const vistos = new Map(); for (const x of H.ultimosBloqueados || []) if (!vistos.has(x.email)) vistos.set(x.email, x);
      const esperas = [...vistos.values()].slice(0, 3).map((x) => `<small>${esc(x.name)}, última às ${hora(x.at)}</small>`).join('');
      const quem = A.lista.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.admin ? ' <span class="mt-tag">admin</span>' : ''}<small>${esc(x.setor || x.email)}</small></td><td>${esc(x.pagina || '—')}</td><td class="num">${x.abas}</td><td>${ha(x.desde)}</td></tr>`).join('');
      body.innerHTML = `
        <section class="mt-sec mt-lim">
          <h3>Limite de pessoas ao mesmo tempo</h3>
          <div class="mt-seats${cheio ? ' full' : ''}${max ? '' : ' free'}"><div class="mt-seats-num"><b>${n(oc)}</b> ${max ? `de ${n(max)} ${max === 1 ? 'vaga ocupada' : 'vagas ocupadas'}` : oc === 1 ? 'pessoa conectada' : 'pessoas conectadas'}</div>${seg}
          <p class="sp-hint">${!max ? 'Sem limite: qualquer pessoa com acesso entra.' : cheio ? 'Limite atingido: quem tentar entrar agora vê um aviso para tentar de novo mais tarde.' : `${n(max - oc)} ${max - oc === 1 ? 'vaga livre' : 'vagas livres'}.`}</p></div>
          <div class="mt-set"><label for="mt-max">Limite</label><input class="input" id="mt-max" type="number" min="0" max="1000" step="1" value="${max || 0}"><button class="btn btn-primary" id="mt-save">Salvar limite</button></div>
          <p class="sp-hint">0 = sem limite. Administradores não ocupam vaga e sempre entram. A mesma pessoa em várias abas conta uma vez. Baixar o limite não desconecta ninguém: só quem chegar depois espera vaga.</p>
        </section>
        <section class="mt-sec"><h3>Conectados agora <span>${n(A.pessoas)} ${A.pessoas === 1 ? 'pessoa' : 'pessoas'}, ${n(A.abas)} ${A.abas === 1 ? 'aba' : 'abas'}</span></h3>
          <div class="mt-table-wrap"><table class="mt-table"><thead><tr><th>Pessoa</th><th>Página</th><th class="num">Abas</th><th>Entrou</th></tr></thead><tbody>${quem || '<tr><td colspan="4" class="sp-hint">Ninguém conectado.</td></tr>'}</tbody></table></div></section>
        <div class="mt-cols">
          <section class="mt-sec"><h3>Hoje</h3>${dl([
            ['Pico ao mesmo tempo', H.pico ? `${n(H.pico)} às ${hora(H.picoEm)}` : '—'], ['Pessoas que entraram', n(H.acessos)],
            ['Esperaram vaga', H.bloqueados ? `${n(H.bloqueados)} ${H.bloqueados === 1 ? 'tentativa' : 'tentativas'}${esperas}` : '0'],
            ['Células editadas', met.erroEdicoes ? esc(met.erroEdicoes) : `${n(H.edicoes)} por ${n(H.editores)} ${H.editores === 1 ? 'pessoa' : 'pessoas'}`], ['Quem mais editou', top3(H.top)]])}</section>
          <section class="mt-sec"><h3>Planilha</h3>${dl([
            ['Células preenchidas', n(P.celulas)], ['Linhas com informação', n(pn.linhas.reduce((t, x) => t + x.linhas, 0))],
            ['Tamanho', P.tamanhoKB >= 1024 ? `${(P.tamanhoKB / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${n(P.tamanhoKB)} KB`],
            ['Pessoas com acesso', `${n(P.membros)}${P.setores ? ` em ${n(P.setores)} ${P.setores === 1 ? 'setor' : 'setores'}` : ''}`],
            ['Células editadas em 7 dias', met.erroEdicoes ? '—' : n(S.edicoes)], ['Servidor', `ligado há ${dur(met.servidor.ligadoHaMin * 60000)}, ${n(met.servidor.memoriaMB)} MB`]])}</section>
        </div>`;
      const inp = body.querySelector('#mt-max');
      const salvar = async () => {
        const v = Math.floor(Number(inp.value));
        if (!Number.isFinite(v) || v < 0 || v > 1000) { notify('Use um número de 0 (sem limite) a 1000.'); inp.focus(); return; }
        try { await api('PUT', `/api/docs/${docId}/limite`, { max: v }); notify(v ? `Limite salvo: ${v} ${v === 1 ? 'pessoa' : 'pessoas'} ao mesmo tempo.` : 'Limite removido: sem limite de pessoas.'); inp.blur(); await recarregar(true); } catch (e) { notify(e.message); }
      };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); salvar(); } };
      body.querySelector('#mt-save').onclick = salvar;
    }

    function drawGraficos() {
      const t1 = pn.agora, t0 = Math.min(new Date(pn.dia + 'T06:00:00-03:00').getTime(), (pn.amostras[0] || {}).t || t1, ...pn.sessoes.map((s) => s.ini));
      const am = pn.amostras;
      const ses = pn.sessoes, pessoasDif = new Set(ses.map((s) => s.uid)).size;
      const fechadas = ses.filter((s) => s.fim), media = fechadas.length ? fechadas.reduce((t, s) => t + (s.fim - s.ini), 0) / fechadas.length : 0;
      const hAgora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })) % 24;
      const desde = new Date(pn.desde);
      const parcial = new Date(pn.dia + 'T00:00:00-03:00').getTime() < pn.desde - 60e3;
      body.innerHTML = `
        <section class="mt-sec"><h3>Pessoas conectadas hoje</h3>
          <div class="pn-leg"><span><i class="pn-dot s1"></i>Pessoas</span><span><i class="pn-dot s2"></i>Sem contar administradores</span>${met.limite.max ? `<span><i class="pn-dot s3"></i>Limite (${n(met.limite.max)})</span>` : ''}</div>
          ${am.length > 1 ? linhas([
            { nome: 'Pessoas', cls: 's1', area: true, pontos: am.map((a) => ({ t: a.t, v: a.p })) },
            { nome: 'Sem administradores', cls: 's2', pontos: am.map((a) => ({ t: a.t, v: a.n })) },
            ...(met.limite.max ? [{ nome: 'Limite', cls: 's3', pontos: [{ t: t0, v: met.limite.max }, { t: t1, v: met.limite.max }] }] : []),
          ], t0, t1, 190, { degrau: true }) : '<p class="sp-hint pn-vazio">O gráfico começa a aparecer conforme as pessoas entram e saem da planilha.</p>'}
        </section>
        <section class="mt-sec"><h3>Sessões de hoje <span>${n(ses.length)} ${ses.length === 1 ? 'sessão' : 'sessões'} de ${n(pessoasDif)} ${pessoasDif === 1 ? 'pessoa' : 'pessoas'}${fechadas.length ? `, ${dur(media)} em média` : ''}</span></h3>
          <p class="sp-hint">Cada barra vai da entrada à saída da pessoa (a barra mais escura ainda está conectada). Passe o mouse para ver os horários.</p>
          ${ses.length ? `<div class="pn-scroll">${gantt(ses, t0, t1)}</div>` : '<p class="sp-hint pn-vazio">Nenhuma sessão registrada hoje ainda.</p>'}
        </section>
          <section class="mt-sec"><h3>Células editadas por hora</h3>
            ${barras(pn.edHora.map((v, h) => ({ rotulo: h + 'h', valor: v, destaque: h === hAgora, tip: `<b>${h}h às ${h + 1}h</b><br>${n(v)} ${v === 1 ? 'célula editada' : 'células editadas'}` })), 160)}
            ${parcial ? `<p class="sp-hint">Contando desde ${hora(desde)} de hoje.</p>` : ''}
          </section>
          <section class="mt-sec"><h3>Células editadas por dia</h3>
            ${pn.erro ? `<p class="sp-hint">${esc(pn.erro)}</p>` : barras(pn.porDia.map((x, i) => { const d = new Date(x.dia + 'T12:00:00-03:00'); const r = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }).replace('.', ''); return { rotulo: r, valor: x.edicoes, destaque: i === pn.porDia.length - 1, tip: `<b>${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b><br>${n(x.edicoes)} células editadas` }; }), 160)}
          </section>
        <section class="mt-sec"><h3>Linhas com informação por página <span>${n(pn.linhas.reduce((t, x) => t + x.linhas, 0))} no total</span></h3>
          <p class="sp-hint">Linhas com pelo menos uma célula preenchida (o cabeçalho conta como linha).</p>
          <div class="pn-hbars">${(() => { const mx = Math.max(1, ...pn.linhas.map((x) => x.linhas)); return pn.linhas.slice().sort((a, b) => b.linhas - a.linhas).map((x) => `<div class="pn-hb" data-tip="${esc(`<b>${esc(x.name)}</b><br>${n(x.linhas)} ${x.linhas === 1 ? 'linha' : 'linhas'} com informação`)}"><span class="pn-hb-n">${esc(x.name)}${x.hidden ? ' <small>(oculta)</small>' : ''}</span><span class="pn-hb-b"><i style="width:${(x.linhas / mx) * 100}%"></i></span><span class="pn-hb-v">${n(x.linhas)}</span></div>`).join(''); })()}</div>
        </section>
        <p class="sp-hint mt-upd">Atualizado às ${new Date().toLocaleTimeString('pt-BR')}. A tela se atualiza sozinha a cada 15 segundos.</p>`;
    }

    // ---------- Teste de pico ----------
    let ultimoResultado = null, ultimaCfg = { pessoas: 30, segundos: 30, ritmo: 20 };
    function drawTeste() {
      if (testeAtivo) return testeAtivo.draw();
      body.innerHTML = `
        <section class="mt-sec pn-teste">
          <h3>Testar pico de usuários</h3>
          <p class="sp-hint">Simula várias pessoas editando ao mesmo tempo para ver se o servidor aguenta. O teste usa uma <b>cópia temporária</b> desta planilha, criada só na memória do servidor: a planilha real, o banco de dados, o histórico e as métricas não são tocados, e a cópia some ao terminar.</p>
          <div class="pn-form">
            <label>Pessoas simuladas<input class="input" id="pn-n" type="number" min="1" max="60" value="${ultimaCfg.pessoas}"></label>
            <label>Duração (segundos)<input class="input" id="pn-s" type="number" min="10" max="120" value="${ultimaCfg.segundos}"></label>
            <label>Edições por pessoa por minuto<input class="input" id="pn-r" type="number" min="1" max="60" value="${ultimaCfg.ritmo}"></label>
          </div>
          <p class="sp-hint">Durante o teste, quem estiver usando a planilha pode sentir o servidor um pouco mais lento. Prefira fazer fora do horário de pico. As conexões saem deste computador, então a internet daqui também entra na medida.</p>
          <div class="pn-acts"><button class="btn btn-primary" id="pn-go">Iniciar teste</button></div>
        </section>
        ${ultimoResultado ? ultimoResultado : ''}`;
      body.querySelectorAll('.pn-form input').forEach((i) => (i.onkeydown = (e) => e.stopPropagation()));
      body.querySelector('#pn-go').onclick = () => {
        const v = (id, a, b, d) => Math.min(b, Math.max(a, Math.floor(Number(body.querySelector(id).value) || d)));
        ultimaCfg = { pessoas: v('#pn-n', 1, 60, 30), segundos: v('#pn-s', 10, 120, 30), ritmo: v('#pn-r', 1, 60, 20) };
        iniciarTeste(ultimaCfg);
      };
    }

    async function iniciarTeste(cfg) {
      let r;
      try { r = await api('POST', `/api/docs/${docId}/teste-carga`, cfg); } catch (e) { return notify(e.message); }
      const url = String(window.PLANILHAS_API || location.origin).replace(/^http/, 'ws') + '/ws';
      const token = App.cloud.token;
      const T = { cfg: r, t0: Date.now(), fimEnvio: 0, vus: [], enviados: 0, acks: 0, recebidos: 0, erros: 0, quedas: 0, falhas: 0, lat: [], pontos: [], srv: [], parado: false, fase: 'Conectando…' };
      testeAtivo = T;
      const cols = 'ABCDEFGHIJKL';
      function vu(i) {
        const v = { i, ws: null, pronto: false, seq: 0, pend: new Map(), timer: null };
        let ws;
        try { ws = new WebSocket(url); } catch (e) { T.falhas++; return v; }
        v.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, doc: r.sala }));
        ws.onmessage = (e) => {
          let msg; try { msg = JSON.parse(e.data); } catch (x) { return; }
          if (msg.type === 'init') { v.pronto = true; agenda(v); }
          else if (msg.type === 'ack') { const t = v.pend.get(msg.id); if (t) { v.pend.delete(msg.id); T.acks++; T.lat.push({ t: Date.now(), ms: Date.now() - t }); } }
          else if (msg.type === 'patch') T.recebidos++;
          else if (msg.type === 'reject') T.erros++;
          else if (msg.type === 'error' && msg.code !== 'teste') T.erros++;
        };
        ws.onclose = () => { if (!T.parado && v.pronto) T.quedas++; if (!v.pronto && !T.parado) T.falhas++; v.pronto = false; clearTimeout(v.timer); };
        return v;
      }
      function agenda(v) {
        const base = 60000 / r.ritmo;
        v.timer = setTimeout(() => {
          if (T.parado || !v.pronto || Date.now() > T.fimEnvio) return;
          const id = ++v.seq, cel = cols[Math.floor(Math.random() * r.colunas)] + (2 + Math.floor(Math.random() * (r.linhas - 1)));
          v.pend.set(id, Date.now());
          try { v.ws.send(JSON.stringify({ type: 'patch', id, patch: { sheets: { [r.pagina]: { cells: { [cel]: { v: `teste ${v.i + 1}.${id}` } } } } } })); T.enviados++; } catch (e) { T.erros++; }
          agenda(v);
        }, base * (0.5 + Math.random()));
      }
      // conexões abrem aos poucos (em ~2 s), como pessoas chegando
      for (let i = 0; i < r.pessoas; i++) setTimeout(() => { if (!T.parado) T.vus.push(vu(i)); }, (i * 2000) / r.pessoas);
      T.fimEnvio = Date.now() + 2500 + r.segundos * 1000;
      let ultimo = { t: Date.now(), env: 0, rec: 0 };
      const tick = setInterval(async () => {
        const t = Date.now(), win = T.lat.filter((x) => x.t > t - 1000).map((x) => x.ms).sort((a, b) => a - b);
        const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : null);
        T.pontos.push({ t, p50: pct(win, 0.5), p95: pct(win, 0.95), env: (T.enviados - ultimo.env) / ((t - ultimo.t) / 1000), rec: (T.recebidos - ultimo.rec) / ((t - ultimo.t) / 1000), con: T.vus.filter((v) => v.pronto).length });
        ultimo = { t, env: T.enviados, rec: T.recebidos };
        if (T.pontos.length % 2 === 0) { try { const s = await api('GET', `/api/docs/${docId}/teste-carga`); T.srv.push(s); } catch (e) { /* sem resposta: conta na falta de dados */ } }
        T.fase = t < T.fimEnvio ? `Editando… faltam ${Math.max(0, Math.ceil((T.fimEnvio - t) / 1000))} s` : 'Finalizando…';
        if (aba === 'teste' && testeAtivo === T) T.draw();
        if (t > T.fimEnvio + 3000) T.parar('fim');
      }, 1000);
      T.parar = async (motivo) => {
        if (T.parado) return;
        T.parado = true; clearInterval(tick);
        for (const v of T.vus) { clearTimeout(v.timer); try { v.ws && v.ws.close(); } catch (e) { /* já fechou */ } }
        try { await api('DELETE', `/api/docs/${docId}/teste-carga`); } catch (e) { /* o servidor encerra sozinho */ }
        testeAtivo = null;
        if (motivo !== 'janela fechada') { ultimoResultado = resultado(T, motivo); if (aba === 'teste') drawTeste(); }
      };
      T.draw = () => {
        const lat = T.lat.map((x) => x.ms).sort((a, b) => a - b);
        const p95 = lat.length ? lat[Math.floor(0.95 * (lat.length - 1))] : 0;
        const s = T.srv[T.srv.length - 1] || {};
        body.innerHTML = `<section class="mt-sec pn-teste">
          <h3>Teste de pico em andamento <span>${esc(T.fase)}</span></h3>
          <div class="pn-kpis">
            <div><b>${n(T.vus.filter((v) => v.pronto).length)}</b><small>de ${n(r.pessoas)} conectadas</small></div>
            <div><b>${n(T.enviados)}</b><small>edições enviadas</small></div>
            <div><b>${lat.length ? n(p95) + ' ms' : '—'}</b><small>tempo de resposta (95%)</small></div>
            <div><b>${s.cpu !== undefined ? n(s.cpu) + '%' : '—'}</b><small>uso do servidor</small></div>
          </div>
          ${grafTeste(T)}
          <div class="pn-acts"><button class="btn" id="pn-stop">Parar teste</button></div></section>`;
        body.querySelector('#pn-stop').onclick = () => T.parar('parado pelo administrador');
      };
      ir('teste');
    }
    function grafTeste(T) {
      if (T.pontos.length < 2) return '<p class="sp-hint pn-vazio">Os gráficos aparecem em alguns segundos…</p>';
      const t0 = T.t0, t1 = Math.max(T.pontos[T.pontos.length - 1].t, t0 + 10000);
      const pts = (k) => T.pontos.filter((p) => p[k] !== null).map((p) => ({ t: p.t, v: Math.round(p[k]) }));
      return `<div class="pn-leg"><span><i class="pn-dot s1"></i>Tempo de resposta típico (ms)</span><span><i class="pn-dot s3"></i>Nos 5% piores momentos (ms)</span></div>
        ${linhas([{ nome: 'Típico', cls: 's1', area: true, pontos: pts('p50') }, { nome: '5% piores', cls: 's3', pontos: pts('p95') }], t0, t1, 170, { seg: true, fmt: (v) => n(v) + ' ms' })}
        <div class="pn-leg"><span><i class="pn-dot s2"></i>Edições enviadas por segundo</span><span><i class="pn-dot s4"></i>Atualizações recebidas por segundo (repassadas às outras pessoas)</span></div>
        ${linhas([{ nome: 'Enviadas/s', cls: 's2', pontos: pts('env') }, { nome: 'Recebidas/s', cls: 's4', area: true, pontos: pts('rec') }], t0, t1, 150, { seg: true })}
        ${T.srv.length > 1 ? `<div class="pn-leg"><span><i class="pn-dot s1"></i>Uso do servidor (%)</span><span><i class="pn-dot s3"></i>Atraso interno do servidor (ms)</span></div>
        ${linhas([{ nome: 'Uso', cls: 's1', area: true, pontos: T.srv.map((s) => ({ t: s.t, v: s.cpu })) }, { nome: 'Atraso', cls: 's3', pontos: T.srv.map((s) => ({ t: s.t, v: s.lagMs })) }], t0, t1, 140, { seg: true })}` : ''}`;
    }
    function resultado(T, motivo) {
      const lat = T.lat.map((x) => x.ms).sort((a, b) => a - b);
      const q = (k) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(k * lat.length))] : null);
      const p50 = q(0.5), p95 = q(0.95), max = lat.length ? lat[lat.length - 1] : null;
      const perdidas = Math.max(0, T.enviados - T.acks), conectou = T.vus.filter((v) => v.seq > 0 || v.pronto).length;
      const cpuMax = Math.max(0, ...T.srv.map((s) => s.cpu || 0)), lagMax = Math.max(0, ...T.srv.map((s) => s.lagMs || 0)), memMax = Math.max(0, ...T.srv.map((s) => s.memoriaMB || 0));
      let nivel = 'ok', titulo = 'Aguentou bem';
      let texto = `Com ${n(T.cfg.pessoas)} pessoas editando ao mesmo tempo, cada edição levou em geral ${n(p50)} ms para ser confirmada pelo servidor.`;
      if (!lat.length || T.falhas > T.cfg.pessoas / 2) { nivel = 'ruim'; titulo = 'Não aguentou'; texto = 'A maioria das conexões não conseguiu entrar ou editar. O servidor pode estar acordando (plano gratuito) ou sobrecarregado: tente de novo em alguns minutos.'; }
      else if (p95 > 1500 || T.quedas > 0 || perdidas > T.enviados * 0.05) { nivel = 'ruim'; titulo = 'Ficou no limite'; texto += ` Nos piores momentos passou de ${n(p95)} ms${T.quedas ? ` e ${n(T.quedas)} ${T.quedas === 1 ? 'conexão caiu' : 'conexões caíram'}` : ''}: as pessoas sentiriam a planilha travando.`; }
      else if (p95 > 500) { nivel = 'medio'; titulo = 'Aguentou, com lentidão'; texto += ` Nos piores momentos chegou a ${n(p95)} ms: dá para usar, mas as pessoas notariam alguma demora.`; }
      return `<section class="mt-sec pn-res ${nivel}">
        <h3>${titulo}</h3><p>${texto}</p>
        ${grafTeste(T)}
        ${dl([['Pessoas simuladas', `${n(T.cfg.pessoas)} (${n(conectou)} conectaram${T.falhas ? `, ${n(T.falhas)} não conseguiram` : ''})`],
          ['Edições enviadas', `${n(T.enviados)} em ${n(T.cfg.segundos)} s (${n(T.cfg.ritmo)} por pessoa por minuto)`],
          ['Atualizações repassadas', n(T.recebidos)],
          ['Tempo de resposta', lat.length ? `típico ${n(p50)} ms, 95% abaixo de ${n(p95)} ms, máximo ${n(max)} ms` : '—'],
          ['Sem confirmação', `${n(perdidas)}${T.erros ? `, ${n(T.erros)} ${T.erros === 1 ? 'erro' : 'erros'}` : ''}${T.quedas ? `, ${n(T.quedas)} ${T.quedas === 1 ? 'queda' : 'quedas'}` : ''}`],
          ['Servidor no pico', T.srv.length ? `uso ${n(cpuMax)}%, atraso interno ${n(lagMax)} ms, memória ${n(memMax)} MB` : '—'],
          ['Encerrado', motivo === 'fim' ? 'no tempo previsto' : motivo]])}
        <p class="sp-hint pn-fim">A cópia usada no teste já foi apagada da memória do servidor. Nada foi gravado na planilha.</p></section>`;
    }

    function draw() {
      if (aba === 'agora') drawAgora();
      else if (aba === 'graficos') drawGraficos();
      else drawTeste();
    }
    async function recarregar(forcar) {
      if (!document.body.contains(m.el) || App.cloud.id !== docId) { clearInterval(timer); return; }
      if (aba === 'teste' || (!forcar && document.activeElement && document.activeElement.id === 'mt-max')) return;
      try { [met, pn] = await Promise.all([api('GET', `/api/docs/${docId}/metricas`), api('GET', `/api/docs/${docId}/painel`)]); draw(); } catch (e) { /* tenta na próxima */ }
    }
    bUp.onclick = () => { if (document.activeElement) document.activeElement.blur(); recarregar(true); };
    ir('agora');
    timer = setInterval(recarregar, 15000);
  }
  App.commands.def('adminMetricas', 'Métricas da planilha, gráficos e teste de pico', painel);

  // ---------- Histórico de alterações da planilha inteira (administradores) ----------
  // Cada célula alterada, por quem e quando, com o antes e o depois; filtros por pessoa, página, período e texto.
  // Clicar numa linha leva até a célula.
  async function alteracoes() {
    const cloud = App.cloud;
    if (!App.cloudMode || !cloud.id) return notify('Disponível nas planilhas da nuvem.');
    if (!cloud.realPerms || !cloud.realPerms.admin) return notify('Somente administradores veem o histórico de alterações da planilha.');
    const docId = cloud.id, E = window.GridEngine;
    const f = { quem: '', pagina: '', periodo: '7d', texto: '' };
    let linhas = [], mais = false, pessoas = [], carregando = false;
    const m = App.ui.modal({
      title: 'Histórico de alterações', width: '920px', cls: 'mt-modal hz-modal', enterSubmits: false,
      body: `<div class="hz-filtros">
          <label>Pessoa<select class="input" id="hz-quem"><option value="">Todas</option></select></label>
          <label>Página<select class="input" id="hz-pag"><option value="">Todas</option>${App.doc.sheets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
          <label>Período<select class="input" id="hz-per"><option value="hoje">Hoje</option><option value="7d" selected>Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="tudo">Tudo</option></select></label>
          <label class="hz-busca">Procurar<input class="input" id="hz-txt" placeholder="Texto ou célula (ex.: D45)"></label>
        </div><div class="hz-res"></div>`,
      buttons: [{ label: 'Fechar' }],
    });
    const el = (q) => m.el.querySelector(q), res = el('.hz-res');
    const dataHora = (t) => { const d = new Date(t); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
    const valor = (v) => (v === null || v === undefined || v === '' ? '<i class="hz-vazio">vazio</i>' : esc(v));
    const onde = (x) => {
      const sh = App.doc.sheets.find((s) => s.id === x.pagina);
      if (!sh) return `<span class="hz-pag">Página excluída</span> ${esc(x.addr)}`;
      let col = '';
      try { const a = E.parseAddr(x.addr); const h = App.raw(sh, 1, a.col); if (h !== undefined && h !== null && String(h).trim() && String(h)[0] !== '=') col = String(h).trim(); } catch (e) { /* sem cabeçalho */ }
      return `<span class="hz-pag">${esc(sh.name)}</span>${col ? ` · ${esc(col)}` : ''} <span class="hz-addr">${esc(x.addr)}</span>`;
    };
    function draw() {
      if (!linhas.length) { res.innerHTML = `<p class="sp-hint pn-vazio">${carregando ? 'Carregando…' : 'Nenhuma alteração encontrada com esses filtros.'}</p>`; return; }
      res.innerHTML = `<div class="mt-table-wrap"><table class="mt-table hz-table"><thead><tr><th>Quando</th><th>Quem</th><th>Onde</th><th>Antes → Depois</th></tr></thead><tbody>${linhas.map((x, i) => `<tr data-i="${i}" title="Ir até a célula">
          <td class="hz-when">${dataHora(x.at)}</td><td>${esc(x.quem.name || '—')}</td><td>${onde(x)}</td>
          <td class="hz-vals"><span class="hz-antes${x.antes === null || x.antes === undefined || x.antes === '' ? ' sem' : ''}">${valor(x.antes)}</span><span class="hz-seta">→</span><span class="hz-depois">${valor(x.depois)}</span></td></tr>`).join('')}</tbody></table></div>
        <div class="hz-pe"><span class="sp-hint">${n(linhas.length)} ${linhas.length === 1 ? 'alteração' : 'alterações'}${mais ? ' (há mais)' : ''}</span>${mais ? '<button class="btn" id="hz-mais">Carregar mais</button>' : ''}</div>`;
      res.querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => ir(linhas[+tr.dataset.i])));
      const bm = res.querySelector('#hz-mais'); if (bm) bm.onclick = () => carregar(true);
    }
    function ir(x) {
      const si = App.doc.sheets.findIndex((s) => s.id === x.pagina);
      if (si < 0) return notify('Essa página não existe mais.');
      let a; try { a = E.parseAddr(x.addr); } catch (e) { return; }
      m.close ? m.close() : m.el.close();
      if (App.doc.active !== si) { App.doc.active = si; App.emit('sheet'); }
      App.grid.select(a.row, a.col);
    }
    let pedido = 0;
    async function carregar(maisLinhas) {
      const meu = ++pedido;
      carregando = true; if (!maisLinhas) { linhas = []; draw(); }
      const qs = new URLSearchParams({ periodo: f.periodo });
      if (f.quem) qs.set('quem', f.quem); if (f.pagina) qs.set('pagina', f.pagina); if (f.texto) qs.set('texto', f.texto);
      if (maisLinhas && linhas.length) qs.set('antesDe', linhas[linhas.length - 1].id);
      let r;
      try { r = await api('GET', `/api/docs/${docId}/alteracoes?${qs}`); } catch (e) { carregando = false; if (meu === pedido) { res.innerHTML = `<p class="sp-hint pn-vazio">${esc(e.message)}</p>`; } return; }
      if (meu !== pedido) return; // chegou depois de outro filtro: descarta
      carregando = false;
      linhas = maisLinhas ? linhas.concat(r.linhas) : r.linhas; mais = r.mais;
      if (r.pessoas && !pessoas.length) {
        pessoas = r.pessoas;
        el('#hz-quem').innerHTML = '<option value="">Todas</option>' + pessoas.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${n(p.n)})</option>`).join('');
        el('#hz-quem').value = f.quem;
      }
      draw();
    }
    el('#hz-quem').onchange = (e) => { f.quem = e.target.value; carregar(); };
    el('#hz-pag').onchange = (e) => { f.pagina = e.target.value; carregar(); };
    el('#hz-per').onchange = (e) => { f.periodo = e.target.value; carregar(); };
    let tt = null;
    el('#hz-txt').onkeydown = (e) => e.stopPropagation();
    el('#hz-txt').oninput = (e) => { clearTimeout(tt); tt = setTimeout(() => { f.texto = e.target.value.trim(); carregar(); }, 350); };
    carregar();
  }
  App.commands.def('adminAlteracoes', 'Histórico de alterações da planilha', alteracoes);
})();
