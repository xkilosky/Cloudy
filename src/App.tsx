import React, { useEffect, useState, useCallback } from 'react';
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
import { syncVaultState } from './lib/syncEngine';
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
} from './lib/offlineDb';

export function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    getCachedAuthUser()
  );
  const [guestMode, setGuestMode] = useState<boolean>(() => isGuestModeEnabled());
  const [authReady, setAuthReady] = useState<boolean>(() => !navigator.onLine);
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

  // Verify active user session on boot
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
          setGuestMode(isGuestModeEnabled());
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
        setVault(res.state);
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
        console.error('Vault sync error:', err);
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
    refreshVault(undefined, false, true);
  }, [canLoadWorkspace, refreshVault, authUser?.id, showToast]);

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
        refreshVault(false, true, true);
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
    document.addEventListener('visibilitychange', handleFocusOrVisible);
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
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [canLoadWorkspace, refreshVault, simulatedOffline, showToast]);

  // Live Background Auto-Sync loop whenever internet is available
  useEffect(() => {
    if (!canLoadWorkspace || simulatedOffline) return;

    const intervalMs = isOffline ? 8000 : 15000;
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
    const clientFolderId = `fld_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    const saveFolderOffline = async () => {
      const offlineFolder: FolderItem = {
        id: clientFolderId,
        name,
        parentId,
        offlinePinned: true,
        starred: false,
        trashed: false,
        pendingOfflineSync: true,
        createdAt: now,
        updatedAt: now,
      };
      await putStoreItem('folders', offlineFolder);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${clientFolderId}`,
        type: 'create_folder',
        payload: { id: clientFolderId, name, parentId, offlinePinned: true },
        createdAt: now,
      });
      await refreshVault(true);
      showToast(`Created "${name}" offline`);
    };

    if (isOffline && vault) {
      await saveFolderOffline();
      return;
    }

    try {
      const res = await apiFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientFolderId, name, parentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to create folder');
        return;
      }
      await refreshVault();
      showToast(`Created "${name}"`);
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
      const res = await apiFetch('/api/files/upload', {
        method: 'POST',
        body: fd,
      });
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
      await refreshVault();
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

    const saveNoteOffline = async () => {
      const blob = new Blob([content], { type: mimeType });
      const targetAcc = vault?.accounts[0] || null;
      const item: FileItem = {
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
        pendingOfflineSync: true,
        starred: false,
        trashed: false,
        tags: [],
        textContent: content,
        createdAt: now,
        updatedAt: now,
      };
      await putStoreItem('files', item);
      await saveOfflineBlob(id, blob, now);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${id}`,
        type: 'create_note',
        payload: { id, name, content, mimeType, kind, folderId },
        createdAt: now,
      });
      await refreshVault(true);
      showToast(`Saved "${name}" offline`);
    };

    if (isOffline && vault) {
      await saveNoteOffline();
      return;
    }

    try {
      const res = await apiFetch('/api/files/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, content, mimeType, kind, folderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(`Save error: ${data.error || 'Error'}`);
        return;
      }
      await refreshVault();
      showToast(`Saved "${name}" → ${data.file?.providerName || 'Vault'}`);
    } catch {
      await saveNoteOffline();
    }
  };

  const handleSaveFileContent = async (file: FileItem, updatedText: string) => {
    const now = new Date().toISOString();
    const blob = new Blob([updatedText], {
      type: file.mimeType || 'text/plain',
    });

    const saveEditOffline = async () => {
      const updated: FileItem = {
        ...file,
        textContent: updatedText,
        size: blob.size,
        pendingOfflineSync: true,
        updatedAt: now,
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
      await refreshVault(true);
      showToast('Saved offline');
    };

    if (isOffline) {
      await saveEditOffline();
      return;
    }

    try {
      const res = await apiFetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textContent: updatedText }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveOfflineBlob(file.id, blob, data.file.updatedAt);
        setPreviewFile(data.file);
        await refreshVault();
        showToast('Saved changes');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Save error: ${err.error || 'Failed to save'}`);
      }
    } catch {
      await saveEditOffline();
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
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
    const resp = await apiFetch(`/api/files/${file.id}/blob?download=1`);
    if (resp.ok) {
      const b = await resp.blob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const handlePatchFile = async (
    fileId: string,
    body: Record<string, unknown>
  ) => {
    const patchFileOffline = async () => {
      if (!vault) return;
      if (body.targetAccountId) {
        showToast('Moving between cloud accounts requires internet');
        return;
      }
      const existing = vault.files.find((f) => f.id === fileId);
      if (!existing) return;
      const now = new Date().toISOString();
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
      await refreshVault(true);
    };

    if (isOffline && vault) {
      await patchFileOffline();
      return;
    }

    try {
      const res = await apiFetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (previewFile?.id === fileId) setPreviewFile(data.file);
        await refreshVault();
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.error) showToast(err.error);
      }
    } catch {
      await patchFileOffline();
    }
  };

  const handleTrashOrDeleteFile = async (file: FileItem, permanent = false) => {
    if (isOffline) {
      if (permanent) {
        await deleteStoreItem('files', file.id);
        await deleteStoreItem('blobs', file.id);
        await enqueueOfflineAction({
          id: `q_${Date.now()}_${file.id}`,
          type: 'delete_file',
          payload: { fileId: file.id },
          createdAt: new Date().toISOString(),
        });
        await refreshVault(true);
        return;
      }
      await handlePatchFile(file.id, { trashed: true });
      return;
    }
    if (permanent) {
      await apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
    } else {
      await handlePatchFile(file.id, { trashed: true });
    }
    await refreshVault();
  };

  const handleTrashOrDeleteFolder = async (
    folder: FolderItem,
    permanent = false
  ) => {
    if (isOffline && vault) {
      const now = new Date().toISOString();
      const affectedIds = new Set<string>([folder.id]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const sub of vault.folders) {
          if (sub.parentId && affectedIds.has(sub.parentId) && !affectedIds.has(sub.id)) {
            affectedIds.add(sub.id);
            expanded = true;
          }
        }
      }

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
      if (currentFolderId && affectedIds.has(currentFolderId)) setCurrentFolderId(null);
      await refreshVault(true);
      return;
    }
    if (permanent) {
      await apiFetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
    } else {
      await apiFetch(`/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    }
    if (currentFolderId === folder.id) setCurrentFolderId(null);
    await refreshVault();
  };

  const handleRestoreFolder = async (folder: FolderItem) => {
    if (isOffline && vault) {
      const now = new Date().toISOString();
      const affectedIds = new Set<string>([folder.id]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const sub of vault.folders) {
          if (sub.parentId && affectedIds.has(sub.parentId) && !affectedIds.has(sub.id)) {
            affectedIds.add(sub.id);
            expanded = true;
          }
        }
      }
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
      await refreshVault(true);
      return;
    }
    await apiFetch(`/api/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
    await refreshVault();
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
    await refreshVault();
    showToast(`Connected ${data.account.accountLabel}`);
  };

  const handleSyncAccount = async (accountId: string) => {
    const res = await apiFetch(`/api/accounts/${accountId}/sync`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      await refreshVault();
      showToast(`Synced ${data.importedCount || 0} remote file(s)`);
    }
  };

  const handleDisconnectAccount = async (accountId: string) => {
    await apiFetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    await refreshVault();
    showToast('Disconnected account');
  };

  const handleUpdateRule = async (allocationRule: AllocationRule) => {
    await apiFetch('/api/vault/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocationRule }),
    });
    await refreshVault();
  };

  const handleCreateAiKey = async (
    name: string,
    scope: 'read' | 'read_write',
    allowedFolderIds: string[]
  ) => {
    await apiFetch('/api/ai-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope, allowedFolderIds }),
    });
    await refreshVault();
    showToast(`Created key "${name}"`);
  };

  const handleToggleKeyActive = async (key: AiApiKey) => {
    await apiFetch(`/api/ai-keys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !key.active }),
    });
    await refreshVault();
  };

  const handleDeleteKey = async (keyId: string) => {
    await apiFetch(`/api/ai-keys/${keyId}`, { method: 'DELETE' });
    await refreshVault();
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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3.5">
        <motion.div
          animate={{ scale: [0.96, 1.04, 0.96] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-12 h-12 rounded-2xl bg-surface border border-line-strong flex items-center justify-center shadow-card"
        >
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-7 h-7 object-contain"
          />
        </motion.div>
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
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3.5">
        <motion.div
          animate={{ scale: [0.96, 1.04, 0.96] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-12 h-12 rounded-2xl bg-surface border border-line-strong flex items-center justify-center shadow-card"
        >
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-7 h-7 object-contain"
          />
        </motion.div>
        <div className="text-xs font-medium text-ink-muted tracking-wide">
          Cloudy · X-Kilo
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-canvas ambient-canvas text-ink">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
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

      <div className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-0">
        <TopBar
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
          onOpenAccountTab={() => setActiveTab('database')}
          onOpenAuthScreen={handleOpenAuthScreen}
        />

        {/* Smooth Page Transitions */}
        <AnimatePresence mode="wait">
          <motion.main
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex flex-col"
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
                onRefreshState={() => refreshVault()}
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
                searchQuery={searchQuery}
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
        </AnimatePresence>
      </div>

      {/* Floating Glass Mobile Dock with Gliding Pill */}
      <nav className="fixed bottom-3 inset-x-4 z-30 lg:hidden rounded-full bg-surface/90 backdrop-blur-xl border border-line-strong px-2 py-1.5 flex items-center justify-around shadow-float">
        {[
          { id: 'files' as NavTab, label: 'Files', icon: FolderClosed },
          { id: 'providers' as NavTab, label: 'Clouds', icon: Cloud },
          { id: 'ai-keys' as NavTab, label: 'AI API', icon: KeyRound },
          { id: 'database' as NavTab, label: 'DB', icon: Database },
          { id: 'android' as NavTab, label: 'Android', icon: Smartphone },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-colors ${
                active ? 'text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="mobileDockPill"
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-elevated border border-line-strong"
                />
              )}
              <Icon
                className={`relative z-10 w-4 h-4 ${active ? 'text-accent' : ''}`}
              />
              {active && <span className="relative z-10">{item.label}</span>}
            </button>
          );
        })}
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

      {/* Spring Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 450, damping: 30 }}
            className="fixed bottom-20 lg:bottom-6 right-5 z-50 px-4 py-2.5 rounded-full bg-surface border border-line-strong text-xs font-medium text-ink shadow-float inline-flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-[#10A37F]" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export default App;
