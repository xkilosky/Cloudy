import type { VaultState, FileItem } from '../types';
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
        state: offlineState,
        isOffline: true,
        pendingQueueCount: queue.length,
      };
    }
  }

  try {
    const queue = await getOfflineQueue();
    for (const action of queue) {
      try {
        if (action.type === 'create_folder') {
          await apiFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'create_note') {
          await apiFetch('/api/files/note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'update_file') {
          const { fileId, ...rest } = action.payload;
          await apiFetch(`/api/files/${fileId}`, {
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
          await apiFetch('/api/files/upload', { method: 'POST', body: fd });
        }
        await removeOfflineQueueItem(action.id);
      } catch {
        // Retry next sync
      }
    }

    const localSnap = await loadOfflineSnapshot();
    const res = await apiFetch('/api/vault/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = (await res.json()) as VaultState;

    if (localSnap) {
      const serverAccIds = new Set(data.accounts.map((a) => a.id));
      const serverFileIds = new Set(data.files.map((f) => f.id));
      const missingAccs = localSnap.accounts.filter(
        (a) => a.providerId !== 'xkilo_core' && !serverAccIds.has(a.id)
      );
      const missingFiles = localSnap.files.filter((f) => !serverFileIds.has(f.id));
      if (missingAccs.length > 0 || missingFiles.length > 0) {
        await apiFetch('/api/vault/hydrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: localSnap.settings,
            accounts: localSnap.accounts,
            folders: localSnap.folders,
            files: localSnap.files,
            apiKeys: localSnap.apiKeys,
          }),
        });
        const reRes = await apiFetch('/api/vault/state');
        if (reRes.ok) {
          data = (await reRes.json()) as VaultState;
        }
      }
    }

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
        state: fallback,
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
