// Service worker só para as notificações (não guarda arquivos em cache: a planilha sempre abre atualizada).
// No computador o aviso é do sistema: aparece por cima de qualquer janela, com a planilha na tela ou não, e fica
// até a pessoa clicar ou fechar (requireInteraction).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { title: 'Planilhas Costalog', body: e.data ? e.data.text() : '' }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'Planilhas Costalog', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, requireInteraction: true,
    icon: base + 'assets/apple-touch-icon.png', badge: base + 'assets/apple-touch-icon.png',
    data: { url: d.url || base },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'abrir', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
