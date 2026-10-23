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
import {
  buildPlugAndPlayPythonServer,
  buildMcpServerPython,
  buildOpenWebUiToolPython,
  buildTerminalChatPython,
  buildOsLaunchers,
} from './aiPlugAndPlay.mjs';

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
  res.setHeader('Content-Disposition', 'attachment; filename="Cloudy-PlugAndPlay-AI.zip"');
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

  const requestedKeyId = req.query.keyId ? String(req.query.keyId) : null;
  const preferredKey =
    (requestedKeyId && vaultManifest.apiKeys.find((k) => k.id === requestedKeyId)) ||
    vaultManifest.apiKeys.find((k) => k.scope === 'read_write') ||
    vaultManifest.apiKeys[0];
  const sampleKey = preferredKey?.key || 'cldy_sk_YOUR_KEY';

  const pythonServer = buildPlugAndPlayPythonServer(cloudOrigin);
  const mcpServer = buildMcpServerPython(cloudOrigin, sampleKey);
  const openWebUiTool = buildOpenWebUiToolPython(cloudOrigin, sampleKey);
  const terminalChat = buildTerminalChatPython(sampleKey);
  const { windowsBat, macCommand, linuxSh, mcpJson, readmeMd } = buildOsLaunchers(
    cloudOrigin,
    sampleKey
  );

  archive.append(windowsBat, { name: 'Start-Cloudy-AI.bat' });
  archive.append(macCommand, { name: 'Start-Cloudy-AI.command', mode: 0o755 });
  archive.append(linuxSh, { name: 'start-cloudy-ai.sh', mode: 0o755 });
  archive.append(pythonServer, { name: 'cloudy_offline_server.py', mode: 0o755 });
  archive.append(mcpServer, { name: 'cloudy_mcp_server.py', mode: 0o755 });
  archive.append(terminalChat, { name: 'chat_with_vault.py', mode: 0o755 });
  archive.append(openWebUiTool, { name: 'cloudy_vault_skill.py' });
  archive.append(mcpJson, { name: 'mcp_config.json' });
  archive.append(readmeMd, { name: 'README.md' });
  archive.finalize();
}

export async function downloadOpenWebUiToolHandler(req, res) {
  const vaultId = req.query.vaultId || req.headers['x-cloudy-vault-id'] || 'default';
  const db = await ensureVaultLoaded(vaultId);
  const cloudOrigin = resolveRequestOrigin(req);

  const activeKeys = (db.apiKeys || []).filter((k) => k.active !== false);
  const requestedKeyId = req.query.keyId ? String(req.query.keyId) : null;
  const chosenKey =
    (requestedKeyId && activeKeys.find((k) => k.id === requestedKeyId)) ||
    activeKeys.find((k) => k.scope === 'read_write') ||
    activeKeys[0];
  const sampleKey = chosenKey?.key || 'cldy_sk_YOUR_KEY';

  const script = buildOpenWebUiToolPython(cloudOrigin, sampleKey);
  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cloudy_vault_skill.py"');
  res.send(script);
}
