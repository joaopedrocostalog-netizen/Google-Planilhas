// Testes do motor de fórmulas. Rode com: node tests/engine.test.js
'use strict';
global.window = global;
const path = require('path');
for (const f of ['engine.js', 'functions.js', 'functions2.js']) require(path.join(__dirname, '..', 'src', f));
const E = global.GridEngine;

function book(sheets) {
  const names = Object.keys(sheets);
  return new E.Workbook({
    count: () => names.length,
    name: (i) => names[i],
    raw: (i, r, c) => sheets[names[i]][E.addrToStr(r, c)] || '',
    formulas: (i) => Object.entries(sheets[names[i]]).filter(([, v]) => String(v)[0] === '=').map(([a]) => { const p = E.parseAddr(a); return { r: p.row, c: p.col }; }),
    used: (i) => { let R = 0, C = 0; for (const a in sheets[names[i]]) { const p = E.parseAddr(a); R = Math.max(R, p.row); C = Math.max(C, p.col); } return { maxR: R, maxC: C }; },
  });
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = got && got.code ? got.code : got;
  if (JSON.stringify(g) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FALHOU: ${name}\n  esperado: ${JSON.stringify(want)}\n  obtido:   ${JSON.stringify(g)}`); }
}

const S1 = {
  A1: 'Nome', B1: 'Valor', A2: 'Ana', B2: '10', A3: 'Bia', B3: '20', A4: 'Caio', B4: '30', A5: 'Ana', B5: '5',
  D1: '=SOMA(B:B)', D2: '=SEQUENCE(3)', E2: '=SOMA(D2:D4)', F1: '=Dados!A1*2', G1: '=PROCX("Bia";A2:A5;B2:B5)',
  H1: '=SOMASE(A2:A5;"Ana";B2:B5)', H2: '=CONT.SES(A2:A5;"A*";B2:B5;">6")', H3: '=MÉDIA(B2:B5)', H4: '=ÍNDICE(B2:B5;3)',
  I1: '=TEXTO(1234,5;"#.##0,00")', I2: '=LET(x;5;y;x*2;x+y)', I3: '=ARRED(2,345;2)', I4: '=SE(B2>5;"sim";"não")',
  J1: '=1/0', J2: '=J2+1', J3: '=FOO(1)', J4: '="a"&"b"', K1: '=DATADIF(DATA(2000;1;15);DATA(2026;10;29);"Y")',
  L1: '=FILTER(A2:A5;B2:B5>=10)', M1: '=UNIQUE(A2:A5)', N1: '=SOMARPRODUTO(B2:B3;B4:B5)', O1: '=PGTO(0,01;12;-1000)',
};
const wb = book({ S1, Dados: { A1: '21' } });
const v = (a) => { const p = E.parseAddr(a); return wb.value(0, p.row, p.col); };
check('SOMA de coluna inteira', v('D1'), 65);
check('SEQUENCE transborda', [v('D2'), v('D3'), v('D4')], [1, 2, 3]);
check('soma de valores transbordados', v('E2'), 6);
check('referência a outra página', v('F1'), 42);
check('PROCX', v('G1'), 20);
check('SOMASE', v('H1'), 15);
check('CONT.SES com curinga', v('H2'), 1);
check('MÉDIA', v('H3'), 16.25);
check('ÍNDICE', v('H4'), 30);
check('TEXTO pt-BR', v('I1'), '1.234,50');
check('LET', v('I2'), 15);
check('ARRED com vírgula decimal', v('I3'), 2.35);
check('SE', v('I4'), 'sim');
check('divisão por zero', v('J1'), '#DIV/0!');
check('referência circular', v('J2'), '#REF!');
check('função desconhecida', v('J3'), '#NAME?');
check('concatenação', v('J4'), 'ab');
check('DATADIF', v('K1'), 26);
check('FILTER', [v('L1'), v('L2'), v('L3')], ['Ana', 'Bia', 'Caio']);
check('UNIQUE', [v('M1'), v('M2'), v('M3'), v('M4')], ['Ana', 'Bia', 'Caio', null]);
check('SOMARPRODUTO', v('N1'), 10 * 30 + 20 * 5);
check('PGTO', Math.round(v('O1') * 100) / 100, 88.85);

check('formato moeda', E.formatValue(1234.5, '"R$" #,##0.00'), 'R$ 1.234,50');
check('formato porcentagem', E.formatValue(0.256, '0.0%'), '25,6%');
check('formato data por extenso', E.formatValue(46324, 'dddd, d "de" mmmm "de" yyyy'), 'quinta-feira, 29 de outubro de 2026');
check('formato duração', E.formatValue(1.5, '[h]:mm:ss'), '36:00:00');

check('copiar fórmula', E.shiftFormula('=SOMA(A1:B2)+$C$1', 1, 1), '=SOMA(B2:C3)+$C$1');
check('inserir linhas', E.structuralShift('=SOMA(A1:A10)+A5', 'P', 'P', 'row', 5, 2), '=SOMA(A1:A12)+A7');
check('excluir linhas', E.structuralShift('=SOMA(A1:A10)+A5+B20', 'P', 'P', 'row', 5, -3), '=SOMA(A1:A7)+#REF!+B17');
check('renomear página', E.renameSheetRefs("=Dados!A1+'Minha Aba'!B1", 'Minha Aba', 'Nova'), '=Dados!A1+Nova!B1');

console.log(`\n${pass} testes passaram, ${fail} falharam.`);
process.exit(fail ? 1 : 0);
