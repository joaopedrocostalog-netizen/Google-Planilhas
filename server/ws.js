// WebSocket mínimo (RFC 6455) sem dependências: texto, ping/pong, fragmentação e fechamento.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024 * 1024;

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    this.alive = true;
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
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
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
      this._frame(fin, op, payload);
      if (!this.open) return;
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._send(0xA, payload); return; }
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2) { this.frags = [payload]; this.fragOp = op; }
    else if (op === 0x0) this.frags.push(payload);
    else return;
    if (fin) {
      const data = Buffer.concat(this.frags);
      this.frags = [];
      if (this.fragOp === 0x1) this.emit('message', data.toString('utf8'));
    }
  }
  _send(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) { h = Buffer.alloc(2); h[1] = len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[1] = 127; h.writeUInt32BE(Math.floor(len / 4294967296), 2); h.writeUInt32BE(len % 4294967296, 6); }
    h[0] = 0x80 | op;
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(obj) { this._send(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')); }
  ping() { this.alive = false; this._send(0x9, Buffer.alloc(0)); }
  close(code, reason) {
    if (!this.open) return;
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
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');
  const ws = new WSConn(socket);
  if (head && head.length) ws._onData(head);
  return ws;
}

module.exports = { accept, WSConn };
