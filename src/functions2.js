// Biblioteca de funções (parte 2): texto, data e hora, informações, finanças
// e o formatador de números (códigos como "#,##0.00", "dd/mm/aaaa", "0%").
(function () {
  'use strict';
  const E = window.GridEngine;
  const { evaluate: ev, scalarOf, isErr, ERR, mkErr, Matrix, def, alias, isArr, toMatrix } = E;
  const N = E.toNumber, S = E.toStr, B = E.toBool;
  const { has, val, num, str, bool, nums, elementwise, need } = E.helpers;
  const s1 = (f) => elementwise((x, ...r) => f(S(x === undefined ? '' : x), ...r));
  const opt = (v, d) => (v === undefined ? d : N(v));

  // ---------- Formatador de números ----------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  function splitSections(code) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') q = !q;
      if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
      if (ch === ';' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  // Remove textos literais para analisar os marcadores
  const stripLiterals = (s) => s.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? m : ''));

  function formatDateCode(v, code) {
    const d = E.serialToDate(v);
    const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate(), W = d.getUTCDay();
    let h = d.getUTCHours(), mi = d.getUTCMinutes(), se = d.getUTCSeconds();
    const ampm = /AM\/PM|A\/P/i.test(code);
    const hourDisp = ampm ? (h % 12 || 12) : h;
    let out = '';
    const toks = code.match(/"[^"]*"|\\.|\[h+\]|\[m+\]|\[s+\]|AM\/PM|A\/P|y+|a+(?![m\/])|m+|d+|h+|s+|\.0+|./gi) || [];
    let lastWasHour = false;
    toks.forEach((t, idx) => {
      const lower = t.toLowerCase();
      if (t[0] === '"') { out += t.slice(1, -1); return; }
      if (t[0] === '\\') { out += t[1]; return; }
      if (/^\[h+\]$/.test(lower)) { out += String(Math.floor(v * 24)).padStart(lower.length - 2, '0'); lastWasHour = true; return; }
      if (/^\[m+\]$/.test(lower)) { out += String(Math.floor(v * 1440)).padStart(lower.length - 2, '0'); return; }
      if (/^\[s+\]$/.test(lower)) { out += String(Math.round(v * 86400)).padStart(lower.length - 2, '0'); return; }
      if (lower === 'am/pm') { out += h < 12 ? 'AM' : 'PM'; return; }
      if (lower === 'a/p') { out += h < 12 ? 'A' : 'P'; return; }
      if (lower[0] === 'y' || lower[0] === 'a') { out += lower.length <= 2 ? String(Y).slice(-2) : String(Y); return; }
      if (lower[0] === 'd') {
        if (lower.length === 1) out += D;
        else if (lower.length === 2) out += String(D).padStart(2, '0');
        else if (lower.length === 3) out += DIAS[W].slice(0, 3);
        else out += DIAS[W];
        return;
      }
      if (lower[0] === 'h') { out += lower.length > 1 ? String(hourDisp).padStart(2, '0') : hourDisp; lastWasHour = true; return; }
      if (lower[0] === 's') { out += lower.length > 1 ? String(se).padStart(2, '0') : se; lastWasHour = false; return; }
      if (lower[0] === 'm') {
        // "m" depois de hora ou antes de segundos = minutos
        const nextS = toks.slice(idx + 1).find((x) => /^[a-z]/i.test(x) && !/^[:\s]/.test(x));
        const isMin = lastWasHour || (nextS && nextS.toLowerCase()[0] === 's');
        if (isMin && lower.length <= 2) { out += lower.length > 1 ? String(mi).padStart(2, '0') : mi; lastWasHour = false; return; }
        if (lower.length === 1) out += Mo + 1;
        else if (lower.length === 2) out += String(Mo + 1).padStart(2, '0');
        else if (lower.length === 3) out += MESES[Mo].slice(0, 3);
        else if (lower.length === 5) out += MESES[Mo][0];
        else out += MESES[Mo];
        return;
      }
      if (/^\.0+$/.test(lower)) { out += ',' + String(Math.round((v * 86400 % 1) * Math.pow(10, lower.length - 1))).padStart(lower.length - 1, '0'); return; }
      out += t;
    });
    return out;
  }

  function formatNumberCode(v, code) {
    // separa prefixo literal, padrão numérico e sufixo literal
    let pre = '', pat = '', suf = '', q = false, stage = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') { q = !q; continue; }
      if (q) { (stage === 0 ? (pre += ch) : (suf += ch)); continue; }
      if (ch === '\\') { const x = code[i + 1] || ''; i++; (stage === 0 ? (pre += x) : stage === 1 ? (pat += '\u0000' + x) : (suf += x)); continue; }
      if (ch === '[') { const j = code.indexOf(']', i); if (j > i) { i = j; continue; } }
      if ('0#?.,'.includes(ch) || (stage === 1 && /[eE+\-]/.test(ch) && /E[+-]?0/i.test(code.slice(i - (ch === 'E' || ch === 'e' ? 0 : 1))))) {
        if (stage === 2) { suf += ch; continue; }
        stage = 1; pat += ch; continue;
      }
      if (ch === '%') { if (stage === 0) pre += '%'; else { stage = 2; suf += '%'; } continue; }
      if (ch === '_' || ch === '*') { i++; (stage === 0 ? (pre += ' ') : (suf += ' ')); continue; }
      if (stage === 1) stage = 2;
      (stage === 0 ? (pre += ch) : (suf += ch));
    }
    pat = pat.replace(/\u0000./g, '');
    const pct = (pre + suf).split('%').length - 1;
    let x = v * Math.pow(100, pct);
    // notação científica
    const sci = /E[+-]?(0+)/i.exec(pat);
    if (sci) {
      const mant = pat.slice(0, sci.index);
      const dec = (mant.split('.')[1] || '').length;
      const [m, e] = x.toExponential(dec).split('e');
      const en = parseInt(e, 10);
      return pre + m.replace('.', ',') + 'E' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(sci[1].length, '0') + suf;
    }
    // detecta estilo pt-BR ("#.##0,00") e normaliza para o estilo internacional
    const lastDot = pat.lastIndexOf('.'), lastComma = pat.lastIndexOf(',');
    if (lastComma > lastDot && /[0#?]/.test(pat.slice(lastComma + 1))) pat = pat.replace(/\./g, '\u0001').replace(/,/g, '.').replace(/\u0001/g, ',');
    // vírgulas no fim dividem por mil
    let scale = 0;
    while (/,$/.test(pat)) { pat = pat.slice(0, -1); scale++; }
    x /= Math.pow(1000, scale);
    const [ip, fp = ''] = pat.split('.');
    const grouping = ip.includes(',');
    const minInt = (ip.match(/0/g) || []).length;
    const maxDec = (fp.match(/[0#?]/g) || []).length;
    const minDec = (fp.match(/0/g) || []).length;
    const neg = x < 0;
    let abs = Math.abs(x);
    let s = abs.toFixed(maxDec);
    let [intS, decS = ''] = s.split('.');
    while (decS.length > minDec && decS.endsWith('0')) decS = decS.slice(0, -1);
    if (intS === '0' && minInt === 0) intS = '';
    intS = intS.padStart(minInt, '0');
    if (grouping) intS = intS.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    let body = intS + (decS ? ',' + decS : (pat.includes('.') && maxDec === 0 ? '' : ''));
    if (body === '') body = '0';
    return (neg ? '-' : '') + pre + body + suf;
  }

  // Formata um valor com um código de formato. Retorna texto.
  function formatValue(v, code) {
    if (v === null || v === undefined) return '';
    if (isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    const secs = splitSections(code || 'General');
    if (typeof v === 'string') {
      const ts = secs[3] !== undefined ? secs[3] : (secs.length === 1 && secs[0].includes('@') ? secs[0] : null);
      return ts ? ts.replace(/"([^"]*)"/g, '$1').replace(/@/g, v) : v;
    }
    let sec = secs[0], x = v;
    if (v < 0 && secs[1] !== undefined) { sec = secs[1]; x = -v; }
    else if (v === 0 && secs[2] !== undefined) sec = secs[2];
    if (/^\s*(general|geral|automático)\s*$/i.test(sec) || sec === '') {
      return x.toLocaleString('pt-BR', { maximumFractionDigits: 10, useGrouping: false });
    }
    const bare = stripLiterals(sec);
    if (/[dyhs]|a{2,}|AM\/PM|\[h+\]/i.test(bare) || (/m/i.test(bare) && !/[0#]/.test(bare))) return formatDateCode(x, sec);
    return formatNumberCode(x, sec);
  }
  E.formatValue = formatValue;

  // ---------- Texto ----------
  const T = 'Texto';
  def('CONCATENATE', 'CONCATENAR', 'texto1; [texto2; …]', 'Junta vários textos em um só.', (a, c) => E.flat(a, c).map((x) => S(x.v)).join(''), T);
  def('CONCAT', 'CONCAT', 'valor1; valor2', 'Junta dois valores.', (a, c) => E.flat(a, c).map((x) => S(x.v)).join(''), T);
  def('TEXTJOIN', 'TEXTJOIN', 'delimitador; ignorar_vazio; texto1; [texto2; …]', 'Junta textos com um delimitador.', (a, c) => {
    const d = str(a, 0, c, ''), ign = bool(a, 1, c, true);
    return E.flat(a.slice(2), c).map((x) => x.v).filter((v) => !ign || (v !== null && v !== '')).map(S).join(d);
  }, T);
  alias('UNIRTEXTO', 'TEXTJOIN');
  def('JOIN', 'JOIN', 'delimitador; valor1; [valor2; …]', 'Junta os valores de matrizes com um delimitador.', (a, c) => {
    const d = str(a, 0, c, '');
    return E.flat(a.slice(1), c).map((x) => S(x.v)).join(d);
  }, T);
  def('SPLIT', 'SPLIT', 'texto; delimitador; [dividir_por_cada]; [remover_vazio]', 'Divide um texto em várias células.', (a, c) => {
    const t = str(a, 0, c, ''), d = str(a, 1, c, ','), each = bool(a, 2, c, true), rm = bool(a, 3, c, true);
    let parts;
    if (each && d.length > 1) parts = t.split(new RegExp('[' + d.replace(/[\]\\^-]/g, '\\$&') + ']'));
    else parts = t.split(d);
    if (rm) parts = parts.filter((p) => p !== '');
    if (!parts.length) parts = [''];
    return new Matrix([parts.map((p) => { const l = E.parseLiteral(p); return typeof l.v === 'number' ? l.v : p; })]);
  }, T);
  def('LEN', 'NÚM.CARACT', 'texto', 'Retorna o número de caracteres.', s1((s) => s.length), T);
  alias('NUM.CARACT', 'LEN');
  def('UPPER', 'MAIÚSCULA', 'texto', 'Converte para maiúsculas.', s1((s) => s.toUpperCase()), T);
  def('LOWER', 'MINÚSCULA', 'texto', 'Converte para minúsculas.', s1((s) => s.toLowerCase()), T);
  alias('MAIUSCULA', 'UPPER'); alias('MAIUSC', 'UPPER'); alias('MINUSCULA', 'LOWER'); alias('MINUSC', 'LOWER');
  def('PROPER', 'PRI.MAIÚSCULA', 'texto', 'Primeira letra de cada palavra em maiúscula.', s1((s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, x, y) => x + y.toUpperCase())), T);
  alias('PRI.MAIUSCULA', 'PROPER');
  def('TRIM', 'ARRUMAR', 'texto', 'Remove espaços extras.', s1((s) => s.trim().replace(/ +/g, ' ')), T);
  def('CLEAN', 'TIRAR', 'texto', 'Remove caracteres não imprimíveis.', s1((s) => s.replace(/[\x00-\x1f]/g, '')), T);
  def('LEFT', 'ESQUERDA', 'texto; [número_de_caracteres]', 'Retorna caracteres do início do texto.', s1((s, n) => { const k = opt(n, 1); if (k < 0) throw ERR.VALUE; return s.slice(0, k); }), T);
  def('RIGHT', 'DIREITA', 'texto; [número_de_caracteres]', 'Retorna caracteres do fim do texto.', s1((s, n) => { const k = opt(n, 1); if (k < 0) throw ERR.VALUE; return k ? s.slice(-k) : ''; }), T);
  def('MID', 'EXT.TEXTO', 'texto; início; extensão', 'Retorna um trecho do meio do texto.', s1((s, st, n) => {
    const a = N(st), l = N(n);
    if (a < 1 || l < 0) throw ERR.VALUE;
    return s.substr(a - 1, l);
  }), T);
  def('SUBSTITUTE', 'SUBSTITUIR', 'texto; pesquisa; substituição; [ocorrência]', 'Substitui um trecho de texto por outro.', s1((s, o, n, k) => {
    const old = S(o), nw = S(n === undefined ? '' : n);
    if (old === '') return s;
    if (k === undefined) return s.split(old).join(nw);
    let idx = -1, cnt = 0;
    for (;;) { idx = s.indexOf(old, idx + 1); if (idx < 0) return s; if (++cnt === N(k)) return s.slice(0, idx) + nw + s.slice(idx + old.length); }
  }), T);
  def('REPLACE', 'MUDAR', 'texto; posição; extensão; novo_texto', 'Substitui parte de um texto por posição.', s1((s, p, l, n) => s.slice(0, N(p) - 1) + S(n) + s.slice(N(p) - 1 + N(l))), T);
  def('REPT', 'REPT', 'texto; vezes', 'Repete um texto.', s1((s, n) => { const k = N(n); if (k < 0 || k * s.length > 32000) throw ERR.VALUE; return s.repeat(Math.floor(k)); }), T);
  def('FIND', 'PROCURAR', 'pesquisa; texto; [início]', 'Posição de um texto dentro de outro (diferencia maiúsculas).', elementwise((p, t, st) => {
    const i = S(t).indexOf(S(p), opt(st, 1) - 1);
    if (i < 0) throw mkErr('#VALUE!', `Não foi encontrado "${S(p)}" em PROCURAR.`);
    return i + 1;
  }), T);
  def('SEARCH', 'LOCALIZAR', 'pesquisa; texto; [início]', 'Posição de um texto dentro de outro (sem diferenciar maiúsculas).', elementwise((p, t, st) => {
    const i = S(t).toLowerCase().indexOf(S(p).toLowerCase(), opt(st, 1) - 1);
    if (i < 0) throw mkErr('#VALUE!', `Não foi encontrado "${S(p)}" em LOCALIZAR.`);
    return i + 1;
  }), T);
  def('EXACT', 'EXATO', 'texto1; texto2', 'Verifica se dois textos são idênticos.', elementwise((x, y) => S(x) === S(y)), T);
  def('CHAR', 'CARACT', 'número', 'Caractere correspondente a um código.', elementwise((x) => String.fromCharCode(N(x))), T);
  def('CODE', 'CÓDIGO', 'texto', 'Código do primeiro caractere.', s1((s) => { if (!s) throw ERR.VALUE; return s.charCodeAt(0); }), T);
  alias('CODIGO', 'CODE');
  def('T', 'T', 'valor', 'Retorna o texto, ou vazio se não for texto.', elementwise((x) => (typeof x === 'string' ? x : '')), T);
  def('N', 'N', 'valor', 'Converte um valor em número.', elementwise((x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0)), T);
  def('VALUE', 'VALOR', 'texto', 'Converte um texto em número.', elementwise((x) => N(x)), T);
  def('TEXT', 'TEXTO', 'número; formato', 'Converte um número em texto de acordo com um formato.', elementwise((x, f) => formatValue(typeof x === 'string' && typeof E.parseLiteral(x).v === 'number' ? E.parseLiteral(x).v : x, S(f))), T);
  def('FIXED', 'DEF.NÚM.DEC', 'número; [casas]; [sem_separador]', 'Formata um número com casas decimais fixas.', elementwise((x, d, ns) => {
    const k = opt(d, 2);
    return N(x).toLocaleString('pt-BR', { minimumFractionDigits: Math.max(0, k), maximumFractionDigits: Math.max(0, k), useGrouping: !(ns && B(ns)) });
  }), T);
  def('DOLLAR', 'MOEDA', 'número; [casas]', 'Formata como moeda (R$).', elementwise((x, d) => {
    const k = opt(d, 2);
    return 'R$ ' + N(x).toLocaleString('pt-BR', { minimumFractionDigits: Math.max(0, k), maximumFractionDigits: Math.max(0, k) });
  }), T);
  def('REGEXMATCH', 'REGEXMATCH', 'texto; expressão_regular', 'Verifica se um texto corresponde a uma expressão regular.', s1((s, r) => {
    try { return new RegExp(S(r)).test(s); } catch (e) { throw mkErr('#REF!', 'Expressão regular inválida.'); }
  }), T);
  def('REGEXEXTRACT', 'REGEXEXTRACT', 'texto; expressão_regular', 'Extrai a primeira correspondência de uma expressão regular.', s1((s, r) => {
    let m;
    try { m = new RegExp(S(r)).exec(s); } catch (e) { throw mkErr('#REF!', 'Expressão regular inválida.'); }
    if (!m) throw mkErr('#N/A', 'REGEXEXTRACT não encontrou correspondência.');
    return m.length > 1 ? m[1] : m[0];
  }), T);
  def('REGEXREPLACE', 'REGEXREPLACE', 'texto; expressão_regular; substituição', 'Substitui trechos que correspondem a uma expressão regular.', s1((s, r, n) => {
    try { return s.replace(new RegExp(S(r), 'g'), S(n).replace(/\$(\d)/g, '$$$1')); } catch (e) { throw mkErr('#REF!', 'Expressão regular inválida.'); }
  }), T);

  // ---------- Data e hora ----------
  const D = 'Data';
  const today = () => { const d = new Date(); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - E.EPOCH) / 86400000; };
  const ymd = (y, m, d) => (Date.UTC(y, m - 1, d) - E.EPOCH) / 86400000;
  const parts = (s) => { const d = E.serialToDate(s); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay(), date: d }; };
  const dnum = (x) => { if (typeof x === 'string') { const l = E.parseLiteral(x); if (typeof l.v === 'number') return l.v; } return N(x); };
  def('TODAY', 'HOJE', '', 'Retorna a data atual.', () => today(), D);
  def('NOW', 'AGORA', '', 'Retorna a data e a hora atuais.', () => { const d = new Date(); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - E.EPOCH) / 86400000; }, D);
  def('DATE', 'DATA', 'ano; mês; dia', 'Converte ano, mês e dia em uma data.', elementwise((y, m, d) => { let yy = N(y); if (yy < 1900) yy += 1900; return ymd(yy, N(m), N(d)); }), D);
  def('TIME', 'TEMPO', 'hora; minuto; segundo', 'Converte hora, minuto e segundo em horário.', elementwise((h, m, s) => ((N(h) * 3600 + N(m) * 60 + N(s)) / 86400) % 1), D);
  def('DATEVALUE', 'DATA.VALOR', 'texto_data', 'Converte um texto de data em número de série.', elementwise((x) => { const l = E.parseLiteral(S(x)); if (typeof l.v !== 'number') throw ERR.VALUE; return Math.floor(l.v); }), D);
  def('TIMEVALUE', 'VALOR.TEMPO', 'texto_hora', 'Converte um texto de hora em fração de dia.', elementwise((x) => { const l = E.parseLiteral(S(x)); if (typeof l.v !== 'number') throw ERR.VALUE; return l.v % 1; }), D);
  def('YEAR', 'ANO', 'data', 'Retorna o ano de uma data.', elementwise((x) => parts(dnum(x)).y), D);
  def('MONTH', 'MÊS', 'data', 'Retorna o mês de uma data.', elementwise((x) => parts(dnum(x)).m), D);
  alias('MES', 'MONTH');
  def('DAY', 'DIA', 'data', 'Retorna o dia de uma data.', elementwise((x) => parts(dnum(x)).d), D);
  def('HOUR', 'HORA', 'horário', 'Retorna a hora.', elementwise((x) => E.serialToDate(dnum(x)).getUTCHours()), D);
  def('MINUTE', 'MINUTO', 'horário', 'Retorna o minuto.', elementwise((x) => E.serialToDate(dnum(x)).getUTCMinutes()), D);
  def('SECOND', 'SEGUNDO', 'horário', 'Retorna o segundo.', elementwise((x) => E.serialToDate(dnum(x)).getUTCSeconds()), D);
  def('WEEKDAY', 'DIA.DA.SEMANA', 'data; [tipo]', 'Dia da semana (1 = domingo por padrão).', elementwise((x, t) => {
    const w = parts(dnum(x)).w, type = opt(t, 1);
    if (type === 2) return w === 0 ? 7 : w;
    if (type === 3) return w === 0 ? 6 : w - 1;
    return w + 1;
  }), D);
  def('WEEKNUM', 'NÚMSEMANA', 'data; [tipo]', 'Número da semana no ano.', elementwise((x, t) => {
    const p = parts(dnum(x)), jan1 = new Date(Date.UTC(p.y, 0, 1)).getUTCDay();
    const start = opt(t, 1) === 2 ? 1 : 0;
    const doy = Math.floor(dnum(x)) - ymd(p.y, 1, 1);
    return Math.floor((doy + ((jan1 - start + 7) % 7)) / 7) + 1;
  }), D);
  alias('NUMSEMANA', 'WEEKNUM');
  def('EDATE', 'DATAM', 'data_inicial; meses', 'Data a um número de meses de distância.', elementwise((x, m) => {
    const p = parts(dnum(x)), k = N(m);
    const last = new Date(Date.UTC(p.y, p.m - 1 + k + 1, 0)).getUTCDate();
    return ymd(p.y, p.m + k, Math.min(p.d, last));
  }), D);
  def('EOMONTH', 'FIMMÊS', 'data_inicial; meses', 'Último dia do mês, a um número de meses de distância.', elementwise((x, m) => { const p = parts(dnum(x)); return ymd(p.y, p.m + N(m) + 1, 0); }), D);
  alias('FIMMES', 'EOMONTH');
  def('DAYS', 'DIAS', 'data_final; data_inicial', 'Número de dias entre duas datas.', elementwise((e, s) => Math.floor(dnum(e)) - Math.floor(dnum(s))), D);
  def('DATEDIF', 'DATADIF', 'data_inicial; data_final; unidade', 'Diferença entre datas em anos (Y), meses (M) ou dias (D).', elementwise((s, e, u) => {
    const a = parts(dnum(s)), b = parts(dnum(e)), unit = S(u).toUpperCase();
    if (dnum(e) < dnum(s)) throw ERR.NUM;
    let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    switch (unit) {
      case 'Y': return Math.floor(months / 12);
      case 'M': return months;
      case 'D': return Math.floor(dnum(e)) - Math.floor(dnum(s));
      case 'YM': return months % 12;
      case 'MD': { const d = b.d - a.d; return d >= 0 ? d : new Date(Date.UTC(b.y, b.m - 1, 0)).getUTCDate() + d; }
      case 'YD': { const anniv = ymd(b.y, a.m, a.d); const diff = Math.floor(dnum(e)) - anniv; return diff >= 0 ? diff : Math.floor(dnum(e)) - ymd(b.y - 1, a.m, a.d); }
    }
    throw mkErr('#NUM!', 'Unidade inválida em DATADIF. Use "Y", "M", "D", "YM", "MD" ou "YD".');
  }), D);
  const isWork = (s, hol) => { const w = parts(s).w; return w !== 0 && w !== 6 && !hol.has(Math.floor(s)); };
  const holidays = (a, i, c) => new Set(has(a, i) ? nums([a[i]], c).map(Math.floor) : []);
  def('NETWORKDAYS', 'DIATRABALHOTOTAL', 'data_inicial; data_final; [feriados]', 'Número de dias úteis entre duas datas.', (a, c) => {
    let s = Math.floor(dnum(val(a, 0, c))), e = Math.floor(dnum(val(a, 1, c)));
    const hol = holidays(a, 2, c), sign = e < s ? -1 : 1;
    if (e < s) [s, e] = [e, s];
    let n = 0;
    for (let d = s; d <= e; d++) if (isWork(d, hol)) n++;
    return n * sign;
  }, D);
  def('WORKDAY', 'DIATRABALHO', 'data_inicial; dias; [feriados]', 'Data após um número de dias úteis.', (a, c) => {
    let d = Math.floor(dnum(val(a, 0, c)));
    let k = num(a, 1, c);
    const hol = holidays(a, 2, c), step = k < 0 ? -1 : 1;
    while (k !== 0) { d += step; if (isWork(d, hol)) k -= step; }
    return d;
  }, D);
  def('YEARFRAC', 'FRAÇÃOANO', 'data_inicial; data_final; [base]', 'Fração do ano entre duas datas.', elementwise((s, e) => Math.abs(dnum(e) - dnum(s)) / 365), D);
  alias('FRACAOANO', 'YEARFRAC');

  // ---------- Informações ----------
  const I = 'Informações';
  const safeVal = (a, c) => { try { return scalarOf(ev(a[0], c)); } catch (e) { if (isErr(e)) return e; throw e; } };
  const infoFn = (f) => (a, c) => {
    let v;
    try { v = ev(a[0], c); } catch (e) { if (isErr(e)) return f(e); throw e; }
    if (isArr(v)) return new Matrix(toMatrix(v).map((r) => r.map(f)));
    return f(scalarOf(v));
  };
  def('ISBLANK', 'ÉCÉL.VAZIA', 'valor', 'Verifica se a célula está vazia.', infoFn((v) => v === null), I);
  alias('É.CÉL.VAZIA', 'ISBLANK');
  def('ISNUMBER', 'ÉNÚM', 'valor', 'Verifica se o valor é um número.', infoFn((v) => typeof v === 'number'), I);
  alias('ÉNUM', 'ISNUMBER');
  def('ISTEXT', 'ÉTEXTO', 'valor', 'Verifica se o valor é texto.', infoFn((v) => typeof v === 'string'), I);
  def('ISNONTEXT', 'ÉNÃOTEXTO', 'valor', 'Verifica se o valor não é texto.', infoFn((v) => typeof v !== 'string'), I);
  def('ISLOGICAL', 'ÉLÓGICO', 'valor', 'Verifica se o valor é VERDADEIRO ou FALSO.', infoFn((v) => typeof v === 'boolean'), I);
  def('ISERROR', 'ÉERROS', 'valor', 'Verifica se o valor é um erro.', infoFn((v) => isErr(v)), I);
  def('ISERR', 'ÉERRO', 'valor', 'Verifica se o valor é um erro diferente de #N/A.', infoFn((v) => isErr(v) && v.code !== '#N/A'), I);
  def('ISNA', 'É.NÃO.DISP', 'valor', 'Verifica se o valor é #N/A.', infoFn((v) => isErr(v) && v.code === '#N/A'), I);
  def('ISEVEN', 'ÉPAR', 'valor', 'Verifica se o número é par.', elementwise((x) => Math.floor(Math.abs(N(x))) % 2 === 0), I);
  def('ISODD', 'ÉIMPAR', 'valor', 'Verifica se o número é ímpar.', elementwise((x) => Math.floor(Math.abs(N(x))) % 2 === 1), I);
  def('NA', 'NÃO.DISP', '', 'Retorna o erro #N/A.', () => ERR.NA, I);
  alias('NAO.DISP', 'NA');
  def('TYPE', 'TIPO', 'valor', 'Tipo do valor (1 número, 2 texto, 4 lógico, 16 erro, 64 matriz).', (a, c) => {
    let v;
    try { v = ev(a[0], c); } catch (e) { return 16; }
    if (isArr(v)) return 64;
    v = scalarOf(v);
    return typeof v === 'number' || v === null ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : 16;
  }, I);
  def('ERROR.TYPE', 'TIPO.ERRO', 'valor', 'Número que identifica o tipo de erro.', (a, c) => {
    const v = safeVal(a, c);
    const codes = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];
    const i = isErr(v) ? codes.indexOf(v.code) : -1;
    if (i < 0) throw ERR.NA;
    return i + 1;
  }, I);
  def('ISFORMULA', 'ÉFÓRMULA', 'célula', 'Verifica se a célula contém uma fórmula.', (a, c) => {
    const r = ev(a[0], c);
    if (!(r instanceof E.RangeRef)) throw ERR.VALUE;
    const raw = r.wb.p.raw(r.si, r.r1, r.c1);
    return typeof raw === 'string' && raw[0] === '=';
  }, I);
  def('FORMULATEXT', 'FÓRMULATEXTO', 'célula', 'Retorna a fórmula de uma célula como texto.', (a, c) => {
    const r = ev(a[0], c);
    if (!(r instanceof E.RangeRef)) throw ERR.VALUE;
    const raw = r.wb.p.raw(r.si, r.r1, r.c1);
    if (typeof raw !== 'string' || raw[0] !== '=') throw ERR.NA;
    return raw;
  }, I);

  // ---------- Minigráficos e imagens na célula ----------
  class Sparkline { constructor(values, opts) { this.values = values; this.opts = opts; } toString() { return ''; } }
  class CellImage { constructor(url, mode, w, h) { this.url = url; this.mode = mode; this.w = w; this.h = h; } toString() { return ''; } }
  E.Sparkline = Sparkline;
  E.CellImage = CellImage;
  def('SPARKLINE', 'SPARKLINE', 'dados; [opções]', 'Cria um minigráfico dentro da célula. Opções: {"charttype"\\"bar"}; tipos: line, column, bar, winloss.', (a, c) => {
    const m = toMatrix(ev(a[0], c));
    const values = (m.length === 1 ? m[0] : m.map((r) => r[0])).map((v) => (typeof v === 'number' ? v : null));
    const opts = {};
    if (has(a, 1)) {
      const om = toMatrix(ev(a[1], c));
      for (const row of om) if (row.length >= 2 && row[0] !== null) opts[String(row[0]).toLowerCase()] = row[1];
    }
    return new Sparkline(values, opts);
  }, 'Outras');
  def('IMAGE', 'IMAGEM', 'url; [modo]; [altura]; [largura]', 'Insere uma imagem dentro da célula (modo 1: ajustar, 2: esticar, 3: tamanho original, 4: personalizado).', (a, c) => {
    const url = str(a, 0, c, '');
    if (!/^(https?:|data:image\/)/i.test(url)) throw mkErr('#VALUE!', 'IMAGEM precisa de um endereço que comece com http:// ou https://.');
    return new CellImage(url, num(a, 1, c, 1), num(a, 2, c, 0), num(a, 3, c, 0));
  }, 'Outras');

  // ---------- Finanças ----------
  const FN = 'Finanças';
  def('PMT', 'PGTO', 'taxa; nper; vp; [vf]; [tipo]', 'Pagamento periódico de um investimento ou empréstimo.', (a, c) => {
    need(a, 3, 'PGTO');
    const r = num(a, 0, c), n = num(a, 1, c), pv = num(a, 2, c), fv = num(a, 3, c, 0), t = num(a, 4, c, 0);
    if (r === 0) return -(pv + fv) / n;
    const f = Math.pow(1 + r, n);
    return -(r * (pv * f + fv)) / ((1 + r * t) * (f - 1));
  }, FN);
  def('FV', 'VF', 'taxa; nper; pgto; [vp]; [tipo]', 'Valor futuro de um investimento.', (a, c) => {
    const r = num(a, 0, c), n = num(a, 1, c), p = num(a, 2, c), pv = num(a, 3, c, 0), t = num(a, 4, c, 0);
    if (r === 0) return -(pv + p * n);
    const f = Math.pow(1 + r, n);
    return -(pv * f + p * (1 + r * t) * (f - 1) / r);
  }, FN);
  def('PV', 'VP', 'taxa; nper; pgto; [vf]; [tipo]', 'Valor presente de um investimento.', (a, c) => {
    const r = num(a, 0, c), n = num(a, 1, c), p = num(a, 2, c), fv = num(a, 3, c, 0), t = num(a, 4, c, 0);
    if (r === 0) return -(fv + p * n);
    const f = Math.pow(1 + r, n);
    return -(fv + p * (1 + r * t) * (f - 1) / r) / f;
  }, FN);
  def('NPER', 'NPER', 'taxa; pgto; vp; [vf]; [tipo]', 'Número de períodos de um investimento.', (a, c) => {
    const r = num(a, 0, c), p = num(a, 1, c), pv = num(a, 2, c), fv = num(a, 3, c, 0), t = num(a, 4, c, 0);
    if (r === 0) return -(pv + fv) / p;
    const z = p * (1 + r * t) / r;
    const v = (z - fv) / (z + pv);
    if (v <= 0) throw ERR.NUM;
    return Math.log(v) / Math.log(1 + r);
  }, FN);
  def('NPV', 'VPL', 'taxa; valor1; [valor2; …]', 'Valor presente líquido de fluxos de caixa.', (a, c) => {
    const r = num(a, 0, c);
    return nums(a.slice(1), c).reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0);
  }, FN);
  def('IRR', 'TIR', 'fluxos; [estimativa]', 'Taxa interna de retorno.', (a, c) => {
    const cf = nums([a[0]], c);
    let r = num(a, 1, c, 0.1);
    for (let it = 0; it < 100; it++) {
      let f = 0, df = 0;
      cf.forEach((v, i) => { f += v / Math.pow(1 + r, i); df -= (i * v) / Math.pow(1 + r, i + 1); });
      if (Math.abs(df) < 1e-12) break;
      const nr = r - f / df;
      if (Math.abs(nr - r) < 1e-10) return nr;
      r = nr;
    }
    if (!isFinite(r)) throw ERR.NUM;
    return r;
  }, FN);
  def('RATE', 'TAXA', 'nper; pgto; vp; [vf]; [tipo]; [estimativa]', 'Taxa de juros por período.', (a, c) => {
    const n = num(a, 0, c), p = num(a, 1, c), pv = num(a, 2, c), fv = num(a, 3, c, 0), t = num(a, 4, c, 0);
    let r = num(a, 5, c, 0.1);
    const f = (x) => { const q = Math.pow(1 + x, n); return pv * q + p * (1 + x * t) * (q - 1) / x + fv; };
    for (let it = 0; it < 100; it++) {
      const y = f(r), h = 1e-6, d = (f(r + h) - y) / h;
      if (!d) break;
      const nr = r - y / d;
      if (Math.abs(nr - r) < 1e-10) return nr;
      r = nr;
    }
    throw ERR.NUM;
  }, FN);
})();
