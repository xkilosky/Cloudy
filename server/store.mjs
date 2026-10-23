import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FREE_PROVIDER_CATALOG, getProviderMeta } from './providers.mjs';
import {
  sealCredentials,
  unsealCredentials,
  hasRealUpstreamCredentials,
} from './cloudAdapters.mjs';
import { syncVaultRelationalTables } from './authDb.mjs';

export const DATA_DIR = process.env.VERCEL
  ? '/tmp/cloudy-data'
  : path.resolve('data');
export const VAULTS_DIR = path.join(DATA_DIR, 'vaults');
export const MOUNTS_DIR = path.join(DATA_DIR, 'mounts');

fs.mkdirSync(VAULTS_DIR, { recursive: true });
fs.mkdirSync(MOUNTS_DIR, { recursive: true });

const VALID_PROVIDER_IDS = new Set(FREE_PROVIDER_CATALOG.map((p) => p.id));
const FORBIDDEN_MODES = new Set([
  'one_time_oauth',
  'simulated',
  'mock',
  'demo',
  'builtin',
  'builtin_cloud',
]);

const REMOTE_REFRESH_TTL_MS = process.env.VERCEL ? 2000 : 12000;

export function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function generateApiKeyString() {
  return `cldy_sk_${crypto.randomBytes(20).toString('hex')}`;
}

