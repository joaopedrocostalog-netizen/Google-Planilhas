// Inicialização do aplicativo.
(function (App) {
  'use strict';
  const $ = (id) => document.getElementById(id);

  App.load();
  App.grid.init();
  App.editor.init();
  App.commands.init();
  App.ui.init();
  App.ui.init2();
  App.charts.init();
  App.io.init();
  App.collab.init();
  App.viewsInit();

  // Barra "Adicionar mais linhas"
  $('add-rows-btn').addEventListener('click', () => App.run('addRows', parseInt($('add-rows-n').value, 10) || 1000));
  $('add-rows-n').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('add-rows-btn').click(); });

  // Atalho para editar a tabela dinâmica da página
  const pivot = $('pivot-chip');
  const syncPivot = () => { pivot.hidden = !App.sheet().pivot; };
  pivot.addEventListener('click', () => App.run('pivotEditor'));
  App.on('sheet', syncPivot);
  App.on('change', syncPivot);

  // Clique em qualquer área vazia devolve o foco à grade
  document.querySelector('.main').addEventListener('mouseup', (e) => {
    if (!App.editing() && !e.target.closest('input, textarea, select, button, .side-panel, .chart-obj')) App.grid.focus();
  });
  window.addEventListener('beforeunload', () => App.save());

  App.emit('sheet');
  App.emit('title');
  App.emit('selection');
  if (!/#(importar|nuvem)=/.test(location.hash)) {
    try { history.replaceState(null, '', '#doc=' + App.docId); } catch (e) { /* ignora */ }
  }
  App.save();
  App.grid.focus();
})(window.App);
