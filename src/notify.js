// Ferramentas › Notificações no celular: liga as notificações deste aparelho (iPhone com o app na Tela de Início,
// Android ou computador) e escolhe o que avisar: container crítico, pedido de troca de veículo, mensagens no chat
// e PRÉ STACKING finalizado. Quem faz a mudança não recebe o próprio aviso.
(function (App) {
  'use strict';
  const esc = App.esc;
  const api = (...a) => App.collab.api(...a);
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const TIPOS = [['critico', 'Container marcado como crítico'], ['troca', 'Pedido de troca de veículo'], ['chat', 'Mensagens no chat'], ['prestacking', 'PRÉ STACKING finalizado']];
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
    let st = { inscrito: false, prefs: { critico: true, troca: true, chat: true, prestacking: false } };
    const sub = suporta && !aviso ? await assinaturaAtual() : null;
    if (sub) { try { st = await api('POST', '/api/push/estado', { endpoint: sub.endpoint }); } catch (e) { /* segue com o padrão */ } }
    const ligado = !!(sub && st.inscrito);
    const body = `<p class="modal-text">${ligado ? '<b>Ligadas neste aparelho.</b> ' : ''}Avise neste aparelho quando:</p>
      <div class="nt-list">${TIPOS.map(([k, t]) => `<label class="check"><input type="checkbox" data-k="${k}"${st.prefs[k] ? ' checked' : ''}${aviso ? ' disabled' : ''}> ${esc(t)}</label>`).join('')}</div>
      ${aviso ? `<p class="nt-aviso">${aviso}</p>` : '<p class="sp-hint">Você não recebe aviso das mudanças feitas por você. Avisos seguidos do mesmo tipo chegam juntos.</p>'}`;
    const prefs = (d) => { const o = {}; d.querySelectorAll('[data-k]').forEach((x) => { o[x.dataset.k] = x.checked; }); return o; };
    const botoes = [{ label: 'Fechar' }];
    if (!aviso && ligado) {
      botoes.unshift({ label: 'Desligar', action: () => { desligar(sub); } });
      botoes.push({ label: 'Enviar teste', action: () => { testar(); return false; } });
      botoes.push({ label: 'Salvar', primary: true, action: (d) => { salvar(sub, prefs(d)); } });
    } else if (!aviso) botoes.push({ label: 'Ligar notificações', primary: true, action: (d) => { ligar(prefs(d)); } });
    App.ui.modal({ title: 'Notificações no celular', width: '460px', body, buttons: botoes });
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
  async function salvar(sub, prefs) {
    try { await api('POST', '/api/push/inscrever', { subscription: sub.toJSON(), prefs, appUrl: appUrl(), aparelho: aparelho() }); App.emit('notify', 'Preferências salvas.'); }
    catch (e) { App.emit('notify', e.message); }
  }
  async function desligar(sub) {
    try { await api('POST', '/api/push/cancelar', { endpoint: sub.endpoint }); await sub.unsubscribe(); App.emit('notify', 'Notificações desligadas neste aparelho.'); }
    catch (e) { App.emit('notify', e.message); }
  }
  async function testar() {
    try { const r = await api('POST', '/api/push/teste', {}); App.emit('notify', r.enviadas ? 'Notificação de teste enviada.' : 'Nenhum aparelho recebeu o teste.'); }
    catch (e) { App.emit('notify', e.message); }
  }
  App.commands.def('notificacoes', 'Notificações no celular', abrir);
})(window.App);
