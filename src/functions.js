// Biblioteca de funções (parte 1): matemática, estatística, lógica, busca e matrizes.
// Cada função recebe os nós da fórmula (avaliação preguiçosa) e o contexto.
(function () {
  'use strict';
  const E = window.GridEngine;
  const { evaluate: ev, scalarOf, toMatrix, flat, isErr, ERR, mkErr, Matrix, RangeRef, compare, def, alias, isArr, safe } = E;
  const N = E.toNumber, S = E.toStr, B = E.toBool;

  // ---------- Auxiliares ----------
  const has = (args, i) => i < args.length && args[i].k !== 'empty';
  const val = (args, i, ctx) => (has(args, i) ? scalarOf(ev(args[i], ctx)) : undefined);
  const num = (args, i, ctx, d) => { const v = val(args, i, ctx); return v === undefined ? d : N(v); };
  const str = (args, i, ctx, d) => { const v = val(args, i, ctx); return v === undefined ? d : S(v); };
  const bool = (args, i, ctx, d) => { const v = val(args, i, ctx); return v === undefined ? d : B(v); };
  const mat = (args, i, ctx) => toMatrix(ev(args[i], ctx));
  const need = (args, n, name) => { if (args.length < n) throw mkErr('#N/A', `Número de argumentos incorreto para ${name}.`); };

  // Números para agregações: de intervalos, só números; digitados direto, convertidos
  function nums(args, ctx) {
    const out = [];
    for (const it of flat(args, ctx)) {
      const v = it.v;
      if (isErr(v)) throw v;
      if (it.fromRange) { if (typeof v === 'number') out.push(v); }
      else if (v !== null) out.push(N(v));
    }
    return out;
  }
  // Função escalar que se aplica elemento a elemento quando recebe matrizes (como ARRAYFORMULA)
  function elementwise(f) {
    return (args, ctx) => {
      const vals = args.map((a) => (a.k === 'empty' ? undefined : ev(a, ctx)));
      if (!vals.some(isArr)) return f(...vals.map((v) => (v === undefined ? undefined : scalarOf(v))));
      const Ms = vals.map((v) => (v === undefined ? null : toMatrix(v)));
      const h = Math.max(...Ms.map((m) => (m ? m.length : 1)));
      const w = Math.max(...Ms.map((m) => (m ? m[0].length : 1)));
      const out = [];
      for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < w; j++) {
          row.push(safe(() => f(...Ms.map((m) => {
            if (!m) return undefined;
            const ii = m.length === 1 ? 0 : i, jj = m[0].length === 1 ? 0 : j;
            return ii < m.length && jj < m[0].length ? m[ii][jj] : ERR.NA;
          }))));
        }
        out.push(row);
      }
      return new Matrix(out);
    };
  }
  const num1 = (f) => elementwise((x, ...rest) => f(N(x), ...rest));
  const opt = (v, d) => (v === undefined ? d : N(v));

  // Critérios no estilo CONT.SE: ">5", "<>x", "a*", "=", número, booleano
  function makeCrit(crit) {
    if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => !isErr(v) && v !== null && compare(v, crit, '=');
    if (isErr(crit)) return (v) => isErr(v) && v.code === crit.code;
    const s = crit === null || crit === undefined ? '' : String(crit);
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(s);
    const op = m[1] || '=';
    const rhs = m[2];
    const lit = E.parseLiteral(rhs);
    if (typeof lit.v === 'number' && rhs.trim() !== '') {
      const n = lit.v;
      return (v) => typeof v === 'number' && compare(v, n, op);
    }
    if (op === '=' || op === '<>') {
      if (rhs === '') return op === '=' ? (v) => v === null || v === '' : (v) => !(v === null || v === '');
      const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002')
        .replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
      const test = (v) => v !== null && !isErr(v) && re.test(typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : String(v));
      return op === '=' ? test : (v) => !test(v);
    }
    return (v) => typeof v === 'string' && compare(v, rhs, op);
  }
  // Pares (intervalo, critério) para SOMASES e similares
  function multiCrit(args, ctx, start) {
    const pairs = [];
    for (let i = start; i + 1 < args.length; i += 2) pairs.push({ m: mat(args, i, ctx), f: makeCrit(val(args, i + 1, ctx)) });
    return (r, c) => pairs.every((p) => p.m[r] !== undefined && p.m[r][c] !== undefined && p.f(p.m[r][c]));
  }
  // Ordenação genérica de valores de planilha
  function cmpValues(a, b) {
    const rank = (v) => (v === null || v === '' ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 4);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0 || ra === 2) return a - b;
    if (ra === 1) return a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });
    return 0;
  }
  E.cmpValues = cmpValues;
  E.makeCrit = makeCrit;

  const round = (x, d) => { const f = Math.pow(10, d); return Math.round((x + Math.sign(x) * Number.EPSILON * Math.abs(x)) * f) / f; };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => { if (!a.length) throw mkErr('#DIV/0!', 'Não há números para calcular a média.'); return sum(a) / a.length; };
  const variance = (a, sample) => {
    const n = a.length;
    if (n < (sample ? 2 : 1)) throw ERR.DIV0;
    const m = mean(a);
    return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - (sample ? 1 : 0));
  };
  function percentile(a, k) {
    if (!a.length || k < 0 || k > 1) throw ERR.NUM;
    const s = a.slice().sort((x, y) => x - y);
    const pos = (s.length - 1) * k, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  const gcd = (a, b) => { a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b)); while (b) [a, b] = [b, a % b]; return a; };
  const fact = (n) => { if (n < 0) throw ERR.NUM; let r = 1; for (let i = 2; i <= Math.floor(n); i++) r *= i; return r; };

  // ---------- Matemática ----------
  const M = 'Matemática';
  def('SUM', 'SOMA', 'valor1; [valor2; …]', 'Retorna a soma de uma série de números e/ou células.', (a, c) => sum(nums(a, c)), M);
  def('PRODUCT', 'MULT', 'fator1; [fator2; …]', 'Retorna o produto de uma série de números.', (a, c) => nums(a, c).reduce((s, x) => s * x, 1), M);
  alias('PRODUTO', 'PRODUCT');
  def('SUMSQ', 'SOMAQUAD', 'valor1; [valor2; …]', 'Retorna a soma dos quadrados.', (a, c) => sum(nums(a, c).map((x) => x * x)), M);
  def('SUMIF', 'SOMASE', 'intervalo; critério; [intervalo_soma]', 'Soma as células de um intervalo que atendem a um critério.', (a, c) => {
    need(a, 2, 'SOMASE');
    const m = mat(a, 0, c), f = makeCrit(val(a, 1, c)), sm = has(a, 2) ? mat(a, 2, c) : m;
    let s = 0;
    m.forEach((row, i) => row.forEach((v, j) => { if (f(v)) { const x = sm[i] && sm[i][j]; if (typeof x === 'number') s += x; } }));
    return s;
  }, M);
  def('SUMIFS', 'SOMASES', 'intervalo_soma; intervalo_critério1; critério1; […]', 'Soma um intervalo de acordo com vários critérios.', (a, c) => {
    need(a, 3, 'SOMASES');
    const sm = mat(a, 0, c), ok = multiCrit(a, c, 1);
    let s = 0;
    sm.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ok(i, j)) s += x; }));
    return s;
  }, M);
  def('SUMPRODUCT', 'SOMARPRODUTO', 'matriz1; [matriz2; …]', 'Multiplica matrizes de mesmo tamanho e soma os produtos.', (a, c) => {
    const ms = a.map((_, i) => mat(a, i, c));
    const h = ms[0].length, w = ms[0][0].length;
    if (ms.some((m) => m.length !== h || m[0].length !== w)) throw mkErr('#VALUE!', 'As matrizes de SOMARPRODUTO precisam ter o mesmo tamanho.');
    let s = 0;
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
      let p = 1;
      for (const m of ms) { const v = m[i][j]; if (isErr(v)) throw v; p *= typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0; }
      s += p;
    }
    return s;
  }, M);
  def('ABS', 'ABS', 'valor', 'Retorna o valor absoluto de um número.', num1(Math.abs), M);
  def('SQRT', 'RAIZ', 'valor', 'Retorna a raiz quadrada positiva.', num1((x) => { if (x < 0) throw ERR.NUM; return Math.sqrt(x); }), M);
  def('POWER', 'POTÊNCIA', 'base; expoente', 'Eleva um número a uma potência.', elementwise((x, y) => { const r = Math.pow(N(x), N(y)); if (!isFinite(r)) throw ERR.NUM; return r; }), M);
  alias('POTENCIA', 'POWER');
  def('MOD', 'MOD', 'dividendo; divisor', 'Retorna o resto de uma divisão.', elementwise((x, y) => { const d = N(y); if (d === 0) throw ERR.DIV0; const n = N(x); return n - d * Math.floor(n / d); }), M);
  def('QUOTIENT', 'QUOCIENTE', 'dividendo; divisor', 'Retorna a parte inteira de uma divisão.', elementwise((x, y) => { const d = N(y); if (d === 0) throw ERR.DIV0; return Math.trunc(N(x) / d); }), M);
  def('INT', 'INT', 'valor', 'Arredonda para baixo até o inteiro mais próximo.', num1(Math.floor), M);
  def('TRUNC', 'TRUNCAR', 'valor; [casas]', 'Trunca um número, removendo casas decimais.', elementwise((x, d) => { const f = Math.pow(10, opt(d, 0)); return Math.trunc(N(x) * f) / f; }), M);
  def('ROUND', 'ARRED', 'valor; [casas]', 'Arredonda um número para um número de casas decimais.', elementwise((x, d) => round(N(x), opt(d, 0))), M);
  alias('ARREDONDAR', 'ROUND');
  def('ROUNDUP', 'ARREDONDAR.PARA.CIMA', 'valor; [casas]', 'Arredonda afastando de zero.', elementwise((x, d) => {
    const f = Math.pow(10, opt(d, 0)), n = N(x); return (n < 0 ? -Math.ceil(-n * f - 1e-9) : Math.ceil(n * f - 1e-9)) / f;
  }), M);
  def('ROUNDDOWN', 'ARREDONDAR.PARA.BAIXO', 'valor; [casas]', 'Arredonda em direção a zero.', elementwise((x, d) => {
    const f = Math.pow(10, opt(d, 0)), n = N(x); return (n < 0 ? -Math.floor(-n * f + 1e-9) : Math.floor(n * f + 1e-9)) / f;
  }), M);
  def('MROUND', 'MARRED', 'valor; fator', 'Arredonda para o múltiplo mais próximo.', elementwise((x, f) => { const m = N(f); return m === 0 ? 0 : Math.round(N(x) / m) * m; }), M);
  def('CEILING', 'TETO', 'valor; [fator]', 'Arredonda para cima até o múltiplo mais próximo.', elementwise((x, f) => { const m = opt(f, 1); return m === 0 ? 0 : Math.ceil(N(x) / m - 1e-12) * m; }), M);
  def('FLOOR', 'ARREDMULTB', 'valor; [fator]', 'Arredonda para baixo até o múltiplo mais próximo.', elementwise((x, f) => { const m = opt(f, 1); return m === 0 ? 0 : Math.floor(N(x) / m + 1e-12) * m; }), M);
  def('EVEN', 'PAR', 'valor', 'Arredonda para o próximo inteiro par.', num1((x) => { const r = Math.ceil(Math.abs(x)); return Math.sign(x || 1) * (r % 2 ? r + 1 : r); }), M);
  def('ODD', 'ÍMPAR', 'valor', 'Arredonda para o próximo inteiro ímpar.', num1((x) => { const r = Math.ceil(Math.abs(x)); return Math.sign(x || 1) * (r % 2 ? r : r + 1); }), M);
  def('SIGN', 'SINAL', 'valor', 'Retorna -1, 0 ou 1 conforme o sinal.', num1(Math.sign), M);
  def('EXP', 'EXP', 'expoente', 'Retorna e elevado a uma potência.', num1(Math.exp), M);
  def('LN', 'LN', 'valor', 'Logaritmo natural.', num1((x) => { if (x <= 0) throw ERR.NUM; return Math.log(x); }), M);
  def('LOG', 'LOG', 'valor; [base]', 'Logaritmo em uma base (padrão 10).', elementwise((x, b) => { const n = N(x), bb = opt(b, 10); if (n <= 0 || bb <= 0 || bb === 1) throw ERR.NUM; return Math.log(n) / Math.log(bb); }), M);
  def('LOG10', 'LOG10', 'valor', 'Logaritmo na base 10.', num1((x) => { if (x <= 0) throw ERR.NUM; return Math.log10(x); }), M);
  def('PI', 'PI', '', 'Retorna o valor de π.', () => Math.PI, M);
  def('RAND', 'ALEATÓRIO', '', 'Número aleatório entre 0 e 1.', () => Math.random(), M);
  def('RANDBETWEEN', 'ALEATÓRIOENTRE', 'inferior; superior', 'Inteiro aleatório entre dois valores.', (a, c) => {
    const lo = Math.ceil(num(a, 0, c)), hi = Math.floor(num(a, 1, c));
    if (hi < lo) throw ERR.NUM;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }, M);
  def('RANDARRAY', 'MATRIZALEATÓRIA', '[linhas]; [colunas]', 'Matriz de números aleatórios.', (a, c) => {
    const h = num(a, 0, c, 1), w = num(a, 1, c, 1);
    if (h < 1 || w < 1 || h * w > 100000) throw ERR.NUM;
    return new Matrix(Array.from({ length: h }, () => Array.from({ length: w }, () => Math.random())));
  }, M);
  def('FACT', 'FATORIAL', 'valor', 'Fatorial de um número.', num1(fact), M);
  def('COMBIN', 'COMBIN', 'n; k', 'Número de combinações.', elementwise((n, k) => { n = N(n); k = N(k); if (k > n || k < 0) throw ERR.NUM; return Math.round(fact(n) / (fact(k) * fact(n - k))); }), M);
  def('GCD', 'MDC', 'valor1; [valor2; …]', 'Máximo divisor comum.', (a, c) => nums(a, c).reduce(gcd, 0), M);
  def('LCM', 'MMC', 'valor1; [valor2; …]', 'Mínimo múltiplo comum.', (a, c) => nums(a, c).reduce((x, y) => (x && y ? Math.abs(x * y) / gcd(x, y) : 0), 1), M);
  def('SIN', 'SEN', 'ângulo', 'Seno (radianos).', num1(Math.sin), M);
  def('COS', 'COS', 'ângulo', 'Cosseno (radianos).', num1(Math.cos), M);
  def('TAN', 'TAN', 'ângulo', 'Tangente (radianos).', num1(Math.tan), M);
  def('ASIN', 'ASEN', 'valor', 'Arco seno.', num1(Math.asin), M);
  def('ACOS', 'ACOS', 'valor', 'Arco cosseno.', num1(Math.acos), M);
  def('ATAN', 'ATAN', 'valor', 'Arco tangente.', num1(Math.atan), M);
  def('ATAN2', 'ATAN2', 'x; y', 'Arco tangente de coordenadas.', elementwise((x, y) => Math.atan2(N(y), N(x))), M);
  def('DEGREES', 'GRAUS', 'ângulo', 'Converte radianos em graus.', num1((x) => (x * 180) / Math.PI), M);
  def('RADIANS', 'RADIANOS', 'ângulo', 'Converte graus em radianos.', num1((x) => (x * Math.PI) / 180), M);
  def('SEQUENCE', 'SEQUÊNCIA', 'linhas; [colunas]; [início]; [passo]', 'Retorna uma matriz de números sequenciais.', (a, c) => {
    const h = num(a, 0, c), w = num(a, 1, c, 1), st = num(a, 2, c, 1), step = num(a, 3, c, 1);
    if (h < 1 || w < 1 || h * w > 100000) throw mkErr('#NUM!', 'SEQUÊNCIA precisa de linhas e colunas maiores que zero.');
    return new Matrix(Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => st + step * (i * w + j))));
  }, M);
  alias('SEQUENCIA', 'SEQUENCE');

  // ---------- Estatística ----------
  const ST = 'Estatística';
  def('AVERAGE', 'MÉDIA', 'valor1; [valor2; …]', 'Retorna a média aritmética, ignorando texto.', (a, c) => mean(nums(a, c)), ST);
  alias('MEDIA', 'AVERAGE');
  def('AVERAGEA', 'MÉDIAA', 'valor1; [valor2; …]', 'Média considerando texto como 0.', (a, c) => {
    const v = flat(a, c).filter((x) => x.v !== null).map((x) => (typeof x.v === 'number' ? x.v : typeof x.v === 'boolean' ? +x.v : 0));
    return mean(v);
  }, ST);
  def('AVERAGEIF', 'MÉDIASE', 'intervalo; critério; [intervalo_média]', 'Média das células que atendem a um critério.', (a, c) => {
    const m = mat(a, 0, c), f = makeCrit(val(a, 1, c)), am = has(a, 2) ? mat(a, 2, c) : m;
    const out = [];
    m.forEach((row, i) => row.forEach((v, j) => { if (f(v)) { const x = am[i] && am[i][j]; if (typeof x === 'number') out.push(x); } }));
    return mean(out);
  }, ST);
  alias('MEDIASE', 'AVERAGEIF');
  def('AVERAGEIFS', 'MÉDIASES', 'intervalo_média; intervalo_critério1; critério1; […]', 'Média de acordo com vários critérios.', (a, c) => {
    const am = mat(a, 0, c), ok = multiCrit(a, c, 1), out = [];
    am.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ok(i, j)) out.push(x); }));
    return mean(out);
  }, ST);
  def('MEDIAN', 'MED', 'valor1; [valor2; …]', 'Retorna a mediana.', (a, c) => percentile(nums(a, c), 0.5), ST);
  def('MODE', 'MODO', 'valor1; [valor2; …]', 'Valor mais frequente.', (a, c) => {
    const cnt = new Map(); let best = null, bc = 1;
    for (const x of nums(a, c)) { const k = (cnt.get(x) || 0) + 1; cnt.set(x, k); if (k > bc) { bc = k; best = x; } }
    if (best === null) throw ERR.NA;
    return best;
  }, ST);
  def('MIN', 'MÍNIMO', 'valor1; [valor2; …]', 'Retorna o menor valor.', (a, c) => { const n = nums(a, c); return n.length ? Math.min(...n) : 0; }, ST);
  def('MAX', 'MÁXIMO', 'valor1; [valor2; …]', 'Retorna o maior valor.', (a, c) => { const n = nums(a, c); return n.length ? Math.max(...n) : 0; }, ST);
  alias('MINIMO', 'MIN'); alias('MAXIMO', 'MAX');
  def('MINIFS', 'MÍNIMOSES', 'intervalo; intervalo_critério1; critério1; […]', 'Menor valor que atende aos critérios.', (a, c) => {
    const m = mat(a, 0, c), ok = multiCrit(a, c, 1), out = [];
    m.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ok(i, j)) out.push(x); }));
    return out.length ? Math.min(...out) : 0;
  }, ST);
  def('MAXIFS', 'MÁXIMOSES', 'intervalo; intervalo_critério1; critério1; […]', 'Maior valor que atende aos critérios.', (a, c) => {
    const m = mat(a, 0, c), ok = multiCrit(a, c, 1), out = [];
    m.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ok(i, j)) out.push(x); }));
    return out.length ? Math.max(...out) : 0;
  }, ST);
  def('COUNT', 'CONT.NÚM', 'valor1; [valor2; …]', 'Conta os valores numéricos.', (a, c) => flat(a, c).filter((x) => typeof x.v === 'number' || (!x.fromRange && x.v !== null && typeof E.parseLiteral(String(x.v)).v === 'number')).length, ST);
  alias('CONT.NUM', 'COUNT');
  def('COUNTA', 'CONT.VALORES', 'valor1; [valor2; …]', 'Conta os valores não vazios.', (a, c) => flat(a, c).filter((x) => x.v !== null && x.v !== '').length, ST);
  def('COUNTBLANK', 'CONTAR.VAZIO', 'intervalo', 'Conta as células vazias.', (a, c) => flat(a, c).filter((x) => x.v === null || x.v === '').length, ST);
  def('COUNTIF', 'CONT.SE', 'intervalo; critério', 'Conta as células que atendem a um critério.', (a, c) => {
    need(a, 2, 'CONT.SE');
    const f = makeCrit(val(a, 1, c));
    let n = 0;
    for (const row of mat(a, 0, c)) for (const v of row) if (f(v)) n++;
    return n;
  }, ST);
  def('COUNTIFS', 'CONT.SES', 'intervalo_critério1; critério1; […]', 'Conta de acordo com vários critérios.', (a, c) => {
    const m = mat(a, 0, c), ok = multiCrit(a, c, 0);
    let n = 0;
    m.forEach((row, i) => row.forEach((_, j) => { if (ok(i, j)) n++; }));
    return n;
  }, ST);
  def('COUNTUNIQUE', 'CONTAR.ÚNICOS', 'valor1; [valor2; …]', 'Conta os valores únicos.', (a, c) => {
    const set = new Set();
    for (const x of flat(a, c)) if (x.v !== null && x.v !== '') set.add(typeof x.v + ':' + String(x.v).toLowerCase());
    return set.size;
  }, ST);
  def('LARGE', 'MAIOR', 'dados; n', 'Retorna o n-ésimo maior valor.', (a, c) => {
    const d = nums([a[0]], c).sort((x, y) => y - x), k = num(a, 1, c);
    if (k < 1 || k > d.length) throw ERR.NUM;
    return d[Math.floor(k) - 1];
  }, ST);
  def('SMALL', 'MENOR', 'dados; n', 'Retorna o n-ésimo menor valor.', (a, c) => {
    const d = nums([a[0]], c).sort((x, y) => x - y), k = num(a, 1, c);
    if (k < 1 || k > d.length) throw ERR.NUM;
    return d[Math.floor(k) - 1];
  }, ST);
  def('RANK', 'ORDEM', 'valor; dados; [crescente]', 'Posição de um valor em uma lista.', (a, c) => {
    const x = num(a, 0, c), d = nums([a[1]], c), asc = bool(a, 2, c, false);
    if (!d.includes(x)) throw ERR.NA;
    return 1 + d.filter((y) => (asc ? y < x : y > x)).length;
  }, ST);
  alias('ORDEM.EQ', 'RANK');
  def('STDEV', 'DESVPAD', 'valor1; [valor2; …]', 'Desvio padrão de uma amostra.', (a, c) => Math.sqrt(variance(nums(a, c), true)), ST);
  def('STDEVP', 'DESVPADP', 'valor1; [valor2; …]', 'Desvio padrão da população.', (a, c) => Math.sqrt(variance(nums(a, c), false)), ST);
  def('VAR', 'VAR', 'valor1; [valor2; …]', 'Variância de uma amostra.', (a, c) => variance(nums(a, c), true), ST);
  def('VARP', 'VARP', 'valor1; [valor2; …]', 'Variância da população.', (a, c) => variance(nums(a, c), false), ST);
  def('PERCENTILE', 'PERCENTIL', 'dados; k', 'Retorna o k-ésimo percentil.', (a, c) => percentile(nums([a[0]], c), num(a, 1, c)), ST);
  def('QUARTILE', 'QUARTIL', 'dados; quarto', 'Retorna um quartil.', (a, c) => {
    const q = Math.floor(num(a, 1, c));
    if (q < 0 || q > 4) throw ERR.NUM;
    return percentile(nums([a[0]], c), q / 4);
  }, ST);
  def('CORREL', 'CORREL', 'dados_y; dados_x', 'Coeficiente de correlação.', (a, c) => {
    const X = [], Y = [];
    const m1 = mat(a, 0, c).flat(), m2 = mat(a, 1, c).flat();
    m1.forEach((y, i) => { const x = m2[i]; if (typeof x === 'number' && typeof y === 'number') { X.push(x); Y.push(y); } });
    const mx = mean(X), my = mean(Y);
    let sxy = 0, sxx = 0, syy = 0;
    X.forEach((x, i) => { sxy += (x - mx) * (Y[i] - my); sxx += (x - mx) ** 2; syy += (Y[i] - my) ** 2; });
    if (!sxx || !syy) throw ERR.DIV0;
    return sxy / Math.sqrt(sxx * syy);
  }, ST);

  // ---------- Lógica ----------
  const L = 'Lógica';
  def('IF', 'SE', 'expressão_lógica; valor_se_verdadeiro; [valor_se_falso]', 'Retorna um valor se a expressão for verdadeira e outro se for falsa.', (a, c) => {
    need(a, 2, 'SE');
    const cond = ev(a[0], c);
    if (isArr(cond)) {
      const tv = has(a, 1) ? ev(a[1], c) : true, fv = has(a, 2) ? ev(a[2], c) : false;
      const pickV = (v, i, j) => {
        if (!isArr(v)) return scalarOf(v);
        const m = toMatrix(v); const ii = m.length === 1 ? 0 : i, jj = m[0].length === 1 ? 0 : j;
        return m[ii] && m[ii][jj] !== undefined ? m[ii][jj] : ERR.NA;
      };
      return new Matrix(toMatrix(cond).map((row, i) => row.map((x, j) => safe(() => (B(x) ? pickV(tv, i, j) : pickV(fv, i, j))))));
    }
    if (B(scalarOf(cond))) return has(a, 1) ? ev(a[1], c) : true;
    return a.length > 2 ? (has(a, 2) ? ev(a[2], c) : null) : false;
  }, L);
  def('IFS', 'SES', 'condição1; valor1; [condição2; valor2; …]', 'Avalia várias condições e retorna o valor da primeira verdadeira.', (a, c) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (B(val(a, i, c))) return ev(a[i + 1], c);
    throw mkErr('#N/A', 'Nenhuma condição de SES é verdadeira.');
  }, L);
  def('SWITCH', 'PARÂMETRO', 'expressão; caso1; valor1; […]; [padrão]', 'Compara uma expressão com casos e retorna o valor correspondente.', (a, c) => {
    const x = val(a, 0, c);
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (compare(x, val(a, i, c), '=')) return ev(a[i + 1], c);
    if (i < a.length) return ev(a[i], c);
    throw ERR.NA;
  }, L);
  alias('PARAMETRO', 'SWITCH');
  def('IFERROR', 'SEERRO', 'valor; [valor_se_erro]', 'Retorna o primeiro argumento se não for erro; caso contrário, o segundo.', (a, c) => {
    const alt = () => (has(a, 1) ? ev(a[1], c) : null);
    let v;
    try { v = ev(a[0], c); } catch (e) { if (isErr(e)) return alt(); throw e; }
    if (isArr(v)) { const al = scalarOf(alt()); return new Matrix(toMatrix(v).map((row) => row.map((x) => (isErr(x) ? al : x)))); }
    return isErr(scalarOf(v)) ? alt() : v;
  }, L);
  def('IFNA', 'SENÃODISP', 'valor; valor_se_na', 'Retorna o segundo argumento se o primeiro for #N/A.', (a, c) => {
    let v;
    try { v = scalarOf(ev(a[0], c)); } catch (e) { if (isErr(e) && e.code === '#N/A') return ev(a[1], c); throw e; }
    return isErr(v) && v.code === '#N/A' ? ev(a[1], c) : v;
  }, L);
  alias('SENAODISP', 'IFNA');
  def('AND', 'E', 'expressão1; [expressão2; …]', 'Verdadeiro se todos os argumentos forem verdadeiros.', (a, c) => flat(a, c).filter((x) => !(x.fromRange && (x.v === null || typeof x.v === 'string'))).every((x) => B(x.v)), L);
  def('OR', 'OU', 'expressão1; [expressão2; …]', 'Verdadeiro se algum argumento for verdadeiro.', (a, c) => flat(a, c).filter((x) => !(x.fromRange && (x.v === null || typeof x.v === 'string'))).some((x) => B(x.v)), L);
  def('XOR', 'OUEXCLUSIVO', 'expressão1; [expressão2; …]', 'Verdadeiro se um número ímpar de argumentos for verdadeiro.', (a, c) => flat(a, c).filter((x) => x.v !== null).filter((x) => B(x.v)).length % 2 === 1, L);
  alias('XOU', 'XOR');
  def('NOT', 'NÃO', 'expressão', 'Inverte o valor lógico.', elementwise((x) => !B(x)), L);
  alias('NAO', 'NOT');
  def('TRUE', 'VERDADEIRO', '', 'Retorna VERDADEIRO.', () => true, L);
  def('FALSE', 'FALSO', '', 'Retorna FALSO.', () => false, L);
  def('LET', 'LET', 'nome1; valor1; […]; expressão', 'Atribui nomes a resultados de cálculos.', (a, c) => {
    if (a.length < 3 || a.length % 2 === 0) throw mkErr('#N/A', 'LET precisa de pares nome/valor e uma expressão final.');
    const scope = { map: new Map(), parent: c.vars };
    const ctx = Object.assign({}, c, { vars: scope });
    for (let i = 0; i + 1 < a.length; i += 2) {
      if (a[i].k !== 'name') throw mkErr('#ERROR!', 'Nome inválido em LET.');
      scope.map.set(a[i].v, ev(a[i + 1], ctx));
    }
    return ev(a[a.length - 1], ctx);
  }, L);

  // ---------- Busca e referência ----------
  const R = 'Busca';
  function lookupIndex(key, arr, mode) {
    // mode: 0 exata, 1 menor ou igual (ordenado), -1 maior ou igual (ordenado decrescente)
    if (mode === 0) {
      const f = typeof key === 'string' && /[*?]/.test(key) ? makeCrit(key) : null;
      for (let i = 0; i < arr.length; i++) if (f ? f(arr[i]) : (arr[i] !== null && compare(arr[i], key, '='))) return i;
      return -1;
    }
    let best = -1;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null || typeof v !== typeof key) continue;
      if (mode === 1 ? compare(v, key, '<=') : compare(v, key, '>=')) best = i; else break;
    }
    return best;
  }
  def('VLOOKUP', 'PROCV', 'chave; intervalo; índice; [classificado]', 'Busca na primeira coluna de um intervalo e retorna o valor de outra coluna.', (a, c) => {
    need(a, 3, 'PROCV');
    const key = val(a, 0, c), m = mat(a, 1, c), col = Math.floor(num(a, 2, c)), sorted = bool(a, 3, c, true);
    if (col < 1 || col > m[0].length) throw mkErr('#REF!', 'O índice de PROCV está fora do intervalo.');
    const i = lookupIndex(key, m.map((r) => r[0]), sorted ? 1 : 0);
    if (i < 0) throw mkErr('#N/A', `Não foi encontrado o valor "${S(key)}" na avaliação de PROCV.`);
    return m[i][col - 1];
  }, R);
  def('HLOOKUP', 'PROCH', 'chave; intervalo; índice; [classificado]', 'Busca na primeira linha de um intervalo.', (a, c) => {
    const key = val(a, 0, c), m = mat(a, 1, c), row = Math.floor(num(a, 2, c)), sorted = bool(a, 3, c, true);
    if (row < 1 || row > m.length) throw ERR.REF;
    const i = lookupIndex(key, m[0], sorted ? 1 : 0);
    if (i < 0) throw mkErr('#N/A', `Não foi encontrado o valor "${S(key)}" na avaliação de PROCH.`);
    return m[row - 1][i];
  }, R);
  def('XLOOKUP', 'PROCX', 'chave; intervalo_busca; intervalo_resultado; [se_não_encontrado]; [modo_correspondência]; [modo_pesquisa]', 'Busca um valor e retorna o item correspondente de outro intervalo.', (a, c) => {
    need(a, 3, 'PROCX');
    const key = val(a, 0, c), lm = mat(a, 1, c), rm = mat(a, 2, c);
    const matchMode = num(a, 4, c, 0), searchMode = num(a, 5, c, 1);
    const vertical = lm[0].length === 1;
    const list = vertical ? lm.map((r) => r[0]) : lm[0];
    let order = list.map((_, i) => i);
    if (searchMode === -1) order = order.reverse();
    let found = -1;
    if (matchMode === 0 || matchMode === 2) {
      const f = matchMode === 2 ? makeCrit(key) : null;
      for (const i of order) if (f ? f(list[i]) : (list[i] !== null && compare(list[i], key, '='))) { found = i; break; }
    } else {
      let bestD = Infinity;
      for (const i of order) {
        const v = list[i];
        if (v === null) continue;
        if (compare(v, key, '=')) { found = i; break; }
        if (typeof v === 'number' && typeof key === 'number') {
          const d = v - key;
          if ((matchMode === -1 && d < 0 && -d < bestD) || (matchMode === 1 && d > 0 && d < bestD)) { bestD = Math.abs(d); found = i; }
        }
      }
    }
    if (found < 0) {
      if (has(a, 3)) return ev(a[3], c);
      throw mkErr('#N/A', `Não foi encontrado o valor "${S(key)}" na avaliação de PROCX.`);
    }
    if (vertical) return rm[0].length === 1 ? rm[found][0] : new Matrix([rm[found]]);
    return rm.length === 1 ? rm[0][found] : new Matrix(rm.map((r) => [r[found]]));
  }, R);
  def('LOOKUP', 'PROC', 'chave; intervalo_busca; [intervalo_resultado]', 'Busca em um intervalo ordenado.', (a, c) => {
    const key = val(a, 0, c), lm = mat(a, 1, c);
    const vertical = lm[0].length === 1 || lm.length > lm[0].length;
    const list = vertical ? lm.map((r) => r[0]) : lm[0];
    const i = lookupIndex(key, list, 1);
    if (i < 0) throw ERR.NA;
    if (has(a, 2)) { const rm = mat(a, 2, c).flat(); return rm[i]; }
    return vertical ? lm[i][lm[0].length - 1] : lm[lm.length - 1][i];
  }, R);
  def('MATCH', 'CORRESP', 'chave; intervalo; [tipo]', 'Retorna a posição de um item em um intervalo.', (a, c) => {
    const key = val(a, 0, c), m = mat(a, 1, c), type = num(a, 2, c, 1);
    const list = m.length === 1 ? m[0] : m.map((r) => r[0]);
    const i = lookupIndex(key, list, type === 0 ? 0 : type > 0 ? 1 : -1);
    if (i < 0) throw mkErr('#N/A', `Não foi encontrado o valor "${S(key)}" na avaliação de CORRESP.`);
    return i + 1;
  }, R);
  def('XMATCH', 'CORRESPX', 'chave; intervalo; [modo_correspondência]; [modo_pesquisa]', 'Posição relativa de um item.', (a, c) => {
    const key = val(a, 0, c), m = mat(a, 1, c), mode = num(a, 2, c, 0);
    const list = m.length === 1 ? m[0] : m.map((r) => r[0]);
    const i = lookupIndex(key, list, mode === 2 ? 0 : mode);
    if (i < 0) throw ERR.NA;
    return i + 1;
  }, R);
  def('INDEX', 'ÍNDICE', 'referência; [linha]; [coluna]', 'Retorna o conteúdo de uma célula, especificado por linha e coluna.', (a, c) => {
    const ref = ev(a[0], c);
    const r = num(a, 1, c, 0), co = num(a, 2, c, 0);
    if (ref instanceof RangeRef) {
      let rr = r, cc = co;
      if (ref.h === 1 && has(a, 1) && !has(a, 2)) { cc = r; rr = 1; }
      if (rr < 0 || cc < 0 || rr > ref.h || cc > ref.w) throw mkErr('#REF!', 'Linha ou coluna fora do intervalo em ÍNDICE.');
      const r1 = rr ? ref.r1 + rr - 1 : ref.r1, r2 = rr ? r1 : ref.r2;
      const c1 = cc ? ref.c1 + cc - 1 : ref.c1, c2 = cc ? c1 : ref.c2;
      return new RangeRef(ref.wb, ref.si, r1, c1, r2, c2);
    }
    const m = toMatrix(ref);
    let rr = r, cc = co;
    if (m.length === 1 && has(a, 1) && !has(a, 2)) { cc = r; rr = 1; }
    if (rr > m.length || cc > m[0].length) throw ERR.REF;
    if (!rr && !cc) return new Matrix(m);
    if (!rr) return new Matrix(m.map((row) => [row[cc - 1]]));
    if (!cc) return new Matrix([m[rr - 1]]);
    return m[rr - 1][cc - 1];
  }, R);
  alias('INDICE', 'INDEX');
  def('CHOOSE', 'ESCOLHER', 'índice; opção1; [opção2; …]', 'Retorna um elemento de uma lista de opções.', (a, c) => {
    const i = Math.floor(num(a, 0, c));
    if (i < 1 || i >= a.length) throw ERR.VALUE;
    return ev(a[i], c);
  }, R);
  def('ROW', 'LIN', '[referência]', 'Retorna o número da linha.', (a, c) => {
    if (!has(a, 0)) return c.row;
    const ref = ev(a[0], c);
    if (!(ref instanceof RangeRef)) throw ERR.VALUE;
    return ref.h > 1 ? new Matrix(Array.from({ length: ref.h }, (_, i) => [ref.r1 + i])) : ref.r1;
  }, R);
  def('COLUMN', 'COL', '[referência]', 'Retorna o número da coluna.', (a, c) => {
    if (!has(a, 0)) return c.col;
    const ref = ev(a[0], c);
    if (!(ref instanceof RangeRef)) throw ERR.VALUE;
    return ref.w > 1 ? new Matrix([Array.from({ length: ref.w }, (_, j) => ref.c1 + j)]) : ref.c1;
  }, R);
  def('ROWS', 'LINS', 'intervalo', 'Número de linhas de um intervalo.', (a, c) => mat(a, 0, c).length, R);
  def('COLUMNS', 'COLS', 'intervalo', 'Número de colunas de um intervalo.', (a, c) => mat(a, 0, c)[0].length, R);
  def('OFFSET', 'DESLOC', 'referência; linhas; colunas; [altura]; [largura]', 'Retorna uma referência deslocada.', (a, c) => {
    const ref = ev(a[0], c);
    if (!(ref instanceof RangeRef)) throw ERR.VALUE;
    const r1 = ref.r1 + num(a, 1, c, 0), c1 = ref.c1 + num(a, 2, c, 0);
    const h = num(a, 3, c, ref.h), w = num(a, 4, c, ref.w);
    if (r1 < 1 || c1 < 1 || h < 1 || w < 1) throw ERR.REF;
    return new RangeRef(ref.wb, ref.si, r1, c1, r1 + h - 1, c1 + w - 1);
  }, R);
  def('INDIRECT', 'INDIRETO', 'texto_ref', 'Retorna a referência indicada por um texto.', (a, c) => {
    const text = str(a, 0, c, '');
    let toks;
    try { toks = E.tokenize(text); } catch (e) { throw mkErr('#REF!', `"${text}" não é uma referência válida.`); }
    if (toks.length !== 2 || toks[0].t !== 'ref') throw mkErr('#REF!', `"${text}" não é uma referência válida.`);
    return ev({ k: 'ref', sheet: toks[0].sheet, ref: toks[0].ref }, c);
  }, R);
  def('ADDRESS', 'ENDEREÇO', 'linha; coluna; [tipo_abs]', 'Retorna o endereço de uma célula como texto.', (a, c) => {
    const r = num(a, 0, c), co = num(a, 1, c), t = num(a, 2, c, 1);
    return (t === 1 || t === 3 ? '$' : '') + E.numToCol(co) + (t === 1 || t === 2 ? '$' : '') + r;
  }, R);
  alias('ENDERECO', 'ADDRESS');
  def('HYPERLINK', 'HIPERLINK', 'url; [rótulo]', 'Cria um link em uma célula.', (a, c) => str(a, 1, c, str(a, 0, c, '')), R);

  // ---------- Filtros e matrizes ----------
  const F = 'Filtro';
  def('FILTER', 'FILTER', 'intervalo; condição1; [condição2; …]', 'Retorna as linhas ou colunas do intervalo que atendem às condições.', (a, c) => {
    need(a, 2, 'FILTER');
    const m = mat(a, 0, c);
    const conds = a.slice(1).map((_, i) => mat(a, i + 1, c));
    const byRow = conds.every((k) => k.length === m.length && k[0].length === 1);
    const byCol = !byRow && conds.every((k) => k.length === 1 && k[0].length === m[0].length);
    if (!byRow && !byCol) throw mkErr('#VALUE!', 'FILTER tem tamanhos de intervalo incompatíveis.');
    let out;
    if (byRow) out = m.filter((_, i) => conds.every((k) => { const v = k[i][0]; if (isErr(v)) throw v; return B(v); }));
    else {
      const keep = m[0].map((_, j) => conds.every((k) => B(k[0][j])));
      out = m.map((row) => row.filter((_, j) => keep[j]));
      if (!out[0].length) out = [];
    }
    if (!out.length) throw mkErr('#N/A', 'Nenhuma correspondência encontrada na avaliação de FILTER.');
    return new Matrix(out);
  }, F);
  def('SORT', 'CLASSIFICAR', 'intervalo; [coluna; crescente; …]', 'Classifica as linhas de um intervalo por uma ou mais colunas.', (a, c) => {
    const m = mat(a, 0, c).map((r) => r.slice());
    const keys = [];
    for (let i = 1; i < a.length; i += 2) keys.push({ col: num(a, i, c, 1) - 1, asc: bool(a, i + 1, c, true) });
    if (!keys.length) keys.push({ col: 0, asc: true });
    m.sort((x, y) => {
      for (const k of keys) {
        const d = cmpValues(x[k.col], y[k.col]);
        if (d) return k.asc ? d : -d;
      }
      return 0;
    });
    return new Matrix(m);
  }, F);
  def('SORTN', 'CLASSIFICARN', 'intervalo; [n]; [modo_empates]; [coluna; crescente]', 'Retorna os n primeiros itens após classificar.', (a, c) => {
    const n = num(a, 1, c, 1);
    const m = mat(a, 0, c).map((r) => r.slice());
    const col = num(a, 3, c, 1) - 1, asc = bool(a, 4, c, true);
    m.sort((x, y) => (asc ? 1 : -1) * cmpValues(x[col], y[col]));
    return new Matrix(m.slice(0, Math.max(1, n)));
  }, F);
  def('UNIQUE', 'ÚNICO', 'intervalo', 'Retorna as linhas únicas, sem duplicatas.', (a, c) => {
    const seen = new Set(), out = [];
    for (const row of mat(a, 0, c)) {
      const k = row.map((v) => typeof v + ':' + (typeof v === 'string' ? v.toLowerCase() : String(v))).join('\u0001');
      if (!seen.has(k)) { seen.add(k); out.push(row); }
    }
    return new Matrix(out);
  }, F);
  alias('UNICO', 'UNIQUE');
  def('TRANSPOSE', 'TRANSPOR', 'intervalo', 'Troca linhas por colunas.', (a, c) => {
    const m = mat(a, 0, c);
    return new Matrix(m[0].map((_, j) => m.map((r) => r[j])));
  }, F);
  def('ARRAYFORMULA', 'ARRAYFORMULA', 'fórmula_matricial', 'Permite exibir valores de uma fórmula matricial em várias linhas e colunas.', (a, c) => ev(a[0], c), F);
  def('FLATTEN', 'FLATTEN', 'intervalo1; [intervalo2; …]', 'Transforma intervalos em uma única coluna.', (a, c) => new Matrix(flat(a, c).map((x) => [x.v])), F);
  def('ARRAY_CONSTRAIN', 'ARRAY_CONSTRAIN', 'intervalo; linhas; colunas', 'Limita o resultado de uma matriz a um tamanho.', (a, c) => {
    const m = mat(a, 0, c), h = num(a, 1, c), w = num(a, 2, c);
    return new Matrix(m.slice(0, h).map((r) => r.slice(0, w)));
  }, F);
  def('CHOOSECOLS', 'ESCOLHERCOLS', 'intervalo; coluna1; [coluna2; …]', 'Seleciona colunas de um intervalo.', (a, c) => {
    const m = mat(a, 0, c), cols = a.slice(1).map((_, i) => num(a, i + 1, c));
    return new Matrix(m.map((r) => cols.map((k) => r[k < 0 ? r.length + k : k - 1])));
  }, F);
  def('CHOOSEROWS', 'ESCOLHERLINS', 'intervalo; linha1; [linha2; …]', 'Seleciona linhas de um intervalo.', (a, c) => {
    const m = mat(a, 0, c), rows = a.slice(1).map((_, i) => num(a, i + 1, c));
    return new Matrix(rows.map((k) => m[k < 0 ? m.length + k : k - 1] || m[0].map(() => ERR.NA)));
  }, F);

  E.helpers = { has, val, num, str, bool, mat, nums, elementwise, need, round, mean };
})();
