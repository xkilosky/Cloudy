import express from 'express';
import archiver from 'archiver';
import {
  ensureVaultLoaded,
  saveDb,
  findDbByApiKeyAsync,
  getUnsealedAccount,
  readAccountBinary,
  writeAccountBinary,
  selectTargetAccount,
  makeId,
} from './store.mjs';
import {
  downloadFileFromRemoteProvider,
  uploadFileToRemoteProvider,
} from './cloudAdapters.mjs';

export function buildFolderPathMap(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathMap = new Map();

  function resolvePath(folderId, visited = new Set()) {
    if (!folderId || !byId.has(folderId) || visited.has(folderId)) return '/';
    if (pathMap.has(folderId)) return pathMap.get(folderId);
    visited.add(folderId);
    const folder = byId.get(folderId);
    const parentPath = folder.parentId ? resolvePath(folder.parentId, visited) : '';
    const full = `${parentPath === '/' ? '' : parentPath}/${folder.name}`;
    pathMap.set(folderId, full);
    return full;
  }

  for (const f of folders) {
    resolvePath(f.id);
  }
  return pathMap;
}

function getAllowedScopeForKey(db, apiKeyObj) {
  const activeFolders = db.folders.filter((f) => !f.trashed);
  const activeFiles = db.files.filter((f) => !f.trashed);

  if (!apiKeyObj.allowedFolderIds || apiKeyObj.allowedFolderIds.length === 0) {
    return { folders: activeFolders, files: activeFiles };
  }

  const allowedIds = new Set(apiKeyObj.allowedFolderIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of activeFolders) {
      if (f.parentId && allowedIds.has(f.parentId) && !allowedIds.has(f.id)) {
        allowedIds.add(f.id);
        changed = true;
      }
    }
  }

  return {
    folders: activeFolders.filter((f) => allowedIds.has(f.id)),
    files: activeFiles.filter((f) => f.folderId && allowedIds.has(f.folderId)),
    allowedIds,
  };
}

function recordAiAudit(db, keyObj, method, endpoint, statusCode) {
  keyObj.usageCount = (keyObj.usageCount || 0) + 1;
  keyObj.lastUsedAt = new Date().toISOString();
  db.aiAuditLog = db.aiAuditLog || [];
  db.aiAuditLog.unshift({
    id: makeId('aud'),
    keyId: keyObj.id,
    keyName: keyObj.name,
    method,
    endpoint,
    status: statusCode,
    timestamp: keyObj.lastUsedAt,
  });
  if (db.aiAuditLog.length > 60) {
    db.aiAuditLog.length = 60;
  }
  saveDb(db.vaultId);
}

