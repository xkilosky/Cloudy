/* Cloudy by X-Kilo — Offline Service Worker + Local IndexedDB AI REST Fallback */
const CACHE_NAME = 'cloudy-xkilo-v1';
const PRECACHE_ASSETS = /* __CLOUDY_PRECACHE_MANIFEST__ */ [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/cloudy-logo.png',
  '/favicon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Helper to open Cloudy's local IndexedDB vault when completely offline
function openOfflineVault() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cloudy_offline_vault', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve([]);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getOneFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve(null);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Cloudy-Runtime': 'service-worker-offline-vault',
    },
  });
}

async function handleOfflineAiApi(request, url) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const xApiKey = request.headers.get('X-API-Key') || url.searchParams.get('api_key') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : xApiKey.trim();

    if (!token) {
      return jsonResponse(
        { error: 'Missing Cloudy AI API key. Pass Authorization: Bearer cldy_sk_...' },
        401
      );
    }

    const db = await openOfflineVault();
    const keys = await getAllFromStore(db, 'api_keys');
    const matchedKey = keys.find((k) => k.key === token && k.active !== false);

    if (!matchedKey) {
      return jsonResponse({ error: 'Invalid or revoked Cloudy AI API key.' }, 403);
    }

    const folders = (await getAllFromStore(db, 'folders')).filter((f) => !f.trashed);
    const allFiles = (await getAllFromStore(db, 'files')).filter((f) => !f.trashed);

    // Filter by allowed folder IDs (including subfolders) if restricted
    let allowedFolderIds = null;
    if (Array.isArray(matchedKey.allowedFolderIds) && matchedKey.allowedFolderIds.length > 0) {
      allowedFolderIds = new Set(matchedKey.allowedFolderIds);
      let added = true;
      while (added) {
        added = false;
        for (const f of folders) {
          if (f.parentId && allowedFolderIds.has(f.parentId) && !allowedFolderIds.has(f.id)) {
            allowedFolderIds.add(f.id);
            added = true;
          }
        }
      }
    }

    const visibleFolders = allowedFolderIds
      ? folders.filter((f) => allowedFolderIds.has(f.id))
      : folders;
    const visibleFiles = allowedFolderIds
      ? allFiles.filter((f) => f.folderId && allowedFolderIds.has(f.folderId))
      : allFiles;

    const pathName = url.pathname;

    if (pathName === '/api/v1/ai/status') {
      return jsonResponse({
        ok: true,
        mode: 'offline-vault-sw',
        keyName: matchedKey.name,
        scope: matchedKey.scope,
        accessibleFolders: visibleFolders.length,
        accessibleFiles: visibleFiles.length,
      });
    }

    if (pathName === '/api/v1/ai/folders') {
      return jsonResponse({
        ok: true,
        mode: 'offline-vault-sw',
        count: visibleFolders.length,
        folders: visibleFolders,
      });
    }

    if (pathName === '/api/v1/ai/files') {
      const folderId = url.searchParams.get('folderId');
      const filtered = folderId
        ? visibleFiles.filter((f) => f.folderId === folderId)
        : visibleFiles;
      return jsonResponse({
        ok: true,
        mode: 'offline-vault-sw',
        count: filtered.length,
        files: filtered.map(({ textContent, ...meta }) => meta),
      });
    }

    if (pathName === '/api/v1/ai/search') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const hits = visibleFiles
        .filter((f) => {
          if (!q) return true;
          return (
            (f.name || '').toLowerCase().includes(q) ||
            (f.textContent || '').toLowerCase().includes(q) ||
            (f.tags || []).some((t) => t.toLowerCase().includes(q))
          );
        })
        .map((f) => ({
          id: f.id,
          name: f.name,
          folderId: f.folderId,
          mimeType: f.mimeType,
          size: f.size,
          snippet: (f.textContent || '').slice(0, 500),
        }));
      return jsonResponse({ ok: true, mode: 'offline-vault-sw', query: q, count: hits.length, results: hits });
    }

    const contentMatch = pathName.match(/^\/api\/v1\/ai\/files\/([^/]+)\/content$/);
    if (contentMatch) {
      const fileId = decodeURIComponent(contentMatch[1]);
      const file = visibleFiles.find((f) => f.id === fileId);
      if (!file) return jsonResponse({ error: 'File not found or not permitted for this API key' }, 404);
      let content = file.textContent;
      if (content == null) {
        const blobRec = await getOneFromStore(db, 'blobs', fileId);
        const mime = (file.mimeType || '').toLowerCase();
        const isTxt =
          mime.startsWith('text/') ||
          mime.includes('json') ||
          mime.includes('xml') ||
          mime.includes('javascript') ||
          /\.(md|txt|json|csv|ts|tsx|js|jsx|py|sh|yml|yaml|html|css|sql|xml|log)$/i.test(file.name || '');
        if (blobRec && blobRec.blob && isTxt) {
          content = await blobRec.blob.text();
        }
      }
      return jsonResponse({
        ok: true,
        mode: 'offline-vault-sw',
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          folderId: file.folderId,
          updatedAt: file.updatedAt,
        },
        content: content ?? '[Binary file — fetch /api/v1/ai/files/:id/raw for raw bytes]',
      });
    }

    const rawMatch = pathName.match(/^\/api\/v1\/ai\/files\/([^/]+)\/raw$/);
    if (rawMatch) {
      const fileId = decodeURIComponent(rawMatch[1]);
      const file = visibleFiles.find((f) => f.id === fileId);
      if (!file) return jsonResponse({ error: 'File not found or not permitted for this API key' }, 404);
      const blobRec = await getOneFromStore(db, 'blobs', fileId);
      if (blobRec && blobRec.blob) {
        return new Response(blobRec.blob, {
          status: 200,
          headers: {
            'Content-Type': file.mimeType || blobRec.blob.type || 'application/octet-stream',
            'X-Cloudy-Runtime': 'service-worker-offline-vault',
          },
        });
      }
      if (typeof file.textContent === 'string') {
        return new Response(file.textContent, {
          status: 200,
          headers: {
            'Content-Type': file.mimeType || 'text/plain; charset=utf-8',
            'X-Cloudy-Runtime': 'service-worker-offline-vault',
          },
        });
      }
      return jsonResponse({ error: 'Binary blob not cached offline yet' }, 404);
    }

    return jsonResponse({ error: 'Unknown AI API endpoint' }, 404);
  } catch (err) {
    return jsonResponse({ error: 'Offline vault read error', detail: String(err) }, 500);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Intercept AI v1 API when offline (or if forced offline header is set)
  if (url.pathname.startsWith('/api/v1/ai/')) {
    const forceOffline = request.headers.get('X-Cloudy-Offline-Test') === '1';
    if (forceOffline) {
      event.respondWith(handleOfflineAiApi(request, url));
      return;
    }
    event.respondWith(
      fetch(request).catch(() => handleOfflineAiApi(request, url))
    );
    return;
  }

  // Other /api requests: network-only (client syncEngine handles IndexedDB fallback seamlessly)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static & SPA navigation requests: Stale-While-Revalidate / Cache-Fallback
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => {
            if (cached) return cached;
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });

        return cached || networkFetch;
      })
    );
  }
});
