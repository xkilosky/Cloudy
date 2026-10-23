import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderClosed,
  Cloud,
  KeyRound,
  Smartphone,
} from 'lucide-react';
import type {
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
import {
  AndroidView,
  type BeforeInstallPromptEvent,
} from './components/AndroidView';
import { syncVaultState } from './lib/syncEngine';
import { apiFetch } from './lib/vaultClient';
import {
  putStoreItem,
  saveOfflineBlob,
  getOfflineBlob,
  enqueueOfflineAction,
} from './lib/offlineDb';

export function App() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'providers' || t === 'ai-keys' || t === 'android') return t;
    return 'files';
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [swReady, setSwReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 3200);
  };

  const refreshVault = useCallback(
    async (forceOfflineOverride?: boolean) => {
      try {
        const useOffline =
          forceOfflineOverride !== undefined ? forceOfflineOverride : simulatedOffline;
        const res = await syncVaultState(useOffline);
        setVault(res.state);
        setIsOffline(res.isOffline);
        setPendingSyncCount(res.pendingQueueCount);
      } catch (err) {
        console.error('Vault sync error:', err);
      }
    },
    [simulatedOffline]
  );

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    const handleOnline = () => {
      if (!simulatedOffline) {
        refreshVault(false);
        showToast('Online — synced Offline Vault.');
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      showToast('Offline Vault active.');
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CLOUDY_OAUTH_SUCCESS') {
        refreshVault(false);
        showToast(
          `Connected ${event.data.account?.accountLabel || 'Cloud Account'}`
        );
      }
    };
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('message', handleMessage);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => setSwReady(true)).catch(() => {});
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [refreshVault, simulatedOffline]);

  const handleToggleOffline = async () => {
    const next = !simulatedOffline;
    setSimulatedOffline(next);
    await refreshVault(next);
    showToast(next ? 'Offline Vault Mode ON' : 'Online Mode — synced');
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    const clientFolderId = `fld_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    if (isOffline && vault) {
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
        id: `q_${Date.now()}`,
        type: 'create_folder',
        payload: { id: clientFolderId, name, parentId, offlinePinned: true },
        createdAt: now,
      });
      await refreshVault(true);
      showToast(`Created "${name}" offline`);
      return;
    }

    await apiFetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clientFolderId, name, parentId }),
    });
    await refreshVault();
    showToast(`Created "${name}"`);
  };

  const handleUploadFiles = async (
    fileList: FileList | File[],
    folderId: string | null
  ) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    if (isOffline && vault) {
      const now = new Date().toISOString();
      const coreAcc = vault.accounts[0];
      for (const rawFile of arr) {
        const fid = `fil_${Math.random().toString(36).slice(2, 11)}`;
        const isTxt =
          rawFile.type.startsWith('text/') || /\.(md|txt|json|csv)$/i.test(rawFile.name);
        const textContent = isTxt ? await rawFile.text() : null;
        const item: FileItem = {
          id: fid,
          name: rawFile.name,
          folderId,
          mimeType: rawFile.type || 'application/octet-stream',
          kind: 'file',
          size: rawFile.size,
          accountId: coreAcc.id,
          providerId: coreAcc.providerId,
          providerName: coreAcc.providerName,
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

    const fd = new FormData();
    for (const f of arr) fd.append('files', f);
    if (folderId) fd.append('folderId', folderId);

    const res = await apiFetch('/api/files/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      showToast(`Upload failed: ${data.error || 'Error'}`);
      return;
    }
    await refreshVault();
    const dest = data.files?.[0]?.providerName || 'Storage';
    showToast(`Uploaded to ${dest}`);
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

    if (isOffline && vault) {
      const blob = new Blob([content], { type: mimeType });
      const coreAcc = vault.accounts[0];
      const item: FileItem = {
        id,
        name,
        folderId,
        mimeType,
        kind,
        size: blob.size,
        accountId: coreAcc.id,
        providerId: coreAcc.providerId,
        providerName: coreAcc.providerName,
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
      return;
    }

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
  };

  const handleSaveFileContent = async (file: FileItem, updatedText: string) => {
    const now = new Date().toISOString();
    const blob = new Blob([updatedText], { type: file.mimeType || 'text/plain' });

    if (isOffline) {
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
      return;
    }

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
      showToast('Saved');
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
      const b = new Blob([file.textContent], { type: file.mimeType || 'text/plain' });
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

  const handlePatchFile = async (fileId: string, body: Record<string, unknown>) => {
    if (isOffline) return;
    const res = await apiFetch(`/api/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      if (previewFile?.id === fileId) setPreviewFile(data.file);
      await refreshVault();
    }
  };

  const handleTrashOrDeleteFile = async (file: FileItem, permanent = false) => {
    if (isOffline) return;
    if (permanent) {
      await apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
    } else {
      await handlePatchFile(file.id, { trashed: true });
    }
    await refreshVault();
  };

  const handleTrashOrDeleteFolder = async (folder: FolderItem, permanent = false) => {
    if (isOffline) return;
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

  // --- Real Cloud Account Connections ---
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
    showToast(
      `Connected ${data.account.accountLabel} (${data.importedFilesCount || 0} remote files synced)`
    );
  };

  const handleSyncAccount = async (accountId: string) => {
    const res = await apiFetch(`/api/accounts/${accountId}/sync`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      await refreshVault();
      showToast(`Synced ${data.importedCount || 0} new remote file(s)`);
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

  if (!vault) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
        <img
          src="/cloudy-logo.png"
          alt="Cloudy"
          className="w-12 h-12 object-contain"
        />
        <div className="text-xs font-mono text-zinc-500">CLOUDY · X-KILO</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onResetFolder={() => setCurrentFolderId(null)}
        vault={vault}
      />

      <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isOffline={isOffline}
          onToggleOffline={handleToggleOffline}
          pendingSyncCount={pendingSyncCount}
        />

        {activeTab === 'providers' ? (
          <ProvidersHub
            vault={vault}
            isOffline={isOffline}
            onConnectCredentials={handleConnectCredentials}
            onSyncAccount={handleSyncAccount}
            onDisconnectAccount={handleDisconnectAccount}
            onUpdateAllocationRule={handleUpdateRule}
            onConnectedRefresh={async (label) => {
              await refreshVault();
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
          />
        )}
      </div>

      {/* Minimalist OLED Mobile Bottom Nav */}
      <nav className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-black/95 backdrop-blur-xl border-t border-white/[0.08] px-2 py-2 flex items-center justify-around">
        {[
          { id: 'files' as NavTab, label: 'Files', icon: FolderClosed },
          { id: 'providers' as NavTab, label: 'Storage', icon: Cloud },
          { id: 'ai-keys' as NavTab, label: 'AI API', icon: KeyRound },
          { id: 'android' as NavTab, label: 'Android', icon: Smartphone },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-1 px-4 py-1 rounded-xl text-[11px] font-medium transition ${
                active ? 'text-[#00F0FF]' : 'text-zinc-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
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
          showToast('Moved to selected storage account');
        }}
        onMoveFolder={async (f, folderId) => {
          await handlePatchFile(f.id, { folderId });
        }}
        onDownload={handleDownloadFile}
      />

      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 right-5 z-50 px-4 py-2.5 rounded-xl bg-[#07090C] border border-[#00F0FF]/40 text-xs font-medium text-[#00F0FF] shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
