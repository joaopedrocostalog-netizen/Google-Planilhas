// Conversa com o servidor de e-mail da empresa (Supramail): procura a conversa pelo assunto (IMAP)
// e responde a todos com a tabela de status (SMTP). Sem bibliotecas externas: só tls/net do Node.
'use strict';
const tls = require('tls');
const net = require('net');

const env = (...names) => { for (const n of names) if (process.env[n]) return process.env[n]; return ''; };
function config() {
  const host = env('MAIL_HOST', 'MAIL_SERVIDOR');
  return {
    user: env('MAIL_USER', 'MAIL_USUARIO'),
    pass: env('MAIL_PASS', 'MAIL_SENHA'),
    from: env('MAIL_FROM', 'MAIL_REMETENTE') || env('MAIL_USER', 'MAIL_USUARIO'),
    fromName: env('MAIL_FROM_NAME', 'MAIL_NOME') || '',
    imapHost: env('MAIL_IMAP_HOST') || host,
    imapPort: Number(env('MAIL_IMAP_PORT') || 993),
    smtpHost: env('MAIL_SMTP_HOST') || host,
    smtpPort: Number(env('MAIL_SMTP_PORT') || 465),
    // porta 993/465 = TLS direto; 143/587 = começa aberto e sobe para TLS (STARTTLS)
    imapSecure: env('MAIL_IMAP_SECURE') ? env('MAIL_IMAP_SECURE') !== '0' : null,
    smtpSecure: env('MAIL_SMTP_SECURE') ? env('MAIL_SMTP_SECURE') !== '0' : null,
    rejectUnauthorized: env('MAIL_TLS_STRICT') !== '0',
    // o certificado do servidor pode ser do provedor (ex.: *.m9.network) e não do endereço usado:
    // continua validando a cadeia, só que contra este nome
    tlsName: env('MAIL_TLS_NAME'),
    // envio por HTTPS (usado quando a hospedagem bloqueia as portas de SMTP, como o Render)
    apiKey: env('RESEND_API_KEY', 'MAIL_API_KEY'),
    apiUrl: env('MAIL_API_URL') || 'https://api.resend.com/emails',
    // 'api' ou 'smtp'; sem escolher, usa a API quando há chave
    transport: env('MAIL_TRANSPORT'),
    guardarEnviados: env('MAIL_SAVE_SENT') !== '0',
  };
}
const configured = () => { const c = config(); return !!(c.imapHost && c.user && c.pass); };

const tlsOpts = (host, rejectUnauthorized, tlsName) => {
  const o = { rejectUnauthorized, servername: host };
  if (tlsName) o.checkServerIdentity = (h, cert) => tls.checkServerIdentity(tlsName, cert);
  return o;
};
function connect({ host, port, secure, rejectUnauthorized, tlsName, timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    const done = (fn) => (x) => { clearTimeout(t); sock.removeAllListeners('error'); fn(x); };
    const sock = secure
      ? tls.connect(Object.assign({ host, port }, tlsOpts(host, rejectUnauthorized, tlsName)))
      : net.connect({ host, port });
    const t = setTimeout(() => { sock.destroy(); reject(new Error(`Sem resposta de ${host}:${port} (tempo esgotado).`)); }, timeout);
    sock.once(secure ? 'secureConnect' : 'connect', done(() => {
      // servidor mudo (porta errada, ou TLS esperado e não usado): desiste com mensagem clara
      sock.setTimeout(timeout, () => sock.destroy(new Error(`${host}:${port} aceitou a conexão mas não respondeu — confira a porta e se ela usa TLS direto.`)));
      resolve(sock);
    }));
    sock.once('error', done((e) => reject(new Error(`Não foi possível conectar em ${host}:${port}: ${e.message}`))));
  });
}
// upgrade de uma conexão aberta para TLS (STARTTLS)
function upgrade(sock, host, rejectUnauthorized, tlsName) {
  return new Promise((resolve, reject) => {
    const s = tls.connect(Object.assign({ socket: sock }, tlsOpts(host, rejectUnauthorized, tlsName)), () => resolve(s));
    s.once('error', reject);
  });
}

