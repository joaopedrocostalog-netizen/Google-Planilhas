// Enviar status: com as linhas selecionadas, monta uma tabela pronta para colar no e-mail do cliente
// (cabeçalho vermelho com letras pretas, maiúsculas e em negrito; tudo centralizado) e já copia.
(function (App) {
  'use strict';
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);
  const doc = App.doc;
  const COLS = ['DATA', 'MODALIDADE', 'DI / DTA', 'CLIENTE', 'REFERENCIA', 'CONTAINER', 'TIPO', 'CAVALO', 'CARRETA', 'MOTORISTA', 'PESO',
    'TERMINAL COLETA', 'DATA / HORA - COLETA', 'ENTREGA - 1', 'ENTREGA - 2', 'CHEGADA NO TERMINAL', 'SAÍDA DO TERMINAL', 'CHEGADA NO CLIENTE',
    'SAÍDA DO CLIENTE', 'STATUS', 'TERMINAL VAZIO', 'DATA / HORA - DEPOT'];
  const OPTIONAL = new Set(['ENTREGA - 2']); // só entra quando alguma linha tiver
  const ALT = { 'ENTREGA - 1': ['ENTREGA'], 'DI / DTA': ['DI', 'DTA'], 'TERMINAL VAZIO': ['TERMINAL DE VAZIO'] };
  const norm = (s) => (window.Perms && window.Perms.normName ? window.Perms.normName(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));

  function labelMap(sh) {
    const names = sh.colNames || {};
    const maxC = Math.max(App.usedRange(sh).maxC || 0, ...Object.keys(names).map(Number), 1);
    const m = new Map();
    for (let c = 1; c <= maxC; c++) { const k = norm(names[c] || App.raw(sh, 1, c)); if (k && !m.has(k)) m.set(k, c); }
    return m;
  }
  function selRows() {
    const rows = new Set();
    for (const R of (App.selRects ? App.selRects() : [App.selRect()])) {
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 500); r++) { const p = App.realCell ? App.realCell(r, R.c1) : { r }; if (p) rows.add(p.r); }
    }
    return [...rows].sort((a, b) => a - b);
  }
  const cellText = (si, sh, r, c) => {
    const v = App.value(si, r, c);
    if (v === null || v === undefined || (App.E.isErr && App.E.isErr(v))) return '';
    const nf = App.style(sh, r, c).nf;
    // sem formato na célula: vai do jeito que foi digitado (datas e pesos não viram número cru)
    const raw = App.raw(sh, r, c);
    if (!nf && typeof v === 'number' && typeof raw === 'string' && raw.trim() && raw.trim()[0] !== '=') return raw.trim();
    return String(App.fmtValue(v, nf)).trim();
  };

  const TH = 'background:#FF0000;color:#000000;font-weight:bold;text-align:center;vertical-align:middle;border:1px solid #000000;padding:3px 8px;white-space:nowrap;font-family:Calibri,Arial,sans-serif;font-size:11pt;';
  const TD = 'background:#FFFFFF;color:#000000;text-align:center;vertical-align:middle;border:1px solid #000000;padding:3px 8px;white-space:nowrap;font-family:Calibri,Arial,sans-serif;font-size:11pt;';

  function build() {
    const sh = App.sheet(), si = doc.active;
    const rows = selRows().filter((r) => r > 0);
    if (!rows.length) return null;
    return App.withReal(() => {
      const map = labelMap(sh);
      const cols = [];
      for (const name of COLS) {
        let c = map.get(norm(name));
        if (!c) for (const alt of ALT[name] || []) { c = map.get(norm(alt)); if (c) break; }
        if (!c || cols.some((x) => x.c === c) || (App.colBlocked && App.colBlocked(sh, c))) continue;
        if (OPTIONAL.has(name) && !rows.some((r) => cellText(si, sh, r, c))) continue;
        cols.push({ name, c });
      }
      // linhas de cabeçalho (sem nome de coluna, a linha 1 é cabeçalho) não entram
      const data = rows.filter((r) => !(r === 1 && !Object.keys(sh.colNames || {}).length)).map((r) => cols.map((x) => cellText(si, sh, r, x.c)));
      const html = `<table cellspacing="0" cellpadding="0" border="1" style="border-collapse:collapse;border:1px solid #000000;">`
        + `<tr>${cols.map((x) => `<th bgcolor="#FF0000" style="${TH}">${esc(x.name.toUpperCase())}</th>`).join('')}</tr>`
        + data.map((row) => `<tr>${row.map((v) => `<td align="center" valign="middle" style="${TD}">${esc(v)}</td>`).join('')}</tr>`).join('')
        + '</table>';
      const tsv = [cols.map((x) => x.name.toUpperCase()).join('\t')].concat(data.map((row) => row.join('\t'))).join('\n');
      return { html, tsv, n: data.length, cols };
    });
  }

  async function copy(t, box) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([t.html], { type: 'text/html' }), 'text/plain': new Blob([t.tsv], { type: 'text/plain' }) })]);
        return true;
      }
    } catch (e) { /* tenta o jeito antigo */ }
    // seleciona a tabela mostrada e copia (mantém a formatação)
    try {
      const range = document.createRange();
      range.selectNode(box.querySelector('table'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      const ok = document.execCommand('copy');
      s.removeAllRanges();
      return ok;
    } catch (e) { return false; }
  }

  function sendStatus() {
    const t = build();
    if (!t) return notify('Selecione as linhas para enviar o status.');
    if (!t.cols.length) return notify('Esta página não tem as colunas do status (DATA, CLIENTE, CONTAINER…).');
    const m = App.ui.modal({
      title: `Enviar status — ${t.n} ${t.n === 1 ? 'linha' : 'linhas'}`, width: 'min(1300px, 97vw)', cls: 'st-modal', enterSubmits: false,
      body: `<p class="st-msg" id="st-msg">Copiando…</p><div class="st-box" id="st-box">${t.html}</div>`,
      buttons: [{ label: 'Fechar' }, { label: 'Copiar de novo', primary: true, action: (d) => { copy(t, d.querySelector('#st-box')).then((ok) => say(ok)); return false; } }],
    });
    const msg = m.el.querySelector('#st-msg');
    const say = (ok) => { msg.className = 'st-msg ' + (ok ? 'ok' : 'err'); msg.textContent = ok ? '✓ Copiado! É só colar no e-mail (Ctrl+V): a tabela vai com o mesmo layout.' : 'Não foi possível copiar sozinho. Clique em "Copiar de novo" ou selecione a tabela e use Ctrl+C.'; };
    copy(t, m.el.querySelector('#st-box')).then(say);
  }

  App.on('contextItems', ({ hit, items }) => {
    if (!['cell', 'fill', 'rowHdr'].includes(hit.area)) return;
    const at = items.findIndex((x) => x === '-');
    items.splice(at >= 0 ? at : items.length, 0, { label: 'Enviar status (copiar tabela para e-mail)', icon: 'comment', cmd: 'sendStatus' });
  });
  App.commands.def('sendStatus', 'Enviar status', sendStatus);
  App.statusTable = build;
})(window.App);
