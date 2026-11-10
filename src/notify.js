// Ferramentas › Notificações: as notificações deste aparelho (iPhone com o app na Tela de Início, Android ou
// computador) são obrigatórias: quem entra na conta só usa a planilha depois de aceitar. No computador o aviso é do
// sistema (aparece por cima de qualquer janela, com a planilha na tela ou não). Todos os tipos de aviso ficam ligados
// (container crítico, troca de veículo, chat, mensagem de administrador…). Quem faz a mudança não recebe o próprio aviso.
(function (App) {
  'use strict';
  const esc = App.esc;
  const api = (...a) => App.collab.api(...a);
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const TIPOS = [['critico', 'Container marcado como crítico'], ['troca', 'Pedido de troca de veículo'], ['chat', 'Mensagens no chat'], ['prestacking', 'PRÉ STACKING finalizado'],
    ['alerta', 'Alertas novos do botão ALERTA'], ['demurrage', 'Demurrage do vazio vencendo ou vencida'], ['status', 'Status automático para conferir']];
  const appUrl = () => location.origin + location.pathname;
  const aparelho = () => (iOS ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computador') + (standalone ? ' (app)' : '');
  const chaveBin = (b64) => { const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

  let reg = null;
  async function registro() {
    if (reg) return reg;
    reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    return reg;
  }
  // abrir pela notificação: vai para a planilha do aviso
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'abrir' && e.data.url) { const h = e.data.url.split('#')[1]; if (h && location.hash !== '#' + h) location.hash = h; }
    });
    // quem já ativou mantém o service worker atualizado
    if (suporta && Notification.permission === 'granted') registro().catch(() => {});
  }

  async function assinaturaAtual() { try { const r = await registro(); return await r.pushManager.getSubscription(); } catch (e) { return null; } }

  async function abrir() {
    if (!App.collab) return App.emit('notify', 'Entre na sua conta para usar as notificações.');
    let aviso = '';
    if (!suporta) aviso = iOS && !standalone
      ? 'No iPhone, as notificações funcionam com a planilha instalada: no Safari, toque em <b>Compartilhar › Adicionar à Tela de Início</b> e abra pelo ícone. Depois volte aqui.'
      : 'Este navegador não aceita notificações. No iPhone, use o app da Tela de Início (iOS 16.4 ou mais novo).';
    else if (Notification.permission === 'denied') aviso = 'As notificações estão bloqueadas para a planilha neste aparelho. Libere em Ajustes › Notificações › Planilhas (iPhone) ou nas configurações do navegador.';
    let st = { inscrito: false, prefs: { critico: true, troca: true, chat: true, prestacking: false, alerta: true, demurrage: true, status: true } };
    const sub = suporta && !aviso ? await assinaturaAtual() : null;
    if (sub) { try { st = await api('POST', '/api/push/estado', { endpoint: sub.endpoint }); } catch (e) { /* segue com o padrão */ } }
    const ligado = !!(sub && st.inscrito);
    const body = `<p class="modal-text">${ligado ? '<b>Ligadas neste aparelho.</b> ' : ''}Avise neste aparelho quando:</p>
      <div class="nt-list"><label class="check"><input type="checkbox" checked disabled> Mensagens de administradores</label>${TIPOS.map(([k, t]) => `<label class="check"><input type="checkbox" data-k="${k}" checked disabled> ${esc(t)}</label>`).join('')}</div>
      ${aviso ? `<p class="nt-aviso">${aviso}</p>` : `<p class="sp-hint">Os avisos chegam com a planilha fechada, o celular bloqueado ou outra janela na frente (no computador, ficam na tela até você clicar ou fechar). As notificações são obrigatórias: todos os avisos ficam ligados e não dá para desligar. Na hora: crítico, troca, chat e PRÉ STACKING finalizado (assim que alguém muda a planilha). Alertas do botão ALERTA: quando alguém estiver com a planilha aberta (as regras são calculadas na tela). Demurrage (a cada 30 min) e status automático (no horário): pelo servidor. Você não recebe aviso das mudanças feitas por você; avisos seguidos do mesmo tipo chegam juntos.</p>`}`;
    const prefs = (d) => { const o = {}; d.querySelectorAll('[data-k]').forEach((x) => { o[x.dataset.k] = x.checked; }); return o; };
    const botoes = [{ label: 'Fechar' }];
    if (!aviso && ligado) {
      botoes.push({ label: 'Enviar teste', action: () => { testar(); return false; } });
      botoes.push({ label: 'Exemplo de cada aviso', action: () => { testar(true); return false; } });
    } else if (!aviso) botoes.push({ label: 'Ligar notificações', primary: true, action: (d) => { ligar(prefs(d)); } });
    App.ui.modal({ title: 'Notificações', width: '460px', body, buttons: botoes });
  }

  async function ligar(prefs) {
    try {
      const perm = await Notification.requestPermission(); // precisa ser no toque do botão (iPhone)
      if (perm !== 'granted') return App.emit('notify', 'Sem permissão para notificações neste aparelho.');
      const r = await registro();
      const { chave } = await api('GET', '/api/push/chave');
      let sub = await r.pushManager.getSubscription();
      if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBin(chave) });
      await api('POST', '/api/push/inscrever', { subscription: sub.toJSON(), prefs, appUrl: appUrl(), aparelho: aparelho() });
      App.emit('notify', 'Notificações ligadas neste aparelho.');
      testar();
    } catch (e) { App.emit('notify', 'Não foi possível ligar as notificações: ' + e.message); }
  }
  // exemplos: este aparelho mostra um de cada vez (a cada 2 s), pelo service worker, igual a um aviso de verdade.
  // Assim funcionam no computador, onde vários avisos chegando juntos ficam um por cima do outro ou na fila do sistema.
  // Os outros aparelhos da pessoa recebem os exemplos pelo servidor.
  let mostrando = false;
  async function exemplosAqui() {
    if (mostrando) return App.emit('notify', 'Os exemplos ainda estão aparecendo.');
    mostrando = true;
    try {
      const reg = await registro(), sub = await reg.pushManager.getSubscription();
      const r = await api('POST', '/api/push/teste', { exemplos: true, menos: sub ? sub.endpoint : '' });
      const base = reg.scope;
      App.emit('notify', `${r.lista.length} exemplos vão aparecer neste aparelho, um a cada 2 segundos${r.enviadas ? ' (e nos seus outros aparelhos)' : ''}.`);
      for (let i = 0; i < r.lista.length; i++) {
        const x = r.lista[i];
        if (i) await new Promise((ok) => setTimeout(ok, 2000));
        await reg.showNotification(x.title, { body: x.body, tag: 'exemplo-' + x.tipo, renotify: true, requireInteraction: true, icon: base + 'assets/apple-touch-icon.png', badge: base + 'assets/apple-touch-icon.png', data: { url: appUrl() } });
      }
    } catch (e) { App.emit('notify', 'Não foi possível mostrar os exemplos: ' + e.message); }
    mostrando = false;
  }
  async function testar(exemplos) {
    if (exemplos) return exemplosAqui();
    try {
      const r = await api('POST', '/api/push/teste', {});
      App.emit('notify', !r.enviadas ? 'Nenhum aparelho recebeu o teste.' : 'Notificação de teste enviada.');
    }
    catch (e) { App.emit('notify', e.message); }
  }
  App.commands.def('notificacoes', 'Notificações', abrir);

  // ---------- Notificações obrigatórias ----------
  // Quem está na conta precisa aceitar as notificações neste aparelho: enquanto não aceitar, uma tela por cima de tudo
  // impede o uso da planilha. Com a permissão já dada, a inscrição é refeita sozinha (aparelho novo, inscrição vencida).
  let gate = null, gateEstado = '', okPara = null, conferindo = false, pulou = false;
  function fecha() { if (gate) { gate.close(); gate.remove(); gate = null; gateEstado = ''; } }
  function mostra(estado, detalhe) {
    if (gate && gateEstado === estado) return;
    fecha();
    gateEstado = estado;
    const T = {
      pedir: ['Para usar a planilha, ative as notificações deste aparelho. É por elas que chegam os avisos de container crítico, troca de veículo, demurrage e as mensagens dos administradores, mesmo com a planilha fechada ou outra janela na frente.', 'Ativar notificações'],
      bloqueado: ['As notificações da planilha estão <b>bloqueadas</b> neste navegador. Para liberar: clique no cadeado (ou no ícone ao lado do endereço do site) › <b>Notificações</b> › <b>Permitir</b>. No iPhone: Ajustes › Notificações › Planilhas. Depois clique em "Já liberei".', 'Já liberei'],
      semsuporte: [iOS && !standalone ? 'No iPhone, as notificações funcionam com a planilha instalada: no Safari, toque em <b>Compartilhar › Adicionar à Tela de Início</b> e abra pelo ícone.' : 'Este navegador não aceita notificações. Abra a planilha no Chrome, Edge ou Firefox atualizado para receber os avisos.', 'Continuar sem notificações neste aparelho'],
      erro: ['Não foi possível ativar as notificações agora: ' + esc(detalhe || 'erro desconhecido') + '.', 'Tentar de novo'],
    }[estado];
    gate = document.createElement('dialog');
    gate.className = 'modal nt-gate';
    gate.innerHTML = `<div class="modal-head"><h2>🔔 Notificações obrigatórias</h2></div><div class="modal-body"><p class="modal-text">${T[0]}</p></div>
      <div class="modal-foot">${estado === 'erro' ? '<button class="btn" data-a="pular">Continuar por agora</button>' : ''}<button class="btn btn-primary" data-a="ok">${T[1]}</button></div>`;
    gate.addEventListener('cancel', (e) => e.preventDefault()); // Esc não fecha
    gate.querySelector('[data-a="ok"]').onclick = async () => {
      if (estado === 'semsuporte') { pulou = true; return fecha(); }
      if (estado === 'pedir') { try { await Notification.requestPermission(); } catch (e) { /* segue para conferir */ } } // no clique (iPhone exige)
      gateEstado = ''; confere(true);
    };
    const pular = gate.querySelector('[data-a="pular"]');
    if (pular) pular.onclick = () => { pulou = true; fecha(); };
    document.body.appendChild(gate);
    gate.showModal();
  }
  async function garanteInscricao() {
    const r = await registro();
    let sub = await r.pushManager.getSubscription();
    if (!sub) { const { chave } = await api('GET', '/api/push/chave'); sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBin(chave) }); }
    const st = await api('POST', '/api/push/estado', { endpoint: sub.endpoint });
    if (!st.inscrito) await api('POST', '/api/push/inscrever', { subscription: sub.toJSON(), prefs: st.prefs, appUrl: appUrl(), aparelho: aparelho() });
  }
  async function confere(clicou) {
    const u = App.cloud && App.cloud.user;
    if (!u) { okPara = null; pulou = false; return fecha(); }
    if (conferindo) return;
    if (!suporta) { if (!pulou) mostra('semsuporte'); return; }
    if (Notification.permission === 'denied') return mostra('bloqueado');
    if (Notification.permission !== 'granted') return mostra('pedir');
    if (okPara === u.id) return fecha();
    if (pulou || (gateEstado === 'erro' && !clicou)) return;
    conferindo = true;
    try { await garanteInscricao(); okPara = u.id; fecha(); }
    catch (e) { mostra('erro', e.message); }
    conferindo = false;
  }
  setInterval(confere, 3000);
  setTimeout(confere, 800);
})(window.App);
