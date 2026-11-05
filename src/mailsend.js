// Enviar status por e-mail: acha a conversa pela REFERENCIA, mostra para quem vai e envia com a tabela e os anexos.
// O envio sai da conta de e-mail configurada no servidor; nada é enviado sem a pessoa confirmar nesta tela.
(function (App) {
  'use strict';
  const esc = App.esc, doc = App.doc;
  const notify = (m) => App.emit('notify', m);
  const icon = (n, s) => App.icon(n, s);
  const api = (...a) => App.collab.api(...a);
  // App.cloud é criado pelo collab.js, que carrega depois deste arquivo: ler sempre na hora
  const cloud = () => App.cloud || {};

  let info = null, infoFor = null;
  // o servidor diz se o e-mail está configurado e se esta pessoa pode enviar nesta página
  App.mailInfo = async (sh) => {
    if (!App.cloudMode || !cloud().id) return { configurado: false, podeEnviar: false };
    const key = cloud().id + '|' + sh.id;
    if (infoFor === key && info) return info;
    try { info = await api('GET', `/api/docs/${cloud().id}/mail?sheet=${encodeURIComponent(sh.id)}`); infoFor = key; }
    catch (e) { info = { configurado: false, podeEnviar: false, erro: e.message }; infoFor = key; }
    return info;
  };
  App.on('sheet', () => { infoFor = null; });

  const fmtTam = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const lerArquivo = (f) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve({ name: f.name, type: f.type || 'application/octet-stream', data: String(fr.result).split(',')[1] || '', size: f.size });
    fr.onerror = () => reject(new Error('Não foi possível ler ' + f.name));
    fr.readAsDataURL(f);
  });

  // grupo = { ref, html, tsv, n } vindo do painel Enviar status
  App.mailSend = async (grupo) => {
    const sh = App.sheet();
    const dados = await App.mailInfo(sh);
    if (!dados.configurado) return notify('O envio por e-mail ainda não foi configurado no servidor. Peça a um administrador.');
    if (!dados.podeEnviar) return notify('Enviar status por e-mail não está liberado para você.');
    if (!grupo.ref) return notify('Esta linha está sem REFERENCIA, que é o assunto procurado no e-mail.');

    const anexos = [];
    const m = App.ui.modal({
      title: `Enviar status por e-mail — ${grupo.ref}`, width: 'min(1100px, 96vw)', cls: 'ms-modal', enterSubmits: false,
      body: `<p class="ms-step" id="ms-step">Procurando no e-mail a conversa com o assunto <b>${esc(grupo.ref)}</b>…</p><div id="ms-form" hidden></div>`,
      buttons: [{ label: 'Cancelar' }],
    });
    const d = m.el, q = (x) => d.querySelector(x);
    let achado = null;

    try { achado = await api('POST', `/api/docs/${cloud().id}/mail/find`, { sheet: sh.id, ref: grupo.ref }); }
    catch (e) { q('#ms-step').className = 'ms-step err'; q('#ms-step').textContent = e.message; return; }
    if (!d.isConnected) return;

    const th = achado.achou ? achado.thread : null;
    const dest = achado.achou ? achado.destinatarios : { to: '', cc: '' };
    const assunto = th ? (/^re:/i.test(th.subject) ? th.subject : 'Re: ' + th.subject) : `STATUS - REFERENCIA: ${grupo.ref}`;

    q('#ms-step').className = 'ms-step ' + (th ? 'ok' : 'warn');
    q('#ms-step').innerHTML = th
      ? `✓ Conversa encontrada: <b>${esc(th.subject)}</b><small>Última mensagem de ${esc(th.from)} em ${esc(th.date)}${th.total > 1 ? ` · ${th.total} mensagens com este assunto` : ''}. A resposta vai na mesma conversa.</small>`
      : `Nenhuma mensagem com <b>${esc(grupo.ref)}</b> no assunto. Dá para enviar como e-mail novo — confira os destinatários.`;

    q('#ms-form').hidden = false;
    q('#ms-form').innerHTML = `
      <label class="field"><span>Assunto</span><input class="input" id="ms-sub" value="${esc(assunto)}"></label>
      <label class="field"><span>Para</span><input class="input" id="ms-to" value="${esc(dest.to)}" placeholder="nome@empresa.com.br"></label>
      <label class="field"><span>Cópia (responder a todos)</span><input class="input" id="ms-cc" value="${esc(dest.cc)}" placeholder="separe por vírgula"></label>
      <label class="field"><span>Mensagem antes da tabela</span><textarea class="input" id="ms-msg" rows="2">Boa tarde!
Segue o status atualizado:</textarea></label>
      <div class="ms-anexos"><button class="btn btn-sm" id="ms-add">${icon('plus', 14)} Anexar arquivo</button><span id="ms-lista" class="sp-hint">Nenhum anexo.</span>
        <input type="file" id="ms-file" multiple hidden></div>
      <p class="sp-label">Vai assim no corpo (${grupo.n} ${grupo.n === 1 ? 'linha' : 'linhas'})</p>
      <div class="st-box ms-prev">${grupo.html}</div>
      <p class="sp-hint">Sai de <b>${esc(dados.remetente || '')}</b>. Confira os destinatários: a mensagem é enviada de verdade.</p>`;

    const desenhaAnexos = () => {
      q('#ms-lista').innerHTML = anexos.length
        ? anexos.map((a, i) => `<span class="ms-anexo">${esc(a.name)} <i>${fmtTam(a.size)}</i><button data-rm="${i}" title="Tirar">×</button></span>`).join('')
        : 'Nenhum anexo.';
      q('#ms-lista').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { anexos.splice(+b.dataset.rm, 1); desenhaAnexos(); }));
    };
    q('#ms-add').onclick = (e) => { e.preventDefault(); q('#ms-file').click(); };
    q('#ms-file').onchange = async (e) => {
      for (const f of [...e.target.files]) {
        if (f.size > 18 * 1048576) { notify(`${f.name} é grande demais (limite de 18 MB por arquivo).`); continue; }
        try { anexos.push(await lerArquivo(f)); } catch (er) { notify(er.message); }
      }
      e.target.value = '';
      desenhaAnexos();
    };
    d.querySelectorAll('.input').forEach((x) => x.addEventListener('keydown', (ev) => ev.stopPropagation()));

    // botão de enviar, acrescentado ao rodapé
    const pe = d.querySelector('.modal-foot');
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = th ? 'Responder a todos' : 'Enviar e-mail novo';
    pe.appendChild(btn);
    btn.onclick = async () => {
      const to = q('#ms-to').value.trim();
      if (!to) return notify('Informe ao menos um destinatário.');
      const intro = q('#ms-msg').value.trim();
      const introHtml = intro ? intro.split('\n').map((l) => `<p>${esc(l)}</p>`).join('') : '';
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await api('POST', `/api/docs/${cloud().id}/mail/send`, {
          sheet: sh.id, subject: q('#ms-sub').value.trim(), to, cc: q('#ms-cc').value.trim(),
          html: introHtml + grupo.html, text: (intro ? intro + '\n\n' : '') + grupo.tsv,
          inReplyTo: th ? th.messageId : null,
          references: th ? [th.references, th.messageId].filter(Boolean).join(' ') : null,
          attachments: anexos.map((a) => ({ name: a.name, type: a.type, data: a.data })),
        });
        m.close();
        notify(`✓ Status da referência ${grupo.ref} enviado para ${r.destinatarios.length} ${r.destinatarios.length === 1 ? 'pessoa' : 'pessoas'}.`);
      } catch (e) {
        btn.disabled = false; btn.textContent = th ? 'Responder a todos' : 'Enviar e-mail novo';
        notify(e.message);
      }
    };
    desenhaAnexos();
  };

  // Administrador: quem pode enviar status por e-mail nesta página
  App.commands.def('mailWho', 'Enviar por e-mail: quem pode', async () => {
    const sh = App.sheet();
    if (App.adminOnly && App.adminOnly()) return notify('Somente administradores escolhem quem envia status por e-mail.');
    let who = { sectors: [], people: [] };
    try { if (App.whoOptions) who = await App.whoOptions(); } catch (e) { return notify(e.message); }
    const cur = sh.mailSectors || [];
    App.ui.modal({
      title: 'Enviar status por e-mail — quem pode', width: '480px',
      body: `<p class="sp-hint">Administradores sempre podem. Escolha os setores e pessoas que também podem enviar status por e-mail desta página.</p>
        <div>${App.whoBoxes ? App.whoBoxes('mw', cur, who) : ''}</div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (dd) => {
        const list = [...dd.querySelectorAll('[data-mw]')].filter((x) => x.checked).map((x) => x.dataset.mw);
        App.change('Quem envia status por e-mail', () => { if (list.length) sh.mailSectors = list; else delete sh.mailSectors; });
        infoFor = null;
        notify(list.length ? 'Permissão de envio por e-mail salva.' : 'Só administradores enviam status por e-mail nesta página.');
      } }],
    });
  });
})(window.App);
