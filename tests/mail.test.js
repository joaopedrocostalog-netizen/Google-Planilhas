// Testes do cliente de e-mail (IMAP e SMTP) contra servidores falsos. Rode com: node tests/mail.test.js
'use strict';
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// certificado só para os servidores falsos destes testes: gerado na hora numa pasta temporária
const os = require('os');
const { execFileSync } = require('child_process');
const CERT = fs.mkdtempSync(path.join(os.tmpdir(), 'planilhas-mail-'));
const KEY = path.join(CERT, 'k.pem'), CRT = path.join(CERT, 'c.pem');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CRT, '-days', '1', '-nodes', '-subj', '/CN=localhost'], { stdio: 'ignore' });
} catch (e) {
  console.log('Testes de e-mail pulados: o openssl não está disponível para gerar o certificado de teste.');
  process.exit(0);
}
process.on('exit', () => { try { fs.rmSync(CERT, { recursive: true, force: true }); } catch (e) { /* já foi */ } });
const opts = { key: fs.readFileSync(KEY), cert: fs.readFileSync(CRT) };

let pass = 0, fail = 0;
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FALHOU: ${name}\n  esperado: ${JSON.stringify(want)}\n  obtido:   ${JSON.stringify(got)}`); }
}
const listen = (srv, port) => new Promise((r) => srv.listen(port, '127.0.0.1', r));

// ---------- IMAP falso ----------
const imapLog = [];
const CORPO = [
  'Message-ID: <abc123@cliente.com>',
  'References: <ref1@x> <ref2@x>',
  'Subject: =?UTF-8?B?U1RBVFVTIC0gUkVGRVLDik5DSUE6IEhXIDE4MS8yNQ==?=',
  'From: "Riquelme Moura" <riquelme@costalog.com.br>',
  'To: status@costalog.com.br',
  'Cc: "Importação" <importacao@costalog.com.br>, gerencia@costalog.com.br',
  'Date: Wed, 04 Nov 2026 16:15:00 -0300',
  '',
].join('\r\n');

// corpo completo (para citar na resposta): HTML em iso-8859-1, quoted-printable, com script e imagem embutida
const HTML_QP = '<html><head><style>p.x{color:red}</style></head><body><p class=3D"x">Boa tarde, segue a programa=E7=E3o.</p><img src=3D"cid:logo@x"><script>alert(1)</script><p onclick=3D"x()">Importa=E7=E3o</p></body></html>';
const COMPLETO = CORPO.replace(/\r\n$/, '') + [
  '', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="mix"', '', '--mix', 'Content-Type: multipart/alternative; boundary="alt"', '',
  '--alt', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', 'Boa tarde, segue a programa=E7=E3o.', '',
  '--alt', 'Content-Type: text/html; charset="iso-8859-1"', 'Content-Transfer-Encoding: quoted-printable', '', HTML_QP, '', '--alt--', '',
  '--mix', 'Content-Type: application/pdf; name="a.pdf"', 'Content-Disposition: attachment; filename="a.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERg==', '', '--mix--', '',
].join('\r\n').replace(/^\r\n/, '\r\n');
// resposta nossa, na pasta de enviados (mais nova que a da caixa de entrada)
const NOSSA = [
  'Message-ID: <nossa1@costalog.com.br>', 'References: <ref1@x> <ref2@x> <abc123@cliente.com>', 'Subject: Re: STATUS - REFERENCIA: HW 181/25',
  'From: "Costalog - Status" <status@costalog.com.br>', 'To: "Riquelme Moura" <riquelme@costalog.com.br>', 'Cc: gerencia@costalog.com.br, status@costalog.com.br', 'Date: Thu, 05 Nov 2026 08:14:00 -0300', '',
].join('\r\n');
const fakeImap = { sentUids: '' };
const appendInfo = {};
const imap = tls.createServer(opts, (s) => {
  s.write('* OK IMAP falso pronto\r\n');
  let buf = '', appendBytes = 0, appendTag = '', box = '';
  s.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      if (appendBytes) {
        if (Buffer.byteLength(buf) < appendBytes) return;
        appendInfo.raw = buf.slice(0, appendBytes);
        buf = buf.slice(appendBytes).replace(/^\r\n/, '');
        appendBytes = 0;
        s.write(`${appendTag} OK guardado\r\n`);
        continue;
      }
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      imapLog.push(line);
      const [tag, cmd] = [line.split(' ')[0], line.slice(line.indexOf(' ') + 1)];
      if (/^LOGIN/i.test(cmd)) s.write(`${tag} OK logado\r\n`);
      else if (/^SELECT/i.test(cmd)) { box = /SELECT "([^"]+)"/.exec(cmd)[1]; s.write(`* 42 EXISTS\r\n${tag} OK selecionada\r\n`); }
      else if (/^UID SEARCH/i.test(cmd)) s.write(`* SEARCH ${box === 'INBOX' ? '7 19 11' : fakeImap.sentUids}\r\n${tag} OK busca\r\n`);
      else if (/^UID FETCH/i.test(cmd) && /BODY\.PEEK\[\]/.test(cmd)) { const b = Buffer.from(box === 'INBOX' ? COMPLETO : NOSSA + '\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nStatus enviado ontem.', 'latin1'); s.write(`* 5 FETCH (UID 19 BODY[] {${b.length}}\r\n`); s.write(b); s.write(`)\r\n${tag} OK buscado\r\n`); }
      else if (/^UID FETCH/i.test(cmd)) { const c = box === 'INBOX' ? CORPO : NOSSA; const dt = box === 'INBOX' ? '04-Nov-2026 16:15:10 -0300' : '05-Nov-2026 08:14:38 -0300'; s.write(`* 5 FETCH (UID ${box === 'INBOX' ? 19 : 21} INTERNALDATE "${dt}" RFC822.SIZE 4000 BODY[HEADER.FIELDS (...)] {${Buffer.byteLength(c)}}\r\n${c})\r\n${tag} OK buscado\r\n`); }
      else if (/^LIST/i.test(cmd)) s.write(`* LIST (\\HasNoChildren) "." INBOX\r\n* LIST (\\HasNoChildren \\Sent) "." INBOX.Enviados\r\n${tag} OK listado\r\n`);
      else if (/^APPEND/i.test(cmd)) { appendInfo.box = /APPEND "([^"]+)"/.exec(cmd)[1]; appendBytes = Number(/\{(\d+)\}/.exec(cmd)[1]); s.write('+ manda\r\n'); appendTag = tag; }
      else s.write(`${tag} OK\r\n`);
    }
  });
});

// ---------- SMTP falso ----------
let smtpData = '';
const smtpLog = [];
const smtp = tls.createServer(opts, (s) => {
  s.write('220 smtp falso\r\n');
  let buf = '', inData = false, authStep = 0;
  s.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') { inData = false; s.write('250 aceito\r\n'); }
        else smtpData += line + '\r\n';
        continue;
      }
      smtpLog.push(line);
      if (/^EHLO/i.test(line)) s.write('250-ola\r\n250 AUTH LOGIN PLAIN\r\n');
      else if (/^AUTH LOGIN/i.test(line)) { authStep = 0; s.write('334 VXNlcm5hbWU6\r\n'); }
      else if (/^MAIL FROM/i.test(line)) s.write('250 ok\r\n');
      else if (/^RCPT TO/i.test(line)) s.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { inData = true; s.write('354 manda\r\n'); }
      else if (/^QUIT/i.test(line)) s.write('221 tchau\r\n');
      else { authStep++; s.write(authStep === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 autenticado\r\n'); }
    }
  });
});

(async () => {
  await listen(imap, 9993);
  await listen(smtp, 9465);
  Object.assign(process.env, {
    MAIL_IMAP_HOST: '127.0.0.1', MAIL_IMAP_PORT: '9993', MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: '9465',
    MAIL_USER: 'status@costalog.com.br', MAIL_PASS: 'segredo', MAIL_FROM: 'status@costalog.com.br',
    MAIL_FROM_NAME: 'Status Costalog', MAIL_TLS_STRICT: '0', MAIL_IMAP_SECURE: '1', MAIL_SMTP_SECURE: '1',
  });
  const mail = require('../server/mail.js');
  const cfg = mail.config();

  check('configurado', mail.configured(), true);

  // ---------- IMAP ----------
  const th = await mail.findThread(cfg, 'HW 181/25');
  check('busca pelo assunto', imapLog.some((l) => l.includes('UID SEARCH HEADER SUBJECT "HW 181/25"')), true);
  check('pega o UID mais alto', th.uid, 19);
  check('quantas mensagens', th.total, 3);
  check('assunto decodificado', th.subject, 'STATUS - REFERÊNCIA: HW 181/25');
  check('remetente', th.from, '"Riquelme Moura" <riquelme@costalog.com.br>');
  check('cópia com acento', th.cc, '"Importação" <importacao@costalog.com.br>, gerencia@costalog.com.br');
  check('message-id', th.messageId, '<abc123@cliente.com>');
  check('references', th.references, '<ref1@x> <ref2@x>');
  check('procurou também nos enviados', imapLog.some((l) => l.includes('SELECT "INBOX.Enviados"')), true);
  check('última é da caixa de entrada', [th.box, th.fromMe], ['INBOX', false]);

  // corpo para citar: multipart, quoted-printable em iso-8859-1, sem script nem imagem embutida
  const tb = await mail.findThread(cfg, 'HW 181/25', null, { withBody: true });
  check('corpo html decodificado', tb.body.html.includes('programação'), true);
  check('corpo texto decodificado', tb.body.text, 'Boa tarde, segue a programação.');
  check('trecho para mostrar', tb.snippet, 'Boa tarde, segue a programação.');
  const qb = mail.quoteBlock(tb);
  check('citação com cabeçalho do Outlook', /<b>De:<\/b> &quot;Riquelme Moura&quot;/.test(qb.html) && qb.html.includes('<b>Assunto:</b> STATUS - REFERÊNCIA: HW 181/25'), true);
  check('citação mantém o conteúdo', qb.html.includes('Importação') && qb.html.includes('p.x{color:red}'), true);
  check('citação sem script, cid nem onclick', /<script|cid:|onclick/i.test(qb.html), false);
  check('citação em texto', qb.text.includes('-----Mensagem original-----') && qb.text.includes('Boa tarde, segue a programação.'), true);
  check('anexo da anterior não entra', /JVBERg/.test(qb.html + qb.text), false);

  // nossa resposta nos enviados é a mais nova: a conversa continua a partir dela
  fakeImap.sentUids = '21';
  const tn = await mail.findThread(cfg, 'HW 181/25');
  check('última é a nossa resposta', [tn.box, tn.uid, tn.fromMe, tn.messageId, tn.total], ['INBOX.Enviados', 21, true, '<nossa1@costalog.com.br>', 4]);
  fakeImap.sentUids = '';
  check('senha não vaza no log', imapLog.some((l) => l.includes('segredo')), true); // vai no LOGIN, mas só para o servidor

  // ---------- SMTP ----------
  const r = await mail.send(cfg, {
    to: '"Riquelme Moura" <riquelme@costalog.com.br>',
    cc: '"Importação" <importacao@costalog.com.br>, gerencia@costalog.com.br',
    subject: 'Re: STATUS - REFERÊNCIA: HW 181/25',
    text: 'Segue o status.',
    html: '<table><tr><td>HW 181/25</td></tr></table>',
    inReplyTo: th.messageId,
    references: th.references + ' ' + th.messageId,
    attachments: [{ name: 'CTE 123.pdf', type: 'application/pdf', data: Buffer.from('arquivo de teste').toString('base64') }],
  });
  check('enviou', r.ok, true);
  check('destinatários', r.rcpt, ['riquelme@costalog.com.br', 'importacao@costalog.com.br', 'gerencia@costalog.com.br']);
  check('RCPT TO por pessoa', smtpLog.filter((l) => /^RCPT TO/i.test(l)).length, 3);
  check('assunto codificado', /Subject: =\?UTF-8\?B\?/.test(smtpData), true);
  const sub = /Subject: (.*)/.exec(smtpData)[1];
  check('assunto volta certo', mail.decodeHeader(sub), 'Re: STATUS - REFERÊNCIA: HW 181/25');
  check('responde na mesma conversa', /In-Reply-To: <abc123@cliente\.com>/.test(smtpData), true);
  check('references mantidas', /References: <ref1@x> <ref2@x> <abc123@cliente\.com>/.test(smtpData), true);
  check('corpo html', smtpData.includes(Buffer.from('<table><tr><td>HW 181/25</td></tr></table>').toString('base64')), true);
  check('anexo', smtpData.includes(Buffer.from('arquivo de teste').toString('base64')), true);
  check('nome do anexo', /filename="CTE 123.pdf"/.test(smtpData), true);
  check('multipart/mixed', /Content-Type: multipart\/mixed/.test(smtpData), true);

  // ponto no início da linha precisa ser escapado (senão encerra a mensagem)
  smtpData = '';
  await mail.send(cfg, { to: 'a@b.com', subject: 'x', text: '.importante\nfim', html: '<p>.x</p>' });
  check('ponto no início protegido', smtpData.includes('\r\n..'), false); // o conteúdo vai em base64, sem pontos soltos

  // ---------- envio por HTTPS (API) com cópia em Enviados ----------
  const http = require('http');
  let apiReq = null;
  const apiSrv = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (d) => { body += d; });
    rq.on('end', () => {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      if (rq.method === 'GET') return rs.end(JSON.stringify({ id: 'abc-123', message_id: '<0103abc@sa-east-1.amazonses.com>' }));
      apiReq = { auth: rq.headers.authorization, body: JSON.parse(body) };
      rs.end(JSON.stringify({ id: 'abc-123' }));
    });
  });
  await new Promise((r) => apiSrv.listen(9087, '127.0.0.1', r));
  process.env.MAIL_API_URL = 'http://127.0.0.1:9087/emails';
  process.env.RESEND_API_KEY = 'chave-de-teste';
  const cfgApi = mail.config();
  check('escolhe a API quando há chave', cfgApi.apiKey, 'chave-de-teste');

  const ra = await mail.send(cfgApi, {
    to: '"Riquelme" <riquelme@costalog.com.br>', cc: 'importacao@costalog.com.br',
    subject: 'Re: STATUS - REFERÊNCIA: HW 181/25', text: 'Segue.', html: '<table><tr><td>HW 181/25</td></tr></table>',
    inReplyTo: '<abc123@cliente.com>', references: '<ref1@x> <abc123@cliente.com>',
    attachments: [{ name: 'cte.pdf', type: 'application/pdf', data: Buffer.from('pdf').toString('base64') }],
  });
  check('enviou pela API', ra.via, 'api');
  check('usou a chave', apiReq.auth, 'Bearer chave-de-teste');
  check('remetente com nome', apiReq.body.from, '"Status Costalog" <status@costalog.com.br>');
  check('destinatários da API', [apiReq.body.to, apiReq.body.cc], [['riquelme@costalog.com.br'], ['importacao@costalog.com.br']]);
  check('encadeamento pela API', apiReq.body.headers, { 'In-Reply-To': '<abc123@cliente.com>', References: '<ref1@x> <abc123@cliente.com>' });
  check('anexo pela API', apiReq.body.attachments[0].filename, 'cte.pdf');
  check('achou a pasta de enviados', ra.enviados, 'INBOX.Enviados');
  check('cópia em Enviados com o mesmo Message-ID do envio', /Message-ID: <0103abc@sa-east-1\.amazonses\.com>/.test(appendInfo.raw), true);
  check('cópia guardada tem o assunto', mail.decodeHeader(/Subject: (.*)/.exec(appendInfo.raw)[1]), 'Re: STATUS - REFERÊNCIA: HW 181/25');
  check('cópia guardada tem a tabela', appendInfo.raw.includes(Buffer.from('<table><tr><td>HW 181/25</td></tr></table>').toString('base64')), true);

  // erro da API vira mensagem legível
  apiSrv.close();
  await new Promise((r) => setTimeout(r, 50));
  const errSrv = http.createServer((rq, rs) => { rs.writeHead(403, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ message: 'domínio não verificado' })); });
  await new Promise((r) => errSrv.listen(9088, '127.0.0.1', r));
  process.env.MAIL_API_URL = 'http://127.0.0.1:9088/emails';
  let erro = '';
  try { await mail.send(mail.config(), { to: 'a@b.com', subject: 'x', html: '<p>x</p>' }); } catch (e) { erro = e.message; }
  check('erro da API explicado', erro, 'domínio não verificado');
  errSrv.close();
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_API_URL;

  // ---------- certificado do provedor (*.m9.network) acessado por outro nome, com verificação ligada ----------
  {
    const KEY2 = path.join(CERT, 'k2.pem'), CRT2 = path.join(CERT, 'c2.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY2, '-out', CRT2, '-days', '1', '-nodes',
      '-subj', '/CN=m9.network', '-addext', 'subjectAltName=DNS:*.m9.network,DNS:m9.network'], { stdio: 'ignore' });
    const prov = tls.createServer({ key: fs.readFileSync(KEY2), cert: fs.readFileSync(CRT2) }, (sk) => {
      sk.write('* OK Supramail5 IMAP Proxy Ready\r\n');
      let b = '';
      sk.on('data', (d) => {
        b += d; let i;
        while ((i = b.indexOf('\r\n')) >= 0) {
          const line = b.slice(0, i); b = b.slice(i + 2);
          const tag = line.split(' ')[0];
          if (/ UID SEARCH/i.test(line)) sk.write(`* SEARCH\r\n${tag} OK\r\n`); else sk.write(`${tag} OK\r\n`);
        }
      });
    });
    await new Promise((r) => prov.listen(9995, '127.0.0.1', r));
    // processo à parte: só ele confia no certificado de teste (NODE_EXTRA_CA_CERTS), como um certificado real
    const tenta = (tlsName) => new Promise((resolve) => {
      const env = Object.assign({}, process.env, { NODE_EXTRA_CA_CERTS: CRT2, MAIL_IMAP_HOST: '127.0.0.1', MAIL_IMAP_PORT: '9995',
        MAIL_IMAP_SECURE: '1', MAIL_TLS_STRICT: '1', MAIL_USER: 'u', MAIL_PASS: 'p', MAIL_TLS_NAME: tlsName || '' });
      const code = `const m=require(${JSON.stringify(path.join(__dirname, '..', 'server', 'mail.js'))});m.findThread(m.config(),'X').then(r=>console.log(JSON.stringify({ok:true,r})),e=>console.log(JSON.stringify({ok:false,e:e.message})))`;
      const { execFile } = require('child_process');
      execFile(process.execPath, ['-e', code], { env, timeout: 15000 }, (err, out) => { try { resolve(JSON.parse(String(out).trim().split('\n').pop())); } catch (e) { resolve({ ok: false, e: String(err || out) }); } });
    });
    const semNome = await tenta('');
    check('sem MAIL_TLS_NAME recusa o certificado do provedor', semNome.ok === false && /altnames/.test(semNome.e), true);
    const comNome = await tenta('m9.network');
    check('com MAIL_TLS_NAME aceita, mantendo a verificação', comNome.ok, true);
    const nomeErrado = await tenta('outro-provedor.com');
    check('nome errado continua recusando', nomeErrado.ok === false && /altnames|does not match/i.test(nomeErrado.e), true);
    prov.close();
  }

  // ---------- diagnóstico ----------
  const d = await mail.diag(cfg, [
    { nome: 'imap', host: '127.0.0.1', port: 9993, secure: true },
    { nome: 'fechado', host: '127.0.0.1', port: 9, secure: true },
  ]);
  check('diag acha o que responde', d[0].ok, true);
  check('diag saudação', d[0].greeting.includes('IMAP falso'), true);
  check('diag marca o que não responde', d[1].ok, false);

  // ---------- rotas do servidor (ponta a ponta) ----------
  const { spawn } = require('child_process');
  const PORT = 3600 + Math.floor(Math.random() * 300);
  const BASE = `http://127.0.0.1:${PORT}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (method, url, body, token) => {
    const r = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return Object.assign(j, { _status: r.status });
  };
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', ADMIN_EMAILS: 'ana@empresa.com' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 60 && !log.includes('no ar'); i++) await sleep(100);
    const ana = await call('POST', '/api/register', { name: 'Ana', email: 'ana@empresa.com', password: 'segredo1' });
    const bia = await call('POST', '/api/register', { name: 'Bia', email: 'bia@empresa.com', password: 'segredo1' });
    const docR = await call('POST', '/api/docs', { title: 'Mapa', data: { sheets: [{ id: 'sh1', name: 'MAPA', rows: 50, cols: 20, cells: {} }] } }, ana.token);
    await call('PUT', `/api/docs/${docR.id}/share`, { acl: { link: 'none', sectors: [{ id: 'op', name: 'Operação', default: 'edit', sheets: {} }], members: [{ email: 'bia@empresa.com', role: 'editor', sector: 'op' }] } }, ana.token);

    const cfgA = await call('GET', `/api/docs/${docR.id}/mail?sheet=sh1`, null, ana.token);
    check('rota diz que está configurado', cfgA.configurado, true);
    check('administradora pode enviar', cfgA.podeEnviar, true);
    const cfgB = await call('GET', `/api/docs/${docR.id}/mail?sheet=sh1`, null, bia.token);
    check('setor sem liberação não pode', cfgB.podeEnviar, false);

    const achou = await call('POST', `/api/docs/${docR.id}/mail/find`, { sheet: 'sh1', ref: 'HW 181/25' }, ana.token);
    check('achou a conversa', achou.achou, true);
    check('assunto da conversa', achou.thread.subject, 'STATUS - REFERÊNCIA: HW 181/25');
    check('responder a todos: Para', achou.destinatarios.to, '"Riquelme Moura" <riquelme@costalog.com.br>');
    check('responder a todos: Cópia sem a própria conta', achou.destinatarios.cc, '"Importação" <importacao@costalog.com.br>, gerencia@costalog.com.br');

    const negado = await call('POST', `/api/docs/${docR.id}/mail/find`, { sheet: 'sh1', ref: 'HW 181/25' }, bia.token);
    check('busca negada para quem não pode', negado._status, 403);
    const negado2 = await call('POST', `/api/docs/${docR.id}/mail/send`, { sheet: 'sh1', subject: 'x', to: 'a@b.com', html: '<p>x</p>' }, bia.token);
    check('envio negado para quem não pode', negado2._status, 403);
    const semDest = await call('POST', `/api/docs/${docR.id}/mail/send`, { sheet: 'sh1', subject: 'x', to: '', html: '<p>x</p>' }, ana.token);
    check('exige destinatário', semDest._status, 400);

    smtpData = '';
    const enviado = await call('POST', `/api/docs/${docR.id}/mail/send`, {
      sheet: 'sh1', subject: 'Re: STATUS - REFERÊNCIA: HW 181/25',
      to: achou.destinatarios.to, cc: achou.destinatarios.cc,
      html: '<p>Boa tarde!</p><table><tr><td>CAIU4455592</td></tr></table>', text: 'Boa tarde!',
      inReplyTo: achou.thread.messageId, references: achou.thread.references + ' ' + achou.thread.messageId,
      attachments: [{ name: 'cte.pdf', type: 'application/pdf', data: Buffer.from('pdf falso').toString('base64') }],
    }, ana.token);
    check('enviou pela rota', enviado.ok, true);
    check('rota mandou para 3', enviado.destinatarios.length, 3);
    check('rota manteve a conversa', /In-Reply-To: <abc123@cliente\.com>/.test(smtpData), true);
    check('rota levou o anexo', smtpData.includes(Buffer.from('pdf falso').toString('base64')), true);
    check('busca não manda o corpo inteiro', [achou.thread.body, achou.thread.citada, achou.thread.snippet], [undefined, true, 'Boa tarde, segue a programação.']);

    // com a REFERENCIA, o servidor responde à última mensagem e cita o histórico
    smtpData = '';
    const cont = await call('POST', `/api/docs/${docR.id}/mail/send`, {
      sheet: 'sh1', subject: 'Re: STATUS - REFERÊNCIA: HW 181/25', to: achou.destinatarios.to, ref: 'HW 181/25', quote: true,
      html: '<p>Status novo</p>', text: 'Status novo',
    }, ana.token);
    check('envio na conversa', cont.ok, true);
    check('responde à última mensagem', /In-Reply-To: <abc123@cliente\.com>/.test(smtpData) && /References: <ref1@x> <ref2@x> <abc123@cliente\.com>/.test(smtpData), true);
    const partes = [...smtpData.matchAll(/\r\n\r\n([A-Za-z0-9+/=\r\n]{40,})/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8')).join('\n');
    check('histórico citado no corpo', partes.includes('Status novo') && partes.includes('<b>De:</b>') && partes.includes('programação'), true);

    // nossa resposta é a última: vai de novo para as mesmas pessoas
    fakeImap.sentUids = '21';
    const achou2 = await call('POST', `/api/docs/${docR.id}/mail/find`, { sheet: 'sh1', ref: 'HW 181/25' }, ana.token);
    check('última nossa: mesmos destinatários', [achou2.thread.fromMe, achou2.destinatarios.to, achou2.destinatarios.cc], [true, '"Riquelme Moura" <riquelme@costalog.com.br>', 'gerencia@costalog.com.br']);
    fakeImap.sentUids = '';
  } finally { proc.kill(); }

  imap.close(); smtp.close();
  console.log(`\n${pass} testes de e-mail passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
