// Motor de cálculo: tokenizador, parser, avaliador e pasta de trabalho (várias planilhas).
// As funções de planilha ficam em functions.js, que se registra via GridEngine.def().
(function (global) {
  'use strict';

  // ---------- Erros ----------
  class CellError {
    constructor(code, msg) { this.code = code; this.msg = msg || ''; }
    toString() { return this.code; }
  }
  const ERR = {
    DIV0: new CellError('#DIV/0!', 'O divisor é zero.'),
    VALUE: new CellError('#VALUE!', 'Valor de tipo incorreto em um argumento.'),
    REF: new CellError('#REF!', 'Referência inválida.'),
    NAME: new CellError('#NAME?', 'Nome desconhecido.'),
    NA: new CellError('#N/A', 'Valor não encontrado.'),
    NUM: new CellError('#NUM!', 'Número inválido.'),
    NULL: new CellError('#NULL!', 'Intervalo vazio.'),
    ERROR: new CellError('#ERROR!', 'Erro de análise da fórmula.'),
  };
  const mkErr = (code, msg) => new CellError(code, msg);
  const isErr = (v) => v instanceof CellError;

  // ---------- Matrizes e referências ----------
  class Matrix {
    constructor(rows) { this.rows = rows; }
    get h() { return this.rows.length; }
    get w() { return this.rows.length ? this.rows[0].length : 0; }
  }
  class RangeRef {
    constructor(wb, si, r1, c1, r2, c2) {
      this.wb = wb; this.si = si;
      this.r1 = Math.min(r1, r2); this.r2 = Math.max(r1, r2);
      this.c1 = Math.min(c1, c2); this.c2 = Math.max(c1, c2);
    }
    get h() { return this.r2 - this.r1 + 1; }
    get w() { return this.c2 - this.c1 + 1; }
    get(i, j) { return this.wb.value(this.si, this.r1 + i, this.c1 + j); }
  }
  const MAX_CELLS = 200000; // proteção contra intervalos gigantes

  // ---------- Endereços ----------
  function colToNum(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseAddr(addr) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(addr).trim());
    if (!m) return null;
    return { row: parseInt(m[2], 10), col: colToNum(m[1].toUpperCase()) };
  }
  const addrToStr = (row, col) => numToCol(col) + row;
  function quoteSheet(name) {
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'";
  }

  // ---------- Tokenizador (com posições, para reescrever fórmulas) ----------
  const NOT_ID = '(?![\\p{L}\\p{N}_(.])';
  const RE_CELLRANGE = new RegExp('^(\\$?)([A-Za-z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Za-z]{1,3})(\\$?)(\\d*))?' + NOT_ID, 'u');
  const RE_COLS = new RegExp('^(\\$?)([A-Za-z]{1,3}):(\\$?)([A-Za-z]{1,3})' + NOT_ID, 'u');
  const RE_ROWS = /^(\$?)(\d+):(\$?)(\d+)(?![\p{L}\p{N}_(.,])/u;
  const RE_ERR = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|ERROR!)/;

  function matchRef(s) {
    let m = RE_CELLRANGE.exec(s);
    if (m) {
      const ref = { kind: 'cell', ac1: !!m[1], c1: colToNum(m[2].toUpperCase()), ar1: !!m[3], r1: +m[4] };
      if (m[6]) {
        ref.kind = 'range';
        ref.ac2 = !!m[5]; ref.c2 = colToNum(m[6].toUpperCase()); ref.ar2 = !!m[7];
        ref.r2 = m[8] ? +m[8] : null; // A2:B (aberto até o fim)
      }
      return { ref, len: m[0].length };
    }
    m = RE_COLS.exec(s);
    if (m) return { ref: { kind: 'cols', ac1: !!m[1], c1: colToNum(m[2].toUpperCase()), ac2: !!m[3], c2: colToNum(m[4].toUpperCase()) }, len: m[0].length };
    m = RE_ROWS.exec(s);
    if (m) return { ref: { kind: 'rows', ar1: !!m[1], r1: +m[2], ar2: !!m[3], r2: +m[4] }, len: m[0].length };
    return null;
  }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    const push = (t, v, s, e, extra) => toks.push(Object.assign({ t, v, s, e }, extra));
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = src.slice(i);
      if (ch === '"') {
        let j = i + 1, out = '';
        for (;;) {
          if (j >= n) throw new Error('Texto sem aspas de fechamento');
          if (src[j] === '"') { if (src[j + 1] === '"') { out += '"'; j += 2; continue; } break; }
          out += src[j++];
        }
        push('str', out, i, j + 1);
        i = j + 1; continue;
      }
      // prefixo de planilha: Planilha2!A1 ou 'Minha planilha'!A1
      let sheet = null, m;
      const start = i;
      if (ch === "'") {
        m = /^'((?:[^']|'')+)'!/.exec(rest);
        if (!m) throw new Error('Nome de planilha inválido');
        sheet = m[1].replace(/''/g, "'");
      } else if ((m = /^([\p{L}_][\p{L}\p{N}_.]*)!/u.exec(rest))) {
        sheet = m[1];
      }
      if (sheet !== null) {
        const r = matchRef(src.slice(i + m[0].length));
        if (!r) throw new Error('Referência inválida após o nome da planilha');
        i += m[0].length + r.len;
        push('ref', src.slice(start, i), start, i, { sheet, ref: r.ref });
        continue;
      }
      const r = matchRef(rest);
      if (r) { push('ref', rest.slice(0, r.len), i, i + r.len, { sheet: null, ref: r.ref }); i += r.len; continue; }
      if ((m = RE_ERR.exec(rest))) { push('err', m[0], i, i + m[0].length); i += m[0].length; continue; }
      // número: vírgula decimal só entre dígitos (pt-BR); ponto decimal também aceito
      if ((m = /^(\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
        push('num', parseFloat(m[0].replace(',', '.')), i, i + m[0].length);
        i += m[0].length; continue;
      }
      if ((m = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(rest))) {
        const word = m[0];
        const up = word.toUpperCase();
        let j = i + word.length;
        while (j < n && src[j] === ' ') j++;
        if (src[j] === '(') { push('func', up, i, j + 1); i = j + 1; continue; }
        if (up === 'TRUE' || up === 'VERDADEIRO' || up === 'FALSE' || up === 'FALSO') {
          push('bool', up === 'TRUE' || up === 'VERDADEIRO', i, i + word.length); i += word.length; continue;
        }
        push('name', up, i, i + word.length);
        i += word.length; continue;
      }
      const two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') { push('op', two, i, i + 2); i += 2; continue; }
      if ('+-*/^&=<>%'.includes(ch)) { push('op', ch, i, i + 1); i++; continue; }
      if (ch === '(') { push('lparen', ch, i, i + 1); i++; continue; }
      if (ch === ')') { push('rparen', ch, i, i + 1); i++; continue; }
      if (ch === '{') { push('lbrace', ch, i, i + 1); i++; continue; }
      if (ch === '}') { push('rbrace', ch, i, i + 1); i++; continue; }
      if (ch === ',' || ch === ';' || ch === '\\') { push('sep', ch, i, i + 1); i++; continue; }
      throw new Error('Caractere inesperado: ' + ch);
    }
    toks.push({ t: 'eof', s: n, e: n });
    return toks;
  }

  // ---------- Parser ----------
  const BIN_PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  const ALIASES = {}; // nome em português -> nome canônico (preenchido por functions.js)

  function parseFormula(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (t, what) => {
      const tok = next();
      if (tok.t !== t) throw new Error('Esperado ' + what);
      return tok;
    };

    function primary() {
      const tok = next();
      switch (tok.t) {
        case 'num': return { k: 'num', v: tok.v };
        case 'str': return { k: 'str', v: tok.v };
        case 'bool': return { k: 'bool', v: tok.v };
        case 'err': return { k: 'err', v: tok.v };
        case 'ref': return { k: 'ref', sheet: tok.sheet, ref: tok.ref };
        case 'name': return { k: 'name', v: tok.v };
        case 'func': {
          const args = [];
          if (peek().t !== 'rparen') {
            for (;;) {
              // argumento vazio: SE(A1;;2)
              if (peek().t === 'sep' || peek().t === 'rparen') args.push({ k: 'empty' });
              else args.push(expr(0));
              if (peek().t === 'sep') { next(); continue; }
              break;
            }
          }
          expect('rparen', ')');
          return { k: 'call', name: ALIASES[tok.v] || tok.v, raw: tok.v, args };
        }
        case 'lparen': { const e = expr(0); expect('rparen', ')'); return e; }
        case 'lbrace': {
          const rows = [[]];
          if (peek().t !== 'rbrace') {
            for (;;) {
              rows[rows.length - 1].push(expr(0));
              const s = peek();
              if (s.t === 'sep') { next(); if (s.v === ';') rows.push([]); continue; }
              break;
            }
          }
          expect('rbrace', '}');
          const w = rows[0].length;
          if (rows.some((r) => r.length !== w)) throw new Error('Matriz com linhas de tamanhos diferentes');
          return { k: 'arr', rows };
        }
        case 'op':
          if (tok.v === '-' || tok.v === '+') return { k: 'un', op: tok.v, e: expr(6) };
          throw new Error('Operador inesperado: ' + tok.v);
        default: throw new Error('Fim inesperado da fórmula');
      }
    }
    function expr(minPrec) {
      let left = primary();
      for (;;) {
        const tok = peek();
        if (tok.t === 'op' && tok.v === '%') { next(); left = { k: 'un', op: '%', e: left }; continue; }
        if (tok.t !== 'op' || !(tok.v in BIN_PREC)) break;
        const prec = BIN_PREC[tok.v];
        if (prec < minPrec) break;
        next();
        left = { k: 'bin', op: tok.v, a: left, b: expr(prec + 1) };
      }
      return left;
    }
    const ast = expr(0);
    if (peek().t !== 'eof') throw new Error('Texto extra após a fórmula');
    return ast;
  }

  // ---------- Coerção ----------
  const EPOCH = Date.UTC(1899, 11, 30); // série 0 = 30/12/1899 (padrão de planilhas)
  const serialToDate = (s) => new Date(EPOCH + Math.round(s * 86400000));
  const dateToSerial = (d) => (d.getTime() - EPOCH) / 86400000;

  function toNumber(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const lit = parseLiteral(String(v));
    if (typeof lit.v === 'number') return lit.v;
    throw mkErr('#VALUE!', `O texto "${String(v).slice(0, 40)}" não pode ser convertido em número.`);
  }
  function toStr(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(15)).replace('.', ',');
    return String(v);
  }
  function toBool(v) {
    if (isErr(v)) throw v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined || v === '') return false;
    const s = String(v).toUpperCase();
    if (s === 'TRUE' || s === 'VERDADEIRO') return true;
    if (s === 'FALSE' || s === 'FALSO') return false;
    throw mkErr('#VALUE!', `"${v}" não é um valor lógico.`);
  }
  // Ordem de planilha: número < texto < booleano; vazio vale 0 ou ""
  function compare(a, b, op) {
    if (isErr(a)) throw a;
    if (isErr(b)) throw b;
    if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
    let x = a, y = b;
    if (rank(a) !== rank(b)) { x = rank(a); y = rank(b); }
    else if (typeof a === 'string') { x = a.toLowerCase(); y = b.toLowerCase(); }
    else if (typeof a === 'boolean') { x = +a; y = +b; }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      case '>=': return x >= y;
    }
    return false;
  }

  // Interpreta o que o usuário digitou numa célula (sem "="): número, %, R$, data, hora, booleano ou texto.
  // fmt indica o formato que a planilha aplica automaticamente.
  function parseLiteral(text) {
    const t = String(text).trim();
    if (t === '') return { v: null };
    if (/^(TRUE|VERDADEIRO)$/i.test(t)) return { v: true };
    if (/^(FALSE|FALSO)$/i.test(t)) return { v: false };
    let m;
    const num = (s) => {
      s = s.replace(/\s/g, '');
      if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^[-+]?\d+,\d+$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
      if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
      return null;
    };
    let n = num(t);
    if (n !== null) return { v: n };
    if ((m = /^([-+]?[\d.,\s]+)%$/.exec(t)) && (n = num(m[1])) !== null) return { v: n / 100, fmt: 'percent' };
    if ((m = /^(-?)\s*R\$\s*([\d.,]+)$/.exec(t)) && (n = num(m[2])) !== null) return { v: m[1] ? -n : n, fmt: 'currency' };
    // data dd/mm/aaaa (pt-BR) ou aaaa-mm-dd, com hora opcional
    if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t))) {
      const d = +m[1], mo = +m[2];
      let y = m[3] ? +m[3] : new Date().getFullYear();
      if (y < 100) y += y < 50 ? 2000 : 1900;
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        let s = (Date.UTC(y, mo - 1, d) - EPOCH) / 86400000;
        if (m[4]) s += (+m[4] * 3600 + +m[5] * 60 + (+m[6] || 0)) / 86400;
        return { v: s, fmt: m[4] ? 'datetime' : 'date' };
      }
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
      return { v: (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000, fmt: 'date' };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)) && +m[1] < 24 && +m[2] < 60) {
      return { v: (+m[1] * 3600 + +m[2] * 60 + (+m[3] || 0)) / 86400, fmt: 'time' };
    }
    return { v: String(text) };
  }

  // ---------- Avaliação ----------
  // ctx: { wb, si (planilha da fórmula), row, col, vars }
  function resolveRef(node, ctx) {
    const wb = ctx.wb;
    let si = ctx.si;
    if (node.sheet !== null) {
      si = wb.sheetIndex(node.sheet);
      if (si < 0) throw mkErr('#REF!', `A planilha "${node.sheet}" não existe.`);
    }
    const ref = node.ref;
    const used = wb.usedRange(si);
    let r1, c1, r2, c2;
    switch (ref.kind) {
      case 'cell': r1 = r2 = ref.r1; c1 = c2 = ref.c1; break;
      case 'range': r1 = ref.r1; c1 = ref.c1; c2 = ref.c2; r2 = ref.r2 === null ? Math.max(ref.r1, used.maxR) : ref.r2; break;
      case 'cols': c1 = ref.c1; c2 = ref.c2; r1 = 1; r2 = Math.max(1, used.maxR); break;
      case 'rows': r1 = ref.r1; r2 = ref.r2; c1 = 1; c2 = Math.max(1, used.maxC); break;
    }
    const rr = new RangeRef(wb, si, r1, c1, r2, c2);
    if (rr.h * rr.w > MAX_CELLS) throw mkErr('#NUM!', 'Intervalo grande demais.');
    return rr;
  }

  function evaluate(node, ctx) {
    switch (node.k) {
      case 'num': case 'str': case 'bool': return node.v;
      case 'empty': return null;
      case 'err': return Object.values(ERR).find((e) => e.code === node.v) || mkErr(node.v);
      case 'ref': return resolveRef(node, ctx);
      case 'name': {
        for (let v = ctx.vars; v; v = v.parent) if (v.map.has(node.v)) return v.map.get(node.v);
        // intervalos nomeados (Dados > Intervalos nomeados)
        const named = ctx.wb.p.namedRange && ctx.wb.p.namedRange(node.v);
        if (named) {
          let toks;
          try { toks = tokenize(named); } catch (e) { throw mkErr('#REF!', `O intervalo nomeado ${node.v} é inválido.`); }
          if (toks[0] && toks[0].t === 'ref') return resolveRef({ sheet: toks[0].sheet, ref: toks[0].ref }, ctx);
        }
        throw mkErr('#NAME?', `Nome desconhecido: ${node.v}`);
      }
      case 'arr': return new Matrix(node.rows.map((row) => row.map((e) => scalarOf(evaluate(e, ctx)))));
      case 'call': {
        const fn = FUNCTIONS[node.name];
        if (!fn) throw mkErr('#NAME?', `Função desconhecida: ${node.raw}`);
        return fn.impl(node.args, ctx);
      }
      case 'un': {
        const v = evaluate(node.e, ctx);
        if (node.op === '-') return lift1(v, (x) => -toNumber(x));
        if (node.op === '%') return lift1(v, (x) => toNumber(x) / 100);
        return lift1(v, (x) => toNumber(x));
      }
      case 'bin': {
        const a = evaluate(node.a, ctx), b = evaluate(node.b, ctx);
        return lift2(a, b, BIN_FN[node.op]);
      }
    }
    throw ERR.ERROR;
  }
  const BIN_FN = {
    '+': (a, b) => toNumber(a) + toNumber(b),
    '-': (a, b) => toNumber(a) - toNumber(b),
    '*': (a, b) => toNumber(a) * toNumber(b),
    '/': (a, b) => { const d = toNumber(b); if (d === 0) throw ERR.DIV0; return toNumber(a) / d; },
    '^': (a, b) => { const r = Math.pow(toNumber(a), toNumber(b)); if (!isFinite(r)) throw ERR.NUM; return r; },
    '&': (a, b) => toStr(a) + toStr(b),
    '=': (a, b) => compare(a, b, '='), '<>': (a, b) => compare(a, b, '<>'),
    '<': (a, b) => compare(a, b, '<'), '>': (a, b) => compare(a, b, '>'),
    '<=': (a, b) => compare(a, b, '<='), '>=': (a, b) => compare(a, b, '>='),
  };

  const isArr = (v) => v instanceof Matrix || (v instanceof RangeRef && (v.h > 1 || v.w > 1));
  // Valor único: referência 1x1 é lida; matriz usa o canto superior esquerdo
  function scalarOf(v) {
    if (v instanceof RangeRef) return v.get(0, 0);
    if (v instanceof Matrix) return v.h && v.w ? v.rows[0][0] : null;
    return v === undefined ? null : v;
  }
  function toMatrix(v) {
    if (v instanceof Matrix) return v.rows;
    if (v instanceof RangeRef) {
      const out = new Array(v.h);
      for (let i = 0; i < v.h; i++) { const row = new Array(v.w); for (let j = 0; j < v.w; j++) row[j] = v.get(i, j); out[i] = row; }
      return out;
    }
    return [[v === undefined ? null : v]];
  }
  const safe = (f) => { try { return f(); } catch (e) { if (isErr(e)) return e; throw e; } };
  function lift1(v, f) {
    if (!isArr(v)) return f(scalarOf(v));
    return new Matrix(toMatrix(v).map((row) => row.map((x) => safe(() => f(x)))));
  }
  // Operação elemento a elemento com expansão de linhas/colunas de tamanho 1
  function lift2(a, b, f) {
    if (!isArr(a) && !isArr(b)) return f(scalarOf(a), scalarOf(b));
    const A = toMatrix(a), B = toMatrix(b);
    const h = Math.max(A.length, B.length), w = Math.max(A[0].length, B[0].length);
    const pick = (M, i, j) => {
      const ii = M.length === 1 ? 0 : i, jj = M[0].length === 1 ? 0 : j;
      return ii < M.length && jj < M[0].length ? M[ii][jj] : ERR.NA;
    };
    const out = [];
    for (let i = 0; i < h; i++) {
      const row = [];
      for (let j = 0; j < w; j++) row.push(safe(() => f(pick(A, i, j), pick(B, i, j))));
      out.push(row);
    }
    return new Matrix(out);
  }

  // Expande argumentos em lista de valores; fromRange=true para valores vindos de intervalos/matrizes
  function flat(args, ctx) {
    const out = [];
    for (const a of args) {
      if (a.k === 'empty') continue;
      const v = evaluate(a, ctx);
      if (v instanceof RangeRef || v instanceof Matrix) {
        for (const row of toMatrix(v)) for (const x of row) out.push({ v: x, fromRange: true });
      } else out.push({ v, fromRange: false });
    }
    return out;
  }

  // ---------- Pasta de trabalho ----------
  // provider: { count(), name(i), raw(i,r,c) -> string, formulas(i) -> [{r,c}], used(i) -> {maxR,maxC} }
  const PARSE_CACHE = new Map();
  function getAst(text) {
    let ast = PARSE_CACHE.get(text);
    if (ast === undefined) {
      try { ast = parseFormula(text.slice(1)); } catch (e) { ast = { k: 'parseError', msg: e.message }; }
      if (PARSE_CACHE.size > 300000) PARSE_CACHE.clear();
      PARSE_CACHE.set(text, ast);
    }
    return ast;
  }
  // Diz se uma fórmula pode resultar em matriz. Funções que agregam (SOMA, CONT.SE…) sempre dão um valor único.
  const ARRAY_FUNCS = new Set(['FILTER', 'SORT', 'SORTN', 'UNIQUE', 'SEQUENCE', 'TRANSPOSE', 'ARRAYFORMULA', 'FLATTEN', 'SPLIT', 'RANDARRAY',
    'ARRAY_CONSTRAIN', 'CHOOSECOLS', 'CHOOSEROWS', 'INDEX', 'OFFSET', 'INDIRECT', 'XLOOKUP', 'ROW', 'COLUMN']);
  const SCALAR_FUNCS = new Set(['SUM', 'AVERAGE', 'AVERAGEA', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'SUMIF', 'SUMIFS', 'AVERAGEIF',
    'AVERAGEIFS', 'MIN', 'MAX', 'MINIFS', 'MAXIFS', 'MEDIAN', 'MODE', 'PRODUCT', 'SUMSQ', 'SUMPRODUCT', 'AND', 'OR', 'XOR', 'VLOOKUP', 'HLOOKUP',
    'LOOKUP', 'MATCH', 'XMATCH', 'CONCATENATE', 'CONCAT', 'TEXTJOIN', 'JOIN', 'ROWS', 'COLUMNS', 'LARGE', 'SMALL', 'RANK', 'STDEV', 'STDEVP',
    'VAR', 'VARP', 'PERCENTILE', 'QUARTILE', 'CORREL', 'COUNTUNIQUE', 'NPV', 'IRR', 'GCD', 'LCM', 'NETWORKDAYS', 'WORKDAY', 'ISFORMULA', 'FORMULATEXT', 'TYPE']);
  function mayArray(node) {
    if (!node) return false;
    switch (node.k) {
      case 'ref': return node.ref.kind !== 'cell';
      case 'arr': return true;
      case 'name': return true;
      case 'un': return mayArray(node.e);
      case 'bin': return mayArray(node.a) || mayArray(node.b);
      case 'call':
        if (ARRAY_FUNCS.has(node.name)) return true;
        if (SCALAR_FUNCS.has(node.name)) return false;
        return node.args.some(mayArray);
    }
    return false;
  }

  class Workbook {
    constructor(provider) { this.p = provider; this.invalidate(); }
    invalidate() {
      this.cache = new Map();
      this.full = new Map();     // resultado completo (matrizes) por célula-âncora
      this.stack = new Set();
      this.spill = new Map();    // "si:r:c" -> valor transbordado
      this.spillFrom = new Map();// "si:r:c" -> chave da âncora
      this.pending = new Map();  // si -> Set de chaves de fórmulas ainda não calculadas
      this.used = new Map();
    }
    sheetIndex(name) {
      const up = String(name).toUpperCase();
      for (let i = 0; i < this.p.count(); i++) if (this.p.name(i).toUpperCase() === up) return i;
      return -1;
    }
    usedRange(si) {
      let u = this.used.get(si);
      if (!u) { u = this.p.used(si); this.used.set(si, u); }
      return u;
    }
    // Fórmulas ainda não calculadas que podem gerar matrizes (e transbordar para células vizinhas)
    pendingOf(si) {
      let set = this.pending.get(si);
      if (!set) {
        set = new Set();
        for (const f of this.p.formulas(si)) {
          const key = si + ':' + f.r + ':' + f.c;
          if (this.cache.has(key)) continue;
          if (mayArray(getAst(this.p.raw(si, f.r, f.c)))) set.add(f.r + ':' + f.c);
        }
        this.pending.set(si, set);
      }
      return set;
    }
    // Valor exibido de uma célula (inclui resultados transbordados de fórmulas matriciais)
    value(si, r, c) {
      const key = si + ':' + r + ':' + c;
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.p.blocked && this.p.blocked(si, r, c)) {
        const e = mkErr('#OCULTO!', 'Esta célula está em uma coluna que você não tem permissão para ver.');
        this.cache.set(key, e);
        return e;
      }
      const text = this.p.raw(si, r, c);
      let v;
      if (text === '' || text === null || text === undefined) {
        v = this.spillValue(si, r, c);
      } else if (text[0] === '=' && text.length > 1) {
        if (this.stack.has(key)) return mkErr('#REF!', 'Dependência circular detectada.');
        this.stack.add(key);
        try {
          v = this.compute(si, r, c, text, key);
        } finally {
          this.stack.delete(key);
          this.pendingOf(si).delete(r + ':' + c);
        }
      } else if (text[0] === "'") {
        v = text.slice(1);
      } else {
        v = parseLiteral(text).v;
      }
      this.cache.set(key, v);
      return v;
    }
    compute(si, r, c, text, key) {
      const ast = getAst(text);
      if (ast.k === 'parseError') return mkErr('#ERROR!', 'Erro de análise da fórmula: ' + ast.msg);
      let res;
      try {
        res = evaluate(ast, { wb: this, si, row: r, col: c, vars: null });
      } catch (e) {
        if (isErr(e)) return e;
        return mkErr('#ERROR!', String(e && e.message || e));
      }
      if (isArr(res)) {
        const M = toMatrix(res);
        this.full.set(key, M);
        // verifica se o transbordo cabe sem sobrescrever dados
        for (let i = 0; i < M.length; i++) {
          for (let j = 0; j < M[i].length; j++) {
            if (i === 0 && j === 0) continue;
            const raw = this.p.raw(si, r + i, c + j);
            if (raw !== '' && raw !== null && raw !== undefined) {
              return mkErr('#REF!', `O resultado da matriz não foi expandido porque substituiria dados em ${addrToStr(r + i, c + j)}.`);
            }
          }
        }
        for (let i = 0; i < M.length; i++) {
          for (let j = 0; j < M[i].length; j++) {
            if (i === 0 && j === 0) continue;
            const k = si + ':' + (r + i) + ':' + (c + j);
            this.spill.set(k, M[i][j] === undefined ? null : M[i][j]);
            this.spillFrom.set(k, key);
          }
        }
        res = M[0][0];
      } else if (res instanceof RangeRef) {
        res = res.get(0, 0);
      }
      return res === undefined ? null : res;
    }
    spillValue(si, r, c) {
      const key = si + ':' + r + ':' + c;
      if (this.spill.has(key)) return this.spill.get(key);
      // calcula fórmulas acima/à esquerda que ainda não rodaram (podem transbordar até aqui)
      const pend = this.pendingOf(si);
      if (pend.size) {
        for (const fk of Array.from(pend)) {
          const [fr, fc] = fk.split(':').map(Number);
          if (fr <= r && fc <= c && !this.stack.has(si + ':' + fr + ':' + fc)) this.value(si, fr, fc);
        }
        if (this.spill.has(key)) return this.spill.get(key);
      }
      return null;
    }
    // Célula âncora de onde vem um valor transbordado (para a interface)
    spillAnchor(si, r, c) { return this.spillFrom.get(si + ':' + r + ':' + c) || null; }
  }

  // ---------- Reescrita de fórmulas ----------
  function fmtRefParts(ref) {
    const col = (abs, c) => (abs ? '$' : '') + numToCol(c);
    const row = (abs, r) => (abs ? '$' : '') + r;
    switch (ref.kind) {
      case 'cell': return col(ref.ac1, ref.c1) + row(ref.ar1, ref.r1);
      case 'range': return col(ref.ac1, ref.c1) + row(ref.ar1, ref.r1) + ':' + col(ref.ac2, ref.c2) + (ref.r2 === null ? '' : row(ref.ar2, ref.r2));
      case 'cols': return col(ref.ac1, ref.c1) + ':' + col(ref.ac2, ref.c2);
      case 'rows': return row(ref.ar1, ref.r1) + ':' + row(ref.ar2, ref.r2);
    }
    return '#REF!';
  }
  // mapper(tok) -> novo texto da referência, ou null para manter
  function rewriteRefs(formula, mapper) {
    if (!formula || formula[0] !== '=') return formula;
    let toks;
    try { toks = tokenize(formula.slice(1)); } catch (e) { return formula; }
    let out = '', last = 0;
    const body = formula.slice(1);
    for (const t of toks) {
      if (t.t !== 'ref') continue;
      const rep = mapper(t);
      if (rep === null || rep === undefined) continue;
      out += body.slice(last, t.s) + rep;
      last = t.e;
    }
    return '=' + out + body.slice(last);
  }
  const sheetPrefix = (t) => (t.sheet !== null ? quoteSheet(t.sheet) + '!' : '');

  // Copiar/colar e arrastar: desloca partes relativas
  function shiftFormula(formula, dr, dc) {
    return rewriteRefs(formula, (t) => {
      const ref = Object.assign({}, t.ref);
      if (ref.r1 !== undefined && !ref.ar1) ref.r1 += dr;
      if (ref.r2 !== undefined && ref.r2 !== null && !ref.ar2) ref.r2 += dr;
      if (ref.c1 !== undefined && !ref.ac1) ref.c1 += dc;
      if (ref.c2 !== undefined && !ref.ac2) ref.c2 += dc;
      const bad = [ref.r1, ref.r2, ref.c1, ref.c2].some((x) => x !== undefined && x !== null && x < 1);
      return bad ? '#REF!' : sheetPrefix(t) + fmtRefParts(ref);
    });
  }

  // Inserir/excluir linhas ou colunas. axis: 'row' | 'col'; count > 0 insere, < 0 exclui.
  // formulaSheet: nome da planilha onde está a fórmula; targetSheet: planilha alterada.
  function structuralShift(formula, formulaSheet, targetSheet, axis, at, count) {
    const T = targetSheet.toUpperCase();
    return rewriteRefs(formula, (t) => {
      const sheetName = (t.sheet !== null ? t.sheet : formulaSheet).toUpperCase();
      if (sheetName !== T) return null;
      const ref = Object.assign({}, t.ref);
      const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
      if (ref[k1] === undefined) return null; // eixo não se aplica (ex.: A:A ao inserir linha)
      let a = ref[k1];
      let b = ref.kind === 'cell' ? a : ref[k2];
      const open = b === null;
      if (count > 0) {
        if (a >= at) a += count;
        if (!open && b >= at) b += count;
      } else {
        const del1 = at, del2 = at - count - 1, n = -count;
        if (open) { if (a > del2) a -= n; else if (a >= del1) a = del1; }
        else {
          if (a >= del1 && b <= del2) return sheetPrefix(t) + '#REF!';
          if (a > del2) a -= n; else if (a >= del1) a = del1;
          if (b > del2) b -= n; else if (b >= del1) b = del1 - 1;
        }
      }
      ref[k1] = a;
      if (ref.kind !== 'cell' && !open) ref[k2] = b;
      return sheetPrefix(t) + fmtRefParts(ref);
    });
  }
  function renameSheetRefs(formula, oldName, newName) {
    const O = oldName.toUpperCase();
    return rewriteRefs(formula, (t) => (t.sheet !== null && t.sheet.toUpperCase() === O ? quoteSheet(newName) + '!' + fmtRefParts(t.ref) : null));
  }
  // Referências de uma fórmula (para colorir no editor)
  function refsInFormula(formula) {
    if (!formula || formula[0] !== '=') return [];
    let toks;
    try { toks = tokenize(formula.slice(1)); } catch (e) { return []; }
    return toks.filter((t) => t.t === 'ref').map((t) => ({ sheet: t.sheet, ref: t.ref, s: t.s + 1, e: t.e + 1, text: formula.slice(t.s + 1, t.e + 1) }));
  }

  // ---------- Registro de funções ----------
  const FUNCTIONS = {}; // canônico -> { impl, pt, args, desc, cat }
  const INFO = [];      // lista para autocompletar
  function def(name, pt, args, desc, impl, cat) {
    FUNCTIONS[name] = { impl, pt: pt || name, args, desc, cat: cat || '' };
    if (pt && pt !== name) ALIASES[pt.toUpperCase()] = name;
    INFO.push({ name, pt: pt || name, args, desc, cat: cat || '' });
  }
  function alias(ptName, name) { ALIASES[ptName.toUpperCase()] = name; }

  global.GridEngine = {
    // tipos e erros
    CellError, ERR, mkErr, isErr, Matrix, RangeRef, Workbook,
    // endereços
    colToNum, numToCol, parseAddr, addrToStr, quoteSheet,
    // análise e avaliação
    tokenize, parseFormula, evaluate, scalarOf, toMatrix, isArr, lift1, lift2, flat, safe,
    toNumber, toStr, toBool, compare, parseLiteral, serialToDate, dateToSerial, EPOCH,
    // reescrita
    shiftFormula, structuralShift, renameSheetRefs, refsInFormula, fmtRefParts,
    // funções
    FUNCTIONS, ALIASES, INFO, def, alias,
  };
})(window);
