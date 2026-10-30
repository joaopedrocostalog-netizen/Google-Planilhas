// Endereço do servidor de colaboração (contas, planilhas na nuvem e edição em tempo real).
// No GitHub Pages o site usa o servidor hospedado na Render; servido pelo próprio servidor, usa o mesmo endereço.
(function () {
  'use strict';
  var RENDER_URL = 'https://planilhas-servidor.onrender.com';
  if (window.PLANILHAS_API === undefined) {
    window.PLANILHAS_API = /\.github\.io$/.test(location.hostname) ? RENDER_URL : location.origin;
  }
})();
