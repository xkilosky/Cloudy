import type { VaultState, FileItem, StorageAccount } from '../types';
import { apiFetch } from './vaultClient';
import {
  persistSnapshotToOfflineVault,
  loadOfflineSnapshot,
  saveOfflineBlob,
  getOfflineBlob,
  getCachedBlobIds,
  getOfflineQueue,
  removeOfflineQueueItem,
  getAllStoreItems,
  putStoreItem,
} from './offlineDb';

const FORBIDDEN_MODES = new Set([
  'one_time_oauth',
  'simulated',
  'mock',
  'demo',
  'builtin',
  'builtin_cloud',
]);

function filterRealAccounts(accounts: StorageAccount[]): StorageAccount[] {
  return (accounts || []).filter(
    (a) =>
      a &&
      a.providerId !== 'xkilo_core' &&
      a.providerId !== 'offline_vault' &&
      !FORBIDDEN_MODES.has(String(a.connectionMode || '').toLowerCase()) &&
      Boolean(a.verified || a.sealedCredentials)
  );
}

function sanitizeOfflineSnapshot(snap: VaultState): VaultState {
  const realAccounts = filterRealAccounts(snap.accounts);
  const totalQuotaBytes = realAccounts.reduce((s, a) => s + (a.quotaBytes || 0), 0);
  const totalUsedBytes = realAccounts.reduce((s, a) => s + (a.usedBytes || 0), 0);
  return {
    ...snap,
    accounts: realAccounts,
    summary: {
      ...snap.summary,
      totalQuotaBytes,
      totalUsedBytes,
      connectedProvidersCount: realAccounts.length,
    },
  };
}

export interface SyncVaultResult {
  state: VaultState;
  isOffline: boolean;
  pendingQueueCount: number;
  flushedQueueCount: number;
  syncedAt: string | null;
}

let inFlightOnlineSync: Promise<SyncVaultResult> | null = null;

export async function syncVaultState(forceOfflineMode: boolean): Promise<SyncVaultResult> {
  if (forceOfflineMode || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    const offlineState = await loadOfflineSnapshot();
    const queue = await getOfflineQueue();
    if (offlineState) {
      return {
        state: sanitizeOfflineSnapshot(offlineState),
        isOffline: true,
        pendingQueueCount: queue.length,
        flushedQueueCount: 0,
        syncedAt: null,
      };
    }
  }

  // Deduplicate concurrent online sync calls so background auto-sync never double-replays queue items
  if (inFlightOnlineSync) {
    return inFlightOnlineSync;
  }

  inFlightOnlineSync = runOnlineSyncCycle().finally(() => {
    inFlightOnlineSync = null;
  });

  return inFlightOnlineSync;
}

async function runOnlineSyncCycle(): Promise<SyncVaultResult> {
  try {
    const localFilesBefore = await getAllStoreItems<FileItem>('files').catch(() => []);
    const queue = await getOfflineQueue();
    let flushedQueueCount = 0;

    for (const action of queue) {
      try {
        let resp: Response | null = null;
        if (action.type === 'create_folder') {
          resp = await apiFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'update_folder') {
          const { folderId, ...rest } = action.payload;
          resp = await apiFetch(`/api/folders/${folderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rest),
          });
        } else if (action.type === 'delete_folder') {
          resp = await apiFetch(`/api/folders/${action.payload.folderId}`, {
            method: 'DELETE',
          });
        } else if (action.type === 'create_note') {
          resp = await apiFetch('/api/files/note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'update_file') {
          const { fileId, ...rest } = action.payload;
          resp = await apiFetch(`/api/files/${fileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rest),
          });
        } else if (action.type === 'delete_file') {
          resp = await apiFetch(`/api/files/${action.payload.fileId}`, {
            method: 'DELETE',
          });
        } else if (action.type === 'upload_file' && action.blob) {
          const fd = new FormData();
          fd.append(
            'files',
            action.blob,
            String(action.payload.name || 'offline-upload.bin')
          );
          if (action.payload.folderId) {
            fd.append('folderId', String(action.payload.folderId));
          }
          if (action.payload.id) {
            fd.append('clientFileId', String(action.payload.id));
          }
          resp = await apiFetch('/api/files/upload', { method: 'POST', body: fd });
        }

        if (!resp || resp.ok || resp.status === 404) {
          await removeOfflineQueueItem(action.id);
          flushedQueueCount += 1;
        } else {
          // Keep binary upload queued if user hasn't connected a real cloud account yet
          const body = await resp.json().catch(() => ({}));
          if (body?.code !== 'NO_CLOUD_ACCOUNT') {
            await removeOfflineQueueItem(action.id);
          }
        }
      } catch {
        // Transient network error — retry on next live auto-sync tick
      }
    }

    const res = await apiFetch('/api/vault/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = sanitizeOfflineSnapshot((await res.json()) as VaultState);

    const remainingQueue = await getOfflineQueue();
    const pendingUploadIds = new Set(
      remainingQueue
        .filter((q) => q.type === 'upload_file' && q.payload?.id)
        .map((q) => String(q.payload.id))
    );

    const serverFileIds = new Set(data.files.map((f) => f.id));
    const preservedPendingFiles = localFilesBefore.filter(
      (lf) => pendingUploadIds.has(lf.id) && !serverFileIds.has(lf.id)
    );
    const combinedFiles = [...preservedPendingFiles, ...data.files];

    await persistSnapshotToOfflineVault({
      ...data,
      files: combinedFiles,
    });
    for (const pf of preservedPendingFiles) {
      await putStoreItem('files', pf);
    }

    await cacheOfflinePinnedBlobs(data.files);

    const cachedIds = await getCachedBlobIds();
    const enrichedFiles = combinedFiles.map((f) => ({
      ...f,
      offlineCached: cachedIds.has(f.id) || Boolean(f.textContent),
    }));

    return {
      state: { ...data, files: enrichedFiles },
      isOffline: false,
      pendingQueueCount: remainingQueue.length,
      flushedQueueCount,
      syncedAt: new Date().toISOString(),
    };
  } catch {
    const fallback = await loadOfflineSnapshot();
    const queue = await getOfflineQueue();
    if (fallback) {
      return {
        state: sanitizeOfflineSnapshot(fallback),
        isOffline: true,
        pendingQueueCount: queue.length,
        flushedQueueCount: 0,
        syncedAt: null,
      };
    }
    throw new Error('Offline and no cached vault available.');
  }
}

async function cacheOfflinePinnedBlobs(files: FileItem[]): Promise<void> {
  const pinned = files.filter(
    (f) => !f.trashed && f.offlinePinned !== false && f.size <= 15 * 1024 * 1024
  );
  await Promise.all(
    pinned.slice(0, 25).map(async (f) => {
      try {
        const existing = await getOfflineBlob(f.id);
        if (existing && existing.updatedAt === f.updatedAt) return;
        const resp = await apiFetch(`/api/files/${f.id}/blob`);
        if (resp.ok) {
          const blob = await resp.blob();
          await saveOfflineBlob(f.id, blob, f.updatedAt);
        }
      } catch {
        // Ignore transient cache miss
      }
    })
  );
}
