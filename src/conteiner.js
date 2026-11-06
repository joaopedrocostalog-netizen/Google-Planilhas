// Validação do número do container (padrão ISO 6346): 4 letras (3 do dono + U/J/Z), 6 números de série e o
// dígito verificador. Vale nas colunas CONTAINER, 1 - CONTAINER e 2 - CONTAINER de qualquer aba.
// Número errado ganha um sublinhado ondulado vermelho (como corretor ortográfico); ao passar o mouse aparece
// o motivo, e ao digitar/colar um número errado a planilha avisa na hora. Nada é bloqueado: é só um alerta.
(function (App) {
  'use strict';
  const E = App.E, doc = App.doc;
  const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // valor de cada letra no ISO 6346 (pula os múltiplos de 11)
  const VAL = {};
  (() => { let v = 10; for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (v % 11 === 0) v++; VAL[ch] = v++; } })();
  function digito(n10) {
    let soma = 0;
    for (let i = 0; i < 10; i++) { const ch = n10[i]; soma += (/\d/.test(ch) ? +ch : VAL[ch]) * Math.pow(2, i); }
    return (soma % 11) % 10;
  }
  // confere um texto (pode ter mais de um container: "MSCU1234567 / TGHU7654321"); devolve o primeiro problema
  const memo = new Map();
  function confere(texto) {
    const t = String(texto === null || texto === undefined ? '' : texto).trim();
    if (!t) return null;
    if (memo.has(t)) return memo.get(t);
    let erro = null;
    for (const parte of t.toUpperCase().split(/[\/;,\n]|\s+E\s+/)) {
      const n = norm(parte);
      if (!n || !/[A-Z]{3}/.test(n) || !/\d{4}/.test(n)) continue; // não parece um container (ex.: 40HC)
      if (!/^[A-Z]{4}\d{7}$/.test(n)) { erro = { cont: parte.trim(), titulo: 'Número de container fora do padrão', msg: 'O container tem 4 letras e 7 números (ex.: CSQU 305438-3).' }; break; }
      if (!'UJZ'.includes(n[3])) { erro = { cont: n, titulo: 'Número de container fora do padrão', msg: `A 4ª letra deve ser U, J ou Z (está "${n[3]}").` }; break; }
      const d = digito(n);
      if (d !== +n[10]) { erro = { cont: n, titulo: 'Dígito verificador não confere', msg: `Em ${n.slice(0, 10)}-${n[10]} o último número deveria ser ${d}. Confira se não houve erro de digitação.` }; break; }
    }
    if (memo.size > 5000) memo.clear();
    memo.set(t, erro);
    return erro;
  }

  // colunas de container de cada aba (pelo cabeçalho); recalcula quando a planilha muda
  const cache = new Map();
  const ehColuna = (k) => k === 'CONTAINER' || /^[12]CONTAINER$/.test(k) || /^(N|NO|NUM|NUMERO)CONTAINER$/.test(k);
  function colunas(sh) {
    let c = cache.get(sh.id);
    if (c) return c;
    const hdr = new Map();
    for (const a in sh.cells) {
      const p = E.parseAddr(a);
      if (!p || p.row > 15) continue;
      const k = norm(sh.cells[a].v).replace(/^(\d)(CONTAINER)$/, '$1$2');
      if (ehColuna(k)) { if (!hdr.has(p.col) || p.row < hdr.get(p.col)) hdr.set(p.col, p.row); }
    }
    for (const k in sh.colNames || {}) if (ehColuna(norm(sh.colNames[k]))) hdr.set(+k, 0);
    c = hdr;
    cache.set(sh.id, c);
    return c;
  }
  App.on('change', () => cache.clear());
  App.on('sheet', () => cache.clear());

  // usado pela grade e pela dica: problema do container nesta célula (linha/coluna reais) ou null
  App.containerCheck = (sh, si, r, c) => {
    if (!sh) return null;
    const cols = colunas(sh);
    if (!cols.has(c) || r <= cols.get(c)) return null;
    const x = sh.cells[E.addrToStr(r, c)];
    if (!x || x.v === '' || x.v === undefined || x.v === null) return null;
    const v = typeof x.v === 'string' && x.v[0] === '=' ? App.value(si, r, c) : x.v;
    return confere(v);
  };
  App.containerDigito = (n) => { const s = norm(n); return /^[A-Z]{4}\d{6}/.test(s) ? digito(s.slice(0, 10)) : null; };

  // ao digitar ou colar: avisa na hora (uma vez por alteração)
  App.on('localPatch', (fwd) => {
    if (!fwd || !fwd.sheets) return;
    const erros = [];
    for (const id in fwd.sheets) {
      const e = fwd.sheets[id];
      if (!e.cells) continue;
      const sh = doc.sheets.find((x) => x.id === id);
      if (!sh) continue;
      const si = doc.sheets.indexOf(sh);
      for (const a in e.cells) {
        if (!e.cells[a] || !('v' in e.cells[a])) continue;
        const p = E.parseAddr(a);
        const er = p && App.containerCheck(sh, si, p.row, p.col);
        if (er) erros.push(er);
      }
    }
    if (!erros.length) return;
    const msg = erros.length === 1 ? `${erros[0].titulo}: ${erros[0].cont}. ${erros[0].msg}` : `${erros.length} containers com número inválido (ex.: ${erros[0].cont}). Passe o mouse no sublinhado vermelho para ver o motivo.`;
    setTimeout(() => App.emit('notify', msg), 80);
  });

  // no celular (sem mouse): ao tocar numa célula com container errado, mostra o motivo uma vez
  const avisados = new Set();
  App.on('selection', () => {
    if (!document.body.classList.contains('touch') || !App.sel) return;
    const s = App.sel;
    if (s.ar !== s.er || s.ac !== s.ec) return;
    const sh = App.sheet();
    const er = App.withReal(() => { const p = App.realCell ? App.realCell(s.ar, s.ac) : { r: s.ar, c: s.ac }; return p ? App.containerCheck(sh, doc.active, p.r, p.c) : null; });
    if (!er || avisados.has(er.cont)) return;
    avisados.add(er.cont);
    App.emit('notify', `${er.titulo}: ${er.cont}. ${er.msg}`);
  });
  App.containerConfere = confere;
})(window.App);
