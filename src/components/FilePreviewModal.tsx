import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  Save,
  CheckCircle2,
  HardDrive,
  FolderInput,
} from 'lucide-react';
import type { FileItem, StorageAccount, FolderItem } from '../types';
import { formatBytes, isTextEditable } from '../lib/format';
import { getOfflineBlob } from '../lib/offlineDb';

interface FilePreviewModalProps {
  file: FileItem | null;
  accounts: StorageAccount[];
  folders: FolderItem[];
  isOffline: boolean;
  onClose: () => void;
  onSaveContent: (file: FileItem, updatedText: string) => Promise<void>;
  onMoveProvider: (file: FileItem, targetAccountId: string) => Promise<void>;
  onMoveFolder: (file: FileItem, targetFolderId: string | null) => Promise<void>;
  onDownload: (file: FileItem) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  accounts,
  folders,
  isOffline,
  onClose,
  onSaveContent,
  onMoveProvider,
  onMoveFolder,
  onDownload,
}) => {
  const [textValue, setTextValue] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!file) return;
    let objectUrl: string | null = null;
    setSavedNotice(false);
    setTextValue(file.textContent || '');

    async function loadBinaryPreview() {
      if (!file) return;
      // Always check IndexedDB offline blob first so preview works 100% offline!
      const cached = await getOfflineBlob(file.id);
      if (cached?.blob) {
        objectUrl = URL.createObjectURL(cached.blob);
        setBlobUrl(objectUrl);
        if (!file.textContent && isTextEditable(file.mimeType, file.name)) {
          const txt = await cached.blob.text();
          setTextValue(txt);
        }
        return;
      }

      if (!isOffline) {
        try {
          const resp = await fetch(`/api/files/${file.id}/blob`);
          if (resp.ok) {
            const b = await resp.blob();
            objectUrl = URL.createObjectURL(b);
            setBlobUrl(objectUrl);
            if (!file.textContent && isTextEditable(file.mimeType, file.name)) {
              setTextValue(await b.text());
            }
          }
        } catch {
          // ignore
        }
      }
    }

    loadBinaryPreview();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
    };
  }, [file, isOffline]);

  if (!file) return null;

  const editable = isTextEditable(file.mimeType, file.name);
  const isImage = (file.mimeType || '').startsWith('image/');
  const isAudio = (file.mimeType || '').startsWith('audio/');
  const isVideo = (file.mimeType || '').startsWith('video/');
  const isPdf = (file.mimeType || '').includes('pdf');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveContent(file, textValue);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-[#0B1220] border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#080D18]">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">{file.name}</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span className="font-mono">{formatBytes(file.size)}</span>
              <span>·</span>
              <span className="text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isOffline ? 'Loaded from Offline Vault' : 'Synced Online & Offline'}
              </span>
              <span>·</span>
              <span className="font-mono text-[11px] text-slate-500">ID: {file.id}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {editable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : savedNotice ? 'Saved!' : 'Save Changes'}
              </button>
            )}
            <button
              onClick={() => onDownload(file)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata Bar: Folder & Cloud Provider Assignment */}
        <div className="px-5 py-2.5 bg-[#0C1425] border-b border-slate-800/80 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <FolderInput className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400">Carpeta:</span>
            <select
              value={file.folderId || ''}
              onChange={(e) => onMoveFolder(file, e.target.value || null)}
              className="px-2.5 py-1 rounded-lg bg-[#060A14] border border-slate-800 text-slate-200"
            >
              <option value="">/ (Root Drive)</option>
              {folders
                .filter((f) => !f.trashed)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>

          {!isOffline && (
            <div className="flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Cloud Storage Provider:</span>
              <select
                value={file.accountId}
                onChange={(e) => onMoveProvider(file, e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-[#060A14] border border-slate-800 text-slate-200"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountLabel} ({acc.providerName})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-5 bg-[#060A14]">
          {editable ? (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              spellCheck={false}
              className="w-full h-[52vh] p-4 rounded-2xl bg-[#0A1020] border border-slate-800 focus:border-sky-500/60 focus:outline-none font-mono text-xs sm:text-sm text-slate-100 leading-relaxed resize-none"
            />
          ) : isImage && blobUrl ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <img
                src={blobUrl}
                alt={file.name}
                className="max-h-[60vh] max-w-full rounded-xl object-contain border border-slate-800"
              />
            </div>
          ) : isAudio && blobUrl ? (
            <div className="py-16 flex flex-col items-center justify-center">
              <audio controls src={blobUrl} className="w-full max-w-md" />
            </div>
          ) : isVideo && blobUrl ? (
            <div className="flex items-center justify-center">
              <video controls src={blobUrl} className="max-h-[58vh] rounded-xl" />
            </div>
          ) : isPdf && blobUrl ? (
            <iframe
              src={blobUrl}
              title={file.name}
              className="w-full h-[60vh] rounded-xl border border-slate-800 bg-white"
            />
          ) : (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm text-slate-300 font-medium">
                Binary file ready ({file.mimeType || 'application/octet-stream'})
              </p>
              <p className="text-xs text-slate-400">
                Cached locally for offline access. Click Download above to save to your device.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
