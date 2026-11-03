import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderClosed,
  Cloud,
  KeyRound,
  Database,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';
import type {
  AuthUser,
  VaultState,
  FileItem,
  FolderItem,
  AllocationRule,
  AiApiKey,
} from './types';
import { Sidebar, type NavTab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DriveExplorer } from './components/DriveExplorer';
import { FilePreviewModal } from './components/FilePreviewModal';
import { ProvidersHub } from './components/ProvidersHub';
import { AiApiKeysView } from './components/AiApiKeysView';
import { AuthView } from './components/AuthView';
import { DatabaseView } from './components/DatabaseView';
import {
  AndroidView,
  type BeforeInstallPromptEvent,
} from './components/AndroidView';
import { syncVaultState, sanitizeOfflineSnapshot } from './lib/syncEngine';
import {
  apiFetch,
  getCachedAuthUser,
  updateCachedAuthUser,
  clearAuthSession,
  resetToFreshGuestVault,
  isGuestModeEnabled,
  setGuestModeEnabled,
} from './lib/vaultClient';
import {
  getSavedTheme,
  applyStudioTheme,
  type StudioTheme,
} from './lib/theme';
import {
  putStoreItem,
  deleteStoreItem,
  saveOfflineBlob,
  getOfflineBlob,
  enqueueOfflineAction,
  clearAllOfflineStores,
  loadOfflineSnapshot,
  computeVaultFingerprint,
} from './lib/offlineDb';

