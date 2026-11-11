// Ver › Tema: Claro, Escuro ou Automático (segue o celular/computador). Fica guardado neste aparelho.
// O <head> já aplica o tema antes de desenhar (sem piscar branco ao abrir no escuro).
(function (App) {
  'use strict';
  const KEY = 'planilhas:tema';
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const atual = () => { try { return localStorage.getItem(KEY) || 'claro'; } catch (e) { return 'claro'; } };
  function aplica() {
    const t = atual(), dark = t === 'escuro' || (t === 'auto' && !!(mq && mq.matches));
    const html = document.documentElement;
    if (html.classList.contains('dark') !== dark) { html.classList.toggle('dark', dark); App.emit('tema', dark); }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0d0d0d');
  }
  App.commands.def('tema', 'Tema', (t) => {
    if (!['claro', 'escuro', 'auto'].includes(t)) return;
    try { localStorage.setItem(KEY, t); } catch (e) { /* ignora */ }
    aplica();
    App.emit('notify', t === 'escuro' ? 'Tema escuro ligado neste aparelho.' : t === 'auto' ? 'Tema automático: segue o aparelho.' : 'Tema claro ligado neste aparelho.');
  });
  App.temaAtual = atual;
  // botão no cabeçalho: lua (ligar o escuro) / sol (voltar ao claro)
  const LUA = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const SOL = '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function botao() {
    const right = document.querySelector('.appbar-right');
    if (!right) return;
    let b = document.getElementById('btn-tema');
    if (!b) {
      b = document.createElement('button');
      b.id = 'btn-tema'; b.className = 'icon-btn';
      b.onclick = () => App.run('tema', document.documentElement.classList.contains('dark') ? 'claro' : 'escuro');
      right.insertBefore(b, right.firstChild);
    }
    const dark = document.documentElement.classList.contains('dark');
    b.innerHTML = dark ? SOL : LUA;
    b.title = dark ? 'Voltar ao modo claro' : 'Modo escuro';
    b.setAttribute('aria-label', b.title);
  }
  App.on('tema', botao);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(botao, 0)); else setTimeout(botao, 0);
  if (mq && mq.addEventListener) mq.addEventListener('change', aplica);
  aplica();
})(window.App);
