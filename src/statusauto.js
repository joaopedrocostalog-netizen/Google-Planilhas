// Status automático por e-mail (Administrador › Status automático): o administrador agenda — aba, quais linhas
// (coluna CLIENTE ou REFERENCIA com os valores), STATUS que ficam de fora, horários, dias e o setor que confere.
// Na hora marcada o servidor avisa o setor (celular e Painel do dia). Quem confere toca em "Conferir e enviar":
// as linhas são selecionadas e abre a tela de sempre do Enviar status / e-mail. NADA é enviado sem confirmar.
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc, esc = App.esc;
  const id = () => (App.cloudMode && App.cloud && App.cloud.id) || null;
  const api = (...a) => App.collab.api(...a);
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const norm = (s) => (App.preStacking ? App.preStacking.norm(s) : String(s || '').toUpperCase());

  async function config() {
    if (!id()) return App.emit('notify', 'O status automático fica no servidor: abra a planilha na nuvem.');
    if (App.adminOnly && App.adminOnly()) return App.emit('notify', 'Somente administradores configuram o status automático.');
    let lista, who = { sectors: [], people: [] };
    try { lista = await api('GET', `/api/docs/${id()}/status-auto`); } catch (e) { return App.emit('notify', e.message); }
    try { if (App.whoOptions) who = await App.whoOptions(); } catch (e) { /* sem lista */ }
    const box = document.createElement('div');
    const desenha = () => {
      box.innerHTML = `<p class="sp-hint">Na hora marcada, o setor escolhido recebe o aviso (celular e Painel do dia) para <b>conferir e confirmar</b> o envio. Nada sai sem confirmação.</p>
        <div class="sa-list">${lista.map((a, i) => `<div class="sa-it${a.ativo ? '' : ' off'}"><div><b>${esc(a.nome)}</b><small>${esc((doc.sheets.find((s) => s.id === a.sheetId) || {}).name || '?')} · ${esc(a.filtroCol)}: ${esc(a.valores.join(', ') || 'todas as linhas')} · ${esc(a.horarios.join(', ') || 'sem horário')} · ${esc(a.dias.map((d) => DIAS[d]).join(' '))} · ${a.who && a.who.length ? 'confere: ' + esc(a.who.map((w) => App.whoName ? App.whoName(w, who) : w).join(', ')) : 'confere: todos que podem enviar'}</small></div>
          <button class="btn btn-sm" data-ed="${i}">Editar</button><button class="btn btn-sm" data-rm="${i}">Excluir</button></div>`).join('') || '<p class="sp-hint">Nenhum status automático ainda.</p>'}</div>
        <button class="btn" id="sa-novo">+ Novo status automático</button>`;
      box.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => editar(lista[+b.dataset.ed], (x) => { lista[+b.dataset.ed] = x; desenha(); })));
      box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { lista.splice(+b.dataset.rm, 1); desenha(); }));
      box.querySelector('#sa-novo').onclick = () => editar(null, (x) => { lista.push(x); desenha(); });
    };
    function editar(a0, pronto) {
      const a = JSON.parse(JSON.stringify(a0 || { nome: '', ativo: true, sheetId: (App.sheet() || {}).id, filtroCol: 'CLIENTE', valores: [], ignorar: ['FINALIZADO', 'PROC. - FINALIZADO'], horarios: ['08:00'], dias: [1, 2, 3, 4, 5], who: [], obs: '' }));
      App.ui.modal({
        title: a0 ? 'Editar status automático' : 'Novo status automático', width: '620px',
        body: `<label class="field"><span>Nome</span><input class="input" id="sa-n" value="${esc(a.nome)}" placeholder="Ex.: Status diário ACME"></label>
          <label class="field"><span>Aba</span><select class="input" id="sa-s">${doc.sheets.filter((s) => !s.shadow).map((s) => `<option value="${s.id}"${s.id === a.sheetId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <div class="dc-top"><label class="field"><span>Linhas pela coluna</span><select class="input" id="sa-c">${['CLIENTE', 'REFERENCIA', 'DI / DTA', 'RESERVA', 'NAVIO'].map((c) => `<option${c === a.filtroCol ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Horários (ex.: 08:00, 16:00)</span><input class="input" id="sa-h" value="${esc(a.horarios.join(', '))}"></label></div>
          <label class="field"><span>Valores (um por linha; vale também o começo do nome; vazio = todas as linhas)</span><textarea class="input" id="sa-v" rows="3">${esc(a.valores.join('\n'))}</textarea></label>
          <label class="field"><span>Deixar de fora as linhas com STATUS (um por linha)</span><textarea class="input" id="sa-i" rows="2">${esc(a.ignorar.join('\n'))}</textarea></label>
          <p class="sp-label">Dias</p><div class="hc-boxes">${DIAS.map((d, i) => `<label class="check"><input type="checkbox" data-dia="${i}"${a.dias.includes(i) ? ' checked' : ''}> ${d}</label>`).join('')}</div>
          <p class="sp-label">Quem confere e envia (setor ou pessoas; nenhum = todos que podem enviar)</p><div>${App.whoBoxes ? App.whoBoxes('saw', a.who || [], who) : ''}</div>
          <label class="field"><span>Observação para quem confere</span><input class="input" id="sa-o" value="${esc(a.obs)}"></label>
          <label class="check"><input type="checkbox" id="sa-a"${a.ativo ? ' checked' : ''}> Ativo</label>`,
        buttons: [{ label: 'Cancelar' }, { label: 'OK', primary: true, action: (d) => {
          const lines = (sel) => d.querySelector(sel).value.split('\n').map((x) => x.trim()).filter(Boolean);
          a.nome = d.querySelector('#sa-n').value.trim() || 'Status automático';
          a.sheetId = d.querySelector('#sa-s').value; a.filtroCol = d.querySelector('#sa-c').value;
          a.horarios = d.querySelector('#sa-h').value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => (/^\d:\d\d$/.test(x) ? '0' + x : x)).filter((x) => /^\d{2}:\d{2}$/.test(x));
          a.valores = lines('#sa-v'); a.ignorar = lines('#sa-i');
          a.dias = [...d.querySelectorAll('[data-dia]')].filter((x) => x.checked).map((x) => +x.dataset.dia);
          a.who = [...d.querySelectorAll('[data-saw]')].filter((x) => x.checked).map((x) => x.dataset.saw);
          a.obs = d.querySelector('#sa-o').value.trim(); a.ativo = d.querySelector('#sa-a').checked;
          if (!a.horarios.length) { App.emit('notify', 'Informe ao menos um horário (ex.: 08:00).'); return false; }
          pronto(a);
        } }],
      });
      document.querySelectorAll('#sa-v, #sa-i').forEach((t) => t.addEventListener('keydown', (e) => e.stopPropagation()));
    }
    desenha();
    App.ui.modal({ title: 'Status automático', width: '720px', body: box, buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => {
      api('PUT', `/api/docs/${id()}/status-auto`, { agendamentos: lista }).then(() => App.emit('notify', 'Status automático salvo.')).catch((e) => App.emit('notify', e.message));
    } }] });
  }

  // ---------- pendências: conferir e enviar ----------
  let pendentes = [];
  App.statusPendentes = async () => {
    if (!id()) return [];
    try { pendentes = await api('GET', `/api/docs/${id()}/status-auto/pendentes`); } catch (e) { pendentes = []; }
    return pendentes;
  };
  // seleciona as linhas do status e abre a tela de sempre (Enviar status › Enviar por e-mail, com confirmação)
  App.statusConferir = (x) => {
    const sh = doc.sheets.find((s) => s.id === x.sheetId);
    if (!sh) return App.emit('notify', 'A aba deste status não foi encontrada.');
    const si = doc.sheets.indexOf(sh);
    if (si !== doc.active) App.run('switchSheet', si);
    const rows = App.withReal(() => {
      const P = App.preStacking, m = P.colMap(sh), hr = P.headerRow(sh);
      const fc = P.findCol(m, [x.filtroCol]), cs = P.findCol(m, P.A.STATUS), cc = P.findCol(m, P.A.CONTAINER) || fc;
      const vals = (x.valores || []).map(norm).filter(Boolean), ign = (x.ignorar || []).map(norm);
      const out = [];
      for (let r = hr + 1; r <= (App.usedRange(sh).maxR || 0); r++) {
        const tem = cc && String(App.value(si, r, cc) ?? '').trim();
        if (!tem) continue;
        const v = norm(fc ? App.value(si, r, fc) : '');
        if (vals.length && !vals.some((k) => v === k || (k.length >= 3 && v.includes(k)))) continue;
        if (cs && ign.includes(norm(App.value(si, r, cs)))) continue;
        out.push(r);
      }
      return out;
    });
    if (!rows.length) return App.emit('notify', `"${x.nome}": nenhuma linha encontrada agora (filtro ${x.filtroCol}).`);
    const disp = rows.map((r) => (App.dispCell ? App.dispCell(r, 1) : { r, c: 1 })).filter(Boolean);
    if (!disp.length) return App.emit('notify', 'As linhas deste status estão escondidas pela sua visualização com filtro.');
    const maxC = App.usedRange(sh).maxC || 1;
    App.grid.select(disp[disp.length - 1].r, 1);
    App.sel.er = disp[disp.length - 1].r; App.sel.ec = maxC;
    App.sel.extra = disp.slice(0, -1).map((d) => ({ r1: d.r, c1: 1, r2: d.r, c2: maxC }));
    App.grid.draw();
    App.run('sendStatus');
    if (x.obs) setTimeout(() => App.emit('notify', 'Observação: ' + x.obs), 400);
  };
  App.statusFeito = (x) => api('POST', `/api/docs/${id()}/status-auto/pendentes/${encodeURIComponent(x.id)}/feito`, {}).catch((e) => App.emit('notify', e.message));
  // ao abrir a planilha: avisa se há status para conferir
  let avisou = false;
  App.on('sheet', () => {
    if (avisou || !id()) return;
    avisou = true;
    setTimeout(async () => { const l = await App.statusPendentes(); if (l.length) App.emit('notify', `${l.length} ${l.length === 1 ? 'status automático' : 'status automáticos'} para conferir e enviar: veja no Painel do dia.`); }, 4000);
  });
  App.commands.def('statusAuto', 'Status automático', config);
})(window.App);
