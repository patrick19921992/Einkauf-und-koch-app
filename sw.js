// Service Worker: macht die App offline nutzbar und steuert Updates.
//
// tools/build.mjs ersetzt beim Veröffentlichen VERSION (Inhalts-Prüfsumme) und die
// Dateiliste. Jede neue Version bekommt dadurch einen eigenen Cache. Die neue Version
// übernimmt erst, wenn in der App auf „Neu laden“ getippt wird (nie mitten beim Kochen).

const VERSION = '__VERSION__';
const CACHE_PRAEFIX = 'ekapp-';
const CACHE = CACHE_PRAEFIX + VERSION;
const DATEIEN = [/*__DATEIEN__*/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' umgeht den HTTP-Cache, damit keine alten Dateien in die neue Version geraten
    await Promise.all(DATEIEN.map(async (pfad) => {
      const antwort = await fetch(new Request(pfad, { cache: 'reload' }));
      if (!antwort.ok) throw new Error(`Datei fehlt: ${pfad} (${antwort.status})`);
      await cache.put(pfad, antwort);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const namen = await caches.keys();
    // nur eigene, alte Caches löschen
    await Promise.all(namen
      .filter((n) => n.startsWith(CACHE_PRAEFIX) && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const typ = event.data?.typ;
  if (typ === 'SKIP_WAITING') self.skipWaiting();
  if (typ === 'VERSION') event.source?.postMessage({ typ: 'VERSION', version: VERSION });
});

async function ausCacheOderNetz(anfrage, schluessel) {
  const cache = await caches.open(CACHE);
  const treffer = await cache.match(schluessel, { ignoreSearch: true });
  if (treffer) return treffer;
  return fetch(anfrage);
}

self.addEventListener('fetch', (event) => {
  const anfrage = event.request;
  if (anfrage.method !== 'GET') return;
  const url = new URL(anfrage.url);
  // Fremde Adressen (Rezeptbilder, Import-Dienst) gehen direkt ins Netz und werden nicht gespeichert.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (anfrage.mode === 'navigate') {
    // Start, Neuladen und „Teilen“ (mit ?title=…&text=…) bekommen immer die App-Hülle.
    const index = new URL('./index.html', self.registration.scope).href;
    event.respondWith(ausCacheOderNetz(anfrage, index).catch(() => caches.match(index)));
    return;
  }
  event.respondWith(ausCacheOderNetz(anfrage, anfrage));
});