export function createAiRouter() {
  const router = express.Router();

  // Middleware: Authenticate Cloudy AI API Key (Bearer cldy_sk_... or X-API-Key)
  router.use(async (req, res, next) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();

      const auth = req.headers.authorization || '';
      const headerKey = req.headers['x-api-key'] || req.query.api_key || '';
      const token = auth.startsWith('Bearer ')
        ? auth.slice(7).trim()
        : String(headerKey).trim();

      if (!token) {
        return res.status(401).json({
          ok: false,
          error: 'Missing Cloudy AI API key. Provide header Authorization: Bearer cldy_sk_...',
        });
      }

      const found = await findDbByApiKeyAsync(token);
      if (!found) {
        return res.status(403).json({
          ok: false,
          error: 'Invalid, paused, or revoked Cloudy AI API key.',
        });
      }

      req.cloudyDb = found.db;
      req.aiKey = found.matched;
      next();
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  // GET /api/v1/ai/status
  router.get('/status', (req, res) => {
    const db = req.cloudyDb;
    const { folders, files } = getAllowedScopeForKey(db, req.aiKey);
    recordAiAudit(db, req.aiKey, 'GET', '/api/v1/ai/status', 200);
    res.json({
      ok: true,
      project: 'Cloudy by X-Kilo',
      keyName: req.aiKey.name,
      scope: req.aiKey.scope,
      restrictedToFolders: Boolean(req.aiKey.allowedFolderIds?.length),
      accessibleFolders: folders.length,
      accessibleFiles: files.length,
      offlinePinnedFiles: files.filter((f) => f.offlinePinned !== false).length,
    });
  });

  // GET /api/v1/ai/folders
  router.get('/folders', (req, res) => {
    const db = req.cloudyDb;
    const { folders, files } = getAllowedScopeForKey(db, req.aiKey);
    const pathMap = buildFolderPathMap(db.folders);

    const enriched = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      path: pathMap.get(f.id) || `/${f.name}`,
      offlinePinned: f.offlinePinned !== false,
      fileCount: files.filter((fl) => fl.folderId === f.id).length,
      updatedAt: f.updatedAt,
    }));

    recordAiAudit(db, req.aiKey, 'GET', '/api/v1/ai/folders', 200);
    res.json({
      ok: true,
      count: enriched.length,
      folders: enriched,
    });
  });

  // GET /api/v1/ai/files
  router.get('/files', (req, res) => {
    const db = req.cloudyDb;
    const { files } = getAllowedScopeForKey(db, req.aiKey);
    const pathMap = buildFolderPathMap(db.folders);
    const folderId = req.query.folderId ? String(req.query.folderId) : null;
    const offlineOnly = req.query.offlineOnly === 'true';

    let result = files;
    if (folderId) {
      result = result.filter((f) => (folderId === 'root' ? !f.folderId : f.folderId === folderId));
    }
    if (offlineOnly) {
      result = result.filter((f) => f.offlinePinned !== false);
    }

    const mapped = result.map((f) => ({
      id: f.id,
      name: f.name,
      folderId: f.folderId,
      folderPath: f.folderId ? pathMap.get(f.folderId) || '/' : '/',
      mimeType: f.mimeType,
      kind: f.kind || 'file',
      size: f.size,
      providerName: f.providerName,
      offlineAvailable: f.offlinePinned !== false,
      hasReadableText: Boolean(f.textContent),
      tags: f.tags || [],
      updatedAt: f.updatedAt,
    }));

    recordAiAudit(db, req.aiKey, 'GET', '/api/v1/ai/files', 200);
    res.json({
      ok: true,
      count: mapped.length,
      files: mapped,
    });
  });

  // GET /api/v1/ai/search?q=...
  router.get('/search', (req, res) => {
    const db = req.cloudyDb;
    const { files } = getAllowedScopeForKey(db, req.aiKey);
    const pathMap = buildFolderPathMap(db.folders);
    const rawQuery = String(req.query.q || '').trim();
    const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = [];
    for (const f of files) {
      const folderPath = f.folderId ? pathMap.get(f.folderId) || '/' : '/';
      const haystackName = `${f.name} ${folderPath} ${(f.tags || []).join(' ')}`.toLowerCase();
      const haystackBody = (f.textContent || '').toLowerCase();

      if (terms.length === 0) {
        scored.push({ file: f, folderPath, score: 1 });
        continue;
      }

      let score = 0;
      for (const t of terms) {
        if (haystackName.includes(t)) score += 5;
        if (haystackBody.includes(t)) score += 2;
      }
      if (score > 0) {
        scored.push({ file: f, folderPath, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, 25).map(({ file, folderPath, score }) => {
      let snippet = (file.textContent || '').slice(0, 600);
      if (terms.length > 0 && file.textContent) {
        const idx = file.textContent.toLowerCase().indexOf(terms[0]);
        if (idx > 60) {
          snippet = '...' + file.textContent.slice(Math.max(0, idx - 60), idx + 540);
        }
      }
      return {
        id: file.id,
        name: file.name,
        folderId: file.folderId,
        folderPath,
        mimeType: file.mimeType,
        size: file.size,
        score,
        snippet,
        readUrl: `/api/v1/ai/files/${file.id}/content`,
      };
    });

    recordAiAudit(db, req.aiKey, 'GET', `/api/v1/ai/search?q=${rawQuery}`, 200);
    res.json({
      ok: true,
      query: rawQuery,
      count: results.length,
      results,
    });
  });

  // GET /api/v1/ai/files/:id/content
  router.get('/files/:id/content', async (req, res) => {
    const db = req.cloudyDb;
    const { files } = getAllowedScopeForKey(db, req.aiKey);
    const pathMap = buildFolderPathMap(db.folders);
    const file = files.find((f) => f.id === req.params.id);

    if (!file) {
      recordAiAudit(db, req.aiKey, 'GET', `/api/v1/ai/files/${req.params.id}/content`, 404);
      return res.status(404).json({
        ok: false,
        error: 'File not found or outside the folder permissions of this API key.',
      });
    }

    let content = file.textContent;
    if (content == null) {
      let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
      if (!buf && (file.remoteId || file.remotePath)) {
        const acc = db.accounts.find((a) => a.id === file.accountId);
        if (acc) {
          buf = await downloadFileFromRemoteProvider(getUnsealedAccount(acc), file, null, null);
          if (buf) writeAccountBinary(file.accountId, file.id, buf);
        }
      }
      if (buf && isLikelyTextMime(file.mimeType, file.name)) {
        content = buf.toString('utf8');
        file.textContent = content;
      }
    }

    recordAiAudit(db, req.aiKey, 'GET', `/api/v1/ai/files/${file.id}/content`, 200);
    res.json({
      ok: true,
      file: {
        id: file.id,
        name: file.name,
        folderId: file.folderId,
        folderPath: file.folderId ? pathMap.get(file.folderId) || '/' : '/',
        mimeType: file.mimeType,
        size: file.size,
        providerName: file.providerName,
        updatedAt: file.updatedAt,
      },
      content: content ?? '[Binary file — fetch /api/v1/ai/files/:id/raw for raw bytes]',
    });
  });

  // GET /api/v1/ai/files/:id/raw
  router.get('/files/:id/raw', async (req, res) => {
    const db = req.cloudyDb;
    const { files } = getAllowedScopeForKey(db, req.aiKey);
    const file = files.find((f) => f.id === req.params.id);
    if (!file) {
      return res.status(404).json({ ok: false, error: 'File not found or not permitted' });
    }
    let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
    if (!buf && typeof file.textContent === 'string') {
      buf = Buffer.from(file.textContent, 'utf8');
    }
    if (!buf && (file.remoteId || file.remotePath)) {
      const acc = db.accounts.find((a) => a.id === file.accountId);
      if (acc) {
        buf = await downloadFileFromRemoteProvider(getUnsealedAccount(acc), file, null, null);
        if (buf) writeAccountBinary(file.accountId, file.id, buf);
      }
    }
    if (!buf) {
      return res.status(404).json({ ok: false, error: 'File binary missing from storage mount' });
    }
    recordAiAudit(db, req.aiKey, 'GET', `/api/v1/ai/files/${file.id}/raw`, 200);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    res.send(buf);
  });

  // POST /api/v1/ai/files (Create/save AI output note when scope === 'read_write')
  router.post('/files', async (req, res) => {
    try {
      const db = req.cloudyDb;
      if (req.aiKey.scope !== 'read_write') {
        recordAiAudit(db, req.aiKey, 'POST', '/api/v1/ai/files', 403);
        return res.status(403).json({
          ok: false,
          error: 'This API key is read-only. Create a key with read_write scope to allow AI file creation.',
        });
      }

      const {
        name,
        content = '',
        folderId = null,
        mimeType = 'text/markdown',
        tags = ['ai-generated'],
      } = req.body || {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ ok: false, error: 'Field "name" is required' });
      }

      const { allowedIds } = getAllowedScopeForKey(db, req.aiKey);
      if (allowedIds && (!folderId || !allowedIds.has(folderId))) {
        return res.status(403).json({
          ok: false,
          error: 'Target folderId is outside the permitted folders for this API key.',
        });
      }

      const buf = Buffer.from(String(content), 'utf8');
      const id = makeId('fil');

      let accountId = 'offline_vault';
      let providerId = 'offline_vault';
      let providerName = 'Offline Vault';
      let mirrorAccountId = null;
      let remoteMeta = null;

      if (db.accounts.length > 0) {
        const { primary, mirror } = selectTargetAccount(db, buf.byteLength, mimeType);
        remoteMeta = await uploadFileToRemoteProvider(
          getUnsealedAccount(primary),
          name.trim(),
          buf,
          mimeType,
          null,
          null
        );
        accountId = primary.id;
        providerId = primary.providerId;
        providerName = primary.providerName;
        mirrorAccountId = mirror ? mirror.id : null;
        if (mirror) writeAccountBinary(mirror.id, id, buf);
      }

      writeAccountBinary(accountId, id, buf);

      const now = new Date().toISOString();
      const newFile = {
        id,
        name: name.trim(),
        folderId: folderId || null,
        mimeType,
        kind: 'note',
        size: buf.byteLength,
        accountId,
        providerId,
        providerName,
        remoteId: remoteMeta?.remoteId || null,
        remotePath: remoteMeta?.remotePath || null,
        webUrl: remoteMeta?.webUrl || null,
        mirrorAccountId,
        offlinePinned: true,
        starred: false,
        trashed: false,
        tags: Array.isArray(tags) ? tags : ['ai-generated'],
        textContent: String(content),
        createdAt: now,
        updatedAt: now,
      };

      db.files.unshift(newFile);
      saveDb(db.vaultId);
      recordAiAudit(db, req.aiKey, 'POST', '/api/v1/ai/files', 201);

      res.status(201).json({
        ok: true,
        file: newFile,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  return router;
}

export function isLikelyTextMime(mime = '', filename = '') {
  const m = (mime || '').toLowerCase();
  if (
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('xml') ||
    m.includes('javascript') ||
    m.includes('typescript') ||
    m.includes('yaml') ||
    m.includes('csv')
  ) {
    return true;
  }
  return /\.(md|txt|json|csv|ts|tsx|js|jsx|py|sh|yml|yaml|html|css|sql|xml|log|ini|env)$/i.test(
    filename || ''
  );
}

/**
 * Streams a standalone zero-dependency Offline Vault + Local Python AI REST Server (.zip)
 * so local offline AI models (Ollama, llama.cpp, LM Studio on PC or Android Termux)
 * can access all synced files & folders completely offline on 127.0.0.1:8765!
 */
export async function streamOfflineAiBundleZip(req, res) {
  const vaultId = req.query.vaultId || req.headers['x-cloudy-vault-id'] || 'default';
  const db = await ensureVaultLoaded(vaultId);
  const archive = archiver('zip', { zlib: { level: 9 } });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Cloudy-Offline-AI-Vault.zip"');
  archive.pipe(res);

  const activeFolders = db.folders.filter((f) => !f.trashed);
  const offlineFiles = db.files.filter((f) => !f.trashed && f.offlinePinned !== false);
  const pathMap = buildFolderPathMap(activeFolders);

  const exportedFilesMeta = [];
  for (const f of offlineFiles) {
    let buf = readAccountBinary(f.accountId, f.id, f.mirrorAccountId);
    if (!buf && typeof f.textContent === 'string') {
      buf = Buffer.from(f.textContent, 'utf8');
    }
    const relBlobPath = `vault/blobs/${f.id}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if (buf) {
      archive.append(buf, { name: relBlobPath });
    }
    exportedFilesMeta.push({
      id: f.id,
      name: f.name,
      folderId: f.folderId,
      folderPath: f.folderId ? pathMap.get(f.folderId) || '/' : '/',
      mimeType: f.mimeType,
      size: f.size,
      tags: f.tags || [],
      textContent: f.textContent || null,
      blobPath: buf ? relBlobPath : null,
      updatedAt: f.updatedAt,
    });
  }

  const vaultManifest = {
    exportedAt: new Date().toISOString(),
    project: 'Cloudy by X-Kilo',
    folders: activeFolders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      path: pathMap.get(f.id) || `/${f.name}`,
    })),
    files: exportedFilesMeta,
    apiKeys: db.apiKeys
      .filter((k) => k.active !== false)
      .map((k) => ({
        name: k.name,
        key: k.key,
        scope: k.scope,
        allowedFolderIds: k.allowedFolderIds || [],
      })),
  };

  archive.append(JSON.stringify(vaultManifest, null, 2), { name: 'vault/manifest.json' });

  const pythonServer = `#!/usr/bin/env python3
"""
Cloudy by X-Kilo — Standalone Offline Local AI REST Server
Zero external dependencies (Python 3 standard library only).
Works 100% offline on Windows, macOS, Linux, and Android Termux!

Usage:
  python3 cloudy_offline_server.py
  # Serves http://127.0.0.1:8765/api/v1/ai/...
"""
import json
import os
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(BASE_DIR, "vault", "manifest.json")

with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
    VAULT = json.load(f)

def allowed_items(key_obj):
    allowed = set(key_obj.get("allowedFolderIds") or [])
    folders = VAULT.get("folders", [])
    files = VAULT.get("files", [])
    if not allowed:
        return folders, files
    changed = True
    while changed:
        changed = False
        for fld in folders:
            if fld.get("parentId") in allowed and fld["id"] not in allowed:
                allowed.add(fld["id"])
                changed = True
    return (
        [f for f in folders if f["id"] in allowed],
        [fl for fl in files if fl.get("folderId") in allowed],
    )

class CloudyOfflineHandler(BaseHTTPRequestHandler):
    def send_json(self, code, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authenticate(self, query):
        auth = self.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else (
            self.headers.get("X-API-Key") or query.get("api_key", [""])[0]
        )
        for k in VAULT.get("apiKeys", []):
            if k["key"] == token:
                return k
        return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        folders, files = allowed_items(key_obj)
        p = parsed.path

        if p == "/api/v1/ai/status":
            return self.send_json(200, {
                "ok": True,
                "mode": "standalone-offline-python",
                "keyName": key_obj["name"],
                "accessibleFolders": len(folders),
                "accessibleFiles": len(files),
            })

        if p == "/api/v1/ai/folders":
            return self.send_json(200, {"ok": True, "count": len(folders), "folders": folders})

        if p == "/api/v1/ai/files":
            folder_id = query.get("folderId", [None])[0]
            filtered = [f for f in files if (not folder_id or f.get("folderId") == folder_id)]
            clean = [{k: v for k, v in f.items() if k != "textContent"} for f in filtered]
            return self.send_json(200, {"ok": True, "count": len(clean), "files": clean})

        if p == "/api/v1/ai/search":
            q = (query.get("q", [""])[0] or "").lower().strip()
            hits = []
            for f in files:
                hay = f"{f.get('name','')} {f.get('folderPath','')} {f.get('textContent','')}".lower()
                if not q or q in hay:
                    hits.append({
                        "id": f["id"],
                        "name": f["name"],
                        "folderPath": f.get("folderPath", "/"),
                        "snippet": (f.get("textContent") or "")[:500],
                    })
            return self.send_json(200, {"ok": True, "query": q, "count": len(hits), "results": hits})

        if p.startswith("/api/v1/ai/files/") and p.endswith("/content"):
            file_id = p.split("/")[5]
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})
            return self.send_json(200, {"ok": True, "file": target["name"], "content": target.get("textContent") or ""})

        return self.send_json(404, {"ok": False, "error": "Unknown endpoint"})

if __name__ == "__main__":
    port = int(os.environ.get("CLOUDY_OFFLINE_PORT", "8765"))
    print(f"☁️  Cloudy Offline AI Vault listening on http://127.0.0.1:{port}")
    HTTPServer(("127.0.0.1", port), CloudyOfflineHandler).serve_forever()
`;

  const sampleKey = vaultManifest.apiKeys[0]?.key || 'cldy_sk_YOUR_KEY';
  const ollamaExample = `#!/usr/bin/env python3
"""
Example: Connect Local Offline Ollama Model (e.g. llama3.2) to Cloudy Offline Files
"""
import json
import urllib.request

CLOUDY_URL = "http://127.0.0.1:8765"
CLOUDY_API_KEY = "${sampleKey}"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "llama3.2"

def cloudy_get(path):
    req = urllib.request.Request(
        f"{CLOUDY_URL}{path}",
        headers={"Authorization": f"Bearer {CLOUDY_API_KEY}"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

if __name__ == "__main__":
    search = cloudy_get("/api/v1/ai/search?q=Cloudy")
    context_blocks = []
    for item in search.get("results", [])[:3]:
        detail = cloudy_get(f"/api/v1/ai/files/{item['id']}/content")
        context_blocks.append(f"### File: {item['folderPath']}/{item['name']}\\n{detail.get('content', '')}")

    prompt = "Using these offline Cloudy files:\\n\\n" + "\\n\\n".join(context_blocks) + "\\n\\nQuestion: Summarize my stored notes."
    print("Loaded", len(context_blocks), "offline files from Cloudy! Sending to local Ollama...")
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps({"model": MODEL, "prompt": prompt, "stream": False}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        print(json.loads(resp.read().decode("utf-8")).get("response"))
`;

  archive.append(pythonServer, { name: 'cloudy_offline_server.py', mode: 0o755 });
  archive.append(ollamaExample, { name: 'ask_local_ollama.py', mode: 0o755 });
  archive.finalize();
}
