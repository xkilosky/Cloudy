import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

  const editable = file ? isTextEditable(file.mimeType, file.name) : false;
  const isImage = (file?.mimeType || '').startsWith('image/');
  const isAudio = (file?.mimeType || '').startsWith('audio/');
  const isVideo = (file?.mimeType || '').startsWith('video/');
  const isPdf = (file?.mimeType || '').includes('pdf');

  const handleSave = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await onSaveContent(file, textValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-surface border border-line-strong flex flex-col overflow-hidden shadow-float"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink truncate">
                  {file.name}
                </h3>
                <p className="text-xs text-ink-muted mt-0.5 font-mono">
                  {formatBytes(file.size)} · {file.providerName}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {file.webUrl && (
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-full bg-elevated hover:bg-canvas text-xs text-ink-secondary hover:text-ink inline-flex items-center gap-1.5 transition"
                  >
                    Cloud <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {editable && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center gap-1.5 shadow-glow transition"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                )}
                <button
                  onClick={() => onDownload(file)}
                  className="px-3.5 py-1.5 rounded-full bg-elevated hover:bg-canvas border border-line text-ink text-xs font-medium inline-flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full text-ink-muted hover:text-ink hover:bg-elevated transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Metadata Controls */}
            <div className="px-6 py-2.5 border-b border-line bg-canvas/50 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-ink-muted">Carpeta:</span>
                <select
                  value={file.folderId || ''}
                  onChange={(e) => onMoveFolder(file, e.target.value || null)}
                  className="px-3 py-1 rounded-xl bg-surface border border-line-strong text-ink focus:outline-none"
                >
                  <option value="">/ My Vault</option>
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
                  <span className="text-ink-muted">Cloud Provider:</span>
                  <select
                    value={file.accountId}
                    onChange={(e) => onMoveProvider(file, e.target.value)}
                    className="px-3 py-1 rounded-xl bg-surface border border-line-strong text-ink focus:outline-none"
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

            {/* Preview / Editor Canvas */}
            <div className="flex-1 overflow-auto p-6 bg-canvas">
              {editable ? (
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  spellCheck={false}
                  className="w-full h-[54vh] p-5 rounded-2xl bg-surface border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none font-mono text-xs sm:text-sm text-ink leading-relaxed resize-none transition-all"
                />
              ) : isImage && blobUrl ? (
                <div className="flex items-center justify-center min-h-[40vh]">
                  <img
                    src={blobUrl}
                    alt={file.name}
                    className="max-h-[60vh] max-w-full rounded-2xl object-contain shadow-card"
                  />
                </div>
              ) : isAudio && blobUrl ? (
                <div className="py-16 flex justify-center">
                  <audio controls src={blobUrl} className="w-full max-w-md" />
                </div>
              ) : isVideo && blobUrl ? (
                <div className="flex justify-center">
                  <video controls src={blobUrl} className="max-h-[58vh] rounded-2xl" />
                </div>
              ) : isPdf && blobUrl ? (
                <iframe
                  src={blobUrl}
                  title={file.name}
                  className="w-full h-[60vh] rounded-2xl bg-white"
                />
              ) : (
                <div className="py-16 text-center text-xs text-ink-secondary">
                  Binary file ({file.mimeType}). Click Download above to save locally.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
