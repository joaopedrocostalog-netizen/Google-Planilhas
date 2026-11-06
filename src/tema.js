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
  if (mq && mq.addEventListener) mq.addEventListener('change', aplica);
  aplica();
})(window.App);