export function normalizeVaultId(raw) {
  const cleaned = String(raw || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  return cleaned || 'default';
}

/**
 * Cryptographically verifies that an account record represents a real,
 * upstream-authenticated cloud storage account — NEVER a simulated/fake/builtin account.
 */
export function isGenuineVerifiedAccount(acc) {
  if (!acc || typeof acc !== 'object') return false;
  if (!VALID_PROVIDER_IDS.has(acc.providerId)) return false;
  if (FORBIDDEN_MODES.has(String(acc.connectionMode || '').toLowerCase())) return false;
  if (!acc.sealedCredentials || typeof acc.sealedCredentials !== 'string') return false;
  const creds = unsealCredentials(acc.sealedCredentials);
  return hasRealUpstreamCredentials(acc.providerId, creds);
}

/**
 * Purges any legacy simulated, builtin, or unverified accounts from a vault state
 * and repairs any fabricated legacy @github.com labels on real GitHub accounts.
 */
export function purgeFakeAccounts(db) {
  if (!db || !Array.isArray(db.accounts)) return false;
  let dirty = false;

  const keptAccounts = [];
  for (const acc of db.accounts) {
    if (!isGenuineVerifiedAccount(acc)) {
      dirty = true;
      continue;
    }
    if (
      acc.providerId === 'github_vault' &&
      typeof acc.email === 'string' &&
      acc.email.endsWith('@github.com')
    ) {
      const creds = unsealCredentials(acc.sealedCredentials);
      const owner = creds?.owner || acc.email.split('@')[0];
      acc.email = `@${owner} · github.com/${owner}`;
      dirty = true;
    }
    keptAccounts.push(acc);
  }

  if (keptAccounts.length !== db.accounts.length) {
    db.accounts = keptAccounts;
    dirty = true;
  }

  const validAccIds = new Set(db.accounts.map((a) => a.id));
  if (Array.isArray(db.files)) {
    const cleanedFiles = [];
    for (const f of db.files) {
      if (f.accountId && !validAccIds.has(f.accountId)) {
        if (f.importedRemote) {
          dirty = true;
          continue;
        }
        if (f.accountId !== 'offline_vault' || f.providerName !== 'Offline Vault') {
          f.accountId = 'offline_vault';
          f.providerId = 'offline_vault';
          f.providerName = 'Offline Vault';
          dirty = true;
        }
      }
      if (f.mirrorAccountId && !validAccIds.has(f.mirrorAccountId)) {
        f.mirrorAccountId = null;
        dirty = true;
      }
      cleanedFiles.push(f);
    }
    db.files = cleanedFiles;
  }

  return dirty;
}

function createInitialState(vaultId) {
  const now = new Date().toISOString();
  fs.mkdirSync(path.join(MOUNTS_DIR, 'offline_vault'), { recursive: true });

  const folderAi = {
    id: 'fld_ai_knowledge',
    name: 'AI Knowledge',
    parentId: null,
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const folderDocs = {
    id: 'fld_documents',
    name: 'Documents',
    parentId: null,
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const quickstartMd = `# Cloudy — X-Kilo

Free Storage. One System. Your Rules.

- **100% Real Cloud Accounts**: Open **Cloud Pool** to connect real storage accounts — GitHub Cloud, Microsoft OneDrive, MEGA (20 GB), pCloud (10 GB), Nextcloud, Google Drive (15 GB), Storj (25 GB), Cloudflare R2, Backblaze B2, Koofr, Box, Dropbox, or Supabase Storage.
- **Online ↔ Offline**: Carpetas, notes, and pinned files sync automatically to your device's IndexedDB Offline Vault.
- **Local AI API**: Open **Local AI API** to connect local AI apps in 1 click or scan your device for installed AI apps.
`;

  const buf = Buffer.from(quickstartMd, 'utf8');
  writeAccountBinary('offline_vault', 'fil_welcome', buf);

  const defaultKey = generateApiKeyString();

  return {
    vaultId,
    settings: {
      allocationRule: 'most_free',
      autoOfflineSync: true,
    },
    oauthApps: {},
    accounts: [],
    folders: [folderAi, folderDocs],
    files: [
      {
        id: 'fil_welcome',
        name: 'Quickstart.md',
        folderId: 'fld_ai_knowledge',
        mimeType: 'text/markdown',
        kind: 'note',
        size: buf.byteLength,
        accountId: 'offline_vault',
        providerId: 'offline_vault',
        providerName: 'Offline Vault',
        mirrorAccountId: null,
        offlinePinned: true,
        starred: false,
        trashed: false,
        tags: ['x-kilo', 'guide'],
        textContent: quickstartMd,
        createdAt: now,
        updatedAt: now,
      },
    ],
    apiKeys: [
      {
        id: 'key_default_local_ai',
        name: 'Local AI Model',
        key: defaultKey,
        keyPrefix: `${defaultKey.slice(0, 14)}...${defaultKey.slice(-4)}`,
        scope: 'read_write',
        allowedFolderIds: [],
        active: true,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: now,
      },
    ],
    aiAuditLog: [],
  };
}

const memoryVaults = new Map();
const hydratedAtMap = new Map();
const pendingRemoteSaves = new Map();
const pendingBinaryUploads = new Set();

async function fetchRemoteVaultState(vaultId) {
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return null;
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/cloudy_vault_states?vault_id=eq.${encodeURIComponent(vaultId)}&select=state_json`,
      {
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.state_json || null;
  } catch {
    return null;
  }
}

function pushRemoteVaultState(vaultId, db) {
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return Promise.resolve();

  const snapshotJson = JSON.stringify({
    vault_id: vaultId,
    user_id: db.ownerUserId || null,
    state_json: db,
    updated_at: new Date().toISOString(),
  });

  const prev = pendingRemoteSaves.get(vaultId) || Promise.resolve();
  const nextPromise = prev
    .catch(() => {})
    .then(async () => {
      await fetch(`${sbUrl}/rest/v1/cloudy_vault_states?on_conflict=vault_id`, {
        method: 'POST',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: snapshotJson,
        signal: AbortSignal.timeout(4000),
      });
      await syncVaultRelationalTables(vaultId, db);
    })
    .catch(() => {})
    .finally(() => {
      if (pendingRemoteSaves.get(vaultId) === nextPromise) {
        pendingRemoteSaves.delete(vaultId);
      }
      hydratedAtMap.set(vaultId, Date.now());
    });

  pendingRemoteSaves.set(vaultId, nextPromise);
  return nextPromise;
}

/**
 * Awaits all in-flight Supabase state & binary persistence operations before serverless functions freeze.
 */
export async function flushPendingSaves() {
  const tasks = [
    ...Array.from(pendingRemoteSaves.values()),
    ...Array.from(pendingBinaryUploads.values()),
  ];
  if (tasks.length === 0) return;
  await Promise.allSettled(tasks);
}

export async function ensureVaultLoaded(rawVaultId = 'default') {
  const vaultId = normalizeVaultId(rawVaultId);
  const inFlightSave = pendingRemoteSaves.get(vaultId);
  if (inFlightSave) {
    await inFlightSave;
  }

  const lastHydratedAt = hydratedAtMap.get(vaultId) || 0;
  const shouldRefreshRemote =
    Boolean(process.env.CLOUDY_SUPABASE_URL && process.env.CLOUDY_SUPABASE_SERVICE_KEY) &&
    Date.now() - lastHydratedAt >= REMOTE_REFRESH_TTL_MS;

  if (shouldRefreshRemote) {
    const remoteState = await fetchRemoteVaultState(vaultId);
    hydratedAtMap.set(vaultId, Date.now());
    if (remoteState && Array.isArray(remoteState.accounts)) {
      const wasDirty = purgeFakeAccounts(remoteState);
      recalcAccountUsage(remoteState);
      memoryVaults.set(vaultId, remoteState);
      const vaultPath = path.join(VAULTS_DIR, `${vaultId}.json`);
      fs.writeFileSync(vaultPath, JSON.stringify(remoteState, null, 2), 'utf8');
      if (wasDirty) {
        await pushRemoteVaultState(vaultId, remoteState);
      }
      return remoteState;
    }
  }
  return loadDb(vaultId);
}

export function loadDb(rawVaultId = 'default') {
  const vaultId = normalizeVaultId(rawVaultId);
  if (memoryVaults.has(vaultId)) {
    const mem = memoryVaults.get(vaultId);
    if (purgeFakeAccounts(mem)) {
      recalcAccountUsage(mem);
      saveDb(vaultId);
    }
    return mem;
  }

  const vaultPath = path.join(VAULTS_DIR, `${vaultId}.json`);
  if (fs.existsSync(vaultPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
      const wasDirty = purgeFakeAccounts(parsed);
      recalcAccountUsage(parsed);
      memoryVaults.set(vaultId, parsed);
      if (wasDirty) saveDb(vaultId);
      return parsed;
    } catch {
      // recreate if corrupted
    }
  }

  const initial = createInitialState(vaultId);
  memoryVaults.set(vaultId, initial);
  saveDb(vaultId);
  return initial;
}

export function saveDb(rawVaultId = 'default') {
  const vaultId = normalizeVaultId(rawVaultId);
  const db = memoryVaults.get(vaultId);
  if (!db) return Promise.resolve();
  purgeFakeAccounts(db);
  recalcAccountUsage(db);
  const vaultPath = path.join(VAULTS_DIR, `${vaultId}.json`);
  fs.writeFileSync(vaultPath, JSON.stringify(db, null, 2), 'utf8');
  return pushRemoteVaultState(vaultId, db);
}

export function findDbByApiKey(token) {
  for (const [, db] of memoryVaults) {
    const matched = db.apiKeys.find((k) => k.key === token && k.active !== false);
    if (matched) return { db, matched };
  }
  if (fs.existsSync(VAULTS_DIR)) {
    for (const file of fs.readdirSync(VAULTS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const vid = file.slice(0, -5);
      const db = loadDb(vid);
      const matched = db.apiKeys.find((k) => k.key === token && k.active !== false);
      if (matched) return { db, matched };
    }
  }
  return null;
}

export async function findDbByApiKeyAsync(token) {
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;

  // On serverless or after TTL expiry, check Supabase first so multi-instance updates are visible immediately
  if (sbUrl && sbKey) {
    const localCandidate = findDbByApiKey(token);
    if (localCandidate) {
      const vid = normalizeVaultId(localCandidate.db.vaultId);
      const freshDb = await ensureVaultLoaded(vid);
      const freshMatch = freshDb.apiKeys.find((k) => k.key === token && k.active !== false);
      if (freshMatch) return { db: freshDb, matched: freshMatch };
    }

    try {
      const res = await fetch(
        `${sbUrl}/rest/v1/cloudy_vault_states?select=vault_id,state_json&limit=100`,
        {
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
          },
        }
      );
      if (res.ok) {
        const rows = await res.json();
        for (const row of rows || []) {
          const state = row.state_json;
          if (!state?.apiKeys) continue;
          const matched = state.apiKeys.find((k) => k.key === token && k.active !== false);
          if (matched) {
            const vid = normalizeVaultId(row.vault_id || state.vaultId);
            purgeFakeAccounts(state);
            recalcAccountUsage(state);
            memoryVaults.set(vid, state);
            hydratedAtMap.set(vid, Date.now());
            return { db: state, matched };
          }
        }
      }
    } catch {
      // fall back to local memory/disk hit
    }
  }

  return findDbByApiKey(token);
}

export function recalcAccountUsage(db) {
  const cloudyUsageMap = new Map();
  for (const f of db.files || []) {
    if (f.trashed || f.importedRemote) continue;
    cloudyUsageMap.set(f.accountId, (cloudyUsageMap.get(f.accountId) || 0) + (f.size || 0));
    if (f.mirrorAccountId) {
      cloudyUsageMap.set(
        f.mirrorAccountId,
        (cloudyUsageMap.get(f.mirrorAccountId) || 0) + (f.size || 0)
      );
    }
  }
  for (const acc of db.accounts || []) {
    const base = Number(acc.baseExternalUsedBytes || 0);
    acc.usedBytes = base + (cloudyUsageMap.get(acc.id) || 0);
  }
}

export function selectTargetAccount(db, fileSize = 0, mimeType = '', preferredAccountId = null) {
  const activeAccounts = (db.accounts || []).filter(
    (a) => a.status === 'connected' && isGenuineVerifiedAccount(a)
  );
  if (activeAccounts.length === 0) {
    const err = new Error(
      'No real cloud storage account connected yet. Open Cloud Pool and sign in to a real provider (GitHub, OneDrive, MEGA, pCloud, Nextcloud, Google Drive, etc.) first.'
    );
    err.code = 'NO_CLOUD_ACCOUNT';
    throw err;
  }

  if (preferredAccountId && preferredAccountId !== 'auto') {
    const chosen = activeAccounts.find((a) => a.id === preferredAccountId);
    if (chosen) return { primary: chosen, mirror: null };
  }

  const candidates = activeAccounts.filter((a) => a.quotaBytes - a.usedBytes >= fileSize);
  const workingPool = candidates.length > 0 ? candidates : activeAccounts;
  const rule = db.settings?.allocationRule || 'most_free';

  if (rule === 'waterfall') {
    const nonFull =
      workingPool.find((a) => a.usedBytes / Math.max(a.quotaBytes, 1) < 0.95) ||
      workingPool[0];
    return { primary: nonFull, mirror: null };
  }

  if (rule === 'by_type') {
    const lowerMime = (mimeType || '').toLowerCase();
    let preferredIds = ['google_drive', 'box', 'onedrive', 'dropbox', 'koofr'];
    if (
      lowerMime.startsWith('image/') ||
      lowerMime.startsWith('video/') ||
      lowerMime.startsWith('audio/') ||
      fileSize > 10 * 1024 * 1024
    ) {
      preferredIds = ['mega', 'storj', 'cloudflare_r2', 'backblaze_b2', 'pcloud'];
    } else if (
      lowerMime.includes('json') ||
      lowerMime.includes('javascript') ||
      lowerMime.includes('python')
    ) {
      preferredIds = ['github_vault', 'cloudflare_r2', 'supabase_storage', 'dropbox'];
    }
    const matched = workingPool.find((a) => preferredIds.includes(a.providerId));
    if (matched) return { primary: matched, mirror: null };
  }

  const sorted = [...workingPool].sort(
    (a, b) => b.quotaBytes - b.usedBytes - (a.quotaBytes - a.usedBytes)
  );
  const primary = sorted[0];
  let mirror = null;
  if (rule === 'mirror' && workingPool.length > 1) {
    mirror = workingPool.find((a) => a.id !== primary.id) || null;
  }
  return { primary, mirror };
}

export function writeAccountBinary(accountId, fileId, buffer, vaultId = 'default', mimeType = 'application/octet-stream') {
  const safeAcc = accountId || 'offline_vault';
  const dir = path.join(MOUNTS_DIR, safeAcc);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileId);
  fs.writeFileSync(filePath, buffer);

  // Durably back up offline_vault binary blobs to Supabase Storage bucket `cloudy-vault` for serverless cold starts
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if (
    safeAcc === 'offline_vault' &&
    fileId !== 'fil_welcome' &&
    sbUrl &&
    sbKey &&
    buffer.byteLength <= 25 * 1024 * 1024
  ) {
    const cleanVid = normalizeVaultId(vaultId);
    const objKey = `offline_blobs/${cleanVid}/${encodeURIComponent(fileId)}`;
    const p = fetch(`${sbUrl}/storage/v1/object/cloudy-vault/${objKey}`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': mimeType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
    })
      .catch(() => {})
      .finally(() => {
        pendingBinaryUploads.delete(p);
      });
    pendingBinaryUploads.add(p);
  }

  return filePath;
}

export function readAccountBinary(accountId, fileId, fallbackAccountId = null) {
  const safeAcc = accountId || 'offline_vault';
  const primaryPath = path.join(MOUNTS_DIR, safeAcc, fileId);
  if (fs.existsSync(primaryPath)) {
    return fs.readFileSync(primaryPath);
  }
  if (fallbackAccountId) {
    const mirrorPath = path.join(MOUNTS_DIR, fallbackAccountId, fileId);
    if (fs.existsSync(mirrorPath)) {
      return fs.readFileSync(mirrorPath);
    }
  }
  return null;
}

export async function readOfflineVaultBinaryAsync(vaultId, fileId) {
  const local = readAccountBinary('offline_vault', fileId);
  if (local) return local;
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return null;
  try {
    const cleanVid = normalizeVaultId(vaultId);
    const objKey = `offline_blobs/${cleanVid}/${encodeURIComponent(fileId)}`;
    const res = await fetch(`${sbUrl}/storage/v1/object/cloudy-vault/${objKey}`, {
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    writeAccountBinary('offline_vault', fileId, buf);
    return buf;
  } catch {
    return null;
  }
}

export function deleteAccountBinary(accountId, fileId, mirrorAccountId = null, vaultId = 'default') {
  for (const accId of [accountId, mirrorAccountId]) {
    if (!accId) continue;
    const p = path.join(MOUNTS_DIR, accId, fileId);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if ((!accountId || accountId === 'offline_vault') && sbUrl && sbKey) {
    const cleanVid = normalizeVaultId(vaultId);
    const objKey = `offline_blobs/${cleanVid}/${encodeURIComponent(fileId)}`;
    const p = fetch(`${sbUrl}/storage/v1/object/cloudy-vault/${objKey}`, {
      method: 'DELETE',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
      },
    })
      .catch(() => {})
      .finally(() => pendingBinaryUploads.delete(p));
    pendingBinaryUploads.add(p);
  }
}

export function addVerifiedProviderAccount(
  db,
  {
    providerId,
    email,
    accountLabel,
    quotaBytes,
    usedBytes,
    credentials,
    connectionMode = 'verified_cloud',
  }
) {
  const meta = getProviderMeta(providerId);
  if (!meta || !VALID_PROVIDER_IDS.has(providerId)) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!hasRealUpstreamCredentials(providerId, credentials)) {
    throw new Error(`Cannot add unverified storage account for ${meta.name}.`);
  }
  if (!email || !String(email).trim()) {
    throw new Error(`Upstream provider did not return a valid account identity.`);
  }

  const now = new Date().toISOString();
  const sealed = sealCredentials(credentials);

  const existing = db.accounts.find(
    (a) =>
      a.providerId === providerId &&
      String(a.email).toLowerCase() === String(email).trim().toLowerCase()
  );

  if (existing) {
    existing.accountLabel = accountLabel || existing.accountLabel;
    existing.email = String(email).trim();
    existing.quotaBytes = quotaBytes;
    existing.baseExternalUsedBytes = usedBytes;
    existing.usedBytes = usedBytes;
    existing.sealedCredentials = sealed;
    existing.connectionMode = connectionMode;
    existing.status = 'connected';
    existing.lastSyncedAt = now;
    saveDb(db.vaultId);
    return existing;
  }

  const id = makeId('acc');
  fs.mkdirSync(path.join(MOUNTS_DIR, id), { recursive: true });

  const account = {
    id,
    providerId: meta.id,
    providerName: meta.name,
    accountLabel: accountLabel || meta.name,
    email: String(email).trim(),
    quotaBytes,
    baseExternalUsedBytes: usedBytes,
    usedBytes,
    sealedCredentials: sealed,
    connectionMode,
    status: 'connected',
    connectedAt: now,
    lastSyncedAt: now,
  };

  db.accounts.push(account);
  saveDb(db.vaultId);
  return account;
}

export function getUnsealedAccount(acc) {
  return {
    ...acc,
    credentials: unsealCredentials(acc.sealedCredentials),
  };
}

export function sanitizeAccount(acc) {
  const { credentials, sealedCredentials, ...safe } = acc;
  return { ...safe, verified: true };
}
