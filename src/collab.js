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
  // foto do perfil (ou a inicial na cor da pessoa)
  App.apiBase = API;
  App.avatarUrl = (u) => (u && u.avatar && u.id ? `${API}/api/avatar/${encodeURIComponent(u.id)}?v=${encodeURIComponent(u.avatar)}` : null);
  App.avatarInner = (u) => { const url = App.avatarUrl(u); return url ? `<img class="av-img" src="${esc(url)}" alt="" loading="lazy" draggable="false">` : esc(String((u && u.name) || '?').trim()[0] || '?').toUpperCase(); };
  App.avatarHtml = (u, size, cls) => `<span class="avatar${cls ? ' ' + cls : ''}${App.avatarUrl(u) ? ' has-img' : ''}" style="background:${esc((u && u.color) || '#5f6368')}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px` : ''}">${App.avatarInner(u)}</span>`;

  // ---------- Conta ----------
  function setToken(t, user) {
    cloud.token = t; cloud.user = user;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignora */ }
    renderAccount();
    if (t && user) setTimeout(() => { if (App.checkGate) App.checkGate(); }, 0);
  }
  async function loadMe() {
    if (!cloud.token) { renderAccount(); return null; }
    try { cloud.user = await api('GET', '/api/me'); cloud.offline = false; }
    catch (e) { if (e.status === 401) setToken(null, null); else cloud.offline = true; }
    renderAccount();
    return cloud.user;
  }

  // ---------- Acesso: login obrigatório; quem não é administrador só entra nas planilhas liberadas ----------
  let gateEl = null, gateTimer = null;
  function gate(kind, docs) {
    if (!gateEl) { gateEl = document.createElement('div'); gateEl.className = 'gate'; document.body.appendChild(gateEl); }
    clearTimeout(gateTimer);
    if (!kind) { gateEl.hidden = true; document.body.classList.remove('gated'); return; }
    gateEl.hidden = false;
    document.body.classList.add('gated');
    const logo = (document.querySelector('.app-logo') || {}).innerHTML || '';
    const fmt = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    let html;
    if (kind === 'login') html = `<h1>Planilhas</h1><p>Entre com a sua conta para acessar as planilhas da empresa.</p><button class="btn btn-primary" data-g="login">Entrar ou criar conta</button>`;
    else if (kind === 'connecting') html = `<h1>Planilhas</h1><p>Conectando ao servidor… Na primeira vez do dia ele pode levar até 1 minuto para acordar.</p>`;
    else if (docs && docs.length) html = `<h1>Olá, ${esc(cloud.user.name)}</h1><p>Escolha a planilha:</p><div class="gate-list">${docs.map((d) => `<button class="od-item" data-open="${esc(d.id)}">${icon('sheetIcon', 24)}<div><b>${esc(d.title)}</b><small>${esc(d.owner ? 'De ' + d.owner : '')} · modificada em ${fmt(d.updated)}</small></div></button>`).join('')}</div><button class="btn" data-g="logout">Sair</button>`;
    else html = `<h1>Olá, ${esc(cloud.user.name)}</h1><p>Sua conta foi criada. <b>Aguarde um administrador liberar o seu acesso</b> a uma planilha.</p><p class="sp-hint">Conta: ${esc(cloud.user.email)}</p><div class="gate-actions"><button class="btn btn-primary" data-g="check">Verificar novamente</button><button class="btn" data-g="logout">Sair</button></div>`;
    gateEl.innerHTML = `<div class="gate-card"><div class="gate-logo">${logo}</div>${html}</div>`;
    gateEl.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => {
      if (b.dataset.g === 'login') loginDialog().then(() => checkGate());
      if (b.dataset.g === 'check') checkGate();
      if (b.dataset.g === 'logout') logout();
    }));
    gateEl.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { gate(null); openCloudDoc(b.dataset.open); }));
    if (kind === 'connecting') gateTimer = setTimeout(checkGate, 5000);
    if (kind === 'wait' && !(docs && docs.length)) gateTimer = setTimeout(checkGate, 30000);
  }
  async function checkGate() {
    if (!cloud.user) {
      if (cloud.token) await loadMe();
      if (!cloud.user) return gate(cloud.token && cloud.offline ? 'connecting' : 'login');
    }
    if (cloud.user.admin || App.cloudMode || cloud.id) return gate(null);
    let docs = [];
    try { docs = await api('GET', '/api/docs'); } catch (e) { return gate('connecting'); }
    if (App.cloudMode || cloud.id) return gate(null);
    if (docs.length === 1 && !cloud.autoOpened) { cloud.autoOpened = true; gate(null); openCloudDoc(docs[0].id); return; }
    gate('wait', docs);
  }
  App.checkGate = checkGate;
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
      b.innerHTML = App.avatarInner(cloud.user);
      b.classList.toggle('has-img', !!cloud.user.avatar);
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
      { label: 'Foto, nome e senha', action: profileDialog },
      { label: 'Minha cor', action: colorDialog }, '-',
      { label: 'Sair', action: logout },
    ], { right: true });
  }
  // reduz e recorta a foto (quadrada, 160 px) antes de enviar
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const size = 160, k = Math.min(img.width, img.height);
        const cv = document.createElement('canvas'); cv.width = cv.height = size;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem. Use uma foto JPG ou PNG.')); };
      img.src = url;
    });
  }
  function profileDialog() {
    let photo; // undefined = sem mudança, null = remover, texto = nova foto
    const m = App.ui.modal({
      title: 'Sua conta', width: '420px',
      body: `<div class="pf-photo"><span id="pf-av">${App.avatarHtml(cloud.user, 72)}</span><div><b>Foto do perfil</b><small>Aparece para as outras pessoas na planilha, no chat e no histórico.</small>
          <div class="pf-photo-btns"><label class="btn btn-sm">Escolher foto<input type="file" id="pf-file" accept="image/*" hidden></label><button class="btn btn-sm" id="pf-rm"${cloud.user.avatar ? '' : ' hidden'}>Remover</button></div></div></div>
        <label class="field"><span>Nome</span><input class="input" id="pf-name" value="${esc(cloud.user.name)}"></label>
        <p class="sp-label">Trocar senha (opcional)</p>
        <label class="field"><span>Senha atual</span><input class="input" id="pf-cur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>Nova senha</span><input class="input" id="pf-new" type="password" autocomplete="new-password"></label>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: (d) => {
        const body = { name: d.querySelector('#pf-name').value };
        if (d.querySelector('#pf-new').value) { body.password = d.querySelector('#pf-new').value; body.current = d.querySelector('#pf-cur').value; }
        (async () => {
          try {
            if (photo !== undefined) { const r = await api('PUT', '/api/me/avatar', { data: photo }); cloud.user.avatar = r.avatar; }
            const u = await api('PUT', '/api/me', body);
            cloud.user = Object.assign(cloud.user, u); renderAccount(); notify('Conta atualizada.');
          } catch (e) { notify(e.message); }
        })();
      } }],
    });
    const el = m.el;
    const preview = (u) => { el.querySelector('#pf-av').innerHTML = App.avatarHtml(u, 72); };
    el.querySelector('#pf-file').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        photo = await shrinkPhoto(f);
        el.querySelector('#pf-av').innerHTML = `<span class="avatar has-img" style="width:72px;height:72px"><img class="av-img" src="${photo}" alt=""></span>`;
        el.querySelector('#pf-rm').hidden = false;
      } catch (er) { notify(er.message); }
    };
    el.querySelector('#pf-rm').onclick = (e) => { e.preventDefault(); photo = null; preview(Object.assign({}, cloud.user, { avatar: null })); e.currentTarget.hidden = true; };
  }
  // cada pessoa tem uma cor só dela; aqui ela pode escolher outra que ninguém esteja usando
  async function colorDialog() {
    let info;
    try { info = await api('GET', '/api/me/color'); } catch (e) { return notify(e.message); }
    const taken = new Set(info.taken);
    let chosen = info.color;
    const m = App.ui.modal({
      title: 'Minha cor', width: '420px',
      body: `<p class="sp-hint">É a cor do seu cursor e do seu nome para as outras pessoas na planilha. Cada pessoa tem uma cor diferente; as cores riscadas já são de alguém.</p>
        <div class="mycolor-grid">${info.palette.map((c) => `<button class="mycolor${c === chosen ? ' on' : ''}${taken.has(c) ? ' taken' : ''}" data-c="${c}" style="background:${c}" title="${taken.has(c) ? 'Já é de outra pessoa' : c}"${taken.has(c) ? ' disabled' : ''}></button>`).join('')}</div>
        <label class="field mycolor-custom"><span>Outra cor</span><input type="color" id="mc-custom" value="${chosen}"></label>
        <div class="mycolor-prev"><span class="avatar" id="mc-prev" style="background:${chosen}">${esc((cloud.user.name || '?').trim()[0].toUpperCase())}</span> <b>${esc(cloud.user.name)}</b></div>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => {
        api('PUT', '/api/me/color', { color: chosen }).then((r) => { cloud.user.color = r.color; renderAccount(); notify('Sua cor foi atualizada.'); }).catch((e) => notify(e.message));
      } }],
    });
    const set = (c) => { chosen = c; m.el.querySelector('#mc-prev').style.background = c; m.el.querySelectorAll('.mycolor').forEach((b) => b.classList.toggle('on', b.dataset.c === c)); };
    m.el.querySelectorAll('.mycolor:not([disabled])').forEach((b) => (b.onclick = () => set(b.dataset.c)));
    m.el.querySelector('#mc-custom').oninput = (e) => {
      const c = e.target.value.toLowerCase();
      if (taken.has(c)) return notify('Essa cor já é de outra pessoa. Escolha outra.');
      set(c);
    };
  }
  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) { /* ignora */ }
    if (App.cloudMode) { leaveCloud(); App.newDocument(); }
    setToken(null, null);
    notify('Você saiu da sua conta.');
    gate('login');
  }

  // ---------- Preferências salvas na conta (cores personalizadas, visualizações) ----------
  const localColors = App.customColors, localSaveColors = App.saveCustomColors;
  App.customColors = () => (cloud.user && cloud.user.prefs && Array.isArray(cloud.user.prefs.colors) ? cloud.user.prefs.colors : localColors());
  App.saveCustomColors = (list) => {
    localSaveColors(list);
    if (!cloud.user) return;
    cloud.user.prefs = Object.assign({}, cloud.user.prefs, { colors: list });
    api('PUT', '/api/me/prefs', { colors: list }).catch(() => { /* fica salvo neste navegador */ });
  };
  App.savePrefs = (patch) => {
    if (!cloud.user) return Promise.resolve();
    cloud.user.prefs = Object.assign({}, cloud.user.prefs, patch);
    return api('PUT', '/api/me/prefs', patch).catch(() => {});
  };
  App.userPrefs = () => (cloud.user && cloud.user.prefs) || {};

  // ---------- DSS: motoristas (sugestões ao digitar e CPF/CNPJ automático) ----------
  const drv = { list: null, at: 0, loading: false, warned: false };
  App.lookupList = (lk, onReady) => {
    if (drv.list && Date.now() - drv.at < 10 * 60e3) return drv.list;
    if (!drv.loading && cloud.token) {
      drv.loading = true;
      api('GET', '/api/dss/motoristas').then((r) => {
        drv.list = r.motoristas || []; drv.at = Date.now(); drv.loading = false;
        if (onReady) onReady();
      }).catch((e) => {
        drv.loading = false; drv.list = drv.list || []; drv.at = Date.now() - 9 * 60e3; // tenta de novo em 1 minuto
        if (!drv.warned) { drv.warned = true; notify('Motoristas do DSS indisponíveis: ' + e.message); }
      });
    }
    return drv.list;
  };
  App.lookupMatch = (sh, r, c, text, isReal) => {
    const lk = sh && sh.lookup;
    if (!lk || !drv.list) return null;
    const real = isReal ? { r, c } : App.realCell ? App.realCell(r, c) : { r, c };
    if (real.c !== lk.col) return null;
    const t = String(text).trim().toUpperCase();
    return drv.list.find((d) => d.nome.toUpperCase() === t) || null;
  };
  function dssLookupDialog() {
    const sh = App.sheet();
    const cur = sh.lookup || { col: 25, cpfCol: 64 };
    const colOpts = (sel) => { let o = ''; for (let c = 1; c <= Math.max(sh.cols, 64); c++) { const n = sh.colNames && sh.colNames[c]; o += `<option value="${c}"${c === sel ? ' selected' : ''}>${Perms.colName(c)}${n ? ' · ' + esc(n) : ''}</option>`; } return o; };
    const m = App.ui.modal({
      title: 'Motoristas do DSS', width: '480px',
      body: `<p class="sp-hint">Ao digitar na coluna do motorista aparecem os nomes cadastrados no DSS. Escolhendo um nome, o CPF/CNPJ é preenchido automaticamente.</p>
        <div class="field-row"><label class="field"><span>Coluna do nome do motorista</span><select class="input" id="dl-col">${colOpts(cur.col)}</select></label>
        <label class="field"><span>Coluna do CPF/CNPJ</span><select class="input" id="dl-cpf">${colOpts(cur.cpfCol)}</select></label></div>
        <p class="sp-hint" id="dl-status">Verificando a conexão com o DSS…</p>`,
      buttons: [
        ...(sh.lookup ? [{ label: 'Desativar', action: () => { App.change('Motoristas do DSS', () => { delete sh.lookup; }); } }] : []),
        { label: 'Cancelar' },
        { label: 'Salvar', primary: true, action: (d) => {
          const col = +d.querySelector('#dl-col').value, cpfCol = +d.querySelector('#dl-cpf').value;
          if (col === cpfCol) { notify('Escolha colunas diferentes para o nome e o CPF/CNPJ.'); return false; }
          App.change('Motoristas do DSS', () => { sh.lookup = { source: 'dss_motoristas', col, cpfCol }; });
          notify('Motoristas do DSS ativados nesta página.');
        } },
      ],
    });
    api('GET', '/api/dss/motoristas?atualizar=1').then((r) => {
      drv.list = r.motoristas || []; drv.at = Date.now();
      const el = m.el.querySelector('#dl-status');
      if (el) el.textContent = `Conectado ao DSS: ${drv.list.length} motoristas disponíveis.` + (r.aviso ? ' Aviso: ' + r.aviso : '');
    }).catch((e) => { const el = m.el.querySelector('#dl-status'); if (el) { el.textContent = e.message; el.classList.add('auth-err'); } });
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
    setTimeout(checkGate, 0);
    renderChip();
  }
  function handle(m) {
    switch (m.type) {
      case 'init': onInit(m); break;
      case 'ack': cloud.pending.delete(m.id); if (!cloud.pending.size) setStatus('online'); break;
      case 'patch': App.applyRemote(m.patch); break;
      case 'reject': cloud.pending.delete(m.id); notify(m.reason); break;
      case 'join': {
        // a mesma pessoa abrindo outra aba (ou reconectando) não é anunciada de novo
        const known = [...cloud.peers.values()].some((x) => x.uid === m.peer.uid);
        m.peer._at = Date.now(); cloud.peers.set(m.peer.cid, m.peer); renderPeers();
        if (!known) notify(`${m.peer.name} entrou na planilha.`);
        break;
      }
      case 'presence': m.peer._at = Date.now(); cloud.peers.set(m.peer.cid, m.peer); renderPeers(); break;
      case 'leave': cloud.peers.delete(m.cid); renderPeers(); break;
      case 'dm': App.emit('dm', m.msg); break;
      case 'dmRead': App.emit('dmRead', m); break;
      case 'dmDone': App.emit('dmDone', m); break;
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
    if (!doc.sheets.some((s) => !s.shadow)) {
      // nenhuma página liberada para este setor
      const ph = App.newSheet('Sem acesso');
      ph.id = '__sem_acesso__';
      ph.cells.A1 = { v: 'Você ainda não tem acesso a nenhuma página desta planilha. Peça acesso a um administrador.', s: { i: true, color: '#6b6b6b' } };
      doc.sheets = [ph].concat(doc.sheets);
      cloud.perms.sheets[ph.id] = 'view';
    }
    // abas de consulta (só valores, sem acesso) nunca ficam abertas
    let idx = activeId ? doc.sheets.findIndex((s) => s.id === activeId) : -1;
    if (idx < 0 || doc.sheets[idx].shadow || doc.sheets[idx].hidden) idx = doc.sheets.findIndex((s) => !s.shadow && !s.hidden);
    if (idx < 0) idx = doc.sheets.findIndex((s) => !s.shadow);
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
    cloud.realPerms = m.perms; cloud.simulating = null; renderSimBar();
    applyPermHooks();
    App.emit('sheet');
    App.emit('change', { remote: true });
    App.emit('title');
    setStatus(cloud.pending.size ? 'saving' : 'online');
    renderPeers(); renderChip(); sendPresence(); refreshChrome(); gate(null);
    if (first) notify(`Você entrou como ${m.me.name}${m.perms.sectorName ? ' · setor ' + m.perms.sectorName : ''} (${roleLabel(m.perms.role)}).`);
  }
  // Ganchos de permissão usados pela grade, pelo editor e pela validação das alterações
  function applyPermHooks() {
    App.validatePatch = (p, inv) => { const err = Perms.validate(p, cloud.perms, doc, inv); if (err) cloud.remask = true; return err; };
    // colunas ocultas por permissão somem da grade; as somente leitura ganham um cadeado no cabeçalho
    App.colBlocked = cloud.perms.admin ? null : (sh, c) => Perms.colLevel(cloud.perms, sh.id, c) === 'none';
    App.colReadonly = cloud.perms.admin ? null : (sh, c) => Perms.hasColRules(cloud.perms, sh.id) && Perms.colLevel(cloud.perms, sh.id, c) === 'view';
    App.colsLocked = () => !!(App.cloudMode && cloud.perms && !cloud.perms.admin);
    // r, c: posição na tela (com a visualização de filtro, pode ser diferente da posição real); isReal: já é a real
    App.editGuard = (sh, r, c, isReal) => {
      if (!isReal && App.realCell) { const p = App.realCell(r, c); if (!p) return 'Esta linha é o título de um grupo.'; r = p.r; c = p.c; }
      const lv = Perms.colLevel(cloud.perms, sh.id, c);
      if (lv !== 'edit') {
        if (lv === 'none') return 'Você não tem acesso a esta coluna.';
        return Perms.hasColRules(cloud.perms, sh.id) ? `Você só pode visualizar a coluna ${Perms.colName(c)} da página "${sh.name}".` : `Você só pode visualizar a página "${sh.name}".`;
      }
      const pr = Perms.blockingProtection(cloud.perms, sh, App.E.addrToStr(r, c));
      return pr ? `Esta célula está protegida${pr.desc ? ' (' + pr.desc + ')' : ''}. Peça acesso a um administrador.` : null;
    };
  }

  // ---------- Ver como (administrador): simula a tela de um setor, sem mudar permissões ----------
  async function viewAs(sectorId) {
    if (!cloud.realPerms || !cloud.realPerms.admin) return;
    if (!sectorId) {
      cloud.perms = cloud.realPerms; cloud.simulating = null;
    } else {
      let st;
      try { st = await api('GET', `/api/docs/${cloud.id}/share`); } catch (e) { return notify(e.message); }
      const sec = st.acl.sectors.find((s) => s.id === sectorId);
      if (!sec) return notify('Setor não encontrado.');
      const acl = Object.assign({}, st.acl, { members: [{ email: '__simulacao@planilhas', role: 'editor', sector: sectorId, rid: '__sim' }] });
      cloud.perms = Perms.compute({ ownerId: '__ninguem', acl, data: { sheets: doc.sheets } }, { id: '__sim', email: '__simulacao@planilhas' });
      cloud.simulating = { id: sectorId, name: sec.name };
    }
    applyPermHooks();
    App.invalidate();
    App.emit('sheet'); App.emit('change', { view: true });
    renderChip(); refreshChrome(); renderSimBar();
    notify(cloud.simulating ? `Vendo como o setor ${cloud.simulating.name}. Nada muda para as outras pessoas.` : 'De volta ao modo administrador.');
  }
  function renderSimBar() {
    let bar = $('sim-bar');
    if (!cloud.simulating) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'sim-bar'; bar.className = 'sim-bar';
      const vb = $('view-bar'); vb.parentNode.insertBefore(bar, vb);
    }
    bar.hidden = false;
    bar.innerHTML = `${icon('lock', 16)} <span>Você está vendo a planilha como o setor <b>${esc(cloud.simulating.name)}</b> (só na sua tela).</span><button class="btn btn-sm" id="sim-exit">Voltar ao modo administrador</button>`;
    bar.querySelector('#sim-exit').onclick = () => viewAs(null);
  }
  async function viewAsMenu(anchor) {
    if (!cloud.realPerms || !cloud.realPerms.admin) return;
    let st;
    try { st = await api('GET', `/api/docs/${cloud.id}/share`); } catch (e) { return notify(e.message); }
    App.ui.menuPopup(anchor, [
      { header: 'Ver a planilha como…' },
      { label: 'Administrador (tudo)', check: !cloud.simulating, action: () => viewAs(null) },
      ...(st.acl.sectors.length ? st.acl.sectors.map((s) => ({ label: 'Setor ' + s.name, check: cloud.simulating && cloud.simulating.id === s.id, action: () => viewAs(s.id) })) : [{ label: 'Crie setores em Compartilhar para simular', disabled: true }]),
    ], { right: true });
  }

  function onError(m) {
    // banco de dados fora do ar por um tempo (ou erro passageiro): avisa e continua tentando reconectar
    if (m.code === 'db' || m.code === 'server') { setStatus('offline'); notify(m.message); return; }
    cloud.closing = true;
    if (m.code === 'auth') {
      setToken(null, null);
      const id = cloud.id;
      loginDialog(m.message).then((u) => { if (u && id) openCloudDoc(id); });
      return;
    }
    const wasOpen = cloud.initialized;
    if (m.code === 'limit') {
      // limite de pessoas ao mesmo tempo: não fica tentando sozinho; a pessoa tenta de novo quando quiser
      const id = cloud.id;
      cloud.autoOpened = true; // sem isso, a tela abriria sozinha a mesma planilha de novo e mostraria outro aviso
      leaveCloud();
      if (wasOpen) App.newDocument();
      if (document.querySelector('dialog.mt-limit')) return;
      App.ui.modal({
        title: 'Limite de pessoas atingido', cls: 'mt-limit', width: '440px',
        body: `<p class="modal-text">${esc(m.message)}</p>`,
        buttons: [{ label: 'Fechar' }, { label: 'Tentar de novo', primary: true, action: () => { setTimeout(() => openCloudDoc(id), 0); } }],
      });
      return;
    }
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
      let R = App.selRect();
      // na visualização reordenada, envia a célula real (os outros veem a planilha na ordem normal)
      if (App.vm) { const p = App.realCell(App.sel.ar, App.sel.ac); if (!p) return; R = { r1: p.r, c1: p.c, r2: p.r, c2: p.c }; }
      send({ type: 'presence', sheetId: App.sheet().id, sel: { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, R.r1 + 5000), c2: R.c2 }, editing: App.editing() });
    }, 120);
  }
  ['selection', 'sheet', 'editStart', 'editEnd'].forEach((ev) => App.on(ev, sendPresence));
  // uma bolinha por pessoa (várias abas ou reconexões da mesma pessoa contam uma vez; a própria pessoa não aparece)
  function peopleOnline() {
    const meId = cloud.me && cloud.me.id;
    const by = new Map();
    for (const p of cloud.peers.values()) {
      const k = p.uid || p.email || p.cid;
      if (meId && k === meId) continue;
      const cur = by.get(k);
      if (!cur) { by.set(k, Object.assign({}, p, { tabs: 1 })); continue; }
      const tabs = cur.tabs + 1;
      by.set(k, Object.assign({}, (p._at || 0) >= (cur._at || 0) ? p : cur, { tabs }));
    }
    return [...by.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }
  function peopleList(anchor, people, goTo) {
    document.querySelectorAll('.peers-pop').forEach((x) => x.remove());
    const pop = document.createElement('div');
    pop.className = 'peers-pop';
    pop.innerHTML = `<div class="pp-head"><b>Na planilha agora</b><span>${people.length} ${people.length === 1 ? 'pessoa' : 'pessoas'}</span></div>
      <div class="pp-list">${people.map((p) => `<div class="pp-row" data-cid="${esc(p.cid)}">${App.avatarHtml({ id: p.uid, name: p.name, color: p.color, avatar: p.avatar }, 32)}
        <span class="pp-who"><b>${esc(p.name)}</b><small>${esc(p.email)}${p.tabs > 1 ? ` · ${p.tabs} abas` : ''}</small></span>
        <button class="btn btn-sm" data-go="${esc(p.cid)}" title="Ir até onde a pessoa está">Ir até</button>${p.uid && App.chat ? `<button class="icon-btn" data-msg="${esc(p.uid)}" title="Enviar mensagem">${icon('comment', 16)}</button>` : ''}</div>`).join('')}</div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = r.bottom + 6 + 'px';
    pop.style.right = Math.max(8, window.innerWidth - r.right - 40) + 'px';
    pop.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { pop.remove(); goTo(people.find((x) => x.cid === b.dataset.go)); }));
    pop.querySelectorAll('[data-msg]').forEach((b) => (b.onclick = () => { pop.remove(); App.chat.open(b.dataset.msg); }));
    const off = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  function renderPeers() {
    const box = $('peers');
    const meId = cloud.me && cloud.me.id;
    const list = [...cloud.peers.values()].filter((p) => !meId || p.uid !== meId);
    if (box) {
      const people = peopleOnline();
      const shown = people.slice(0, 5);
      box.innerHTML = shown.map((p) => `<button class="peer${p.avatar ? ' has-img' : ''}" data-cid="${esc(p.cid)}" style="background:${p.color};${p.avatar ? `box-shadow:0 0 0 2px ${p.color};` : ''}" title="${esc(p.name)} (${esc(p.email)})${p.tabs > 1 ? ' · ' + p.tabs + ' abas' : ''}">${App.avatarInner({ id: p.uid, name: p.name, avatar: p.avatar })}</button>`).join('') +
        (people.length > 5 ? `<button class="peer more" title="Ver todas as ${people.length} pessoas">+${people.length - 5}</button>` : '');
      const goTo = (p) => {
        if (!p || !p.presence || !p.presence.sel) return notify(`${p ? p.name : 'A pessoa'} ainda não selecionou nenhuma célula.`);
        const i = doc.sheets.findIndex((s) => s.id === p.presence.sheetId);
        if (i >= 0 && i !== doc.active) App.run('switchSheet', i);
        App.grid.select(p.presence.sel.r1, p.presence.sel.c1);
      };
      const more = box.querySelector('.peer.more');
      if (more) more.onclick = (e) => { e.stopPropagation(); peopleList(more, people, goTo); };
      box.querySelectorAll('.peer[data-cid]').forEach((b) => (b.onclick = () => {
        const p = cloud.peers.get(b.dataset.cid);
        if (!p) return;
        App.ui.menuPopup(b, [
          { header: `${p.name} · ${p.email}` },
          { label: 'Ir até onde a pessoa está', action: () => goTo(p) },
          ...(p.uid && App.chat ? [{ label: 'Enviar mensagem', icon: 'comment', action: () => App.chat.open(p.uid) }] : []),
        ], { right: true });
      }));
    }
    const visibleSel = (p) => {
      const sh = doc.sheets.find((x) => x.id === p.presence.sheetId);
      if (!sh || !App.colBlocked) return true;
      const S = p.presence.sel;
      for (let c = S.c1; c <= Math.min(S.c2, S.c1 + 60); c++) if (!App.colBlocked(sh, c)) return true;
      return false;
    };
    const toScreen = (p) => {
      if (!App.vm || !App.dispCell) return p;
      const S = p.presence.sel, a = App.dispCell(S.r1, S.c1);
      return a ? Object.assign({}, p, { presence: Object.assign({}, p.presence, { sel: { r1: a.r, c1: a.c, r2: a.r, c2: a.c } }) }) : null;
    };
    App.grid.setPeers(list.filter((p) => p.presence && p.presence.sel && visibleSel(p)).map(toScreen).filter(Boolean).map((p) => ({ name: (p.name || '').split(' ')[0], color: p.color, sheetId: p.presence.sheetId, sel: p.presence.sel, editing: p.presence.editing })));
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
    if (cloud.realPerms && cloud.realPerms.admin) chip.textContent = cloud.simulating ? `Vendo como: ${cloud.simulating.name} ▾` : 'Administrador ▾';
    let title = P.admin ? 'Você é administrador desta planilha. Clique para ver a planilha como um setor.' : `Seu acesso: ${roleLabel(P.role)}${P.sectorName ? ', setor ' + P.sectorName : ''}.`;
    if (cloud.simulating) title = 'Simulação: clique para trocar o setor ou voltar ao modo administrador.';
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
    api('GET', '/api/users/pending').then((list) => { st.pending = list; if (d.isConnected) renderPeople(); }).catch(() => {});
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
        ${(st.pending || []).filter((u) => !acl.members.some((x) => x.email === u.email)).length ? `<div class="pending"><b>Aguardando acesso:</b> ${(st.pending || []).filter((u) => !acl.members.some((x) => x.email === u.email)).map((u) => `<button class="chip-btn" data-pend="${esc(u.email)}" title="${esc(u.email)}">${icon('plus', 14)} ${esc(u.name)}</button>`).join('')}</div>` : ''}
        <div class="share-list">
          ${st.owner ? `<div class="share-row">${App.avatarHtml(st.owner)}<div class="sr-who"><b>${esc(st.owner.name)}</b><small>${esc(st.owner.email)}</small></div><span class="sr-fixed">Dono · administrador</span></div>` : ''}
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
      pane.querySelectorAll('[data-pend]').forEach((b) => (b.onclick = () => { pane.querySelector('#sh-email').value = b.dataset.pend; pane.querySelector('#sh-sector').focus(); }));
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
    const sh = App.sheet(), r = App.sel.ar, c = App.sel.ac;
    const rp = App.realCell ? App.realCell(r, c) : { r, c };
    if (!rp) return;
    const a = App.E.addrToStr(rp.r, rp.c);
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
        body = `<div class="hist-who">${App.avatarHtml({ id: h.uid, name: h.name, color: h.color, avatar: h.avatar })}<div><b>${esc(h.name)}</b><small>${esc(fmt(h.at))}${h.ip ? ' · IP ' + esc(h.ip) : ''}</small></div></div><p class="hist-what">${what}</p>`;
      }
      card.innerHTML = `<div class="hist-head"><b>Histórico de edições · ${esc(a)}</b>
          <button class="icon-btn" data-n="1" title="Edição anterior"${i >= list.length - 1 ? ' disabled' : ''}>‹</button>
          <button class="icon-btn" data-n="-1" title="Próxima edição"${i <= 0 ? ' disabled' : ''}>›</button>
          <button class="icon-btn" data-x title="Fechar">${icon('close', 16)}</button></div>
        ${body}${list.length > 1 ? `<p class="hist-count">Edição ${list.length - i} de ${list.length}</p>` : ''}
        ${list.length ? '<button class="btn btn-sm hist-all" data-all>Ver todas as edições</button>' : ''}`;
      const all = card.querySelector('[data-all]');
      if (all) all.onclick = () => { closeHistory(); allEdits(sh, a); };
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
  // todas as edições da célula numa tela só (com IP para administradores)
  async function allEdits(sh, a) {
    let list;
    try { list = await api('GET', `/api/docs/${cloud.id}/history?sheet=${encodeURIComponent(sh.id)}&addr=${a}&all=1`); } catch (e) { return notify(e.message); }
    const showIp = list.some((h) => h.ip !== undefined);
    const fmt = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
    const cell = (v, cls) => (v === null || v === undefined ? '<i class="hist-none">(vazia)</i>' : `<span class="hist-val${cls ? ' ' + cls : ''}">${esc(String(v).slice(0, 500))}</span>`);
    const m = App.ui.modal({
      title: `Todas as edições · ${sh.name}!${a}`, width: 'min(1000px, 96vw)', cls: 'hist-all-modal', enterSubmits: false,
      body: `<p class="sp-hint">${list.length} ${list.length === 1 ? 'edição' : 'edições'}, da mais recente para a mais antiga.${showIp ? ' O IP é o endereço da internet de onde a pessoa editou (o navegador não informa o endereço MAC do computador).' : ''}</p>
        <input class="input" id="ha-q" placeholder="Filtrar por pessoa, valor ou IP" autocomplete="off">
        <div class="ha-wrap"><table class="ha-table"><thead><tr><th>#</th><th>Quando</th><th>Quem</th>${showIp ? '<th>IP</th>' : ''}<th>Antes</th><th>Depois</th></tr></thead><tbody id="ha-body"></tbody></table></div>`,
      buttons: [{ label: 'Fechar', primary: true }],
    });
    const q = m.el.querySelector('#ha-q'), tb = m.el.querySelector('#ha-body');
    const draw = () => {
      const k = q.value.trim().toLowerCase();
      tb.innerHTML = list.map((h, i) => ({ h, n: list.length - i })).filter(({ h }) => !k || [h.name, h.before, h.after, h.ip].some((x) => String(x || '').toLowerCase().includes(k)))
        .map(({ h, n }) => `<tr><td>${n}</td><td>${esc(fmt(h.at))}</td><td><span class="ha-who"><i style="background:${esc(h.color || '#5f6368')}"></i>${esc(h.name)}</span></td>${showIp ? `<td>${esc(h.ip || '—')}</td>` : ''}<td>${cell(h.before, 'old')}</td><td>${cell(h.after)}</td></tr>`).join('') || '<tr><td colspan="6" class="sp-hint">Nada encontrado.</td></tr>';
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => e.stopPropagation());
    draw();
  }
  def('cellHistoryAll', 'Ver todas as edições da célula', () => {
    if (!App.cloudMode) return cellHistory();
    const sh = App.sheet(), rp = App.realCell ? App.realCell(App.sel.ar, App.sel.ac) : { r: App.sel.ar, c: App.sel.ac };
    if (rp) allEdits(sh, App.E.addrToStr(rp.r, rp.c));
  });
  App.on('selection', () => { if (histCard && !histCard.matches(':hover')) closeHistory(); });
  App.on('sheet', closeHistory);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHistory(); });

  // ---------- Quem não é administrador: só preenche valores ----------
  // Os setores são executores: digitam as informações nas colunas liberadas. Todo o resto
  // (formatação, regras, estrutura, filtros, congelar, tamanho de linhas e colunas) é dos administradores,
  // e essas opções nem aparecem para eles.
  const EXEC_OK = new Set(['insertProcess', 'informCriticals', 'sendStatus', 'printDoc', 'tagSC', 'tagSPOT', 'escalarVeiculo', 'confirmarEscala', 'bloquearVeiculo', 'destravarVeiculo', 'pedirTroca', 'messages', 'undo', 'redo', 'cut', 'copy', 'paste', 'pasteValues', 'find', 'findReplace', 'clearValues',
    'zoom', 'painelDia', 'indicadores', 'tema', 'notificacoes', 'containerHistorico', 'toggleFormulaBar', 'toggleMenus', 'fullscreen', 'toggleGridlines', 'toggleFormulas', 'switchSheet', 'nextSheet', 'prevSheet',
    'selectAll', 'selectColumn', 'selectRow', 'insertDate', 'insertTime', 'insertDateTime', 'fillDown', 'fillRight',
    'print', 'download', 'openCloud', 'share', 'login', 'cellHistory', 'cellHistoryAll', 'shortcuts', 'about', 'updates', 'functionList', 'columnStats',
    // barra de ferramentas liberada para os setores
    'menuSearch', 'paintFormat', 'format', 'customFormat', 'fmt_number', 'fmt_time', 'fmt_date', 'fmt_currency', 'fmt_percent', 'fmt_scientific',
    'decDec', 'decInc', 'fontFamily', 'fontSize', 'fontSizeInc', 'fontSizeDec', 'bold', 'italic', 'strike', 'textColor', 'fillColor',
    // visualizações de filtro (pessoais, não mudam a planilha dos outros)
    'createFilterView', 'createGroupedView', 'closeFilterView', 'clearViewFilters', 'toggleOldRows', 'myView', 'markCritical', 'saveFilterView', 'manageSavedViews', 'openSavedViews', 'alerts']);
  const COL_CMDS = new Set(['renameCol', 'insertColsLeft', 'insertColsRight', 'deleteCols', 'hideCols', 'unhideCols', 'resizeCols', 'autofitCols', 'addCols']);
  const EXEC_HIDDEN_MENUS = new Set(['Inserir', 'Formatar', 'Dados', 'Extensões', 'Administrador']);
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
      if (ex && EXEC_HIDDEN_MENUS.has(menu.label) && menu.label !== 'Inserir') vis = false;
      else if (ex) { try { vis = filterItems(menu.items()).some((x) => x && x !== '-' && !x.header && !x.disabled); } catch (e) { vis = true; } }
      b.hidden = !vis;
    });
  }
  App.on('contextItems', ({ hit, items }) => {
    if (hit.area === 'cell' || hit.area === 'fill') {
      const at = items.findIndex((x) => x && x.label === 'Ver mais ações da célula');
      items.splice(at >= 0 ? at : items.length, 0, { label: 'Mostrar histórico de edições', icon: 'history', cmd: 'cellHistory' }, { label: 'Ver todas as edições da célula', cmd: 'cellHistoryAll' });
    }
  });

  // ---------- "Quem pode": setores e pessoas ----------
  // Lista para os painéis de permissões (escala, container crítico, proteções): setores e pessoas (não administradoras)
  App.whoOptions = async () => {
    if (!App.cloudMode || !cloud.id) return { sectors: [], people: [] };
    const st = await api('GET', `/api/docs/${cloud.id}/share`);
    const acl = JSON.parse(JSON.stringify(st.acl));
    let changed = false;
    acl.members.forEach((mb) => { if (!mb.rid) { mb.rid = newId('m'); changed = true; } });
    if (changed) await api('PUT', `/api/docs/${cloud.id}/share`, { acl });
    const secName = (id) => ((acl.sectors.find((x) => x.id === id) || {}).name || '');
    return {
      sectors: acl.sectors.map((x) => ({ id: x.id, name: x.name })),
      people: acl.members.filter((mb) => mb.role !== 'admin').map((mb) => ({ id: mb.rid, name: mb.name || mb.email, sub: mb.sector ? 'setor ' + secName(mb.sector) : mb.email })),
    };
  };
  // caixas de marcar: setores e, abaixo, pessoas (data-<key>="id")
  App.whoBoxes = (key, list, who, opts) => {
    opts = opts || {};
    // "todos": os setores aparecem marcados; as pessoas são exceções (por nome), então ficam desmarcadas
    const on = (id, person) => ((opts.all && !person) || (!opts.all && (list || []).includes(id)) ? ' checked' : '') + (opts.all ? ' disabled' : '');
    const sec = who.sectors.map((x) => `<label class="inline"><input type="checkbox" data-${key}="${esc(x.id)}"${on(x.id)}> ${esc(x.name)}</label>`).join('');
    const ppl = who.people.map((x) => `<label class="inline" title="${esc(x.sub || '')}"><input type="checkbox" data-person="1" data-${key}="${esc(x.id)}"${on(x.id, true)}> 👤 ${esc(x.name)}</label>`).join('');
    if (!sec && !ppl) return '<p class="sp-hint">Nenhum setor nem pessoa ainda (Compartilhar › Pessoas e setores).</p>';
    return (sec ? `<div class="who-group"><small>Setores</small><div class="esc-sectors">${sec}</div></div>` : '')
      + (ppl ? `<div class="who-group"><small>Pessoas</small><div class="esc-sectors">${ppl}</div></div>` : '');
  };
  App.whoName = (id, who) => { const x = who.sectors.find((y) => y.id === id) || who.people.find((y) => y.id === id); return x ? x.name : '?'; };

  // ---------- Proteger páginas e intervalos ----------
  function protectRanges() {
    if (!App.cloudMode) { App.ui.modal({ title: 'Proteger intervalos', width: '460px', body: '<p class="modal-text">A proteção de intervalos vale para planilhas na nuvem, compartilhadas com setores. Salve esta planilha na nuvem para usar este recurso.</p>', buttons: [{ label: 'Fechar' }, ...(canCreate() ? [{ label: 'Salvar na nuvem', primary: true, action: () => { saveToCloud(true); } }] : [])] }); return; }
    if (!cloud.perms.admin) return notify('Somente administradores podem proteger intervalos.');
    const sh = App.sheet();
    App.whoOptions().then((who) => {
      const list = JSON.parse(JSON.stringify(sh.protected || []));
      const m = App.ui.modal({
        title: `Intervalos protegidos em "${sh.name}"`, width: '600px',
        body: `<p class="sp-hint">Somente administradores e os setores ou pessoas marcados podem editar as células protegidas. As demais pessoas continuam vendo os dados.</p><div id="pr-list"></div>
          <div class="pr-form"><p class="sp-label">Novo intervalo protegido</p>
            <div class="field-row"><label class="field"><span>Intervalo</span><input class="input" id="pr-range" value="${esc(App.rangeText(App.selRect()))}"></label><label class="field"><span>Descrição (opcional)</span><input class="input" id="pr-desc" placeholder="Ex.: Metas do mês"></label></div>
            <p class="sp-label">Quem pode editar (setores e pessoas)</p>
            <div class="pr-sectors">${App.whoBoxes('pr', [], who)}</div>
            <button class="btn" id="pr-add">${icon('plus', 16)} Proteger intervalo</button></div>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Salvar', primary: true, action: () => { App.change('Proteger intervalos', () => { sh.protected = list; }); notify('Proteções salvas.'); } }],
      });
      const d = m.el;
      const renderList = () => {
        d.querySelector('#pr-list').innerHTML = list.length ? list.map((p, i) => `<div class="cf-item"><span class="cf-chip">${icon('lock', 16)}</span><div><b>${esc(App.rangeText(p.range))}${p.desc ? ' · ' + esc(p.desc) : ''}</b><small>Podem editar: administradores${p.sectors.length ? ', ' + p.sectors.map((id) => esc(App.whoName(id, who))).join(', ') : ''}</small></div><button class="icon-btn" data-prm="${i}" title="Remover proteção">${icon('close', 16)}</button></div>`).join('') : '<p class="sp-hint">Nenhum intervalo protegido nesta página.</p>';
        d.querySelectorAll('[data-prm]').forEach((b) => (b.onclick = () => { list.splice(+b.dataset.prm, 1); renderList(); }));
      };
      renderList();
      d.querySelector('#pr-add').onclick = () => {
        const p = App.parseRange(d.querySelector('#pr-range').value);
        if (!p || p.si !== doc.active) return notify('Intervalo inválido. Use algo como A1:D20.');
        list.push({ id: Math.random().toString(36).slice(2, 8), range: p.R, desc: d.querySelector('#pr-desc').value.trim(), sectors: [...d.querySelectorAll('.pr-sectors input:checked')].map((x) => x.dataset.pr) });
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
    list.splice(at + 1, 0, { label: 'Permissões e controles (Administrador)…', icon: 'lock', cmd: 'adminPanel' });
    return list;
  };

  // ---------- Controle do administrador: todas as permissões num lugar só ----------
  function adminPanel() {
    const E = App.E;
    if (App.adminOnly()) return notify('Somente administradores acessam o controle do administrador.');
    const sh = App.sheet();
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    const esc2 = sh.escala || {};
    const cards = [
      { cmd: 'share', t: 'Pessoas, setores e páginas', d: 'Convide pessoas, crie setores e escolha, por setor ou por pessoa, quais páginas cada um vê ou edita.', s: App.cloudMode ? 'Planilha na nuvem' : 'Disponível depois de salvar na nuvem' },
      { cmd: 'columnAccess', t: 'Permissões por coluna', d: 'Para cada setor ou pessoa: coluna oculta, só ver ou editar. Selecione as colunas antes de abrir.', s: `Colunas selecionadas: ${E.numToCol(App.selRect().c1)}${App.selRect().c2 > App.selRect().c1 ? ' a ' + E.numToCol(App.selRect().c2) : ''}` },
      { cmd: 'protectRanges', t: 'Proteger páginas e intervalos', d: 'Só administradores e os setores ou pessoas escolhidos editam o intervalo protegido.', s: `${n(sh.protected)} intervalo(s) protegido(s) nesta página` },
      { cmd: 'critSectors', t: 'Container crítico: quem pode marcar', d: 'Setores e pessoas que podem marcar e desmarcar container crítico (e usar Informar críticos).', s: Array.isArray(sh.critSectors) ? `${n(sh.critSectors)} escolhido(s)` : 'Todos podem marcar' },
      { cmd: 'escalaConfig', t: 'Escala de veículos: quem pode usar', d: 'Quem escala e confirma, quem bloqueia e destrava para troca, e quem vê os dados do cavalo.', s: `Escala: ${n(esc2.sectors)} · Bloqueio: ${n(esc2.lockSectors)} · Dados do cavalo: ${n(esc2.infoSectors)}` },
      { cmd: 'critColumn', arg: App.selRect().c1, t: 'Coluna do alerta de crítico', d: 'Coluna onde o alerta de container crítico pisca. Selecione a coluna antes de usar.', s: `Agora: coluna ${E.numToCol(App.critCol(sh))} · usar a coluna ${E.numToCol(App.selRect().c1)}` },
      { cmd: 'alertRules', t: 'Regras de alerta (ALERTA)', d: 'O que aparece no botão ALERTA do cabeçalho: regras prontas (crítico, ARM/DEM, escala…) ou condições nas colunas, por setor ou pessoa.', s: `${doc.sheets.reduce((n, x) => n + (x.alertRules || []).length, 0)} regra(s)` },
      { cmd: 'mailWho', t: 'Enviar status por e-mail: quem pode', d: 'Quem pode usar o botão "Enviar por e-mail" do Enviar status. O e-mail sai da conta configurada no servidor.', s: Array.isArray(sh.mailSectors) && sh.mailSectors.length ? `${sh.mailSectors.length} escolhido(s)` : 'Só administradores' },
      { cmd: 'adminMetricas', t: 'Métricas da planilha, gráficos e teste de pico', d: 'Quem está conectado, gráficos do dia (pessoas, sessões, edições, linhas com informação), limite de pessoas ao mesmo tempo e teste de pico de usuários.', s: 'Administradores não ocupam vaga' },
      { cmd: 'adminSessions', t: 'Sessões: deslogar usuários', d: 'Encerra o login de todas as pessoas ou só das escolhidas; quem estiver na planilha sai na hora.', s: `${cloud.peers ? new Set([...cloud.peers.values()].map((x) => x.uid)).size : 0} pessoa(s) conectada(s) agora` },
      { cmd: 'cargaLookup', t: 'Containers da Carga OF', d: 'Coluna do container e da data de entrada preenchida pela API Carga OF Container.', s: sh.carga ? `Container na coluna ${E.numToCol(sh.carga.col)} · data na ${E.numToCol(sh.carga.dataCol)}` : 'Desativado nesta página' },
      { cmd: 'dssLookup', t: 'Motoristas do DSS', d: 'Coluna do motorista e do CPF/CNPJ preenchidos com a lista do DSS.', s: sh.lookup ? `Motorista na coluna ${E.numToCol(sh.lookup.col)} · CPF na ${E.numToCol(sh.lookup.cpfCol)}` : 'Desativado nesta página' },
    ];
    const m = App.ui.modal({
      title: 'Controle do administrador', width: '640px', cls: 'adm-modal',
      body: `<p class="sp-hint">Tudo o que define quem pode ver, editar ou usar cada função desta planilha (página <b>${esc(sh.name)}</b>). As escolhas podem ser por setor e também por pessoa.</p>
        <div class="adm-list">${cards.map((c, i) => `<div class="adm-card"><div><b>${esc(c.t)}</b><p>${esc(c.d)}</p><small>${esc(c.s)}</small></div><button class="btn btn-sm" data-i="${i}">Abrir</button></div>`).join('')}</div>`,
      buttons: [{ label: 'Fechar' }],
    });
    m.el.querySelectorAll('.adm-card [data-i]').forEach((b) => (b.onclick = () => { const c = cards[+b.dataset.i]; m.close ? m.close() : m.el.close(); App.run(c.cmd, c.arg); }));
  }
  def('adminPanel', 'Controle do administrador', adminPanel);

  // ---------- Sessões: deslogar todos ou pessoas escolhidas ----------
  async function adminSessions() {
    if (!App.cloudMode || !cloud.id) return notify('Disponível nas planilhas da nuvem.');
    if (!cloud.realPerms || !cloud.realPerms.admin) return notify('Somente administradores encerram sessões.');
    let list;
    try { list = await api('GET', `/api/docs/${cloud.id}/sessions`); } catch (e) { return notify(e.message); }
    const m = App.ui.modal({
      title: 'Sessões — deslogar usuários', width: '560px', enterSubmits: false,
      body: `<p class="sp-hint">Encerra o login da pessoa em todos os aparelhos: quem estiver com a planilha aberta sai na hora e precisa entrar de novo com a senha.</p>
        <input class="input" id="ss-q" placeholder="Procurar pessoa…" autocomplete="off">
        <div class="ss-list" id="ss-list"></div>`,
      buttons: [{ label: 'Fechar' }],
    });
    const box = m.el.querySelector('#ss-list'), qi = m.el.querySelector('#ss-q');
    const draw = () => {
      const k = qi.value.trim().toLowerCase();
      const vis = list.filter((x) => !k || (x.name + ' ' + x.email + ' ' + (x.setor || '')).toLowerCase().includes(k));
      box.innerHTML = vis.map((x) => `<label class="ss-row${x.eu ? ' me' : ''}"><input type="checkbox" data-id="${esc(x.id)}"${x.eu ? ' disabled' : ''}>
        ${App.avatarHtml({ id: x.id, name: x.name, color: '#5f6368' }, 30)}
        <span class="ss-who"><b>${esc(x.name)}${x.eu ? ' (você)' : ''}${x.owner ? ' · dono' : ''}</b><small>${esc(x.email)}${x.setor ? ' · ' + esc(x.setor) : ''}</small></span>
        <span class="ss-st ${x.online ? 'on' : x.conectado ? 'mid' : ''}">${x.online ? (x.online > 1 ? `nesta planilha (${x.online} abas)` : 'nesta planilha agora') : x.conectado ? 'em outra planilha' : 'fora agora'}</span></label>`).join('') || '<p class="sp-hint">Ninguém encontrado.</p>';
      box.querySelectorAll('input').forEach((x) => (x.onchange = upd));
      upd();
    };
    qi.oninput = draw;
    qi.onkeydown = (e) => e.stopPropagation();
    const foot = m.el.querySelector('.modal-foot');
    const bSel = document.createElement('button'); bSel.className = 'btn'; bSel.textContent = 'Deslogar selecionados';
    const bAll = document.createElement('button'); bAll.className = 'btn btn-primary'; bAll.textContent = 'Deslogar todos';
    foot.prepend(bAll); foot.prepend(bSel);
    const picked = () => [...box.querySelectorAll('input:checked')].map((x) => x.dataset.id);
    function upd() { const n = picked().length; bSel.disabled = !n; bSel.textContent = n ? `Deslogar selecionados (${n})` : 'Deslogar selecionados'; }
    const go = async (body, what) => {
      App.ui.modal({
        title: 'Encerrar sessões', width: '440px',
        body: `<p class="modal-text">${what} Quem estiver usando a planilha sai na hora (alterações já enviadas ficam salvas).</p>`,
        buttons: [{ label: 'Cancelar' }, { label: 'Deslogar', primary: true, action: async () => {
          try {
            const r = await api('POST', `/api/docs/${cloud.id}/logout`, body);
            notify(r.deslogados.length ? `Sessão encerrada: ${r.deslogados.join(', ')}.${r.pulados.length ? ` Não dá para deslogar: ${r.pulados.join(', ')}.` : ''}` : (r.pulados.length ? `Não dá para deslogar: ${r.pulados.join(', ')}.` : 'Ninguém para deslogar.'));
            list = await api('GET', `/api/docs/${cloud.id}/sessions`); draw();
          } catch (e) { notify(e.message); }
        } }],
      });
    };
    bSel.onclick = () => { const ids = picked(); if (ids.length) go({ users: ids }, `Deslogar ${ids.length === 1 ? (list.find((x) => x.id === ids[0]) || {}).name : ids.length + ' pessoas'}?`); };
    bAll.onclick = () => go({ all: true }, 'Deslogar todas as pessoas desta planilha (menos você)?');
    draw();
  }
  def('adminSessions', 'Sessões: deslogar usuários', adminSessions);

  // Administrador › Métricas da planilha (abas Agora, Gráficos e Teste de pico): ver src/painel.js

  def('openCloud', 'Planilhas na nuvem', openCloudDialog);
  def('saveToCloud', 'Salvar na nuvem', () => saveToCloud(false));
  def('protectRanges', 'Proteger páginas e intervalos', protectRanges);
  def('share', 'Compartilhar', () => { if (!App.cloudMode) shareLocal(); else if (cloud.perms && cloud.perms.admin) shareDialog(); else shareInfo(); });
  def('login', 'Entrar', () => loginDialog());
  def('columnAccess', 'Permissões por coluna', columnAccessDialog);
  def('viewAs', 'Ver como (setor)', () => viewAsMenu($('cloud-chip')));
  def('dssLookup', 'Motoristas do DSS', () => { if (!cloud.token) return loginDialog('Entre para usar a integração com o DSS.'); dssLookupDialog(); });
  def('cellHistory', 'Mostrar histórico de edições', cellHistory);

  function init() {
    lockCommands();
    refreshChrome();
    $('btn-account').addEventListener('click', (e) => accountMenu(e.currentTarget));
    $('cloud-chip').addEventListener('click', (e) => { if (cloud.realPerms && cloud.realPerms.admin) viewAsMenu(e.currentTarget); });
    // o ícone da planilha leva às planilhas na nuvem disponíveis para a pessoa
    const logo = document.querySelector('.app-logo');
    if (logo) logo.addEventListener('click', (e) => { e.preventDefault(); App.run('openCloud'); });
    renderAccount();
    const m = /#nuvem=([\w-]+)/.exec(location.hash);
    loadMe().then(() => { if (!m) checkGate(); });
    if (m) openCloudDoc(m[1]);
    window.addEventListener('hashchange', () => {
      const h = /#nuvem=([\w-]+)/.exec(location.hash);
      if (h && h[1] !== cloud.id) openCloudDoc(h[1]);
    });
  }
  App.collab = { init, openCloudDoc, saveToCloud, loginDialog, api, leaveCloud };
})(window.App);
