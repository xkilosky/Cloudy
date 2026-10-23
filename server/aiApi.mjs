import express from 'express';
import archiver from 'archiver';
import {
  ensureVaultLoaded,
  saveDb,
  findDbByApiKeyAsync,
  getUnsealedAccount,
  isGenuineVerifiedAccount,
  readAccountBinary,
  writeAccountBinary,
  selectTargetAccount,
  makeId,
} from './store.mjs';
import {
  downloadFileFromRemoteProvider,
  uploadFileToRemoteProvider,
  sealCredentials,
} from './cloudAdapters.mjs';

function getOAuthConfigForProvider(db, providerId) {
  const envClientId = process.env[`${providerId.toUpperCase()}_CLIENT_ID`];
  const envSecret = process.env[`${providerId.toUpperCase()}_CLIENT_SECRET`];
  if (envClientId) {
    return { clientId: envClientId, clientSecret: envSecret || '' };
  }
  return db.oauthApps?.[providerId] || null;
}

function makeTokenUpdateHandler(db, account) {
  return (newCreds) => {
    account.sealedCredentials = sealCredentials(newCreds);
    saveDb(db.vaultId);
  };
}

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
    return { folders: activeFolders, files: activeFiles, allowedIds: null };
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

async function resolveFileBinaryBuffer(db, file) {
  let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  if (!buf && typeof file.textContent === 'string') {
    buf = Buffer.from(file.textContent, 'utf8');
  }
  if (!buf && (file.remoteId || file.remotePath)) {
    const acc = db.accounts.find((a) => a.id === file.accountId);
    if (acc && isGenuineVerifiedAccount(acc)) {
      buf = await downloadFileFromRemoteProvider(
        getUnsealedAccount(acc),
        file,
        (pid) => getOAuthConfigForProvider(db, pid),
        makeTokenUpdateHandler(db, acc)
      );
      if (buf) writeAccountBinary(file.accountId, file.id, buf);
    }
  }
  return buf;
}

