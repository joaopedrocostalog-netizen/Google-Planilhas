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

  const quando = (th) => { const d = new Date(th.when || th.date); return isNaN(d) ? th.date : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };
  const fmtTam = (n) => (!n ? '0 KB' : n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const lerArquivo = (f) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve({ name: f.name, type: f.type || 'application/octet-stream', data: String(fr.result).split(',')[1] || '', size: f.size });
    fr.onerror = () => reject(new Error('Não foi possível ler ' + f.name));
    fr.readAsDataURL(f);
  });

  const LIMITE = 15 * 1048576; // anexos: 15 MB somados (o limite combinado)
  const TOLERANCIA = 17 * 1048576; // passando um pouco dos 15 MB, até 17 MB, ainda deixa enviar

  // imagens grandes da assinatura do webmail viram uma versão leve (a de lá chega a ter vários MB)
  async function reduzImagens(html, larguraMax) {
    const box = document.createElement('div');
    box.innerHTML = html;
    for (const img of [...box.querySelectorAll('img[src^="data:image"]')]) {
      try {
        const el = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = img.getAttribute('src'); });
        const shown = Number(img.getAttribute('width')) || el.naturalWidth;
        const alvo = Math.min(el.naturalWidth, Math.max(200, Math.round(shown * 1.5)), larguraMax || 1200);
        if (el.naturalWidth <= alvo && img.getAttribute('src').length < 300000) continue;
        const c = document.createElement('canvas');
        c.width = alvo; c.height = Math.round(el.naturalHeight * alvo / el.naturalWidth);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = 'high';
        g.drawImage(el, 0, 0, c.width, c.height);
        img.setAttribute('src', c.toDataURL('image/jpeg', 0.9));
        if (!img.getAttribute('width')) img.setAttribute('width', String(Math.round(alvo / 1.5)));
      } catch (e) { /* deixa como está */ }
    }
    return box.innerHTML;
  }
  // traz a assinatura configurada no webmail da conta e guarda no servidor
  async function importarAssinatura(sh) {
    const w = await api('POST', `/api/docs/${cloud().id}/mail/signature/webmail`, { sheet: sh.id });
    const html = await reduzImagens(w.html, 1200);
    await api('PUT', `/api/docs/${cloud().id}/mail/signature`, { sheet: sh.id, html, origem: 'webmail' });
    return html;
  }

  // grupo = { ref, html, tsv, n } vindo do painel Enviar status
  App.mailSend = async (grupo) => {
    const sh = App.sheet();
    const dados = await App.mailInfo(sh);
    if (!dados.configurado) return notify('O envio por e-mail ainda não foi configurado no servidor. Peça a um administrador.');
    if (!dados.podeEnviar) return notify('Enviar status por e-mail não está liberado para você.');

    const anexos = [];
    let th = null, busca = grupo.ref || '';
    const m = App.ui.modal({
      title: `Enviar status por e-mail${grupo.ref ? ' — ' + grupo.ref : ''}`, width: 'min(1180px, 97vw)', cls: 'ms-modal modal-tall', enterSubmits: false,
      body: `<div class="ms-search"><label>Procurar a conversa pelo assunto</label>
          <div class="ms-search-row"><input class="input" id="ms-q" value="${esc(busca)}" placeholder="Referência ou qualquer texto do assunto">
          <button class="btn" id="ms-go">${icon('search', 15)} Procurar</button>${grupo.ref ? `<button class="btn btn-sm ms-ref" id="ms-ref" title="Voltar a procurar pela REFERENCIA">REFERENCIA: ${esc(grupo.ref)}</button>` : ''}</div></div>
        <div class="ms-grid">
          <div class="ms-col">
            <label class="field"><span>Assunto</span><input class="input" id="ms-sub"></label>
            <label class="field"><span>Para</span><input class="input" id="ms-to" placeholder="nome@empresa.com.br"></label>
            <label class="field"><span>Cópia (responder a todos)</span><input class="input" id="ms-cc" placeholder="separe por vírgula"></label>
            <label class="field"><span>Mensagem antes da tabela</span><textarea class="input ms-msg" id="ms-msg" rows="5">Boa tarde!\nSegue o status atualizado:</textarea></label>
            <div class="ms-anexos" id="ms-drop">
              <div class="ms-anexos-head"><b>Anexos</b><span id="ms-tam">0 de 15 MB</span><button class="btn btn-sm" id="ms-add">${icon('plus', 14)} Anexar arquivo</button></div>
              <div id="ms-lista" class="ms-lista"></div>
              <input type="file" id="ms-file" multiple hidden>
            </div>
          </div>
          <div class="ms-col ms-last">
            <div class="ms-last-head"><b>Última mensagem da conversa</b><span id="ms-last-meta"></span></div>
            <iframe class="ms-last-frame" id="ms-last" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Última mensagem"></iframe>
            <div class="ms-opts">
              <label class="inline"><input type="checkbox" id="ms-quote" checked> Incluir o histórico da conversa embaixo</label>
              <label class="inline"><input type="checkbox" id="ms-sig" checked> Assinatura</label>
              <button class="btn btn-sm" id="ms-sig-imp" title="Busca de novo a assinatura configurada no webmail">Atualizar assinatura do webmail</button>
            </div>
          </div>
        </div>
        <p class="sp-label">Vai assim no corpo (${grupo.n} ${grupo.n === 1 ? 'linha' : 'linhas'})</p>
        <div class="st-box ms-prev">${grupo.html}<div class="ms-sig-prev" id="ms-sig-prev"></div></div>
        <p class="sp-hint">Sai de <b>${esc(dados.remetente || '')}</b>. Confira os destinatários: a mensagem é enviada de verdade.</p>`,
      buttons: [{ label: 'Cancelar' }],
    });
    const d = m.el, q = (x) => d.querySelector(x);
    // situação da busca ao lado do título
    const head = d.querySelector('.modal-head h2');
    const chip = document.createElement('span');
    chip.className = 'ms-chip';
    head.after(chip);
    const estado = (cls, html) => { chip.className = 'ms-chip ' + cls; chip.innerHTML = html; };

    const pe = d.querySelector('.modal-foot');
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    pe.appendChild(btn);
    const rotulo = () => { btn.textContent = th ? 'Responder a todos' : 'Enviar e-mail novo'; };

    const mostraUltima = () => {
      const fr = q('#ms-last');
      if (!th) {
        q('#ms-last-meta').textContent = '';
        fr.srcdoc = `<body style="font:13px Arial,sans-serif;color:#80868b;display:grid;place-items:center;height:90vh;margin:0">Nenhuma conversa encontrada — vai como e-mail novo.</body>`;
        q('#ms-quote').disabled = true;
        return;
      }
      q('#ms-quote').disabled = !th.citada;
      q('#ms-last-meta').innerHTML = `${th.fromMe ? 'enviada por nós' : esc(th.from)} · ${esc(quando(th))}`;
      const cab = `<div style="font:12px Arial,sans-serif;color:#5f6368;border-bottom:1px solid #eee;padding:0 0 6px;margin:0 0 8px"><b>De:</b> ${esc(th.from)}<br><b>Para:</b> ${esc(th.to)}${th.cc ? `<br><b>Cc:</b> ${esc(th.cc)}` : ''}<br><b>Assunto:</b> ${esc(th.subject)}</div>`;
      fr.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font:13px Calibri,Arial,sans-serif;margin:10px;color:#202124;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${cab}${th.preview || `<p style="color:#80868b">${esc(th.snippet || '(sem texto)')}</p>`}</body></html>`;
    };
    const procurar = async (texto) => {
      busca = String(texto || '').trim();
      if (busca.length < 3) { notify('Digite ao menos 3 letras do assunto.'); return; }
      estado('wait', `Procurando <b>${esc(busca)}</b>…`);
      q('#ms-go').disabled = true;
      let achado;
      try { achado = await api('POST', `/api/docs/${cloud().id}/mail/find`, { sheet: sh.id, ref: busca }); }
      catch (e) { estado('err', esc(e.message)); q('#ms-go').disabled = false; return; }
      q('#ms-go').disabled = false;
      if (!d.isConnected) return;
      th = achado.achou ? achado.thread : null;
      const dest = achado.achou ? achado.destinatarios : { to: q('#ms-to').value, cc: q('#ms-cc').value };
      q('#ms-sub').value = th ? (/^re:/i.test(th.subject) ? th.subject : 'Re: ' + th.subject) : `STATUS - REFERENCIA: ${grupo.ref || busca}`;
      q('#ms-to').value = dest.to; q('#ms-cc').value = dest.cc;
      estado(th ? 'ok' : 'warn', th ? `✓ Conversa encontrada <small>${th.total > 1 ? th.total + ' mensagens · ' : ''}responde à última</small>` : `Nenhuma conversa com <b>${esc(busca)}</b> — e-mail novo`);
      rotulo();
      mostraUltima();
    };
    q('#ms-go').onclick = (e) => { e.preventDefault(); procurar(q('#ms-q').value); };
    q('#ms-q').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); procurar(q('#ms-q').value); } });
    if (q('#ms-ref')) q('#ms-ref').onclick = (e) => { e.preventDefault(); q('#ms-q').value = grupo.ref; procurar(grupo.ref); };

    // assinatura: a guardada no servidor; se ainda não existir, traz a do webmail
    const sigPrev = (html) => { q('#ms-sig-prev').innerHTML = html && q('#ms-sig').checked ? html : ''; q('#ms-sig-prev').hidden = !html || !q('#ms-sig').checked; };
    let sigHtml = '';
    const carregaAssinatura = async (forcar) => {
      try {
        const sg = forcar ? null : await api('GET', `/api/docs/${cloud().id}/mail/signature?sheet=${encodeURIComponent(sh.id)}`);
        sigHtml = sg && sg.tem ? sg.html : await importarAssinatura(sh);
        if (forcar) notify('Assinatura atualizada com a do webmail.');
      } catch (e) { if (forcar || !sigHtml) notify('Assinatura: ' + e.message); }
      if (d.isConnected) sigPrev(sigHtml);
    };
    q('#ms-sig').onchange = () => sigPrev(sigHtml);
    q('#ms-sig-imp').onclick = (e) => { e.preventDefault(); carregaAssinatura(true); };

    const desenhaAnexos = () => {
      const total = anexos.reduce((n, a) => n + a.size, 0);
      q('#ms-tam').textContent = total > LIMITE ? `${fmtTam(total)} de 15 MB (tolerância até 17 MB)` : `${fmtTam(total)} de 15 MB`;
      q('#ms-tam').classList.toggle('cheio', total > LIMITE * 0.9);
      q('#ms-lista').innerHTML = anexos.length
        ? anexos.map((a, i) => `<span class="ms-anexo" title="${esc(a.name)}">📎 <span class="ms-an-nome">${esc(a.name)}</span> <i>${fmtTam(a.size)}</i><button data-rm="${i}" title="Tirar">×</button></span>`).join('')
        : '<span class="ms-vazio">Arraste arquivos para cá ou use "Anexar arquivo".</span>';
      q('#ms-lista').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); anexos.splice(+b.dataset.rm, 1); desenhaAnexos(); }));
    };
    const adiciona = async (files) => {
      for (const f of [...files]) {
        const total = anexos.reduce((n, a) => n + a.size, 0);
        if (total + f.size > TOLERANCIA) { notify(`${f.name} passa do limite de 15 MB somando os anexos (a tolerância vai até 17 MB).`); continue; }
        try { anexos.push(await lerArquivo(f)); } catch (er) { notify(er.message); }
      }
      desenhaAnexos();
    };
    q('#ms-add').onclick = (e) => { e.preventDefault(); q('#ms-file').click(); };
    q('#ms-file').onchange = async (e) => { await adiciona(e.target.files); e.target.value = ''; };
    const drop = q('#ms-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) adiciona(e.dataTransfer.files); });
    d.querySelectorAll('.input').forEach((x) => x.addEventListener('keydown', (ev) => ev.stopPropagation()));

    btn.onclick = async () => {
      const to = q('#ms-to').value.trim();
      if (!to) return notify('Informe ao menos um destinatário.');
      const intro = q('#ms-msg').value.trim();
      const introHtml = intro ? intro.split('\n').map((l) => `<p style="margin:0 0 6px">${esc(l) || '&nbsp;'}</p>`).join('') : '';
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await api('POST', `/api/docs/${cloud().id}/mail/send`, {
          sheet: sh.id, subject: q('#ms-sub').value.trim(), to, cc: q('#ms-cc').value.trim(),
          html: introHtml + grupo.html, text: (intro ? intro + '\n\n' : '') + grupo.tsv,
          ref: th ? busca : '', quote: !!(th && q('#ms-quote').checked && !q('#ms-quote').disabled), signature: q('#ms-sig').checked,
          inReplyTo: th ? th.messageId : null,
          references: th ? [th.references, th.messageId].filter(Boolean).join(' ') : null,
          attachments: anexos.map((a) => ({ name: a.name, type: a.type, data: a.data })),
        });
        m.close();
        notify(`✓ Status ${grupo.ref ? 'da referência ' + grupo.ref + ' ' : ''}enviado para ${r.destinatarios.length} ${r.destinatarios.length === 1 ? 'pessoa' : 'pessoas'}.`);
      } catch (e) {
        btn.disabled = false; rotulo();
        notify(e.message);
      }
    };
    desenhaAnexos();
    rotulo();
    mostraUltima();
    carregaAssinatura(false);
    if (busca) procurar(busca); else { estado('warn', 'Sem REFERENCIA: digite o assunto e clique em Procurar'); setTimeout(() => q('#ms-q').focus(), 50); }
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
