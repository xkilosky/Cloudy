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
  addVerifiedProviderAccount,
  getUnsealedAccount,
  sanitizeAccount,
  generateApiKeyString,
  normalizeVaultId,
  makeId,
} from './store.mjs';
import {
  FREE_PROVIDER_CATALOG,
  getProviderMeta,
  buildUpstreamOAuthUrl,
  exchangeOAuthCode,
} from './providers.mjs';
import {
  verifyAndInspectProvider,
  uploadFileToRemoteProvider,
  downloadFileFromRemoteProvider,
  listRemoteProviderFiles,
  sealCredentials,
} from './cloudAdapters.mjs';
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function reqVaultId(req) {
  return normalizeVaultId(req.headers['x-cloudy-vault-id'] || req.query.vaultId || 'default');
}

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

async function importRemoteFilesIntoVault(db, account) {
  try {
    const unsealed = getUnsealedAccount(account);
    const remoteItems = await listRemoteProviderFiles(
      unsealed,
      (pid) => getOAuthConfigForProvider(db, pid),
      makeTokenUpdateHandler(db, account)
    );
    const existingRemoteIds = new Set(
      db.files
        .filter((f) => f.accountId === account.id && f.remoteId)
        .map((f) => f.remoteId)
    );

    let importedCount = 0;
    const now = new Date().toISOString();
    for (const r of remoteItems) {
      if (!r.remoteId || existingRemoteIds.has(r.remoteId)) continue;
      db.files.push({
        id: makeId('fil'),
        name: r.name,
        folderId: null,
        mimeType: r.mimeType || 'application/octet-stream',
        kind: 'file',
        size: r.size || 0,
        accountId: account.id,
        providerId: account.providerId,
        providerName: account.providerName,
        remoteId: r.remoteId,
        remotePath: r.remotePath,
        importedRemote: true,
        mirrorAccountId: null,
        offlinePinned: r.size <= 5 * 1024 * 1024,
        starred: false,
        trashed: false,
        tags: ['cloud-synced'],
        textContent: null,
        createdAt: r.updatedAt || now,
        updatedAt: r.updatedAt || now,
      });
      existingRemoteIds.add(r.remoteId);
      importedCount++;
    }
    account.lastSyncedAt = now;
    saveDb(db.vaultId);
    return importedCount;
  } catch {
    return 0;
  }
}

// Mount Local Offline AI REST API v1 (/api/v1/ai/*)
app.use('/api/v1/ai', createAiRouter());

// --- Vault State ---
app.get('/api/vault/state', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const totalQuota = db.accounts.reduce((acc, a) => acc + (a.quotaBytes || 0), 0);
  const totalUsed = db.accounts.reduce((acc, a) => acc + (a.usedBytes || 0), 0);

  res.json({
    ok: true,
    vaultId: db.vaultId,
    settings: db.settings,
    summary: {
      totalQuotaBytes: totalQuota,
      totalUsedBytes: totalUsed,
      connectedProvidersCount: db.accounts.length,
      maxCatalogFreeBytes: FREE_PROVIDER_CATALOG.reduce((s, p) => s + p.freeBytes, 0),
    },
    providersCatalog: FREE_PROVIDER_CATALOG.map((p) => ({
      ...p,
      oauthConfigured: Boolean(getOAuthConfigForProvider(db, p.id)?.clientId),
    })),
    accounts: db.accounts.map(sanitizeAccount),
    folders: db.folders,
    files: db.files,
    apiKeys: db.apiKeys,
    aiAuditLog: db.aiAuditLog || [],
  });
});

app.patch('/api/vault/settings', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const { allocationRule, autoOfflineSync } = req.body || {};
  if (allocationRule && ['most_free', 'waterfall', 'by_type', 'mirror'].includes(allocationRule)) {
    db.settings.allocationRule = allocationRule;
  }
  if (typeof autoOfflineSync === 'boolean') {
    db.settings.autoOfflineSync = autoOfflineSync;
  }
  saveDb(db.vaultId);
  res.json({ ok: true, settings: db.settings });
});