export function createAiRouter() {
  const router = express.Router();

  // Middleware: Authenticate Cloudy AI API Key (Bearer cldy_sk_... or X-API-Key)
  router.use(async (req, res, next) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
      mode: 'online-cloud',
      autoSyncSupported: true,
      keyName: req.aiKey.name,
      scope: req.aiKey.scope,
      restrictedToFolders: Boolean(req.aiKey.allowedFolderIds?.length),
      accessibleFolders: folders.length,
      accessibleFiles: files.length,
      offlinePinnedFiles: files.filter((f) => f.offlinePinned !== false).length,
    });
  });

  // GET /api/v1/ai/sync-manifest — Live delta-sync snapshot for Local Offline AI Servers & Agents
  router.get('/sync-manifest', async (req, res) => {
    try {
      const db = req.cloudyDb;
      const { folders, files } = getAllowedScopeForKey(db, req.aiKey);
      const pathMap = buildFolderPathMap(db.folders);

      const syncedFiles = [];
      for (const f of files) {
        let textContent = f.textContent ?? null;
        if (
          textContent == null &&
          isLikelyTextMime(f.mimeType, f.name) &&
          (f.size || 0) <= 2 * 1024 * 1024
        ) {
          try {
            const buf = await resolveFileBinaryBuffer(db, f);
            if (buf) {
              textContent = buf.toString('utf8');
              f.textContent = textContent;
            }
          } catch {
            // Keep null if remote provider temporarily unreachable
          }
        }

        syncedFiles.push({
          id: f.id,
          name: f.name,
          folderId: f.folderId || null,
          folderPath: f.folderId ? pathMap.get(f.folderId) || '/' : '/',
          mimeType: f.mimeType || 'application/octet-stream',
          kind: f.kind || 'file',
          size: f.size || 0,
          providerName: f.providerName || 'Cloud',
          offlinePinned: f.offlinePinned !== false,
          tags: f.tags || [],
          textContent,
          rawUrl: `/api/v1/ai/files/${f.id}/raw`,
          updatedAt: f.updatedAt || f.createdAt,
        });
      }

      const syncedFolders = folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId || null,
        path: pathMap.get(f.id) || `/${f.name}`,
        offlinePinned: f.offlinePinned !== false,
        updatedAt: f.updatedAt || f.createdAt,
      }));

      res.json({
        ok: true,
        syncedAt: new Date().toISOString(),
        key: {
          id: req.aiKey.id,
          name: req.aiKey.name,
          scope: req.aiKey.scope,
          allowedFolderIds: req.aiKey.allowedFolderIds || [],
        },
        folders: syncedFolders,
        files: syncedFiles,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
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
      const buf = await resolveFileBinaryBuffer(db, file);
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
    const buf = await resolveFileBinaryBuffer(db, file);
    if (!buf) {
      return res.status(404).json({ ok: false, error: 'File binary missing from storage mount' });
    }
    recordAiAudit(db, req.aiKey, 'GET', `/api/v1/ai/files/${file.id}/raw`, 200);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    res.send(buf);
  });

  // POST /api/v1/ai/files (Create or idempotent sync of AI output file when scope === 'read_write')
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
        id: clientId,
        name,
        content = '',
        base64Content = null,
        folderId = null,
        mimeType = 'text/markdown',
        kind = 'note',
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

      const buf =
        typeof base64Content === 'string' && base64Content.length > 0
          ? Buffer.from(base64Content, 'base64')
          : Buffer.from(String(content), 'utf8');

      const id =
        typeof clientId === 'string' && clientId.startsWith('fil_')
          ? clientId
          : makeId('fil');

      let accountId = 'offline_vault';
      let providerId = 'offline_vault';
      let providerName = 'Offline Vault';
      let mirrorAccountId = null;
      let remoteMeta = null;

      if (db.accounts.some((a) => a.status === 'connected' && isGenuineVerifiedAccount(a))) {
        const { primary, mirror } = selectTargetAccount(db, buf.byteLength, mimeType);
        remoteMeta = await uploadFileToRemoteProvider(
          getUnsealedAccount(primary),
          name.trim(),
          buf,
          mimeType,
          (pid) => getOAuthConfigForProvider(db, pid),
          makeTokenUpdateHandler(db, primary)
        );
        accountId = primary.id;
        providerId = primary.providerId;
        providerName = primary.providerName;
        mirrorAccountId = mirror ? mirror.id : null;
        if (mirror) writeAccountBinary(mirror.id, id, buf);
      }

      writeAccountBinary(accountId, id, buf);

      const now = new Date().toISOString();
      const textContent =
        typeof base64Content === 'string' && base64Content.length > 0
          ? isLikelyTextMime(mimeType, name) && buf.byteLength <= 2 * 1024 * 1024
            ? buf.toString('utf8')
            : null
          : String(content);

      const newFile = {
        id,
        name: name.trim(),
        folderId: folderId || null,
        mimeType,
        kind: kind === 'file' || kind === 'dataset' ? kind : 'note',
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
        textContent,
        createdAt: now,
        updatedAt: now,
      };

      const existingIdx = db.files.findIndex((f) => f.id === id);
      if (existingIdx >= 0) {
        db.files[existingIdx] = {
          ...db.files[existingIdx],
          ...newFile,
          createdAt: db.files[existingIdx].createdAt || now,
        };
      } else {
        db.files.unshift(newFile);
      }

      saveDb(db.vaultId);
      recordAiAudit(db, req.aiKey, 'POST', '/api/v1/ai/files', 201);

      res.status(201).json({
        ok: true,
        file: existingIdx >= 0 ? db.files[existingIdx] : newFile,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  // PATCH /api/v1/ai/files/:id (Update file content/metadata from AI skill or offline sync queue)
  router.patch('/files/:id', async (req, res) => {
    try {
      const db = req.cloudyDb;
      if (req.aiKey.scope !== 'read_write') {
        recordAiAudit(db, req.aiKey, 'PATCH', `/api/v1/ai/files/${req.params.id}`, 403);
        return res.status(403).json({
          ok: false,
          error: 'This API key is read-only. Create a key with read_write scope to update files.',
        });
      }

      const { files, allowedIds } = getAllowedScopeForKey(db, req.aiKey);
      const file = files.find((f) => f.id === req.params.id);
      if (!file) {
        return res.status(404).json({
          ok: false,
          error: 'File not found or outside the folder permissions of this API key.',
        });
      }

      const { name, folderId, tags, content, textContent, base64Content } = req.body || {};

      if (folderId !== undefined) {
        if (allowedIds && (!folderId || !allowedIds.has(folderId))) {
          return res.status(403).json({
            ok: false,
            error: 'Target folderId is outside the permitted folders for this API key.',
          });
        }
        file.folderId = folderId || null;
      }

      if (typeof name === 'string' && name.trim()) {
        file.name = name.trim();
      }
      if (Array.isArray(tags)) {
        file.tags = tags;
      }

      const nextText =
        typeof content === 'string'
          ? content
          : typeof textContent === 'string'
            ? textContent
            : null;

      if (nextText !== null || (typeof base64Content === 'string' && base64Content.length > 0)) {
        const buf =
          typeof base64Content === 'string' && base64Content.length > 0
            ? Buffer.from(base64Content, 'base64')
            : Buffer.from(nextText, 'utf8');

        writeAccountBinary(file.accountId, file.id, buf);
        file.size = buf.byteLength;
        file.textContent =
          nextText !== null
            ? nextText
            : isLikelyTextMime(file.mimeType, file.name) && buf.byteLength <= 2 * 1024 * 1024
              ? buf.toString('utf8')
              : null;

        const owningAcc = db.accounts.find((a) => a.id === file.accountId);
        if (owningAcc && isGenuineVerifiedAccount(owningAcc)) {
          const remoteMeta = await uploadFileToRemoteProvider(
            getUnsealedAccount(owningAcc),
            file.name,
            buf,
            file.mimeType || 'text/plain',
            (pid) => getOAuthConfigForProvider(db, pid),
            makeTokenUpdateHandler(db, owningAcc)
          );
          if (remoteMeta) {
            file.remoteId = remoteMeta.remoteId || file.remoteId;
            file.remotePath = remoteMeta.remotePath || file.remotePath;
            file.webUrl = remoteMeta.webUrl || file.webUrl;
          }
        }
      }

      file.updatedAt = new Date().toISOString();
      saveDb(db.vaultId);
      recordAiAudit(db, req.aiKey, 'PATCH', `/api/v1/ai/files/${file.id}`, 200);

      res.json({ ok: true, file });
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

function resolveRequestOrigin(req) {
  if (process.env.CLOUDY_PUBLIC_URL) {
    return String(process.env.CLOUDY_PUBLIC_URL).replace(/\/+$/, '');
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

/**
 * Streams a standalone zero-dependency Offline Vault + Live Auto-Syncing Local Python AI Server (.zip)
 * so local offline AI models (Ollama, Qwen, DeepSeek, llama.cpp, LM Studio on PC or Android Termux)
 * can read/write files 100% offline on 127.0.0.1:8765 AND auto-sync live whenever internet is available!
 */
export async function streamOfflineAiBundleZip(req, res) {
  const vaultId = req.query.vaultId || req.headers['x-cloudy-vault-id'] || 'default';
  const db = await ensureVaultLoaded(vaultId);
  const cloudOrigin = resolveRequestOrigin(req);

  const archive = archiver('zip', { zlib: { level: 9 } });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Cloudy-Offline-AI-Vault.zip"');
  archive.pipe(res);

  const activeFolders = db.folders.filter((f) => !f.trashed);
  const offlineFiles = db.files.filter((f) => !f.trashed && f.offlinePinned !== false);
  const pathMap = buildFolderPathMap(activeFolders);

  const exportedFilesMeta = [];
  for (const f of offlineFiles) {
    let buf = null;
    if ((f.size || 0) <= 15 * 1024 * 1024) {
      try {
        buf = await resolveFileBinaryBuffer(db, f);
      } catch {
        // Fallback to textContent if remote temporarily unreachable
      }
    }
    if (!buf && typeof f.textContent === 'string') {
      buf = Buffer.from(f.textContent, 'utf8');
    }

    const safeName = (f.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const relBlobPath = `vault/blobs/${f.id}_${safeName}`;
    if (buf) {
      archive.append(buf, { name: relBlobPath });
    }

    exportedFilesMeta.push({
      id: f.id,
      name: f.name,
      folderId: f.folderId || null,
      folderPath: f.folderId ? pathMap.get(f.folderId) || '/' : '/',
      mimeType: f.mimeType || 'application/octet-stream',
      kind: f.kind || 'file',
      size: f.size || (buf ? buf.byteLength : 0),
      providerName: f.providerName || 'Cloud',
      tags: f.tags || [],
      textContent:
        f.textContent ??
        (buf && isLikelyTextMime(f.mimeType, f.name) && buf.byteLength <= 2 * 1024 * 1024
          ? buf.toString('utf8')
          : null),
      blobPath: buf ? relBlobPath : null,
      updatedAt: f.updatedAt || f.createdAt,
    });
  }

  const nowIso = new Date().toISOString();
  const vaultManifest = {
    exportedAt: nowIso,
    lastSyncedAt: nowIso,
    cloudOrigin,
    project: 'Cloudy by X-Kilo',
    folders: activeFolders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId || null,
      path: pathMap.get(f.id) || `/${f.name}`,
      updatedAt: f.updatedAt || f.createdAt,
    })),
    files: exportedFilesMeta,
    apiKeys: db.apiKeys
      .filter((k) => k.active !== false)
      .map((k) => ({
        id: k.id,
        name: k.name,
        key: k.key,
        scope: k.scope,
        allowedFolderIds: k.allowedFolderIds || [],
      })),
  };

  archive.append(JSON.stringify(vaultManifest, null, 2), { name: 'vault/manifest.json' });
  archive.append(JSON.stringify([], null, 2), { name: 'vault/pending_queue.json' });

  const pythonServer = `#!/usr/bin/env python3
"""
Cloudy by X-Kilo — Standalone Offline Local AI REST Server + Live Auto-Sync Daemon
Zero external dependencies (Python 3 standard library only).
Works 100% offline on Windows, macOS, Linux, and Android Termux — and AUTOMATICALLY
syncs new/updated files, folders, and offline AI writes whenever internet is available!

Usage:
  python3 cloudy_offline_server.py
  # Serves http://127.0.0.1:8765/api/v1/ai/...

Optional Environment Overrides:
  CLOUDY_OFFLINE_PORT=8765
  CLOUDY_REMOTE_URL=${cloudOrigin}
  CLOUDY_SYNC_INTERVAL=15
"""
import base64
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VAULT_DIR = os.path.join(BASE_DIR, "vault")
BLOBS_DIR = os.path.join(VAULT_DIR, "blobs")
MANIFEST_PATH = os.path.join(VAULT_DIR, "manifest.json")
QUEUE_PATH = os.path.join(VAULT_DIR, "pending_queue.json")

os.makedirs(BLOBS_DIR, exist_ok=True)

LOCK = threading.RLock()
MAX_AUTO_BLOB_BYTES = 25 * 1024 * 1024  # Auto-cache files up to 25 MB for instant offline reads

with open(MANIFEST_PATH, "r", encoding="utf-8") as _f:
    VAULT = json.load(_f)

if os.path.exists(QUEUE_PATH):
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as _qf:
            PENDING_QUEUE = json.load(_qf)
    except Exception:
        PENDING_QUEUE = []
else:
    PENDING_QUEUE = []

CLOUD_ORIGIN = os.environ.get(
    "CLOUDY_REMOTE_URL",
    VAULT.get("cloudOrigin") or "${cloudOrigin}"
).rstrip("/")
SYNC_INTERVAL = max(5, int(os.environ.get("CLOUDY_SYNC_INTERVAL", "15")))

SYNC_STATE = {
    "online": False,
    "syncing": False,
    "lastSyncedAt": VAULT.get("lastSyncedAt"),
    "lastAttemptAt": None,
    "lastError": None,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_filename(name):
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name or "file")


def is_text_like(mime="", filename=""):
    m = (mime or "").lower()
    if (
        m.startswith("text/")
        or "json" in m
        or "xml" in m
        or "javascript" in m
        or "typescript" in m
        or "yaml" in m
        or "csv" in m
    ):
        return True
    return bool(
        re.search(
            r"\\.(md|txt|json|csv|ts|tsx|js|jsx|py|sh|yml|yaml|html|css|sql|xml|log|ini|env)$",
            filename or "",
            re.IGNORECASE,
        )
    )


def save_json_atomic(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def persist_local_state():
    with LOCK:
        save_json_atomic(MANIFEST_PATH, VAULT)
        save_json_atomic(QUEUE_PATH, PENDING_QUEUE)


def allowed_items(key_obj):
    with LOCK:
        allowed = set(key_obj.get("allowedFolderIds") or [])
        folders = list(VAULT.get("folders", []))
        files = list(VAULT.get("files", []))
    if not allowed:
        return folders, files, None
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
        allowed,
    )


def remote_request(method, path, api_key, json_body=None, timeout=8):
    url = f"{CLOUD_ORIGIN}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "Cloudy-Offline-AI-Sync/2.0",
    }
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        ctype = resp.headers.get("Content-Type", "")
        if "application/json" in ctype:
            return resp.status, json.loads(raw.decode("utf-8"))
        return resp.status, raw


def sync_with_cloud_once():
    """
    Pushes any queued offline AI file creates/edits to Cloudy when internet is available,
    then pulls the latest folders, files, text content, and updated binary blobs to local disk!
    """
    if not CLOUD_ORIGIN:
        return {"ok": False, "online": False, "reason": "No cloudOrigin configured"}

    with LOCK:
        if SYNC_STATE["syncing"]:
            return {"ok": True, "online": SYNC_STATE["online"], "skipped": "already_syncing"}
        SYNC_STATE["syncing"] = True
        SYNC_STATE["lastAttemptAt"] = now_iso()
        keys = list(VAULT.get("apiKeys") or [])
        queue_snapshot = list(PENDING_QUEUE)

    if not keys:
        with LOCK:
            SYNC_STATE["syncing"] = False
        return {"ok": False, "online": False, "reason": "No API keys in manifest"}

    pushed_count = 0
    downloaded_blobs = 0

    try:
        # 1. Push queued offline creates/edits first if we have a read_write key
        rw_key = next((k["key"] for k in keys if k.get("scope") == "read_write"), keys[0]["key"])
        synced_queue_ids = set()

        for item in queue_snapshot:
            q_key = item.get("apiKey") or rw_key
            q_type = item.get("type")
            payload = item.get("payload") or {}
            try:
                if q_type == "create_file":
                    status, _ = remote_request("POST", "/api/v1/ai/files", q_key, payload, timeout=15)
                    if 200 <= status < 300:
                        synced_queue_ids.add(item["id"])
                        pushed_count += 1
                elif q_type == "update_file":
                    fid = payload.get("fileId")
                    body = {k: v for k, v in payload.items() if k != "fileId"}
                    status, _ = remote_request("PATCH", f"/api/v1/ai/files/{fid}", q_key, body, timeout=15)
                    if 200 <= status < 300 or status == 404:
                        synced_queue_ids.add(item["id"])
                        pushed_count += 1
            except urllib.error.HTTPError as he:
                # Permanent client validation error (400/403) should not block the queue forever
                if he.code in (400, 403):
                    synced_queue_ids.add(item["id"])
                else:
                    raise

        if synced_queue_ids:
            with LOCK:
                PENDING_QUEUE[:] = [q for q in PENDING_QUEUE if q.get("id") not in synced_queue_ids]
                save_json_atomic(QUEUE_PATH, PENDING_QUEUE)

        # 2. Pull live sync-manifest across configured keys so all permitted folders/files stay fresh
        merged_folders = {}
        merged_files = {}
        key_for_file = {}
        reachable = False

        for k_obj in keys:
            k_token = k_obj.get("key")
            if not k_token:
                continue
            try:
                status, data = remote_request("GET", "/api/v1/ai/sync-manifest", k_token, timeout=10)
                if status == 200 and isinstance(data, dict) and data.get("ok"):
                    reachable = True
                    if isinstance(data.get("key"), dict):
                        k_obj["scope"] = data["key"].get("scope", k_obj.get("scope", "read"))
                        k_obj["allowedFolderIds"] = data["key"].get("allowedFolderIds", k_obj.get("allowedFolderIds", []))
                    for fld in data.get("folders", []):
                        merged_folders[fld["id"]] = fld
                    for fl in data.get("files", []):
                        merged_files[fl["id"]] = fl
                        key_for_file[fl["id"]] = k_token
            except urllib.error.HTTPError as he:
                if he.code in (401, 403):
                    continue
                raise

        if not reachable:
            raise ConnectionError("Unable to reach Cloudy sync-manifest with configured API keys")

        with LOCK:
            existing_by_id = {f["id"]: f for f in VAULT.get("files", [])}
            unsynced_file_ids = {
                (q.get("payload") or {}).get("id") or (q.get("payload") or {}).get("fileId")
                for q in PENDING_QUEUE
            }

        # 3. Download new or changed file blobs so /raw and /content work 100% offline anytime
        final_files = []
        for fid, remote_f in merged_files.items():
            prev = existing_by_id.get(fid)
            rel_blob = f"vault/blobs/{fid}_{safe_filename(remote_f.get('name'))}"
            abs_blob = os.path.join(BASE_DIR, rel_blob)

            prev_blob_rel = prev.get("blobPath") if prev else None
            prev_blob_abs = os.path.join(BASE_DIR, prev_blob_rel) if prev_blob_rel else None
            same_version = bool(
                prev
                and prev.get("updatedAt") == remote_f.get("updatedAt")
                and prev_blob_abs
                and os.path.exists(prev_blob_abs)
            )

            blob_saved_rel = prev_blob_rel if same_version else None

            if not same_version and (remote_f.get("size") or 0) <= MAX_AUTO_BLOB_BYTES:
                if isinstance(remote_f.get("textContent"), str):
                    with open(abs_blob, "wb") as bf:
                        bf.write(remote_f["textContent"].encode("utf-8"))
                    blob_saved_rel = rel_blob
                    downloaded_blobs += 1
                else:
                    try:
                        st, raw_bytes = remote_request(
                            "GET",
                            f"/api/v1/ai/files/{fid}/raw",
                            key_for_file[fid],
                            timeout=25,
                        )
                        if st == 200 and isinstance(raw_bytes, (bytes, bytearray)):
                            with open(abs_blob, "wb") as bf:
                                bf.write(raw_bytes)
                            blob_saved_rel = rel_blob
                            downloaded_blobs += 1
                    except Exception:
                        if prev_blob_abs and os.path.exists(prev_blob_abs):
                            blob_saved_rel = prev_blob_rel

            entry = dict(remote_f)
            entry["blobPath"] = blob_saved_rel
            final_files.append(entry)

        # Preserve any local offline files still waiting in PENDING_QUEUE
        for fid, local_f in existing_by_id.items():
            if fid not in merged_files and fid in unsynced_file_ids:
                final_files.insert(0, local_f)

        synced_ts = now_iso()
        with LOCK:
            VAULT["folders"] = list(merged_folders.values())
            VAULT["files"] = final_files
            VAULT["lastSyncedAt"] = synced_ts
            SYNC_STATE["online"] = True
            SYNC_STATE["lastSyncedAt"] = synced_ts
            SYNC_STATE["lastError"] = None
            persist_local_state()

        return {
            "ok": True,
            "online": True,
            "pushedCount": pushed_count,
            "pulledFilesCount": len(final_files),
            "downloadedBlobsCount": downloaded_blobs,
            "lastSyncedAt": synced_ts,
        }

    except Exception as exc:
        with LOCK:
            SYNC_STATE["online"] = False
            SYNC_STATE["lastError"] = str(exc)
        return {
            "ok": False,
            "online": False,
            "error": str(exc),
            "lastSyncedAt": SYNC_STATE["lastSyncedAt"],
        }
    finally:
        with LOCK:
            SYNC_STATE["syncing"] = False


def auto_sync_daemon():
    while True:
        sync_with_cloud_once()
        time.sleep(SYNC_INTERVAL)


class CloudyOfflineHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Clean concise logs
        pass

    def send_json(self, code, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def authenticate(self, query):
        auth = self.headers.get("Authorization", "")
        token = (
            auth[7:].strip()
            if auth.startswith("Bearer ")
            else (self.headers.get("X-API-Key") or query.get("api_key", [""])[0] or "").strip()
        )
        with LOCK:
            for k in VAULT.get("apiKeys", []):
                if k.get("key") == token:
                    return k
        return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        folders, files, _ = allowed_items(key_obj)
        p = parsed.path

        if p == "/api/v1/ai/status":
            with LOCK:
                q_len = len(PENDING_QUEUE)
                st = dict(SYNC_STATE)
            return self.send_json(
                200,
                {
                    "ok": True,
                    "mode": "local-ai-server-auto-sync",
                    "onlineSyncConnected": st["online"],
                    "cloudOrigin": CLOUD_ORIGIN,
                    "autoSyncIntervalSec": SYNC_INTERVAL,
                    "lastSyncedAt": st["lastSyncedAt"],
                    "pendingOfflineQueue": q_len,
                    "keyName": key_obj["name"],
                    "scope": key_obj.get("scope", "read"),
                    "accessibleFolders": len(folders),
                    "accessibleFiles": len(files),
                },
            )

        if p == "/api/v1/ai/folders":
            return self.send_json(200, {"ok": True, "count": len(folders), "folders": folders})

        if p == "/api/v1/ai/files":
            folder_id = query.get("folderId", [None])[0]
            filtered = [
                f
                for f in files
                if (
                    not folder_id
                    or (folder_id == "root" and not f.get("folderId"))
                    or f.get("folderId") == folder_id
                )
            ]
            clean = [{k: v for k, v in f.items() if k not in ("textContent", "blobPath")} for f in filtered]
            return self.send_json(200, {"ok": True, "count": len(clean), "files": clean})

        if p == "/api/v1/ai/search":
            q = (query.get("q", [""])[0] or "").lower().strip()
            terms = [t for t in q.split() if t]
            scored = []
            for f in files:
                name_hay = f"{f.get('name','')} {f.get('folderPath','')} {' '.join(f.get('tags') or [])}".lower()
                body_hay = (f.get("textContent") or "").lower()
                if not terms:
                    scored.append((1, f))
                    continue
                sc = sum((5 if t in name_hay else 0) + (2 if t in body_hay else 0) for t in terms)
                if sc > 0:
                    scored.append((sc, f))
            scored.sort(key=lambda pair: pair[0], reverse=True)
            results = [
                {
                    "id": f["id"],
                    "name": f["name"],
                    "folderId": f.get("folderId"),
                    "folderPath": f.get("folderPath", "/"),
                    "mimeType": f.get("mimeType"),
                    "size": f.get("size", 0),
                    "score": sc,
                    "snippet": (f.get("textContent") or "")[:600],
                    "readUrl": f"/api/v1/ai/files/{f['id']}/content",
                }
                for sc, f in scored[:25]
            ]
            return self.send_json(200, {"ok": True, "query": q, "count": len(results), "results": results})

        if p.startswith("/api/v1/ai/files/") and p.endswith("/content"):
            file_id = urllib.parse.unquote(p.split("/")[5])
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            content = target.get("textContent")
            if content is None and target.get("blobPath"):
                abs_b = os.path.join(BASE_DIR, target["blobPath"])
                if os.path.exists(abs_b) and is_text_like(target.get("mimeType"), target.get("name")):
                    with open(abs_b, "rb") as bf:
                        content = bf.read().decode("utf-8", errors="replace")

            return self.send_json(
                200,
                {
                    "ok": True,
                    "file": {
                        "id": target["id"],
                        "name": target["name"],
                        "folderId": target.get("folderId"),
                        "folderPath": target.get("folderPath", "/"),
                        "mimeType": target.get("mimeType"),
                        "size": target.get("size", 0),
                        "updatedAt": target.get("updatedAt"),
                    },
                    "content": content
                    if content is not None
                    else "[Binary file — fetch /api/v1/ai/files/:id/raw for raw bytes]",
                },
            )

        if p.startswith("/api/v1/ai/files/") and p.endswith("/raw"):
            file_id = urllib.parse.unquote(p.split("/")[5])
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            raw_bytes = None
            if target.get("blobPath"):
                abs_b = os.path.join(BASE_DIR, target["blobPath"])
                if os.path.exists(abs_b):
                    with open(abs_b, "rb") as bf:
                        raw_bytes = bf.read()
            if raw_bytes is None and isinstance(target.get("textContent"), str):
                raw_bytes = target["textContent"].encode("utf-8")
            if raw_bytes is None:
                return self.send_json(404, {"ok": False, "error": "Binary blob not cached locally yet"})

            self.send_response(200)
            self.send_header("Content-Type", target.get("mimeType") or "application/octet-stream")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(raw_bytes)))
            self.end_headers()
            self.wfile.write(raw_bytes)
            return

        return self.send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        p = parsed.path

        # Manual on-demand live sync trigger
        if p == "/api/v1/ai/sync":
            result = sync_with_cloud_once()
            return self.send_json(200, result)

        if p == "/api/v1/ai/files":
            if key_obj.get("scope") != "read_write":
                return self.send_json(403, {"ok": False, "error": "API key is read-only; read_write scope required"})

            body = self.read_json_body()
            name = (body.get("name") or "").strip()
            if not name:
                return self.send_json(400, {"ok": False, "error": 'Field "name" is required'})

            folder_id = body.get("folderId")
            folders, _, allowed = allowed_items(key_obj)
            if allowed is not None and (not folder_id or folder_id not in allowed):
                return self.send_json(403, {"ok": False, "error": "Target folderId is outside permitted folders"})

            fid = body.get("id") if str(body.get("id", "")).startswith("fil_") else f"fil_{secrets.token_hex(6)}"
            mime = body.get("mimeType") or "text/markdown"
            tags = body.get("tags") if isinstance(body.get("tags"), list) else ["ai-generated"]
            b64 = body.get("base64Content")
            content_str = str(body.get("content", ""))

            raw_bytes = base64.b64decode(b64) if b64 else content_str.encode("utf-8")
            rel_blob = f"vault/blobs/{fid}_{safe_filename(name)}"
            with open(os.path.join(BASE_DIR, rel_blob), "wb") as bf:
                bf.write(raw_bytes)

            folder_path = next((fl.get("path", "/") for fl in folders if fl["id"] == folder_id), "/") if folder_id else "/"
            ts = now_iso()
            record = {
                "id": fid,
                "name": name,
                "folderId": folder_id,
                "folderPath": folder_path,
                "mimeType": mime,
                "kind": "note",
                "size": len(raw_bytes),
                "providerName": "Offline Vault (Pending Sync)",
                "tags": tags,
                "textContent": raw_bytes.decode("utf-8", errors="replace") if is_text_like(mime, name) else None,
                "blobPath": rel_blob,
                "updatedAt": ts,
            }

            sync_payload = {
                "id": fid,
                "name": name,
                "content": content_str,
                "base64Content": b64,
                "folderId": folder_id,
                "mimeType": mime,
                "tags": tags,
            }

            pushed_live = False
            try:
                st, remote_res = remote_request("POST", "/api/v1/ai/files", key_obj["key"], sync_payload, timeout=10)
                if 200 <= st < 300 and isinstance(remote_res, dict) and remote_res.get("file"):
                    rf = remote_res["file"]
                    record["providerName"] = rf.get("providerName", "Cloud")
                    record["updatedAt"] = rf.get("updatedAt", ts)
                    pushed_live = True
                    with LOCK:
                        SYNC_STATE["online"] = True
                        SYNC_STATE["lastSyncedAt"] = now_iso()
            except Exception:
                pushed_live = False

            with LOCK:
                VAULT["files"] = [record] + [f for f in VAULT.get("files", []) if f["id"] != fid]
                if not pushed_live:
                    PENDING_QUEUE.append(
                        {
                            "id": f"q_{int(time.time()*1000)}_{fid}",
                            "type": "create_file",
                            "apiKey": key_obj["key"],
                            "payload": sync_payload,
                            "createdAt": ts,
                        }
                    )
                persist_local_state()

            return self.send_json(201, {"ok": True, "syncedLive": pushed_live, "file": record})

        return self.send_json(404, {"ok": False, "error": "Unknown POST endpoint"})

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        p = parsed.path
        if p.startswith("/api/v1/ai/files/"):
            if key_obj.get("scope") != "read_write":
                return self.send_json(403, {"ok": False, "error": "API key is read-only; read_write scope required"})

            file_id = urllib.parse.unquote(p.split("/")[5])
            _, files, allowed = allowed_items(key_obj)
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            body = self.read_json_body()
            if "folderId" in body and allowed is not None and body["folderId"] not in allowed:
                return self.send_json(403, {"ok": False, "error": "Target folderId is outside permitted folders"})

            ts = now_iso()
            with LOCK:
                stored = next((f for f in VAULT.get("files", []) if f["id"] == file_id), None)
                if not stored:
                    return self.send_json(404, {"ok": False, "error": "File missing"})
                if isinstance(body.get("name"), str) and body["name"].strip():
                    stored["name"] = body["name"].strip()
                if "folderId" in body:
                    stored["folderId"] = body["folderId"]
                if isinstance(body.get("tags"), list):
                    stored["tags"] = body["tags"]

                next_text = body.get("content") if isinstance(body.get("content"), str) else body.get("textContent")
                if isinstance(next_text, str):
                    raw_bytes = next_text.encode("utf-8")
                    rel_blob = stored.get("blobPath") or f"vault/blobs/{file_id}_{safe_filename(stored['name'])}"
                    with open(os.path.join(BASE_DIR, rel_blob), "wb") as bf:
                        bf.write(raw_bytes)
                    stored["blobPath"] = rel_blob
                    stored["textContent"] = next_text
                    stored["size"] = len(raw_bytes)

                stored["updatedAt"] = ts
                snapshot_file = dict(stored)

            pushed_live = False
            try:
                st, _ = remote_request("PATCH", f"/api/v1/ai/files/{file_id}", key_obj["key"], body, timeout=10)
                if 200 <= st < 300:
                    pushed_live = True
                    with LOCK:
                        SYNC_STATE["online"] = True
                        SYNC_STATE["lastSyncedAt"] = now_iso()
            except Exception:
                pushed_live = False

            with LOCK:
                if not pushed_live:
                    PENDING_QUEUE.append(
                        {
                            "id": f"q_{int(time.time()*1000)}_{file_id}",
                            "type": "update_file",
                            "apiKey": key_obj["key"],
                            "payload": {"fileId": file_id, **body},
                            "createdAt": ts,
                        }
                    )
                persist_local_state()

            return self.send_json(200, {"ok": True, "syncedLive": pushed_live, "file": snapshot_file})

        return self.send_json(404, {"ok": False, "error": "Unknown PATCH endpoint"})


if __name__ == "__main__":
    port = int(os.environ.get("CLOUDY_OFFLINE_PORT", "8765"))
    sync_thread = threading.Thread(target=auto_sync_daemon, daemon=True)
    sync_thread.start()
    print(f"☁️  Cloudy Offline AI Vault listening on http://127.0.0.1:{port}")
    print(f"🔄 Live Auto-Sync enabled (every {SYNC_INTERVAL}s when internet reaches {CLOUD_ORIGIN})")
    ThreadingHTTPServer(("127.0.0.1", port), CloudyOfflineHandler).serve_forever()
`;

  const sampleKey = vaultManifest.apiKeys[0]?.key || 'cldy_sk_YOUR_KEY';
  const ollamaExample = `#!/usr/bin/env python3
"""
Example AI Skills (Read File, Search Vault, Write Note) for Local Offline Models (Ollama, Qwen, DeepSeek)
Point your skills at http://127.0.0.1:8765 — cloudy_offline_server.py works 100% offline AND
auto-syncs live with ${cloudOrigin} whenever internet is available!
"""
import json
import urllib.request

CLOUDY_LOCAL_URL = "http://127.0.0.1:8765"
CLOUDY_API_KEY = "${sampleKey}"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "llama3.2"


def cloudy_skill(method, path, body=None):
    headers = {"Authorization": f"Bearer {CLOUDY_API_KEY}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{CLOUDY_LOCAL_URL}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def read_file_skill(file_id: str) -> str:
    return cloudy_skill("GET", f"/api/v1/ai/files/{file_id}/content").get("content", "")


def search_vault_skill(query: str = ""):
    return cloudy_skill("GET", f"/api/v1/ai/search?q={urllib.parse.quote(query)}").get("results", [])


if __name__ == "__main__":
    import urllib.parse
    status = cloudy_skill("GET", "/api/v1/ai/status")
    print("Vault Status:", json.dumps(status, indent=2))

    hits = search_vault_skill("Cloudy")
    context_blocks = [
        f"### {item['folderPath']}/{item['name']}\\n{read_file_skill(item['id'])}"
        for item in hits[:3]
    ]

    prompt = "Using these Cloudy vault files:\\n\\n" + "\\n\\n".join(context_blocks) + "\\n\\nSummarize my notes."
    print(f"Loaded {len(context_blocks)} file(s). Querying local Ollama ({MODEL})...")
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps({"model": MODEL, "prompt": prompt, "stream": False}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        print(json.loads(resp.read().decode("utf-8")).get("response"))
`;

  const readmeMd = `# Cloudy Offline AI Vault + Live Auto-Sync

Run \`cloudy_offline_server.py\` once on your machine or Termux:

\`\`\`bash
python3 cloudy_offline_server.py
\`\`\`

- **100% Offline Ready:** Serves your synced folders, search index, text files, and raw binary files on \`http://127.0.0.1:8765/api/v1/ai/*\` with zero internet.
- **Live Background Auto-Sync:** Every 15 seconds, automatically checks if \`${cloudOrigin}\` is reachable:
  - **Pulls** any new or edited files, folders, and binary blobs down to local disk so offline skills always have your latest vault.
  - **Pushes** any notes/files your AI created or updated while offline (\`POST\` / \`PATCH /api/v1/ai/files\`) straight to your connected cloud storage!
- **Force Instant Sync Anytime:** \`POST http://127.0.0.1:8765/api/v1/ai/sync\` with \`Authorization: Bearer <API_KEY>\`.
`;

  archive.append(pythonServer, { name: 'cloudy_offline_server.py', mode: 0o755 });
  archive.append(ollamaExample, { name: 'ask_local_ollama.py', mode: 0o755 });
  archive.append(readmeMd, { name: 'README.md' });
  archive.finalize();
}
