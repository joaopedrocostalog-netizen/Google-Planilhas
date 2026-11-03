// Validação de dados "Data com horário inicial e final": a célula abre um calendário com hora inicial e final
// e mostra exatamente assim: 03/11/2026 15:00 ÁS 16:00
(function (App) {
  'use strict';
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);
  const SEP = ' ÁS ';
  const RE = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) ÁS (\d{2}):(\d{2})$/;
  App.DTRANGE_RE = RE;

  const pad = (n) => String(n).padStart(2, '0');
  function parse(text) {
    const m = RE.exec(String(text || '').trim());
    if (!m) return null;
    return { date: `${m[3]}-${m[2]}-${m[1]}`, t1: `${m[4]}:${m[5]}`, t2: `${m[6]}:${m[7]}` };
  }
  function format(date, t1, t2) {
    const [y, mo, d] = date.split('-');
    return `${d}/${mo}/${y} ${t1}${SEP}${t2}`;
  }
  App.dtrangeFormat = format;

  // abre o calendário em vez do editor de texto (coordenadas reais da célula e de tela)
  App.dtPickerFor = (sh, real, r, c) => {
    const d = App.withReal(() => App.dvAt(sh, real.r, real.c));
    if (!d || d.type !== 'dtrange') return false;
    open(sh, real, r, c);
    return true;
  };
  App.on('dtpicker', ({ r, c }) => {
    const sh = App.sheet();
    const real = App.realCell ? App.realCell(r, c) : { r, c };
    if (!real) return;
    if (App.editGuard) { const err = App.editGuard(sh, r, c); if (err) return notify(err); }
    if (App.lockGuard && App.lockGuard(sh, r, c)) return;
    open(sh, real, r, c);
  });

  function open(sh, real, r, c) {
    const cur = parse(App.withReal(() => App.raw(sh, real.r, real.c)));
    const now = new Date();
    const date = cur ? cur.date : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const t1 = cur ? cur.t1 : `${pad(now.getHours())}:00`;
    const t2 = cur ? cur.t2 : `${pad(Math.min(23, now.getHours() + 1))}:00`;
    const box = document.createElement('div');
    box.className = 'dtr-pop';
    box.innerHTML = `<label class="field"><span>Data</span><input class="input" type="date" id="dtr-date" value="${esc(date)}"></label>
      <div class="dtr-times"><label class="field"><span>Das</span><input class="input" type="time" id="dtr-t1" value="${esc(t1)}"></label>
      <label class="field"><span>Às</span><input class="input" type="time" id="dtr-t2" value="${esc(t2)}"></label></div>
      <div class="dtr-prev" id="dtr-prev"></div>
      <div class="dtr-btns"><button class="btn btn-sm" id="dtr-clear">Limpar</button><button class="btn btn-primary btn-sm" id="dtr-ok">OK</button></div>`;
    const rc = App.grid.cellRect(r, c);
    const wr = document.getElementById('grid-wrap').getBoundingClientRect();
    App.ui.popup({ x: wr.left + rc.x, y: wr.top + rc.y + rc.h + 2 }, box);
    const q = (id) => box.querySelector(id);
    const prev = () => { const ok = q('#dtr-date').value && q('#dtr-t1').value && q('#dtr-t2').value; q('#dtr-prev').textContent = ok ? format(q('#dtr-date').value, q('#dtr-t1').value, q('#dtr-t2').value) : 'Preencha a data e os horários'; };
    ['#dtr-date', '#dtr-t1', '#dtr-t2'].forEach((id) => { q(id).oninput = prev; q(id).onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') { App.ui.closePopup(); App.grid.focus(); } }; });
    prev();
    const write = (value) => {
      App.ui.closePopup();
      App.change('Data e horário', () => App.withReal(() => App.setRaw(sh, real.r, real.c, value)));
      App.grid.focus();
    };
    function save() {
      const d = q('#dtr-date').value, a = q('#dtr-t1').value, b = q('#dtr-t2').value;
      if (!d || !a || !b) return notify('Preencha a data, a hora inicial e a hora final.');
      if (b < a) return notify('A hora final precisa ser depois da hora inicial.');
      write(format(d, a, b));
    }
    q('#dtr-ok').onclick = save;
    q('#dtr-clear').onclick = () => write('');
    setTimeout(() => q('#dtr-date').focus(), 20);
  }
})(window.App);
