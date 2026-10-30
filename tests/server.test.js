// Testes do servidor (contas, compartilhamento por setores e tempo real). Rode com: node tests/server.test.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FALHOU: ${name}\n  esperado: ${JSON.stringify(want)}\n  obtido:   ${JSON.stringify(got)}`); }
};
async function api(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  return Object.assign(j, { _status: r.status });
}
// Cliente WebSocket que guarda as mensagens recebidas
function connect(token, doc) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const msgs = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      msgs.push(m);
      for (const w of waiters.slice()) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    };
    const wait = (type, pred) => {
      const found = msgs.find((m) => m.type === type && (!pred || pred(m)) && !m._used);
      if (found) { found._used = true; return Promise.resolve(found); }
      return new Promise((res, rej) => {
        const w = { test: (m) => m.type === type && (!pred || pred(m)), resolve: (m) => { m._used = true; res(m); } };
        waiters.push(w);
        setTimeout(() => rej(new Error('tempo esgotado esperando ' + type)), 4000);
      });
    };
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', token, doc })); resolve({ ws, msgs, wait, send: (o) => ws.send(JSON.stringify(o)) }); };
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 50 && !log.includes('no ar'); i++) await sleep(100);
    check('servidor iniciou', (await api('GET', '/api/health')).ok, true);
    check('site é servido', (await fetch(BASE + '/')).status, 200);
    check('código do servidor não é servido', (await fetch(BASE + '/server/index.js')).status, 404);

    // contas
    const ana = await api('POST', '/api/register', { name: 'Ana', email: 'ana@empresa.com', password: 'segredo1' });
    const bia = await api('POST', '/api/register', { name: 'Bia', email: 'Bia@Empresa.com', password: 'segredo2' });
    const caio = await api('POST', '/api/register', { name: 'Caio', email: 'caio@empresa.com', password: 'segredo3' });
    check('cadastro', [!!ana.token, bia.user.email], [true, 'bia@empresa.com']);
    check('e-mail repetido', (await api('POST', '/api/register', { name: 'X', email: 'ana@empresa.com', password: '123456' }))._status, 409);
    check('senha errada', (await api('POST', '/api/login', { email: 'ana@empresa.com', password: 'errada' }))._status, 401);
    const login = await api('POST', '/api/login', { email: 'ana@empresa.com', password: 'segredo1' });
    check('login', login.user.name, 'Ana');

    // planilha com duas páginas
    const data = { title: 'Orçamento', sheets: [{ id: 'p1', name: 'Vendas', cells: { A1: { v: '10' } } }, { id: 'p2', name: 'Salários', cells: { A1: { v: '5000' } } }] };
    const doc = await api('POST', '/api/docs', { title: 'Orçamento', data }, ana.token);
    check('criar planilha', !!doc.id, true);
    check('sem acesso antes de compartilhar', (await api('GET', '/api/docs/' + doc.id, null, bia.token))._status, 403);

    // setores: Comercial edita Vendas e não vê Salários; Financeiro vê tudo
    const acl = {
      link: 'view', linkSector: 'fin',
      sectors: [{ id: 'com', name: 'Comercial', default: 'none', sheets: { p1: 'edit' }, manage: false }, { id: 'fin', name: 'Financeiro', default: 'view', sheets: {}, manage: false }],
      members: [{ email: 'bia@empresa.com', role: 'editor', sector: 'com' }],
    };
    check('salvar compartilhamento', (await api('PUT', `/api/docs/${doc.id}/share`, { acl }, ana.token)).ok, true);
    check('não-admin não gerencia', (await api('GET', `/api/docs/${doc.id}/share`, null, bia.token))._status, 403);
    const list = await api('GET', '/api/docs', null, bia.token);
    check('lista de compartilhadas', list.map((d) => [d.title, d.role]), [['Orçamento', 'editor']]);

    // tempo real
    const A = await connect(ana.token, doc.id);
    const B = await connect(bia.token, doc.id);
    const ia = await A.wait('init'), ib = await B.wait('init');
    check('admin vê as duas páginas', ia.doc.sheets.map((s) => s.name), ['Vendas', 'Salários']);
    check('Comercial não recebe Salários', ib.doc.sheets.map((s) => s.name), ['Vendas']);
    check('permissões da Bia', [ib.perms.role, ib.perms.sectorName, ib.perms.sheets], ['editor', 'Comercial', { p1: 'edit', p2: 'none' }]);
    await A.wait('join');

    B.send({ type: 'patch', id: 1, patch: { sheets: { p1: { cells: { B2: { v: '=A1*2' } } } } } });
    check('ack da Bia', (await B.wait('ack')).id, 1);
    const pa = await A.wait('patch');
    check('Ana recebe a edição da Bia', [pa.patch.sheets.p1.cells.B2.v, pa.by.name], ['=A1*2', 'Bia']);

    B.send({ type: 'patch', id: 2, patch: { sheets: { p2: { cells: { A2: { v: 'hack' } } } } } });
    check('Bia não edita página sem acesso', (await B.wait('reject')).reason, 'Você não tem acesso a esta página.');
    await B.wait('init');

    A.send({ type: 'patch', id: 3, patch: { sheets: { p2: { cells: { A2: { v: '6000' } } } } } });
    await A.wait('ack');
    await sleep(150);
    check('Bia não recebe edição de página oculta', B.msgs.filter((m) => m.type === 'patch').length, 0);

    // intervalo protegido em Vendas: só o Financeiro edita A1:A10
    A.send({ type: 'patch', id: 4, patch: { sheets: { p1: { props: { protected: [{ id: 'x', range: { r1: 1, c1: 1, r2: 10, c2: 1 }, sectors: ['fin'], desc: 'Metas' }] } } } } });
    await A.wait('ack');
    await B.wait('patch');
    B.send({ type: 'patch', id: 5, patch: { sheets: { p1: { cells: { A3: { v: '1' } } } } } });
    check('intervalo protegido', (await B.wait('reject')).reason, 'A célula A3 está protegida (Metas). Peça acesso a um administrador.');
    await B.wait('init');

    // acesso pelo link (Caio não é membro): setor Financeiro, somente leitura
    const C = await connect(caio.token, doc.id);
    const ic = await C.wait('init');
    check('link: Caio vê tudo como leitor', [ic.perms.role, ic.perms.sheets], ['viewer', { p1: 'view', p2: 'view' }]);
    C.send({ type: 'patch', id: 6, patch: { sheets: { p1: { cells: { C1: { v: 'x' } } } } } });
    check('leitor não edita', (await C.wait('reject')).reason, 'Você só pode visualizar a página "Vendas".');

    // presença
    B.send({ type: 'presence', sheetId: 'p1', sel: { r1: 2, c1: 2, r2: 2, c2: 2 } });
    const pr = await A.wait('presence');
    check('presença', [pr.peer.name, pr.peer.presence.sel.r1], ['Bia', 2]);

    // remover o acesso pelo link derruba o Caio
    await api('PUT', `/api/docs/${doc.id}/share`, { acl: Object.assign({}, acl, { link: 'none' }) }, ana.token);
    check('acesso removido', (await C.wait('error')).code, 'denied');

    // persistência: reabrir mostra os dados atualizados
    A.ws.close(); B.ws.close();
    await sleep(300);
    const A2 = await connect(ana.token, doc.id);
    const ia2 = await A2.wait('init');
    check('dados persistidos', [ia2.doc.sheets[0].cells.B2.v, ia2.doc.sheets[1].cells.A2.v], ['=A1*2', '6000']);
    A2.ws.close(); C.ws.close();

    check('não-dono não exclui', (await api('DELETE', '/api/docs/' + doc.id, null, bia.token))._status, 403);
    check('dono exclui', (await api('DELETE', '/api/docs/' + doc.id, null, ana.token)).ok, true);
  } catch (e) {
    fail++;
    console.log('ERRO:', e.message, '\n', log.slice(-2000));
  } finally {
    proc.kill();
  }
  console.log(`\n${pass} testes passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})();
