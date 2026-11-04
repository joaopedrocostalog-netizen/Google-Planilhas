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
  const av = (u, size) => (App.avatarHtml ? App.avatarHtml(u, size, 'chat-av') : `<span class="avatar chat-av" style="background:${esc(u.color || '#5f6368')}">${initial(u.name)}</span>`);
  const when = (t) => {
    const d = new Date(t), now = new Date();
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? hm : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  };
  const meId = () => cloud.user && cloud.user.id;
  // ---------- Emojis e figurinhas ----------
  const EMOJIS = {
    'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 😐 😑 😶 🙄 😬 😴 😌 🤔 🤨 😮 😯 😲 😳 🥺 😢 😭 😤 😠 😡 🤯 😱 😓 🤗 🤭 🤫 🤐 😷 🤒 🤕 🥵 🥶 😵 🤠 😈 💀 🤡',
    'Gestos': '👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 👐 🙏 💪 👋 🤙 👉 👈 👆 👇 ☝️ ✋ 🖐️ 🫡 🫶 ✍️ 👀',
    'Trabalho': '✅ ☑️ ✔️ ❌ ⚠️ 🚨 ⛔ 🔴 🟠 🟡 🟢 🔵 ⏰ ⏳ ⌛ 📅 📌 📍 📎 📝 📋 📊 📈 📉 💼 📞 📱 💻 🖨️ 📧 📦 🔒 🔓 🔑 💰 💵 🧾 🏁 🔥 ⭐ 💡 🎯',
    'Transporte': '🚚 🚛 🚜 🚗 🚙 🚌 🚢 ⛴️ 🛳️ 🚂 ✈️ 🛫 🛬 🚧 ⛽ 🛣️ 🗺️ 🏭 🏗️ 🏢 🏠 ⚓ 🛞 🚦',
    'Outros': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 🎉 🎊 🎁 ☕ 🍕 🍔 🍺 ☀️ 🌧️ ⛈️ 🌙 ⚽ 🏆 🤖 👶',
  };
  const STICKERS = [
    ['ok', '👍', 'Ok!', '#34a853'], ['feito', '✅', 'Feito!', '#188038'], ['caminho', '🚚', 'A caminho', '#1a73e8'], ['carregado', '📦', 'Carregado', '#8e24aa'],
    ['descarga', '🏁', 'Descarga finalizada', '#0b8043'], ['atrasado', '⏰', 'Atrasado', '#e8710a'], ['urgente', '🚨', 'Urgente!', '#d93025'], ['aguarde', '⏳', 'Aguarde', '#f9ab00'],
    ['liberado', '🔓', 'Liberado', '#1e8e3e'], ['ligar', '📞', 'Me liga', '#1967d2'], ['obrigado', '🙏', 'Obrigado!', '#c2185b'], ['parabens', '🎉', 'Parabéns!', '#e37400'],
    ['duvida', '🤔', 'Dúvida', '#5f6368'], ['top', '🔥', 'Top!', '#ea4335'], ['cafe', '☕', 'Pausa para o café', '#795548'], ['bomdia', '☀️', 'Bom dia!', '#f6b100'],
  ];
  const stickerOf = (text) => { const m = /^\[fig:([a-z0-9]+)\]$/.exec(String(text || '').trim()); return m ? STICKERS.find((x) => x[0] === m[1]) || null : null; };
  const preview = (text) => { const k = stickerOf(text); return k ? `${k[1]} Figurinha: ${k[2]}` : String(text || ''); };
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
        <span class="chat-who"><b>${esc(c.with.name)}</b><small>${c.last.mine ? 'Você: ' : ''}${esc(preview(c.last.text).slice(0, 80))}</small></span>
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
    st.with = uid; st.msgs = []; st.ref = false; st.draft = '';
    const oldTa = st.body && st.body.querySelector('#chat-text');
    if (oldTa) oldTa.value = '';
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
    // rascunho: o que a pessoa ainda está digitando (zera ao enviar, mesmo que a resposta do servidor chegue depois)
    const ta0 = body.querySelector('#chat-text');
    if (ta0) st.draft = ta0.value;
    const draft = st.draft || '';
    const lastMine = [...st.msgs].reverse().find((m) => m.from === me);
    body.innerHTML = `<div class="chat-head"><button class="icon-btn chat-back" title="Voltar" aria-label="Voltar">←</button>${av(u, 32)}
        <span class="chat-who"><b>${esc(u.name)}</b><small>${u.online ? 'Na planilha agora' : u.admin ? 'Administrador' : u.sector ? 'Setor ' + esc(u.sector) : esc(u.email || '')}</small></span></div>
      <div class="chat-msgs" id="chat-msgs">${loading && !st.msgs.length ? '<p class="sp-hint">Carregando…</p>' : st.msgs.length ? st.msgs.map((m) => `<div class="chat-msg${m.from === me ? ' mine' : ''}" style="${m.from === me ? '' : `--who:${esc(u.color || '#5f6368')}`}">
          <div class="chat-bubble${stickerOf(m.text) ? ' sticker' : ''}">${stickerOf(m.text) ? stickerHtml(stickerOf(m.text)) : esc(m.text).replace(/\n/g, '<br>')}${m.ref ? `<button class="chat-ref" data-m="${m.id}" title="Ir para a célula">📍 ${esc(m.ref.label || m.ref.addr)}${m.ref.doc && m.ref.doc !== cloud.id && m.ref.title ? ' · ' + esc(m.ref.title) : ''}</button>` : ''}${unlockBtn(m)}</div>
          <small>${when(m.at)}${m === lastMine && m.read ? ' · Visto' : ''}</small></div>`).join('') : `<p class="sp-hint">Mande a primeira mensagem para ${esc(u.name.split(' ')[0])}. Só vocês dois veem esta conversa.</p>`}</div>
      <div class="chat-compose">
        <div class="chat-refbar" ${st.ref ? '' : 'hidden'}>📍 Vai junto: <b id="chat-reflbl">${esc(refLabel().label)}</b><button class="icon-btn" id="chat-refx" title="Tirar a célula" aria-label="Tirar a célula">${icon('close', 14)}</button></div>
        <textarea class="input chat-text" id="chat-text" rows="2" placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra a linha)">${esc(draft)}</textarea>
        <div class="chat-actions"><button class="btn btn-sm chat-emo-btn" id="chat-emo" title="Emojis e figurinhas">😊</button><button class="btn btn-sm" id="chat-cell" title="Mandar junto a célula selecionada, para a pessoa ir direto nela">📍 Célula selecionada</button>
        <button class="btn btn-primary btn-sm" id="chat-send">Enviar</button></div>
      </div>`;
    const list = body.querySelector('#chat-msgs');
    list.scrollTop = list.scrollHeight;
    body.querySelector('.chat-back').onclick = () => { st.with = null; renderBody(); loadInbox(); };
    const ta = body.querySelector('#chat-text');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    body.querySelector('#chat-send').onclick = () => send();
    body.querySelector('#chat-emo').onclick = (e) => { e.stopPropagation(); emojiPicker(body, ta); };
    body.querySelector('#chat-cell').onclick = () => { st.ref = true; renderConversation(); };
    const rx = body.querySelector('#chat-refx');
    if (rx) rx.onclick = () => { st.ref = false; renderConversation(); };
    body.querySelectorAll('.chat-ref').forEach((b) => (b.onclick = () => goRef(st.msgs.find((m) => String(m.id) === b.dataset.m).ref)));
    body.querySelectorAll('.chat-unlock:not([disabled])').forEach((b) => (b.onclick = async () => {
      const m = st.msgs.find((x) => String(x.id) === b.dataset.m);
      b.disabled = true;
      await App.escala.unlockFromChat(m.ref, m.from);
      if (st.body) renderConversation();
    }));
  }
  // pedido de troca de veículo: quem pode destravar faz isso direto pela mensagem
  function unlockBtn(m) {
    if (!m.ref || m.ref.act !== 'unlock' || !App.escala) return '';
    // pedido já atendido: aparece como efetuado para quem pediu e para todo o setor responsável
    if (m.ref.done) {
      const d = m.ref.done;
      return `<button class="chat-unlock done" disabled>✓ Troca liberada${d.name ? ' por ' + esc(d.name.split(' ')[0]) : ''}${d.at ? ' · ' + when(d.at) : ''}</button>`;
    }
    if (m.from === meId()) return m.ref.req ? '<span class="chat-unlock wait">⏳ Aguardando destravar</span>' : '';
    const u = App.escala.chatUnlockState(m.ref);
    if (!u || !u.can) return '';
    return u.locked.length ? `<button class="chat-unlock" data-m="${m.id}">🔓 Destravar para troca (${u.locked.length === 1 ? 'linha ' + u.locked[0] : 'linhas ' + u.locked.join(' e ')})</button>`
      : `<button class="chat-unlock done" data-m="${m.id}" disabled>✓ Já destravado</button>`;
  }
  function stickerHtml(k) { return `<span class="chat-stk" style="--stk:${k[3]}"><span class="chat-stk-emo">${k[1]}</span><b>${esc(k[2])}</b></span>`; }
  // painel de emojis (vão para o texto) e figurinhas (são enviadas na hora)
  function emojiPicker(body, ta) {
    let pop = body.querySelector('.emo-pop');
    if (pop) { pop.remove(); return; }
    pop = document.createElement('div');
    pop.className = 'emo-pop';
    let tab = 'Figurinhas';
    const tabs = ['Figurinhas', ...Object.keys(EMOJIS)];
    const draw = () => {
      pop.innerHTML = `<div class="emo-tabs">${tabs.map((t) => `<button class="emo-tab${t === tab ? ' on' : ''}" data-t="${esc(t)}">${t === 'Figurinhas' ? '🖼️ Figurinhas' : esc(EMOJIS[t].split(' ')[0] + ' ' + t)}</button>`).join('')}</div>
        <div class="emo-grid${tab === 'Figurinhas' ? ' stk' : ''}">${tab === 'Figurinhas' ? STICKERS.map((k) => `<button class="emo-stk" data-k="${k[0]}" title="Enviar figurinha">${stickerHtml(k)}</button>`).join('')
          : EMOJIS[tab].split(' ').map((e) => `<button class="emo-i" data-e="${esc(e)}">${e}</button>`).join('')}</div>`;
      pop.querySelectorAll('.emo-tab').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); tab = b.dataset.t; draw(); }));
      pop.querySelectorAll('.emo-i').forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? a;
        ta.value = ta.value.slice(0, a) + b.dataset.e + ta.value.slice(z);
        st.draft = ta.value;
        ta.focus(); ta.setSelectionRange(a + b.dataset.e.length, a + b.dataset.e.length);
      }));
      pop.querySelectorAll('.emo-stk').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); pop.remove(); send('[fig:' + b.dataset.k + ']'); }));
    };
    draw();
    body.querySelector('.chat-compose').appendChild(pop);
    const off = (e) => { if (!pop.contains(e.target) && e.target.id !== 'chat-emo') { pop.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  let sending = false;
  async function send(override) {
    const ta = st.body && st.body.querySelector('#chat-text');
    if (!ta || sending) return;
    const isStk = typeof override === 'string';
    const text = isStk ? override : ta.value.trim();
    if (!text) return;
    sending = true;
    const ref = st.ref && !isStk ? refLabel() : null;
    // limpa a caixa na hora; se der erro, o texto volta (figurinha não mexe no que está sendo escrito)
    if (!isStk) { st.draft = ''; st.ref = false; ta.value = ''; }
    try {
      const m = await api('POST', '/api/messages', { to: st.with, text, doc: cloud.id, ref });
      addMsg(m, true);
    } catch (e) {
      notify(e.message);
      if (isStk) { sending = false; return; }
      st.draft = text; st.ref = !!ref;
      const t2 = st.body && st.body.querySelector('#chat-text');
      if (t2 && !t2.value) t2.value = text;
    }
    sending = false;
    const t3 = st.body && st.body.querySelector('#chat-text');
    if (t3) t3.focus();
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
    toastEl.innerHTML = `${av(u, 34)}<div class="dm-txt"><b>${esc(u.name)}</b><span>${esc(preview(m.text).slice(0, 140))}${m.ref ? ' · 📍 ' + esc(m.ref.label || m.ref.addr) : ''}</span></div>
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
  // pedido de troca atendido (por qualquer pessoa do setor): troca o botão por "efetuado"
  App.on('dmDone', (e) => {
    let hit = false;
    for (const m of st.msgs) if (e.ids.includes(m.id) && m.ref) { m.ref.done = e.done; hit = true; }
    if (hit && st.body && st.with) renderConversation();
  });
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
