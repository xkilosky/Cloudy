import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getProviderMeta } from './providers.mjs';
import { sealCredentials, unsealCredentials } from './cloudAdapters.mjs';

export const DATA_DIR = process.env.VERCEL
  ? '/tmp/cloudy-data'
  : path.resolve('data');
export const VAULTS_DIR = path.join(DATA_DIR, 'vaults');
export const MOUNTS_DIR = path.join(DATA_DIR, 'mounts');

fs.mkdirSync(VAULTS_DIR, { recursive: true });
fs.mkdirSync(MOUNTS_DIR, { recursive: true });

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

function createInitialState(vaultId) {
  const now = new Date().toISOString();
  const coreAccountId = `acc_local_${vaultId.slice(0, 12)}`;
  fs.mkdirSync(path.join(MOUNTS_DIR, coreAccountId), { recursive: true });

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

- **Real Cloud Storage**: Open **Storage** to connect MEGA (20 GB), Google Drive (15 GB), Storj (25 GB), Cloudflare R2 (10 GB), Backblaze B2 (10 GB), Box (10 GB), Koofr (10 GB), OneDrive (5 GB), GitHub, Dropbox, or Supabase Storage.
- **Online ↔ Offline**: Files and carpetas added online automatically sync to your device's IndexedDB Offline Vault.
- **Local AI API**: Open **AI API** to copy your \`cldy_sk_...\` key for Ollama, llama.cpp, or Python scripts.
`;

  const buf = Buffer.from(quickstartMd, 'utf8');
  writeAccountBinary(coreAccountId, 'fil_welcome', buf);

  const defaultKey = generateApiKeyString();

  return {
    vaultId,
    settings: {
      allocationRule: 'most_free',
      autoOfflineSync: true,
    },
    oauthApps: {},
    accounts: [
      {
        id: coreAccountId,
        providerId: 'xkilo_core',
        providerName: 'Local Vault',
        accountLabel: 'Local Device Vault',
        email: 'Offline + Local Cache',
        quotaBytes: 5 * 1024 * 1024 * 1024,
        usedBytes: buf.byteLength,
        baseExternalUsedBytes: 0,
        connectionMode: 'builtin',
        status: 'connected',
        connectedAt: now,
        lastSyncedAt: now,
      },
    ],
    folders: [folderAi, folderDocs],
    files: [
      {
        id: 'fil_welcome',
        name: 'Quickstart.md',
        folderId: 'fld_ai_knowledge',
        mimeType: 'text/markdown',
        kind: 'note',
        size: buf.byteLength,
        accountId: coreAccountId,
        providerId: 'xkilo_core',
        providerName: 'Local Vault',
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

export function loadDb(rawVaultId = 'default') {
  const vaultId = normalizeVaultId(rawVaultId);
  if (memoryVaults.has(vaultId)) return memoryVaults.get(vaultId);

  const vaultPath = path.join(VAULTS_DIR, `${vaultId}.json`);
  if (fs.existsSync(vaultPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
      recalcAccountUsage(parsed);
      memoryVaults.set(vaultId, parsed);
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
  if (!db) return;
  recalcAccountUsage(db);
  const vaultPath = path.join(VAULTS_DIR, `${vaultId}.json`);
  fs.writeFileSync(vaultPath, JSON.stringify(db, null, 2), 'utf8');
}

export function findDbByApiKey(token) {
  // Check loaded vaults first
  for (const [, db] of memoryVaults) {
    const matched = db.apiKeys.find((k) => k.key === token && k.active !== false);
    if (matched) return { db, matched };
  }
  // Scan saved vault files on disk
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

export function recalcAccountUsage(db) {
  const cloudyUsageMap = new Map();
  for (const f of db.files) {
    if (f.trashed || f.importedRemote) continue;
    cloudyUsageMap.set(f.accountId, (cloudyUsageMap.get(f.accountId) || 0) + (f.size || 0));
    if (f.mirrorAccountId) {
      cloudyUsageMap.set(
        f.mirrorAccountId,
        (cloudyUsageMap.get(f.mirrorAccountId) || 0) + (f.size || 0)
      );
    }
  }
  for (const acc of db.accounts) {
    const base = Number(acc.baseExternalUsedBytes || 0);
    acc.usedBytes = base + (cloudyUsageMap.get(acc.id) || 0);
  }
}

export function selectTargetAccount(db, fileSize = 0, mimeType = '', preferredAccountId = null) {
  const activeAccounts = db.accounts.filter((a) => a.status === 'connected');
  if (activeAccounts.length === 0) {
    throw new Error('No connected storage accounts available');
  }

  if (preferredAccountId && preferredAccountId !== 'auto') {
    const chosen = activeAccounts.find((a) => a.id === preferredAccountId);
    if (chosen) return { primary: chosen, mirror: null };
  }

  const candidates = activeAccounts.filter((a) => a.quotaBytes - a.usedBytes >= fileSize);
  const pool = candidates.length > 0 ? candidates : activeAccounts;
  const rule = db.settings?.allocationRule || 'most_free';

  // Prefer connected real external cloud providers over local device vault
  const externalPool = pool.filter((a) => a.providerId !== 'xkilo_core');
  const workingPool = externalPool.length > 0 ? externalPool : pool;

  if (rule === 'waterfall') {
    const nonFull = workingPool.find((a) => a.usedBytes / Math.max(a.quotaBytes, 1) < 0.95) || workingPool[0];
    return { primary: nonFull, mirror: null };
  }

  if (rule === 'by_type') {
    const lowerMime = (mimeType || '').toLowerCase();
    let preferredIds = ['google_drive', 'box', 'onedrive', 'dropbox', 'koofr'];
    if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/') || fileSize > 10 * 1024 * 1024) {
      preferredIds = ['mega', 'storj', 'cloudflare_r2', 'backblaze_b2', 'pcloud'];
    } else if (lowerMime.includes('json') || lowerMime.includes('javascript') || lowerMime.includes('python')) {
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
  if (rule === 'mirror' && pool.length > 1) {
    mirror = pool.find((a) => a.id !== primary.id) || null;
  }
  return { primary, mirror };
}

export function writeAccountBinary(accountId, fileId, buffer) {
  const dir = path.join(MOUNTS_DIR, accountId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileId);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function readAccountBinary(accountId, fileId, fallbackAccountId = null) {
  const primaryPath = path.join(MOUNTS_DIR, accountId, fileId);
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

export function deleteAccountBinary(accountId, fileId, mirrorAccountId = null) {
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
}

export function addVerifiedProviderAccount(
  db,
  { providerId, email, accountLabel, quotaBytes, usedBytes, credentials, connectionMode = 'verified_cloud' }
) {
  const meta = getProviderMeta(providerId);
  if (!meta) throw new Error(`Unknown provider: ${providerId}`);

  const now = new Date().toISOString();
  const sealed = sealCredentials(credentials);

  // Update existing account if same provider + email reconnected
  const existing = db.accounts.find(
    (a) => a.providerId === providerId && a.email.toLowerCase() === String(email).toLowerCase()
  );

  if (existing) {
    existing.accountLabel = accountLabel || existing.accountLabel;
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
    email,
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
  const { credentials, ...safe } = acc;
  return safe;
}
