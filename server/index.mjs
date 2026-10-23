import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  loadDb,
  saveDb,
  selectTargetAccount,
  writeAccountBinary,
  readAccountBinary,
  deleteAccountBinary,
  connectProviderAccount,
  sanitizeAccount,
  generateApiKeyString,
  makeId,
} from './store.mjs';
import {
  FREE_PROVIDER_CATALOG,
  getProviderMeta,
  buildUpstreamOAuthUrl,
  exchangeOAuthCode,
} from './providers.mjs';
import {
  createAiRouter,
  isLikelyTextMime,
  streamOfflineAiBundleZip,
} from './aiApi.mjs';
import {
  getAndroidInfo,
  downloadApkIfBuilt,
  streamAndroidProjectZip,
} from './androidBundle.mjs';

const app = express();
app.set('trust proxy', true);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Upload handler in memory (up to 100 MB per upload batch) so we shard cleanly into target provider mounts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Mount Local Offline AI REST API v1 (/api/v1/ai/*)
app.use('/api/v1/ai', createAiRouter());

// --- Vault Snapshot & Sync State ---
app.get('/api/vault/state', (req, res) => {
  const db = loadDb();
  const totalQuota = db.accounts.reduce((acc, a) => acc + (a.quotaBytes || 0), 0);
  const totalUsed = db.accounts.reduce((acc, a) => acc + (a.usedBytes || 0), 0);

  res.json({
    ok: true,
    settings: db.settings,
    summary: {
      totalQuotaBytes: totalQuota,
      totalUsedBytes: totalUsed,
      connectedProvidersCount: db.accounts.length,
      maxCatalogFreeBytes: FREE_PROVIDER_CATALOG.reduce((s, p) => s + p.freeBytes, 0),
    },
    providersCatalog: FREE_PROVIDER_CATALOG.map((p) => ({
      ...p,
      liveOAuthConfigured: Boolean(
        db.oauthApps?.[p.id]?.clientId || process.env[`${p.id.toUpperCase()}_CLIENT_ID`]
      ),
    })),
    accounts: db.accounts.map(sanitizeAccount),
    folders: db.folders,
    files: db.files,
    apiKeys: db.apiKeys,
    aiAuditLog: db.aiAuditLog || [],
  });
});

// --- Storage Rules ("Your Rules") ---
app.patch('/api/vault/settings', (req, res) => {
  const db = loadDb();
  const { allocationRule, autoOfflineSync } = req.body || {};
  if (allocationRule && ['most_free', 'waterfall', 'by_type', 'mirror'].includes(allocationRule)) {
    db.settings.allocationRule = allocationRule;
  }
  if (typeof autoOfflineSync === 'boolean') {
    db.settings.autoOfflineSync = autoOfflineSync;
  }
  saveDb();
  res.json({ ok: true, settings: db.settings });
});

// --- Free Storage Providers & One-Time OAuth 2.0 ---
function getOAuthConfigForProvider(db, providerId) {
  const envClientId = process.env[`${providerId.toUpperCase()}_CLIENT_ID`];
  const envSecret = process.env[`${providerId.toUpperCase()}_CLIENT_SECRET`];
  if (envClientId) {
    return { clientId: envClientId, clientSecret: envSecret || '' };
  }
  return db.oauthApps?.[providerId] || null;
}

app.post('/api/oauth/config/:providerId', (req, res) => {
  const db = loadDb();
  const { providerId } = req.params;
  const meta = getProviderMeta(providerId);
  if (!meta) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const { clientId = '', clientSecret = '' } = req.body || {};
  db.oauthApps = db.oauthApps || {};
  if (!clientId.trim()) {
    delete db.oauthApps[providerId];
  } else {
    db.oauthApps[providerId] = {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      updatedAt: new Date().toISOString(),
    };
  }
  saveDb();
  res.json({ ok: true, liveOAuthConfigured: Boolean(db.oauthApps[providerId]?.clientId) });
});

// Direct One-Time OAuth Connect (works inline or via popup)
app.post('/api/oauth/:providerId/one-time-connect', (req, res) => {
  const db = loadDb();
  const { providerId } = req.params;
  const meta = getProviderMeta(providerId);
  if (!meta) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const { email = '', accountLabel = '' } = req.body || {};
  const account = connectProviderAccount(db, {
    providerId,
    accountLabel,
    email,
    connectionMode: 'one_time_oauth',
  });
  res.status(201).json({ ok: true, account: sanitizeAccount(account) });
});

// Upstream OAuth 2.0 Redirect Flow (when live OAuth Client ID is configured)
app.get('/api/oauth/:providerId/authorize', (req, res) => {
  const db = loadDb();
  const { providerId } = req.params;
  const meta = getProviderMeta(providerId);
  if (!meta) return res.status(404).send('Unknown provider');

  const cfg = getOAuthConfigForProvider(db, providerId);
  const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/callback`;

  if (cfg?.clientId && meta.authorizeUrl) {
    const { authorizeUrl } = buildUpstreamOAuthUrl(meta, cfg, redirectUri);
    return res.redirect(authorizeUrl);
  }

  // Fallback self-hosted One-Time OAuth Consent Popup HTML if live Client ID not entered yet
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>One-Time OAuth — ${meta.name} | Cloudy by X-Kilo</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#05080F; color:#f1f5f9; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; box-sizing:border-box; }
    .card { width:100%; max-width:420px; background:#0C1322; border:1px solid rgba(56,182,255,0.22); border-radius:20px; padding:28px; box-shadow:0 24px 60px rgba(0,0,0,0.65); }
    .badge { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; background:${meta.accentBg}; color:${meta.color}; margin-bottom:12px; }
    h2 { margin:0 0 6px; font-size:20px; }
    p { margin:0 0 18px; color:#94a3b8; font-size:14px; line-height:1.5; }
    label { display:block; font-size:12px; color:#cbd5e1; margin-bottom:6px; font-weight:500; }
    input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #1e293b; background:#060A14; color:#fff; margin-bottom:14px; font-size:14px; }
    button { width:100%; padding:12px; border:none; border-radius:12px; background:linear-gradient(135deg,#38B6FF,#0B5CE1); color:#fff; font-weight:600; font-size:14px; cursor:pointer; }
    .scopes { background:#060A14; border:1px solid #1e293b; border-radius:10px; padding:10px 12px; margin-bottom:16px; font-size:12px; color:#94a3b8; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/api/oauth/${meta.id}/popup-complete">
    <span class="badge">${meta.freeLabel} · One-Time OAuth</span>
    <h2>Authorize ${meta.name}</h2>
    <p>Grant <strong>Cloudy (X-Kilo)</strong> persistent offline refresh access so you only sign in once.</p>
    <div class="scopes">
      <strong>Scopes:</strong> ${(meta.scopes || ['files.readwrite']).join(', ')}<br/>
      <strong>Token Policy:</strong> Persistent Offline Refresh Token (Connect Once)
    </div>
    <label>Account Email</label>
    <input name="email" type="email" required placeholder="you@${meta.id.replace('_', '')}.com" value="user@${meta.id.replace('_', '')}.com" />
    <label>Mount Display Label (Optional)</label>
    <input name="accountLabel" type="text" placeholder="${meta.name}" />
    <button type="submit">Authorize One-Time OAuth (${meta.freeLabel})</button>
  </form>
</body>
</html>`);
});

app.post('/api/oauth/:providerId/popup-complete', (req, res) => {
  const db = loadDb();
  const account = connectProviderAccount(db, {
    providerId: req.params.providerId,
    accountLabel: req.body?.accountLabel || '',
    email: req.body?.email || '',
    connectionMode: 'one_time_oauth',
  });
  const safeJson = JSON.stringify(sanitizeAccount(account));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><body style="background:#05080F;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'CLOUDY_OAUTH_SUCCESS', account: ${safeJson} }, '*');
        window.close();
      } else {
        window.location.href = '/?tab=providers';
      }
    </script>
    <p>Connected! Closing window...</p>
  </body></html>`);
});

app.get('/api/oauth/callback', async (req, res) => {
  try {
    const db = loadDb();
    const { code, state } = req.query;
    const tokenBundle = await exchangeOAuthCode(
      String(state || ''),
      String(code || ''),
      (pid) => getOAuthConfigForProvider(db, pid)
    );
    const account = connectProviderAccount(db, {
      providerId: tokenBundle.providerId,
      connectionMode: 'live_oauth',
      tokens: tokenBundle,
    });
    const safeJson = JSON.stringify(sanitizeAccount(account));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><body style="background:#05080F;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'CLOUDY_OAUTH_SUCCESS', account: ${safeJson} }, '*');
          window.close();
        } else {
          window.location.href = '/?tab=providers';
        }
      </script>
      <p>OAuth verified! Returning to Cloudy...</p>
    </body></html>`);
  } catch (err) {
    res.status(400).send(`OAuth Callback Error: ${String(err.message || err)}`);
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  const db = loadDb();
  const acc = db.accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ ok: false, error: 'Account not found' });
  if (acc.id === 'acc_xkilo_core') {
    return res.status(400).json({ ok: false, error: 'Built-in Cloudy Core Vault cannot be removed.' });
  }

  // Migrate any files stored on disconnected account safely to Cloudy Core Vault
  for (const f of db.files) {
    if (f.accountId === acc.id) {
      const buf = readAccountBinary(acc.id, f.id, f.mirrorAccountId);
      if (buf) writeAccountBinary('acc_xkilo_core', f.id, buf);
      f.accountId = 'acc_xkilo_core';
      f.providerId = 'xkilo_core';
      f.providerName = 'Cloudy Core Vault';
    }
    if (f.mirrorAccountId === acc.id) {
      f.mirrorAccountId = null;
    }
  }

  db.accounts = db.accounts.filter((a) => a.id !== acc.id);
  saveDb();
  res.json({ ok: true });
});

// --- Folders ("Carpetas") CRUD ---
app.post('/api/folders', (req, res) => {
  const db = loadDb();
  const { id, name, parentId = null, color = '#38B6FF', offlinePinned = true } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ ok: false, error: 'Folder name is required' });
  }
  const now = new Date().toISOString();
  const folder = {
    id: id && String(id).startsWith('fld_') ? String(id) : makeId('fld'),
    name: String(name).trim(),
    parentId: parentId || null,
    color,
    offlinePinned: offlinePinned !== false,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
  // Idempotent upsert for offline sync queue replay
  const existingIdx = db.folders.findIndex((f) => f.id === folder.id);
  if (existingIdx >= 0) {
    db.folders[existingIdx] = { ...db.folders[existingIdx], ...folder, updatedAt: now };
  } else {
    db.folders.push(folder);
  }
  saveDb();
  res.status(201).json({ ok: true, folder });
});

app.patch('/api/folders/:id', (req, res) => {
  const db = loadDb();
  const folder = db.folders.find((f) => f.id === req.params.id);
  if (!folder) return res.status(404).json({ ok: false, error: 'Folder not found' });

  const { name, parentId, color, offlinePinned, starred, trashed } = req.body || {};
  if (typeof name === 'string' && name.trim()) folder.name = name.trim();
  if (parentId !== undefined && parentId !== folder.id) folder.parentId = parentId || null;
  if (typeof color === 'string') folder.color = color;
  if (typeof offlinePinned === 'boolean') folder.offlinePinned = offlinePinned;
  if (typeof starred === 'boolean') folder.starred = starred;
  if (typeof trashed === 'boolean') folder.trashed = trashed;
  folder.updatedAt = new Date().toISOString();

  saveDb();
  res.json({ ok: true, folder });
});

app.delete('/api/folders/:id', (req, res) => {
  const db = loadDb();
  const targetId = req.params.id;
  const toDelete = new Set([targetId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of db.folders) {
      if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
        toDelete.add(f.id);
        added = true;
      }
    }
  }
  for (const file of db.files) {
    if (file.folderId && toDelete.has(file.folderId)) {
      deleteAccountBinary(file.accountId, file.id, file.mirrorAccountId);
    }
  }
  db.files = db.files.filter((fl) => !fl.folderId || !toDelete.has(fl.folderId));
  db.folders = db.folders.filter((fd) => !toDelete.has(fd.id));
  saveDb();
  res.json({ ok: true });
});

// --- Files, Notes & Binary Uploads ---
app.post('/api/files/upload', upload.array('files', 20), (req, res) => {
  const db = loadDb();
  const uploaded = req.files || [];
  const folderId = req.body.folderId && req.body.folderId !== 'null' ? req.body.folderId : null;
  const preferredAccountId = req.body.accountId || 'auto';
  const customId = req.body.clientFileId || null;
  const tags = req.body.tags
    ? String(req.body.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const created = [];
  const now = new Date().toISOString();

  for (let i = 0; i < uploaded.length; i++) {
    const f = uploaded[i];
    const mimeType = f.mimetype || 'application/octet-stream';
    const { primary, mirror } = selectTargetAccount(db, f.size, mimeType, preferredAccountId);
    const id = i === 0 && customId ? String(customId) : makeId('fil');

    writeAccountBinary(primary.id, id, f.buffer);
    if (mirror) {
      writeAccountBinary(mirror.id, id, f.buffer);
    }

    let textContent = null;
    if (isLikelyTextMime(mimeType, f.originalname) && f.size <= 2 * 1024 * 1024) {
      textContent = f.buffer.toString('utf8');
    }

    const fileRecord = {
      id,
      name: f.originalname,
      folderId,
      mimeType,
      kind: 'file',
      size: f.size,
      accountId: primary.id,
      providerId: primary.providerId,
      providerName: primary.providerName,
      mirrorAccountId: mirror ? mirror.id : null,
      offlinePinned: db.settings.autoOfflineSync !== false,
      starred: false,
      trashed: false,
      tags,
      textContent,
      createdAt: now,
      updatedAt: now,
    };

    const existingIdx = db.files.findIndex((item) => item.id === id);
    if (existingIdx >= 0) {
      db.files[existingIdx] = fileRecord;
    } else {
      db.files.unshift(fileRecord);
    }
    created.push(fileRecord);
  }

  saveDb();
  res.status(201).json({ ok: true, files: created });
});

// Create text/markdown/JSON note or dataset directly online/offline
app.post('/api/files/note', (req, res) => {
  const db = loadDb();
  const {
    id: clientId,
    name,
    content = '',
    folderId = null,
    mimeType = 'text/markdown',
    kind = 'note',
    accountId = 'auto',
    tags = [],
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ ok: false, error: 'Name is required' });
  }

  const buf = Buffer.from(String(content), 'utf8');
  const { primary, mirror } = selectTargetAccount(db, buf.byteLength, mimeType, accountId);
  const id = clientId && String(clientId).startsWith('fil_') ? String(clientId) : makeId('fil');

  writeAccountBinary(primary.id, id, buf);
  if (mirror) writeAccountBinary(mirror.id, id, buf);

  const now = new Date().toISOString();
  const record = {
    id,
    name: String(name).trim(),
    folderId: folderId || null,
    mimeType,
    kind,
    size: buf.byteLength,
    accountId: primary.id,
    providerId: primary.providerId,
    providerName: primary.providerName,
    mirrorAccountId: mirror ? mirror.id : null,
    offlinePinned: true,
    starred: false,
    trashed: false,
    tags: Array.isArray(tags) ? tags : [],
    textContent: String(content),
    createdAt: now,
    updatedAt: now,
  };

  const existingIdx = db.files.findIndex((f) => f.id === id);
  if (existingIdx >= 0) {
    db.files[existingIdx] = { ...db.files[existingIdx], ...record };
  } else {
    db.files.unshift(record);
  }
  saveDb();
  res.status(201).json({ ok: true, file: record });
});

// Update file metadata, move folder, migrate provider, or edit text content
app.patch('/api/files/:id', (req, res) => {
  const db = loadDb();
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  const { name, folderId, starred, trashed, offlinePinned, textContent, targetAccountId, tags } =
    req.body || {};

  if (typeof name === 'string' && name.trim()) file.name = name.trim();
  if (folderId !== undefined) file.folderId = folderId || null;
  if (typeof starred === 'boolean') file.starred = starred;
  if (typeof trashed === 'boolean') file.trashed = trashed;
  if (typeof offlinePinned === 'boolean') file.offlinePinned = offlinePinned;
  if (Array.isArray(tags)) file.tags = tags;

  if (typeof textContent === 'string') {
    const buf = Buffer.from(textContent, 'utf8');
    writeAccountBinary(file.accountId, file.id, buf);
    if (file.mirrorAccountId) writeAccountBinary(file.mirrorAccountId, file.id, buf);
    file.textContent = textContent;
    file.size = buf.byteLength;
  }

  // Allow moving file seamlessly between connected cloud providers!
  if (targetAccountId && targetAccountId !== file.accountId) {
    const nextAcc = db.accounts.find((a) => a.id === targetAccountId);
    if (nextAcc) {
      const buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
      if (buf) {
        writeAccountBinary(nextAcc.id, file.id, buf);
        deleteAccountBinary(file.accountId, file.id);
      }
      file.accountId = nextAcc.id;
      file.providerId = nextAcc.providerId;
      file.providerName = nextAcc.providerName;
    }
  }

  file.updatedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, file });
});

app.get('/api/files/:id/blob', (req, res) => {
  const db = loadDb();
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  const buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  if (!buf) return res.status(404).json({ ok: false, error: 'Binary missing' });

  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(file.name)}"`
  );
  res.send(buf);
});

app.delete('/api/files/:id', (req, res) => {
  const db = loadDb();
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  deleteAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  db.files = db.files.filter((f) => f.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// --- Cloudy Local Offline AI API Keys Management ---
app.post('/api/ai-keys', (req, res) => {
  const db = loadDb();
  const { name, scope = 'read', allowedFolderIds = [] } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ ok: false, error: 'Key name is required' });
  }
  const rawKey = generateApiKeyString();
  const record = {
    id: makeId('key'),
    name: String(name).trim(),
    key: rawKey,
    keyPrefix: `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`,
    scope: scope === 'read_write' ? 'read_write' : 'read',
    allowedFolderIds: Array.isArray(allowedFolderIds) ? allowedFolderIds : [],
    active: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.apiKeys.unshift(record);
  saveDb();
  res.status(201).json({ ok: true, apiKey: record });
});

app.patch('/api/ai-keys/:id', (req, res) => {
  const db = loadDb();
  const record = db.apiKeys.find((k) => k.id === req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'API key not found' });

  const { active, scope, allowedFolderIds, name } = req.body || {};
  if (typeof active === 'boolean') record.active = active;
  if (scope === 'read' || scope === 'read_write') record.scope = scope;
  if (Array.isArray(allowedFolderIds)) record.allowedFolderIds = allowedFolderIds;
  if (typeof name === 'string' && name.trim()) record.name = name.trim();
  saveDb();
  res.json({ ok: true, apiKey: record });
});

app.delete('/api/ai-keys/:id', (req, res) => {
  const db = loadDb();
  db.apiKeys = db.apiKeys.filter((k) => k.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/ai-keys/offline-bundle.zip', streamOfflineAiBundleZip);

// --- Hydrate Serverless Instance from Client Durable IndexedDB Vault ---
app.post('/api/vault/hydrate', (req, res) => {
  const db = loadDb();
  const { accounts = [], folders = [], files = [], apiKeys = [], settings } = req.body || {};

  if (settings?.allocationRule) {
    db.settings.allocationRule = settings.allocationRule;
  }

  const existingAccIds = new Set(db.accounts.map((a) => a.id));
  for (const acc of accounts) {
    if (acc?.id && !existingAccIds.has(acc.id)) {
      db.accounts.push({ ...acc, status: 'connected' });
      existingAccIds.add(acc.id);
    }
  }

  const existingFolderIds = new Set(db.folders.map((f) => f.id));
  for (const fld of folders) {
    if (fld?.id && !existingFolderIds.has(fld.id)) {
      db.folders.push(fld);
      existingFolderIds.add(fld.id);
    }
  }

  const existingFileIds = new Set(db.files.map((f) => f.id));
  for (const fl of files) {
    if (fl?.id && !existingFileIds.has(fl.id)) {
      if (typeof fl.textContent === 'string') {
        writeAccountBinary(fl.accountId || 'acc_xkilo_core', fl.id, Buffer.from(fl.textContent, 'utf8'));
      }
      db.files.push(fl);
      existingFileIds.add(fl.id);
    }
  }

  const existingKeyIds = new Set(db.apiKeys.map((k) => k.id));
  for (const k of apiKeys) {
    if (k?.id && k?.key && !existingKeyIds.has(k.id)) {
      db.apiKeys.push(k);
      existingKeyIds.add(k.id);
    }
  }

  saveDb();
  res.json({ ok: true });
});

// --- Android PWA + APK Download Endpoints ---
app.get('/api/android/info', getAndroidInfo);
app.get('/api/android/download.apk', downloadApkIfBuilt);
app.get('/api/android/project.zip', streamAndroidProjectZip);

// --- Serve Static Built Frontend (PWA Ready) ---
const DIST_DIR = path.resolve('dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 3000);
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`☁️  Cloudy by X-Kilo running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
