// Celular e tablet (toque): editar com toque, menu com toque longo, pinça para zoom da grade e teclado só quando precisa.
// - 1 toque seleciona a célula; tocar de novo na célula já selecionada abre a edição (com o teclado).
// - Segurar o dedo (meio segundo) abre o mesmo menu do botão direito.
// - Pinça com dois dedos na grade muda o zoom da planilha (50% a 200%), e não da página inteira.
// - O campo escondido que recebe as teclas não abre o teclado do celular a cada toque (inputmode="none").
(function (App) {
  'use strict';
  const touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  if (!touch) return;
  document.body.classList.add('touch');
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (standalone) document.body.classList.add('standalone');

  function init() {
    const focus = document.getElementById('grid-focus');
    if (focus) focus.setAttribute('inputmode', 'none');
    const wrap = document.getElementById('grid-wrap'), scroller = document.getElementById('grid-scroll');
    if (!wrap || !scroller || !App.grid) return;
    const posOf = (t) => { const rc = wrap.getBoundingClientRect(); return { x: t.clientX - rc.left, y: t.clientY - rc.top }; };
    const editing = () => !!(App.editing && App.editing());

    let start = null, longTimer = null, longFired = false, pinch = null;
    const cancelLong = () => { clearTimeout(longTimer); longTimer = null; };

    scroller.addEventListener('touchstart', (e) => {
      longFired = false;
      if (e.touches.length === 2) {
        cancelLong(); start = null;
        const [a, b] = e.touches;
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: App.doc.zoom || 100 };
        return;
      }
      if (e.touches.length !== 1) { cancelLong(); start = null; return; }
      const t = e.touches[0];
      const s = App.sel || {};
      start = { x: t.clientX, y: t.clientY, at: Date.now(), was: s.ar === s.er && s.ac === s.ec ? { r: s.ar, c: s.ac } : null };
      cancelLong();
      longTimer = setTimeout(() => {
        if (!start) return;
        longFired = true;
        const p = posOf({ clientX: start.x, clientY: start.y }), h = App.grid.hit(p.x, p.y);
        if (h.area === 'cell') {
          const inSel = (App.selRects ? App.selRects() : [App.selRect()]).some((R) => App.inRect(R, h.r, h.c));
          if (!inSel) { if (editing()) App.commitEdit(); App.grid.select(h.r, h.c, false, true); }
        }
        if (navigator.vibrate) navigator.vibrate(10);
        App.emit('contextMenu', { hit: h, x: start.x, y: start.y });
      }, 520);
    }, { passive: true });

    scroller.addEventListener('touchmove', (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const z = Math.max(50, Math.min(200, Math.round((pinch.z * d / pinch.d) / 5) * 5));
        if (z !== App.doc.zoom) { App.doc.zoom = z; App.grid.layout(); App.emit('zoom'); }
        return;
      }
      if (start && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) { cancelLong(); start = null; }
      }
    }, { passive: false });

    scroller.addEventListener('touchend', (e) => {
      cancelLong();
      if (pinch) { if (e.touches.length < 2) { const z = App.doc.zoom; pinch = null; App.run('zoom', z); } start = null; return; }
      if (longFired) { e.preventDefault(); longFired = false; start = null; return; } // não vira clique depois do menu
      if (!start || e.changedTouches.length !== 1 || Date.now() - start.at > 450 || editing()) { start = null; return; }
      const p = posOf(e.changedTouches[0]), h = App.grid.hit(p.x, p.y);
      const was = start.was;
      start = null;
      // 2º toque na célula já selecionada: edita (o foco precisa acontecer aqui, no toque, para o iPhone abrir o teclado)
      if (h.area === 'cell' && was && was.r === h.r && was.c === h.c) {
        const info = App.cellInfo(h.r, h.c);
        if (info.dv && (info.dv.type === 'checkbox' || info.dv.type === 'list' || info.dv.type === 'range')) return; // caixa e lista têm o próprio toque
        e.preventDefault();
        App.startEdit({ mode: 'edit' });
      }
    }, { passive: false });
    scroller.addEventListener('touchcancel', () => { cancelLong(); start = null; pinch = null; });

    // menus de cima: o menu aberto rola junto para ficar visível
    const mb = document.getElementById('menubar');
    if (mb) mb.addEventListener('click', (e) => { const b = e.target.closest('.mb'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})(window.App);