export function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    getCachedAuthUser()
  );
  const [guestMode, setGuestMode] = useState<boolean>(() => isGuestModeEnabled());
  const [authReady, setAuthReady] = useState<boolean>(
    () =>
      !navigator.onLine ||
      Boolean(getCachedAuthUser()) ||
      isGuestModeEnabled()
  );
  const [vault, setVault] = useState<VaultState | null>(null);
  const [theme, setTheme] = useState<StudioTheme>(() => getSavedTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (
      t === 'providers' ||
      t === 'ai-keys' ||
      t === 'database' ||
      t === 'android'
    ) {
      return t;
    }
    return 'files';
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [swReady, setSwReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Serialize online write mutations so rapid taps never race across serverless instances
  const mutationChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueServerMutation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = mutationChainRef.current.catch(() => {}).then(task);
    mutationChainRef.current = next;
    return next;
  }, []);

  const canLoadWorkspace = authReady && (Boolean(authUser) || guestMode);

  useEffect(() => {
    applyStudioTheme(theme);
  }, [theme]);

  const handleChangeTheme = (next: StudioTheme) => {
    setTheme(next);
    applyStudioTheme(next);
    if (authUser && navigator.onLine) {
      apiFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      }).catch(() => {});
    }
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 3200);
  }, []);

  // Instant IndexedDB hydration on launch so returning users see files in <30ms
  useEffect(() => {
    if (!canLoadWorkspace || vault) return;
    let cancelled = false;
    loadOfflineSnapshot()
      .then((snap) => {
        if (cancelled || !snap) return;
        const expectedVid =
          authUser?.vaultId || localStorage.getItem('cloudy_xkilo_vault_id');
        if (snap.vaultId && expectedVid && snap.vaultId !== expectedVid) return;
        setVault((prev) => prev || sanitizeOfflineSnapshot(snap));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canLoadWorkspace, authUser?.vaultId, vault]);

  // Verify active user session on boot (non-blocking if cached session exists)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.onLine) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      try {
        const res = await apiFetch('/api/auth/me');
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data?.authenticated && data?.user) {
          const u = data.user as AuthUser;
          updateCachedAuthUser(u);
          setAuthUser(u);
          if (u.theme) {
            setTheme(u.theme);
            applyStudioTheme(u.theme);
          }
        } else {
          clearAuthSession();
          setAuthUser(null);
          const guest = isGuestModeEnabled();
          setGuestMode(guest);
          if (!guest) setVault(null);
        }
      } catch {
        // Offline or unreachable — retain cached authUser for Offline Vault continuity
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshVault = useCallback(
    async (
      forceOfflineOverride?: boolean,
      silentBackground = false,
      forceFresh = false
    ) => {
      try {
        const useOffline =
          forceOfflineOverride !== undefined
            ? forceOfflineOverride
            : simulatedOffline;
        if (!useOffline && !silentBackground) {
          setIsSyncing(true);
        }
        const res = await syncVaultState(useOffline, forceFresh);
        setVault((prev) => {
          if (
            prev &&
            silentBackground &&
            computeVaultFingerprint(prev) === computeVaultFingerprint(res.state)
          ) {
            return prev;
          }
          return res.state;
        });
        setIsOffline(res.isOffline);
        setPendingSyncCount(res.pendingQueueCount);
        if (res.flushedQueueCount > 0) {
          showToast(
            `Auto-synced ${res.flushedQueueCount} offline change${
              res.flushedQueueCount === 1 ? '' : 's'
            } to cloud`
          );
        }
      } catch (err) {
        if ((err as { code?: string })?.code === 'AUTH_REQUIRED') {
          if (guestMode) {
            resetToFreshGuestVault();
            await clearAllOfflineStores().catch(() => {});
            const retry = await syncVaultState(false, true).catch(() => null);
            if (retry) {
              setVault(retry.state);
              return;
            }
          }
          clearAuthSession();
          setAuthUser(null);
          setGuestMode(false);
          setVault(null);
          return;
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [simulatedOffline, showToast, guestMode]
  );

  useEffect(() => {
    if (!canLoadWorkspace) return;
    const params = new URLSearchParams(window.location.search);
    const connectedLabel = params.get('connected');
    if (connectedLabel) {
      refreshVault(false, false, true);
      showToast(`Connected ${connectedLabel}`);
      params.delete('connected');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}`
      );
      return;
    }
    refreshVault(undefined, Boolean(vault), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadWorkspace, authUser?.id]);

  useEffect(() => {
    const handleOnline = () => {
      if (!simulatedOffline && canLoadWorkspace) {
        refreshVault(false, false, true);
        showToast('Internet connected — Live Auto-Sync active');
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      if (canLoadWorkspace) {
        showToast('Offline Vault active — changes will auto-sync when online');
      }
    };
    const handleFocusOrVisible = () => {
      if (
        canLoadWorkspace &&
        !simulatedOffline &&
        navigator.onLine &&
        document.visibilityState === 'visible'
      ) {
        refreshVault(false, true, false);
      }
    };
    const handleOAuthSuccessPayload = (accountLabel?: string) => {
      refreshVault(false, false, true);
      showToast(`Connected ${accountLabel || 'Cloud Account'}`);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CLOUDY_OAUTH_SUCCESS') {
        handleOAuthSuccessPayload(event.data.account?.accountLabel);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'cloudy_oauth_event' && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          handleOAuthSuccessPayload(parsed?.account?.accountLabel);
        } catch {
          handleOAuthSuccessPayload();
        }
      }
    };
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('cloudy_oauth_channel');
        bc.onmessage = (ev) => {
          if (ev.data?.type === 'CLOUDY_OAUTH_SUCCESS') {
            handleOAuthSuccessPayload(ev.data.account?.accountLabel);
          }
        };
      }
    } catch {
      // BroadcastChannel unsupported
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocusOrVisible);
    window.addEventListener('visibilitychange', handleFocusOrVisible);
    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => setSwReady(true)).catch(() => {});
    }

    return () => {
      if (bc) {
        try {
          bc.close();
        } catch {
          // ignore
        }
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocusOrVisible);
      window.removeEventListener('visibilitychange', handleFocusOrVisible);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [canLoadWorkspace, refreshVault, simulatedOffline, showToast]);

  // Live Background Auto-Sync loop whenever internet is available
  useEffect(() => {
    if (!canLoadWorkspace || simulatedOffline) return;

    const intervalMs = isOffline ? 10000 : 20000;
    const timer = window.setInterval(() => {
      if (!navigator.onLine) return;
      if (!isOffline && document.visibilityState !== 'visible') return;
      refreshVault(false, true);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [canLoadWorkspace, simulatedOffline, isOffline, refreshVault]);

  const handleToggleOffline = async () => {
    const next = !simulatedOffline;
    setSimulatedOffline(next);
    await refreshVault(next);
    showToast(next ? 'Offline Vault Mode ON' : 'Online Mode — synced');
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Instant client-side guard against rapid duplicate carpeta creation
    const existingRecent = vault?.folders.find(
      (f) =>
        !f.trashed &&
        (f.parentId || null) === (parentId || null) &&
        f.name.trim().toLowerCase() === trimmed.toLowerCase() &&
        Date.now() - new Date(f.createdAt || 0).getTime() < 5000
    );
    if (existingRecent) return;

    const clientFolderId = `fld_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();
    const optimisticFolder: FolderItem = {
      id: clientFolderId,
      name: trimmed,
      parentId: parentId || null,
      offlinePinned: true,
      starred: false,
      trashed: false,
      pendingOfflineSync: isOffline,
      createdAt: now,
      updatedAt: now,
    };

    // 0ms Optimistic UI update
    setVault((prev) =>
      prev ? { ...prev, folders: [optimisticFolder, ...prev.folders] } : prev
    );

    const saveFolderOffline = async () => {
      const offlineFolder: FolderItem = {
        ...optimisticFolder,
        pendingOfflineSync: true,
      };
      await putStoreItem('folders', offlineFolder);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${clientFolderId}`,
        type: 'create_folder',
        payload: {
          id: clientFolderId,
          name: trimmed,
          parentId: parentId || null,
          offlinePinned: true,
        },
        createdAt: now,
      });
      await refreshVault(true, true);
      showToast(`Created "${trimmed}" offline`);
    };

    if (isOffline && vault) {
      await saveFolderOffline();
      return;
    }

    try {
      await enqueueServerMutation(async () => {
        const res = await apiFetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: clientFolderId,
            name: trimmed,
            parentId: parentId || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setVault((prev) =>
            prev
              ? {
                  ...prev,
                  folders: prev.folders.filter((f) => f.id !== clientFolderId),
                }
              : prev
          );
          showToast(err.error || 'Failed to create carpeta');
          return;
        }
        const data = await res.json().catch(() => null);
        if (data?.folder) {
          await putStoreItem('folders', data.folder).catch(() => {});
          setVault((prev) => {
            if (!prev) return prev;
            const filtered = prev.folders.filter(
              (f) => f.id !== clientFolderId && f.id !== data.folder.id
            );
            return { ...prev, folders: [data.folder, ...filtered] };
          });
        }
        showToast(`Created "${trimmed}"`);
      });
    } catch {
      await saveFolderOffline();
    }
  };

  const handleUploadFiles = async (
    fileList: FileList | File[],
    folderId: string | null
  ) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    if (isOffline && vault) {
      const now = new Date().toISOString();
      const targetAcc = vault.accounts[0] || null;
      for (const rawFile of arr) {
        const fid = `fil_${Math.random().toString(36).slice(2, 11)}`;
        const isTxt =
          rawFile.type.startsWith('text/') ||
          /\.(md|txt|json|csv)$/i.test(rawFile.name);
        const textContent = isTxt ? await rawFile.text() : null;
        const item: FileItem = {
          id: fid,
          name: rawFile.name,
          folderId,
          mimeType: rawFile.type || 'application/octet-stream',
          kind: 'file',
          size: rawFile.size,
          accountId: targetAcc ? targetAcc.id : 'offline_vault',
          providerId: targetAcc ? targetAcc.providerId : 'offline_vault',
          providerName: targetAcc ? targetAcc.providerName : 'Offline Vault',
          mirrorAccountId: null,
          offlinePinned: true,
          offlineCached: true,
          pendingOfflineSync: true,
          starred: false,
          trashed: false,
          tags: [],
          textContent,
          createdAt: now,
          updatedAt: now,
        };
        await putStoreItem('files', item);
        await saveOfflineBlob(fid, rawFile, now);
        await enqueueOfflineAction({
          id: `q_${Date.now()}_${fid}`,
          type: 'upload_file',
          payload: { id: fid, name: rawFile.name, folderId },
          blob: rawFile,
          createdAt: now,
        });
      }
      await refreshVault(true);
      showToast(`Saved ${arr.length} file(s) offline`);
      return;
    }

    if (vault && vault.accounts.length === 0) {
      showToast('Connect a real cloud storage account first to upload files');
      setActiveTab('providers');
      return;
    }

    const fd = new FormData();
    for (const f of arr) fd.append('files', f);
    if (folderId) fd.append('folderId', folderId);

    try {
      const res = await enqueueServerMutation(() =>
        apiFetch('/api/files/upload', {
          method: 'POST',
          body: fd,
        })
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'NO_CLOUD_ACCOUNT') {
          showToast('Connect a real cloud storage account first to upload files');
          setActiveTab('providers');
          return;
        }
        showToast(`Upload failed: ${data.error || 'Error'}`);
        return;
      }
      await refreshVault(false, true, true);
      const dest = data.files?.[0]?.providerName || 'Cloud';
      showToast(`Uploaded to ${dest}`);
    } catch {
      showToast('Network interrupted during upload — switch to Offline Vault or retry');
    }
  };

  const handleCreateNote = async (
    name: string,
    content: string,
    mimeType: string,
    kind: 'note' | 'dataset',
    folderId: string | null
  ) => {
    const id = `fil_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();
    const blob = new Blob([content], { type: mimeType });
    const targetAcc = vault?.accounts[0] || null;

    const optimisticFile: FileItem = {
      id,
      name,
      folderId,
      mimeType,
      kind,
      size: blob.size,
      accountId: targetAcc ? targetAcc.id : 'offline_vault',
      providerId: targetAcc ? targetAcc.providerId : 'offline_vault',
      providerName: targetAcc ? targetAcc.providerName : 'Offline Vault',
      mirrorAccountId: null,
      offlinePinned: true,
      offlineCached: true,
      pendingOfflineSync: isOffline,
      starred: false,
      trashed: false,
      tags: [],
      textContent: content,
      createdAt: now,
      updatedAt: now,
    };

    // 0ms Optimistic UI update
    setVault((prev) =>
      prev ? { ...prev, files: [optimisticFile, ...prev.files] } : prev
    );
    saveOfflineBlob(id, blob, now).catch(() => {});

    const saveNoteOffline = async () => {
      const item: FileItem = { ...optimisticFile, pendingOfflineSync: true };
      await putStoreItem('files', item);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${id}`,
        type: 'create_note',
        payload: { id, name, content, mimeType, kind, folderId },
        createdAt: now,
      });
      await refreshVault(true, true);
      showToast(`Saved "${name}" offline`);
    };

    if (isOffline && vault) {
      await saveNoteOffline();
      return;
    }

    try {
      await enqueueServerMutation(async () => {
        const res = await apiFetch('/api/files/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, content, mimeType, kind, folderId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setVault((prev) =>
            prev ? { ...prev, files: prev.files.filter((f) => f.id !== id) } : prev
          );
          showToast(`Save error: ${data.error || 'Error'}`);
          return;
        }
        if (data.file) {
          await putStoreItem('files', data.file).catch(() => {});
          setVault((prev) => {
            if (!prev) return prev;
            const rest = prev.files.filter(
              (f) => f.id !== id && f.id !== data.file.id
            );
            return { ...prev, files: [data.file, ...rest] };
          });
        }
        showToast(`Saved "${name}" → ${data.file?.providerName || 'Vault'}`);
      });
    } catch {
      await saveNoteOffline();
    }
  };

  const handleSaveFileContent = async (file: FileItem, updatedText: string) => {
    const now = new Date().toISOString();
    const blob = new Blob([updatedText], {
      type: file.mimeType || 'text/plain',
    });

    const optimisticUpdated: FileItem = {
      ...file,
      textContent: updatedText,
      size: blob.size,
      updatedAt: now,
    };
    setPreviewFile(optimisticUpdated);
    setVault((prev) =>
      prev
        ? {
            ...prev,
            files: prev.files.map((f) =>
              f.id === file.id ? optimisticUpdated : f
            ),
          }
        : prev
    );

    const saveEditOffline = async () => {
      const updated: FileItem = {
        ...optimisticUpdated,
        pendingOfflineSync: true,
      };
      await putStoreItem('files', updated);
      await saveOfflineBlob(file.id, blob, now);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${file.id}`,
        type: 'update_file',
        payload: { fileId: file.id, textContent: updatedText },
        createdAt: now,
      });
      setPreviewFile(updated);
      await refreshVault(true, true);
      showToast('Saved offline');
    };

    if (isOffline) {
      await saveEditOffline();
      return;
    }

    try {
      await enqueueServerMutation(async () => {
        const res = await apiFetch(`/api/files/${file.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ textContent: updatedText }),
        });
        if (res.ok) {
          const data = await res.json();
          await saveOfflineBlob(file.id, blob, data.file.updatedAt);
          await putStoreItem('files', data.file).catch(() => {});
          setPreviewFile(data.file);
          setVault((prev) =>
            prev
              ? {
                  ...prev,
                  files: prev.files.map((f) =>
                    f.id === file.id ? data.file : f
                  ),
                }
              : prev
          );
          showToast('Saved changes');
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(`Save error: ${err.error || 'Failed to save'}`);
        }
      });
    } catch {
      await saveEditOffline();
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
    try {
      const cached = await getOfflineBlob(file.id);
      if (cached?.blob) {
        const url = URL.createObjectURL(cached.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (file.textContent != null) {
        const b = new Blob([file.textContent], {
          type: file.mimeType || 'text/plain',
        });
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (isOffline) {
        showToast('Connect to the internet once to download this cloud file');
        return;
      }
      const resp = await apiFetch(`/api/files/${file.id}/blob?download=1`);
      if (resp.ok) {
        const b = await resp.blob();
        saveOfflineBlob(file.id, b, file.updatedAt).catch(() => {});
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        const ct = resp.headers.get('content-type') || '';
        const dlName =
          file.mimeType.startsWith('application/vnd.google-apps.') &&
          ct.includes('pdf') &&
          !file.name.toLowerCase().endsWith('.pdf')
            ? `${file.name}.pdf`
            : file.name;
        a.download = dlName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const err = await resp.json().catch(() => ({}));
        showToast(err.error || 'Unable to download file from cloud provider');
      }
    } catch {
      showToast('Download interrupted — check your connection');
    }
  };

  const handlePatchFile = async (
    fileId: string,
    body: Record<string, unknown>
  ) => {
    const now = new Date().toISOString();

    // 0ms Optimistic UI update for local metadata changes
    if (!body.targetAccountId) {
      setVault((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          files: prev.files.map((f) => {
            if (f.id !== fileId) return f;
            const next: FileItem = {
              ...f,
              ...(typeof body.name === 'string' ? { name: body.name } : {}),
              ...(body.folderId !== undefined
                ? { folderId: (body.folderId as string | null) || null }
                : {}),
              ...(typeof body.trashed === 'boolean'
                ? { trashed: body.trashed }
                : {}),
              ...(typeof body.starred === 'boolean'
                ? { starred: body.starred }
                : {}),
              updatedAt: now,
            };
            if (previewFile?.id === fileId) {
              setPreviewFile(next);
            }
            return next;
          }),
        };
      });
    }

    const patchFileOffline = async () => {
      if (!vault) return;
      if (body.targetAccountId) {
        showToast('Moving between cloud accounts requires internet');
        return;
      }
      const existing = vault.files.find((f) => f.id === fileId);
      if (!existing) return;
      const updated: FileItem = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(body.folderId !== undefined
          ? { folderId: (body.folderId as string | null) || null }
          : {}),
        ...(typeof body.trashed === 'boolean' ? { trashed: body.trashed } : {}),
        ...(typeof body.starred === 'boolean' ? { starred: body.starred } : {}),
        pendingOfflineSync: true,
        updatedAt: now,
      };
      await putStoreItem('files', updated);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${fileId}`,
        type: 'update_file',
        payload: { fileId, ...body },
        createdAt: now,
      });
      if (previewFile?.id === fileId) setPreviewFile(updated);
      await refreshVault(true, true);
    };

    if (isOffline && vault) {
      await patchFileOffline();
      return;
    }

    try {
      await enqueueServerMutation(async () => {
        const res = await apiFetch(`/api/files/${fileId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.file) {
            await putStoreItem('files', data.file).catch(() => {});
            if (previewFile?.id === fileId) setPreviewFile(data.file);
            setVault((prev) =>
              prev
                ? {
                    ...prev,
                    files: prev.files.map((f) =>
                      f.id === fileId ? data.file : f
                    ),
                  }
                : prev
            );
          }
          if (body.targetAccountId) {
            await refreshVault(false, true, true);
          }
        } else {
          const err = await res.json().catch(() => ({}));
          if (err.error) showToast(err.error);
          await refreshVault(false, true, true);
        }
      });
    } catch {
      await patchFileOffline();
    }
  };

  const handleTrashOrDeleteFile = async (file: FileItem, permanent = false) => {
    if (!permanent) {
      await handlePatchFile(file.id, { trashed: true });
      return;
    }

    // 0ms Optimistic permanent delete
    setVault((prev) =>
      prev ? { ...prev, files: prev.files.filter((f) => f.id !== file.id) } : prev
    );
    if (previewFile?.id === file.id) setPreviewFile(null);

    if (isOffline) {
      await deleteStoreItem('files', file.id);
      await deleteStoreItem('blobs', file.id);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${file.id}`,
        type: 'delete_file',
        payload: { fileId: file.id },
        createdAt: new Date().toISOString(),
      });
      await refreshVault(true, true);
      return;
    }

    await enqueueServerMutation(async () => {
      await apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
      await deleteStoreItem('files', file.id).catch(() => {});
      await deleteStoreItem('blobs', file.id).catch(() => {});
    });
  };

  const handleTrashOrDeleteFolder = async (
    folder: FolderItem,
    permanent = false
  ) => {
    const now = new Date().toISOString();
    const affectedIds = new Set<string>([folder.id]);
    if (vault) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const sub of vault.folders) {
          if (
            sub.parentId &&
            affectedIds.has(sub.parentId) &&
            !affectedIds.has(sub.id)
          ) {
            affectedIds.add(sub.id);
            expanded = true;
          }
        }
      }
    }

    // 0ms Optimistic UI update
    if (currentFolderId && affectedIds.has(currentFolderId)) {
      setCurrentFolderId(null);
    }
    setVault((prev) => {
      if (!prev) return prev;
      if (permanent) {
        return {
          ...prev,
          folders: prev.folders.filter((f) => !affectedIds.has(f.id)),
          files: prev.files.filter(
            (fl) => !(fl.folderId && affectedIds.has(fl.folderId))
          ),
        };
      }
      return {
        ...prev,
        folders: prev.folders.map((f) =>
          affectedIds.has(f.id) ? { ...f, trashed: true, updatedAt: now } : f
        ),
        files: prev.files.map((fl) =>
          fl.folderId && affectedIds.has(fl.folderId)
            ? { ...fl, trashed: true, updatedAt: now }
            : fl
        ),
      };
    });

    if (isOffline && vault) {
      if (permanent) {
        for (const fid of affectedIds) {
          await deleteStoreItem('folders', fid);
        }
        for (const fl of vault.files) {
          if (fl.folderId && affectedIds.has(fl.folderId)) {
            await deleteStoreItem('files', fl.id);
            await deleteStoreItem('blobs', fl.id);
          }
        }
        await enqueueOfflineAction({
          id: `q_${Date.now()}_${folder.id}`,
          type: 'delete_folder',
          payload: { folderId: folder.id },
          createdAt: now,
        });
      } else {
        for (const sub of vault.folders) {
          if (affectedIds.has(sub.id)) {
            await putStoreItem('folders', {
              ...sub,
              trashed: true,
              pendingOfflineSync: true,
              updatedAt: now,
            });
          }
        }
        for (const fl of vault.files) {
          if (fl.folderId && affectedIds.has(fl.folderId)) {
            await putStoreItem('files', {
              ...fl,
              trashed: true,
              pendingOfflineSync: true,
              updatedAt: now,
            });
          }
        }
        await enqueueOfflineAction({
          id: `q_${Date.now()}_${folder.id}`,
          type: 'update_folder',
          payload: { folderId: folder.id, trashed: true },
          createdAt: now,
        });
      }
      await refreshVault(true, true);
      return;
    }

    await enqueueServerMutation(async () => {
      if (permanent) {
        await apiFetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
        for (const fid of affectedIds) {
          await deleteStoreItem('folders', fid).catch(() => {});
        }
      } else {
        await apiFetch(`/api/folders/${folder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        });
      }
    });
  };

  const handleRestoreFolder = async (folder: FolderItem) => {
    const now = new Date().toISOString();
    const affectedIds = new Set<string>([folder.id]);
    if (vault) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const sub of vault.folders) {
          if (
            sub.parentId &&
            affectedIds.has(sub.parentId) &&
            !affectedIds.has(sub.id)
          ) {
            affectedIds.add(sub.id);
            expanded = true;
          }
        }
      }
    }

    // 0ms Optimistic UI restore
    setVault((prev) =>
      prev
        ? {
            ...prev,
            folders: prev.folders.map((f) =>
              affectedIds.has(f.id) ? { ...f, trashed: false, updatedAt: now } : f
            ),
            files: prev.files.map((fl) =>
              fl.folderId && affectedIds.has(fl.folderId)
                ? { ...fl, trashed: false, updatedAt: now }
                : fl
            ),
          }
        : prev
    );

    if (isOffline && vault) {
      for (const sub of vault.folders) {
        if (affectedIds.has(sub.id)) {
          await putStoreItem('folders', {
            ...sub,
            trashed: false,
            pendingOfflineSync: true,
            updatedAt: now,
          });
        }
      }
      for (const fl of vault.files) {
        if (fl.folderId && affectedIds.has(fl.folderId)) {
          await putStoreItem('files', {
            ...fl,
            trashed: false,
            pendingOfflineSync: true,
            updatedAt: now,
          });
        }
      }
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${folder.id}`,
        type: 'update_folder',
        payload: { folderId: folder.id, trashed: false },
        createdAt: now,
      });
      await refreshVault(true, true);
      return;
    }

    await enqueueServerMutation(async () => {
      await apiFetch(`/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: false }),
      });
    });
  };

  const handleConnectCredentials = async (
    providerId: string,
    credentials: Record<string, string>
  ) => {
    const res = await apiFetch('/api/accounts/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, credentials }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify storage credentials');
    }
    await refreshVault(false, false, true);
    showToast(`Connected ${data.account.accountLabel}`);
  };

  const handleSyncAccount = async (accountId: string) => {
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/sync`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await refreshVault(false, true, true);
        showToast(`Synced ${data.importedCount || 0} remote file(s)`);
      } else {
        showToast(data.error || 'Cloud sync failed — reconnect account');
      }
    } catch {
      showToast('Network error while syncing cloud account');
    }
  };

  const handleDisconnectAccount = async (accountId: string) => {
    setVault((prev) =>
      prev
        ? {
            ...prev,
            accounts: prev.accounts.filter((a) => a.id !== accountId),
          }
        : prev
    );
    await enqueueServerMutation(async () => {
      await apiFetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      await refreshVault(false, true, true);
    });
    showToast('Disconnected account');
  };

  const handleUpdateRule = async (allocationRule: AllocationRule) => {
    setVault((prev) =>
      prev
        ? { ...prev, settings: { ...prev.settings, allocationRule } }
        : prev
    );
    await enqueueServerMutation(async () => {
      await apiFetch('/api/vault/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocationRule }),
      });
    });
  };

  const handleCreateAiKey = async (
    name: string,
    scope: 'read' | 'read_write',
    allowedFolderIds: string[]
  ) => {
    await enqueueServerMutation(async () => {
      await apiFetch('/api/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope, allowedFolderIds }),
      });
      await refreshVault(false, true, true);
    });
    showToast(`Created key "${name}"`);
  };

  const handleToggleKeyActive = async (key: AiApiKey) => {
    setVault((prev) =>
      prev
        ? {
            ...prev,
            apiKeys: prev.apiKeys.map((k) =>
              k.id === key.id ? { ...k, active: !key.active } : k
            ),
          }
        : prev
    );
    await enqueueServerMutation(async () => {
      await apiFetch(`/api/ai-keys/${key.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !key.active }),
      });
    });
  };

  const handleDeleteKey = async (keyId: string) => {
    setVault((prev) =>
      prev
        ? { ...prev, apiKeys: prev.apiKeys.filter((k) => k.id !== keyId) }
        : prev
    );
    await enqueueServerMutation(async () => {
      await apiFetch(`/api/ai-keys/${keyId}`, { method: 'DELETE' });
    });
  };

  const handleTriggerPwaInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore if offline
    }
    clearAuthSession();
    resetToFreshGuestVault();
    await clearAllOfflineStores().catch(() => {});
    setAuthUser(null);
    setGuestMode(false);
    setVault(null);
    setCurrentFolderId(null);
  };

  const handleOpenAuthScreen = () => {
    setGuestModeEnabled(false);
    setGuestMode(false);
  };

  const handleSelectNavTab = useCallback(
    (nextTab: NavTab) => {
      if (nextTab === 'files' && activeTab === 'files') {
        setCurrentFolderId(null);
      }
      setActiveTab(nextTab);
      window.scrollTo(0, 0);
    },
    [activeTab]
  );

  if (!authReady) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex flex-col items-center justify-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-surface border border-line-strong flex items-center justify-center shadow-card">
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-7 h-7 object-contain"
          />
        </div>
        <div className="text-xs font-medium text-ink-muted tracking-wide">
          Cloudy · X-Kilo
        </div>
      </div>
    );
  }

  if (!authUser && !guestMode) {
    const existingVid =
      typeof window !== 'undefined'
        ? localStorage.getItem('cloudy_xkilo_vault_id')
        : null;
    return (
      <AuthView
        theme={theme}
        onChangeTheme={handleChangeTheme}
        hasExistingBrowserVault={Boolean(existingVid && existingVid !== 'default')}
        onAuthenticated={(user, _token, mode) => {
          setAuthUser(user);
          setGuestMode(false);
          if (user.theme) {
            setTheme(user.theme);
            applyStudioTheme(user.theme);
          }
          showToast(
            mode === 'signup'
              ? `Welcome to Cloudy, ${user.displayName}`
              : `Signed in as ${user.displayName}`
          );
        }}
        onContinueAsGuest={() => {
          setGuestModeEnabled(true);
          setGuestMode(true);
        }}
      />
    );
  }

  if (!vault) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex flex-col items-center justify-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-surface border border-line-strong flex items-center justify-center shadow-card">
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-7 h-7 object-contain"
          />
        </div>
        <div className="text-xs font-medium text-ink-muted tracking-wide">
          Cloudy · X-Kilo
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex bg-canvas ambient-canvas text-ink">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectNavTab}
        onResetFolder={() => setCurrentFolderId(null)}
        vault={vault}
        authUser={authUser}
        onLogout={handleLogout}
        onOpenAuthScreen={handleOpenAuthScreen}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        theme={theme}
        onChangeTheme={handleChangeTheme}
      />

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
        <TopBar
          activeTab={activeTab}
          onSelectTab={handleSelectNavTab}
          onResetFolder={() => setCurrentFolderId(null)}
          vault={vault}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isOffline={isOffline}
          isSyncing={isSyncing}
          onToggleOffline={handleToggleOffline}
          onForceSync={async () => {
            await refreshVault(false, false, true);
            showToast('Vault synced live');
          }}
          pendingSyncCount={pendingSyncCount}
          theme={theme}
          onChangeTheme={handleChangeTheme}
          authUser={authUser}
          onOpenAccountTab={() => handleSelectNavTab('database')}
          onOpenAuthScreen={handleOpenAuthScreen}
          onLogout={handleLogout}
        />

        {/* Instant Zero-Wait Tab Views */}
        <motion.main
          key={activeTab}
          initial={{ opacity: 0.92 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="flex-1 flex flex-col min-w-0"
        >
          {activeTab === 'providers' ? (
            <ProvidersHub
              vault={vault}
              isOffline={isOffline}
              onConnectCredentials={handleConnectCredentials}
              onSyncAccount={handleSyncAccount}
              onDisconnectAccount={handleDisconnectAccount}
              onUpdateAllocationRule={handleUpdateRule}
              onConnectedRefresh={async (label) => {
                await refreshVault(false, false, true);
                showToast(`Connected ${label || 'Cloud Storage'}`);
              }}
            />
          ) : activeTab === 'ai-keys' ? (
            <AiApiKeysView
              vault={vault}
              isOffline={isOffline}
              onCreateKey={handleCreateAiKey}
              onToggleKeyActive={handleToggleKeyActive}
              onDeleteKey={handleDeleteKey}
              onRefreshState={() => refreshVault(false, true, true)}
              onSaveGeneratedNote={(name, content, folderId) =>
                handleCreateNote(name, content, 'text/markdown', 'note', folderId)
              }
            />
          ) : activeTab === 'database' ? (
            <DatabaseView
              vault={vault}
              authUser={authUser}
              isOffline={isOffline}
              onUserUpdated={(u) => setAuthUser(u)}
              onLogout={handleLogout}
              onOpenAuthScreen={handleOpenAuthScreen}
              onShowToast={showToast}
            />
          ) : activeTab === 'android' ? (
            <AndroidView
              deferredPrompt={deferredPrompt}
              onTriggerPwaInstall={handleTriggerPwaInstall}
              swReady={swReady}
            />
          ) : (
            <DriveExplorer
              vault={vault}
              currentFolderId={currentFolderId}
              onSelectFolder={setCurrentFolderId}
              onNavigateToProviders={() => handleSelectNavTab('providers')}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
              isOffline={isOffline}
              onUploadFiles={handleUploadFiles}
              onCreateFolder={handleCreateFolder}
              onCreateNote={handleCreateNote}
              onOpenFile={setPreviewFile}
              onDownloadFile={handleDownloadFile}
              onTrashOrDeleteFile={handleTrashOrDeleteFile}
              onRestoreFile={(f) => handlePatchFile(f.id, { trashed: false })}
              onTrashOrDeleteFolder={handleTrashOrDeleteFolder}
              onRestoreFolder={handleRestoreFolder}
            />
          )}
        </motion.main>
      </div>

      {/* High-FPS Mobile Navigation Bar with Safe-Area Support */}
      <nav
        aria-label="Primary Mobile Navigation"
        className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-sidebar/98 sm:bg-sidebar/92 sm:backdrop-blur-xl border-t border-line px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom,0px))]"
      >
        <div className="max-w-md mx-auto grid grid-cols-5 gap-1">
          {[
            { id: 'files' as NavTab, label: 'Files', icon: FolderClosed },
            {
              id: 'providers' as NavTab,
              label: 'Clouds',
              icon: Cloud,
              badge: vault.accounts.length > 0 ? vault.accounts.length : null,
            },
            { id: 'ai-keys' as NavTab, label: 'AI API', icon: KeyRound },
            { id: 'database' as NavTab, label: 'Database', icon: Database },
            { id: 'android' as NavTab, label: 'Android', icon: Smartphone },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNavTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl transition-colors ${
                  active ? 'text-ink bg-surface border border-line-strong shadow-card' : 'text-ink-muted active:text-ink border border-transparent'
                }`}
              >
                <span className="relative z-10 flex items-center justify-center">
                  <Icon
                    className={`w-[18px] h-[18px] transition-colors ${
                      active ? 'text-accent' : ''
                    }`}
                  />
                  {item.badge && (
                    <span className="absolute -top-1 -right-2.5 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-white text-[9px] font-mono font-bold flex items-center justify-center leading-none">
                      {item.badge}
                    </span>
                  )}
                </span>
                <span
                  className={`relative z-10 text-[10px] font-medium leading-tight tracking-tight ${
                    active ? 'text-ink font-semibold' : 'text-ink-muted'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <FilePreviewModal
        file={previewFile}
        accounts={vault.accounts}
        folders={vault.folders}
        isOffline={isOffline}
        onClose={() => setPreviewFile(null)}
        onSaveContent={handleSaveFileContent}
        onMoveProvider={async (f, targetAccountId) => {
          await handlePatchFile(f.id, { targetAccountId });
          showToast('Moved to selected cloud');
        }}
        onMoveFolder={async (f, folderId) => {
          await handlePatchFile(f.id, { folderId });
        }}
        onDownload={handleDownloadFile}
      />

      {/* Crisp Toast Notification (Safe on Narrow Mobile Screens) */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 inset-x-4 sm:inset-x-auto sm:right-6 z-50 mx-auto sm:mx-0 w-fit max-w-[calc(100vw-2rem)] px-4 py-2.5 rounded-full bg-surface border border-line-strong text-xs font-medium text-ink shadow-float flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-[#10A37F] shrink-0" />
            <span className="truncate">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export default App;
