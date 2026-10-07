// =====================================================================
// Service worker: guarda uma cópia dos arquivos do app no aparelho.
// Estratégia "rede primeiro": tenta baixar a versão nova; sem internet,
// usa a cópia guardada. Assim atualizações aparecem sem complicação.
// =====================================================================
const CACHE = 'meus-remedios-v4';

const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
];

// Instalação: baixa e guarda os arquivos
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

// Ativação: apaga caches de versões antigas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Cada requisição: só mexe nos arquivos do próprio app (o Supabase passa direto)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    // cache: 'no-cache' obriga a conferir com o servidor se há versão nova.
    // Sem isso, o navegador pode usar uma cópia de até 10 min do GitHub Pages
    // e misturar arquivos novos com antigos.
    fetch(e.request.url, { cache: 'no-cache' })
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

// =====================================================================
// NOTIFICAÇÕES (push)
// =====================================================================

// Chegou um push do servidor: mostra a notificação.
// O servidor manda um JSON: { titulo, corpo, tag }
self.addEventListener('push', (e) => {
  const dados = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(dados.titulo || 'Meus Remédios', {
      body: dados.corpo || '',
      icon: 'icons/icon-192.png',
      // badge = ícone pequeno da barra de status. O Android usa só o formato
      // (partes transparentes x opacas) e pinta de branco: por isso um PNG
      // de fundo transparente, senão aparece um quadrado branco.
      badge: 'icons/badge-96.png',
      // Mesma tag = substitui a notificação anterior (10 min -> 5 min -> agora)
      tag: dados.tag || 'meus-remedios',
      renotify: true, // vibra/toca de novo mesmo substituindo
    })
  );
});

// Tocou na notificação: abre o app na tela Hoje
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      // App já aberto? Traz para frente e avisa para ir à tela Hoje
      for (const janela of janelas) {
        if ('focus' in janela) {
          janela.postMessage({ tipo: 'abrir-hoje' });
          return janela.focus();
        }
      }
      // App fechado: abre (ele já começa na tela Hoje)
      return self.clients.openWindow('./');
    })
  );
});