// --- Hydrate Serverless Instance from Client Durable IndexedDB Vault ---
app.post('/api/vault/hydrate', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const { accounts = [], folders = [], files = [], apiKeys = [], oauthApps, settings } =
    req.body || {};

  if (settings?.allocationRule) db.settings.allocationRule = settings.allocationRule;
  if (oauthApps && typeof oauthApps === 'object') {
    db.oauthApps = { ...(db.oauthApps || {}), ...oauthApps };
  }

  const existingAccIds = new Set(db.accounts.map((a) => a.id));
  for (const acc of accounts) {
    if (acc?.id && acc.providerId !== 'xkilo_core' && !existingAccIds.has(acc.id)) {
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
        writeAccountBinary(fl.accountId || db.accounts[0]?.id, fl.id, Buffer.from(fl.textContent, 'utf8'));
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

  saveDb(db.vaultId);
  res.json({ ok: true });
});

// --- Save OAuth 2.0 Client ID & Secret for Upstream Redirects ---
app.post('/api/oauth/config/:providerId', (req, res) => {
  const db = loadDb(reqVaultId(req));
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
  saveDb(db.vaultId);
  res.json({ ok: true, oauthConfigured: Boolean(db.oauthApps[providerId]?.clientId) });
});

// --- Real Upstream OAuth 2.0 Redirect Start ---
app.get('/api/oauth/:providerId/authorize', (req, res) => {
  const vaultId = reqVaultId(req);
  const db = loadDb(vaultId);
  const { providerId } = req.params;
  const meta = getProviderMeta(providerId);
  if (!meta || !meta.authorizeUrl) {
    return res.status(400).send('Provider does not use OAuth2 redirect flow.');
  }

  // Allow clientId/clientSecret either saved in vault OR passed on query for 1-step launch
  const queryClientId = String(req.query.clientId || '').trim();
  const querySecret = String(req.query.clientSecret || '').trim();
  if (queryClientId) {
    db.oauthApps = db.oauthApps || {};
    db.oauthApps[providerId] = { clientId: queryClientId, clientSecret: querySecret };
    saveDb(vaultId);
  }

  const cfg = getOAuthConfigForProvider(db, providerId);
  if (!cfg?.clientId) {
    return res.status(400).send('OAuth Client ID is required to initiate upstream OAuth 2.0.');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/callback`;
  const scopeMode = String(req.query.scopeMode || 'default');
  const { authorizeUrl } = buildUpstreamOAuthUrl(meta, cfg, redirectUri, vaultId, scopeMode);
  return res.redirect(authorizeUrl);
});

// --- Real Upstream OAuth 2.0 Callback (Exchanges Code + Verifies Real Quota & Files) ---
app.get('/api/oauth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      throw new Error(String(error_description || error));
    }

    const tokenBundle = await exchangeOAuthCode(
      String(state || ''),
      String(code || ''),
      (pid) => getOAuthConfigForProvider(loadDb('default'), pid)
    );

    const db = loadDb(tokenBundle.vaultId || 'default');
    const verified = await verifyAndInspectProvider(tokenBundle.providerId, tokenBundle);
    const account = addVerifiedProviderAccount(db, {
      providerId: tokenBundle.providerId,
      email: verified.email,
      accountLabel: verified.accountLabel,
      quotaBytes: verified.quotaBytes,
      usedBytes: verified.usedBytes,
      credentials: verified.credentials,
      connectionMode: 'oauth2',
    });

    await importRemoteFilesIntoVault(db, account);

    const safeJson = JSON.stringify(sanitizeAccount(account));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'CLOUDY_OAUTH_SUCCESS', account: ${safeJson} }, '*');
          window.close();
        } else {
          window.location.href = '/?tab=providers';
        }
      </script>
      <div style="text-align:center;">
        <p style="color:#00F0FF;font-weight:600;">✓ Connected ${account.accountLabel}</p>
        <p style="color:#71717a;font-size:13px;">Returning to Cloudy...</p>
      </div>
    </body></html>`);
  } catch (err) {
    const rawMsg = String(err.message || err);
    const msg = rawMsg.replace(/</g, '&lt;');
    const isAccessDenied = rawMsg.includes('access_denied');
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;margin:0;">
      <div style="max-width:480px;border:1px solid #27272a;padding:24px;border-radius:16px;background:#07090C;">
        <h3 style="color:#f87171;margin-top:0;">OAuth Access Blocked (${msg})</h3>
        ${
          isAccessDenied
            ? `<p style="color:#d4d4d8;font-size:13px;line-height:1.6;">
                Your Google Cloud OAuth Consent Screen is currently in <strong>Testing (Prueba)</strong> mode. To allow sign-in:
                <br/><br/>
                1. Open <a href="https://console.cloud.google.com/auth/audience" target="_blank" style="color:#00F0FF;">Google Cloud → Audience (Público)</a><br/>
                2. Either click <strong>"Publish App" ("Publicar aplicación")</strong> OR add your Gmail under <strong>"Test users" ("Usuarios de prueba")</strong>.
              </p>`
            : `<p style="color:#a1a1aa;font-size:13px;line-height:1.5;">${msg}</p>`
        }
        <button onclick="window.close()" style="margin-top:12px;padding:9px 18px;background:#00F0FF;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer;">Close Window</button>
      </div>
    </body></html>`);
  }
});

// --- Real Direct Cloud Account Verification & Mount (MEGA, S3/R2/B2/Storj, WebDAV, GitHub, Supabase, OAuth Token) ---
app.post('/api/accounts/connect', async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
    const { providerId, credentials = {} } = req.body || {};
    if (!providerId) {
      return res.status(400).json({ ok: false, error: 'providerId is required' });
    }

    const verified = await verifyAndInspectProvider(providerId, credentials);
    const account = addVerifiedProviderAccount(db, {
      providerId,
      email: verified.email,
      accountLabel: verified.accountLabel,
      quotaBytes: verified.quotaBytes,
      usedBytes: verified.usedBytes,
      credentials: verified.credentials,
      connectionMode: 'verified_cloud',
    });

    const importedCount = await importRemoteFilesIntoVault(db, account);
    res.status(201).json({
      ok: true,
      account: sanitizeAccount(account),
      importedFilesCount: importedCount,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: String(err.message || err),
    });
  }
});

// --- Sync Remote Files + Refresh Real Quota from Upstream Cloud Account ---
app.post('/api/accounts/:id/sync', async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
    const acc = db.accounts.find((a) => a.id === req.params.id);
    if (!acc) return res.status(404).json({ ok: false, error: 'Account not found' });
    if (acc.providerId === 'xkilo_core') {
      return res.json({ ok: true, importedCount: 0, account: sanitizeAccount(acc) });
    }

    const unsealed = getUnsealedAccount(acc);
    if (unsealed.credentials) {
      try {
        const verified = await verifyAndInspectProvider(acc.providerId, unsealed.credentials);
        acc.quotaBytes = verified.quotaBytes;
        acc.baseExternalUsedBytes = verified.usedBytes;
      } catch {
        // Keep cached quota if refresh endpoint unavailable
      }
    }
    const importedCount = await importRemoteFilesIntoVault(db, acc);
    res.json({ ok: true, importedCount, account: sanitizeAccount(acc) });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const acc = db.accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ ok: false, error: 'Account not found' });
  if (acc.providerId === 'xkilo_core') {
    return res.status(400).json({ ok: false, error: 'Built-in Local Vault cannot be removed.' });
  }

  const coreAcc = db.accounts.find((a) => a.providerId === 'xkilo_core') || db.accounts[0];
  db.files = db.files.filter((f) => !(f.accountId === acc.id && f.importedRemote));

  for (const f of db.files) {
    if (f.accountId === acc.id) {
      const buf = readAccountBinary(acc.id, f.id, f.mirrorAccountId);
      if (buf) writeAccountBinary(coreAcc.id, f.id, buf);
      f.accountId = coreAcc.id;
      f.providerId = coreAcc.providerId;
      f.providerName = coreAcc.providerName;
    }
    if (f.mirrorAccountId === acc.id) f.mirrorAccountId = null;
  }

  db.accounts = db.accounts.filter((a) => a.id !== acc.id);
  saveDb(db.vaultId);
  res.json({ ok: true });
});

// --- Folders ("Carpetas") CRUD ---
app.post('/api/folders', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const { id, name, parentId = null, offlinePinned = true } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ ok: false, error: 'Folder name is required' });
  }
  const now = new Date().toISOString();
  const folder = {
    id: id && String(id).startsWith('fld_') ? String(id) : makeId('fld'),
    name: String(name).trim(),
    parentId: parentId || null,
    offlinePinned: offlinePinned !== false,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
  const existingIdx = db.folders.findIndex((f) => f.id === folder.id);
  if (existingIdx >= 0) {
    db.folders[existingIdx] = { ...db.folders[existingIdx], ...folder, updatedAt: now };
  } else {
    db.folders.push(folder);
  }
  saveDb(db.vaultId);
  res.status(201).json({ ok: true, folder });
});

app.patch('/api/folders/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const folder = db.folders.find((f) => f.id === req.params.id);
  if (!folder) return res.status(404).json({ ok: false, error: 'Folder not found' });

  const { name, parentId, offlinePinned, starred, trashed } = req.body || {};
  if (typeof name === 'string' && name.trim()) folder.name = name.trim();
  if (parentId !== undefined && parentId !== folder.id) folder.parentId = parentId || null;
  if (typeof offlinePinned === 'boolean') folder.offlinePinned = offlinePinned;
  if (typeof starred === 'boolean') folder.starred = starred;
  if (typeof trashed === 'boolean') folder.trashed = trashed;
  folder.updatedAt = new Date().toISOString();

  saveDb(db.vaultId);
  res.json({ ok: true, folder });
});

app.delete('/api/folders/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
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
  saveDb(db.vaultId);
  res.json({ ok: true });
});

// --- Files Upload (Writes to Real Connected Upstream Cloud Account + Local Offline Cache!) ---
app.post('/api/files/upload', upload.array('files', 20), async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
    const uploaded = req.files || [];
    const folderId = req.body.folderId && req.body.folderId !== 'null' ? req.body.folderId : null;
    const preferredAccountId = req.body.accountId || 'auto';
    const customId = req.body.clientFileId || null;

    const created = [];
    const now = new Date().toISOString();

    for (let i = 0; i < uploaded.length; i++) {
      const f = uploaded[i];
      const mimeType = f.mimetype || 'application/octet-stream';
      const { primary, mirror } = selectTargetAccount(db, f.size, mimeType, preferredAccountId);
      const id = i === 0 && customId ? String(customId) : makeId('fil');

      // Upload to real upstream cloud provider if primary is an external cloud account!
      let remoteMeta = null;
      if (primary.providerId !== 'xkilo_core') {
        remoteMeta = await uploadFileToRemoteProvider(
          getUnsealedAccount(primary),
          f.originalname,
          f.buffer,
          mimeType,
          (pid) => getOAuthConfigForProvider(db, pid),
          makeTokenUpdateHandler(db, primary)
        );
      }

      if (mirror && mirror.providerId !== 'xkilo_core') {
        await uploadFileToRemoteProvider(
          getUnsealedAccount(mirror),
          f.originalname,
          f.buffer,
          mimeType,
          (pid) => getOAuthConfigForProvider(db, pid),
          makeTokenUpdateHandler(db, mirror)
        ).catch(() => {});
      }

      writeAccountBinary(primary.id, id, f.buffer);
      if (mirror) writeAccountBinary(mirror.id, id, f.buffer);

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
        remoteId: remoteMeta?.remoteId || null,
        remotePath: remoteMeta?.remotePath || null,
        webUrl: remoteMeta?.webUrl || null,
        mirrorAccountId: mirror ? mirror.id : null,
        offlinePinned: db.settings.autoOfflineSync !== false,
        starred: false,
        trashed: false,
        tags: [],
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

    saveDb(db.vaultId);
    res.status(201).json({ ok: true, files: created });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

// Create Note / Dataset (Also uploads to Real Connected Cloud Provider!)
app.post('/api/files/note', async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
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

    let remoteMeta = null;
    if (primary.providerId !== 'xkilo_core') {
      remoteMeta = await uploadFileToRemoteProvider(
        getUnsealedAccount(primary),
        String(name).trim(),
        buf,
        mimeType,
        (pid) => getOAuthConfigForProvider(db, pid),
        makeTokenUpdateHandler(db, primary)
      );
    }

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
      remoteId: remoteMeta?.remoteId || null,
      remotePath: remoteMeta?.remotePath || null,
      webUrl: remoteMeta?.webUrl || null,
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
    saveDb(db.vaultId);
    res.status(201).json({ ok: true, file: record });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

app.patch('/api/files/:id', async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
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
      file.textContent = textContent;
      file.size = buf.byteLength;
    }

    if (targetAccountId && targetAccountId !== file.accountId) {
      const nextAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (nextAcc) {
        let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
        if (!buf && (file.remoteId || file.remotePath)) {
          const oldAcc = db.accounts.find((a) => a.id === file.accountId);
          if (oldAcc) {
            buf = await downloadFileFromRemoteProvider(
              getUnsealedAccount(oldAcc),
              file,
              (pid) => getOAuthConfigForProvider(db, pid),
              makeTokenUpdateHandler(db, oldAcc)
            );
          }
        }
        if (buf) {
          if (nextAcc.providerId !== 'xkilo_core') {
            const remoteMeta = await uploadFileToRemoteProvider(
              getUnsealedAccount(nextAcc),
              file.name,
              buf,
              file.mimeType || 'application/octet-stream',
              (pid) => getOAuthConfigForProvider(db, pid),
              makeTokenUpdateHandler(db, nextAcc)
            );
            file.remoteId = remoteMeta?.remoteId || null;
            file.remotePath = remoteMeta?.remotePath || null;
            file.webUrl = remoteMeta?.webUrl || null;
          }
          writeAccountBinary(nextAcc.id, file.id, buf);
        }
        file.accountId = nextAcc.id;
        file.providerId = nextAcc.providerId;
        file.providerName = nextAcc.providerName;
      }
    }

    file.updatedAt = new Date().toISOString();
    saveDb(db.vaultId);
    res.json({ ok: true, file });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

// Serve or Stream Binary (from Local Cache OR Live Upstream Cloud Download!)
app.get('/api/files/:id/blob', async (req, res) => {
  try {
    const db = loadDb(reqVaultId(req));
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    let buf = readAccountBinary(file.accountId, file.id, file.mirrorAccountId);
    if (!buf && (file.remoteId || file.remotePath)) {
      const acc = db.accounts.find((a) => a.id === file.accountId);
      if (acc) {
        buf = await downloadFileFromRemoteProvider(
          getUnsealedAccount(acc),
          file,
          (pid) => getOAuthConfigForProvider(db, pid),
          makeTokenUpdateHandler(db, acc)
        );
        if (buf) {
          writeAccountBinary(file.accountId, file.id, buf);
          if (!file.textContent && isLikelyTextMime(file.mimeType, file.name) && buf.byteLength <= 2 * 1024 * 1024) {
            file.textContent = buf.toString('utf8');
            saveDb(db.vaultId);
          }
        }
      }
    }

    if (!buf) return res.status(404).json({ ok: false, error: 'Binary missing from cloud storage' });

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(file.name)}"`
    );
    res.send(buf);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.delete('/api/files/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  deleteAccountBinary(file.accountId, file.id, file.mirrorAccountId);
  db.files = db.files.filter((f) => f.id !== req.params.id);
  saveDb(db.vaultId);
  res.json({ ok: true });
});

// --- Cloudy Local Offline AI API Keys ---
app.post('/api/ai-keys', (req, res) => {
  const db = loadDb(reqVaultId(req));
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
  saveDb(db.vaultId);
  res.status(201).json({ ok: true, apiKey: record });
});

app.patch('/api/ai-keys/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
  const record = db.apiKeys.find((k) => k.id === req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: 'API key not found' });

  const { active, scope, allowedFolderIds, name } = req.body || {};
  if (typeof active === 'boolean') record.active = active;
  if (scope === 'read' || scope === 'read_write') record.scope = scope;
  if (Array.isArray(allowedFolderIds)) record.allowedFolderIds = allowedFolderIds;
  if (typeof name === 'string' && name.trim()) record.name = name.trim();
  saveDb(db.vaultId);
  res.json({ ok: true, apiKey: record });
});

app.delete('/api/ai-keys/:id', (req, res) => {
  const db = loadDb(reqVaultId(req));
  db.apiKeys = db.apiKeys.filter((k) => k.id !== req.params.id);
  saveDb(db.vaultId);
  res.json({ ok: true });
});

app.get('/api/ai-keys/offline-bundle.zip', streamOfflineAiBundleZip);

// --- Android PWA + APK Download Endpoints ---
app.get('/api/android/info', getAndroidInfo);
app.get('/api/android/download.apk', downloadApkIfBuilt);
app.get('/api/android/project.zip', streamAndroidProjectZip);

// --- Serve Static Built Frontend ---
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
