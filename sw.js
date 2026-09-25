// ============================================================
// DEK WMS – service worker
// ============================================================
// Díky němu se aplikace chová jako nainstalovaná: má vlastní ikonu,
// běží na celou obrazovku a naběhne i bez signálu.
//
// Zásadní pravidlo: požadavky na Apps Script se NIKDY neukládají
// do mezipaměti. Skladník musí vždycky vidět skutečný stav tabulky,
// ne to, co tam bylo před hodinou.
// ============================================================

const CACHE = 'dek-wms-v3';

const SOUBORY = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SOUBORY); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (klice) {
        return Promise.all(klice
          .filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cizí adresy (Apps Script, jsQR z CDN) pouštíme rovnou na síť.
  // Odpovědi skriptu se nesmí ukládat – data musí být vždy živá.
  if (url.origin !== self.location.origin) return;

  const jeStranka = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('index.html');

  if (jeStranka) {
    // Stránku bereme přednostně ze sítě, aby se nová verze projevila hned.
    // Bez signálu se sáhne do mezipaměti.
    e.respondWith(
      fetch(req)
        .then(function (resp) {
          const kopie = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, kopie); });
          return resp;
        })
        .catch(function () {
          return caches.match(req).then(function (r) {
            return r || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Ikony a ostatní vlastní soubory – z mezipaměti, jinak ze sítě
  e.respondWith(
    caches.match(req).then(function (r) { return r || fetch(req); })
  );
});
