// Notificações no celular (Web Push): o iPhone (app na Tela de Início, iOS 16.4+), o Android e o computador recebem
// avisos mesmo com a planilha fechada. Sem bibliotecas: VAPID (JWT ES256) e criptografia aes128gcm (RFC 8291/8188)
// com o crypto do Node. As chaves VAPID são criadas na primeira vez e ficam no banco (settings › push_vapid), nunca
// passam pelo chat nem por variáveis. As inscrições ficam em settings › push_subs: { userId: [{ endpoint, keys, prefs, ... }] }.
'use strict';
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const TIPOS = ['critico', 'troca', 'chat', 'prestacking', 'alerta', 'demurrage', 'status'];

function createPush(store, opts) {
  const log = (opts && opts.log) || console;
  const sendFetch = (opts && opts.fetch) || ((...a) => fetch(...a));
  let vapid = null;

  async function chaves() {
    if (vapid) return vapid;
    let sv = null;
    try { sv = await store.getSetting('push_vapid'); } catch (e) { /* sem banco ainda */ }
    if (!sv || !sv.d || !sv.pub) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = privateKey.export({ format: 'jwk' });
      const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65); // ponto não comprimido (65 bytes)
      sv = { d: jwk.d, x: jwk.x, y: jwk.y, pub: b64u(pub), at: new Date().toISOString() };
      await store.setSetting('push_vapid', sv);
      log.log('[push] chaves VAPID criadas');
    }
    vapid = Object.assign({}, sv, { key: crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: sv.d, x: sv.x, y: sv.y }, format: 'jwk' }) });
    return vapid;
  }

  function jwt(aud, v) {
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: (opts && opts.contato) || 'mailto:status@costalog.com.br' }));
    const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: v.key, dsaEncoding: 'ieee-p1363' });
    return head + '.' + body + '.' + b64u(sig);
  }

  // RFC 8291: chave de quem recebe (p256dh) + segredo (auth) → conteúdo cifrado em aes128gcm
  function cifra(payload, p256dh, auth) {
    const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const asPub = ecdh.getPublicKey();
    const shared = ecdh.computeSecret(uaPub);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
    const salt = crypto.randomBytes(16);
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
    const head = Buffer.alloc(21);
    salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
    return Buffer.concat([head, asPub, enc]);
  }

  async function enviaUm(sub, data) {
    const v = await chaves();
    const u = new URL(sub.endpoint);
    const body = cifra(JSON.stringify(data), sub.keys.p256dh, sub.keys.auth);
    const r = await sendFetch(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${jwt(u.origin, v)}, k=${v.pub}` },
      body, signal: AbortSignal.timeout(15000),
    });
    return r.status;
  }

  // ---------- inscrições ----------
  async function todas() { try { return (await store.getSetting('push_subs')) || {}; } catch (e) { return {}; } }
  async function grava(all) { await store.setSetting('push_subs', all); }
  // as notificações são obrigatórias: todos os tipos ficam ligados, seja o que for que o aparelho mandar ou tiver guardado
  const limpaPrefs = () => { const o = {}; for (const t of TIPOS) o[t] = true; return o; };
  const validaEndpoint = (e) => { try { const u = new URL(e); return (u.protocol === 'https:' || (process.env.PUSH_PERMITE_HTTP === '1' && u.protocol === 'http:')) && e.length < 1000; } catch (er) { return false; } };

  async function inscreve(userId, b) {
    const s = b && b.subscription;
    if (!s || !validaEndpoint(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) { const e = new Error('Inscrição inválida.'); e.status = 400; throw e; }
    const all = await todas();
    const lista = (all[userId] || []).filter((x) => x.endpoint !== s.endpoint);
    lista.push({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }, prefs: limpaPrefs(b.prefs), appUrl: String(b.appUrl || '').slice(0, 300), aparelho: String(b.aparelho || '').slice(0, 80), at: new Date().toISOString() });
    all[userId] = lista.slice(-8); // até 8 aparelhos por pessoa
    await grava(all);
    return { ok: true, aparelhos: all[userId].length };
  }
  async function cancela(userId, endpoint) {
    const all = await todas();
    all[userId] = (all[userId] || []).filter((x) => !endpoint || x.endpoint !== endpoint);
    if (!all[userId].length) delete all[userId];
    await grava(all);
    return { ok: true };
  }
  async function estado(userId, endpoint) {
    const all = await todas(), lista = all[userId] || [];
    const deste = lista.find((x) => x.endpoint === endpoint);
    return { inscrito: !!deste, prefs: limpaPrefs(), aparelhos: lista.length };
  }

  // envia para uma pessoa (todos os aparelhos que querem este tipo); apaga inscrições vencidas (404/410)
  async function paraPessoa(userId, tipo, msg) {
    const all = await todas(), lista = all[userId] || [];
    if (!lista.length) return 0;
    let n = 0, mudou = false;
    for (const s of lista) {
      const url = s.appUrl ? s.appUrl + (msg.hash || '') : '';
      try {
        const st = await enviaUm(s, { title: msg.title, body: msg.body, tag: msg.tag || tipo, url, forte: !!msg.forte || undefined });
        if (st === 404 || st === 410) { s.vencida = true; mudou = true; } else if (st < 300) n++;
        else log.error('[push] resposta', st, new URL(s.endpoint).host);
      } catch (e) { log.error('[push] falha ao enviar:', e.message); }
    }
    if (mudou) { all[userId] = lista.filter((x) => !x.vencida); if (!all[userId].length) delete all[userId]; await grava(all).catch(() => {}); }
    return n;
  }

  // juntadas: vários avisos do mesmo tipo em 20 s viram uma notificação só ("3 containers críticos")
  const fila = new Map();
  function avisa(userId, tipo, msg) {
    const k = userId + '|' + tipo + '|' + (msg.doc || '');
    let f = fila.get(k);
    if (!f) { f = { itens: [], timer: null }; fila.set(k, f); }
    f.itens.push(msg);
    if (f.timer) return;
    f.timer = setTimeout(() => {
      fila.delete(k);
      const it = f.itens;
      const m = it.length === 1 ? it[0] : Object.assign({}, it[it.length - 1], { title: (it[0].plural || it[0].title).replace('{n}', it.length), body: it.slice(-3).map((x) => x.body).join(' · ') });
      paraPessoa(userId, tipo, m).catch((e) => log.error('[push]', e.message));
    }, (opts && opts.juntar) || 20000);
    if (f.timer.unref) f.timer.unref();
  }
  async function inscritos() { return Object.keys(await todas()); }

  return { chaves, inscreve, cancela, estado, paraPessoa, avisa, inscritos, cifra, TIPOS, _b64u: b64u, _unb64u: unb64u };
}

module.exports = { createPush };
