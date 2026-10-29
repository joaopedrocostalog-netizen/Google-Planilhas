// Motor de cálculo da planilha: referências, fórmulas e funções.
// Sem dependências. Carregado antes de app.js.
(function (global) {
  'use strict';

  // ---------- Erros de célula ----------
  class CellError {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const ERR = {
    DIV0: new CellError('#DIV/0!'),
    VALUE: new CellError('#VALUE!'),
    REF: new CellError('#REF!'),
    NAME: new CellError('#NAME?'),
    NA: new CellError('#N/A'),
    NUM: new CellError('#NUM!'),
    CIRC: new CellError('#CIRC!'),
    ERROR: new CellError('#ERROR!'),
  };

  // ---------- Utilidades de endereço ----------
  function colToNum(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n; // A=1
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  // "B3" -> {row:3, col:2}
  function parseAddr(addr) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(addr);
    if (!m) return null;
    return { row: parseInt(m[2], 10), col: colToNum(m[1].toUpperCase()) };
  }
  function addrToStr(row, col) { return numToCol(col) + row; }

  // ---------- Tokenizer ----------
  // Tipos: num, str, bool, ref (com ':' para intervalos), func, op, lparen, rparen, comma, eof
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '"') {
        let j = i + 1, out = '';
        while (j < n) {
          if (src[j] === '"') {
            if (src[j + 1] === '"') { out += '"'; j += 2; continue; }
            break;
          }
          out += src[j++];
        }
        if (j >= n) throw new Error('Texto sem aspas de fechamento');
        tokens.push({ t: 'str', v: out });
        i = j + 1; continue;
      }
      // Número: vírgula decimal (pt-BR) ou ponto decimal; separador de argumentos é ';' (ou ',' fora de números)
      const numM = /^(\d+(?:[.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (numM && !/[A-Za-z_]/.test(src[i])) {
        tokens.push({ t: 'num', v: parseFloat(numM[0].replace(',', '.')) });
        i += numM[0].length; continue;
      }
      const refM = /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?(?![A-Za-z0-9_(])/.exec(src.slice(i));
      if (refM) {
        tokens.push({ t: 'ref', v: refM[0].replace(/\$/g, '').toUpperCase() });
        i += refM[0].length; continue;
      }
      const idM = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(src.slice(i));
      if (idM) {
        const word = idM[0];
        const after = src[i + word.length];
        if (after === '(') {
          tokens.push({ t: 'func', v: word.toUpperCase() });
          i += word.length + 1; // consome o '(' junto com o nome
          continue;
        }
        const up = word.toUpperCase();
        if (up === 'TRUE' || up === 'VERDADEIRO' || up === 'FALSE' || up === 'FALSO') { tokens.push({ t: 'bool', v: up === 'TRUE' || up === 'VERDADEIRO' }); i += word.length; continue; }
        tokens.push({ t: 'name', v: up });
        i += word.length; continue;
      }
      const two = src.substr(i, 2);
      if (['<=', '>=', '<>'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>%'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
      if (ch === '(') { tokens.push({ t: 'lparen' }); i++; continue; }
      if (ch === ')') { tokens.push({ t: 'rparen' }); i++; continue; }
      if (ch === ',' || ch === ';') { tokens.push({ t: 'comma' }); i++; continue; }
      throw new Error('Caractere inesperado: ' + ch);
    }
    tokens.push({ t: 'eof' });
    return tokens;
  }

  // Nomes de funções em português (como no Google Planilhas em pt-BR) -> implementação
  const ALIASES = {
    'SOMA': 'SUM', 'PRODUTO': 'PRODUCT', 'MÉDIA': 'AVERAGE', 'MEDIA': 'AVERAGE',
    'MÁXIMO': 'MAX', 'MAXIMO': 'MAX', 'MÍNIMO': 'MIN', 'MINIMO': 'MIN', 'MED': 'MEDIAN',
    'CONT.NÚM': 'COUNT', 'CONT.NUM': 'COUNT', 'CONT.VALORES': 'COUNTA', 'CONTAR.VAZIO': 'COUNTBLANK',
    'CONT.SE': 'COUNTIF', 'SOMASE': 'SUMIF', 'MÉDIASE': 'AVERAGEIF', 'MEDIASE': 'AVERAGEIF',
    'SE': 'IF', 'SEERRO': 'IFERROR', 'E': 'AND', 'OU': 'OR', 'NÃO': 'NOT', 'NAO': 'NOT', 'XOU': 'XOR',
    'RAIZ': 'SQRT', 'POTÊNCIA': 'POWER', 'POTENCIA': 'POWER', 'ARRED': 'ROUND', 'ARREDONDAR': 'ROUND',
    'ARREDONDAR.PARA.CIMA': 'ROUNDUP', 'ARREDONDAR.PARA.BAIXO': 'ROUNDDOWN',
    'CONCATENAR': 'CONCATENATE', 'UNIRTEXTO': 'TEXTJOIN', 'NÚM.CARACT': 'LEN', 'NUM.CARACT': 'LEN',
    'MAIUSC': 'UPPER', 'MINUSC': 'LOWER', 'PRI.MAIÚSCULA': 'PROPER', 'ARRUMAR': 'TRIM',
    'ESQUERDA': 'LEFT', 'DIREITA': 'RIGHT', 'EXT.TEXTO': 'MID', 'SUBSTITUIR': 'SUBSTITUTE',
    'LOCALIZAR': 'FIND', 'PROCV': 'VLOOKUP', 'PROCH': 'HLOOKUP', 'HOJE': 'TODAY', 'AGORA': 'NOW',
    'DATA': 'DATE', 'ANO': 'YEAR', 'MÊS': 'MONTH', 'MES': 'MONTH', 'DIA': 'DAY',
    'É.CÉL.VAZIA': 'ISBLANK', 'ÉNÚM': 'ISNUMBER', 'ÉNUM': 'ISNUMBER', 'ÉTEXTO': 'ISTEXT',
    'ÉERRO': 'ISERROR', 'ÉERROS': 'ISERROR',
  };

  // ---------- Parser (precedência de operadores do Excel) ----------
  // Ordem (menor -> maior): comparação, concatenação (&), soma/subtração, multiplicação/divisão, potência, %, unário
  const BIN_PREC = {
    '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
    '&': 2,
    '+': 3, '-': 3,
    '*': 4, '/': 4,
    '^': 5,
  };

  function parseFormula(src) {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    const expect = (t) => {
      const tok = next();
      if (tok.t !== t) throw new Error('Esperado ' + t + ', encontrado ' + tok.t);
      return tok;
    };

    function parsePrimary() {
      const tok = next();
      switch (tok.t) {
        case 'num': return { k: 'lit', v: tok.v };
        case 'str': return { k: 'lit', v: tok.v };
        case 'bool': return { k: 'lit', v: tok.v };
        case 'ref': {
          if (tok.v.includes(':')) {
            const [a, b] = tok.v.split(':');
            return { k: 'range', a: parseAddr(a), b: parseAddr(b) };
          }
          return { k: 'ref', a: parseAddr(tok.v) };
        }
        case 'name': throw new Error('Nome desconhecido: ' + tok.v);
        case 'func': {
          const args = [];
          if (peek().t !== 'rparen') {
            args.push(parseExpr(0));
            while (peek().t === 'comma') { next(); args.push(parseExpr(0)); }
          }
          expect('rparen');
          return { k: 'call', name: ALIASES[tok.v] || tok.v, args };
        }
        case 'lparen': {
          const e = parseExpr(0);
          expect('rparen');
          return e;
        }
        case 'op':
          if (tok.v === '-') return { k: 'neg', e: parseExpr(6) };
          if (tok.v === '+') return parseExpr(6);
          throw new Error('Operador inesperado: ' + tok.v);
        default: throw new Error('Fim inesperado da fórmula');
      }
    }

    function parseExpr(minPrec) {
      let left = parsePrimary();
      for (;;) {
        const tok = peek();
        if (tok.t === 'op' && tok.v === '%') {
          next(); left = { k: 'pct', e: left }; continue;
        }
        if (tok.t !== 'op' || !(tok.v in BIN_PREC)) break;
        const prec = BIN_PREC[tok.v];
        if (prec < minPrec) break;
        next();
        // potência é associativa à esquerda no Excel
        const right = parseExpr(prec + 1);
        left = { k: 'bin', op: tok.v, a: left, b: right };
      }
      return left;
    }

    const ast = parseExpr(0);
    if (peek().t !== 'eof') throw new Error('Texto extra após a fórmula');
    return ast;
  }

  // ---------- Coerção de valores ----------
  function isErr(v) { return v instanceof CellError; }
  function toNumber(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v).trim().replace(/\s/g, '');
    if (s === '') return 0;
    // aceita formato pt-BR (1.234,56) e en (1,234.56)
    let t = s;
    if (/,\d{1,2}$/.test(t) && !/\./.test(t.slice(t.lastIndexOf(',')))) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    if (t.endsWith('%')) { const x = parseFloat(t.slice(0, -1)); if (!isNaN(x)) return x / 100; }
    const x = Number(t);
    if (isNaN(x)) throw ERR.VALUE;
    return x;
  }
  function toStr(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    if (typeof v === 'number') return String(+v.toPrecision(15));
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
    throw ERR.VALUE;
  }
  function compare(a, b, op) {
    if (isErr(a)) throw a;
    if (isErr(b)) throw b;
    const numA = typeof a === 'number' || typeof a === 'boolean';
    const numB = typeof b === 'number' || typeof b === 'boolean';
    let x, y;
    if (numA && numB) { x = +a; y = +b; }
    else if (a === null || a === undefined) { x = numB ? 0 : ''; y = b; }
    else if (b === null || b === undefined) { y = numA ? 0 : ''; x = a; }
    else if (numA !== numB) {
      // número < texto < booleano no Excel
      const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'boolean' ? 2 : 1);
      x = rank(a); y = rank(b);
    } else { x = String(a).toLowerCase(); y = String(b).toLowerCase(); }
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

  // ---------- Avaliador ----------
  // ctx: { getCell(row,col) -> valor calculado, sheet }
  function evaluate(node, ctx) {
    switch (node.k) {
      case 'lit': return node.v;
      case 'ref': {
        if (!node.a) return ERR.REF;
        return ctx.getCell(node.a.row, node.a.col);
      }
      case 'range': return { range: true, r1: node.a, r2: node.b };
      case 'neg': return -toNumber(scalar(evaluate(node.e, ctx)));
      case 'pct': return toNumber(scalar(evaluate(node.e, ctx))) / 100;
      case 'bin': {
        const a = scalar(evaluate(node.a, ctx));
        const b = scalar(evaluate(node.b, ctx));
        switch (node.op) {
          case '+': return toNumber(a) + toNumber(b);
          case '-': return toNumber(a) - toNumber(b);
          case '*': return toNumber(a) * toNumber(b);
          case '/': {
            const d = toNumber(b);
            if (d === 0) throw ERR.DIV0;
            return toNumber(a) / d;
          }
          case '^': return Math.pow(toNumber(a), toNumber(b));
          case '&': return toStr(a) + toStr(b);
          default: return compare(a, b, node.op);
        }
      }
      case 'call': {
        const fn = FUNCTIONS[node.name];
        if (!fn) throw ERR.NAME;
        return fn(node.args, ctx);
      }
    }
    throw ERR.ERROR;
  }
  // Converte resultado (possível intervalo) em valor único (canto superior esquerdo)
  function scalar(v) {
    if (v && v.range) {
      return ERR.VALUE;
    }
    return v;
  }
  // Expande argumento em lista plana de valores (aceita intervalos)
  function flatten(args, ctx) {
    const out = [];
    for (const a of args) {
      const v = evaluate(a, ctx);
      if (v && v.range) {
        const r1 = v.r1, r2 = v.r2;
        const top = Math.min(r1.row, r2.row), bot = Math.max(r1.row, r2.row);
        const lft = Math.min(r1.col, r2.col), rgt = Math.max(r1.col, r2.col);
        for (let r = top; r <= bot; r++)
          for (let c = lft; c <= rgt; c++) out.push({ v: ctx.getCell(r, c), fromRange: true });
      } else out.push({ v, fromRange: false });
    }
    return out;
  }
  function numbersFrom(args, ctx) {
    const nums = [];
    for (const item of flatten(args, ctx)) {
      const v = item.v;
      if (isErr(v)) throw v;
      if (item.fromRange) { if (typeof v === 'number') nums.push(v); }
      else nums.push(toNumber(v));
    }
    return nums;
  }
  // Monta matriz 2D a partir de um intervalo
  function rangeMatrix(arg, ctx) {
    const v = arg.k === 'range' ? evaluate(arg, ctx) : null;
    if (!v || !v.range) throw ERR.VALUE;
    const top = Math.min(v.r1.row, v.r2.row), bot = Math.max(v.r1.row, v.r2.row);
    const lft = Math.min(v.r1.col, v.r2.col), rgt = Math.max(v.r1.col, v.r2.col);
    const m = [];
    for (let r = top; r <= bot; r++) {
      const row = [];
      for (let c = lft; c <= rgt; c++) row.push(ctx.getCell(r, c));
      m.push(row);
    }
    return m;
  }
  // Critério estilo COUNTIF: ">5", "<=3", "<>x", "texto", número
  function matchCriterion(val, crit) {
    if (isErr(val)) return false;
    let op = '=', rhs = crit;
    const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(String(crit));
    if (m) { op = m[1]; rhs = m[2]; }
    const rhsNum = rhs.trim() !== '' && !isNaN(Number(rhs)) ? Number(rhs) : null;
    if (rhsNum !== null && typeof val === 'number') return compare(val, rhsNum, op);
    if (op === '=' || op === '<>') {
      const eq = String(val ?? '').toLowerCase() === rhs.toLowerCase();
      return op === '=' ? eq : !eq;
    }
    return compare(String(val ?? ''), rhs, op);
  }

  const FUNCTIONS = {
    SUM: (args, ctx) => numbersFrom(args, ctx).reduce((s, x) => s + x, 0),
    PRODUCT: (args, ctx) => numbersFrom(args, ctx).reduce((s, x) => s * x, 1),
    AVERAGE: (args, ctx) => {
      const n = numbersFrom(args, ctx);
      if (!n.length) throw ERR.DIV0;
      return n.reduce((s, x) => s + x, 0) / n.length;
    },
    MIN: (args, ctx) => { const n = numbersFrom(args, ctx); return n.length ? Math.min(...n) : 0; },
    MAX: (args, ctx) => { const n = numbersFrom(args, ctx); return n.length ? Math.max(...n) : 0; },
    MEDIAN: (args, ctx) => {
      const n = numbersFrom(args, ctx).sort((a, b) => a - b);
      if (!n.length) throw ERR.NUM;
      const mid = Math.floor(n.length / 2);
      return n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2;
    },
    COUNT: (args, ctx) => flatten(args, ctx).filter((i) => typeof i.v === 'number').length,
    COUNTA: (args, ctx) => flatten(args, ctx).filter((i) => i.v !== null && i.v !== undefined && i.v !== '').length,
    COUNTBLANK: (args, ctx) => flatten(args, ctx).filter((i) => i.v === null || i.v === undefined || i.v === '').length,
    COUNTIF: (args, ctx) => {
      const m = rangeMatrix(args[0], ctx);
      const crit = scalar(evaluate(args[1], ctx));
      let c = 0;
      m.forEach((row) => row.forEach((v) => { if (matchCriterion(v, toStr(crit))) c++; }));
      return c;
    },
    SUMIF: (args, ctx) => {
      const m = rangeMatrix(args[0], ctx);
      const crit = toStr(scalar(evaluate(args[1], ctx)));
      const sumM = args[2] ? rangeMatrix(args[2], ctx) : m;
      let s = 0;
      m.forEach((row, r) => row.forEach((v, c) => {
        if (matchCriterion(v, crit)) {
          const sv = sumM[r] && sumM[r][c];
          if (typeof sv === 'number') s += sv;
        }
      }));
      return s;
    },
    AVERAGEIF: (args, ctx) => {
      const m = rangeMatrix(args[0], ctx);
      const crit = toStr(scalar(evaluate(args[1], ctx)));
      const avgM = args[2] ? rangeMatrix(args[2], ctx) : m;
      let s = 0, c = 0;
      m.forEach((row, r) => row.forEach((v, col) => {
        if (matchCriterion(v, crit)) {
          const av = avgM[r] && avgM[r][col];
          if (typeof av === 'number') { s += av; c++; }
        }
      }));
      if (!c) throw ERR.DIV0;
      return s / c;
    },
    IF: (args, ctx) => {
      const cond = toBool(scalar(evaluate(args[0], ctx)));
      if (cond) return args[1] ? scalar(evaluate(args[1], ctx)) : true;
      return args[2] ? scalar(evaluate(args[2], ctx)) : false;
    },
    IFERROR: (args, ctx) => {
      try {
        const v = scalar(evaluate(args[0], ctx));
        if (isErr(v)) return scalar(evaluate(args[1], ctx));
        return v;
      } catch (e) {
        if (isErr(e)) return scalar(evaluate(args[1], ctx));
        throw e;
      }
    },
    AND: (args, ctx) => flatten(args, ctx).every((i) => toBool(i.v)),
    OR: (args, ctx) => flatten(args, ctx).some((i) => toBool(i.v)),
    NOT: (args, ctx) => !toBool(scalar(evaluate(args[0], ctx))),
    XOR: (args, ctx) => flatten(args, ctx).filter((i) => toBool(i.v)).length % 2 === 1,
    TRUE: () => true,
    FALSE: () => false,
    ABS: (args, ctx) => Math.abs(toNumber(scalar(evaluate(args[0], ctx)))),
    SQRT: (args, ctx) => {
      const x = toNumber(scalar(evaluate(args[0], ctx)));
      if (x < 0) throw ERR.NUM;
      return Math.sqrt(x);
    },
    POWER: (args, ctx) => Math.pow(toNumber(scalar(evaluate(args[0], ctx))), toNumber(scalar(evaluate(args[1], ctx)))),
    MOD: (args, ctx) => {
      const a = toNumber(scalar(evaluate(args[0], ctx)));
      const b = toNumber(scalar(evaluate(args[1], ctx)));
      if (b === 0) throw ERR.DIV0;
      return a - b * Math.floor(a / b);
    },
    INT: (args, ctx) => Math.floor(toNumber(scalar(evaluate(args[0], ctx)))),
    ROUND: (args, ctx) => {
      const x = toNumber(scalar(evaluate(args[0], ctx)));
      const d = args[1] ? toNumber(scalar(evaluate(args[1], ctx))) : 0;
      const f = Math.pow(10, d);
      return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
    },
    ROUNDUP: (args, ctx) => {
      const x = toNumber(scalar(evaluate(args[0], ctx)));
      const f = Math.pow(10, args[1] ? toNumber(scalar(evaluate(args[1], ctx))) : 0);
      return (x < 0 ? -Math.ceil(-x * f) : Math.ceil(x * f)) / f;
    },
    ROUNDDOWN: (args, ctx) => {
      const x = toNumber(scalar(evaluate(args[0], ctx)));
      const f = Math.pow(10, args[1] ? toNumber(scalar(evaluate(args[1], ctx))) : 0);
      return (x < 0 ? -Math.floor(-x * f) : Math.floor(x * f)) / f;
    },
    CONCATENATE: (args, ctx) => flatten(args, ctx).map((i) => toStr(i.v)).join(''),
    CONCAT: (args, ctx) => flatten(args, ctx).map((i) => toStr(i.v)).join(''),
    TEXTJOIN: (args, ctx) => {
      const delim = toStr(scalar(evaluate(args[0], ctx)));
      const ignoreEmpty = toBool(scalar(evaluate(args[1], ctx)));
      const vals = flatten(args.slice(2), ctx).map((i) => i.v)
        .filter((v) => !ignoreEmpty || (v !== null && v !== undefined && v !== ''));
      return vals.map(toStr).join(delim);
    },
    LEN: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).length,
    UPPER: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).toUpperCase(),
    LOWER: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).toLowerCase(),
    PROPER: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
    TRIM: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).trim().replace(/\s+/g, ' '),
    LEFT: (args, ctx) => toStr(scalar(evaluate(args[0], ctx))).slice(0, args[1] ? toNumber(scalar(evaluate(args[1], ctx))) : 1),
    RIGHT: (args, ctx) => {
      const s = toStr(scalar(evaluate(args[0], ctx)));
      const k = args[1] ? toNumber(scalar(evaluate(args[1], ctx))) : 1;
      return k <= 0 ? '' : s.slice(-k);
    },
    MID: (args, ctx) => {
      const s = toStr(scalar(evaluate(args[0], ctx)));
      const st = toNumber(scalar(evaluate(args[1], ctx)));
      const len = toNumber(scalar(evaluate(args[2], ctx)));
      if (st < 1 || len < 0) throw ERR.VALUE;
      return s.substr(st - 1, len);
    },
    SUBSTITUTE: (args, ctx) => {
      const s = toStr(scalar(evaluate(args[0], ctx)));
      const oldT = toStr(scalar(evaluate(args[1], ctx)));
      const newT = toStr(scalar(evaluate(args[2], ctx)));
      return oldT === '' ? s : s.split(oldT).join(newT);
    },
    REPT: (args, ctx) => {
      const n = toNumber(scalar(evaluate(args[1], ctx)));
      if (n < 0 || n > 10000) throw ERR.VALUE;
      return toStr(scalar(evaluate(args[0], ctx))).repeat(n);
    },
    FIND: (args, ctx) => {
      const i = toStr(scalar(evaluate(args[0], ctx)));
      const s = toStr(scalar(evaluate(args[1], ctx)));
      const start = args[2] ? toNumber(scalar(evaluate(args[2], ctx))) : 1;
      const idx = s.indexOf(i, start - 1);
      if (idx < 0) throw ERR.VALUE;
      return idx + 1;
    },
    VLOOKUP: (args, ctx) => {
      const key = scalar(evaluate(args[0], ctx));
      const m = rangeMatrix(args[1], ctx);
      const col = toNumber(scalar(evaluate(args[2], ctx)));
      const exact = args[3] ? !toBool(scalar(evaluate(args[3], ctx))) : false;
      if (col < 1 || !m.length || col > m[0].length) throw ERR.REF;
      for (const row of m) {
        const v = row[0];
        if (exact ? compare(v, key, '=') : compare(v, key, '<=')) {
          if (exact || (typeof v === typeof key)) return row[col - 1];
        }
      }
      throw ERR.NA;
    },
    HLOOKUP: (args, ctx) => {
      const key = scalar(evaluate(args[0], ctx));
      const m = rangeMatrix(args[1], ctx);
      const row = toNumber(scalar(evaluate(args[2], ctx)));
      const exact = args[3] ? !toBool(scalar(evaluate(args[3], ctx))) : false;
      if (row < 1 || !m.length || row > m.length) throw ERR.REF;
      for (let c = 0; c < m[0].length; c++) {
        if (exact ? compare(m[0][c], key, '=') : compare(m[0][c], key, '<=')) return m[row - 1][c];
      }
      throw ERR.NA;
    },
    TODAY: () => { const d = new Date(); return Math.floor(d.getTime() / 86400000) + 25569 - (d.getTimezoneOffset() / 1440); },
    NOW: () => Date.now() / 86400000 + 25569,
    DATE: (args, ctx) => {
      const y = toNumber(scalar(evaluate(args[0], ctx)));
      const m = toNumber(scalar(evaluate(args[1], ctx)));
      const d = toNumber(scalar(evaluate(args[2], ctx)));
      const ms = Date.UTC(y, m - 1, d);
      return ms / 86400000 + 25569;
    },
    YEAR: (args, ctx) => new Date((toNumber(scalar(evaluate(args[0], ctx))) - 25569) * 86400000).getUTCFullYear(),
    MONTH: (args, ctx) => new Date((toNumber(scalar(evaluate(args[0], ctx))) - 25569) * 86400000).getUTCMonth() + 1,
    DAY: (args, ctx) => new Date((toNumber(scalar(evaluate(args[0], ctx))) - 25569) * 86400000).getUTCDate(),
    ISBLANK: (args, ctx) => { const v = scalar(evaluate(args[0], ctx)); return v === null || v === undefined || v === ''; },
    ISNUMBER: (args, ctx) => typeof scalar(evaluate(args[0], ctx)) === 'number',
    ISTEXT: (args, ctx) => typeof scalar(evaluate(args[0], ctx)) === 'string',
    ISERROR: (args, ctx) => { try { return isErr(scalar(evaluate(args[0], ctx))); } catch (e) { return isErr(e); } },
  };

  // ---------- Cálculo de planilha ----------
  // Guarda células como texto bruto; calcula com memoização e detecção de ciclos.
  class Sheet {
    constructor(data) {
      this.raw = new Map(); // "A1" -> string bruta
      this.cache = new Map();
      this.parsed = new Map();
      this.stack = new Set();
      if (data) for (const k in data) this.raw.set(k, data[k]);
    }
    setRaw(addr, text) {
      if (text === '' || text === null || text === undefined) this.raw.delete(addr);
      else this.raw.set(addr, String(text));
      this.parsed.delete(addr);
      this.cache.clear();
    }
    getRaw(addr) { return this.raw.get(addr) ?? ''; }
    isFormula(addr) { return (this.getRaw(addr) || '').startsWith('='); }

    // Valor calculado de uma célula
    value(addr) {
      if (this.cache.has(addr)) return this.cache.get(addr);
      const text = this.getRaw(addr);
      let result;
      if (text === '') result = null;
      else if (text.startsWith('=')) {
        if (this.stack.has(addr)) return ERR.CIRC;
        this.stack.add(addr);
        try {
          let ast = this.parsed.get(addr);
          if (!ast) { ast = parseFormula(text.slice(1)); this.parsed.set(addr, ast); }
          const ctx = { getCell: (r, c) => this.value(addrToStr(r, c)) };
          result = scalar(evaluate(ast, ctx));
          if (result === undefined) result = null;
        } catch (e) {
          if (isErr(e)) result = e;
          else result = ERR.ERROR;
        } finally {
          this.stack.delete(addr);
        }
      } else {
        const t = text.trim();
        const n = Number(t);
        // pt-BR: vírgula decimal e ponto de milhar (ex.: 2,5 ou 1.234,56)
        const ptBR = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$|^[-+]?\d+,\d+$/.test(t);
        if (ptBR) result = Number(t.replace(/\./g, '').replace(',', '.'));
        else if (t !== '' && !isNaN(n) && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) result = n;
        else if (/^(TRUE|VERDADEIRO)$/i.test(text)) result = true;
        else if (/^(FALSE|FALSO)$/i.test(text)) result = false;
        else result = text;
      }
      this.cache.set(addr, result);
      return result;
    }
  }

  global.GridEngine = {
    Sheet, CellError, ERR, colToNum, numToCol, parseAddr, addrToStr, parseFormula, tokenize, toStr, toNumber,
    FUNCTION_NAMES: Object.keys(FUNCTIONS).sort(),
  };
})(window);
