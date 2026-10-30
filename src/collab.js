// Colaboração: contas, planilhas na nuvem, edição em tempo real, presença e compartilhamento por setores.
(function (App) {
  'use strict';
  const doc = App.doc;
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const def = (id, label, fn, sc) => App.commands.def(id, label, fn, sc);
  const Perms = window.Perms;
  const API = String(window.PLANILHAS_API || location.origin).replace(/\/$/, '');
  const TOKEN_KEY = 'planilhas:token';
  const LEVELS = [['none', 'Sem acesso'], ['view', 'Ver'], ['edit', 'Editar']];
  const COL_LEVELS = [['none', 'Oculta'], ['view', 'Somente ver'], ['edit', 'Editar']];
  const levelLabel = (l) => ({ none: 'sem acesso', view: 'ver', edit: 'editar' }[l] || l);
  const ROLES = [['admin', 'Administrador'], ['editor', 'Editor'], ['viewer', 'Leitor']];

  const cloud = (App.cloud = { token: null, user: null, ws: null, id: null, perms: null, me: null, peers: new Map(), pending: new Map(), seq: 0, connected: false, closing: false, retry: 0, initialized: false });
  try { cloud.token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* sem armazenamento */ }

  // ---------- API ----------
  async function api(method, path, body) {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cloud.token ? { Authorization: 'Bearer ' + cloud.token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Não foi possível falar com o servidor. Verifique a internet; o servidor pode levar até 1 minuto para acordar.');
    }
    let j = {};
    try { j = await r.json(); } catch (e) { /* resposta sem corpo */ }
    if (!r.ok) { const err = new Error(j.error || 'Erro ' + r.status); err.status = r.status; throw err; }
    return j;
  }
  const docLink = (id) => location.origin + location.pathname + '#nuvem=' + id;

  // ---------- Conta ----------
  function setToken(t, user) {
    cloud.token = t; cloud.user = user;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignora */ }
    renderAccount();
  }
  async function loadMe() {
    if (!cloud.token) { renderAccount(); return null; }
    try { cloud.user = await api('GET', '/api/me'); }
    catch (e) { if (e.status === 401) setToken(null, null); }
    renderAccount();
    return cloud.user;
  }
  function loginDialog(reason) {
    return new Promise((resolve) => {
      let mode = 'login', done = false;
      const m = App.ui.modal({
        title: 'Entrar no Planilhas', width: '420px',
        body: `${reason ? `<p class="modal-text">${esc(reason)}</p>` : ''}
          <div class="sp-tabs auth-tabs"><button type="button" data-t="login" class="on">Entrar</button><button type="button" data-t="register">Criar conta</button></div>
          <form class="auth-form" novalidate>
            <label class="field" data-only="register" hidden><span>Nome</span><input class="input" name="name" autocomplete="name"></label>
            <label class="field"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email"></label>
            <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="current-password"></label>
            <p class="auth-err" hidden></p>
            <button class="btn btn-primary auth-submit" type="submit">Entrar</button>
          </form>
          <p class="sp-hint">Planilhas na nuvem podem ser abertas de qualquer computador e editadas por várias pessoas ao mesmo tempo.</p>`,
        onClose: () => { if (!done) resolve(null); },
      });
      const d = m.el, form = d.querySelector('.auth-form'), err = d.querySelector('.auth-err'), submit = d.querySelector('.auth-submit');
      const setMode = (k) => {
        mode = k;
        d.querySelectorAll('.auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === k));
        d.querySelector('[data-only="register"]').hidden = k !== 'register';
        submit.textContent = k === 'register' ? 'Criar conta' : 'Entrar';
        form.password.autocomplete = k === 'register' ? 'new-password' : 'current-password';
        err.hidden = true;
        (k === 'register' ? form.name : form.email).focus();
      };
      d.querySelectorAll('.auth-tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.t)));
      form.email.focus();
      form.onsubmit = async (e) => {
        e.preventDefault();
        err.hidden = true;
        submit.disabled = true;
        submit.textContent = 'Aguarde…';
        try {
          const body = { email: form.email.value, password: form.password.value };
          if (mode === 'register') body.name = form.name.value;
          const r = await api('POST', mode === 'register' ? '/api/register' : '/api/login', body);
          setToken(r.token, r.user);
          done = true;
          m.close();
          notify(`Olá, ${r.user.name}!`);
          resolve(r.user);
        } catch (ex) {
          err.textContent = ex.message; err.hidden = false;
          submit.disabled = false;
          submit.textContent = mode === 'register' ? 'Criar conta' : 'Entrar';
        }
      };
    });
  }
  async function ensureLogin(reason) {
    if (cloud.token && (cloud.user || (await loadMe()))) return cloud.user;
    return loginDialog(reason);
  }
  function renderAccount() {
    setTimeout(refreshChrome, 0);
    const b = $('btn-account');
    if (!b) return;
    if (cloud.user) {
      const color = cloud.user.color || '#e30613';
      b.className = 'account-btn avatar-btn';
      b.style.background = color;
      b.textContent = (cloud.user.name || '?').trim()[0].toUpperCase();
      b.title = `${cloud.user.name} (${cloud.user.email})`;
    } else {
      b.className = 'account-btn';
      b.style.background = '';
      b.textContent = 'Entrar';
      b.title = 'Entrar para usar planilhas compartilhadas';
    }
  }
  function accountMenu(anchor) {
    if (!cloud.user) { loginDialog(); return; }
    App.ui.menuPopup(anchor, [
      { header: cloud.user.name + ' · ' + cloud.user.email },
      { label: 'Planilhas na nuvem', icon: 'cloud', cmd: 'openCloud' },
      { label: 'Alterar nome ou senha', action: profileDialog }, '-',
      { label: 'Sair', action: logout },
    ], { right: true });
  }
  function profileDialog() {
    App.ui.modal({
      title: 'Sua conta', width: '420px',
      body: `<label class="field"><span>Nome</span><input class="input" id="pf-name" value="${esc(cloud.user.name)}"></label>
        <p class="sp-label">Trocar senha (opcional)</p>
        <label class="field"><span>Senha atual</span><input class="input" id="pf-cur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>Nova senha</span><input class="input" id="pf-new" type="password" autocomplete="new-password"></label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const body = { name: d.querySelector('#pf-name').value };
        if (d.querySelector('#pf-new').value) { body.password = d.querySelector('#pf-new').value; body.current = d.querySelector('#pf-cur').value; }
        api('PUT', '/api/me', body).then((u) => { cloud.user = u; renderAccount(); notify('Conta atualizada.'); }).catch((e) => notify(e.message));
      } }],
    });
  }
  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) { /* ignora */ }
    if (App.cloudMode) { leaveCloud(); App.newDocument(); }
    setToken(null, null);
    notify('Você saiu da sua conta.');
  }

  // ---------- Conexão em tempo real ----------
  function send(obj) { if (cloud.ws && cloud.ws.readyState === 1) cloud.ws.send(JSON.stringify(obj)); }
  function setStatus(kind) {
    const el = $('save-status');
    if (!el) return;
    const text = { connecting: 'Conectando…', online: 'Salvo na nuvem', saving: 'Salvando na nuvem…', offline: 'Sem conexão: as alterações serão enviadas ao reconectar' }[kind];
    el.innerHTML = `${icon('cloud', 16)} ${esc(text)}`;
    el.classList.toggle('offline', kind === 'offline');
  }
  async function openCloudDoc(id) {
    const u = await ensureLogin('Entre com a sua conta para abrir esta planilha compartilhada.');
    if (!u) return false;
    if (!App.cloudMode) App.save();
    disconnect();
    cloud.id = id; cloud.pending.clear(); cloud.seq = 0; cloud.initialized = false; cloud.closing = false; cloud.retry = 0;
    try { history.replaceState(null, '', '#nuvem=' + id); } catch (e) { /* ignora */ }
    connect();
    return true;
  }
  function connect() {
    const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
    cloud.ws = ws;
    setStatus('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: cloud.token, doc: cloud.id }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } handle(m); };
    ws.onclose = () => {
      if (cloud.ws !== ws) return;
      cloud.connected = false; cloud.ws = null;
      if (cloud.closing || !cloud.id) return;
      setStatus('offline');
      cloud.peers.clear(); renderPeers();
      const delay = [1000, 2000, 4000, 8000, 15000][Math.min(cloud.retry++, 4)];
      cloud.timer = setTimeout(connect, delay);
    };
  }
  function disconnect() {
    cloud.closing = true;
    clearTimeout(cloud.timer);
    if (cloud.ws) { try { cloud.ws.close(); } catch (e) { /* ignora */ } }
    cloud.ws = null; cloud.connected = false;
    cloud.peers.clear(); renderPeers();
  }
  function leaveCloud() {
    if (!cloud.id && !App.cloudMode) return;
    disconnect();
    cloud.id = null; cloud.perms = null; cloud.initialized = false; cloud.pending.clear();
    App.cloudMode = false; App.validatePatch = null; App.editGuard = null; App.colBlocked = null; App.colReadonly = null; App.colsLocked = null;
    closeHistory();
    refreshChrome();
    renderChip();
  }
  function handle(m) {
    switch (m.type) {
      case 'init': onInit(m); break;
      case 'ack': cloud.pending.delete(m.id); if (!cloud.pending.size) setStatus('online'); break;
      case 'patch': App.applyRemote(m.patch); break;
      case 'reject': cloud.pending.delete(m.id); notify(m.reason); break;
      case 'join': cloud.peers.set(m.peer.cid, m.peer); renderPeers(); notify(`${m.peer.name} entrou na planilha.`); break;
      case 'presence': cloud.peers.set(m.peer.cid, m.peer); renderPeers(); break;
      case 'leave': cloud.peers.delete(m.cid); renderPeers(); break;
      case 'error': onError(m); break;
    }
  }
  function onInit(m) {
    const first = !cloud.initialized;
    const activeId = !first && doc.sheets[doc.active] ? doc.sheets[doc.active].id : null;
    cloud.initialized = true; cloud.connected = true; cloud.retry = 0;
    cloud.perms = m.perms; cloud.me = m.me;
    if (App.editing()) App.cancelEdit();
    App.cloudMode = true;
    App.docId = 'nuvem:' + cloud.id;
    doc.title = m.doc.title || 'Planilha sem título';
    doc.names = m.doc.names || {};
    doc.sheets = (m.doc.sheets || []).map(App.normalizeSheet);
    if (!doc.sheets.length) {
      // nenhuma página liberada para este setor
      const ph = App.newSheet('Sem acesso');
      ph.id = '__sem_acesso__';
      ph.cells.A1 = { v: 'Você ainda não tem acesso a nenhuma página desta planilha. Peça acesso a um administrador.', s: { i: true, color: '#6b6b6b' } };
      doc.sheets = [ph];
      cloud.perms.sheets[ph.id] = 'view';
    }
    const idx = activeId ? doc.sheets.findIndex((s) => s.id === activeId) : 0;
    doc.active = Math.max(0, idx);
    App.clearHistory();
    App.invalidate();
    // alterações locais ainda não confirmadas (por exemplo, feitas sem conexão) são reaplicadas e reenviadas
    for (const [id, p] of [...cloud.pending]) {
      if (Perms.validate(p, cloud.perms, doc)) { cloud.pending.delete(id); continue; }
      App.applyPatch(p);
      send({ type: 'patch', id, patch: p });
    }
    cloud.peers = new Map((m.peers || []).map((p) => [p.cid, p]));
    App.validatePatch = (p, inv) => { const err = Perms.validate(p, cloud.perms, doc, inv); if (err) cloud.remask = true; return err; };
    // colunas ocultas por permissão somem da grade; as somente leitura ganham um cadeado no cabeçalho
    App.colBlocked = cloud.perms.admin ? null : (sh, c) => Perms.colLevel(cloud.perms, sh.id, c) === 'none';
    App.colReadonly = cloud.perms.admin ? null : (sh, c) => Perms.hasColRules(cloud.perms, sh.id) && Perms.colLevel(cloud.perms, sh.id, c) === 'view';
    App.colsLocked = () => !!(App.cloudMode && cloud.perms && !cloud.perms.admin);
    App.editGuard = (sh, r, c) => {
      const lv = Perms.colLevel(cloud.perms, sh.id, c);
      if (lv !== 'edit') {
        if (lv === 'none') return 'Você não tem acesso a esta coluna.';
        return Perms.hasColRules(cloud.perms, sh.id) ? `Você só pode visualizar a coluna ${Perms.colName(c)} da página "${sh.name}".` : `Você só pode visualizar a página "${sh.name}".`;
      }
      const pr = Perms.blockingProtection(cloud.perms, sh, App.E.addrToStr(r, c));
      return pr ? `Esta célula está protegida${pr.desc ? ' (' + pr.desc + ')' : ''}. Peça acesso a um administrador.` : null;
    };
    App.emit('sheet');
    App.emit('change', { remote: true });
    App.emit('title');
    setStatus(cloud.pending.size ? 'saving' : 'online');
    renderPeers(); renderChip(); sendPresence(); refreshChrome();
    if (first) notify(`Você entrou como ${m.me.name}${m.perms.sectorName ? ' · setor ' + m.perms.sectorName : ''} (${roleLabel(m.perms.role)}).`);
  }
  function onError(m) {
    cloud.closing = true;
    if (m.code === 'auth') {
      setToken(null, null);
      const id = cloud.id;
      loginDialog(m.message).then((u) => { if (u && id) openCloudDoc(id); });
      return;
    }
    const wasOpen = cloud.initialized;
    leaveCloud();
    if (wasOpen) App.newDocument();
    App.ui.modal({
      title: m.code === 'denied' ? 'Sem acesso' : 'Planilha indisponível', width: '440px',
      body: `<p class="modal-text">${esc(m.message)}</p>`,
      buttons: [{ label: 'Fechar' }, { label: 'Ver minhas planilhas', primary: true, action: () => { setTimeout(() => App.run('openCloud'), 0); } }],
    });
  }
  // envia as alterações locais
  App.on('localPatch', (p) => {
    if (!App.cloudMode || !cloud.id) return;
    const id = ++cloud.seq;
    cloud.pending.set(id, p);
    if (cloud.connected) { send({ type: 'patch', id, patch: p }); setStatus('saving'); } else setStatus('offline');
  });
  App.on('localDoc', leaveCloud);
  App.on('change', () => {
    if (!cloud.remask) return;
    cloud.remask = false;
    if (!App.colBlocked) return;
    let n = 0;
    for (const sh of doc.sheets) {
      for (const a in sh.cells) {
        const x = sh.cells[a];
        if (x && !x._h && !Object.keys(x).length && App.colBlocked(sh, Perms.colOf(a))) { x._h = 1; n++; }
      }
    }
    if (n) { App.invalidate(); App.grid.draw(); }
  });
  setInterval(() => { if (cloud.connected) send({ type: 'ping' }); }, 20000);
  window.addEventListener('beforeunload', (e) => {
    if (App.cloudMode && cloud.pending.size) { e.preventDefault(); e.returnValue = 'Algumas alterações ainda não foram enviadas.'; }
  });

  // ---------- Presença ----------
  let presTimer = null;
  function sendPresence() {
    if (!cloud.connected) return;
    clearTimeout(presTimer);
    presTimer = setTimeout(() => {
      const R = App.selRect();
      send({ type: 'presence', sheetId: App.sheet().id, sel: { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, R.r1 + 5000), c2: R.c2 }, editing: App.editing() });
    }, 120);
  }
  ['selection', 'sheet', 'editStart', 'editEnd'].forEach((ev) => App.on(ev, sendPresence));
  function renderPeers() {
    const box = $('peers');
    const list = [...cloud.peers.values()];
    if (box) {
      const shown = list.slice(0, 5);
      box.innerHTML = shown.map((p) => `<button class="peer" data-cid="${esc(p.cid)}" style="background:${p.color}" title="${esc(p.name)} (${esc(p.email)})">${esc((p.name || '?').trim()[0].toUpperCase())}</button>`).join('') +
        (list.length > 5 ? `<span class="peer more" title="${list.slice(5).map((p) => esc(p.name)).join(', ')}">+${list.length - 5}</span>` : '');
      box.querySelectorAll('.peer[data-cid]').forEach((b) => (b.onclick = () => {
        const p = cloud.peers.get(b.dataset.cid);
        if (!p || !p.presence || !p.presence.sel) return;
        const i = doc.sheets.findIndex((s) => s.id === p.presence.sheetId);
        if (i >= 0 && i !== doc.active) App.run('switchSheet', i);
        App.grid.select(p.presence.sel.r1, p.presence.sel.c1);
      }));
    }
    const visibleSel = (p) => {
      const sh = doc.sheets.find((x) => x.id === p.presence.sheetId);
      if (!sh || !App.colBlocked) return true;
      const S = p.presence.sel;
      for (let c = S.c1; c <= Math.min(S.c2, S.c1 + 60); c++) if (!App.colBlocked(sh, c)) return true;
      return false;
    };
    App.grid.setPeers(list.filter((p) => p.presence && p.presence.sel && visibleSel(p)).map((p) => ({ name: (p.name || '').split(' ')[0], color: p.color, sheetId: p.presence.sheetId, sel: p.presence.sel, editing: p.presence.editing })));
  }
  const roleLabel = (r) => ({ admin: 'administrador', editor: 'editor', viewer: 'leitor' }[r] || r);
  function renderChip() {
    const chip = $('cloud-chip');
    if (!chip) return;
    if (!App.cloudMode || !cloud.perms) { chip.hidden = true; return; }
    const P = cloud.perms, id = App.sheet().id;
    const best = Perms.bestLevel(P, id), page = Perms.levelOf(P, id), partial = Perms.hasColRules(P, id);
    chip.hidden = false;
    chip.className = 'cloud-chip' + (best !== 'edit' ? ' readonly' : '');
    chip.textContent = best !== 'edit' ? 'Somente visualização' : partial || page !== 'edit' ? 'Acesso por coluna' : P.sectorName ? 'Setor ' + P.sectorName : roleLabel(P.role)[0].toUpperCase() + roleLabel(P.role).slice(1);
    let title = P.admin ? 'Você é administrador desta planilha.' : `Seu acesso: ${roleLabel(P.role)}${P.sectorName ? ', setor ' + P.sectorName : ''}.`;
    if (partial) {
      const m = P.cols[id] || {};
      const by = (l) => Object.keys(m).filter((c) => m[c] === l).map((c) => Perms.colName(+c)).join(', ');
      title += `\nDemais colunas: ${levelLabel(page)}.` + (by('edit') ? `\nPode editar: ${by('edit')}.` : '') + (by('view') ? `\nSomente ver: ${by('view')}.` : '') + (by('none') ? `\nOcultas: ${by('none')}.` : '');
    }
    chip.title = title;
  }
  App.on('sheet', renderChip);

  // ---------- Planilhas na nuvem ----------
  const canCreate = () => !!(cloud.user && cloud.user.admin);
  async function openCloudDialog() {
    if (!(await ensureLogin('Entre com a sua conta para ver as planilhas na nuvem.'))) return;
    const m = App.ui.modal({
      title: 'Planilhas na nuvem', width: '760px', cls: 'modal-tall',
      body: `${canCreate() ? `<div class="cloud-actions"><button class="btn btn-primary" id="cl-new">${icon('plus', 16)} Nova planilha na nuvem</button><button class="btn" id="cl-upload">${icon('cloud', 16)} Enviar a planilha atual</button></div>` : ''}
        <input class="input" id="cl-q" placeholder="Pesquisar">
        <div class="od-list" id="cl-list"><p class="sp-hint">Carregando…</p></div>`,
    });
    const d = m.el;
    let items = [];
    const fmt = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const render = () => {
      const q = d.querySelector('#cl-q').value.toLowerCase();
      const vis = items.filter((x) => (x.title || '').toLowerCase().includes(q));
      d.querySelector('#cl-list').innerHTML = vis.length ? vis.map((x) => `<div class="od-item${x.id === cloud.id ? ' cur' : ''}" data-id="${esc(x.id)}">${icon('sheetIcon', 26)}<div><b>${esc(x.title)}</b><small>${x.mine ? 'Sua planilha' : 'De ' + esc(x.owner || '')} · ${esc(roleLabel(x.role))} · modificada em ${fmt(x.updated)}</small></div>${x.mine ? `<button class="icon-btn od-del" title="Excluir planilha">${icon('close', 16)}</button>` : ''}</div>`).join('')
        : `<p class="sp-hint">${canCreate() ? 'Nenhuma planilha na nuvem ainda. Crie uma nova ou envie a planilha atual.' : 'Nenhuma planilha foi compartilhada com você ainda. Peça o link a um administrador.'}</p>`;
    };
    try { items = await api('GET', '/api/docs'); render(); }
    catch (e) { d.querySelector('#cl-list').innerHTML = `<p class="sp-hint">${esc(e.message)}</p>`; }
    d.querySelector('#cl-q').addEventListener('input', render);
    d.querySelector('#cl-list').addEventListener('click', (e) => {
      const it = e.target.closest('.od-item');
      if (!it) return;
      const x = items.find((i) => i.id === it.dataset.id);
      if (e.target.closest('.od-del')) {
        App.ui.confirm('Excluir planilha da nuvem?', `"${x.title}" será excluída para todas as pessoas com acesso. Essa ação não pode ser desfeita.`, 'Excluir', () => {
          api('DELETE', '/api/docs/' + x.id).then(() => { notify('Planilha excluída.'); if (cloud.id === x.id) { leaveCloud(); App.newDocument(); } }).catch((er) => notify(er.message));
        });
        m.close();
        return;
      }
      m.close();
      openCloudDoc(x.id);
    });
    if (d.querySelector('#cl-new')) d.querySelector('#cl-new').onclick = async () => {
      try { const r = await api('POST', '/api/docs', { title: 'Planilha sem título' }); m.close(); await openCloudDoc(r.id); }
      catch (e) { notify(e.message); }
    };
    if (d.querySelector('#cl-upload')) d.querySelector('#cl-upload').onclick = () => { m.close(); saveToCloud(); };
  }
  async function saveToCloud(thenShare) {
    if (App.cloudMode) { notify('Esta planilha já está na nuvem.'); return; }
    if (!(await ensureLogin('Entre com a sua conta para salvar esta planilha na nuvem.'))) return;
    if (!canCreate()) { notify('Somente administradores podem salvar planilhas na nuvem.'); return; }
    try {
      const data = JSON.parse(App.serialize());
      const r = await api('POST', '/api/docs', { title: doc.title, data: { title: doc.title, names: data.names || {}, sheets: data.sheets } });
      cloud.shareAfterInit = !!thenShare;
      await openCloudDoc(r.id);
      notify('Planilha salva na nuvem. A cópia local continua em Arquivo › Abrir.');
    } catch (e) { notify(e.message); }
  }
  App.on('change', () => {
    if (cloud.shareAfterInit && App.cloudMode && cloud.perms) { cloud.shareAfterInit = false; setTimeout(shareDialog, 50); }
  });

  // ---------- Compartilhar ----------
  const oldShare = App.cmds.share ? App.cmds.share.run : null;
  function shareLocal() {
    if (!canCreate()) { if (oldShare) oldShare(); return; }
    App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '520px',
      body: `<div class="share-opts">
          <button class="share-opt" data-a="cloud">${icon('cloud', 22)}<div><b>Salvar na nuvem e convidar pessoas</b><small>Edição em tempo real, com login e permissões por setor.</small></div></button>
          <button class="share-opt" data-a="other">${icon('link', 22)}<div><b>Outras opções</b><small>Baixar o arquivo ou gerar um link com uma cópia.</small></div></button>
        </div>`,
      onOpen: (d) => {
        d.querySelector('[data-a="cloud"]').onclick = () => { d.querySelector('.modal-x').click(); saveToCloud(true); };
        d.querySelector('[data-a="other"]').onclick = () => { d.querySelector('.modal-x').click(); if (oldShare) oldShare(); };
      },
    });
  }
  function shareInfo() {
    const p = cloud.perms;
    const rows = doc.sheets.map((s) => {
      const lv = Perms.levelOf(p, s.id), m = (p.cols && p.cols[s.id]) || {};
      const by = (l) => Object.keys(m).filter((c) => m[c] === l).map((c) => Perms.colName(+c)).join(', ');
      const extra = Object.keys(m).length ? `<small class="sp-hint">${by('edit') ? 'Edita: ' + by('edit') + '. ' : ''}${by('view') ? 'Somente vê: ' + by('view') + '. ' : ''}${by('none') ? 'Ocultas: ' + by('none') + '.' : ''}</small>` : '';
      return `<tr><td>${esc(s.name)}</td><td>${lv === 'edit' ? 'Pode editar' : lv === 'view' ? 'Somente visualizar' : 'Só as colunas liberadas'}${extra}</td></tr>`;
    }).join('');
    App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '480px',
      body: `<p class="modal-text">Seu acesso: <b>${esc(roleLabel(p.role))}</b>${p.sectorName ? ` · setor <b>${esc(p.sectorName)}</b>` : ''}. Somente administradores podem convidar pessoas e mudar permissões.</p>
        <table class="cs-table share-perm-table">${rows}</table>
        <label class="field"><span>Link da planilha</span><input class="input" readonly value="${esc(docLink(cloud.id))}"></label>`,
      buttons: [{ label: 'Copiar link', action: () => { navigator.clipboard.writeText(docLink(cloud.id)).then(() => notify('Link copiado.')); return false; } }, { label: 'Fechar', primary: true }],
    });
  }
  // Editor de colunas: escolhe, para uma regra (setor ou pessoa), o nível de cada coluna de uma página
  function columnEditor({ title, hint, sheet, map, inheritLabel, onDone }) {
    const si = doc.sheets.indexOf(sheet);
    const n = sheet.cols;
    const head = (c) => { try { const v = App.value(si, 1, c); return v === null || v === undefined ? '' : String(App.fmtValue(v, App.style(sheet, 1, c).nf)); } catch (e) { return ''; } };
    const opt = (cur) => `<option value="">${esc(inheritLabel)}</option>` + COL_LEVELS.map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${l}</option>`).join('');
    const rows = [];
    for (let c = 1; c <= n; c++) {
      const nm = sheet.colNames && sheet.colNames[c];
      rows.push(`<tr><td class="ce-col">${Perms.colName(c)}</td><td class="ce-head">${nm ? `<b>${esc(nm)}</b>` : esc(head(c).slice(0, 40)) || '<span class="sp-hint">(vazia)</span>'}</td><td><select class="input" data-c="${c}">${opt(map[c])}</select></td></tr>`);
    }
    App.ui.modal({
      title, width: '560px', cls: 'modal-tall', enterSubmits: false,
      body: `<p class="sp-hint">${esc(hint)}</p>
        <div class="ce-all"><span>Aplicar a todas as colunas:</span><select class="input" id="ce-all"><option value="-">Escolher…</option>${opt(null)}</select></div>
        <table class="sector-matrix ce-table"><thead><tr><th>Coluna</th><th>Nome / cabeçalho</th><th>Acesso</th></tr></thead><tbody>${rows.join('')}</tbody></table>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, action: (d) => {
        const out = {};
        d.querySelectorAll('select[data-c]').forEach((x) => { if (x.value) out[x.dataset.c] = x.value; });
        onDone(out);
      } }],
      onOpen: (d) => {
        d.querySelector('#ce-all').onchange = (e) => {
          if (e.target.value === '-') return;
          d.querySelectorAll('select[data-c]').forEach((x) => { x.value = e.target.value; });
          e.target.value = '-';
        };
      },
    });
  }
  const ruleCount = (access, key) => Object.keys((access && access[key]) || {}).length;
  const newId = (p) => (p || '') + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  // Grava as regras por coluna alteradas (ficam dentro das páginas)
  function commitAccess(draft, validKeys, names) {
    names = names || {};
    const changes = [], nameChanges = [];
    for (const sh of doc.sheets) {
      if (!names[sh.id]) continue;
      const clean = {};
      for (const c in names[sh.id]) { const v = String(names[sh.id][c] || '').trim().slice(0, 60); if (v) clean[c] = v; }
      const next = Object.keys(clean).length ? clean : null;
      if (JSON.stringify(next) !== JSON.stringify(sh.colNames && Object.keys(sh.colNames).length ? sh.colNames : null)) nameChanges.push([sh, next]);
    }
    for (const sh of doc.sheets) {
      if (!draft[sh.id] && !sh.access) continue;
      const src = draft[sh.id] || sh.access;
      const clean = {};
      for (const k in src) if (validKeys.has(k) && src[k] && Object.keys(src[k]).length) clean[k] = src[k];
      const next = Object.keys(clean).length ? clean : null;
      if (JSON.stringify(next) !== JSON.stringify(sh.access || null)) changes.push([sh, next]);
    }
    if (changes.length || nameChanges.length) {
      App.change('Permissões por coluna', () => {
        for (const [sh, next] of changes) { if (next) sh.access = next; else delete sh.access; }
        for (const [sh, next] of nameChanges) { if (next) sh.colNames = next; else delete sh.colNames; }
      });
    }
    return changes.length + nameChanges.length;
  }

  async function shareDialog() {
    let st;
    try { st = await api('GET', `/api/docs/${cloud.id}/share`); }
    catch (e) { notify(e.message); return; }
    const acl = JSON.parse(JSON.stringify(st.acl));
    acl.members.forEach((mb) => { if (!mb.rid) mb.rid = newId('m'); });
    // rascunho das regras por coluna, por página
    const draft = {};
    const sheetById = (id) => doc.sheets.find((s) => s.id === id);
    const accessOf = (sid) => draft[sid] || (draft[sid] = JSON.parse(JSON.stringify((sheetById(sid) || {}).access || {})));
    const peekAccess = (sid) => draft[sid] || (sheetById(sid) || {}).access || {};
    // rascunho dos nomes das colunas, por página
    const names = {};
    const namesOf = (sid) => names[sid] || (names[sid] = Object.assign({}, (sheetById(sid) || {}).colNames || {}));
    const m = App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '820px', cls: 'modal-tall share-modal', enterSubmits: false,
      body: `<div class="sp-tabs share-tabs"><button class="on" data-t="people">Pessoas</button><button data-t="sectors">Setores e permissões</button><button data-t="cols">Colunas</button><button data-t="link">Acesso pelo link</button></div>
        <div class="share-pane" data-pane="people"></div><div class="share-pane" data-pane="sectors" hidden></div><div class="share-pane" data-pane="cols" hidden></div><div class="share-pane" data-pane="link" hidden></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => {
        const valid = new Set([...acl.sectors.map((s) => s.id), ...acl.members.map((x) => x.rid), 'link']);
        commitAccess(draft, valid, names);
        api('PUT', `/api/docs/${cloud.id}/share`, { acl }).then(() => notify('Compartilhamento atualizado.')).catch((e) => notify(e.message));
      } }],
    });
    const d = m.el;
    d.querySelectorAll('.share-tabs button').forEach((b) => (b.onclick = () => {
      d.querySelectorAll('.share-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      d.querySelectorAll('.share-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.t; });
      render();
    }));
    const sectorOpts = (cur, emptyLabel) => `<option value="">${esc(emptyLabel || 'Sem setor (acesso conforme o papel)')}</option>` + acl.sectors.map((s) => `<option value="${esc(s.id)}"${cur === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    const opts = (list, cur) => list.map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${l}</option>`).join('');
    const lvName = (l) => (LEVELS.find((x) => x[0] === l) || ['', l])[1];
    const totalRules = (key) => st.sheets.reduce((n, sh) => n + ruleCount(peekAccess(sh.id), key) + (0), 0);

    // permissões próprias de uma pessoa: páginas e colunas (têm prioridade sobre as do setor)
    function personEditor(mb) {
      const sec = acl.sectors.find((s) => s.id === mb.sector);
      const cap = mb.role === 'viewer' ? 'view' : 'edit';
      const own = Object.assign({}, mb.sheets || {});
      const base = (sid) => (sec ? (sec.sheets[sid] || sec.default) : cap);
      const pageLv = (sid) => own[sid] || base(sid);
      const pm = App.ui.modal({
        title: `Permissões de ${mb.name || mb.email}`, width: '640px', enterSubmits: false,
        body: `<p class="sp-hint">O que você definir aqui vale só para esta pessoa e tem prioridade sobre ${sec ? `o setor <b>${esc(sec.name)}</b>` : 'o papel dela'}. ${mb.role === 'viewer' ? 'Leitores nunca editam.' : ''}</p>
          <table class="sector-matrix pe-table"><thead><tr><th>Página</th><th>Acesso à página</th><th>Colunas</th></tr></thead><tbody></tbody></table>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, action: () => {
          if (Object.keys(own).length) mb.sheets = own; else delete mb.sheets;
          renderPeople();
        } }],
      });
      const body = pm.el.querySelector('tbody');
      const draw = () => {
        body.innerHTML = st.sheets.map((sh) => {
          const n = ruleCount(peekAccess(sh.id), mb.rid);
          return `<tr><td>${esc(sh.name)}</td><td><select class="input" data-ps="${esc(sh.id)}"><option value="">Conforme ${sec ? 'o setor' : 'o papel'} (${lvName(base(sh.id))})</option>${opts(LEVELS, own[sh.id])}</select></td>
            <td><button class="btn btn-sm" data-pc="${esc(sh.id)}">${icon('lock', 14)} Colunas${n ? ` (${n})` : ''}</button></td></tr>`;
        }).join('');
        body.querySelectorAll('[data-ps]').forEach((x) => (x.onchange = () => { if (x.value) own[x.dataset.ps] = x.value; else delete own[x.dataset.ps]; }));
        body.querySelectorAll('[data-pc]').forEach((b) => (b.onclick = () => {
          const sid = b.dataset.pc, sheet = sheetById(sid);
          if (!sheet) return;
          columnEditor({
            title: `Colunas de "${sheet.name}" para ${mb.name || mb.email}`,
            hint: 'Escolha o que esta pessoa pode fazer em cada coluna. "Conforme a página" segue o acesso definido para a página inteira.',
            sheet, map: Object.assign({}, accessOf(sid)[mb.rid] || {}), inheritLabel: `Conforme a página (${lvName(pageLv(sid))})`,
            onDone: (out) => { const acc = accessOf(sid); if (Object.keys(out).length) acc[mb.rid] = out; else delete acc[mb.rid]; draw(); },
          });
        }));
      };
      draw();
    }

    function renderPeople() {
      const pane = d.querySelector('[data-pane="people"]');
      pane.innerHTML = `<div class="share-add"><input class="input" id="sh-email" type="email" placeholder="E-mail da pessoa"><select class="input" id="sh-role">${opts(ROLES, 'editor')}</select><select class="input" id="sh-sector">${sectorOpts(null)}</select><button class="btn btn-primary" id="sh-add">Adicionar</button></div>
        <p class="sp-hint">A pessoa precisa entrar com este e-mail. Se ainda não tiver conta, o acesso fica reservado até ela se cadastrar. Em <b>Permissões</b> você escolhe as páginas e colunas que cada pessoa pode ver ou editar.</p>
        <div class="share-list">
          ${st.owner ? `<div class="share-row"><span class="avatar" style="background:${st.owner.color}">${esc(st.owner.name[0].toUpperCase())}</span><div class="sr-who"><b>${esc(st.owner.name)}</b><small>${esc(st.owner.email)}</small></div><span class="sr-fixed">Dono · administrador</span></div>` : ''}
          ${acl.members.map((mb, i) => {
            const own = Object.keys(mb.sheets || {}).length + totalRules(mb.rid);
            return `<div class="share-row"><span class="avatar" style="background:${mb.registered === false ? '#9a9a9a' : '#5f6368'}">${esc((mb.name || mb.email)[0].toUpperCase())}</span>
            <div class="sr-who"><b>${esc(mb.name || mb.email)}</b><small>${esc(mb.email)}${mb.registered === false ? ' · aguardando cadastro' : ''}${st.online.includes(mb.email) ? ' · <span class="online">online</span>' : ''}</small></div>
            <select class="input" data-role="${i}">${opts(ROLES, mb.role)}</select><select class="input" data-sector="${i}"${mb.role === 'admin' ? ' disabled' : ''}>${sectorOpts(mb.sector)}</select>
            <button class="btn btn-sm" data-perm="${i}"${mb.role === 'admin' ? ' disabled title="Administradores veem e editam tudo"' : ''}>Permissões${own ? ` (${own})` : ''}</button>
            <button class="icon-btn" data-rm="${i}" title="Remover acesso">${icon('close', 16)}</button></div>`;
          }).join('')}
        </div>`;
      pane.querySelector('#sh-add').onclick = () => {
        const email = pane.querySelector('#sh-email').value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify('Informe um e-mail válido.');
        if (acl.members.some((x) => x.email === email) || (st.owner && st.owner.email === email)) return notify('Esta pessoa já tem acesso.');
        acl.members.push({ email, role: pane.querySelector('#sh-role').value, sector: pane.querySelector('#sh-sector').value || null, name: null, rid: newId('m') });
        renderPeople();
      };
      pane.querySelector('#sh-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pane.querySelector('#sh-add').click(); } });
      pane.querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => { acl.members[+s.dataset.role].role = s.value; renderPeople(); }));
      pane.querySelectorAll('[data-sector]').forEach((s) => (s.onchange = () => { acl.members[+s.dataset.sector].sector = s.value || null; }));
      pane.querySelectorAll('[data-perm]').forEach((b) => (b.onclick = () => personEditor(acl.members[+b.dataset.perm])));
      pane.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { acl.members.splice(+b.dataset.rm, 1); renderPeople(); }));
    }
    function renderSectors() {
      const pane = d.querySelector('[data-pane="sectors"]');
      pane.innerHTML = `<p class="sp-hint">Crie setores (por exemplo, Comercial ou Financeiro) e defina o que cada um pode ver e editar em cada página e em cada coluna. Os setores só preenchem valores nas colunas liberadas; formatação, regras e estrutura da planilha ficam com os administradores. Leitores nunca editam.</p>
        ${acl.sectors.map((s, i) => `<div class="sector-card">
          <div class="sector-head"><input class="input" data-sname="${i}" value="${esc(s.name)}" placeholder="Nome do setor"><button class="icon-btn" data-srm="${i}" title="Excluir setor">${icon('close', 16)}</button></div>
          <div class="sector-row"><label class="field"><span>Acesso padrão às páginas</span><select class="input" data-sdef="${i}">${opts(LEVELS, s.default)}</select></label></div>
          <table class="sector-matrix"><thead><tr><th>Página</th><th>Acesso</th><th>Colunas</th></tr></thead><tbody>
          ${st.sheets.map((sh) => { const n = ruleCount(peekAccess(sh.id), s.id); return `<tr><td>${esc(sh.name)}</td><td><select class="input" data-sheet="${i}:${esc(sh.id)}"><option value="">Padrão (${lvName(s.default)})</option>${opts(LEVELS, s.sheets[sh.id])}</select></td>
            <td><button class="btn btn-sm" data-scols="${i}:${esc(sh.id)}">${icon('lock', 14)} Colunas${n ? ` (${n})` : ''}</button></td></tr>`; }).join('')}
          </tbody></table></div>`).join('') || '<p class="sp-hint">Nenhum setor criado.</p>'}
        <button class="btn" id="sec-add">${icon('plus', 16)} Adicionar setor</button>`;
      pane.querySelector('#sec-add').onclick = () => { acl.sectors.push({ id: newId('s'), name: 'Novo setor', default: 'view', sheets: {}, manage: false }); renderSectors(); const ins = pane.querySelectorAll('[data-sname]'); ins[ins.length - 1].select(); };
      pane.querySelectorAll('[data-sname]').forEach((x) => (x.oninput = () => { acl.sectors[+x.dataset.sname].name = x.value; }));
      pane.querySelectorAll('[data-sdef]').forEach((x) => (x.onchange = () => { acl.sectors[+x.dataset.sdef].default = x.value; renderSectors(); }));
      pane.querySelectorAll('[data-sheet]').forEach((x) => (x.onchange = () => {
        const [i, id] = x.dataset.sheet.split(':');
        if (x.value) acl.sectors[+i].sheets[id] = x.value; else delete acl.sectors[+i].sheets[id];
        renderSectors();
      }));
      pane.querySelectorAll('[data-scols]').forEach((b) => (b.onclick = () => {
        const [i, sid] = b.dataset.scols.split(':');
        const sec = acl.sectors[+i], sheet = sheetById(sid);
        if (!sheet) return;
        columnEditor({
          title: `Colunas de "${sheet.name}" para o setor ${sec.name}`,
          hint: 'Escolha o que o setor pode fazer em cada coluna. Colunas ocultas não aparecem para o setor e os dados delas nem chegam ao navegador dessas pessoas.',
          sheet, map: Object.assign({}, accessOf(sid)[sec.id] || {}), inheritLabel: `Conforme a página (${lvName(sec.sheets[sid] || sec.default)})`,
          onDone: (out) => { const acc = accessOf(sid); if (Object.keys(out).length) acc[sec.id] = out; else delete acc[sec.id]; renderSectors(); },
        });
      }));
      pane.querySelectorAll('[data-srm]').forEach((b) => (b.onclick = () => {
        const s = acl.sectors[+b.dataset.srm];
        App.ui.confirm('Excluir setor?', `As pessoas do setor "${s.name}" passarão a ter o acesso do papel delas (editor ou leitor) em todas as páginas.`, 'Excluir', () => {
          acl.sectors = acl.sectors.filter((x) => x !== s);
          acl.members.forEach((mb) => { if (mb.sector === s.id) mb.sector = null; });
          if (acl.linkSector === s.id) acl.linkSector = null;
          renderSectors();
        });
      }));
    }
    function renderLink() {
      const pane = d.querySelector('[data-pane="link"]');
      pane.innerHTML = `<label class="check"><input type="radio" name="sh-link" value="none"${acl.link === 'none' ? ' checked' : ''}> <div><b>Restrito</b><br><small>Somente as pessoas adicionadas podem abrir.</small></div></label>
        <label class="check"><input type="radio" name="sh-link" value="any"${acl.link !== 'none' ? ' checked' : ''}> <div><b>Qualquer pessoa com o link</b><br><small>Precisa entrar com uma conta. Útil para liberar uma área inteira.</small></div></label>
        <div class="share-link-opts"${acl.link === 'none' ? ' hidden' : ''}>
          <label class="field"><span>Papel</span><select class="input" id="sh-link-role">${opts([['view', 'Leitor'], ['edit', 'Editor']], acl.link === 'none' ? 'view' : acl.link)}</select></label>
          <label class="field"><span>Setor aplicado</span><select class="input" id="sh-link-sector">${sectorOpts(acl.linkSector, 'Sem setor (todas as páginas)')}</select></label>
        </div>
        <label class="field"><span>Link da planilha</span><div class="share-copy"><input class="input" readonly value="${esc(docLink(cloud.id))}"><button class="btn" id="sh-copy">Copiar link</button></div></label>`;
      pane.querySelectorAll('input[name=sh-link]').forEach((r) => (r.onchange = () => {
        acl.link = r.value === 'none' ? 'none' : pane.querySelector('#sh-link-role').value;
        pane.querySelector('.share-link-opts').hidden = acl.link === 'none';
      }));
      pane.querySelector('#sh-link-role').onchange = (e) => { if (acl.link !== 'none') acl.link = e.target.value; };
      pane.querySelector('#sh-link-sector').onchange = (e) => { acl.linkSector = e.target.value || null; };
      pane.querySelector('#sh-copy').onclick = () => navigator.clipboard.writeText(docLink(cloud.id)).then(() => notify('Link copiado.'), () => notify('Selecione e copie o link.'));
    }
    // quadro único: o administrador escolhe, para cada setor, quais colunas da página ele vê e edita
    let matrixSheet = (App.sheet() && st.sheets.some((x) => x.id === App.sheet().id)) ? App.sheet().id : (st.sheets[0] && st.sheets[0].id);
    function renderMatrix() {
      const pane = d.querySelector('[data-pane="cols"]');
      const sheet = sheetById(matrixSheet);
      if (!sheet) { pane.innerHTML = ''; return; }
      const si = doc.sheets.indexOf(sheet);
      const n = sheet.cols;
      const nm = namesOf(sheet.id);
      const head = (c) => { try { const v = App.value(si, 1, c); return v === null || v === undefined ? '' : String(App.fmtValue(v, App.style(sheet, 1, c).nf)); } catch (e) { return ''; } };
      const acc = peekAccess(sheet.id);
      const short = [['', 'Padrão'], ['none', 'Oculta'], ['view', 'Ver'], ['edit', 'Editar']];
      const cellSel = (sid, c) => {
        const cur = (acc[sid] && acc[sid][c]) || '';
        return `<select class="input mx-sel lv-${cur || 'def'}" data-mx="${esc(sid)}:${c}">${short.map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      };
      const rows = [];
      for (let c = 1; c <= n; c++) rows.push(`<tr><td class="ce-col">${Perms.colName(c)}</td><td class="mx-name"><input class="input" data-nm="${c}" value="${esc(nm[c] || '')}" placeholder="${esc(head(c).slice(0, 30) || Perms.colName(c))}" maxlength="60"></td>${acl.sectors.map((sec) => `<td>${cellSel(sec.id, c)}</td>`).join('')}</tr>`);
      pane.innerHTML = `<div class="mx-top"><label class="field"><span>Página</span><select class="input" id="mx-sheet">${st.sheets.map((x) => `<option value="${esc(x.id)}"${x.id === matrixSheet ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <p class="sp-hint"><b>Nome da coluna</b> troca a letra do cabeçalho (ex.: A → CLIENTE) para todos. ${acl.sectors.length ? '' : 'Crie setores na aba <b>Setores e permissões</b> para liberar ou ocultar colunas por setor. '}Escolha o que cada setor pode fazer em cada coluna. <b>Padrão</b> segue o acesso do setor à página inteira (mostrado abaixo do nome). Colunas <b>ocultas</b> não aparecem para o setor e os dados delas nem chegam ao navegador dessas pessoas. Para uma pessoa específica, use Pessoas › Permissões.</p></div>
        <div class="mx-wrap"><table class="sector-matrix mx-table"><thead><tr><th>Coluna</th><th>Nome da coluna</th>${acl.sectors.map((sec) => `<th><b>${esc(sec.name)}</b><small>página: ${lvName(sec.sheets[sheet.id] || sec.default).toLowerCase()}</small>
          <select class="input mx-all" data-mxall="${esc(sec.id)}"><option value="-">Todas…</option>${short.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>`;
      pane.querySelector('#mx-sheet').onchange = (e) => { matrixSheet = e.target.value; renderMatrix(); };
      pane.querySelectorAll('[data-nm]').forEach((x) => (x.oninput = () => { nm[x.dataset.nm] = x.value; }));
      const set = (sid, c, v) => {
        const a = accessOf(sheet.id);
        const rule = a[sid] || (a[sid] = {});
        if (v) rule[c] = v; else delete rule[c];
        if (!Object.keys(rule).length) delete a[sid];
      };
      pane.querySelectorAll('[data-mx]').forEach((x) => (x.onchange = () => {
        const [sid, c] = x.dataset.mx.split(':');
        set(sid, c, x.value);
        x.className = `input mx-sel lv-${x.value || 'def'}`;
      }));
      pane.querySelectorAll('[data-mxall]').forEach((x) => (x.onchange = () => {
        if (x.value === '-') return;
        for (let c = 1; c <= n; c++) set(x.dataset.mxall, c, x.value);
        renderMatrix();
      }));
    }
    function render() { renderPeople(); renderSectors(); renderMatrix(); renderLink(); }
    render();
  }

  // ---------- Permissões das colunas selecionadas (menu do cabeçalho) ----------
  async function columnAccessDialog() {
    if (!App.cloudMode) {
      App.ui.modal({ title: 'Permissões por coluna', width: '460px', body: '<p class="modal-text">As permissões por coluna valem para planilhas na nuvem. Salve esta planilha na nuvem e convide as pessoas para escolher o que cada uma pode ver e editar.</p>', buttons: [{ label: 'Fechar' }, ...(canCreate() ? [{ label: 'Salvar na nuvem', primary: true, action: () => { saveToCloud(true); } }] : [])] });
      return;
    }
    if (!cloud.perms.admin) return notify('Somente administradores podem definir permissões por coluna.');
    let st;
    try { st = await api('GET', `/api/docs/${cloud.id}/share`); } catch (e) { return notify(e.message); }
    const sh = App.sheet(), R = App.selRect();
    const c1 = R.c1, c2 = Math.min(R.c2, R.c1 + 199);
    const acl = JSON.parse(JSON.stringify(st.acl));
    let aclChanged = false;
    acl.members.forEach((mb) => { if (!mb.rid) { mb.rid = newId('m'); aclChanged = true; } });
    const lvName = (l) => (LEVELS.find((x) => x[0] === l) || ['', l])[1];
    const targets = [
      ...acl.sectors.map((s) => ({ key: s.id, who: `Setor ${s.name}`, sub: `Página: ${lvName(s.sheets[sh.id] || s.default)}` })),
      ...acl.members.filter((mb) => mb.role !== 'admin').map((mb) => ({ key: mb.rid, who: mb.name || mb.email, sub: `${roleLabel(mb.role)}${mb.sector ? ' · setor ' + ((acl.sectors.find((s) => s.id === mb.sector) || {}).name || '') : ''}` })),
    ];
    if (acl.link !== 'none' && !acl.linkSector) targets.push({ key: 'link', who: 'Qualquer pessoa com o link', sub: acl.link === 'edit' ? 'Editor' : 'Leitor' });
    const access = JSON.parse(JSON.stringify(sh.access || {}));
    const current = (key) => {
      const vals = new Set();
      for (let c = c1; c <= c2; c++) vals.add((access[key] && access[key][c]) || '');
      return vals.size === 1 ? [...vals][0] : 'mixed';
    };
    const label = c1 === c2 ? `coluna ${Perms.colName(c1)}` : `colunas ${Perms.colName(c1)} a ${Perms.colName(c2)}`;
    const opt = (cur) => (cur === 'mixed' ? '<option value="mixed" selected>(vários)</option>' : '') + `<option value=""${cur === '' ? ' selected' : ''}>Conforme a página</option>` + COL_LEVELS.map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${l}</option>`).join('');
    const single = c1 === c2;
    const curName = (sh.colNames && sh.colNames[c1]) || '';
    const nameField = single ? `<label class="field"><span>Nome da coluna (aparece no lugar da letra ${Perms.colName(c1)})</span><input class="input" id="ca-name" value="${esc(curName)}" placeholder="${Perms.colName(c1)}" maxlength="60"></label>` : '';
    App.ui.modal({
      title: single ? `Nome e permissões da ${label}` : `Permissões das ${label}`, width: '600px', enterSubmits: false,
      body: nameField + (targets.length ? `<p class="sp-hint">Escolha quem pode ver ou editar a ${esc(label)} da página "${esc(sh.name)}". Administradores sempre veem e editam tudo. A regra de uma pessoa tem prioridade sobre a do setor dela.</p>
          <div class="share-list">${targets.map((t, i) => `<div class="ca-row"><div class="sr-who"><b>${esc(t.who)}</b><small>${esc(t.sub)}</small></div><select class="input" data-t="${i}">${opt(current(t.key))}</select></div>`).join('')}</div>`
        : '<p class="modal-text">Ainda não há setores nem pessoas nesta planilha. Use <b>Compartilhar</b> para convidar pessoas e criar setores.</p>'),
      buttons: targets.length || single ? [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const newName = single ? d.querySelector('#ca-name').value.trim().slice(0, 60) : curName;
        d.querySelectorAll('select[data-t]').forEach((x) => {
          if (x.value === 'mixed') return;
          const key = targets[+x.dataset.t].key;
          const rule = access[key] || (access[key] = {});
          for (let c = c1; c <= c2; c++) { if (x.value) rule[c] = x.value; else delete rule[c]; }
          if (!Object.keys(rule).length) delete access[key];
        });
        const run = () => {
          App.change('Permissões da coluna', () => {
            if (Object.keys(access).length) sh.access = access; else delete sh.access;
            if (single && newName !== curName) {
              const nm = Object.assign({}, sh.colNames || {});
              if (newName) nm[c1] = newName; else delete nm[c1];
              if (Object.keys(nm).length) sh.colNames = nm; else delete sh.colNames;
            }
          });
          notify('Permissões da coluna salvas.');
        };
        if (aclChanged) api('PUT', `/api/docs/${cloud.id}/share`, { acl }).then(run).catch((e) => notify(e.message));
        else run();
      } }] : [{ label: 'Fechar', primary: true }],
    });
  }

  // ---------- Histórico de edições da célula ----------
  let histCard = null;
  function closeHistory() {
    if (!histCard) return;
    histCard.remove(); histCard = null;
    document.removeEventListener('mousedown', histOutside, true);
  }
  function histOutside(e) { if (histCard && !histCard.contains(e.target)) closeHistory(); }
  async function cellHistory() {
    if (!App.cloudMode) {
      App.ui.modal({ title: 'Histórico de edições', width: '460px', body: '<p class="modal-text">O histórico de edições de cada célula (quem alterou, quando e o valor anterior) fica disponível nas planilhas salvas na nuvem.</p>', buttons: [{ label: 'Fechar' }, ...(canCreate() ? [{ label: 'Salvar na nuvem', primary: true, action: () => { saveToCloud(false); } }] : [])] });
      return;
    }
    const sh = App.sheet(), r = App.sel.ar, c = App.sel.ac, a = App.E.addrToStr(r, c);
    let list;
    try { list = await api('GET', `/api/docs/${cloud.id}/history?sheet=${encodeURIComponent(sh.id)}&addr=${a}`); }
    catch (e) { return notify(e.message); }
    closeHistory();
    const card = (histCard = document.createElement('div'));
    card.className = 'hist-card';
    let i = 0;
    const fmt = (t) => new Date(t).toLocaleString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const val = (v, cls) => `<span class="hist-val${cls ? ' ' + cls : ''}">${esc(String(v).slice(0, 300))}</span>`;
    const draw = () => {
      const h = list[i];
      let body;
      if (!h) body = '<p class="hist-empty">Nenhum histórico de edições</p>';
      else {
        const what = h.before === null && h.after !== null ? `Adicionou ${val(h.after)}`
          : h.after === null ? `Excluiu ${val(h.before, 'old')}`
            : `Substituiu ${val(h.before, 'old')} por ${val(h.after)}`;
        body = `<div class="hist-who"><span class="avatar" style="background:${esc(h.color)}">${esc((h.name || '?').trim()[0].toUpperCase())}</span><div><b>${esc(h.name)}</b><small>${esc(fmt(h.at))}</small></div></div><p class="hist-what">${what}</p>`;
      }
      card.innerHTML = `<div class="hist-head"><b>Histórico de edições · ${esc(a)}</b>
          <button class="icon-btn" data-n="1" title="Edição anterior"${i >= list.length - 1 ? ' disabled' : ''}>‹</button>
          <button class="icon-btn" data-n="-1" title="Próxima edição"${i <= 0 ? ' disabled' : ''}>›</button>
          <button class="icon-btn" data-x title="Fechar">${icon('close', 16)}</button></div>
        ${body}${list.length > 1 ? `<p class="hist-count">Edição ${list.length - i} de ${list.length}</p>` : ''}`;
      card.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { i = Math.max(0, Math.min(list.length - 1, i + +b.dataset.n)); draw(); }));
      card.querySelector('[data-x]').onclick = closeHistory;
    };
    draw();
    document.body.appendChild(card);
    const rc = App.grid.cellRect(r, c), wr = $('grid-wrap').getBoundingClientRect();
    let x = wr.left + rc.x + rc.w + 6, y = wr.top + rc.y;
    if (x + card.offsetWidth > window.innerWidth - 8) x = Math.max(8, wr.left + rc.x - card.offsetWidth - 6);
    if (y + card.offsetHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - card.offsetHeight - 8);
    card.style.left = x + 'px'; card.style.top = y + 'px';
    setTimeout(() => document.addEventListener('mousedown', histOutside, true), 0);
  }
  App.on('selection', () => { if (histCard && !histCard.matches(':hover')) closeHistory(); });
  App.on('sheet', closeHistory);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHistory(); });

  // ---------- Quem não é administrador: só preenche valores ----------
  // Os setores são executores: digitam as informações nas colunas liberadas. Todo o resto
  // (formatação, regras, estrutura, filtros, congelar, tamanho de linhas e colunas) é dos administradores,
  // e essas opções nem aparecem para eles.
  const EXEC_OK = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'pasteValues', 'find', 'findReplace', 'clearValues',
    'zoom', 'toggleFormulaBar', 'toggleMenus', 'fullscreen', 'toggleGridlines', 'toggleFormulas', 'switchSheet', 'nextSheet', 'prevSheet',
    'selectAll', 'selectColumn', 'selectRow', 'insertDate', 'insertTime', 'insertDateTime', 'fillDown', 'fillRight',
    'print', 'download', 'openCloud', 'share', 'login', 'cellHistory', 'shortcuts', 'about', 'functionList', 'columnStats',
    // barra de ferramentas liberada para os setores
    'menuSearch', 'paintFormat', 'format', 'customFormat', 'fmt_number', 'fmt_time', 'fmt_date', 'fmt_currency', 'fmt_percent', 'fmt_scientific',
    'decDec', 'decInc', 'fontFamily', 'fontSize', 'fontSizeInc', 'fontSizeDec', 'bold', 'italic', 'strike', 'textColor', 'fillColor',
    // visualizações de filtro (pessoais, não mudam a planilha dos outros)
    'createFilterView', 'createGroupedView', 'closeFilterView', 'clearViewFilters']);
  const COL_CMDS = new Set(['renameCol', 'insertColsLeft', 'insertColsRight', 'deleteCols', 'hideCols', 'unhideCols', 'resizeCols', 'autofitCols', 'addCols']);
  const EXEC_HIDDEN_MENUS = new Set(['Inserir', 'Formatar', 'Dados', 'Extensões']);
  App.adminOnly = () => !!(App.cloudMode && cloud.perms && !cloud.perms.admin);
  App.valuesOnly = App.adminOnly;
  function filterItems(list) {
    const out = [];
    for (const x of list || []) {
      if (x === '-' || !x || x.header) { out.push(x); continue; }
      const id = x.cmd || x.need;
      if (id && !EXEC_OK.has(id)) continue;
      if (x.sub) {
        const fn = typeof x.sub === 'function' ? x.sub : null;
        const sub = filterItems(fn ? fn() : x.sub);
        if (!sub.some((y) => y && y !== '-' && !y.header)) continue;
        out.push(Object.assign({}, x, { sub: fn ? () => filterItems(fn()) : sub }));
        continue;
      }
      out.push(x);
    }
    // remove separadores sobrando
    const clean = [];
    for (const x of out) { if (x === '-' && (!clean.length || clean[clean.length - 1] === '-')) continue; clean.push(x); }
    while (clean.length && clean[clean.length - 1] === '-') clean.pop();
    return clean;
  }
  App.menuFilter = (items) => (App.adminOnly() ? filterItems(items) : items);
  // bloqueia os comandos (atalhos de teclado inclusive) que só administradores podem usar
  function lockCommands() {
    for (const id in App.cmds) {
      const c = App.cmds[id];
      if (c._locked || EXEC_OK.has(id)) continue;
      const run = c.run;
      c.run = (...args) => {
        if (App.adminOnly()) return notify(COL_CMDS.has(id) ? Perms.COLS_MSG : 'Somente administradores podem usar esta opção. Você pode preencher os valores das colunas liberadas.');
        return run(...args);
      };
      c._locked = true;
    }
  }
  // esconde menus, botões e barras que a pessoa não pode usar
  function refreshChrome() {
    const ex = App.adminOnly();
    document.body.classList.toggle('executor', ex);
    const t = $('doc-title');
    if (t) { t.readOnly = ex; t.tabIndex = ex ? -1 : 0; }
    document.querySelectorAll('#menubar .mb').forEach((b) => {
      let vis = true;
      const menu = App.MENUS[+b.dataset.i];
      if (ex && EXEC_HIDDEN_MENUS.has(menu.label)) vis = false;
      else if (ex) { try { vis = filterItems(menu.items()).some((x) => x && x !== '-' && !x.header && !x.disabled); } catch (e) { vis = true; } }
      b.hidden = !vis;
    });
  }
  App.on('contextItems', ({ hit, items }) => {
    if (hit.area === 'cell' || hit.area === 'fill') {
      const at = items.findIndex((x) => x && x.label === 'Ver mais ações da célula');
      items.splice(at >= 0 ? at : items.length, 0, { label: 'Mostrar histórico de edições', icon: 'history', cmd: 'cellHistory' });
    }
    if ((hit.area === 'colHdr' || hit.area === 'colEdge') && App.cloudMode && cloud.perms && cloud.perms.admin) {
      items.push('-', { label: 'Nome e permissões da coluna', icon: 'lock', cmd: 'columnAccess' });
    }
  });

  // ---------- Proteger páginas e intervalos ----------
  function protectRanges() {
    if (!App.cloudMode) { App.ui.modal({ title: 'Proteger intervalos', width: '460px', body: '<p class="modal-text">A proteção de intervalos vale para planilhas na nuvem, compartilhadas com setores. Salve esta planilha na nuvem para usar este recurso.</p>', buttons: [{ label: 'Fechar' }, ...(canCreate() ? [{ label: 'Salvar na nuvem', primary: true, action: () => { saveToCloud(true); } }] : [])] }); return; }
    if (!cloud.perms.admin) return notify('Somente administradores podem proteger intervalos.');
    const sh = App.sheet();
    api('GET', `/api/docs/${cloud.id}/share`).then((st) => {
      const list = JSON.parse(JSON.stringify(sh.protected || []));
      const sectors = st.acl.sectors;
      const m = App.ui.modal({
        title: `Intervalos protegidos em "${sh.name}"`, width: '600px',
        body: `<p class="sp-hint">Somente administradores e os setores marcados podem editar as células protegidas. As demais pessoas continuam vendo os dados.</p><div id="pr-list"></div>
          <div class="pr-form"><p class="sp-label">Novo intervalo protegido</p>
            <div class="field-row"><label class="field"><span>Intervalo</span><input class="input" id="pr-range" value="${esc(App.rangeText(App.selRect()))}"></label><label class="field"><span>Descrição (opcional)</span><input class="input" id="pr-desc" placeholder="Ex.: Metas do mês"></label></div>
            <p class="sp-label">Setores que podem editar</p>
            <div class="pr-sectors">${sectors.map((s) => `<label class="check"><input type="checkbox" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join('') || '<span class="sp-hint">Nenhum setor criado: só administradores poderão editar.</span>'}</div>
            <button class="btn" id="pr-add">${icon('plus', 16)} Proteger intervalo</button></div>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => { App.change('Proteger intervalos', () => { sh.protected = list; }); notify('Proteções salvas.'); } }],
      });
      const d = m.el;
      const renderList = () => {
        d.querySelector('#pr-list').innerHTML = list.length ? list.map((p, i) => `<div class="cf-item"><span class="cf-chip">${icon('lock', 16)}</span><div><b>${esc(App.rangeText(p.range))}${p.desc ? ' · ' + esc(p.desc) : ''}</b><small>Podem editar: administradores${p.sectors.length ? ', ' + p.sectors.map((id) => esc((sectors.find((s) => s.id === id) || { name: '?' }).name)).join(', ') : ''}</small></div><button class="icon-btn" data-prm="${i}" title="Remover proteção">${icon('close', 16)}</button></div>`).join('') : '<p class="sp-hint">Nenhum intervalo protegido nesta página.</p>';
        d.querySelectorAll('[data-prm]').forEach((b) => (b.onclick = () => { list.splice(+b.dataset.prm, 1); renderList(); }));
      };
      renderList();
      d.querySelector('#pr-add').onclick = () => {
        const p = App.parseRange(d.querySelector('#pr-range').value);
        if (!p || p.si !== doc.active) return notify('Intervalo inválido. Use algo como A1:D20.');
        list.push({ id: Math.random().toString(36).slice(2, 8), range: p.R, desc: d.querySelector('#pr-desc').value.trim(), sectors: [...d.querySelectorAll('.pr-sectors input:checked')].map((x) => x.value) });
        d.querySelector('#pr-desc').value = '';
        renderList();
      };
    }).catch((e) => notify(e.message));
  }

  // ---------- Menus ----------
  const fileMenu = App.MENUS.find((x) => x.label === 'Arquivo');
  const origFile = fileMenu.items;
  fileMenu.items = () => {
    const list = origFile();
    const at = list.findIndex((x) => x && x.cmd === 'importFile');
    const extra = [{ label: 'Planilhas na nuvem', icon: 'cloud', cmd: 'openCloud' }];
    // criar e salvar planilhas na nuvem: só administradores
    if (canCreate()) extra.push({ label: App.cloudMode ? 'Esta planilha está na nuvem' : 'Salvar na nuvem', icon: 'cloud', cmd: 'saveToCloud', disabled: !!App.cloudMode });
    list.splice(at + 1, 0, ...extra);
    return list;
  };
  const dataMenu = App.MENUS.find((x) => x.label === 'Dados');
  const origData = dataMenu.items;
  dataMenu.items = () => {
    const list = origData();
    const at = list.findIndex((x) => x && x.cmd === 'namedRanges');
    list.splice(at + 1, 0, { label: 'Proteger páginas e intervalos', icon: 'lock', cmd: 'protectRanges' }, { label: 'Permissões por coluna', icon: 'lock', cmd: 'columnAccess' });
    return list;
  };

  def('openCloud', 'Planilhas na nuvem', openCloudDialog);
  def('saveToCloud', 'Salvar na nuvem', () => saveToCloud(false));
  def('protectRanges', 'Proteger páginas e intervalos', protectRanges);
  def('share', 'Compartilhar', () => { if (!App.cloudMode) shareLocal(); else if (cloud.perms && cloud.perms.admin) shareDialog(); else shareInfo(); });
  def('login', 'Entrar', () => loginDialog());
  def('columnAccess', 'Permissões por coluna', columnAccessDialog);
  def('cellHistory', 'Mostrar histórico de edições', cellHistory);

  function init() {
    lockCommands();
    refreshChrome();
    $('btn-account').addEventListener('click', (e) => accountMenu(e.currentTarget));
    renderAccount();
    loadMe();
    const m = /#nuvem=([\w-]+)/.exec(location.hash);
    if (m) openCloudDoc(m[1]);
    window.addEventListener('hashchange', () => {
      const h = /#nuvem=([\w-]+)/.exec(location.hash);
      if (h && h[1] !== cloud.id) openCloudDoc(h[1]);
    });
  }
  App.collab = { init, openCloudDoc, saveToCloud, loginDialog, api, leaveCloud };
})(window.App);
