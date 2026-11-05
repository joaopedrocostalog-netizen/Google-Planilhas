// Imprimir documentos a partir da linha (botão direito › Imprimir): minuta de devolução, minuta Glovis, ordem de coleta,
// liberação de vazio e a ficha completa. Uma página por linha selecionada; abre a janela de impressão (dá para salvar em PDF).
(function (App) {
  'use strict';
  const E = App.E, esc = App.esc, doc = App.doc;
  const notify = (m) => App.emit('notify', m);
  const norm = (s) => (window.Perms && window.Perms.normName ? window.Perms.normName(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const EMPRESA = 'COSTALOG — CRC DA COSTA TRANSPORTES LTDA';

  // linhas reais da seleção (inclui Ctrl+clique e a visualização com filtro)
  function selRows() {
    const rows = new Set();
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) {
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 300); r++) { const p = App.realCell ? App.realCell(r, R.c1) : { r }; if (p) rows.add(p.r); }
    }
    return [...rows].sort((a, b) => a - b);
  }
  // nomes das colunas da página (nome dado pelo administrador ou texto da linha 1)
  function colMap(sh) {
    const names = sh.colNames || {};
    const maxC = Math.max(App.usedRange(sh).maxC || 0, ...Object.keys(names).map(Number), 1);
    const map = new Map(), list = [];
    for (let c = 1; c <= maxC; c++) {
      const label = String(names[c] || App.raw(sh, 1, c) || '').trim();
      if (!label) continue;
      list.push({ c, label });
      if (!map.has(norm(label))) map.set(norm(label), c);
    }
    return { map, list, first: Object.keys(names).length ? 1 : 2 };
  }
  // valor da coluna (o primeiro nome que existir), como aparece na célula
  function getter(sh, si, cm, r) {
    return (...names) => {
      for (const n of names) {
        const c = cm.map.get(norm(n));
        if (!c) continue;
        const v = App.value(si, r, c);
        if (v === null || v === undefined || (E.isErr && E.isErr(v))) continue;
        const t = String(App.fmtValue(v, App.style(sh, r, c).nf)).trim();
        if (t && !/^(FALSE|FALSO)$/i.test(t)) return /^(TRUE|VERDADEIRO)$/i.test(t) ? 'SIM' : t;
      }
      return '';
    };
  }

  const hoje = () => new Date().toLocaleDateString('pt-BR');
  const box = (label, value, span) => `<div class="f${span ? ' s' + span : ''}"><i>${esc(label)}</i><b>${esc(value || '')}&nbsp;</b></div>`;
  const sec = (title, fields) => `<section><h3>${esc(title)}</h3><div class="g">${fields.join('')}</div></section>`;
  const signs = (list) => `<div class="signs">${list.map((x) => `<div><span></span><small>${esc(x)}</small></div>`).join('')}</div>`;
  const veiculo = (g) => sec('Transportadora e veículo', [
    box('Transportadora', 'CRC DA COSTA TRANSPORTES LTDA (COSTALOG)', 2), box('Motorista', g('MOTORISTA'), 2),
    box('CPF', g('CPF')), box('Contato', g('CONTATO')), box('Cavalo (placa)', g('CAVALO')), box('Carreta (placa)', g('CARRETA')),
  ]);
  const head = (title, g, sub) => `<header><div><strong>${esc(sub || EMPRESA)}</strong><h1>${esc(title)}</h1></div>
    <div class="ref"><span>Referência</span><b>${esc(g('REFERENCIA', 'REF') || '—')}</b><span>Emitido em ${esc(hoje())}</span></div></header>`;
  const obs = (g) => `<section><h3>Observações</h3><div class="obs">${esc(g('OBSERVAÇÃO', 'OBSERVACOES', 'OBS'))}&nbsp;</div></section>`;
  const vistoria = () => `<section><h3>Vistoria do container</h3><div class="chk">${['Sem avarias', 'Com avarias (descrever)', 'Limpo', 'Sujo / com resíduos', 'Lacre retirado'].map((x) => `<span>☐ ${esc(x)}</span>`).join('')}</div></section>`;

  const DOCS = [
    {
      id: 'minuta', label: 'Minuta de devolução', file: 'Minuta de devolução',
      html: (g) => head('MINUTA DE DEVOLUÇÃO DE CONTAINER VAZIO', g) +
        sec('Container', [box('Container', g('CONTAINER', '1 - CONTAINER'), 2), box('Tipo', g('TIPO', '1 - TIPO')), box('Armador', g('ARMADOR', '1 - ARMADOR')),
          box('BL', g('BL')), box('Navio', g('NAVIO')), box('Viagem', g('VIAGEM')), box('Peso', g('PESO'))]) +
        sec('Devolução', [box('Terminal de devolução (depot)', g('TERMINAL VAZIO'), 2), box('Data / hora da devolução', g('DATA / HORA - DEPOT', 'DATA ENTREGA VAZIO'), 2),
          box('Cliente', g('CLIENTE'), 2), box('Entrega (cidade)', g('ENTREGA - 1', 'ENTREGA'), 2)]) +
        veiculo(g) + vistoria() + obs(g) + signs(['Motorista', 'Terminal / depot (carimbo)', 'Transportadora']),
    },
    {
      id: 'minutaGlovis', label: 'Minuta de devolução (Glovis)', file: 'Minuta de devolução Glovis',
      html: (g) => head('MINUTA DE DEVOLUÇÃO DE VAZIO — GLOVIS', g, EMPRESA + ' · Cliente GLOVIS') +
        sec('Processo Glovis', [box('Cliente', g('CLIENTE'), 2), box('Referência', g('REFERENCIA')), box('PROC.', g('PROC.', 'PROC')),
          box('DI / DTA', g('DI / DTA', 'DI', 'DTA')), box('Modalidade', g('MODALIDADE')), box('BL', g('BL')), box('Navio / viagem', [g('NAVIO'), g('VIAGEM')].filter(Boolean).join(' / '))]) +
        sec('Container', [box('Container', g('CONTAINER', '1 - CONTAINER'), 2), box('Tipo', g('TIPO', '1 - TIPO')), box('Armador', g('ARMADOR', '1 - ARMADOR')),
          box('Entregue em', g('ENTREGA - 1', 'ENTREGA'), 2), box('Saída do cliente', g('SAÍDA DO CLIENTE'), 2)]) +
        sec('Devolução', [box('Terminal de devolução (depot)', g('TERMINAL VAZIO'), 2), box('Data / hora da devolução', g('DATA / HORA - DEPOT', 'DATA ENTREGA VAZIO'), 2)]) +
        veiculo(g) + vistoria() + obs(g) + signs(['Motorista', 'Terminal / depot (carimbo)', 'Glovis / transportadora']),
    },
    {
      id: 'coleta', label: 'Ordem de coleta', file: 'Ordem de coleta',
      html: (g) => head('ORDEM DE COLETA', g) +
        sec('Carga', [box('Cliente', g('CLIENTE'), 2), box('Modalidade', g('MODALIDADE')), box('DI / DTA', g('DI / DTA', 'DI', 'DTA')),
          box('Container', g('CONTAINER'), 2), box('Tipo', g('TIPO')), box('Peso', g('PESO')), box('BL', g('BL')), box('Navio / viagem', [g('NAVIO'), g('VIAGEM')].filter(Boolean).join(' / ')),
          box('IMO (carga perigosa)', g('IMO') || 'NÃO'), box('Qtd.', g('QTD'))]) +
        sec('Coleta', [box('Terminal de coleta', g('TERMINAL COLETA'), 2), box('Data / hora da coleta', g('DATA / HORA - COLETA')), box('Nº do agendamento', g('Nº AGEND.', 'NO AGEND', 'AGENDAMENTO'))]) +
        sec('Entrega', [box('Entrega 1', g('ENTREGA - 1', 'ENTREGA'), 2), box('Data / hora', g('DATA / HORA - ENTREGA 1'), 2), box('Endereço', g('ENDEREÇO - ENTREGA - 1', 'ENDEREÇO ENTREGA'), 4),
          ...(g('ENTREGA - 2') ? [box('Entrega 2', g('ENTREGA - 2'), 2), box('Data / hora', g('DATA / HORA - ENTREGA 2'), 2), box('Endereço', g('ENDEREÇO - ENTREGA - 2'), 4)] : [])]) +
        sec('Devolução do vazio', [box('Terminal vazio', g('TERMINAL VAZIO'), 2), box('Armador', g('ARMADOR'), 2)]) +
        veiculo(g) + obs(g) + signs(['Programação / emitente', 'Motorista', 'Conferência']),
    },
    {
      id: 'vazio', label: 'Liberação de vazio', file: 'Liberação de vazio',
      html: (g) => head('LIBERAÇÃO DE CONTAINER VAZIO', g) +
        `<p class="txt">Autorizamos o motorista abaixo identificado, a serviço da ${esc('CRC DA COSTA TRANSPORTES LTDA (COSTALOG)')}, a movimentar o container vazio descrito, referente ao processo <b>${esc(g('REFERENCIA') || '—')}</b>${g('CLIENTE') ? ` do cliente <b>${esc(g('CLIENTE'))}</b>` : ''}.</p>` +
        sec('Container vazio', [box('Armador', g('1 - ARMADOR', 'ARMADOR'), 2), box('Container', g('1 - CONTAINER', 'CONTAINER'), 2), box('Tipo', g('1 - TIPO', 'TIPO')),
          box('Terminal / depot', g('TERMINAL VAZIO'), 2), box('Data / hora', g('DATA / HORA - DEPOT', 'DATA ENTREGA VAZIO')),
          ...(g('2 - CONTAINER') ? [box('2º armador', g('2 - ARMADOR'), 2), box('2º container', g('2 - CONTAINER'), 2), box('2º tipo', g('2 - TIPO'))] : [])]) +
        veiculo(g) + obs(g) + signs(['Responsável pela liberação', 'Motorista', 'Terminal / depot (carimbo)']),
    },
    {
      id: 'ficha', label: 'Ficha completa da linha', file: 'Ficha da linha',
      html: (g, ctx) => head('FICHA DA LINHA ' + ctx.r + ' — ' + ctx.sh.name, g) +
        `<section><h3>Todos os dados preenchidos</h3><div class="g">${ctx.cm.list.map((x) => ({ x, v: g(x.label) })).filter((o) => o.v).map((o) => box(o.x.label, o.v, o.v.length > 28 ? 2 : 0)).join('')}</div></section>`,
    },
  ];

  const CSS = `@page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; } body { margin: 0; font: 10.5pt/1.3 Calibri, Arial, sans-serif; color: #111; }
    .page { page-break-after: always; break-after: page; } .page:last-child { page-break-after: auto; break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 3px solid #e30613; padding-bottom: 6px; margin-bottom: 10px; }
    header strong { font-size: 9pt; letter-spacing: .4px; color: #444; } header h1 { margin: 2px 0 0; font-size: 17pt; letter-spacing: .3px; }
    .ref { text-align: right; display: flex; flex-direction: column; } .ref span { font-size: 8.5pt; color: #555; } .ref b { font-size: 14pt; }
    section { margin-top: 9px; break-inside: avoid; } h3 { margin: 0 0 4px; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .5px; background: #f1f1f1; padding: 3px 6px; border-left: 3px solid #e30613; }
    .g { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #999; border-left: 1px solid #999; }
    .f { border-right: 1px solid #999; border-bottom: 1px solid #999; padding: 3px 6px 4px; min-height: 34px; } .f.s2 { grid-column: span 2; } .f.s4 { grid-column: span 4; }
    .f i { display: block; font-style: normal; font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: .3px; } .f b { display: block; font-size: 10.5pt; overflow-wrap: anywhere; }
    .obs { border: 1px solid #999; min-height: 54px; padding: 6px; white-space: pre-wrap; }
    .chk { display: flex; flex-wrap: wrap; gap: 6px 18px; border: 1px solid #999; padding: 6px 8px; }
    .txt { margin: 6px 0; text-align: justify; }
    .signs { display: flex; gap: 22px; margin-top: 40px; } .signs div { flex: 1; text-align: center; } .signs span { display: block; border-top: 1px solid #111; margin-bottom: 3px; } .signs small { font-size: 8.5pt; color: #333; }
    footer { margin-top: 10px; font-size: 7.5pt; color: #777; text-align: right; }`;

  function printDoc(id) {
    const d = DOCS.find((x) => x.id === id);
    if (!d) return;
    const sh = App.sheet(), si = doc.active;
    const rows = App.withReal(() => selRows());
    const cm = App.withReal(() => colMap(sh));
    const pages = App.withReal(() => rows.filter((r) => r >= cm.first).map((r) => {
      const g = getter(sh, si, cm, r);
      // linha sem nenhum dado não vira página
      if (!cm.list.some((x) => g(x.label))) return null;
      return { r, ref: g('REFERENCIA', 'REF'), html: d.html(g, { sh, r, cm }) };
    }).filter(Boolean));
    if (!pages.length) return notify('Selecione uma linha com dados para imprimir.');
    if (pages.length > 60) return notify('Selecione no máximo 60 linhas por impressão.');
    const quem = App.cloud && App.cloud.user ? App.cloud.user.name : '';
    const title = `${d.file} - ${[...new Set(pages.map((p) => p.ref).filter(Boolean))].slice(0, 3).join(', ') || 'linha ' + pages[0].r}`.replace(/[\\/:*?"<>|]/g, '-');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${pages.map((p) => `<div class="page">${p.html}<footer>${esc(sh.name)} · linha ${p.r}${quem ? ' · impresso por ' + esc(quem) : ''} · ${esc(new Date().toLocaleString('pt-BR'))}</footer></div>`).join('')}</body></html>`;
    // imprime por um quadro escondido (não depende de janela nova, que o navegador pode bloquear)
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    w.document.open(); w.document.write(html); w.document.close();
    const go = () => {
      try { w.focus(); w.print(); } catch (e) { notify('Não foi possível abrir a impressão: ' + e.message); }
      setTimeout(() => fr.remove(), 60000);
    };
    if (w.document.readyState === 'complete') setTimeout(go, 60); else fr.onload = () => setTimeout(go, 60);
    notify(`${d.label}: ${pages.length === 1 ? 'linha ' + pages[0].r : pages.length + ' páginas (uma por linha)'}. Na janela de impressão dá para salvar em PDF.`);
  }

  App.on('contextItems', ({ hit, items }) => {
    if (!['cell', 'fill', 'rowHdr'].includes(hit.area)) return;
    const at = items.findIndex((x) => x && x.cmd === 'sendStatus');
    const item = { label: 'Imprimir', icon: 'print', need: 'printDoc', sub: DOCS.map((d) => ({ label: d.label, cmd: 'printDoc', arg: d.id })) };
    items.splice(at >= 0 ? at + 1 : items.length, 0, item);
  });
  App.commands.def('printDoc', 'Imprimir documento', (id) => printDoc(id));
  App.printDocs = { DOCS, printDoc };
})(window.App);
