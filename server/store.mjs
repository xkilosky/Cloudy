import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getProviderMeta } from './providers.mjs';

export const DATA_DIR = process.env.VERCEL
  ? '/tmp/cloudy-data'
  : path.resolve('data');
export const MOUNTS_DIR = path.join(DATA_DIR, 'mounts');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');

fs.mkdirSync(MOUNTS_DIR, { recursive: true });

function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function generateApiKeyString() {
  return `cldy_sk_${crypto.randomBytes(20).toString('hex')}`;
}

function createInitialState() {
  const now = new Date().toISOString();
  const coreAccountId = 'acc_xkilo_core';
  fs.mkdirSync(path.join(MOUNTS_DIR, coreAccountId), { recursive: true });

  const folderAi = {
    id: 'fld_ai_knowledge',
    name: 'AI Knowledge Base',
    parentId: null,
    color: '#38B6FF',
    offlinePinned: true,
    starred: true,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const folderProjects = {
    id: 'fld_projects',
    name: 'Projects & Specs',
    parentId: null,
    color: '#8B5CF6',
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const folderPersonal = {
    id: 'fld_personal',
    name: 'Personal Carpetas',
    parentId: null,
    color: '#10B981',
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const folderPrompts = {
    id: 'fld_prompts',
    name: 'Local Model Prompts',
    parentId: 'fld_ai_knowledge',
    color: '#F59E0B',
    offlinePinned: true,
    starred: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };

  const welcomeMd = `# Welcome to Cloudy by X-Kilo ☁️

**Free Storage. One System. Your Rules.**

Cloudy unifies free cloud storage tiers from multiple providers into a single encrypted, offline-ready file & folder ("carpetas") system.

## Key Capabilities
1. **Stack Free Storage (128+ GB Pool)** — Connect Google Drive (15 GB), MEGA (20 GB), Box (10 GB), pCloud (10 GB), Cloudflare R2 (10 GB), Backblaze B2 (10 GB), Koofr (10 GB), MediaFire (10 GB), Filen (10 GB), OneDrive (5 GB), Proton Drive (5 GB), Yandex Disk (5 GB), GitHub Vault (5 GB), Dropbox (2 GB), and Supabase Storage (1 GB) via **One-Time OAuth**.
2. **True Online ↔ Offline Access** — Every folder ("carpeta"), file, note, and dataset you add while online is automatically cached in your local IndexedDB Offline Vault so you can browse, preview, edit, and download with zero internet.
3. **Local Offline AI REST API Keys** — Generate scoped \`cldy_sk_...\` keys so local models (Ollama, llama.cpp, LM Studio, Python scripts, Termux on Android) can search and read your offline files securely.
4. **Android Ready** — Install directly as an offline Android app (WebAPK) or build/download the native Android \`.apk\`.
`;

  const specMd = `# X-Kilo Cloudy — Storage Orchestration Spec

## Smart Allocation Rules ("Your Rules")
- **Most Free Space First (\`most_free\`)**: Automatically routes each upload to whichever connected provider account has the largest remaining free quota.
- **Waterfall Spillover (\`waterfall\`)**: Fills providers in priority sequence up to 95% capacity before overflowing seamlessly to the next drive.
- **File-Type Smart Routing (\`by_type\`)**: Sends Markdown/Docs/PDFs to Google Drive or Box, large media/archives to MEGA or Cloudflare R2, and code/JSON datasets to GitHub Vault.
- **2x Redundant Mirror (\`mirror\`)**: Writes a primary copy and a redundant mirror copy across two separate cloud providers simultaneously.
`;

  const ragJson = JSON.stringify(
    {
      company: 'X-Kilo',
      project: 'Cloudy',
      motto: 'Free Storage. One System. Your Rules.',
      offlineSync: true,
      supportedLocalModels: ['Ollama (llama3.2, qwen2.5, deepseek-r1)', 'llama.cpp', 'LM Studio', 'LocalAI'],
      sampleFacts: [
        'Cloudy pools up to 128 GB+ of free storage on first account per provider and unlimited storage across multiple accounts.',
        'Folders and files created online automatically persist to IndexedDB for instant offline access.',
        'Scoped cldy_sk_ API keys restrict local AI models to specific folders with read or read_write access.',
      ],
    },
    null,
    2
  );

  const promptTemplate = `You are a local offline AI assistant powered by X-Kilo Cloudy.
Use the context retrieved from the user's offline Cloudy folders via GET /api/v1/ai/search and GET /api/v1/ai/files/:id/content to answer accurately and cite exact filenames.`;

  const starterFilesRaw = [
    {
      id: 'fil_welcome',
      name: 'Welcome-to-Cloudy.md',
      folderId: null,
      mimeType: 'text/markdown',
      kind: 'note',
      content: welcomeMd,
      starred: true,
      tags: ['x-kilo', 'guide', 'offline'],
    },
    {
      id: 'fil_arch_spec',
      name: 'X-Kilo-Storage-Rules.md',
      folderId: 'fld_projects',
      mimeType: 'text/markdown',
      kind: 'note',
      content: specMd,
      starred: false,
      tags: ['architecture', 'storage', 'providers'],
    },
    {
      id: 'fil_rag_dataset',
      name: 'Cloudy-AI-Context.json',
      folderId: 'fld_ai_knowledge',
      mimeType: 'application/json',
      kind: 'dataset',
      content: ragJson,
      starred: true,
      tags: ['ai', 'rag', 'dataset', 'x-kilo'],
    },
    {
      id: 'fil_system_prompt',
      name: 'Ollama-Offline-System-Prompt.txt',
      folderId: 'fld_prompts',
      mimeType: 'text/plain',
      kind: 'note',
      content: promptTemplate,
      starred: false,
      tags: ['ollama', 'prompt', 'local-llm'],
    },
  ];

  const files = [];
  let totalCoreUsed = 0;

  for (const item of starterFilesRaw) {
    const buf = Buffer.from(item.content, 'utf8');
    const storagePath = path.join(MOUNTS_DIR, coreAccountId, item.id);
    fs.writeFileSync(storagePath, buf);
    totalCoreUsed += buf.byteLength;

    files.push({
      id: item.id,
      name: item.name,
      folderId: item.folderId,
      mimeType: item.mimeType,
      kind: item.kind,
      size: buf.byteLength,
      accountId: coreAccountId,
      providerId: 'xkilo_core',
      providerName: 'Cloudy Core Vault',
      mirrorAccountId: null,
      offlinePinned: true,
      starred: item.starred,
      trashed: false,
      tags: item.tags,
      textContent: item.content,
      createdAt: now,
      updatedAt: now,
    });
  }

  const defaultKey = generateApiKeyString();

  return {
    settings: {
      allocationRule: 'most_free', // 'most_free' | 'waterfall' | 'by_type' | 'mirror'
      autoOfflineSync: true,
    },
    oauthApps: {}, // optional live clientId/clientSecret keyed by providerId
    accounts: [
      {
        id: coreAccountId,
        providerId: 'xkilo_core',
        providerName: 'Cloudy Core Vault',
        accountLabel: 'X-Kilo Local & Cloud Core',
        email: 'vault@x-kilo.cloudy',
        quotaBytes: 5 * 1024 * 1024 * 1024,
        usedBytes: totalCoreUsed,
        color: '#38B6FF',
        connectionMode: 'builtin',
        oneTimeOAuth: true,
        status: 'connected',
        connectedAt: now,
        lastSyncedAt: now,
      },
    ],
    folders: [folderAi, folderProjects, folderPersonal, folderPrompts],
    files,
    apiKeys: [
      {
        id: 'key_default_local_ai',
        name: 'Local Offline AI (Ollama / Python)',
        key: defaultKey,
        keyPrefix: `${defaultKey.slice(0, 14)}...${defaultKey.slice(-4)}`,
        scope: 'read_write',
        allowedFolderIds: [], // empty = all offline folders & files allowed
        active: true,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: now,
      },
    ],
    aiAuditLog: [],
  };
}

let dbCache = null;

export function loadDb() {
  if (dbCache) return dbCache;
  if (fs.existsSync(VAULT_FILE)) {
    try {
      dbCache = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      recalcAccountUsage(dbCache);
      return dbCache;
    } catch (e) {
      console.error('Failed to parse vault.json, re-initializing:', e);
    }
  }
  dbCache = createInitialState();
  saveDb();
  return dbCache;
}

export function saveDb() {
  if (!dbCache) return;
  recalcAccountUsage(dbCache);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(dbCache, null, 2), 'utf8');
}

export function recalcAccountUsage(db) {
  const usageMap = new Map();
  for (const f of db.files) {
    if (f.trashed) continue;
    usageMap.set(f.accountId, (usageMap.get(f.accountId) || 0) + (f.size || 0));
    if (f.mirrorAccountId) {
      usageMap.set(f.mirrorAccountId, (usageMap.get(f.mirrorAccountId) || 0) + (f.size || 0));
    }
  }
  for (const acc of db.accounts) {
    acc.usedBytes = usageMap.get(acc.id) || 0;
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

  // Prefer external free cloud providers over core vault when connected so user sees multi-cloud pooling in action
  const externalPool = pool.length > 1 ? pool.filter((a) => a.providerId !== 'xkilo_core') : pool;
  const workingPool = externalPool.length > 0 ? externalPool : pool;

  if (rule === 'waterfall') {
    const nonFull = workingPool.find((a) => a.usedBytes / a.quotaBytes < 0.95) || workingPool[0];
    return { primary: nonFull, mirror: null };
  }

  if (rule === 'by_type') {
    const lowerMime = (mimeType || '').toLowerCase();
    let preferredIds = ['google_drive', 'box', 'onedrive', 'dropbox'];
    if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/') || fileSize > 10 * 1024 * 1024) {
      preferredIds = ['mega', 'cloudflare_r2', 'backblaze_b2', 'pcloud', 'mediafire'];
    } else if (lowerMime.includes('json') || lowerMime.includes('javascript') || lowerMime.includes('python')) {
      preferredIds = ['github_vault', 'cloudflare_r2', 'supabase_storage', 'dropbox'];
    }
    const matched = workingPool.find((a) => preferredIds.includes(a.providerId));
    if (matched) return { primary: matched, mirror: null };
  }

  // Default & mirror base: sort descending by remaining free bytes
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

export function connectProviderAccount(db, { providerId, accountLabel, email, connectionMode = 'one_time_oauth', tokens = {} }) {
  const meta = getProviderMeta(providerId);
  if (!meta) throw new Error(`Unknown provider: ${providerId}`);

  const now = new Date().toISOString();
  const id = makeId('acc');
  fs.mkdirSync(path.join(MOUNTS_DIR, id), { recursive: true });

  const existingSameProvider = db.accounts.filter((a) => a.providerId === providerId).length;
  const defaultLabel =
    accountLabel?.trim() ||
    (existingSameProvider > 0 ? `${meta.name} #${existingSameProvider + 1}` : meta.name);

  const account = {
    id,
    providerId: meta.id,
    providerName: meta.name,
    accountLabel: defaultLabel,
    email: email?.trim() || `connected@${meta.id.replace('_', '')}.oauth`,
    quotaBytes: meta.freeBytes,
    usedBytes: 0,
    color: meta.color,
    connectionMode,
    oneTimeOAuth: true,
    refreshTokenPersisted: true,
    accessToken: tokens.accessToken || `ot_${crypto.randomBytes(12).toString('hex')}`,
    refreshToken: tokens.refreshToken || `rt_${crypto.randomBytes(18).toString('hex')}`,
    expiresAt: tokens.expiresAt || null,
    status: 'connected',
    connectedAt: now,
    lastSyncedAt: now,
  };

  db.accounts.push(account);
  saveDb();
  return account;
}

export function sanitizeAccount(acc) {
  const { accessToken, refreshToken, ...safe } = acc;
  return {
    ...safe,
    hasRefreshToken: Boolean(refreshToken || acc.refreshTokenPersisted),
  };
}

export { makeId };
