import type {
  FolderItem,
  FileItem,
  AiApiKey,
  StorageAccount,
  VaultState,
  SyncQueueAction,
} from '../types';

const DB_NAME = 'cloudy_offline_vault';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let lastPersistedFingerprint: string | null = null;

export function computeVaultFingerprint(state: VaultState): string {
  const accPart = (state.accounts || [])
    .map((a) => `${a.id}:${a.usedBytes}:${a.quotaBytes}:${a.lastSyncedAt || ''}`)
    .join('|');
  const fldPart = (state.folders || [])
    .map(
      (f) =>
        `${f.id}:${f.name}:${f.parentId || ''}:${f.trashed ? 1 : 0}:${f.starred ? 1 : 0}:${f.updatedAt}`
    )
    .join('|');
  const filPart = (state.files || [])
    .map(
      (f) =>
        `${f.id}:${f.name}:${f.folderId || ''}:${f.accountId}:${f.size}:${f.trashed ? 1 : 0}:${f.starred ? 1 : 0}:${f.pendingOfflineSync ? 1 : 0}:${f.updatedAt}`
    )
    .join('|');
  const keyPart = (state.apiKeys || [])
    .map((k) => `${k.id}:${k.active ? 1 : 0}:${k.usageCount}:${k.lastUsedAt || ''}`)
    .join('|');
  const logLen = state.aiAuditLog?.length || 0;
  return `${state.vaultId || ''}#${state.settings?.allocationRule || ''}#${accPart}#${fldPart}#${filPart}#${keyPart}#${logLen}`;
}

export function openVaultDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('api_keys')) {
        db.createObjectStore('api_keys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function putStoreItem<T>(storeName: string, item: T): Promise<void> {
  if (storeName !== 'blobs') lastPersistedFingerprint = null;
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteStoreItem(storeName: string, id: string): Promise<void> {
  if (storeName !== 'blobs') lastPersistedFingerprint = null;
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllStoreItems<T>(storeName: string): Promise<T[]> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStoreKeys(storeName: string): Promise<string[]> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    if (typeof store.getAllKeys === 'function') {
      const req = store.getAllKeys();
      req.onsuccess = () =>
        resolve(((req.result as IDBValidKey[]) || []).map((k) => String(k)));
      req.onerror = () => reject(req.error);
    } else {
      const req = store.getAll();
      req.onsuccess = () =>
        resolve(
          ((req.result as Array<{ id?: string }>) || [])
            .map((r) => String(r?.id || ''))
            .filter(Boolean)
        );
      req.onerror = () => reject(req.error);
    }
  });
}

export async function getStoreItem<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => reject(tx.error);
  });
}

export async function persistSnapshotToOfflineVault(state: VaultState): Promise<void> {
  const nextFp = computeVaultFingerprint(state);
  if (lastPersistedFingerprint === nextFp) {
    return;
  }

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      ['folders', 'files', 'api_keys', 'accounts', 'meta'],
      'readwrite'
    );

    const foldersStore = tx.objectStore('folders');
    foldersStore.clear();
    for (const item of state.folders) foldersStore.put(item);

    const filesStore = tx.objectStore('files');
    filesStore.clear();
    for (const item of state.files) filesStore.put(item);

    const keysStore = tx.objectStore('api_keys');
    keysStore.clear();
    for (const item of state.apiKeys) keysStore.put(item);

    const accountsStore = tx.objectStore('accounts');
    accountsStore.clear();
    for (const item of state.accounts) accountsStore.put(item);

    tx.objectStore('meta').put({
      key: 'vault_snapshot_meta',
      vaultId: state.vaultId || null,
      settings: state.settings,
      summary: state.summary,
      providersCatalog: state.providersCatalog,
      aiAuditLog: state.aiAuditLog,
      savedAt: new Date().toISOString(),
    });

    tx.oncomplete = () => {
      lastPersistedFingerprint = nextFp;
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllOfflineStores(): Promise<void> {
  lastPersistedFingerprint = null;
  const db = await openVaultDb();
  const storeNames = ['folders', 'files', 'blobs', 'api_keys', 'accounts', 'sync_queue', 'meta'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    for (const s of storeNames) {
      if (db.objectStoreNames.contains(s)) {
        tx.objectStore(s).clear();
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function ensureOfflineVaultMatchesId(expectedVaultId: string): Promise<void> {
  const meta = await getStoreItem<{ key: string; vaultId?: string | null }>(
    'meta',
    'vault_snapshot_meta'
  );
  if (meta?.vaultId && expectedVaultId && meta.vaultId !== expectedVaultId) {
    await clearAllOfflineStores();
  }
}

export async function loadOfflineSnapshot(): Promise<VaultState | null> {
  const meta = await getStoreItem<{
    key: string;
    vaultId?: string | null;
    settings: VaultState['settings'];
    summary: VaultState['summary'];
    providersCatalog: VaultState['providersCatalog'];
    aiAuditLog: VaultState['aiAuditLog'];
  }>('meta', 'vault_snapshot_meta');

  if (!meta) return null;

  const [folders, files, apiKeys, accounts, blobKeys] = await Promise.all([
    getAllStoreItems<FolderItem>('folders'),
    getAllStoreItems<FileItem>('files'),
    getAllStoreItems<AiApiKey>('api_keys'),
    getAllStoreItems<StorageAccount>('accounts'),
    getAllStoreKeys('blobs'),
  ]);

  const cachedBlobIds = new Set(blobKeys);

  return {
    vaultId: meta.vaultId || undefined,
    settings: meta.settings,
    summary: meta.summary,
    providersCatalog: meta.providersCatalog || [],
    accounts,
    folders,
    files: files.map((f) => ({
      ...f,
      offlineCached: cachedBlobIds.has(f.id) || Boolean(f.textContent),
    })),
    apiKeys,
    aiAuditLog: meta.aiAuditLog || [],
  };
}

export async function saveOfflineBlob(
  fileId: string,
  blob: Blob,
  updatedAt: string
): Promise<void> {
  await putStoreItem('blobs', { id: fileId, blob, updatedAt });
}

export async function getOfflineBlob(
  fileId: string
): Promise<{ id: string; blob: Blob; updatedAt: string } | null> {
  return getStoreItem('blobs', fileId);
}

export async function getCachedBlobIds(): Promise<Set<string>> {
  const keys = await getAllStoreKeys('blobs');
  return new Set(keys);
}

export async function enqueueOfflineAction(action: SyncQueueAction): Promise<void> {
  await putStoreItem('sync_queue', action);
}

export async function getOfflineQueue(): Promise<SyncQueueAction[]> {
  const list = await getAllStoreItems<SyncQueueAction>('sync_queue');
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  await deleteStoreItem('sync_queue', id);
}
