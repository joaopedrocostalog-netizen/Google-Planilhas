// Mensagens diretas: conversar com uma pessoa específica da planilha (chega na hora, fica guardada e pode apontar para uma célula).
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = App.esc;
  const icon = (n, s) => App.icon(n, s);
  const notify = (m) => App.emit('notify', m);
  const cloud = App.cloud;
  const api = (...a) => App.collab.api(...a);

  const st = { inbox: new Map(), unread: 0, contacts: [], contactsDoc: null, open: false, with: null, msgs: [], withUser: null, ref: false, loadedFor: null };
  const initial = (n) => esc(String(n || '?').trim()[0] || '?').toUpperCase();
  const av = (u, size) => `<span class="avatar chat-av" style="background:${esc(u.color || '#5f6368')}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px` : ''}">${initial(u.name)}</span>`;
  const when = (t) => {
    const d = new Date(t), now = new Date();
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? hm : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  };
  const meId = () => cloud.user && cloud.user.id;
  const visible = () => !!(cloud.user && App.cloudMode && cloud.id);

  // ---------- Botão no topo, com o número de mensagens não lidas ----------
  function renderButton() {
    const b = $('btn-chat');
    if (!b) return;
    b.hidden = !visible();
    const badge = b.querySelector('.chat-badge');
    badge.hidden = !st.unread;
    badge.textContent = st.unread > 99 ? '99+' : String(st.unread);
    b.title = st.unread ? `Mensagens (${st.unread} não ${st.unread === 1 ? 'lida' : 'lidas'})` : 'Mensagens';
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = st.unread ? `(${st.unread}) ${base}` : base;
  }
  async function loadInbox() {
    if (!cloud.user) return;
    try {
      const r = await api('GET', '/api/messages');
      st.inbox = new Map(r.conversations.map((c) => [c.with.id, c]));
      st.unread = r.unread;
    } catch (e) { /* sem conexão: tenta depois */ }
    renderButton();
    if (st.open && !st.with) renderBody();
  }
  async function loadContacts() {
    if (!cloud.id) { st.contacts = []; return; }
    try { st.contacts = await api('GET', `/api/docs/${cloud.id}/contacts`); st.contactsDoc = cloud.id; } catch (e) { st.contacts = []; }
  }

  // ---------- Painel ----------
  let panel = null;
  function open(uid) {
    if (!cloud.user) return App.collab.loginDialog('Entre para mandar mensagens.');
    if (!visible()) return notify('Abra uma planilha na nuvem para mandar mensagens.');
    st.open = true;
    panel = App.panels.open('Mensagens', (body) => { st.body = body; body.classList.add('chat-body'); renderBody(); }, () => { st.open = false; st.with = null; st.body = null; panel = null; });
    if (uid) { st.with = uid; st.withUser = st.contacts.find((c) => c.id === uid) || (st.inbox.get(uid) || {}).with || { id: uid, name: '…', color: '#5f6368' }; renderConversation(true); }
    Promise.all([loadContacts(), loadInbox()]).then(() => { if (!st.open) return; if (uid) openConversation(uid); else renderBody(); });
  }
  function renderBody() {
    const body = st.body;
    if (!body) return;
    if (st.with) return renderConversation();
    const q = (body.querySelector('#chat-find') || {}).value || '';
    const f = q.trim().toLowerCase();
    const match = (u) => !f || (u.name + ' ' + (u.email || '') + ' ' + (u.sector || '')).toLowerCase().includes(f);
    const convs = [...st.inbox.values()].sort((a, b) => new Date(b.last.at) - new Date(a.last.at)).filter((c) => match(c.with));
    const inConv = new Set(convs.map((c) => c.with.id));
    const online = new Set(st.contacts.filter((c) => c.online).map((c) => c.id));
    const people = st.contacts.filter((c) => !inConv.has(c.id) && match(c));
    body.innerHTML = `<input class="input chat-find" id="chat-find" placeholder="Procurar pessoa…" autocomplete="off" value="${esc(q)}">
      ${convs.length ? '<p class="sp-label">Conversas</p>' : ''}
      ${convs.map((c) => `<button class="chat-row${c.unread ? ' unread' : ''}" data-u="${esc(c.with.id)}">${av(c.with)}${online.has(c.with.id) ? '<i class="chat-on" title="Na planilha agora"></i>' : ''}
        <span class="chat-who"><b>${esc(c.with.name)}</b><small>${c.last.mine ? 'Você: ' : ''}${esc(c.last.text.slice(0, 80))}</small></span>
        <span class="chat-meta"><small>${when(c.last.at)}</small>${c.unread ? `<em>${c.unread}</em>` : ''}</span></button>`).join('')}
      <p class="sp-label">Pessoas desta planilha</p>
      ${people.length ? people.map((c) => `<button class="chat-row" data-u="${esc(c.id)}">${av(c)}${c.online ? '<i class="chat-on" title="Na planilha agora"></i>' : ''}
        <span class="chat-who"><b>${esc(c.name)}</b><small>${c.admin ? 'Administrador' : c.sector ? 'Setor ' + esc(c.sector) : esc(c.email)}${c.online ? ' · na planilha agora' : ''}</small></span></button>`).join('')
        : `<p class="sp-hint">${st.contacts.length || convs.length ? 'Ninguém encontrado.' : 'Ninguém com quem conversar nesta planilha ainda.'}</p>`}`;
    const find = body.querySelector('#chat-find');
    find.oninput = () => { const pos = find.selectionStart; renderBody(); const n = st.body.querySelector('#chat-find'); n.focus(); n.setSelectionRange(pos, pos); };
    body.querySelectorAll('.chat-row').forEach((b) => (b.onclick = () => openConversation(b.dataset.u)));
  }
  async function openConversation(uid) {
    st.with = uid; st.msgs = []; st.ref = false;
    const known = st.contacts.find((c) => c.id === uid) || (st.inbox.get(uid) || {}).with;
    st.withUser = known || { id: uid, name: '…', color: '#5f6368' };
    renderConversation(true);
    try {
      const r = await api('GET', `/api/messages/${uid}`);
      if (st.with !== uid) return;
      st.msgs = r.messages; st.withUser = Object.assign({}, r.with, known && { online: known.online, admin: known.admin, sector: known.sector });
      renderConversation();
      markRead(uid);
    } catch (e) { notify(e.message); }
  }
  async function markRead(uid) {
    const c = st.inbox.get(uid);
    if (!c || !c.unread) return;
    st.unread = Math.max(0, st.unread - c.unread); c.unread = 0;
    renderButton();
    try { await api('POST', `/api/messages/${uid}/read`); } catch (e) { /* tenta na próxima */ }
  }
  function refLabel() {
    const R = App.selRect(), sh = App.sheet();
    let r = R.r1, c = R.c1;
    if (App.vm && App.realCell) { const p = App.realCell(r, c); if (p) { r = p.r; c = p.c; } }
    const addr = App.E.numToCol(c) + r;
    return { sheet: sh.id, addr, label: `${sh.name}!${addr}` };
  }
  function renderConversation(loading) {
    const body = st.body;
    if (!body) return;
    const u = st.withUser, me = meId();
    const draft = (body.querySelector('#chat-text') || {}).value || '';
    const lastMine = [...st.msgs].reverse().find((m) => m.from === me);
    body.innerHTML = `<div class="chat-head"><button class="icon-btn chat-back" title="Voltar" aria-label="Voltar">←</button>${av(u, 32)}
        <span class="chat-who"><b>${esc(u.name)}</b><small>${u.online ? 'Na planilha agora' : u.admin ? 'Administrador' : u.sector ? 'Setor ' + esc(u.sector) : esc(u.email || '')}</small></span></div>
      <div class="chat-msgs" id="chat-msgs">${loading && !st.msgs.length ? '<p class="sp-hint">Carregando…</p>' : st.msgs.length ? st.msgs.map((m) => `<div class="chat-msg${m.from === me ? ' mine' : ''}" style="${m.from === me ? '' : `--who:${esc(u.color || '#5f6368')}`}">
          <div class="chat-bubble">${esc(m.text).replace(/\n/g, '<br>')}${m.ref ? `<button class="chat-ref" data-m="${m.id}" title="Ir para a célula">📍 ${esc(m.ref.label || m.ref.addr)}${m.ref.doc && m.ref.doc !== cloud.id && m.ref.title ? ' · ' + esc(m.ref.title) : ''}</button>` : ''}</div>
          <small>${when(m.at)}${m === lastMine && m.read ? ' · Visto' : ''}</small></div>`).join('') : `<p class="sp-hint">Mande a primeira mensagem para ${esc(u.name.split(' ')[0])}. Só vocês dois veem esta conversa.</p>`}</div>
      <div class="chat-compose">
        <div class="chat-refbar" ${st.ref ? '' : 'hidden'}>📍 Vai junto: <b id="chat-reflbl">${esc(refLabel().label)}</b><button class="icon-btn" id="chat-refx" title="Tirar a célula" aria-label="Tirar a célula">${icon('close', 14)}</button></div>
        <textarea class="input chat-text" id="chat-text" rows="2" placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra a linha)">${esc(draft)}</textarea>
        <div class="chat-actions"><button class="btn btn-sm" id="chat-cell" title="Mandar junto a célula selecionada, para a pessoa ir direto nela">📍 Célula selecionada</button>
        <button class="btn btn-primary btn-sm" id="chat-send">Enviar</button></div>
      </div>`;
    const list = body.querySelector('#chat-msgs');
    list.scrollTop = list.scrollHeight;
    body.querySelector('.chat-back').onclick = () => { st.with = null; renderBody(); loadInbox(); };
    const ta = body.querySelector('#chat-text');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    body.querySelector('#chat-send').onclick = send;
    body.querySelector('#chat-cell').onclick = () => { st.ref = true; renderConversation(); };
    const rx = body.querySelector('#chat-refx');
    if (rx) rx.onclick = () => { st.ref = false; renderConversation(); };
    body.querySelectorAll('.chat-ref').forEach((b) => (b.onclick = () => goRef(st.msgs.find((m) => String(m.id) === b.dataset.m).ref)));
  }
  let sending = false;
  async function send() {
    const ta = st.body && st.body.querySelector('#chat-text');
    if (!ta || sending) return;
    const text = ta.value.trim();
    if (!text) return;
    sending = true;
    try {
      const m = await api('POST', '/api/messages', { to: st.with, text, doc: cloud.id, ref: st.ref ? refLabel() : null });
      ta.value = ''; st.ref = false;
      addMsg(m, true);
    } catch (e) { notify(e.message); }
    sending = false;
  }
  function goRef(ref) {
    if (!ref) return;
    if (ref.doc && ref.doc !== cloud.id) { location.hash = '#nuvem=' + ref.doc; notify('Abrindo a planilha da mensagem…'); return; }
    const i = App.doc.sheets.findIndex((s) => s.id === ref.sheet);
    if (i < 0) return notify('Você não tem acesso a essa página.');
    if (i !== App.doc.active) App.run('switchSheet', i);
    const p = App.E.parseAddr(ref.addr);
    if (!p) return;
    let r = p.row, c = p.col;
    if (App.vm && App.dispCell) { const d = App.dispCell(r, c); if (!d) return notify('A célula está escondida pela sua visualização com filtro.'); r = d.r; c = d.c; }
    App.grid.select(r, c);
  }

  // ---------- Mensagem nova ----------
  function addMsg(m, mineSent) {
    const me = meId();
    const other = m.from === me ? m.to : m.from;
    if (st.with === other && st.msgs.some((x) => x.id === m.id)) return;
    const prev = st.inbox.get(other);
    const withUser = m.from === me ? (prev && prev.with) || st.contacts.find((c) => c.id === other) || st.withUser : m.fromUser;
    const conv = { with: withUser || { id: other, name: '…' }, last: Object.assign({}, m, { mine: m.from === me }), unread: (prev ? prev.unread : 0) };
    const viewing = st.open && st.with === other && document.visibilityState !== 'hidden';
    if (m.from !== me && !viewing) { conv.unread++; st.unread++; }
    st.inbox.set(other, conv);
    if (st.with === other) {
      st.msgs.push(m);
      if (st.body) renderConversation();
      if (m.from !== me) api('POST', `/api/messages/${other}/read`).catch(() => {});
    } else if (st.open && !st.with) renderBody();
    renderButton();
    if (m.from !== me && !viewing && !mineSent) toast(m);
  }
  let toastEl = null, toastTimer = null;
  function toast(m) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'dm-toast'; document.body.appendChild(toastEl); }
    const u = m.fromUser || { name: 'Alguém' };
    toastEl.innerHTML = `${av(u, 34)}<div class="dm-txt"><b>${esc(u.name)}</b><span>${esc(m.text.slice(0, 140))}${m.ref ? ' · 📍 ' + esc(m.ref.label || m.ref.addr) : ''}</span></div>
      <button class="btn btn-primary btn-sm">Responder</button><button class="icon-btn dm-x" aria-label="Fechar">${icon('close', 16)}</button>`;
    toastEl.hidden = false;
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    const go = () => { toastEl.hidden = true; open(m.from); };
    toastEl.querySelector('.btn').onclick = go;
    toastEl.querySelector('.dm-txt').onclick = go;
    toastEl.querySelector('.dm-x').onclick = () => { toastEl.hidden = true; };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 9000);
  }
  App.on('dm', (m) => addMsg(m));
  App.on('dmRead', (e) => {
    // a outra pessoa leu: mostra "Visto"
    if (e.by !== meId() && st.with === e.by) { st.msgs.forEach((m) => { if (m.from === meId()) m.read = true; }); if (st.body) renderConversation(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.open && st.with) markRead(st.with); });

  // mostra o botão quando a pessoa está numa planilha na nuvem e carrega as não lidas
  function tick() {
    const key = visible() ? meId() + '|' + cloud.id : null;
    if (key !== st.loadedFor) {
      st.loadedFor = key;
      if (key) { loadInbox(); if (st.contactsDoc !== cloud.id) loadContacts(); } else { st.unread = 0; st.inbox.clear(); if (st.open && App.panels.close) App.panels.close(); }
    }
    renderButton();
  }
  function init() {
    const b = $('btn-chat');
    if (b) b.addEventListener('click', () => (st.open ? App.panels.close() : open()));
    setInterval(tick, 1500);
    App.on('sheet', () => setTimeout(tick, 0));
    setInterval(() => { if (visible()) loadInbox(); }, 120000);
    tick();
  }
  App.commands.def('messages', 'Mensagens', (uid) => open(typeof uid === 'string' ? uid : null));
  App.chat = { init, open };
})(window.App);
