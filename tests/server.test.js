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
  // API carga_of_container falsa, como a do DSS: exige dataInicio (aaaa-mm-dd) e dataFim, ignora o filtro do container
  // e devolve tudo (o servidor precisa descobrir os parâmetros e achar o container na lista)
  const CARGA_PORT = PORT + 1000;
  const cargaReqs = [];
  const cargaSrv = require('http').createServer((req, res) => {
    cargaReqs.push(req.url);
    const u = new URL(req.url, 'http://x');
    const erro = (m) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ apiVersion: '1', status: 400, mensagemErro: m, qtd_registros: 0, registros: [] })); };
    if (req.headers.authorization !== 'Basic ' + Buffer.from('dss:segredo').toString('base64')) return erro('Usuário inválido.');
    const di = u.searchParams.get('dataInicio'), df = u.searchParams.get('dataFim');
    if (!di) return erro('Data de Início não informada.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(di)) return erro('Data de Início inválida.');
    if (!df) return erro('Data de Fim não informada.');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ apiVersion: '1', status: 200, mensagemErro: '', qtd_registros: 3, registros: [
      { nro_container: 'TRHU 861.819-1', data_hora_entrada: '2026-11-03 22:40:00' },
      { nro_container: 'TRHU 861.819-1', data_hora_entrada: '2026-11-05 01:11:17' },
      { nro_container: 'MSCU 123.456-7', data_hora_entrada: '2026-10-30 08:00:00' },
    ] }));
  }).listen(CARGA_PORT);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', ADMIN_EMAILS: 'ana@empresa.com', Carga_OF_Container: `http://127.0.0.1:${CARGA_PORT}/listarCargaContainerTerminal`, DSS_USUARIO: 'dss', DSS_SENHA: 'segredo', DSS_BASE_URL: `http://127.0.0.1:${CARGA_PORT}` }), stdio: ['ignore', 'pipe', 'pipe'] });
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
    check('só administradores criam planilhas na nuvem', (await api('POST', '/api/docs', { title: 'X' }, bia.token))._status, 403);
    check('perfil indica administrador', [(await api('GET', '/api/me', null, ana.token)).admin, (await api('GET', '/api/me', null, bia.token)).admin], [true, false]);
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

    // permissões por coluna: Comercial não vê a coluna B e só visualiza a coluna C de Vendas
    A.send({ type: 'patch', id: 40, patch: { sheets: { p1: { props: { access: { com: { 2: 'none', 3: 'view' } } } } } } });
    await A.wait('ack');
    const ib2 = await B.wait('init');
    check('coluna oculta chega mascarada', [ib2.doc.sheets[0].cells.B2, ib2.perms.cols.p1], [{ _h: 1 }, { 2: 'none', 3: 'view' }]);
    B.send({ type: 'patch', id: 41, patch: { sheets: { p1: { cells: { C1: { v: 'x' } } } } } });
    check('coluna somente leitura', (await B.wait('reject')).reason, 'Você só pode visualizar a coluna C da página "Vendas".');
    await B.wait('init');
    B.send({ type: 'patch', id: 42, patch: { sheets: { p1: { cells: { B5: {} } } } } });
    check('coluna oculta não pode ser alterada', /ocultas para você/.test((await B.wait('reject')).reason), true);
    await B.wait('init');
    B.send({ type: 'patch', id: 43, patch: { sheets: { p1: { props: { cols: 30 } } } } });
    check('não-admin não insere colunas', (await B.wait('reject')).reason, 'Somente administradores podem renomear, inserir, excluir, ocultar ou redimensionar colunas.');
    await B.wait('init');
    B.send({ type: 'patch', id: 47, patch: { sheets: { p1: { props: { colW: { 1: 200 } } } } } });
    check('não-admin não redimensiona colunas', /Somente administradores/.test((await B.wait('reject')).reason), true);
    await B.wait('init');
    B.send({ type: 'patch', id: 48, patch: { sheets: { p1: { props: { hiddenCols: { 4: true } } } } } });
    check('não-admin não oculta colunas', /Somente administradores/.test((await B.wait('reject')).reason), true);
    await B.wait('init');
    B.send({ type: 'patch', id: 49, patch: { sheets: { p1: { props: { colNames: { 1: 'X' } } } } } });
    check('não-admin não renomeia colunas', (await B.wait('reject')).reason, 'Somente administradores podem renomear colunas.');
    await B.wait('init');
    A.send({ type: 'patch', id: 50, patch: { sheets: { p1: { props: { colNames: { 1: 'CLIENTE', 2: 'SALÁRIO' } } } } } });
    await A.wait('ack');
    const pn = await B.wait('patch', (m) => m.patch.sheets.p1 && m.patch.sheets.p1.props && m.patch.sheets.p1.props.colNames);
    check('nome de coluna oculta não vaza', pn.patch.sheets.p1.props.colNames, { 1: 'CLIENTE' });
    B.send({ type: 'patch', id: 51, patch: { sheets: { p1: { cells: { D2: { v: '5', s: { al: 'c' } } } } } } });
    check('executor não alinha nem põe bordas', /Somente administradores podem usar essa formatação/.test((await B.wait('reject')).reason), true);
    await B.wait('init');
    B.send({ type: 'patch', id: 54, patch: { sheets: { p1: { cells: { D2: { v: '5', note: 'oi' } } } } } });
    check('executor não cria notas', /Somente administradores podem usar essa formatação/.test((await B.wait('reject')).reason), true);
    await B.wait('init');
    B.send({ type: 'patch', id: 55, patch: { sheets: { p1: { cells: { D2: { v: '5', s: { b: true, bg: '#fde8ea', nf: '0.00', fs: 12 } } } } } } });
    check('executor usa a formatação da barra liberada', (await B.wait('ack')).id, 55);
    B.send({ type: 'patch', id: 52, patch: { sheets: { p1: { props: { freeze: { rows: 1, cols: 0 } } } } } });
    check('executor não congela', (await B.wait('reject')).reason, 'Somente administradores podem congelar linhas e colunas.');
    await B.wait('init');
    B.send({ type: 'patch', id: 53, patch: { sheets: { p1: { props: { rowH: { 2: 40 } } } } } });
    check('executor não muda altura de linha', (await B.wait('reject')).reason, 'Somente administradores podem alterar o tamanho das linhas.');
    await B.wait('init');
    B.send({ type: 'patch', id: 44, patch: { sheets: { p1: { cells: { D1: { v: 'Meta' } } } } } });
    check('coluna liberada pode ser editada', (await B.wait('ack')).id, 44);
    A.send({ type: 'patch', id: 45, patch: { sheets: { p1: { cells: { B3: { v: '999' }, E1: { v: 'ok' } } } } } });
    await A.wait('ack');
    const pb = await B.wait('patch', (m) => m.patch.sheets.p1 && m.patch.sheets.p1.cells && m.patch.sheets.p1.cells.E1);
    check('edição em coluna oculta chega mascarada', [pb.patch.sheets.p1.cells.B3, pb.patch.sheets.p1.cells.E1.v], [{ _h: 1 }, 'ok']);
    // regra da pessoa tem prioridade sobre a do setor
    const sh2 = await api('GET', `/api/docs/${doc.id}/share`, null, ana.token);
    const rid = sh2.acl.members[0].rid;
    check('pessoa recebe id para regras', /^m/.test(rid), true);
    A.send({ type: 'patch', id: 46, patch: { sheets: { p1: { props: { access: { com: { 2: 'none', 3: 'view' }, [rid]: { 2: 'view' } } } } } } });
    await A.wait('ack');
    const ib3 = await B.wait('init');
    check('regra da pessoa libera a coluna B', [ib3.doc.sheets[0].cells.B3.v, ib3.perms.cols.p1[2]], ['999', 'view']);

    // histórico de edições por célula
    const h1 = await api('GET', `/api/docs/${doc.id}/history?sheet=p1&addr=D1`, null, ana.token);
    check('histórico da célula', h1.map((h) => [h.name, h.before, h.after]), [['Bia', null, 'Meta']]);
    const h2 = await api('GET', `/api/docs/${doc.id}/history?sheet=p1&addr=B3`, null, ana.token);
    check('histórico com valor anterior', h2.map((h) => [h.name, h.after]), [['Ana', '999']]);
    check('histórico respeita página oculta', (await api('GET', `/api/docs/${doc.id}/history?sheet=p2&addr=A1`, null, bia.token))._status, 403);

    // acesso pelo link (Caio não é membro): setor Financeiro, somente leitura
    const C = await connect(caio.token, doc.id);
    const ic = await C.wait('init');
    check('link: Caio vê tudo como leitor', [ic.perms.role, ic.perms.sheets], ['viewer', { p1: 'view', p2: 'view' }]);
    C.send({ type: 'patch', id: 6, patch: { sheets: { p1: { cells: { C1: { v: 'x' } } } } } });
    check('leitor não edita', (await C.wait('reject')).reason, 'Você só pode visualizar a página "Vendas".');

    // presença: administradores veem todos; setores diferentes não se veem
    B.send({ type: 'presence', sheetId: 'p1', sel: { r1: 2, c1: 2, r2: 2, c2: 2 } });
    const pr = await A.wait('presence');
    check('presença', [pr.peer.name, pr.peer.presence.sel.r1], ['Bia', 2]);
    C.send({ type: 'presence', sheetId: 'p1', sel: { r1: 3, c1: 1, r2: 3, c2: 1 } });
    await A.wait('presence', (m) => m.peer.name === 'Caio');
    await sleep(150);
    check('setores diferentes não se veem', [B.msgs.some((m) => (m.type === 'presence' || m.type === 'join') && m.peer.name === 'Caio'), ic.peers.some((p) => p.name === 'Bia')], [false, false]);

    // cores: cada pessoa tem uma cor diferente
    const extra = [];
    for (let i = 0; i < 14; i++) extra.push((await api('POST', '/api/register', { name: 'P' + i, email: `p${i}@empresa.com`, password: 'segredo1' })).user.color);
    const allColors = [ana.user.color, bia.user.color, caio.user.color, ...extra];
    check('cores diferentes para todos', new Set(allColors).size, allColors.length);
    check('cor de outra pessoa não pode', (await api('PUT', '/api/me/color', { color: bia.user.color }, ana.token))._status, 409);
    const free = (await api('GET', '/api/me/color', null, bia.token));
    const pick = free.palette.concat(['#123456']).find((c) => !free.taken.includes(c) && c !== free.color);
    check('trocar a própria cor', (await api('PUT', '/api/me/color', { color: pick }, bia.token)).color, pick);
    check('nova cor aparece para quem está na planilha', (await A.wait('presence', (m) => m.peer.name === 'Bia' && m.peer.color === pick)).peer.color, pick);

    // mensagens diretas
    const cBia = await api('GET', `/api/docs/${doc.id}/contacts`, null, bia.token);
    const cAna = await api('GET', `/api/docs/${doc.id}/contacts`, null, ana.token);
    check('contatos do setor: administradores e o próprio setor', cBia.map((c) => c.name), ['Ana']);
    check('administrador fala com todos', cAna.map((c) => c.name).sort(), ['Bia', 'Caio']);
    check('outro setor não recebe', (await api('POST', '/api/messages', { to: caio.user.id, text: 'oi', doc: doc.id }, bia.token))._status, 403);
    const m1 = await api('POST', '/api/messages', { to: ana.user.id, text: 'Pode ver a linha 5?', doc: doc.id, ref: { sheet: 'p1', addr: 'B5', label: 'Página1!B5' } }, bia.token);
    check('mensagem enviada', [m1.text, m1.ref.addr, m1.fromUser.name], ['Pode ver a linha 5?', 'B5', 'Bia']);
    const dm = await A.wait('dm');
    check('mensagem chega na hora', [dm.msg.text, dm.msg.from], ['Pode ver a linha 5?', bia.user.id]);
    let inbox = await api('GET', '/api/messages', null, ana.token);
    check('não lida', [inbox.unread, inbox.conversations[0].with.name], [1, 'Bia']);
    await api('POST', `/api/messages/${bia.user.id}/read`, null, ana.token);
    inbox = await api('GET', '/api/messages', null, ana.token);
    check('marcada como lida', inbox.unread, 0);
    await api('POST', '/api/messages', { to: caio.user.id, text: 'Oi Caio', doc: doc.id }, ana.token);
    check('responder sem estar na mesma planilha', (await api('POST', '/api/messages', { to: ana.user.id, text: 'Oi Ana' }, caio.token)).text, 'Oi Ana');
    const conv = await api('GET', `/api/messages/${caio.user.id}`, null, ana.token);
    check('conversa', conv.messages.map((m) => m.text), ['Oi Caio', 'Oi Ana']);
    check('estranho não envia', (await api('POST', '/api/messages', { to: bia.user.id, text: 'x' }, caio.token))._status, 403);

    // DSS: apagar o nome do motorista apaga o CPF/CNPJ; apagar o CPF não mexe no nome
    A.send({ type: 'patch', id: 80, patch: { sheets: { p1: { props: { lookup: { col: 7, cpfCol: 8 } }, cells: { G20: { v: 'JOAO DA SILVA' }, H20: { v: '111.222.333-44', s: { b: true } }, G21: { v: 'MARIA' }, H21: { v: '999' } } } } } });
    await A.wait('ack', (m) => m.id === 80);
    A.send({ type: 'patch', id: 81, patch: { sheets: { p1: { cells: { G20: null } } } } });
    const dssClear = await A.wait('patch', (m) => m.by && m.by.name === 'DSS');
    check('apagar o nome apaga o CPF (mantém a formatação)', dssClear.patch.sheets.p1.cells.H20, { s: { b: true }, v: '' });
    A.send({ type: 'patch', id: 82, patch: { sheets: { p1: { cells: { H21: null } } } } });
    await A.wait('ack', (m) => m.id === 82);
    await sleep(150);
    check('apagar o CPF não apaga o nome', A.msgs.some((m) => m.type === 'patch' && m.by && m.by.name === 'DSS' && m.patch.sheets.p1.cells.G21 !== undefined), false);

    // escala de veículos: escalar/confirmar (setor da escala), bloquear (setor do bloqueio), veículo bloqueado não troca
    A.send({ type: 'patch', id: 90, patch: { sheets: { p1: { props: { colNames: { 1: 'CLIENTE', 2: 'SALÁRIO', 10: 'CAVALO', 11: 'CARRETA', 12: 'MOTORISTA' }, escala: { sectors: ['com'], lockSectors: ['fin'] } } } } } });
    await A.wait('ack', (m) => m.id === 90);
    await B.wait('patch', (m) => m.patch.sheets && m.patch.sheets.p1 && m.patch.sheets.p1.props && m.patch.sheets.p1.props.escala);
    const res = async (id, cells) => { B.send({ type: 'patch', id, patch: { sheets: { p1: { cells } } } }); const r = await Promise.race([B.wait('ack', (m) => m.id === id).then(() => 'ok'), B.wait('reject', (m) => m.id === id).then((m) => m.reason)]); return r; };
    check('setor da escala escala (não confirmada)', await res(91, { J30: { v: 'CAV0001', esc: 'p' }, K30: { v: 'CAR0001' }, L30: { v: 'JOAO' } }), 'ok');
    check('setor da escala confirma', await res(92, { J30: { v: 'CAV0001', esc: 'ok' } }), 'ok');
    check('setor da escala não bloqueia', /bloquear ou destravar/.test(await res(93, { J30: { v: 'CAV0001', esc: 'ok', lock: true } })), true);
    A.send({ type: 'patch', id: 94, patch: { sheets: { p1: { cells: { J30: { v: 'CAV0001', esc: 'ok', lock: true } } } } } });
    await A.wait('ack', (m) => m.id === 94);
    await B.wait('patch', (m) => m.patch.sheets && m.patch.sheets.p1 && m.patch.sheets.p1.cells && m.patch.sheets.p1.cells.J30 && m.patch.sheets.p1.cells.J30.lock);
    check('veículo bloqueado não troca o motorista', /bloqueado para troca/.test(await res(95, { L30: { v: 'PEDRO' } })), true);
    check('CPF/contato continuam livres', await res(96, { M30: { v: '123' } }), 'ok');
    check('qualquer um pede troca', await res(97, { J30: { v: 'CAV0001', esc: 'ok', lock: true, swap: true } }), 'ok');
    check('só o setor do bloqueio encerra o pedido', /encerrar o pedido/.test(await res(98, { J30: { v: 'CAV0001', esc: 'ok', lock: true } })), true);

    // aba de consulta sem acesso (BASE GERAL): vai só com os valores, escondida e sem edição
    A.send({ type: 'patch', id: 99, patch: { sheets: { bg: { created: { id: 'bg', name: 'BASE GERAL', rows: 10, cols: 5, cells: { A1: { v: 'ENU2J12', s: { b: true }, note: 'segredo' } } } } } } });
    await A.wait('ack', (m) => m.id === 99);
    const bg1 = await B.wait('patch', (m) => m.patch.sheets && m.patch.sheets.bg);
    check('base chega só com valores e escondida', [bg1.patch.sheets.bg.created.shadow, bg1.patch.sheets.bg.created.hidden, JSON.stringify(bg1.patch.sheets.bg.created.cells)], [true, true, '{"A1":{"v":"ENU2J12"}}']);
    A.send({ type: 'patch', id: 100, patch: { sheets: { bg: { cells: { A2: { v: 'ABC1D23', s: { bg: '#ff0000' } } } } } } });
    const bg2 = await B.wait('patch', (m) => m.patch.sheets && m.patch.sheets.bg && m.patch.sheets.bg.cells);
    check('atualização da base também só com valores', JSON.stringify(bg2.patch.sheets.bg.cells), '{"A2":{"v":"ABC1D23"}}');
    B.send({ type: 'patch', id: 102, patch: { sheets: { bg: { cells: { A3: { v: 'x' } } } } } });
    check('setor não edita a base (rejeitado)', /acesso/.test((await B.wait('reject', (m) => m.id === 102)).reason), true);

    // container crítico: o administrador escolhe os setores
    check('sem escolha, setor marca crítico', await res(110, { T40: { v: 'C1', crit: true } }), 'ok');
    A.send({ type: 'patch', id: 111, patch: { sheets: { p1: { props: { critSectors: ['fin'] } } } } });
    await A.wait('ack', (m) => m.id === 111);
    await B.wait('patch', (m) => m.patch.sheets && m.patch.sheets.p1 && m.patch.sheets.p1.props && m.patch.sheets.p1.props.critSectors);
    check('setor fora da lista não marca', /crítico não está liberado/.test(await res(112, { T41: { v: 'C2', crit: true } })), true);
    check('setor fora da lista não desmarca', /crítico não está liberado/.test(await res(113, { T40: { v: 'C1' } })), true);
    check('mas continua editando o valor', await res(114, { T42: { v: 'C3' } }), 'ok');

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

    // sessões: o administrador desloga uma pessoa (ou todos) e ela cai na hora
    const d2 = await api('POST', '/api/docs', { title: 'Sessões', data: { sheets: [{ id: 's1', name: 'P', rows: 10, cols: 5, cells: {} }] } }, ana.token);
    await api('PUT', `/api/docs/${d2.id}/share`, { acl: { link: 'none', sectors: [], members: [{ email: 'bia@empresa.com', role: 'editor' }, { email: 'caio@empresa.com', role: 'editor' }] } }, ana.token);
    const biaLogin = await api('POST', '/api/login', { email: 'bia@empresa.com', password: 'segredo2' });
    const B2 = await connect(biaLogin.token, d2.id);
    await B2.wait('init');
    check('quem não é admin não vê as sessões', (await api('GET', `/api/docs/${d2.id}/sessions`, null, biaLogin.token))._status, 403);
    const ses = await api('GET', `/api/docs/${d2.id}/sessions`, null, ana.token);
    check('lista as pessoas da planilha', ses.map((x) => x.email).sort(), ['ana@empresa.com', 'bia@empresa.com', 'caio@empresa.com']);
    check('mostra quem está na planilha', ses.find((x) => x.email === 'bia@empresa.com').online, 1);
    const biaId = ses.find((x) => x.email === 'bia@empresa.com').id;
    const lo = await api('POST', `/api/docs/${d2.id}/logout`, { users: [biaId] }, ana.token);
    check('deslogou a Bia', lo.deslogados, ['Bia']);
    const ev = await B2.wait('error');
    check('Bia cai na hora', [ev.code, /encerrada pelo administrador/.test(ev.message)], ['auth', true]);
    check('token da Bia não vale mais', (await api('GET', '/api/me', null, biaLogin.token))._status, 401);
    const caioLogin = await api('POST', '/api/login', { email: 'caio@empresa.com', password: 'segredo3' });
    const todos = await api('POST', `/api/docs/${d2.id}/logout`, { all: true }, ana.token);
    check('deslogar todos não inclui quem pediu', [todos.deslogados.includes('Ana'), todos.deslogados.includes('Caio')], [false, true]);
    check('Ana continua logada', (await api('GET', '/api/me', null, ana.token))._status, 200);
    check('Caio deslogado', (await api('GET', '/api/me', null, caioLogin.token))._status, 401);
    await api('DELETE', '/api/docs/' + d2.id, null, ana.token);
    // limite de usuários e métricas da planilha (Administrador)
    const d3 = await api('POST', '/api/docs', { title: 'Limite', data: { sheets: [{ id: 's1', name: 'P', rows: 10, cols: 5, cells: { A1: { v: 'x' }, B2: { v: 'y' } } }] } }, ana.token);
    await api('PUT', `/api/docs/${d3.id}/share`, { acl: { link: 'none', sectors: [], members: [{ email: 'bia@empresa.com', role: 'editor' }, { email: 'caio@empresa.com', role: 'editor' }] } }, ana.token);
    const bia3 = await api('POST', '/api/login', { email: 'bia@empresa.com', password: 'segredo2' });
    const caio3 = await api('POST', '/api/login', { email: 'caio@empresa.com', password: 'segredo3' });
    check('não-admin não muda o limite', (await api('PUT', `/api/docs/${d3.id}/limite`, { max: 1 }, bia3.token))._status, 403);
    check('limite inválido é recusado', (await api('PUT', `/api/docs/${d3.id}/limite`, { max: -2 }, ana.token))._status, 400);
    check('admin define o limite', (await api('PUT', `/api/docs/${d3.id}/limite`, { max: 1 }, ana.token)).max, 1);
    const L1 = await connect(bia3.token, d3.id);
    check('primeira pessoa entra', !!(await L1.wait('init')).doc, true);
    const L1b = await connect(bia3.token, d3.id);
    check('a mesma pessoa abre outra aba sem ocupar vaga', !!(await L1b.wait('init')).doc, true);
    const L2 = await connect(caio3.token, d3.id);
    const ev2 = await L2.wait('error');
    check('limite cheio: a próxima pessoa espera vaga', [ev2.code, /limite de 1 pessoa conectada/.test(ev2.message)], ['limit', true]);
    const LA = await connect(ana.token, d3.id);
    check('administrador entra mesmo com o limite cheio', !!(await LA.wait('init')).doc, true);
    LA.send({ type: 'patch', id: 1, patch: { sheets: { s1: { cells: { C3: { v: 'z' } } } } } });
    await LA.wait('ack');
    const met = await api('GET', `/api/docs/${d3.id}/metricas`, null, ana.token);
    check('métricas: conectados agora e vagas', [met.agora.pessoas, met.agora.abas, met.agora.naoAdmins, met.limite.max, met.limite.vagas], [2, 3, 1, 1, 0]);
    check('métricas: a Bia aparece com 2 abas', met.agora.lista.find((x) => x.email === 'bia@empresa.com').abas, 2);
    check('métricas: pico e espera do dia', [met.hoje.pico, met.hoje.acessos, met.hoje.bloqueados, met.hoje.ultimosBloqueados[0].name], [2, 2, 1, 'Caio']);
    check('métricas: células e pessoas com acesso', [met.planilha.paginas[0].celulas, met.planilha.celulas, met.planilha.membros], [3, 3, 3]);
    check('métricas: edições de hoje', [met.hoje.edicoes, met.hoje.top[0].name, met.semana.edicoes], [1, 'Ana', 1]);
    check('não-admin não vê as métricas', (await api('GET', `/api/docs/${d3.id}/metricas`, null, bia3.token))._status, 403);
    L1.ws.close(); L1b.ws.close();
    await sleep(200);
    const L3 = await connect(caio3.token, d3.id);
    check('vaga liberada: o Caio entra', !!(await L3.wait('init')).doc, true);
    check('limite volta para "sem limite"', (await api('PUT', `/api/docs/${d3.id}/limite`, { max: 0 }, ana.token)).max, 0);
    L3.ws.close(); LA.ws.close();
    await api('DELETE', '/api/docs/' + d3.id, null, ana.token);
    // DATA BAIXA (carga_of_container): container sem espaço, ponto e traço; data mais recente em dd/mm/aaaa
    const db = await api('GET', '/api/carga/data-baixa?container=' + encodeURIComponent('trhu8618191'), null, ana.token);
    check('DATA BAIXA vem da API em dd/mm/aaaa', [db.achou, db.data, db.container], [true, '05/11/2026', 'TRHU8618191']);
    const comPeriodo = cargaReqs.find((x) => /nro_container=TRHU8618191/.test(x)) || '';
    check('descobriu o período e pergunta pelo container', /^\/listarCargaContainerTerminal\?dataInicio=\d{4}-\d{2}-\d{2}&dataFim=\d{4}-\d{2}-\d{2}&nro_container=TRHU8618191$/.test(comPeriodo), true);
    const cons = await api('GET', '/api/carga/consulta?container=' + encodeURIComponent('TRHU 861.819-1'), null, ana.token);
    check('consulta mostra os registros do container', [cons.total, cons.registros[0].nro_container], [2, 'TRHU 861.819-1']);
    const rec = await api('GET', '/api/carga/consulta', null, ana.token);
    check('últimas entradas, mais nova primeiro', rec.registros.map((x) => x.data_hora_entrada), ['2026-11-05 01:11:17', '2026-11-03 22:40:00', '2026-10-30 08:00:00']);
    const dg = await api('GET', '/api/carga/diag', null, ana.token);
    check('diagnóstico', [dg.http, dg.registros, dg.campoContainer, dg.campoData, dg.variavel, /dataInicio e dataFim \(iso\)/.test(dg.periodo)], [200, 3, 'nro_container', 'data_hora_entrada', 'Carga_OF_Container', true]);
    const nd = await api('GET', '/api/carga/data-baixa?container=ABCD0000000', null, ana.token);
    check('container fora da API', nd.achou, false);
    const lote = await api('POST', '/api/carga/datas-baixa', { containers: ['TRHU 861.819-1', 'MSCU1234567', 'ABCD0000000'] }, ana.token);
    check('várias DATA BAIXA de uma vez', lote.resultados, { TRHU8618191: '05/11/2026', MSCU1234567: '30/10/2026', ABCD0000000: null });
    check('DATA BAIXA exige login', (await api('GET', '/api/carga/data-baixa?container=TRHU8618191'))._status, 401);
  } catch (e) {
    fail++;
    console.log('ERRO:', e.message, '\n', log.slice(-2000));
  } finally {
    proc.kill();
    cargaSrv.close();
  }
  console.log(`\n${pass} testes passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})();
