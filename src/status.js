// Enviar status: agrupa as linhas selecionadas pela coluna REFERENCIA (cada referência = o assunto do e-mail)
// e monta a tabela pronta para colar no corpo
// (cabeçalho vermelho com letras pretas, maiúsculas e em negrito; tudo centralizado) e já copia.
(function (App) {
  'use strict';
  const esc = App.esc;
  const notify = (m) => App.emit('notify', m);
  const doc = App.doc;
  const COLS = ['DATA', 'MODALIDADE', 'DI / DTA', 'CLIENTE', 'REFERENCIA', 'CONTAINER', 'TIPO', 'CAVALO', 'CARRETA', 'MOTORISTA', 'PESO',
    'TERMINAL COLETA', 'DATA / HORA - COLETA', 'ENTREGA - 1', 'ENTREGA - 2', 'CHEGADA NO TERMINAL', 'SAÍDA DO TERMINAL', 'CHEGADA NO CLIENTE',
    'SAÍDA DO CLIENTE', 'OBSERVAÇÃO', 'TERMINAL VAZIO', 'DATA / HORA - DEPOT'];
  const OPTIONAL = new Set(['ENTREGA - 2']); // só entra quando alguma linha tiver
  const ALT = { 'ENTREGA - 1': ['ENTREGA'], 'DI / DTA': ['DI', 'DTA'], 'TERMINAL VAZIO': ['TERMINAL DE VAZIO'], 'OBSERVAÇÃO': ['OBSERVACOES', 'OBS', 'OBS.'],
    'CHEGADA NO TERMINAL': ['CHEGADA NO TERMINAL / EADI'], 'SAÍDA DO TERMINAL': ['SAÍDA DO TERMINAL / EADI'] };
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

  // Monta um bloco por REFERENCIA: o valor da coluna REFERENCIA é o assunto do e-mail
  // e a tabela leva todas as linhas daquela mesma referência (não só as selecionadas).
  function build(opts) {
    opts = opts || {};
    const sh = App.sheet(), si = doc.active;
    const sel = selRows().filter((r) => r > 0);
    if (!sel.length) return null;
    return App.withReal(() => {
      const map = labelMap(sh);
      const named = !!Object.keys(sh.colNames || {}).length;
      // sem nome nas colunas, a linha 1 é o cabeçalho e não entra na tabela
      const picked = sel.filter((r) => !(r === 1 && !named));
      if (!picked.length) return null;
      const refC = map.get(norm('REFERENCIA')) || map.get(norm('REF'));
      const refOf = (r) => cellText(si, sh, r, refC).trim();

      const groups = [];
      if (refC && !opts.selOnly) {
        const used = App.usedRange(sh), first = named ? 1 : 2;
        const byRef = new Map(), order = [];
        for (const r of picked) {
          const k = refOf(r);
          if (!byRef.has(k)) { byRef.set(k, { ref: k, rows: [], sel: new Set() }); order.push(k); }
          byRef.get(k).sel.add(r);
        }
        // junta todas as linhas da página que tenham a mesma referência
        for (let r = first; r <= used.maxR; r++) { const k = refOf(r); if (k && byRef.has(k)) byRef.get(k).rows.push(r); }
        for (const k of order) { const g = byRef.get(k); if (!g.rows.length) g.rows = [...g.sel].sort((x, y) => x - y); groups.push(g); }
      } else {
        groups.push({ ref: refC ? refOf(picked[0]) : '', rows: picked, sel: new Set(picked) });
      }

      const allRows = [...new Set(groups.reduce((a2, g) => a2.concat(g.rows), []))];
      const cols = [];
      for (const name of COLS) {
        let c = map.get(norm(name));
        if (!c) for (const alt of ALT[name] || []) { c = map.get(norm(alt)); if (c) break; }
        // a coluna pode ter um complemento no nome ("CHEGADA NO TERMINAL / EADI"): aceita quem começa igual
        if (!c) { const k = norm(name); if (k.length >= 12) for (const [nk, nc] of map) if (nk.startsWith(k)) { c = nc; break; } }
        if (!c || cols.some((x) => x.c === c) || (App.colBlocked && App.colBlocked(sh, c))) continue;
        if (OPTIONAL.has(name) && !allRows.some((r) => cellText(si, sh, r, c))) continue;
        cols.push({ name, c });
      }
      const tableOf = (rows) => {
        const data = rows.map((r) => cols.map((x) => cellText(si, sh, r, x.c)));
        const html = '<table cellspacing="0" cellpadding="0" border="1" style="border-collapse:collapse;border:1px solid #000000;">'
          + `<tr>${cols.map((x) => `<th bgcolor="#FF0000" style="${TH}">${esc(x.name.toUpperCase())}</th>`).join('')}</tr>`
          + data.map((row) => `<tr>${row.map((v) => `<td align="center" valign="middle" style="${TD}">${esc(v)}</td>`).join('')}</tr>`).join('')
          + '</table>';
        const tsv = [cols.map((x) => x.name.toUpperCase()).join('\t')].concat(data.map((row) => row.join('\t'))).join('\n');
        return { html, tsv, n: data.length };
      };
      return { groups: groups.map((g) => Object.assign({ ref: g.ref, selN: g.sel.size }, tableOf(g.rows))), cols, hasRef: !!refC };
    });
  }

  async function copyText(text) {
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* tenta o jeito antigo */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
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
    let selOnly = false, podeMail = false;
    let t = build({ selOnly });
    if (!t) return notify('Selecione as linhas para enviar o status.');
    if (!t.cols.length) return notify('Esta página não tem as colunas do status (DATA, CLIENTE, CONTAINER…).');
    const m = App.ui.modal({
      title: 'Enviar status', width: 'min(1300px, 97vw)', cls: 'st-modal', enterSubmits: false,
      body: '<p class="st-msg" id="st-msg">Copiando…</p><div id="st-wrap"></div>',
      buttons: [{ label: 'Fechar' }],
    });
    const msg = m.el.querySelector('#st-msg'), wrap = m.el.querySelector('#st-wrap');
    const say = (ok, what) => { msg.className = 'st-msg ' + (ok ? 'ok' : 'err'); msg.textContent = ok ? `✓ ${what} copiado! É só colar no e-mail (Ctrl+V): a tabela vai com o mesmo layout.` : 'Não foi possível copiar sozinho. Use o botão "Copiar tabela" ou selecione a tabela e tecle Ctrl+C.'; };
    const draw = () => {
      m.el.querySelector('.modal-head h2').textContent = t.hasRef && !selOnly
        ? `Enviar status — ${t.groups.length} ${t.groups.length === 1 ? 'referência' : 'referências'}`
        : `Enviar status — ${t.groups[0].n} ${t.groups[0].n === 1 ? 'linha' : 'linhas'}`;
      wrap.innerHTML = `${t.hasRef ? `<label class="inline st-only"><input type="checkbox" id="st-sel"${selOnly ? ' checked' : ''}> Só as linhas que eu selecionei (sem juntar as outras da mesma referência)</label>` : ''}
        ${t.groups.map((g, i) => `<section class="st-grp" data-i="${i}">
          ${t.hasRef ? `<div class="st-gh"><span class="st-sub">Assunto a procurar no e-mail: <b>${esc(g.ref || '(sem referência)')}</b></span>
            <small>${g.n} ${g.n === 1 ? 'linha' : 'linhas'}${!selOnly && g.n !== g.selN ? ` desta referência (${g.selN} ${g.selN === 1 ? 'selecionada' : 'selecionadas'})` : ''}</small>
            ${g.ref ? `<button class="btn btn-sm" data-cs="${i}">Copiar assunto</button>` : ''}
            <button class="btn btn-sm" data-ct="${i}">Copiar tabela</button>
            ${podeMail && g.ref ? `<button class="btn btn-primary btn-sm" data-cm="${i}">✉ Enviar por e-mail</button>` : ''}</div>` : ''}
          <div class="st-box">${g.html}</div></section>`).join('')}`;
      const sel = wrap.querySelector('#st-sel');
      if (sel) sel.onchange = () => { selOnly = sel.checked; t = build({ selOnly }) || t; draw(); };
      wrap.querySelectorAll('[data-ct]').forEach((b) => (b.onclick = () => { const i = +b.dataset.ct; copy(t.groups[i], wrap.querySelectorAll('.st-box')[i]).then((ok) => say(ok, 'Status')); }));
      wrap.querySelectorAll('[data-cs]').forEach((b) => (b.onclick = () => copyText(t.groups[+b.dataset.cs].ref).then((ok) => say(ok, 'Assunto'))));
      wrap.querySelectorAll('[data-cm]').forEach((b) => (b.onclick = () => App.mailSend(t.groups[+b.dataset.cm])));
    };
    draw();
    // o envio por e-mail depende do servidor: aparece assim que a resposta chega
    if (App.mailInfo) App.mailInfo(App.sheet()).then((x) => { if (x && x.configurado && x.podeEnviar && m.el.isConnected) { podeMail = true; draw(); } }).catch(() => {});
    // uma referência só: já copia a tabela, como antes
    if (t.groups.length === 1) copy(t.groups[0], wrap.querySelector('.st-box')).then((ok) => say(ok, 'Status'));
    else msg.className = 'st-msg', msg.textContent = `${t.groups.length} referências selecionadas — cada uma vira um e-mail. Use "Copiar tabela" na que você for enviar.`;
  }

  App.on('contextItems', ({ hit, items }) => {
    if (!['cell', 'fill', 'rowHdr'].includes(hit.area)) return;
    const at = items.findIndex((x) => x === '-');
    items.splice(at >= 0 ? at : items.length, 0, { label: 'Enviar status (copiar tabela para e-mail)', icon: 'comment', cmd: 'sendStatus' });
  });
  App.commands.def('sendStatus', 'Enviar status', sendStatus);
  App.statusTable = build;
})(window.App);
