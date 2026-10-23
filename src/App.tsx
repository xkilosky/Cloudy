import React, { useEffect, useState, useCallback } from 'react';
import {
  HardDrive,
  WifiOff,
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
  AndroidDownloadModal,
  type BeforeInstallPromptEvent,
} from './components/AndroidDownloadModal';
import { syncVaultState } from './lib/syncEngine';
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
    if (t === 'providers' || t === 'ai-keys' || t === 'offline') return t;
    return 'drive';
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  // Offline / Sync status
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Android PWA Install Prompt & Modal
  const [androidModalOpen, setAndroidModalOpen] = useState(false);
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
      setIsSyncing(true);
      try {
        const useOffline =
          forceOfflineOverride !== undefined ? forceOfflineOverride : simulatedOffline;
        const res = await syncVaultState(useOffline);
        setVault(res.state);
        setIsOffline(res.isOffline);
        setPendingSyncCount(res.pendingQueueCount);
      } catch (err) {
        console.error('Vault sync error:', err);
      } finally {
        setIsSyncing(false);
      }
    },
    [simulatedOffline]
  );

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  // Listen to browser online/offline events, OAuth popup callbacks, & Android beforeinstallprompt
  useEffect(() => {
    const handleOnline = () => {
      if (!simulatedOffline) {
        refreshVault(false);
        showToast('Back online — synced Offline Vault changes!');
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      showToast('Offline mode active — reading from local IndexedDB Vault.');
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CLOUDY_OAUTH_SUCCESS') {
        refreshVault(false);
        showToast(
          `Connected ${event.data.account?.providerName || 'Cloud Drive'} via One-Time OAuth!`
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

  const handleToggleSimulatedOffline = async () => {
    const next = !simulatedOffline;
    setSimulatedOffline(next);
    await refreshVault(next);
    showToast(
      next
        ? 'Switched to Offline Vault Mode — test browsing & opening your files offline!'
        : 'Reconnected Online — all queued offline items synced!'
    );
  };

  // --- File & Folder Actions (Seamlessly working Online AND Offline!) ---
  const handleCreateFolder = async (
    name: string,
    parentId: string | null,
    color: string
  ) => {
    const clientFolderId = `fld_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    if (isOffline && vault) {
      const offlineFolder: FolderItem = {
        id: clientFolderId,
        name,
        parentId,
        color,
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
        payload: { id: clientFolderId, name, parentId, color, offlinePinned: true },
        createdAt: now,
      });
      await refreshVault(true);
      showToast(`Created carpeta "${name}" offline (queued for cloud sync).`);
      return;
    }

    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clientFolderId, name, parentId, color }),
    });
    await refreshVault();
    showToast(`Created carpeta "${name}" & synced offline.`);
  };

  const handleUploadFiles = async (
    fileList: FileList | File[],
    folderId: string | null,
    accountId: string
  ) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    if (isOffline && vault) {
      const now = new Date().toISOString();
      const coreAcc = vault.accounts[0];
      for (const rawFile of arr) {
        const fid = `fil_${Math.random().toString(36).slice(2, 11)}`;
        const isTxt = rawFile.type.startsWith('text/') || /\.(md|txt|json|csv)$/i.test(rawFile.name);
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
          tags: ['offline-added'],
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
      showToast(`Cached ${arr.length} file(s) offline — will upload when online.`);
      return;
    }

    const fd = new FormData();
    for (const f of arr) fd.append('files', f);
    if (folderId) fd.append('folderId', folderId);
    fd.append('accountId', accountId);

    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      await refreshVault();
      const firstProvider = data.files?.[0]?.providerName || 'Cloud Pool';
      showToast(`Uploaded ${arr.length} file(s) → ${firstProvider} & cached offline!`);
    }
  };

  const handleCreateNote = async (
    name: string,
    content: string,
    mimeType: string,
    kind: 'note' | 'dataset',
    folderId: string | null,
    accountId: string,
    tags: string[]
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
        tags,
        textContent: content,
        createdAt: now,
        updatedAt: now,
      };
      await putStoreItem('files', item);
      await saveOfflineBlob(id, blob, now);
      await enqueueOfflineAction({
        id: `q_${Date.now()}_${id}`,
        type: 'create_note',
        payload: { id, name, content, mimeType, kind, folderId, accountId, tags },
        createdAt: now,
      });
      await refreshVault(true);
      showToast(`Saved "${name}" to local Offline Vault!`);
      return;
    }

    await fetch('/api/files/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, content, mimeType, kind, folderId, accountId, tags }),
    });
    await refreshVault();
    showToast(`Created "${name}" & synced for offline AI access!`);
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
      showToast('Saved changes offline — queued for cloud sync.');
      return;
    }

    const res = await fetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textContent: updatedText }),
    });
    if (res.ok) {
      const data = await res.json();
      await saveOfflineBlob(file.id, blob, data.file.updatedAt);
      setPreviewFile(data.file);
      await refreshVault();
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
    // Prefer local IndexedDB blob so download works instantaneously offline & online!
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
    window.open(`/api/files/${file.id}/blob?download=1`, '_blank');
  };

  const handlePatchFile = async (fileId: string, body: Record<string, unknown>) => {
    if (isOffline) {
      showToast('Reconnect online to change cloud provider or trash items.');
      return;
    }
    const res = await fetch(`/api/files/${fileId}`, {
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
      await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      showToast(`Deleted "${file.name}" permanently.`);
    } else {
      await handlePatchFile(file.id, { trashed: true });
      showToast(`Moved "${file.name}" to Trash.`);
    }
    await refreshVault();
  };

  const handleTrashOrDeleteFolder = async (folder: FolderItem, permanent = false) => {
    if (isOffline) return;
    if (permanent) {
      await fetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
    } else {
      await fetch(`/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    }
    if (currentFolderId === folder.id) setCurrentFolderId(null);
    await refreshVault();
  };

  // --- Providers & OAuth ---
  const handleConnectProvider = async (
    providerId: string,
    email: string,
    accountLabel: string
  ) => {
    const res = await fetch(`/api/oauth/${providerId}/one-time-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, accountLabel }),
    });
    if (res.ok) {
      const data = await res.json();
      await refreshVault();
      showToast(
        `Connected ${data.account.accountLabel} via One-Time OAuth!`
      );
    }
  };

  const handleDisconnectAccount = async (accountId: string) => {
    await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    await refreshVault();
    showToast('Disconnected cloud drive (files kept safe in Cloudy Core Vault).');
  };

  const handleUpdateRule = async (allocationRule: AllocationRule) => {
    await fetch('/api/vault/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocationRule }),
    });
    await refreshVault();
    showToast(`Updated storage rule: ${allocationRule.replace('_', ' ')}`);
  };

  const handleSaveLiveOAuthApp = async (
    providerId: string,
    clientId: string,
    clientSecret: string
  ) => {
    await fetch(`/api/oauth/config/${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    await refreshVault();
  };

  // --- AI API Keys ---
  const handleCreateAiKey = async (
    name: string,
    scope: 'read' | 'read_write',
    allowedFolderIds: string[]
  ) => {
    await fetch('/api/ai-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope, allowedFolderIds }),
    });
    await refreshVault();
    showToast(`Generated AI API key "${name}"!`);
  };

  const handleToggleKeyActive = async (key: AiApiKey) => {
    await fetch(`/api/ai-keys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !key.active }),
    });
    await refreshVault();
  };

  const handleDeleteKey = async (keyId: string) => {
    await fetch(`/api/ai-keys/${keyId}`, { method: 'DELETE' });
    await refreshVault();
    showToast('Revoked AI API key.');
  };

  const handleTriggerPwaInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  if (!vault) {
    return (
      <div className="min-h-screen bg-[#05080F] flex flex-col items-center justify-center gap-4">
        <img
          src="/cloudy-logo.png"
          alt="Cloudy"
          className="w-16 h-16 object-contain animate-pulse"
        />
        <div className="text-sm font-semibold text-slate-300">
          Initializing Cloudy Vault by X-Kilo...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#05080F] text-slate-100 cloudy-grid-bg">
      {/* Desktop Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        currentFolderId={currentFolderId}
        onSelectFolder={setCurrentFolderId}
        vault={vault}
        onOpenAndroidModal={() => setAndroidModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isOffline={isOffline}
          simulatedOffline={simulatedOffline}
          onToggleSimulatedOffline={handleToggleSimulatedOffline}
          pendingSyncCount={pendingSyncCount}
          onSyncNow={() => refreshVault()}
          isSyncing={isSyncing}
          onOpenAndroidModal={() => setAndroidModalOpen(true)}
        />

        {activeTab === 'providers' ? (
          <ProvidersHub
            vault={vault}
            isOffline={isOffline}
            onConnectProvider={handleConnectProvider}
            onDisconnectAccount={handleDisconnectAccount}
            onUpdateAllocationRule={handleUpdateRule}
            onSaveLiveOAuthApp={handleSaveLiveOAuthApp}
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
        ) : (
          <DriveExplorer
            mode={activeTab}
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
            onToggleStarFile={(f) => handlePatchFile(f.id, { starred: !f.starred })}
            onToggleOfflineFile={(f) =>
              handlePatchFile(f.id, { offlinePinned: !f.offlinePinned })
            }
            onTrashOrDeleteFile={handleTrashOrDeleteFile}
            onRestoreFile={(f) => handlePatchFile(f.id, { trashed: false })}
            onTrashOrDeleteFolder={handleTrashOrDeleteFolder}
            onOpenProvidersTab={() => setActiveTab('providers')}
          />
        )}
      </div>

      {/* Mobile / Android Bottom Navigation Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-[#080D1A]/95 backdrop-blur-xl border-t border-slate-800 px-2 py-1.5 flex items-center justify-around">
        {[
          { id: 'drive' as NavTab, label: 'Carpetas', icon: HardDrive },
          { id: 'offline' as NavTab, label: 'Offline', icon: WifiOff },
          { id: 'providers' as NavTab, label: 'Free GB', icon: Cloud },
          { id: 'ai-keys' as NavTab, label: 'AI Keys', icon: KeyRound },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition ${
                active ? 'text-sky-400' : 'text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setAndroidModalOpen(true)}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-emerald-400"
        >
          <Smartphone className="w-5 h-5" />
          <span>APK</span>
        </button>
      </nav>

      {/* File Preview & Inline Editor Modal */}
      <FilePreviewModal
        file={previewFile}
        accounts={vault.accounts}
        folders={vault.folders}
        isOffline={isOffline}
        onClose={() => setPreviewFile(null)}
        onSaveContent={handleSaveFileContent}
        onMoveProvider={async (f, targetAccountId) => {
          await handlePatchFile(f.id, { targetAccountId });
          showToast('Migrated file to selected cloud provider!');
        }}
        onMoveFolder={async (f, folderId) => {
          await handlePatchFile(f.id, { folderId });
          showToast('Moved file to carpeta!');
        }}
        onDownload={handleDownloadFile}
      />

      {/* Android PWA + APK Download Modal */}
      <AndroidDownloadModal
        open={androidModalOpen}
        onClose={() => setAndroidModalOpen(false)}
        deferredPrompt={deferredPrompt}
        onTriggerPwaInstall={handleTriggerPwaInstall}
        swReady={swReady}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-50 px-4 py-2.5 rounded-2xl bg-[#0E182D] border border-sky-500/40 text-xs font-semibold text-sky-100 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
