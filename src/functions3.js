// Biblioteca de funções (parte 3): funções do Google Planilhas que ainda faltavam
// (matemática, operadores, estatística, datas com fim de semana personalizado, finanças, matrizes, texto e informações).
(function () {
  'use strict';
  const E = window.GridEngine;
  const { evaluate: ev, scalarOf, toMatrix, flat, isErr, ERR, mkErr, Matrix, def, alias } = E;
  const N = E.toNumber, S = E.toStr, B = E.toBool;
  const { has, val, num, str, bool, mat, nums, elementwise, need } = E.helpers;
  const num1 = (f) => elementwise((x, ...r) => f(N(x), ...r));
  const opt = (v, d) => (v === undefined ? d : N(v));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => { if (!a.length) throw ERR.DIV0; return sum(a) / a.length; };
  const fin = (x) => { if (!isFinite(x)) throw ERR.NUM; return x; };
  const M = 'Matemática', OP = 'Operador', ST = 'Estatística', D = 'Data', T = 'Texto', I = 'Informações', A = 'Filtro', FN = 'Finanças';

  // ---------- Matemática ----------
  // SUBTOTAL(código; intervalos): 1/101 MÉDIA, 2 CONT.NÚM, 3 CONT.VALORES, 4 MÁXIMO, 5 MÍNIMO, 6 MULT, 7 DESVPAD, 8 DESVPADP, 9 SOMA, 10 VAR, 11 VARP
  const SUBT = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' };
  def('SUBTOTAL', 'SUBTOTAL', 'código_função; intervalo1; [intervalo2; …]', 'Subtotal de um intervalo com a função escolhida pelo código (1 = MÉDIA, 2 = CONT.NÚM, 3 = CONT.VALORES, 4 = MÁXIMO, 5 = MÍNIMO, 6 = MULT, 7 = DESVPAD, 8 = DESVPADP, 9 = SOMA, 10 = VAR, 11 = VARP).', (a, c) => {
    need(a, 2, 'SUBTOTAL');
    const code = Math.floor(num(a, 0, c)) % 100;
    const fn = E.FUNCTIONS[SUBT[code]];
    if (!fn) throw mkErr('#VALUE!', 'Código de função inválido em SUBTOTAL.');
    return fn.impl(a.slice(1), c);
  }, M);
  def('SQRTPI', 'RAIZPI', 'valor', 'Raiz quadrada de (valor × π).', num1((x) => { if (x < 0) throw ERR.NUM; return Math.sqrt(x * Math.PI); }), M);
  def('FACTDOUBLE', 'FATDUPLO', 'valor', 'Fatorial duplo (n × (n−2) × …).', num1((x) => { if (x < -1) throw ERR.NUM; let r = 1; for (let i = Math.floor(x); i > 1; i -= 2) r *= i; return r; }), M);
  const factN = (n) => { if (n < 0) throw ERR.NUM; let r = 1; for (let i = 2; i <= Math.floor(n); i++) r *= i; return r; };
  const comb = (n, k) => { n = Math.floor(n); k = Math.floor(k); if (n < 0 || k < 0 || k > n) throw ERR.NUM; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
  def('MULTINOMIAL', 'MULTINOMIAL', 'valor1; [valor2; …]', 'Fatorial da soma dividido pelo produto dos fatoriais.', (a, c) => { const v = nums(a, c).map(Math.floor); return fin(factN(sum(v)) / v.reduce((p, x) => p * factN(x), 1)); }, M);
  def('COMBINA', 'COMBINA', 'n; k', 'Combinações com repetição.', elementwise((n, k) => comb(N(n) + N(k) - 1, N(k))), M);
  def('PERMUT', 'PERMUT', 'n; k', 'Número de permutações de k itens escolhidos entre n.', elementwise((n, k) => { n = Math.floor(N(n)); k = Math.floor(N(k)); if (n < 0 || k < 0 || k > n) throw ERR.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; }), ST);
  def('PERMUTATIONA', 'PERMUTATIONA', 'n; k', 'Permutações com repetição (n elevado a k).', elementwise((n, k) => { if (N(n) < 0 || N(k) < 0) throw ERR.NUM; return Math.pow(Math.floor(N(n)), Math.floor(N(k))); }), ST);
  def('BASE', 'BASE', 'valor; base; [comprimento_mínimo]', 'Converte um número para outra base (2 a 36).', elementwise((v, b, l) => { const n = Math.floor(N(v)), bb = Math.floor(N(b)); if (n < 0 || bb < 2 || bb > 36) throw ERR.NUM; return n.toString(bb).toUpperCase().padStart(Math.floor(opt(l, 0)), '0'); }), M);
  def('DECIMAL', 'DECIMAL', 'texto; base', 'Converte um número de outra base para decimal.', elementwise((t, b) => { const bb = Math.floor(N(b)); if (bb < 2 || bb > 36) throw ERR.NUM; const s = S(t).trim().toLowerCase(); if (!s) return 0; const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, bb); if ([...s].some((ch) => !digits.includes(ch))) throw ERR.NUM; return parseInt(s, bb); }), M);
  const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  def('ROMAN', 'ROMANO', 'número', 'Converte um número em algarismos romanos.', num1((x) => { let n = Math.floor(x); if (n < 0 || n > 3999) throw ERR.VALUE; let out = ''; for (const [v, r] of ROMAN) while (n >= v) { out += r; n -= v; } return out; }), M);
  def('ARABIC', 'ARÁBICO', 'romano', 'Converte algarismos romanos em número.', elementwise((t) => { const s = S(t).trim().toUpperCase(); const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let n = 0; for (let i = 0; i < s.length; i++) { const v = map[s[i]], nx = map[s[i + 1]]; if (!v) throw ERR.VALUE; n += nx > v ? -v : v; } return n; }), M);
  alias('ARABICO', 'ARABIC');
  const trig = [
    ['SINH', 'SENH', 'Seno hiperbólico.', Math.sinh], ['COSH', 'COSH', 'Cosseno hiperbólico.', Math.cosh], ['TANH', 'TANH', 'Tangente hiperbólica.', Math.tanh],
    ['ASINH', 'ASENH', 'Arco seno hiperbólico.', Math.asinh], ['ACOSH', 'ACOSH', 'Arco cosseno hiperbólico.', (x) => { if (x < 1) throw ERR.NUM; return Math.acosh(x); }],
    ['ATANH', 'ATANH', 'Arco tangente hiperbólica.', (x) => { if (Math.abs(x) >= 1) throw ERR.NUM; return Math.atanh(x); }],
    ['COT', 'COT', 'Cotangente.', (x) => { if (x === 0) throw ERR.DIV0; return 1 / Math.tan(x); }], ['COTH', 'COTH', 'Cotangente hiperbólica.', (x) => { if (x === 0) throw ERR.DIV0; return 1 / Math.tanh(x); }],
    ['SEC', 'SEC', 'Secante.', (x) => 1 / Math.cos(x)], ['SECH', 'SECH', 'Secante hiperbólica.', (x) => 1 / Math.cosh(x)],
    ['CSC', 'COSEC', 'Cossecante.', (x) => { if (x === 0) throw ERR.DIV0; return 1 / Math.sin(x); }], ['CSCH', 'CSCH', 'Cossecante hiperbólica.', (x) => { if (x === 0) throw ERR.DIV0; return 1 / Math.sinh(x); }],
    ['ACOT', 'ACOT', 'Arco cotangente.', (x) => Math.PI / 2 - Math.atan(x)], ['ACOTH', 'ACOTH', 'Arco cotangente hiperbólica.', (x) => { if (Math.abs(x) <= 1) throw ERR.NUM; return 0.5 * Math.log((x + 1) / (x - 1)); }],
  ];
  for (const [n, pt, d, f] of trig) def(n, pt, 'valor', d, num1(f), M);
  const ceilM = (x, sig, mode) => { const s = Math.abs(opt(sig, 1)) || 1; if (x < 0 && mode) return -Math.ceil(-x / s - 1e-12) * s; return Math.ceil(x / s - 1e-12) * s; };
  const floorM = (x, sig, mode) => { const s = Math.abs(opt(sig, 1)) || 1; if (x < 0 && mode) return -Math.floor(-x / s + 1e-12) * s; return Math.floor(x / s + 1e-12) * s; };
  def('CEILING.MATH', 'TETO.MAT', 'número; [significância]; [modo]', 'Arredonda para cima até o múltiplo mais próximo.', elementwise((x, s, m) => ceilM(N(x), s, opt(m, 0) !== 0)), M);
  def('FLOOR.MATH', 'ARREDMULTB.MAT', 'número; [significância]; [modo]', 'Arredonda para baixo até o múltiplo mais próximo.', elementwise((x, s, m) => floorM(N(x), s, opt(m, 0) !== 0)), M);
  def('CEILING.PRECISE', 'TETO.PRECISO', 'número; [significância]', 'Arredonda para cima, sempre em direção ao infinito positivo.', elementwise((x, s) => ceilM(N(x), s, false)), M);
  def('FLOOR.PRECISE', 'FLOOR.PRECISE', 'número; [significância]', 'Arredonda para baixo, sempre em direção ao infinito negativo.', elementwise((x, s) => floorM(N(x), s, false)), M);
  def('ISO.CEILING', 'ISO.TETO', 'número; [significância]', 'Arredonda para cima até o múltiplo mais próximo.', elementwise((x, s) => ceilM(N(x), s, false)), M);
  def('ISBETWEEN', 'ISBETWEEN', 'valor; menor; maior; [incluir_menor]; [incluir_maior]', 'Verifica se um número está entre dois valores.', elementwise((v, lo, hi, il, ih) => {
    const x = N(v), a = N(lo), b = N(hi), inA = il === undefined ? true : B(il), inB = ih === undefined ? true : B(ih);
    return (inA ? x >= a : x > a) && (inB ? x <= b : x < b);
  }), M);

  // ---------- Operadores (as mesmas contas dos sinais + − × ÷ e comparações) ----------
  const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' }));
  const ops = [
    ['ADD', 'Soma dois números (o mesmo que +).', (x, y) => N(x) + N(y)], ['MINUS', 'Subtrai dois números (o mesmo que −).', (x, y) => N(x) - N(y)],
    ['MULTIPLY', 'Multiplica dois números (o mesmo que ×).', (x, y) => N(x) * N(y)], ['DIVIDE', 'Divide dois números (o mesmo que ÷).', (x, y) => { if (N(y) === 0) throw ERR.DIV0; return N(x) / N(y); }],
    ['POW', 'Eleva um número a uma potência (o mesmo que ^).', (x, y) => fin(Math.pow(N(x), N(y)))],
    ['EQ', 'Verdadeiro se os valores forem iguais (=).', (x, y) => cmp(x, y) === 0], ['NE', 'Verdadeiro se os valores forem diferentes (<>).', (x, y) => cmp(x, y) !== 0],
    ['GT', 'Verdadeiro se o 1º for maior (>).', (x, y) => cmp(x, y) > 0], ['GTE', 'Verdadeiro se o 1º for maior ou igual (>=).', (x, y) => cmp(x, y) >= 0],
    ['LT', 'Verdadeiro se o 1º for menor (<).', (x, y) => cmp(x, y) < 0], ['LTE', 'Verdadeiro se o 1º for menor ou igual (<=).', (x, y) => cmp(x, y) <= 0],
  ];
  for (const [n, d, f] of ops) def(n, n, 'valor1; valor2', d, elementwise(f), OP);
  def('UMINUS', 'UMINUS', 'valor', 'Inverte o sinal de um número.', num1((x) => -x), OP);
  def('UPLUS', 'UPLUS', 'valor', 'Retorna o próprio número.', num1((x) => x), OP);
  def('UNARY_PERCENT', 'UNARY_PERCENT', 'porcentagem', 'Divide o número por 100.', num1((x) => x / 100), OP);

  // ---------- Estatística ----------
  const pairs = (a, c, i, j) => {
    const Y = mat(a, i, c).flat(), X = mat(a, j, c).flat();
    if (Y.length !== X.length) throw ERR.NA;
    const xs = [], ys = [];
    Y.forEach((y, k) => { const x = X[k]; if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); } });
    return { xs, ys };
  };
  const reg = (xs, ys) => {
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; });
    if (!sxx) throw ERR.DIV0;
    const slope = sxy / sxx;
    return { slope, icpt: my - slope * mx, sxy, sxx, syy, mx, my, n: xs.length };
  };
  const varOf = (a, sample) => { const n = a.length; if (n < (sample ? 2 : 1)) throw ERR.DIV0; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - (sample ? 1 : 0)); };
  // versões "A": texto conta como 0 e VERDADEIRO como 1
  const numsA = (a, c) => { const out = []; for (const it of flat(a, c)) { const v = it.v; if (isErr(v)) throw v; if (v === null || v === '') { if (!it.fromRange) out.push(0); continue; } out.push(typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : it.fromRange ? 0 : N(v)); } return out; };
  const pct = (arr, k, exc) => {
    const s = arr.slice().sort((x, y) => x - y), n = s.length;
    if (!n) throw ERR.NUM;
    if (exc) { const pos = k * (n + 1) - 1; if (pos < 0 || pos > n - 1) throw ERR.NUM; const lo = Math.floor(pos); return s[lo] + (s[Math.min(n - 1, lo + 1)] - s[lo]) * (pos - lo); }
    if (k < 0 || k > 1) throw ERR.NUM;
    const pos = (n - 1) * k, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  def('AVERAGE.WEIGHTED', 'AVERAGE.WEIGHTED', 'valores; pesos; [valores2; pesos2; …]', 'Média ponderada.', (a, c) => {
    let s = 0, w = 0;
    for (let i = 0; i + 1 < a.length; i += 2) {
      const V = mat(a, i, c).flat(), W = mat(a, i + 1, c).flat();
      if (V.length !== W.length) throw ERR.VALUE;
      V.forEach((v, k) => { if (typeof v === 'number' && typeof W[k] === 'number') { s += v * W[k]; w += W[k]; } });
    }
    if (!w) throw ERR.DIV0;
    return s / w;
  }, ST);
  alias('MÉDIA.PONDERADA', 'AVERAGE.WEIGHTED'); alias('MEDIA.PONDERADA', 'AVERAGE.WEIGHTED');
  def('GEOMEAN', 'MÉDIA.GEOMÉTRICA', 'valor1; [valor2; …]', 'Média geométrica.', (a, c) => { const v = nums(a, c); if (!v.length || v.some((x) => x <= 0)) throw ERR.NUM; return Math.exp(sum(v.map(Math.log)) / v.length); }, ST);
  def('HARMEAN', 'MÉDIA.HARMÔNICA', 'valor1; [valor2; …]', 'Média harmônica.', (a, c) => { const v = nums(a, c); if (!v.length || v.some((x) => x <= 0)) throw ERR.NUM; return v.length / sum(v.map((x) => 1 / x)); }, ST);
  def('TRIMMEAN', 'MÉDIA.INTERNA', 'dados; porcentagem_excluída', 'Média sem os extremos (exclui a porcentagem indicada, metade em cada ponta).', (a, c) => {
    const v = nums([a[0]], c).sort((x, y) => x - y), p = num(a, 1, c);
    if (p < 0 || p >= 1) throw ERR.NUM;
    const k = Math.floor((v.length * p) / 2);
    return mean(v.slice(k, v.length - k));
  }, ST);
  def('AVEDEV', 'DESV.MÉDIO', 'valor1; [valor2; …]', 'Média dos desvios absolutos em relação à média.', (a, c) => { const v = nums(a, c), m = mean(v); return mean(v.map((x) => Math.abs(x - m))); }, ST);
  def('DEVSQ', 'DESVQ', 'valor1; [valor2; …]', 'Soma dos quadrados dos desvios.', (a, c) => { const v = nums(a, c), m = mean(v); return sum(v.map((x) => (x - m) ** 2)); }, ST);
  def('MAXA', 'MÁXIMOA', 'valor1; [valor2; …]', 'Maior valor (texto conta como 0 e VERDADEIRO como 1).', (a, c) => { const v = numsA(a, c); return v.length ? Math.max(...v) : 0; }, ST);
  def('MINA', 'MÍNIMOA', 'valor1; [valor2; …]', 'Menor valor (texto conta como 0 e VERDADEIRO como 1).', (a, c) => { const v = numsA(a, c); return v.length ? Math.min(...v) : 0; }, ST);
  def('STDEVA', 'DESVPADA', 'valor1; [valor2; …]', 'Desvio padrão da amostra (texto conta como 0).', (a, c) => Math.sqrt(varOf(numsA(a, c), true)), ST);
  def('STDEVPA', 'DESVPADPA', 'valor1; [valor2; …]', 'Desvio padrão da população (texto conta como 0).', (a, c) => Math.sqrt(varOf(numsA(a, c), false)), ST);
  def('VARA', 'VARA', 'valor1; [valor2; …]', 'Variância da amostra (texto conta como 0).', (a, c) => varOf(numsA(a, c), true), ST);
  def('VARPA', 'VARPA', 'valor1; [valor2; …]', 'Variância da população (texto conta como 0).', (a, c) => varOf(numsA(a, c), false), ST);
  def('STDEV.S', 'DESVPAD.A', 'valor1; [valor2; …]', 'Desvio padrão de uma amostra.', (a, c) => Math.sqrt(varOf(nums(a, c), true)), ST);
  def('STDEV.P', 'DESVPAD.P', 'valor1; [valor2; …]', 'Desvio padrão da população.', (a, c) => Math.sqrt(varOf(nums(a, c), false)), ST);
  def('VAR.S', 'VAR.A', 'valor1; [valor2; …]', 'Variância de uma amostra.', (a, c) => varOf(nums(a, c), true), ST);
  def('VAR.P', 'VAR.P', 'valor1; [valor2; …]', 'Variância da população.', (a, c) => varOf(nums(a, c), false), ST);
  const modes = (v) => { const cnt = new Map(); let best = 1; for (const x of v) { const n = (cnt.get(x) || 0) + 1; cnt.set(x, n); best = Math.max(best, n); } if (best < 2) throw ERR.NA; const seen = []; for (const x of v) if (cnt.get(x) === best && !seen.includes(x)) seen.push(x); return seen; };
  def('MODE.SNGL', 'MODO.ÚNICO', 'valor1; [valor2; …]', 'Valor que mais se repete.', (a, c) => modes(nums(a, c))[0], ST);
  def('MODE.MULT', 'MODO.MULT', 'valor1; [valor2; …]', 'Todos os valores que mais se repetem (em coluna).', (a, c) => new Matrix(modes(nums(a, c)).map((x) => [x])), ST);
  def('PERCENTILE.INC', 'PERCENTIL.INC', 'dados; k', 'k-ésimo percentil (k de 0 a 1, inclusive).', (a, c) => pct(nums([a[0]], c), num(a, 1, c), false), ST);
  def('PERCENTILE.EXC', 'PERCENTIL.EXC', 'dados; k', 'k-ésimo percentil (k entre 0 e 1, exclusive).', (a, c) => pct(nums([a[0]], c), num(a, 1, c), true), ST);
  def('QUARTILE.INC', 'QUARTIL.INC', 'dados; quarto', 'Quartil (0 a 4).', (a, c) => { const q = Math.floor(num(a, 1, c)); if (q < 0 || q > 4) throw ERR.NUM; return pct(nums([a[0]], c), q / 4, false); }, ST);
  def('QUARTILE.EXC', 'QUARTIL.EXC', 'dados; quarto', 'Quartil (1 a 3), exclusivo.', (a, c) => { const q = Math.floor(num(a, 1, c)); if (q < 1 || q > 3) throw ERR.NUM; return pct(nums([a[0]], c), q / 4, true); }, ST);
  def('MEDIAN.INC', 'MEDIAN.INC', 'valor1; [valor2; …]', 'Mediana.', (a, c) => pct(nums(a, c), 0.5, false), ST);
  def('RANK.AVG', 'ORDEM.MÉD', 'valor; dados; [crescente]', 'Posição de um valor; empates recebem a posição média.', (a, c) => {
    const x = num(a, 0, c), d = nums([a[1]], c), asc = bool(a, 2, c, false);
    const eq = d.filter((y) => y === x).length;
    if (!eq) throw ERR.NA;
    return 1 + d.filter((y) => (asc ? y < x : y > x)).length + (eq - 1) / 2;
  }, ST);
  alias('ORDEM.MED', 'RANK.AVG');
  const pRank = (d, x, sig, exc) => {
    const s = d.slice().sort((p, q) => p - q), n = s.length;
    if (!n || x < s[0] || x > s[n - 1]) throw ERR.NA;
    let lo = 0;
    while (lo < n - 1 && s[lo + 1] <= x) lo++;
    let r;
    if (s[lo] === x) r = exc ? (s.filter((y) => y < x).length + 1) / (n + 1) : s.filter((y) => y < x).length / (n - 1 || 1);
    else { const f = (x - s[lo]) / (s[lo + 1] - s[lo]); r = exc ? (lo + 1 + f) / (n + 1) : (lo + f) / (n - 1); }
    const k = Math.pow(10, Math.floor(opt(sig, 3)));
    return Math.floor(r * k + 1e-9) / k;
  };
  def('PERCENTRANK', 'ORDEM.PORCENTUAL', 'dados; valor; [casas]', 'Posição percentual de um valor nos dados.', (a, c) => pRank(nums([a[0]], c), num(a, 1, c), val(a, 2, c), false), ST);
  def('PERCENTRANK.INC', 'ORDEM.PORCENTUAL.INC', 'dados; valor; [casas]', 'Posição percentual (inclusiva).', (a, c) => pRank(nums([a[0]], c), num(a, 1, c), val(a, 2, c), false), ST);
  def('PERCENTRANK.EXC', 'ORDEM.PORCENTUAL.EXC', 'dados; valor; [casas]', 'Posição percentual (exclusiva).', (a, c) => pRank(nums([a[0]], c), num(a, 1, c), val(a, 2, c), true), ST);
  def('SLOPE', 'INCLINAÇÃO', 'dados_y; dados_x', 'Inclinação da reta de regressão linear.', (a, c) => { const p = pairs(a, c, 0, 1); return reg(p.xs, p.ys).slope; }, ST);
  alias('INCLINACAO', 'SLOPE');
  def('INTERCEPT', 'INTERCEPÇÃO', 'dados_y; dados_x', 'Ponto em que a reta de regressão cruza o eixo y.', (a, c) => { const p = pairs(a, c, 0, 1); return reg(p.xs, p.ys).icpt; }, ST);
  alias('INTERCEPCAO', 'INTERCEPT');
  def('RSQ', 'RQUAD', 'dados_y; dados_x', 'Quadrado do coeficiente de correlação (R²).', (a, c) => { const p = pairs(a, c, 0, 1), r = reg(p.xs, p.ys); if (!r.syy) throw ERR.DIV0; return (r.sxy * r.sxy) / (r.sxx * r.syy); }, ST);
  def('PEARSON', 'PEARSON', 'dados_y; dados_x', 'Coeficiente de correlação de Pearson.', (a, c) => { const p = pairs(a, c, 0, 1), r = reg(p.xs, p.ys); if (!r.syy) throw ERR.DIV0; return r.sxy / Math.sqrt(r.sxx * r.syy); }, ST);
  def('STEYX', 'EPADYX', 'dados_y; dados_x', 'Erro padrão do y previsto na regressão.', (a, c) => { const p = pairs(a, c, 0, 1), r = reg(p.xs, p.ys); if (r.n < 3) throw ERR.DIV0; return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2)); }, ST);
  const forecast = (a, c) => { const x = num(a, 0, c), p = pairs(a, c, 1, 2), r = reg(p.xs, p.ys); return r.icpt + r.slope * x; };
  def('FORECAST', 'PREVISÃO', 'x; dados_y; dados_x', 'Prevê um valor pela regressão linear.', forecast, ST);
  def('FORECAST.LINEAR', 'PREVISÃO.LINEAR', 'x; dados_y; dados_x', 'Prevê um valor pela regressão linear.', forecast, ST);
  alias('PREVISAO', 'FORECAST'); alias('PREVISAO.LINEAR', 'FORECAST.LINEAR');
  const covar = (a, c, sample) => { const p = pairs(a, c, 0, 1), mx = mean(p.xs), my = mean(p.ys); const n = p.xs.length; if (n < (sample ? 2 : 1)) throw ERR.DIV0; return p.xs.reduce((s, x, k) => s + (x - mx) * (p.ys[k] - my), 0) / (n - (sample ? 1 : 0)); };
  def('COVAR', 'COVAR', 'dados1; dados2', 'Covariância da população.', (a, c) => covar(a, c, false), ST);
  def('COVARIANCE.P', 'COVARIAÇÃO.P', 'dados1; dados2', 'Covariância da população.', (a, c) => covar(a, c, false), ST);
  def('COVARIANCE.S', 'COVARIAÇÃO.S', 'dados1; dados2', 'Covariância da amostra.', (a, c) => covar(a, c, true), ST);
  def('STANDARDIZE', 'PADRONIZAR', 'valor; média; desvio_padrão', 'Valor normalizado (z).', elementwise((x, m, s) => { if (N(s) <= 0) throw ERR.NUM; return (N(x) - N(m)) / N(s); }), ST);
  def('KURT', 'CURT', 'valor1; [valor2; …]', 'Curtose dos dados.', (a, c) => { const v = nums(a, c), n = v.length; if (n < 4) throw ERR.DIV0; const m = mean(v), s = Math.sqrt(varOf(v, true)); if (!s) throw ERR.DIV0; const k = sum(v.map((x) => ((x - m) / s) ** 4)); return (n * (n + 1) * k) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)); }, ST);
  def('SKEW', 'DISTORÇÃO', 'valor1; [valor2; …]', 'Assimetria dos dados.', (a, c) => { const v = nums(a, c), n = v.length; if (n < 3) throw ERR.DIV0; const m = mean(v), s = Math.sqrt(varOf(v, true)); if (!s) throw ERR.DIV0; return (n / ((n - 1) * (n - 2))) * sum(v.map((x) => ((x - m) / s) ** 3)); }, ST);
  alias('DISTORCAO', 'SKEW');
  def('FISHER', 'FISHER', 'valor', 'Transformação de Fisher.', num1((x) => { if (Math.abs(x) >= 1) throw ERR.NUM; return 0.5 * Math.log((1 + x) / (1 - x)); }), ST);
  def('FISHERINV', 'FISHERINV', 'valor', 'Inversa da transformação de Fisher.', num1((y) => (Math.exp(2 * y) - 1) / (Math.exp(2 * y) + 1)), ST);
  // distribuição normal
  const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
  const phiCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const phiPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const phiInv = (p) => {
    if (p <= 0 || p >= 1) throw ERR.NUM;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const cc = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((cc[0] * q + cc[1]) * q + cc[2]) * q + cc[3]) * q + cc[4]) * q + cc[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((cc[0] * q + cc[1]) * q + cc[2]) * q + cc[3]) * q + cc[4]) * q + cc[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };
  const normDist = elementwise((x, m, s, cum) => { const sd = N(s); if (sd <= 0) throw ERR.NUM; const z = (N(x) - N(m)) / sd; return B(cum) ? phiCdf(z) : phiPdf(z) / sd; });
  def('NORM.DIST', 'DIST.NORM.N', 'x; média; desvio_padrão; cumulativo', 'Distribuição normal.', normDist, ST);
  def('NORMDIST', 'DISTNORM', 'x; média; desvio_padrão; cumulativo', 'Distribuição normal.', normDist, ST);
  const normInv = elementwise((p, m, s) => { if (N(s) <= 0) throw ERR.NUM; return N(m) + N(s) * phiInv(N(p)); });
  def('NORM.INV', 'INV.NORM.N', 'probabilidade; média; desvio_padrão', 'Inversa da distribuição normal.', normInv, ST);
  def('NORMINV', 'INV.NORM', 'probabilidade; média; desvio_padrão', 'Inversa da distribuição normal.', normInv, ST);
  def('NORM.S.DIST', 'DIST.NORMP.N', 'z; [cumulativo]', 'Distribuição normal padrão.', elementwise((z, cum) => (cum === undefined || B(cum) ? phiCdf(N(z)) : phiPdf(N(z)))), ST);
  def('NORMSDIST', 'DISTNORMP', 'z', 'Distribuição normal padrão acumulada.', num1(phiCdf), ST);
  def('NORM.S.INV', 'INV.NORMP.N', 'probabilidade', 'Inversa da normal padrão.', num1(phiInv), ST);
  def('NORMSINV', 'INV.NORMP', 'probabilidade', 'Inversa da normal padrão.', num1(phiInv), ST);
  def('PHI', 'PHI', 'x', 'Densidade da normal padrão.', num1(phiPdf), ST);
  def('GAUSS', 'GAUSS', 'z', 'Probabilidade entre a média e z desvios padrão.', num1((z) => phiCdf(z) - 0.5), ST);
  def('CONFIDENCE.NORM', 'INT.CONFIANÇA.NORM', 'alfa; desvio_padrão; tamanho', 'Margem do intervalo de confiança (distribuição normal).', elementwise((al, s, n) => { if (N(al) <= 0 || N(al) >= 1 || N(s) <= 0 || N(n) < 1) throw ERR.NUM; return phiInv(1 - N(al) / 2) * N(s) / Math.sqrt(Math.floor(N(n))); }), ST);
  alias('CONFIDENCE', 'CONFIDENCE.NORM'); alias('INT.CONFIANÇA', 'CONFIDENCE.NORM'); alias('INT.CONFIANCA.NORM', 'CONFIDENCE.NORM');
  const expDist = elementwise((x, l, cum) => { const xx = N(x), lam = N(l); if (xx < 0 || lam <= 0) throw ERR.NUM; return B(cum) ? 1 - Math.exp(-lam * xx) : lam * Math.exp(-lam * xx); });
  def('EXPON.DIST', 'DISTEXPON', 'x; lambda; cumulativo', 'Distribuição exponencial.', expDist, ST);
  alias('EXPONDIST', 'EXPON.DIST');
  const poisson = elementwise((x, m, cum) => { const k = Math.floor(N(x)), mu = N(m); if (k < 0 || mu < 0) throw ERR.NUM; const pmf = (i) => Math.exp(-mu + i * Math.log(mu || 1e-300) - lgam(i + 1)); if (!B(cum)) return mu === 0 ? (k === 0 ? 1 : 0) : pmf(k); let s = 0; for (let i = 0; i <= k; i++) s += mu === 0 ? (i === 0 ? 1 : 0) : pmf(i); return Math.min(1, s); });
  def('POISSON.DIST', 'DIST.POISSON', 'x; média; cumulativo', 'Distribuição de Poisson.', poisson, ST);
  alias('POISSON', 'POISSON.DIST');
  const binom = elementwise((k, n, p, cum) => { const kk = Math.floor(N(k)), nn = Math.floor(N(n)), pp = N(p); if (kk < 0 || kk > nn || pp < 0 || pp > 1) throw ERR.NUM; const pmf = (i) => comb(nn, i) * Math.pow(pp, i) * Math.pow(1 - pp, nn - i); if (!B(cum)) return pmf(kk); let s = 0; for (let i = 0; i <= kk; i++) s += pmf(i); return Math.min(1, s); });
  def('BINOM.DIST', 'DISTR.BINOM', 'sucessos; tentativas; probabilidade; cumulativo', 'Distribuição binomial.', binom, ST);
  alias('BINOMDIST', 'BINOM.DIST');
  function lgam(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const q of g) s += q / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
  def('FREQUENCY', 'FREQÜÊNCIA', 'dados; classes', 'Quantos valores caem em cada faixa (em coluna, com uma linha a mais para os acima da última faixa).', (a, c) => {
    const d = nums([a[0]], c), bins = nums([a[1]], c).sort((x, y) => x - y);
    const out = bins.map(() => 0).concat([0]);
    for (const x of d) { let i = bins.findIndex((b) => x <= b); if (i < 0) i = bins.length; out[i]++; }
    return new Matrix(out.map((x) => [x]));
  }, ST);
  alias('FREQUENCIA', 'FREQUENCY'); alias('FREQUÊNCIA', 'FREQUENCY');

  // ---------- Datas ----------
  const ymdOf = (s) => { const d = E.serialToDate(s); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() }; };
  const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - E.EPOCH) / 86400000;
  const dnum = (x) => { if (typeof x === 'string') { const l = E.parseLiteral(x); if (typeof l.v === 'number') return l.v; } return N(x); };
  // fim de semana: número (1 = sáb/dom … 7 = sex/sáb, 11 = só domingo … 17 = só sábado) ou texto "0000011" (seg…dom, 1 = folga)
  const weekendOf = (w) => {
    const off = new Set();
    if (w === undefined || w === null || w === '') { off.add(6); off.add(0); return off; }
    if (typeof w === 'string' && /^[01]{7}$/.test(w)) { [...w].forEach((ch, i) => { if (ch === '1') off.add((i + 1) % 7); }); return off; }
    const n = Math.floor(N(w));
    const two = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6] };
    const one = { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4, 16: 5, 17: 6 };
    if (two[n]) two[n].forEach((x) => off.add(x)); else if (one[n] !== undefined) off.add(one[n]); else throw ERR.NUM;
    return off;
  };
  const hols = (a, i, c) => new Set(has(a, i) ? nums([a[i]], c).map(Math.floor) : []);
  def('WORKDAY.INTL', 'DIATRABALHO.INTL', 'data_inicial; dias; [fim_de_semana]; [feriados]', 'Data depois de um número de dias úteis, com fim de semana à escolha.', (a, c) => {
    let d = Math.floor(dnum(val(a, 0, c))), k = Math.floor(num(a, 1, c));
    const off = weekendOf(val(a, 2, c)), hol = hols(a, 3, c), step = k < 0 ? -1 : 1;
    if (off.size >= 7) throw ERR.NUM;
    while (k !== 0) { d += step; if (!off.has(ymdOf(d).w) && !hol.has(d)) k -= step; }
    return d;
  }, D);
  def('NETWORKDAYS.INTL', 'DIATRABALHOTOTAL.INTL', 'data_inicial; data_final; [fim_de_semana]; [feriados]', 'Dias úteis entre duas datas, com fim de semana à escolha.', (a, c) => {
    let s = Math.floor(dnum(val(a, 0, c))), e = Math.floor(dnum(val(a, 1, c)));
    const off = weekendOf(val(a, 2, c)), hol = hols(a, 3, c), sign = e < s ? -1 : 1;
    if (e < s) [s, e] = [e, s];
    let n = 0;
    for (let d = s; d <= e; d++) if (!off.has(ymdOf(d).w) && !hol.has(d)) n++;
    return n * sign;
  }, D);
  def('ISOWEEKNUM', 'NÚMSEMANAISO', 'data', 'Número da semana no padrão ISO (semana começa na segunda).', elementwise((x) => {
    const p = ymdOf(Math.floor(dnum(x)));
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    const day = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  }), D);
  alias('NUMSEMANAISO', 'ISOWEEKNUM');
  def('DAYS360', 'DIAS360', 'data_inicial; data_final; [método]', 'Dias entre duas datas num ano de 360 dias (12 meses de 30 dias).', elementwise((s, e, m) => {
    const a = ymdOf(Math.floor(dnum(s))), b = ymdOf(Math.floor(dnum(e))), eu = m !== undefined && B(m);
    let d1 = a.d, d2 = b.d;
    if (eu) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
    else {
      const lastFeb = (p) => p.m === 2 && p.d === new Date(Date.UTC(p.y, 2, 0)).getUTCDate();
      if (lastFeb(a)) { if (lastFeb(b)) d2 = 30; d1 = 30; }
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
    }
    return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
  }), D);
  def('EPOCHTODATE', 'EPOCHTODATE', 'carimbo; [unidade]', 'Converte um carimbo de tempo Unix (1 = segundos, 2 = milissegundos, 3 = microssegundos) em data e hora (UTC).', elementwise((t, u) => {
    const unit = Math.floor(opt(u, 1)), div = { 1: 1, 2: 1e3, 3: 1e6 }[unit];
    if (!div) throw ERR.NUM;
    return (N(t) / div * 1000 - E.EPOCH) / 86400000;
  }), D);

  // ---------- Texto ----------
  def('UNICHAR', 'CARACTUNICODE', 'número', 'Caractere com o código Unicode informado.', num1((x) => { const n = Math.floor(x); if (n < 1 || n > 0x10ffff) throw ERR.VALUE; return String.fromCodePoint(n); }), T);
  def('UNICODE', 'UNICODE', 'texto', 'Código Unicode do primeiro caractere.', elementwise((t) => { const s = S(t); if (!s) throw ERR.VALUE; return s.codePointAt(0); }), T);
  def('TEXTBEFORE', 'TEXTOANTES', 'texto; delimitador; [ocorrência]', 'Texto antes do delimitador.', elementwise((t, dl, n) => { const s = S(t), d = S(dl), k = Math.floor(opt(n, 1)); let i = -1; if (k > 0) { for (let j = 0; j < k; j++) { i = s.indexOf(d, i + 1); if (i < 0) throw ERR.NA; } } else { i = s.length; for (let j = 0; j < -k; j++) { i = s.lastIndexOf(d, i - 1); if (i < 0) throw ERR.NA; } } return s.slice(0, i); }), T);
  def('TEXTAFTER', 'TEXTODEPOIS', 'texto; delimitador; [ocorrência]', 'Texto depois do delimitador.', elementwise((t, dl, n) => { const s = S(t), d = S(dl), k = Math.floor(opt(n, 1)); let i = -1; if (k > 0) { for (let j = 0; j < k; j++) { i = s.indexOf(d, i + 1); if (i < 0) throw ERR.NA; } } else { i = s.length; for (let j = 0; j < -k; j++) { i = s.lastIndexOf(d, i - 1); if (i < 0) throw ERR.NA; } } return s.slice(i + d.length); }), T);

  // ---------- Informações ----------
  def('ISEMAIL', 'ISEMAIL', 'valor', 'Verifica se o valor é um endereço de e-mail válido.', elementwise((v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())), I);
  def('ISURL', 'ISURL', 'valor', 'Verifica se o valor é um endereço da web (URL).', elementwise((v) => typeof v === 'string' && /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(v.trim())), I);
  def('ISDATE', 'ISDATE', 'valor', 'Verifica se o valor é uma data.', (a, c) => {
    let v;
    try { v = scalarOf(ev(a[0], c)); } catch (e) { if (isErr(e)) return false; throw e; }
    if (typeof v === 'string') { const l = E.parseLiteral(v); return typeof l.v === 'number' && /[\/-]/.test(v); }
    return false;
  }, I);

  // ---------- Matrizes ----------
  const grid = (a, i, c) => toMatrix(ev(a[i], c));
  def('HSTACK', 'EMPILHARH', 'intervalo1; [intervalo2; …]', 'Junta intervalos lado a lado.', (a, c) => {
    const ms = a.map((_, i) => grid(a, i, c)), h = Math.max(...ms.map((m) => m.length));
    return new Matrix(Array.from({ length: h }, (_, r) => ms.flatMap((m) => (m[r] ? m[r] : m[0].map(() => ERR.NA)))));
  }, A);
  def('VSTACK', 'EMPILHARV', 'intervalo1; [intervalo2; …]', 'Junta intervalos um embaixo do outro.', (a, c) => {
    const ms = a.map((_, i) => grid(a, i, c)), w = Math.max(...ms.map((m) => m[0].length));
    return new Matrix(ms.flatMap((m) => m.map((row) => row.concat(Array(w - row.length).fill(ERR.NA)))));
  }, A);
  const ignore = (v, mode) => (mode === 1 || mode === 3) && (v === null || v === '') ? true : (mode === 2 || mode === 3) && isErr(v);
  def('TOCOL', 'PARACOL', 'intervalo; [ignorar]; [por_coluna]', 'Transforma um intervalo em uma coluna (ignorar: 1 vazias, 2 erros, 3 ambos).', (a, c) => {
    const m = grid(a, 0, c), mode = Math.floor(num(a, 1, c, 0)), byCol = bool(a, 2, c, false), out = [];
    if (byCol) { for (let j = 0; j < m[0].length; j++) for (let i = 0; i < m.length; i++) if (!ignore(m[i][j], mode)) out.push([m[i][j]]); }
    else for (const row of m) for (const v of row) if (!ignore(v, mode)) out.push([v]);
    if (!out.length) throw ERR.NA;
    return new Matrix(out);
  }, A);
  def('TOROW', 'PARALIN', 'intervalo; [ignorar]; [por_coluna]', 'Transforma um intervalo em uma linha.', (a, c) => {
    const m = grid(a, 0, c), mode = Math.floor(num(a, 1, c, 0)), byCol = bool(a, 2, c, false), out = [];
    if (byCol) { for (let j = 0; j < m[0].length; j++) for (let i = 0; i < m.length; i++) if (!ignore(m[i][j], mode)) out.push(m[i][j]); }
    else for (const row of m) for (const v of row) if (!ignore(v, mode)) out.push(v);
    if (!out.length) throw ERR.NA;
    return new Matrix([out]);
  }, A);
  const wrap = (a, c, rowsFirst) => {
    const v = grid(a, 0, c).flat(), k = Math.floor(num(a, 1, c)), pad = has(a, 2) ? val(a, 2, c) : ERR.NA;
    if (k < 1) throw ERR.NUM;
    const out = [];
    for (let i = 0; i < v.length; i += k) { const part = v.slice(i, i + k); while (part.length < k) part.push(pad); out.push(part); }
    if (rowsFirst) return new Matrix(out);
    return new Matrix(out[0].map((_, j) => out.map((r) => r[j])));
  };
  def('WRAPROWS', 'QUEBRARLINS', 'intervalo; quantidade; [preencher_com]', 'Distribui uma lista em linhas com a quantidade de colunas informada.', (a, c) => wrap(a, c, true), A);
  def('WRAPCOLS', 'QUEBRARCOLS', 'intervalo; quantidade; [preencher_com]', 'Distribui uma lista em colunas com a quantidade de linhas informada.', (a, c) => wrap(a, c, false), A);
  def('MMULT', 'MATRIZ.MULT', 'matriz1; matriz2', 'Produto de duas matrizes.', (a, c) => {
    const x = grid(a, 0, c), y = grid(a, 1, c);
    if (x[0].length !== y.length) throw ERR.VALUE;
    return new Matrix(x.map((row) => y[0].map((_, j) => row.reduce((s, v, k) => s + N(v) * N(y[k][j]), 0))));
  }, A);
  def('MDETERM', 'MATRIZ.DETERM', 'matriz', 'Determinante de uma matriz quadrada.', (a, c) => {
    const m = grid(a, 0, c).map((r) => r.map(N)), n = m.length;
    if (!n || m[0].length !== n) throw ERR.VALUE;
    let det = 1;
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
      if (Math.abs(m[p][i]) < 1e-15) return 0;
      if (p !== i) { [m[p], m[i]] = [m[i], m[p]]; det = -det; }
      det *= m[i][i];
      for (let r = i + 1; r < n; r++) { const f = m[r][i] / m[i][i]; for (let k = i; k < n; k++) m[r][k] -= f * m[i][k]; }
    }
    return det;
  }, A);
  def('MUNIT', 'MUNIT', 'dimensão', 'Matriz identidade.', (a, c) => { const n = Math.floor(num(a, 0, c)); if (n < 1) throw ERR.NUM; return new Matrix(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)))); }, A);
  def('SUMX2MY2', 'SOMAX2DY2', 'matriz_x; matriz_y', 'Soma das diferenças dos quadrados.', (a, c) => { const x = grid(a, 0, c).flat(), y = grid(a, 1, c).flat(); return x.reduce((s, v, i) => (typeof v === 'number' && typeof y[i] === 'number' ? s + v * v - y[i] * y[i] : s), 0); }, M);
  def('SUMX2PY2', 'SOMAX2SY2', 'matriz_x; matriz_y', 'Soma das somas dos quadrados.', (a, c) => { const x = grid(a, 0, c).flat(), y = grid(a, 1, c).flat(); return x.reduce((s, v, i) => (typeof v === 'number' && typeof y[i] === 'number' ? s + v * v + y[i] * y[i] : s), 0); }, M);
  def('SUMXMY2', 'SOMAXMY2', 'matriz_x; matriz_y', 'Soma dos quadrados das diferenças.', (a, c) => { const x = grid(a, 0, c).flat(), y = grid(a, 1, c).flat(); return x.reduce((s, v, i) => (typeof v === 'number' && typeof y[i] === 'number' ? s + (v - y[i]) ** 2 : s), 0); }, M);

  // ---------- Finanças ----------
  const pmtOf = (r, n, pv, fv, t) => { if (r === 0) return -(pv + fv) / n; const f = Math.pow(1 + r, n); return -(r * (pv * f + fv)) / ((1 + r * t) * (f - 1)); };
  const fvOf = (r, n, p, pv, t) => { if (r === 0) return -(pv + p * n); const f = Math.pow(1 + r, n); return -(pv * f + p * (1 + r * t) * (f - 1) / r); };
  const ipmtOf = (r, per, n, pv, fv, t) => {
    const p = pmtOf(r, n, pv, fv, t);
    if (per === 1 && t === 1) return 0;
    const i = fvOf(r, per - 1, p, pv, t) * r;
    return t === 1 ? i / (1 + r) : i;
  };
  def('IPMT', 'IPGTO', 'taxa; período; nper; vp; [vf]; [tipo]', 'Juros pagos num período de um empréstimo ou investimento.', (a, c) => {
    const r = num(a, 0, c), per = num(a, 1, c), n = num(a, 2, c), pv = num(a, 3, c), fv = num(a, 4, c, 0), t = num(a, 5, c, 0);
    if (per < 1 || per > n) throw ERR.NUM;
    return ipmtOf(r, per, n, pv, fv, t);
  }, FN);
  def('PPMT', 'PPGTO', 'taxa; período; nper; vp; [vf]; [tipo]', 'Amortização do principal num período.', (a, c) => {
    const r = num(a, 0, c), per = num(a, 1, c), n = num(a, 2, c), pv = num(a, 3, c), fv = num(a, 4, c, 0), t = num(a, 5, c, 0);
    if (per < 1 || per > n) throw ERR.NUM;
    return pmtOf(r, n, pv, fv, t) - ipmtOf(r, per, n, pv, fv, t);
  }, FN);
  const cum = (a, c, principal) => {
    const r = num(a, 0, c), n = num(a, 1, c), pv = num(a, 2, c), s = Math.floor(num(a, 3, c)), e = Math.floor(num(a, 4, c)), t = num(a, 5, c, 0);
    if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n) throw ERR.NUM;
    let tot = 0;
    for (let per = s; per <= e; per++) { const i = ipmtOf(r, per, n, pv, 0, t); tot += principal ? pmtOf(r, n, pv, 0, t) - i : i; }
    return tot;
  };
  def('CUMIPMT', 'PGTOJURACUM', 'taxa; nper; vp; período_inicial; período_final; tipo', 'Juros acumulados entre dois períodos.', (a, c) => cum(a, c, false), FN);
  def('CUMPRINC', 'PGTOCAPACUM', 'taxa; nper; vp; período_inicial; período_final; tipo', 'Principal amortizado entre dois períodos.', (a, c) => cum(a, c, true), FN);
  def('EFFECT', 'EFETIVA', 'taxa_nominal; períodos_por_ano', 'Taxa de juros efetiva anual.', elementwise((r, n) => { const k = Math.floor(N(n)); if (N(r) <= 0 || k < 1) throw ERR.NUM; return Math.pow(1 + N(r) / k, k) - 1; }), FN);
  def('NOMINAL', 'NOMINAL', 'taxa_efetiva; períodos_por_ano', 'Taxa de juros nominal anual.', elementwise((r, n) => { const k = Math.floor(N(n)); if (N(r) <= 0 || k < 1) throw ERR.NUM; return k * (Math.pow(1 + N(r), 1 / k) - 1); }), FN);
  def('SLN', 'DPD', 'custo; valor_residual; vida_útil', 'Depreciação linear por período.', elementwise((cst, sv, life) => { if (N(life) === 0) throw ERR.DIV0; return (N(cst) - N(sv)) / N(life); }), FN);
  def('SYD', 'SDA', 'custo; valor_residual; vida_útil; período', 'Depreciação pela soma dos dígitos dos anos.', elementwise((cst, sv, life, per) => { const L = N(life), p = N(per); if (L <= 0 || p < 1 || p > L) throw ERR.NUM; return ((N(cst) - N(sv)) * (L - p + 1) * 2) / (L * (L + 1)); }), FN);
  def('DDB', 'BDD', 'custo; valor_residual; vida_útil; período; [fator]', 'Depreciação pelo saldo decrescente duplo.', (a, c) => {
    const cst = num(a, 0, c), sv = num(a, 1, c), L = num(a, 2, c), p = num(a, 3, c), f = num(a, 4, c, 2);
    if (L <= 0 || p < 1 || p > L || f <= 0) throw ERR.NUM;
    let book = cst, dep = 0;
    for (let i = 1; i <= p; i++) { dep = Math.min(book * (f / L), Math.max(0, book - sv)); book -= dep; }
    return dep;
  }, FN);
  def('DB', 'BD', 'custo; valor_residual; vida_útil; período; [meses]', 'Depreciação pelo saldo decrescente fixo.', (a, c) => {
    const cst = num(a, 0, c), sv = num(a, 1, c), L = num(a, 2, c), p = num(a, 3, c), mo = num(a, 4, c, 12);
    if (cst < 0 || L <= 0 || p < 1 || p > L + 1 || mo < 1 || mo > 12) throw ERR.NUM;
    const rate = Math.round((1 - Math.pow(sv / cst, 1 / L)) * 1000) / 1000;
    let tot = 0, dep = cst * rate * mo / 12;
    if (p === 1) return dep;
    tot = dep;
    for (let i = 2; i <= p; i++) { dep = i === L + 1 ? (cst - tot) * rate * (12 - mo) / 12 : (cst - tot) * rate; tot += dep; }
    return dep;
  }, FN);
  const xflows = (a, c) => {
    const v = mat(a, 0, c).flat().map(N), d = mat(a, 1, c).flat().map((x) => Math.floor(dnum(x)));
    if (v.length !== d.length || v.length < 2) throw ERR.NUM;
    return { v, d };
  };
  const xnpv = (r, v, d) => v.reduce((s, x, i) => s + x / Math.pow(1 + r, (d[i] - d[0]) / 365), 0);
  def('XNPV', 'XVPL', 'taxa; fluxos; datas', 'Valor presente líquido de fluxos em datas irregulares.', (a, c) => { const r = num(a, 0, c); const { v, d } = xflows([a[1], a[2]], c); return xnpv(r, v, d); }, FN);
  def('XIRR', 'XTIR', 'fluxos; datas; [estimativa]', 'Taxa interna de retorno de fluxos em datas irregulares.', (a, c) => {
    const { v, d } = xflows(a, c);
    let r = num(a, 2, c, 0.1);
    for (let it = 0; it < 200; it++) {
      const f = xnpv(r, v, d), h = 1e-6, df = (xnpv(r + h, v, d) - f) / h;
      if (!df) break;
      const nr = r - f / df;
      if (Math.abs(nr - r) < 1e-10) return nr;
      r = nr;
      if (r <= -1) r = -0.99;
    }
    throw ERR.NUM;
  }, FN);
  def('MIRR', 'MTIR', 'fluxos; taxa_financiamento; taxa_reinvestimento', 'Taxa interna de retorno modificada.', (a, c) => {
    const v = nums([a[0]], c), fr = num(a, 1, c), rr = num(a, 2, c), n = v.length;
    let pvNeg = 0, fvPos = 0;
    v.forEach((x, i) => { if (x < 0) pvNeg += x / Math.pow(1 + fr, i); else fvPos += x * Math.pow(1 + rr, n - 1 - i); });
    if (!pvNeg || !fvPos) throw ERR.DIV0;
    return Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1;
  }, FN);
  def('ISPMT', 'ISPMT', 'taxa; período; nper; vp', 'Juros pagos num período com amortização constante.', elementwise((r, p, n, pv) => { if (N(n) === 0) throw ERR.DIV0; return N(pv) * N(r) * (N(p) / N(n) - 1); }), FN);
  def('FVSCHEDULE', 'VFPLANO', 'principal; taxas', 'Valor futuro aplicando uma série de taxas.', (a, c) => nums([a[1]], c).reduce((s, r) => s * (1 + r), num(a, 0, c)), FN);
  def('DOLLARDE', 'MOEDADEC', 'preço_fracionário; fração', 'Converte preço em fração para decimal.', elementwise((p, f) => { const k = Math.floor(N(f)); if (k < 1) throw ERR.DIV0; const x = N(p), i = Math.trunc(x), digits = Math.ceil(Math.log10(k)); return i + ((x - i) * Math.pow(10, digits)) / k; }), FN);
  def('DOLLARFR', 'MOEDAFRA', 'preço_decimal; fração', 'Converte preço decimal para fração.', elementwise((p, f) => { const k = Math.floor(N(f)); if (k < 1) throw ERR.DIV0; const x = N(p), i = Math.trunc(x), digits = Math.ceil(Math.log10(k)); return i + ((x - i) * k) / Math.pow(10, digits); }), FN);
})();
