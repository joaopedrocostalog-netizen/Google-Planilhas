// WebSocket mínimo (RFC 6455) sem dependências: texto, ping/pong, fragmentação, fechamento e compressão
// (permessage-deflate, RFC 7692, sem contexto entre mensagens: cada mensagem é compactada sozinha).
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024 * 1024;
// mensagens pequenas não compensam compactar; as grandes (a planilha inteira) compactam fora do laço principal
const MIN_DEFLATE = 1024, ASYNC_DEFLATE = 64 * 1024;
const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const SYNC = { finishFlush: zlib.constants.Z_SYNC_FLUSH };

// Mensagem pronta para várias conexões: o texto é convertido uma vez só e a versão compactada também é
// calculada uma vez (na primeira conexão que aceita compressão) e reaproveitada pelas outras.
// partes: uma mensagem pode ser montada com pedaços já preparados (ex.: a planilha inteira, guardada entre
// várias entradas), e os pedaços compactados são emendados (cada um termina num bloco de sincronização).
function prepare(m) {
  return { raw: Buffer.from(typeof m === 'string' ? m : JSON.stringify(m), 'utf8'), z: null };
}
function deflate(raw) {
  if (raw.length < ASYNC_DEFLATE) return zlib.deflateRawSync(raw, Object.assign({ level: 6 }, SYNC));
  return new Promise((res) => zlib.deflateRaw(raw, Object.assign({ level: 1 }, SYNC), (e, b) => res(e ? null : b)));
}
// compactado de uma parte (com o bloco de sincronização no fim, para poder emendar)
function partZ(p) { if (!p.z) p.z = deflate(p.raw); return p.z; }
// junta partes: [prepare(...), ...] -> { raw, partes } (o compactado emenda os pedaços já compactados)
function join(parts) { return { raw: Buffer.concat(parts.map((x) => x.raw)), parts, z: null }; }
function messageZ(p) {
  if (p.z) return p.z;
  if (!p.parts) { p.z = partZ(p); return p.z; }
  const zs = p.parts.map(partZ);
  p.z = zs.some((z) => z && typeof z.then === 'function') ? Promise.all(zs).then((a) => (a.every(Boolean) ? Buffer.concat(a) : null)) : Buffer.concat(zs);
  return p.z;
}

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    this.alive = true;
    this.deflate = false; // ligado no aceite, se o navegador oferecer permessage-deflate
    this.busy = 0; // envios esperando a compressão: os seguintes entram na fila, para manter a ordem
    this.chain = Promise.resolve();
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, rsv1 = (b0 & 0x40) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = this.buf.readUInt32BE(2) * 4294967296 + this.buf.readUInt32BE(6); off = 10; }
      if (len > MAX_MESSAGE) { this.close(1009, 'Mensagem grande demais'); return; }
      const maskAt = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked) { const m = this.buf.subarray(maskAt, maskAt + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + len);
      this._frame(fin, op, payload, rsv1);
      if (!this.open) return;
    }
  }
  _frame(fin, op, payload, rsv1) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._send(0xA, payload); return; }
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2) { this.frags = [payload]; this.fragOp = op; this.fragZ = rsv1; }
    else if (op === 0x0) this.frags.push(payload);
    else return;
    if (fin) {
      let data = Buffer.concat(this.frags);
      this.frags = [];
      if (this.fragZ) {
        if (!this.deflate) { this.close(1002, 'Compressão não combinada'); return; }
        try { data = zlib.inflateRawSync(Buffer.concat([data, TAIL]), Object.assign({ maxOutputLength: MAX_MESSAGE }, SYNC)); } catch (e) { this.close(1007, 'Mensagem compactada inválida'); return; }
      }
      if (this.fragOp === 0x1) this.emit('message', data.toString('utf8'));
    }
  }
  _send(op, payload, rsv1) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) { h = Buffer.alloc(2); h[1] = len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[1] = 127; h.writeUInt32BE(Math.floor(len / 4294967296), 2); h.writeUInt32BE(len % 4294967296, 6); }
    h[0] = 0x80 | (rsv1 ? 0x40 : 0) | op;
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(obj) { this.sendPrepared(prepare(obj)); }
  // envia uma mensagem preparada (ver prepare/join): compactada se a conexão aceita e se compensa
  sendPrepared(p) {
    if (!this.open) return;
    if (!this.deflate || p.raw.length < MIN_DEFLATE) return this._out(null, p.raw);
    return this._out(messageZ(p), p.raw);
  }
  // mantém a ordem: enquanto uma compressão demorada não termina, os envios seguintes esperam na fila
  _out(z, raw) {
    const frame = (b) => { if (b) this._send(0x1, b.subarray(0, b.length - 4), true); else this._send(0x1, raw); };
    const lento = z && typeof z.then === 'function';
    if (!this.busy && !lento) return frame(z);
    this.busy++;
    this.chain = this.chain.then(() => z).then(frame, () => frame(null)).then(() => { this.busy--; });
  }
  ping() { this.alive = false; this._send(0x9, Buffer.alloc(0)); }
  close(code, reason) {
    if (!this.open) return;
    // se há mensagens esperando a compressão, fecha depois delas (ex.: aviso de erro seguido do fechamento)
    if (this.busy) { this.chain = this.chain.then(() => this.close(code, reason)); return; }
    const r = Buffer.from(reason || '', 'utf8');
    const b = Buffer.alloc(2 + r.length);
    b.writeUInt16BE(code || 1000, 0); r.copy(b, 2);
    this._send(0x8, b);
    this.open = false;
    this.socket.end();
    this.emit('close');
  }
  _closed() { if (this.open) { this.open = false; this.emit('close'); } }
}

// Aceita o "upgrade" HTTP -> WebSocket e devolve a conexão
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  // compressão: aceita se o navegador oferece; cada mensagem é compactada sozinha (sem contexto) nos dois sentidos
  const z = !process.env.WS_SEM_COMPRESSAO && /permessage-deflate/i.test(String(req.headers['sec-websocket-extensions'] || ''));
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n' +
    (z ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '') + '\r\n');
  const ws = new WSConn(socket);
  ws.deflate = z;
  if (head && head.length) ws._onData(head);
  return ws;
}

module.exports = { accept, WSConn, prepare, join };
