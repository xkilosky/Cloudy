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

export async function syncVaultState(forceOfflineMode: boolean): Promise<{
  state: VaultState;
  isOffline: boolean;
  pendingQueueCount: number;
}> {
  if (forceOfflineMode || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    const offlineState = await loadOfflineSnapshot();
    const queue = await getOfflineQueue();
    if (offlineState) {
      return {
        state: sanitizeOfflineSnapshot(offlineState),
        isOffline: true,
        pendingQueueCount: queue.length,
      };
    }
  }

  try {
    const queue = await getOfflineQueue();
    for (const action of queue) {
      try {
        let resp: Response | null = null;
        if (action.type === 'create_folder') {
          resp = await apiFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
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

        if (!resp || resp.ok) {
          await removeOfflineQueueItem(action.id);
        } else {
          // If no cloud account connected yet for binary upload, keep queued until user connects one
          const body = await resp.json().catch(() => ({}));
          if (body?.code !== 'NO_CLOUD_ACCOUNT') {
            await removeOfflineQueueItem(action.id);
          }
        }
      } catch {
        // Network error — retry next sync
      }
    }

    const res = await apiFetch('/api/vault/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = sanitizeOfflineSnapshot((await res.json()) as VaultState);

    await persistSnapshotToOfflineVault(data);
    await cacheOfflinePinnedBlobs(data.files);

    const cachedIds = await getCachedBlobIds();
    const enrichedFiles = data.files.map((f) => ({
      ...f,
      offlineCached: cachedIds.has(f.id) || Boolean(f.textContent),
    }));

    const remainingQueue = await getOfflineQueue();
    return {
      state: { ...data, files: enrichedFiles },
      isOffline: false,
      pendingQueueCount: remainingQueue.length,
    };
  } catch {
    const fallback = await loadOfflineSnapshot();
    const queue = await getOfflineQueue();
    if (fallback) {
      return {
        state: sanitizeOfflineSnapshot(fallback),
        isOffline: true,
        pendingQueueCount: queue.length,
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
