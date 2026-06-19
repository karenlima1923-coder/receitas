/* Mise · service worker — app instalável e funcionamento offline */
const CACHE = 'mise-v1';
const SHELL = [
  './',
  './index.html',
  './firestore-store.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

// instala: guarda o "esqueleto" do app
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ativa: limpa versões antigas do cache
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// busca:
//  - navegação (abrir o app): tenta a rede primeiro; se offline, usa o cache
//  - demais arquivos: usa o cache primeiro; se não tiver, busca na rede e guarda
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // não interceptar Firebase/Firestore/Google APIs (precisam ir sempre à rede)
  const url = new URL(req.url);
  if (/googleapis|gstatic|firebase|firebaseio/.test(url.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // guarda cópias de mesma origem para uso offline
        if (res && res.status === 200 && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
