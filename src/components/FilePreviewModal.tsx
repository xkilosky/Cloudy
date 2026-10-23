import React, { useEffect, useState } from 'react';
import { X, Download, Save, ExternalLink } from 'lucide-react';
import type { FileItem, StorageAccount, FolderItem } from '../types';
import { formatBytes, isTextEditable } from '../lib/format';
import { getOfflineBlob } from '../lib/offlineDb';
import { apiFetch } from '../lib/vaultClient';

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

  useEffect(() => {
    if (!file) return;
    let objectUrl: string | null = null;
    setTextValue(file.textContent || '');

    async function loadPreview() {
      if (!file) return;
      const cached = await getOfflineBlob(file.id);
      if (cached?.blob) {
        objectUrl = URL.createObjectURL(cached.blob);
        setBlobUrl(objectUrl);
        if (!file.textContent && isTextEditable(file.mimeType, file.name)) {
          setTextValue(await cached.blob.text());
        }
        return;
      }

      if (!isOffline) {
        try {
          const resp = await apiFetch(`/api/files/${file.id}/blob`);
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

    loadPreview();
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-[#07090C] border border-white/10 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">{file.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono">
              {formatBytes(file.size)} · {file.providerName}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {file.webUrl && (
              <a
                href={file.webUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-xs text-zinc-200 inline-flex items-center gap-1.5"
              >
                Cloud Link <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {editable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-xl bg-[#00F0FF] text-black font-bold text-xs inline-flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            <button
              onClick={() => onDownload(file)}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-zinc-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clean Location & Provider Selector */}
        <div className="px-5 py-2.5 border-b border-white/[0.06] bg-black flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Carpeta:</span>
            <select
              value={file.folderId || ''}
              onChange={(e) => onMoveFolder(file, e.target.value || null)}
              className="px-2.5 py-1 rounded-lg bg-[#080A0E] border border-white/10 text-white"
            >
              <option value="">/ Root</option>
              {folders
                .filter((f) => !f.trashed)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>

          {!isOffline && accounts.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Storage:</span>
              <select
                value={file.accountId}
                onChange={(e) => onMoveProvider(file, e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-[#080A0E] border border-white/10 text-white"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountLabel}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5 bg-black">
          {editable ? (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              spellCheck={false}
              className="w-full h-[54vh] p-4 rounded-xl bg-[#06080B] border border-white/[0.08] focus:border-[#00F0FF] focus:outline-none font-mono text-xs sm:text-sm text-white leading-relaxed resize-none"
            />
          ) : isImage && blobUrl ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <img
                src={blobUrl}
                alt={file.name}
                className="max-h-[60vh] max-w-full rounded-xl object-contain"
              />
            </div>
          ) : isAudio && blobUrl ? (
            <div className="py-16 flex justify-center">
              <audio controls src={blobUrl} className="w-full max-w-md" />
            </div>
          ) : isVideo && blobUrl ? (
            <div className="flex justify-center">
              <video controls src={blobUrl} className="max-h-[58vh] rounded-xl" />
            </div>
          ) : isPdf && blobUrl ? (
            <iframe
              src={blobUrl}
              title={file.name}
              className="w-full h-[60vh] rounded-xl bg-white"
            />
          ) : (
            <div className="py-16 text-center text-xs text-zinc-400">
              Binary file ({file.mimeType}). Click Download above to save locally.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
