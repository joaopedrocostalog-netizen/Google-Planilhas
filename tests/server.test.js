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
  // servidor de push falso (como o da Apple/Google): guarda o que chegar
  const PUSH_PORT = PORT + 1001, pushRecebidos = [];
  const pushSrv = require('http').createServer((req, res) => { const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => { pushRecebidos.push({ headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(201); res.end(); }); }).listen(PUSH_PORT);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', ADMIN_EMAILS: 'ana@empresa.com', Carga_OF_Container: `http://127.0.0.1:${CARGA_PORT}/listarCargaContainerTerminal`, DSS_USUARIO: 'dss', DSS_SENHA: 'segredo', DSS_BASE_URL: `http://127.0.0.1:${CARGA_PORT}`, PUSH_PERMITE_HTTP: '1', PUSH_JUNTAR_MS: '150', DSS_DIARIO_OFF: '1', ROTINAS_OFF: '1', ROTINAS_TESTE: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
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
    await sleep(150);
    // painel (gráficos) e teste de pico numa cópia só na memória
    check('não-admin não vê o painel', (await api('GET', `/api/docs/${d3.id}/painel`, null, bia3.token))._status, 403);
    const pnl = await api('GET', `/api/docs/${d3.id}/painel`, null, ana.token);
    check('painel: linhas com informação e sessões', [pnl.linhas[0].linhas, pnl.sessoes.map((x) => x.name).sort().join(','), pnl.sessoes.every((x) => x.fim), pnl.edHora.reduce((a, b) => a + b, 0)], [3, 'Ana,Bia,Caio', true, 1]);
    check('não-admin não faz teste de carga', (await api('POST', `/api/docs/${d3.id}/teste-carga`, { pessoas: 3 }, bia3.token))._status, 403);
    const tc = await api('POST', `/api/docs/${d3.id}/teste-carga`, { pessoas: 500, segundos: 5, ritmo: 999 }, ana.token);
    check('teste: limites aplicados', [tc.pessoas, tc.segundos, tc.ritmo, /^teste~/.test(tc.sala), tc.pagina], [60, 10, 60, true, 's1']);
    check('um teste por vez', (await api('POST', `/api/docs/${d3.id}/teste-carga`, {}, ana.token))._status, 409);
    const V1 = await connect(ana.token, tc.sala), V2 = await connect(ana.token, tc.sala);
    check('conexões entram na cópia', [(await V1.wait('init')).doc.sheets[0].cells.C3.v, !!(await V2.wait('init')).doc], ['z', true]);
    V1.send({ type: 'patch', id: 1, patch: { sheets: { s1: { cells: { A1: { v: 'teste 1.1' } } } } } });
    await V1.wait('ack');
    check('a outra conexão recebe a edição', (await V2.wait('patch')).patch.sheets.s1.cells.A1.v, 'teste 1.1');
    const st = await api('GET', `/api/docs/${d3.id}/teste-carga`, null, ana.token);
    check('status do teste', [st.ativo, st.conexoes, st.patches, typeof st.cpu, typeof st.memoriaMB], [true, 2, 1, 'number', 'number']);
    const R = await connect(ana.token, d3.id);
    check('a planilha real não mudou', (await R.wait('init')).doc.sheets[0].cells.A1.v, 'x');
    const pn2 = await api('GET', `/api/docs/${d3.id}/painel`, null, ana.token);
    const met2 = await api('GET', `/api/docs/${d3.id}/metricas`, null, ana.token);
    check('teste não entra em edições, histórico nem métricas', [pn2.edHora.reduce((a, b) => a + b, 0), met2.hoje.edicoes, met2.agora.abas], [1, 1, 1]);
    const fim = await api('DELETE', `/api/docs/${d3.id}/teste-carga`, null, ana.token);
    check('encerrar o teste', [fim.encerrado, (await V1.wait('error')).code], [true, 'teste']);
    const V3 = await connect(ana.token, tc.sala);
    check('a cópia sumiu da memória', (await V3.wait('error')).code, 'notfound');
    check('depois de encerrar, pode testar de novo', /^teste~/.test((await api('POST', `/api/docs/${d3.id}/teste-carga`, { pessoas: 2 }, ana.token)).sala), true);
    await api('DELETE', `/api/docs/${d3.id}/teste-carga`, null, ana.token);
    R.ws.close();
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
    // ---------- notificações no celular: chave VAPID, inscrição, envio cifrado de verdade ----------
    {
      const crypto = require('crypto');
      const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const unb = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const { chave } = await api('GET', '/api/push/chave', null, ana.token);
      check('chave pública VAPID (65 bytes)', unb(chave).length, 65);
      const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
      const auth = crypto.randomBytes(16);
      const sub = { endpoint: `http://127.0.0.1:${PUSH_PORT}/push/abc`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
      const ins = await api('POST', '/api/push/inscrever', { subscription: sub, prefs: { critico: true, chat: false }, appUrl: 'https://exemplo.github.io/Google-Planilhas/' }, ana.token);
      check('inscrição do aparelho', ins.ok, true);
      const est = await api('POST', '/api/push/estado', { endpoint: sub.endpoint }, ana.token);
      check('avisos obrigatórios: todos os tipos ligados', [est.inscrito, est.prefs.critico, est.prefs.chat, est.prefs.prestacking], [true, true, true, true]);
      const t = await api('POST', '/api/push/teste', {}, ana.token);
      check('teste enviado', t.enviadas, 1);
      const rec = pushRecebidos[pushRecebidos.length - 1];
      check('cabeçalhos do Web Push', [rec.headers['content-encoding'], /^vapid t=.+, k=/.test(rec.headers.authorization)], ['aes128gcm', true]);
      // assinatura do JWT VAPID confere com a chave pública
      const jwt = /t=([^,]+)/.exec(rec.headers.authorization)[1].split('.');
      const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(unb(chave).subarray(1, 33)), y: b64u(unb(chave).subarray(33)) }, format: 'jwk' });
      check('JWT VAPID assinado', crypto.verify('sha256', Buffer.from(jwt[0] + '.' + jwt[1]), { key: pubKey, dsaEncoding: 'ieee-p1363' }, unb(jwt[2])), true);
      // decifra como o celular faria (RFC 8291)
      const body = rec.body, salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), enc = body.subarray(21 + idlen);
      const shared = ua.computeSecret(asPub);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const dc = crypto.createDecipheriv('aes-128-gcm', cek, nonce); dc.setAuthTag(enc.subarray(-16));
      const plain = Buffer.concat([dc.update(enc.subarray(0, -16)), dc.final()]);
      const msg = JSON.parse(plain.subarray(0, plain.length - 1).toString());
      check('notificação decifrada no aparelho', [msg.title, /funcionando/.test(msg.body)], ['Planilhas Costalog', true]);
      const can = await api('POST', '/api/push/cancelar', { endpoint: sub.endpoint }, ana.token);
      check('desligar notificações', [can.ok, (await api('POST', '/api/push/estado', { endpoint: sub.endpoint }, ana.token)).inscrito], [true, false]);
      check('notificações exigem login', (await api('GET', '/api/push/chave'))._status, 401);
      // um exemplo de cada aviso
      await api('POST', '/api/push/inscrever', { subscription: sub, prefs: {}, appUrl: 'https://exemplo.github.io/Google-Planilhas/' }, ana.token);
      const antes = pushRecebidos.length;
      const ex = await api('POST', '/api/push/teste', { exemplos: true }, ana.token);
      check('exemplo de cada aviso', [ex.exemplos, ex.enviadas, pushRecebidos.length - antes], [7, 7, 7]);

      // ---------- rotinas: automações, alertas, demurrage, status automático, histórico ----------
      const dr = await api('POST', '/api/docs', { title: 'Rotinas', data: { sheets: [
        { id: 'vz', name: 'PRÉ STACKING VAZIO', rows: 50, cols: 12, cells: { A1: { v: 'CLIENTE' }, B1: { v: 'CONTAINER' }, C1: { v: 'DATA BAIXA' }, D1: { v: 'DEMMURAGE' }, E1: { v: 'DATA' }, F1: { v: 'STATUS' },
          A2: { v: 'ACME' }, B2: { v: 'CSQU3054383' }, C2: { v: '01/01/2020' }, D2: { v: '5' }, A3: { v: 'BETA' }, B3: { v: 'MSKU9070323' }, C3: { v: '01/01/2020' }, D3: { v: '5' }, E3: { v: '02/01/2020' } } },
        { id: 'mi', name: 'MAPA IMPO', rows: 50, cols: 12, cells: { A1: { v: 'CLIENTE' }, B1: { v: 'CONTAINER' }, C1: { v: 'STATUS' }, A2: { v: 'ACME' }, B2: { v: 'CSQU3054383' }, C2: { v: 'EM ABERTO' } } },
      ] } }, ana.token);
      const did = dr.id;
      check('automações: registrar', (await api('POST', `/api/docs/${did}/automacoes`, { itens: [{ tipo: 'PRÉ STACKING', desc: 'CSQU3054383 → PRÉ STACKING VAZIO (linha 2)' }] }, ana.token)).ok, true);
      const reg = await api('GET', `/api/docs/${did}/automacoes`, null, ana.token);
      check('automações: listar', [reg.length >= 1, reg[0].tipo, reg[0].por], [true, 'PRÉ STACKING', 'Ana']);
      // alertas: a 1ª vez só guarda (sem enxurrada); depois avisa o novo
      const a1 = await api('POST', `/api/docs/${did}/alertas/novos`, { itens: [{ k: 'mi|r1|X', sheetId: 'mi', regra: 'r1', title: 'Agendamento vencido', body: 'MAPA IMPO: X' }] }, ana.token);
      check('alertas: primeira vez só guarda', [a1.novos, a1.base], [0, true]);
      const n0 = pushRecebidos.length;
      const a2 = await api('POST', `/api/docs/${did}/alertas/novos`, { itens: [{ k: 'mi|r1|X', sheetId: 'mi', title: 'Agendamento vencido' }, { k: 'mi|r1|Y', sheetId: 'mi', regra: 'r1', title: 'Agendamento vencido', body: 'MAPA IMPO: Y' }] }, ana.token);
      await sleep(600);
      check('alertas: só o novo vira aviso', [a2.novos, pushRecebidos.length - n0], [1, 1]);
      // demurrage vencida (DATA vazia) avisa uma vez; a devolvida (com DATA) não
      const n1 = pushRecebidos.length;
      await api('POST', '/api/_rotinas', {}, ana.token); await sleep(600);
      const n2 = pushRecebidos.length;
      await api('POST', '/api/_rotinas', {}, ana.token); await sleep(600);
      check('demurrage: avisa uma vez só', [n2 - n1, pushRecebidos.length - n2], [1, 0]);
      // status automático: agenda para agora, o servidor cria a pendência e avisa; conferir marca como feito
      const br = new Date(Date.now() - 3 * 3600e3), hm = `${String(br.getUTCHours()).padStart(2, '0')}:${String(br.getUTCMinutes()).padStart(2, '0')}`;
      const cfg = await api('PUT', `/api/docs/${did}/status-auto`, { agendamentos: [{ nome: 'Status ACME', sheetId: 'mi', filtroCol: 'CLIENTE', valores: ['ACME'], horarios: [hm], dias: [0, 1, 2, 3, 4, 5, 6] }] }, ana.token);
      check('status automático salvo', [cfg.length, cfg[0].horarios[0], cfg[0].ativo], [1, hm, true]);
      const n3 = pushRecebidos.length;
      await api('POST', '/api/_rotinas', {}, ana.token); await sleep(600);
      const pend = await api('GET', `/api/docs/${did}/status-auto/pendentes`, null, ana.token);
      check('status automático: pendência e aviso', [pend.length, pend[0] && pend[0].nome, pushRecebidos.length - n3], [1, 'Status ACME', 1]);
      await api('POST', '/api/_rotinas', {}, ana.token);
      check('status automático: uma vez por horário', (await api('GET', `/api/docs/${did}/status-auto/pendentes`, null, ana.token)).length, 1);
      await api('POST', `/api/docs/${did}/status-auto/pendentes/${pend[0].id}/feito`, {}, ana.token);
      check('status automático: conferido', (await api('GET', `/api/docs/${did}/status-auto/pendentes`, null, ana.token)).length, 0);
      check('histórico do container responde', Array.isArray(await api('POST', `/api/docs/${did}/historico-container`, { container: 'CSQU 305438-3', linhas: [{ sheetId: 'mi', rows: [2] }] }, ana.token)), true);
      // mensagem de administrador: chega destacada; e ninguém desliga um tipo de aviso (chat: false é ignorado)
      const caio2 = await api('POST', '/api/login', { email: 'caio@empresa.com', password: 'segredo3' }); // a sessão antiga do Caio foi encerrada acima
      const subCaio = { endpoint: `http://127.0.0.1:${PUSH_PORT}/push/caio`, keys: sub.keys };
      await api('POST', '/api/push/inscrever', { subscription: subCaio, prefs: { chat: false }, appUrl: 'https://exemplo.github.io/Google-Planilhas/' }, caio2.token);
      const n4 = pushRecebidos.length;
      const adm = await api('POST', '/api/messages', { to: caio.user.id, text: 'Aviso da administração' }, ana.token);
      const comum = await api('POST', '/api/messages', { to: ana.user.id, text: 'Recebido' }, caio2.token);
      await new Promise((r) => setTimeout(r, 500));
      check('mensagem de administrador: destaque e aviso obrigatório', [adm.fromAdmin, comum.fromAdmin, pushRecebidos.length - n4], [true, false, 2]);
      check('conversa mostra quem é administrador', (await api('GET', `/api/messages/${ana.user.id}`, null, caio2.token)).with.admin, true);
      await api('POST', '/api/push/cancelar', { endpoint: subCaio.endpoint }, caio2.token);
      await api('POST', '/api/push/cancelar', { endpoint: sub.endpoint }, ana.token);
    }
    // histórico de alterações da planilha inteira (administradores)
    {
      const dh = await api('POST', '/api/docs', { title: 'Hist', data: { sheets: [{ id: 'h1', name: 'MAPA', rows: 200, cols: 5, cells: { A1: { v: 'CLIENTE' } } }, { id: 'h2', name: 'EXPO', rows: 50, cols: 5, cells: {} }] } }, ana.token);
      await api('PUT', `/api/docs/${dh.id}/share`, { acl: { link: 'none', sectors: [], members: [{ email: 'bia@empresa.com', role: 'editor' }] } }, ana.token);
      const biaH = await api('POST', '/api/login', { email: 'bia@empresa.com', password: 'segredo2' });
      const HA = await connect(ana.token, dh.id), HB = await connect(biaH.token, dh.id);
      await HA.wait('init'); await HB.wait('init');
      const ed = async (c, id, sh, a, v) => { c.send({ type: 'patch', id, patch: { sheets: { [sh]: { cells: { [a]: { v } } } } } }); await c.wait('ack'); };
      await ed(HA, 1, 'h1', 'A2', 'ACME 50%');
      await ed(HB, 1, 'h1', 'A3', 'BETA');
      await ed(HB, 2, 'h2', 'B2', 'EXPO 1');
      await ed(HA, 2, 'h1', 'A2', 'ACME LOG');
      for (let i = 0; i < 101; i++) await ed(HB, 10 + i, 'h1', 'C' + (2 + i), 'lote ' + i);
      const tudo = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=tudo`, null, ana.token);
      check('histórico: 100 por vez, mais novo primeiro, com pessoas', [tudo.linhas.length, tudo.mais, tudo.linhas[0].depois, tudo.pessoas.map((x) => `${x.name}:${x.n}`).join(',')], [100, true, 'lote 100', 'Ana:2,Bia:103']);
      const resto = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=tudo&antesDe=${tudo.linhas[99].id}`, null, ana.token);
      check('histórico: carregar mais continua de onde parou', [resto.linhas.length, resto.mais, resto.linhas[resto.linhas.length - 1].depois, resto.pessoas], [5, false, 'ACME 50%', undefined]);
      const ana1 = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=hoje&quem=${tudo.pessoas[0].id}`, null, ana.token);
      check('histórico: filtro por pessoa, com antes e depois', ana1.linhas.map((x) => `${x.addr}:${x.antes}→${x.depois}`), ['A2:ACME 50%→ACME LOG', 'A2:null→ACME 50%']);
      const pag = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=7d&pagina=h2`, null, ana.token);
      check('histórico: filtro por página', pag.linhas.map((x) => x.depois), ['EXPO 1']);
      const txt = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=30d&texto=${encodeURIComponent('50%')}`, null, ana.token);
      check('histórico: busca por texto (com % literal)', txt.linhas.map((x) => x.depois), ['ACME LOG', 'ACME 50%']);
      const cel = await api('GET', `/api/docs/${dh.id}/alteracoes?periodo=tudo&texto=a3`, null, ana.token);
      check('histórico: busca pela célula', cel.linhas.map((x) => x.addr), ['A3']);
      check('histórico: só administradores', (await api('GET', `/api/docs/${dh.id}/alteracoes`, null, biaH.token))._status, 403);
      HA.ws.close(); HB.ws.close();
      await api('DELETE', '/api/docs/' + dh.id, null, ana.token);
    }
    // compressão no tempo real (permessage-deflate): o navegador pede, o servidor aceita e a planilha viaja compactada
    {
      const net = require('net'), zlib = require('zlib');
      const SYNC = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
      const cells = {};
      for (let r = 1; r <= 400; r++) for (let k = 0; k < 8; k++) cells[String.fromCharCode(65 + k) + r] = { v: 'CONTAINER ' + (r * 8 + k), s: { ha: 'center' } };
      const dz = await api('POST', '/api/docs', { title: 'Compressão', data: { sheets: [{ id: 'z1', name: 'Z', rows: 500, cols: 10, cells }] } }, ana.token);
      // conexão "na unha", byte a byte, como um navegador (com ou sem pedir compressão)
      const bruto = (ext) => new Promise((res, rej) => {
        const so = net.connect(PORT, '127.0.0.1');
        let buf = Buffer.alloc(0), hdr = null;
        so.on('connect', () => so.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${ext ? 'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n' : ''}\r\n`));
        so.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          if (!hdr) {
            const i = buf.indexOf('\r\n\r\n');
            if (i < 0) return;
            hdr = buf.subarray(0, i).toString(); buf = buf.subarray(i + 4);
            // o pedido de entrada também vai compactado quando a compressão foi combinada
            let pl = Buffer.from(JSON.stringify({ type: 'hello', token: ana.token, doc: dz.id }));
            let rsv = 0;
            if (ext) { const z = zlib.deflateRawSync(pl, SYNC); pl = z.subarray(0, z.length - 4); rsv = 0x40; }
            const mask = Buffer.from([1, 2, 3, 4]), m = Buffer.from(pl);
            for (let k = 0; k < m.length; k++) m[k] ^= mask[k & 3];
            const h = m.length < 126 ? Buffer.from([0x81 | rsv, 0x80 | m.length]) : Buffer.from([0x81 | rsv, 0x80 | 126, m.length >> 8, m.length & 255]);
            so.write(Buffer.concat([h, mask, m]));
          }
          for (;;) {
            if (buf.length < 2) return;
            let len = buf[1] & 127, off = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
            if (buf.length < off + len) return;
            const rsv1 = (buf[0] & 0x40) !== 0;
            let pl = buf.subarray(off, off + len);
            buf = buf.subarray(off + len);
            const wire = pl.length;
            if (rsv1) pl = zlib.inflateRawSync(Buffer.concat([pl, Buffer.from([0, 0, 255, 255])]), SYNC);
            const msg = JSON.parse(pl.toString());
            if (msg.type === 'init') { so.destroy(); return res({ hdr, rsv1, wire, msg }); }
          }
        });
        so.on('error', rej);
        setTimeout(() => rej(new Error('sem resposta do tempo real')), 5000);
      });
      const comZ = await bruto(true), semZ = await bruto(false);
      check('compressão combinada só quando o navegador pede', [/permessage-deflate/.test(comZ.hdr), comZ.rsv1, /permessage-deflate/.test(semZ.hdr), semZ.rsv1], [true, true, false, false]);
      check('a planilha chega igual com e sem compressão', [comZ.msg.doc.sheets[0].cells.H400.v, JSON.stringify(comZ.msg.doc) === JSON.stringify(semZ.msg.doc), comZ.msg.me.email], ['CONTAINER 3207', true, 'ana@empresa.com']);
      check('a planilha viaja pelo menos 5 vezes menor', comZ.wire * 5 < semZ.wire, true);
      console.log(`  (compressão no tempo real: ${semZ.wire} bytes → ${comZ.wire} bytes)`);
      await api('DELETE', '/api/docs/' + dz.id, null, ana.token);
    }
  } catch (e) {
    fail++;
    console.log('ERRO:', e.message, '\n', log.slice(-2000));
  } finally {
    proc.kill();
    cargaSrv.close();
    pushSrv.close();
  }
  {
    // SSL do banco: interno sem SSL (Render, Railway), externo com SSL
    const { usaSsl } = require('../server/store.js');
    check('banco interno da Render dispensa SSL', usaSsl('postgres://u:p@dpg-abc123-a/banco'), false);
    check('banco interno do Railway dispensa SSL', usaSsl('postgresql://postgres:x@postgres.railway.internal:5432/railway'), false);
    check('banco externo da Render exige SSL', usaSsl('postgres://u:p@dpg-abc123-a.virginia-postgres.render.com/banco'), true);
    check('banco público do Railway exige SSL', usaSsl('postgresql://postgres:x@shuttle.proxy.rlwy.net:41234/railway'), true);
    check('sslmode=disable desliga o SSL', usaSsl('postgresql://u:p@db.exemplo.com/b?sslmode=disable'), false);
    check('localhost dispensa SSL', usaSsl('postgres://u:p@localhost:5432/b'), false);
  }
  console.log(`\n${pass} testes passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})();