// ---------- Leitor de linhas, com suporte a literais {n} do IMAP ----------
function reader(sock) {
  let buf = Buffer.alloc(0);
  const waiters = [];
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
  const quebrou = (e) => { for (const w of waiters.splice(0)) w.reject(e instanceof Error ? e : new Error('Conexão encerrada pelo servidor.')); };
  sock.on('close', () => quebrou());
  sock.on('error', quebrou);
  function pump() {
    while (waiters.length) {
      const w = waiters[0];
      if (w.bytes !== undefined) {
        if (buf.length < w.bytes) return;
        const out = buf.subarray(0, w.bytes);
        buf = buf.subarray(w.bytes);
        waiters.shift(); w.resolve(Buffer.from(out));
        continue;
      }
      const i = buf.indexOf('\r\n');
      if (i < 0) return;
      const line = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 2);
      waiters.shift(); w.resolve(line);
    }
  }
  const take = (bytes) => new Promise((resolve, reject) => { waiters.push({ resolve, reject, bytes }); pump(); });
  return { line: () => take(undefined), bytes: (n) => take(n) };
}

// ---------- IMAP ----------
function imapQuote(s) { return '"' + String(s).replace(/([\\"])/g, '\\$1') + '"'; }
async function imapOpen(cfg) {
  const secure = cfg.imapSecure === null || cfg.imapSecure === undefined ? cfg.imapPort !== 143 : cfg.imapSecure;
  let sock = await connect({ host: cfg.imapHost, port: cfg.imapPort, secure, rejectUnauthorized: cfg.rejectUnauthorized, tlsName: cfg.tlsName });
  let rd = reader(sock);
  await rd.line(); // saudação
  let n = 0;
  // binary: o conteúdo dos literais vem byte a byte (latin1), para decodificar depois com o charset certo
  const cmd = async (text, binary) => {
    const tag = 'a' + ++n;
    sock.write(tag + ' ' + text + '\r\n');
    const lines = [];
    for (;;) {
      let line = await rd.line();
      // literal: o servidor avisa quantos bytes vêm a seguir
      const lit = /\{(\d+)\}$/.exec(line);
      // o conteudo do literal comeca numa linha nova (senao o 1o cabecalho gruda no prefixo do FETCH)
      if (lit) { const body = await rd.bytes(Number(lit[1])); line = line.replace(/\{\d+\}$/, '') + '\r\n' + body.toString(binary ? 'latin1' : 'utf8'); }
      if (line.startsWith(tag + ' ')) {
        const rest = line.slice(tag.length + 1);
        if (/^OK/i.test(rest)) return lines;
        throw new Error('IMAP: ' + rest);
      }
      lines.push(line);
    }
  };
  const cmdLiteral = async (text, data) => {
    const tag = 'a' + ++n;
    sock.write(tag + ' ' + text + ' {' + Buffer.byteLength(data) + '}\r\n');
    const cont = await rd.line();
    if (!cont.startsWith('+')) throw new Error('IMAP: ' + cont);
    sock.write(data + '\r\n');
    for (;;) {
      const line = await rd.line();
      if (!line.startsWith(tag + ' ')) continue;
      const rest = line.slice(tag.length + 1);
      if (/^OK/i.test(rest)) return true;
      throw new Error('IMAP: ' + rest);
    }
  };
  if (!secure) { await cmd('STARTTLS'); sock = await upgrade(sock, cfg.imapHost, cfg.rejectUnauthorized, cfg.tlsName); rd = reader(sock); }
  await cmd('LOGIN ' + imapQuote(cfg.user) + ' ' + imapQuote(cfg.pass));
  return { cmd, cmdLiteral, close: () => { try { sock.write('a999 LOGOUT\r\n'); } catch (e) { /* já caiu */ } sock.destroy(); } };
}
// cabeçalhos de uma mensagem, em objeto
function parseHeaders(text) {
  const out = {};
  const unfolded = String(text).replace(/\r\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) { const k = m[1].toLowerCase(); out[k] = out[k] ? out[k] + ', ' + m[2].trim() : m[2].trim(); }
  }
  return out;
}
// decodifica =?UTF-8?B?...?= e =?UTF-8?Q?...?= nos cabeçalhos
function decodeBytes(buf, charset) {
  let cs = String(charset || 'utf-8').trim().replace(/^"|"$/g, '').toLowerCase();
  if (!cs || cs === 'us-ascii' || cs === 'ascii') cs = 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch (e) { return Buffer.from(buf).toString('latin1'); }
}
function decodeHeader(s) {
  return String(s || '').replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const charset = cs.split('*')[0];
      if (/^b$/i.test(enc)) return decodeBytes(Buffer.from(txt, 'base64'), charset);
      return decodeBytes(Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'), charset);
    } catch (e) { return m; }
  });
}

// ---------- Corpo da mensagem (MIME), para citar a mensagem anterior na resposta ----------
const paramOf = (v, name) => { const m = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*("([^"]*)"|[^;\\s]+)', 'i').exec(v || ''); return m ? (m[2] !== undefined ? m[2] : m[1]) : ''; };
function decodeBody(body, cte) {
  const t = String(cte || '').trim().toLowerCase();
  if (t === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (t === 'quoted-printable') return Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  return Buffer.from(body, 'latin1');
}
// raw: mensagem inteira em latin1 (um caractere por byte) → { html, text } da parte de texto
function parseMime(raw, out, depth) {
  out = out || { html: '', text: '' };
  if ((depth || 0) > 8) return out;
  const sep = /\r?\n\r?\n/.exec(raw);
  const head = sep ? raw.slice(0, sep.index) : raw, body = sep ? raw.slice(sep.index + sep[0].length) : '';
  const h = parseHeaders(head);
  const ct = h['content-type'] || 'text/plain';
  const type = ct.split(';')[0].trim().toLowerCase();
  if (/attachment/i.test(h['content-disposition'] || '')) return out;
  if (type.startsWith('multipart/')) {
    const b = paramOf(ct, 'boundary');
    if (!b) return out;
    const pieces = body.split('--' + b);
    for (let i = 1; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.startsWith('--')) break;
      parseMime(p.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, ''), out, (depth || 0) + 1);
    }
    return out;
  }
  if (type !== 'text/html' && type !== 'text/plain') return out;
  const txt = decodeBytes(decodeBody(body, h['content-transfer-encoding']), paramOf(ct, 'charset'));
  if (type === 'text/html' && !out.html) out.html = txt;
  if (type === 'text/plain' && !out.text) out.text = txt.replace(/\s+$/, '');
  return out;
}
const escHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// HTML seguro para ir citado: só o que está dentro do <body> (com os estilos do <head>), sem scripts nem imagens embutidas
function quotableHtml(parts) {
  let html = parts.html;
  if (!html && parts.text) return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + escHtml(parts.text).replace(/\r?\n/g, '<br>') + '</div>';
  if (!html) return '';
  const styles = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('');
  const bm = /<body[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(html);
  html = bm ? bm[1] : html.replace(/<head[\s\S]*?<\/head>/i, '');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<(iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img[^>]+src\s*=\s*["']?cid:[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  return styles + html;
}
// "quarta-feira, 4 de novembro de 2026 16:15", no fuso de São Paulo
function dataPt(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d || '');
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(dt).replace(' às ', ' ');
  } catch (e) { return String(d || ''); }
}
// bloco "mensagem original" no estilo do Outlook, para a resposta seguir a conversa
function quoteBlock(th) {
  if (!th || !th.body) return { html: '', text: '' };
  const linha = (k, v) => (v ? `<b>${k}</b> ${escHtml(v)}<br>` : '');
  const html = '<br><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 8px">' +
    linha('De:', th.from) + linha('Enviada em:', dataPt(th.when || th.date)) + linha('Para:', th.to) + linha('Cc:', th.cc) + linha('Assunto:', th.subject) +
    '</p></div>' + quotableHtml(th.body);
  const t = th.body.text || String(th.body.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const text = '\n\n-----Mensagem original-----\n' + [['De', th.from], ['Enviada em', dataPt(th.when || th.date)], ['Para', th.to], ['Cc', th.cc], ['Assunto', th.subject]].filter((x) => x[1]).map((x) => x[0] + ': ' + x[1]).join('\n') + '\n\n' + t.trim();
  return { html, text };
}
// INTERNALDATE do IMAP ("04-Nov-2026 16:15:00 -0300") → milissegundos
function imapDate(s) { const t = Date.parse(String(s || '').replace(/^(\d{1,2})-(\w{3})-(\d{4})/, '$1 $2 $3')); return isNaN(t) ? 0 : t; }
const addrOf = (s) => { const m = /<([^>]+)>/.exec(String(s || '')); return (m ? m[1] : String(s || '')).trim().toLowerCase(); };
// Procura a mensagem MAIS RECENTE cujo assunto contém o texto, na caixa de entrada e nos Enviados
// (a última da conversa pode ser uma resposta nossa). withBody: traz também o corpo, para citar na resposta.
const HDRS = 'MESSAGE-ID REFERENCES IN-REPLY-TO SUBJECT FROM TO CC REPLY-TO DATE';
const MAX_CITAR = 8 * 1024 * 1024;
async function findThread(cfg, needle, mailbox, opts) {
  opts = opts || {};
  const im = await imapOpen(cfg);
  try {
    const boxes = [mailbox || 'INBOX'];
    if (!mailbox) { const sent = await sentMailbox(im); if (sent && sent.toUpperCase() !== 'INBOX') boxes.push(sent); }
    let best = null, total = 0;
    for (const box of boxes) {
      try { await im.cmd('SELECT ' + imapQuote(box)); } catch (e) { continue; }
      const res = await im.cmd('UID SEARCH HEADER SUBJECT ' + imapQuote(needle));
      const line = res.find((l) => /^\* SEARCH/i.test(l)) || '';
      const uids = line.replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
      if (!uids.length) continue;
      total += uids.length;
      const uid = Math.max(...uids);
      const raw = (await im.cmd(`UID FETCH ${uid} (INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (${HDRS})])`)).join('\r\n');
      const h = parseHeaders(raw);
      const di = /INTERNALDATE "([^"]+)"/i.exec(raw), sz = /RFC822\.SIZE (\d+)/i.exec(raw);
      const when = (di && imapDate(di[1])) || Date.parse(h.date || '') || 0;
      if (!best || when > best.when) best = { box, uid, when, size: sz ? Number(sz[1]) : 0, h };
    }
    if (!best) return null;
    const h = best.h, from = decodeHeader(h['reply-to'] || h.from || '');
    const me = [cfg.from, cfg.user].map(addrOf);
    const out = {
      uid: best.uid, total, box: best.box,
      subject: decodeHeader(h.subject || ''),
      from,
      to: decodeHeader(h.to || ''),
      cc: decodeHeader(h.cc || ''),
      date: h.date || '',
      when: best.when ? new Date(best.when).toISOString() : '',
      messageId: (h['message-id'] || '').trim(),
      references: (h.references || '').trim(),
      fromMe: me.includes(addrOf(h.from || '')),
    };
    if (opts.withBody && best.size <= MAX_CITAR) {
      try {
        await im.cmd('SELECT ' + imapQuote(best.box));
        const lines = await im.cmd(`UID FETCH ${best.uid} (BODY.PEEK[])`, true);
        const first = lines.find((l) => /FETCH/i.test(l) && l.includes('\r\n')) || '';
        const raw = first.slice(first.indexOf('\r\n') + 2);
        out.body = parseMime(raw);
        const t = (out.body.text || String(out.body.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();
        out.snippet = t.slice(0, 400);
      } catch (e) { out.body = null; }
    }
    return out;
  } finally { im.close(); }
}

// Pasta de enviados da conta (o nome muda conforme o servidor: Sent, Enviados, INBOX.Sent...)
async function sentMailbox(im) {
  let lines = [];
  try { lines = await im.cmd('LIST "" "*"'); } catch (e) { return null; }
  let porNome = null;
  for (const l of lines) {
    const m = /^\* LIST \(([^)]*)\) "?([^"]*)"? (.*)$/.exec(l);
    if (!m) continue;
    const flags = m[1], nome = m[3].trim().replace(/^"|"$/g, '');
    if (/\\Sent/i.test(flags)) return nome;
    if (!porNome && /(^|[./])(sent|enviad)/i.test(nome)) porNome = nome;
  }
  return porNome;
}
// guarda uma cópia da mensagem enviada na pasta Enviados, para o histórico ficar completo no webmail
async function saveToSent(cfg, raw) {
  const im = await imapOpen(cfg);
  try {
    const box = await sentMailbox(im);
    if (!box) return null;
    await im.cmdLiteral('APPEND ' + imapQuote(box) + ' (\\Seen)', String(raw).replace(/\r?\n/g, '\r\n'));
    return box;
  } finally { im.close(); }
}

