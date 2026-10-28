// Installed-PWA Web Share Target. Handles POST inside the browser: no list text
// reaches Cloudflare Pages, GitHub Pages, a URL, analytics or a backend.
const SHARE_PATH = "/Saving-planner-pages/preview/pr-177/keep-share-target";
const RETURN_PATH = "/Saving-planner-pages/preview/pr-177/pending-products";
const DRAFT_KEY = 'saving-planner:keep-share-draft:v1';

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== SHARE_PATH) return;
  event.respondWith((async () => {
    const url = new URL(event.request.url);
    let received;
    try {
      const fields = await event.request.formData();
      received = fields.get('text');
    } catch {
      received = null;
    }

    if (typeof received !== 'string' || !received.trim() || received.length > 65536) {
      return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><body>No se recibió una lista de texto válida. Abre Saving Planner y pega el texto manualmente.</body></html>', {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    // Discard completed-item text before even the transient browser handoff.
    // Preserve counts for review, but only pending line text crosses navigation.
    const pending = [];
    let completedCount = 0;
    let ignoredCount = 0;
    for (const line of received.split(/\r?\n/)) {
      const match = /^\s*\[\s*([xX]?)\s*\]\s*(.*?)\s*$/.exec(line);
      if (!match || !match[2].trim()) {
        if (line.trim()) ignoredCount += 1;
      } else if (match[1]) {
        completedCount += 1;
      } else {
        pending.push('[ ] ' + match[2].trim());
      }
    }
    const handoff = JSON.stringify({
      text: pending.join('\n'),
      completedCount,
      ignoredCount,
    });
    // Escape HTML-script-sensitive code points before embedding a JS string.
    // The response is constructed by the local service worker, not by the server.
    const safeText = JSON.stringify(handoff)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    // Prefer a running PWA client. This preserves its sessionStorage and the
    // currently authenticated app instead of starting a fresh login window.
    // Only a same-origin existing app client may receive the sanitized draft.
    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = windows.find((client) => {
        const candidate = new URL(client.url);
        return candidate.origin === url.origin &&
          candidate.pathname !== SHARE_PATH &&
          candidate.pathname !== '/' + SHARE_PATH.split('/').pop();
      });
      if (target) {
        target.postMessage({ type: 'SAVING_PLANNER_KEEP_SHARE', draft: handoff });
        await target.focus();
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      }
    } catch {
      // Fallback to the new-window share review below.
    }

    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="referrer" content="no-referrer"><title>Compartir con Saving Planner</title></head>' +
      '<body><p>Abriendo la revisión de la lista…</p><script>try{' +
      'sessionStorage.setItem(' + JSON.stringify(DRAFT_KEY) + ',' + safeText + ');' +
      'location.replace(' + JSON.stringify(RETURN_PATH) + ');' +
      '}catch(e){document.body.textContent="No se pudo recibir la lista. Copia el texto y pégalo en Saving Planner."}' +
      '</script></body></html>';
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    });
  })());
});
