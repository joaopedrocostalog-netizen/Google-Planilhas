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
    App.cloudMode = false; App.validatePatch = null; App.editGuard = null;
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
    App.validatePatch = (p) => Perms.validate(p, cloud.perms, doc);
    App.editGuard = (sh, r, c) => {
      const lv = Perms.levelOf(cloud.perms, sh.id);
      if (lv !== 'edit') return lv === 'view' ? `Você só pode visualizar a página "${sh.name}".` : 'Você não tem acesso a esta página.';
      const pr = Perms.blockingProtection(cloud.perms, sh, App.E.addrToStr(r, c));
      return pr ? `Esta célula está protegida${pr.desc ? ' (' + pr.desc + ')' : ''}. Peça acesso a um administrador.` : null;
    };
    App.emit('sheet');
    App.emit('change', { remote: true });
    App.emit('title');
    setStatus(cloud.pending.size ? 'saving' : 'online');
    renderPeers(); renderChip(); sendPresence();
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
    App.grid.setPeers(list.filter((p) => p.presence && p.presence.sel).map((p) => ({ name: (p.name || '').split(' ')[0], color: p.color, sheetId: p.presence.sheetId, sel: p.presence.sel, editing: p.presence.editing })));
  }
  const roleLabel = (r) => ({ admin: 'administrador', editor: 'editor', viewer: 'leitor' }[r] || r);
  function renderChip() {
    const chip = $('cloud-chip');
    if (!chip) return;
    if (!App.cloudMode || !cloud.perms) { chip.hidden = true; return; }
    const lv = Perms.levelOf(cloud.perms, App.sheet().id);
    chip.hidden = false;
    chip.className = 'cloud-chip' + (lv !== 'edit' ? ' readonly' : '');
    chip.textContent = lv !== 'edit' ? 'Somente visualização' : cloud.perms.sectorName ? 'Setor ' + cloud.perms.sectorName : roleLabel(cloud.perms.role)[0].toUpperCase() + roleLabel(cloud.perms.role).slice(1);
    chip.title = cloud.perms.admin ? 'Você é administrador desta planilha.' : `Seu acesso: ${roleLabel(cloud.perms.role)}${cloud.perms.sectorName ? ', setor ' + cloud.perms.sectorName : ''}.`;
  }
  App.on('sheet', renderChip);

  // ---------- Planilhas na nuvem ----------
  async function openCloudDialog() {
    if (!(await ensureLogin('Entre com a sua conta para ver as planilhas na nuvem.'))) return;
    const m = App.ui.modal({
      title: 'Planilhas na nuvem', width: '760px', cls: 'modal-tall',
      body: `<div class="cloud-actions"><button class="btn btn-primary" id="cl-new">${icon('plus', 16)} Nova planilha na nuvem</button><button class="btn" id="cl-upload">${icon('cloud', 16)} Enviar a planilha atual</button></div>
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
        : '<p class="sp-hint">Nenhuma planilha na nuvem ainda. Crie uma nova ou envie a planilha atual.</p>';
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
    d.querySelector('#cl-new').onclick = async () => {
      try { const r = await api('POST', '/api/docs', { title: 'Planilha sem título' }); m.close(); await openCloudDoc(r.id); }
      catch (e) { notify(e.message); }
    };
    d.querySelector('#cl-upload').onclick = () => { m.close(); saveToCloud(); };
  }
  async function saveToCloud(thenShare) {
    if (App.cloudMode) { notify('Esta planilha já está na nuvem.'); return; }
    if (!(await ensureLogin('Entre com a sua conta para salvar esta planilha na nuvem.'))) return;
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
    const rows = doc.sheets.map((s) => `<tr><td>${esc(s.name)}</td><td>${Perms.levelOf(p, s.id) === 'edit' ? 'Pode editar' : 'Somente visualizar'}</td></tr>`).join('');
    App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '480px',
      body: `<p class="modal-text">Seu acesso: <b>${esc(roleLabel(p.role))}</b>${p.sectorName ? ` · setor <b>${esc(p.sectorName)}</b>` : ''}. Somente administradores podem convidar pessoas e mudar permissões.</p>
        <table class="cs-table share-perm-table">${rows}</table>
        <label class="field"><span>Link da planilha</span><input class="input" readonly value="${esc(docLink(cloud.id))}"></label>`,
      buttons: [{ label: 'Copiar link', action: () => { navigator.clipboard.writeText(docLink(cloud.id)).then(() => notify('Link copiado.')); return false; } }, { label: 'Fechar', primary: true }],
    });
  }
  async function shareDialog() {
    let st;
    try { st = await api('GET', `/api/docs/${cloud.id}/share`); }
    catch (e) { notify(e.message); return; }
    const acl = JSON.parse(JSON.stringify(st.acl));
    const newId = () => Math.random().toString(36).slice(2, 8);
    const m = App.ui.modal({
      title: `Compartilhar "${doc.title}"`, width: '780px', cls: 'modal-tall share-modal', enterSubmits: false,
      body: `<div class="sp-tabs share-tabs"><button class="on" data-t="people">Pessoas</button><button data-t="sectors">Setores e permissões</button><button data-t="link">Acesso pelo link</button></div>
        <div class="share-pane" data-pane="people"></div><div class="share-pane" data-pane="sectors" hidden></div><div class="share-pane" data-pane="link" hidden></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => {
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
    function renderPeople() {
      const pane = d.querySelector('[data-pane="people"]');
      pane.innerHTML = `<div class="share-add"><input class="input" id="sh-email" type="email" placeholder="E-mail da pessoa"><select class="input" id="sh-role">${opts(ROLES, 'editor')}</select><select class="input" id="sh-sector">${sectorOpts(null)}</select><button class="btn btn-primary" id="sh-add">Adicionar</button></div>
        <p class="sp-hint">A pessoa precisa entrar com este e-mail. Se ainda não tiver conta, o acesso fica reservado até ela se cadastrar.</p>
        <div class="share-list">
          ${st.owner ? `<div class="share-row"><span class="avatar" style="background:${st.owner.color}">${esc(st.owner.name[0].toUpperCase())}</span><div class="sr-who"><b>${esc(st.owner.name)}</b><small>${esc(st.owner.email)}</small></div><span class="sr-fixed">Dono</span></div>` : ''}
          ${acl.members.map((mb, i) => `<div class="share-row"><span class="avatar" style="background:${mb.registered === false ? '#9a9a9a' : '#5f6368'}">${esc((mb.name || mb.email)[0].toUpperCase())}</span>
            <div class="sr-who"><b>${esc(mb.name || mb.email)}</b><small>${esc(mb.email)}${mb.registered === false ? ' · aguardando cadastro' : ''}${st.online.includes(mb.email) ? ' · <span class="online">online</span>' : ''}</small></div>
            <select class="input" data-role="${i}">${opts(ROLES, mb.role)}</select><select class="input" data-sector="${i}"${mb.role === 'admin' ? ' disabled' : ''}>${sectorOpts(mb.sector)}</select>
            <button class="icon-btn" data-rm="${i}" title="Remover acesso">${icon('close', 16)}</button></div>`).join('')}
        </div>`;
      pane.querySelector('#sh-add').onclick = () => {
        const email = pane.querySelector('#sh-email').value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify('Informe um e-mail válido.');
        if (acl.members.some((x) => x.email === email) || (st.owner && st.owner.email === email)) return notify('Esta pessoa já tem acesso.');
        acl.members.push({ email, role: pane.querySelector('#sh-role').value, sector: pane.querySelector('#sh-sector').value || null, name: null });
        renderPeople();
      };
      pane.querySelector('#sh-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pane.querySelector('#sh-add').click(); } });
      pane.querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => { acl.members[+s.dataset.role].role = s.value; renderPeople(); }));
      pane.querySelectorAll('[data-sector]').forEach((s) => (s.onchange = () => { acl.members[+s.dataset.sector].sector = s.value || null; }));
      pane.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { acl.members.splice(+b.dataset.rm, 1); renderPeople(); }));
    }
    function renderSectors() {
      const pane = d.querySelector('[data-pane="sectors"]');
      pane.innerHTML = `<p class="sp-hint">Crie setores (por exemplo, Comercial ou Financeiro) e defina o que cada um pode ver e editar em cada página. Administradores sempre veem e editam tudo; leitores nunca editam.</p>
        ${acl.sectors.map((s, i) => `<div class="sector-card">
          <div class="sector-head"><input class="input" data-sname="${i}" value="${esc(s.name)}" placeholder="Nome do setor"><button class="icon-btn" data-srm="${i}" title="Excluir setor">${icon('close', 16)}</button></div>
          <div class="sector-row"><label class="field"><span>Acesso padrão às páginas</span><select class="input" data-sdef="${i}">${opts(LEVELS, s.default)}</select></label>
          <label class="check"><input type="checkbox" data-smanage="${i}"${s.manage ? ' checked' : ''}> Pode criar, excluir e renomear páginas</label></div>
          <table class="sector-matrix"><thead><tr><th>Página</th><th>Acesso</th></tr></thead><tbody>
          ${st.sheets.map((sh) => `<tr><td>${esc(sh.name)}</td><td><select class="input" data-sheet="${i}:${esc(sh.id)}"><option value="">Padrão (${LEVELS.find((l) => l[0] === s.default)[1]})</option>${opts(LEVELS, s.sheets[sh.id])}</select></td></tr>`).join('')}
          </tbody></table></div>`).join('') || '<p class="sp-hint">Nenhum setor criado.</p>'}
        <button class="btn" id="sec-add">${icon('plus', 16)} Adicionar setor</button>`;
      pane.querySelector('#sec-add').onclick = () => { acl.sectors.push({ id: newId(), name: 'Novo setor', default: 'view', sheets: {}, manage: false }); renderSectors(); const ins = pane.querySelectorAll('[data-sname]'); ins[ins.length - 1].select(); };
      pane.querySelectorAll('[data-sname]').forEach((x) => (x.oninput = () => { acl.sectors[+x.dataset.sname].name = x.value; }));
      pane.querySelectorAll('[data-sdef]').forEach((x) => (x.onchange = () => { acl.sectors[+x.dataset.sdef].default = x.value; renderSectors(); }));
      pane.querySelectorAll('[data-smanage]').forEach((x) => (x.onchange = () => { acl.sectors[+x.dataset.smanage].manage = x.checked; }));
      pane.querySelectorAll('[data-sheet]').forEach((x) => (x.onchange = () => {
        const [i, id] = x.dataset.sheet.split(':');
        if (x.value) acl.sectors[+i].sheets[id] = x.value; else delete acl.sectors[+i].sheets[id];
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
    function render() { renderPeople(); renderSectors(); renderLink(); }
    render();
  }

  // ---------- Proteger páginas e intervalos ----------
  function protectRanges() {
    if (!App.cloudMode) { App.ui.modal({ title: 'Proteger intervalos', width: '460px', body: '<p class="modal-text">A proteção de intervalos vale para planilhas na nuvem, compartilhadas com setores. Salve esta planilha na nuvem para usar este recurso.</p>', buttons: [{ label: 'Fechar' }, { label: 'Salvar na nuvem', primary: true, action: () => { saveToCloud(true); } }] }); return; }
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
    list.splice(at + 1, 0, { label: 'Planilhas na nuvem', icon: 'cloud', cmd: 'openCloud' }, { label: App.cloudMode ? 'Esta planilha está na nuvem' : 'Salvar na nuvem', icon: 'cloud', cmd: 'saveToCloud', disabled: !!App.cloudMode });
    return list;
  };
  const dataMenu = App.MENUS.find((x) => x.label === 'Dados');
  const origData = dataMenu.items;
  dataMenu.items = () => {
    const list = origData();
    const at = list.findIndex((x) => x && x.cmd === 'namedRanges');
    list.splice(at + 1, 0, { label: 'Proteger páginas e intervalos', icon: 'lock', cmd: 'protectRanges' });
    return list;
  };

  def('openCloud', 'Planilhas na nuvem', openCloudDialog);
  def('saveToCloud', 'Salvar na nuvem', () => saveToCloud(false));
  def('protectRanges', 'Proteger páginas e intervalos', protectRanges);
  def('share', 'Compartilhar', () => { if (!App.cloudMode) shareLocal(); else if (cloud.perms && cloud.perms.admin) shareDialog(); else shareInfo(); });
  def('login', 'Entrar', () => loginDialog());

  function init() {
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