// ---------- SMTP ----------
async function smtpOpen(cfg) {
  const secure = cfg.smtpSecure === null || cfg.smtpSecure === undefined ? cfg.smtpPort === 465 : cfg.smtpSecure;
  let sock = await connect({ host: cfg.smtpHost, port: cfg.smtpPort, secure, rejectUnauthorized: cfg.rejectUnauthorized, tlsName: cfg.tlsName });
  let rd = reader(sock);
  const read = async () => {
    const lines = [];
    for (;;) {
      const l = await rd.line();
      lines.push(l);
      if (/^\d{3} /.test(l)) break;
    }
    const code = Number(lines[lines.length - 1].slice(0, 3));
    return { code, text: lines.join('\n') };
  };
  const say = async (text, ok) => {
    if (text !== null) sock.write(text + '\r\n');
    const r = await read();
    if (ok && !ok.includes(r.code)) throw new Error('SMTP: ' + r.text);
    return r;
  };
  await say(null, [220]);
  const me = 'planilhas.costalog';
  let ehlo = await say('EHLO ' + me, [250]);
  if (!secure && /STARTTLS/i.test(ehlo.text)) {
    await say('STARTTLS', [220]);
    sock = await upgrade(sock, cfg.smtpHost, cfg.rejectUnauthorized, cfg.tlsName);
    rd = reader(sock);
    ehlo = await say('EHLO ' + me, [250]);
  }
  await say('AUTH LOGIN', [334]);
  await say(Buffer.from(cfg.user).toString('base64'), [334]);
  await say(Buffer.from(cfg.pass).toString('base64'), [235]);
  return { say, close: () => { try { sock.write('QUIT\r\n'); } catch (e) { /* já caiu */ } sock.destroy(); } };
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encWord = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=');
// "Nome <a@b>" -> cabeçalho com o nome codificado quando tem acento
function encAddress(list) {
  return String(list || '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(a);
    if (!m) return a;
    const name = m[1].replace(/^["']|["']$/g, '').trim();
    return (name ? encWord(name) + ' ' : '') + '<' + m[2].trim() + '>';
  }).join(', ');
}
const addressesOf = (list) => String(list || '').split(',').map((a) => { const m = /<([^>]+)>/.exec(a); return (m ? m[1] : a).trim(); }).filter((a) => /^[^\s@]+@[^\s@]+$/.test(a));
const chunk76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

function buildMessage(cfg, msg) {
  const bound = '=_p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const alt = '=_a' + Math.random().toString(36).slice(2);
  const id = msg.messageId || '<' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) + '@' + (cfg.from.split('@')[1] || 'localhost') + '>';
  const atts = msg.attachments || [];
  const head = [
    'From: ' + (cfg.fromName ? encWord(cfg.fromName) + ' ' : '') + '<' + cfg.from + '>',
    'To: ' + encAddress(msg.to),
    msg.cc ? 'Cc: ' + encAddress(msg.cc) : '',
    'Subject: ' + encWord(msg.subject || ''),
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: ' + id,
    msg.inReplyTo ? 'In-Reply-To: ' + msg.inReplyTo : '',
    msg.references ? 'References: ' + msg.references : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const bodyParts = [
    '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', chunk76(b64(msg.text || '')),
    '--' + alt, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', chunk76(b64(msg.html || '')),
    '--' + alt + '--',
  ].join('\r\n');
  if (!atts.length) {
    head.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
    return { id, raw: head.join('\r\n') + '\r\n\r\n' + bodyParts + '\r\n' };
  }
  head.push('Content-Type: multipart/mixed; boundary="' + bound + '"');
  const parts = ['--' + bound, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '', bodyParts];
  for (const a of atts) {
    parts.push('--' + bound,
      'Content-Type: ' + (a.type || 'application/octet-stream') + '; name="' + encWord(a.name) + '"',
      'Content-Disposition: attachment; filename="' + encWord(a.name) + '"',
      'Content-Transfer-Encoding: base64', '', chunk76(String(a.data).replace(/\s+/g, '')));
  }
  parts.push('--' + bound + '--');
  return { id, raw: head.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n' };
}
// Envio por HTTPS (API do Resend): mesmo resultado do SMTP, mas pela porta 443.
async function sendApi(cfg, msg) {
  const to = addressesOf(msg.to), cc = addressesOf(msg.cc);
  if (!to.length) throw new Error('Nenhum destinatário válido.');
  const corpo = {
    from: (cfg.fromName ? '"' + cfg.fromName.replace(/"/g, '') + '" ' : '') + '<' + cfg.from + '>',
    to, subject: msg.subject || '', html: msg.html || '', text: msg.text || '',
  };
  if (cc.length) corpo.cc = cc;
  const headers = {};
  if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo;
  if (msg.references) headers.References = msg.references;
  if (Object.keys(headers).length) corpo.headers = headers;
  if ((msg.attachments || []).length) corpo.attachments = msg.attachments.map((a) => ({ filename: a.name, content: a.data, content_type: a.type }));
  let r, txt;
  try {
    r = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(30000),
    });
    txt = await r.text();
  } catch (e) { throw new Error('Falha ao falar com o serviço de envio: ' + e.message); }
  let j = {};
  try { j = JSON.parse(txt); } catch (e) { /* resposta sem json */ }
  if (!r.ok) throw new Error(j.message || j.error || ('o serviço de envio respondeu ' + r.status));
  return { ok: true, id: j.id || '', messageId: j.id ? '<' + j.id + '@resend>' : '', rcpt: to.concat(cc), via: 'api' };
}
// Message-ID que o serviço de envio deu à mensagem: a cópia em Enviados usa o mesmo, para as respostas seguirem a conversa
async function apiMessageId(cfg, id) {
  if (!id) return null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(cfg.apiUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + cfg.apiKey }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j = await r.json(); const m = j.message_id || j.messageId; if (m) return /^</.test(m) ? m : '<' + m + '>'; }
    } catch (e) { /* tenta de novo */ }
    await new Promise((res) => setTimeout(res, 700));
  }
  return null;
}
async function send(cfg, msg) {
  const modo = cfg.transport || (cfg.apiKey ? 'api' : 'smtp');
  if (modo === 'api') {
    if (!cfg.apiKey) throw new Error('Falta a chave da API de envio (RESEND_API_KEY).');
    const r = await sendApi(cfg, msg);
    // cópia na pasta Enviados do webmail (se falhar, o e-mail já foi: só avisa no log)
    if (cfg.guardarEnviados) {
      try {
        const mid = await apiMessageId(cfg, r.id);
        if (mid) r.messageId = mid;
        r.enviados = await saveToSent(cfg, buildMessage(cfg, Object.assign({}, msg, mid ? { messageId: mid } : {})).raw);
      }
      catch (e) { console.error('[e-mail] enviado, mas não deu para guardar em Enviados:', e.message); }
    }
    return r;
  }
  return sendSmtp(cfg, msg);
}
async function sendSmtp(cfg, msg) {
  const built = buildMessage(cfg, msg);
  const rcpt = [...new Set(addressesOf(msg.to).concat(addressesOf(msg.cc)))];
  if (!rcpt.length) throw new Error('Nenhum destinatário válido.');
  const sm = await smtpOpen(cfg);
  try {
    await sm.say('MAIL FROM:<' + cfg.from + '>', [250]);
    for (const r of rcpt) await sm.say('RCPT TO:<' + r + '>', [250, 251]);
    await sm.say('DATA', [354]);
    // ponto sozinho numa linha encerra a mensagem: protege os pontos do conteúdo
    await sm.say(built.raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', [250]);
    return { ok: true, messageId: built.id, rcpt, via: 'smtp' };
  } finally { sm.close(); }
}

// Testa onde o IMAP e o SMTP respondem (usado pelo diagnóstico, para descobrir host e porta)
async function diag(cfg, candidates) {
  const out = [];
  for (const c of candidates) {
    const t0 = Date.now();
    try {
      const sock = await connect({ host: c.host, port: c.port, secure: c.secure, rejectUnauthorized: false, timeout: 8000 });
      const rd = reader(sock);
      const greet = await Promise.race([rd.line(), new Promise((_, rj) => setTimeout(() => rj(new Error('sem saudação')), 6000))]);
      sock.destroy();
      out.push({ ...c, ok: true, ms: Date.now() - t0, greeting: String(greet).slice(0, 120) });
    } catch (e) { out.push({ ...c, ok: false, ms: Date.now() - t0, erro: e.message }); }
  }
  return out;
}

module.exports = { config, configured, findThread, parseMime, quoteBlock, quotableHtml, send, sendApi, sendSmtp, saveToSent, sentMailbox, diag, buildMessage, parseHeaders, decodeHeader, encAddress, addressesOf, imapQuote };
