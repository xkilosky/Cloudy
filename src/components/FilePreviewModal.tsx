import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  Save,
  ExternalLink,
  Folder,
  Cloud,
  Loader2,
  FileText,
  AlertCircle,
} from 'lucide-react';
import type { FileItem, StorageAccount, FolderItem } from '../types';
import { formatBytes, isTextEditable } from '../lib/format';
import { getOfflineBlob, saveOfflineBlob } from '../lib/offlineDb';
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
  const [resolvedMime, setResolvedMime] = useState<string>('');
  const [loadingBlob, setLoadingBlob] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const initialEditable = isTextEditable(file.mimeType, file.name);

    setTextValue(file.textContent || '');
    setResolvedMime(file.mimeType || '');
    setBlobError(null);

    // Zero-network fast path when editable text is already in memory
    if (initialEditable && typeof file.textContent === 'string') {
      setLoadingBlob(false);
      return;
    }

    async function loadPreview() {
      if (!file) return;
      setLoadingBlob(true);
      try {
        const cached = await getOfflineBlob(file.id);
        if (cached?.blob) {
          if (cancelled) return;
          const mime = cached.blob.type || file.mimeType || '';
          setResolvedMime(mime);
          objectUrl = URL.createObjectURL(cached.blob);
          setBlobUrl(objectUrl);
          if (
            !file.textContent &&
            (isTextEditable(mime, file.name) || mime.startsWith('text/'))
          ) {
            setTextValue(await cached.blob.text());
          }
          return;
        }

        if (isOffline) {
          if (!cancelled) {
            setBlobError(
              'This cloud file has not been downloaded for offline viewing yet. Connect to the internet once to cache it locally.'
            );
          }
          return;
        }

        const resp = await apiFetch(`/api/files/${file.id}/blob`);
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          if (!cancelled) {
            setBlobError(
              errBody?.error ||
                'Unable to load file preview from cloud provider.'
            );
          }
          return;
        }

        const b = await resp.blob();
        if (cancelled) return;
        const headerMime = resp.headers.get('content-type') || b.type || file.mimeType || '';
        setResolvedMime(headerMime);
        saveOfflineBlob(file.id, b, file.updatedAt).catch(() => {});

        objectUrl = URL.createObjectURL(b);
        setBlobUrl(objectUrl);
        if (
          !file.textContent &&
          (isTextEditable(headerMime, file.name) || headerMime.startsWith('text/'))
        ) {
          setTextValue(await b.text());
        }
      } catch {
        if (!cancelled) {
          setBlobError('Network interrupted while loading cloud preview.');
        }
      } finally {
        if (!cancelled) setLoadingBlob(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
      setLoadingBlob(false);
    };
  }, [file?.id, file?.updatedAt, isOffline]);

  const effectiveMime = resolvedMime || file?.mimeType || '';
  const editable = file ? isTextEditable(file.mimeType, file.name) : false;
  const isReadonlyExportedText =
    !editable && effectiveMime.startsWith('text/') && Boolean(textValue);
  const isImage = effectiveMime.startsWith('image/');
  const isAudio = effectiveMime.startsWith('audio/');
  const isVideo = effectiveMime.startsWith('video/');
  const isPdf = effectiveMime.includes('pdf');
  const canInlinePdf = (() => {
    if (typeof navigator === 'undefined') return true;
    const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
    if (typeof nav.pdfViewerEnabled === 'boolean') {
      return nav.pdfViewerEnabled;
    }
    return !/Android|iPhone|iPad|iPod/i.test(nav.userAgent || '');
  })();

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
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/75 sm:backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-4xl h-[92dvh] sm:h-[85dvh] sm:max-h-[90dvh] rounded-t-3xl sm:rounded-3xl bg-surface border-t sm:border border-line-strong flex flex-col overflow-hidden shadow-float pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mt-2.5 sm:hidden shrink-0" />

            {/* Responsive Header: Uncrushed Title + Action Bar */}
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-ink break-words sm:truncate leading-snug">
                    {file.name}
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5 font-mono truncate">
                    {formatBytes(file.size)} · {file.providerName}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close preview"
                  className="sm:hidden p-2 -mr-1 -mt-1 rounded-full text-ink-muted hover:text-ink active:bg-elevated shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
                {editable && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 sm:flex-initial px-4 py-2 sm:py-1.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center justify-center gap-1.5 shadow-glow transition disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDownload(file)}
                  className="flex-1 sm:flex-initial px-3.5 py-2 sm:py-1.5 rounded-full bg-elevated hover:bg-canvas border border-line text-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                {file.webUrl && (
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 sm:py-1.5 rounded-full bg-elevated hover:bg-canvas border border-line text-xs text-ink-secondary hover:text-ink inline-flex items-center justify-center gap-1.5 transition"
                  >
                    <span>Cloud</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close preview"
                  className="hidden sm:inline-flex p-2 rounded-full text-ink-muted hover:text-ink hover:bg-elevated transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Metadata Controls (Mobile-Safe Truncated Selects) */}
            <div className="px-4 sm:px-6 py-2.5 border-b border-line bg-canvas/50 flex flex-wrap items-center gap-2.5 sm:gap-4 text-xs shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
                <Folder className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
                <span className="text-ink-muted hidden sm:inline">Carpeta:</span>
                <select
                  value={file.folderId || ''}
                  onChange={(e) => onMoveFolder(file, e.target.value || null)}
                  className="min-w-0 flex-1 sm:w-auto max-w-full truncate px-2.5 py-1.5 sm:py-1 rounded-xl bg-surface border border-line-strong text-ink focus:outline-none"
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
                <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
                  <Cloud className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="text-ink-muted hidden sm:inline">Cloud:</span>
                  <select
                    value={file.accountId}
                    onChange={(e) => onMoveProvider(file, e.target.value)}
                    className="min-w-0 flex-1 sm:w-auto max-w-full truncate px-2.5 py-1.5 sm:py-1 rounded-xl bg-surface border border-line-strong text-ink focus:outline-none"
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

            {/* Flexible Preview / Editor Canvas (Dynamic Keyboard-Safe Height) */}
            <div className="flex-1 min-h-0 overflow-auto p-3.5 sm:p-6 bg-canvas flex flex-col">
              {editable ? (
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  spellCheck={false}
                  className="flex-1 min-h-[200px] w-full p-4 sm:p-5 rounded-2xl bg-surface border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none font-mono text-xs sm:text-sm text-ink leading-relaxed resize-none transition-all"
                />
              ) : loadingBlob ? (
                <div className="flex-1 py-16 flex flex-col items-center justify-center gap-3 text-xs text-ink-secondary">
                  <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  <span>Loading preview from {file.providerName}...</span>
                </div>
              ) : blobError ? (
                <div className="flex-1 py-12 px-4 flex flex-col items-center justify-center text-center gap-3 max-w-md mx-auto">
                  <div className="w-11 h-11 rounded-2xl bg-[#D97757]/15 text-[#F0A085] flex items-center justify-center">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <p className="text-xs sm:text-sm text-ink leading-relaxed">
                    {blobError}
                  </p>
                  {file.webUrl && (
                    <a
                      href={file.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-full bg-accent text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow"
                    >
                      <span>Open in {file.providerName}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ) : isReadonlyExportedText ? (
                <pre className="flex-1 w-full p-4 sm:p-5 rounded-2xl bg-surface border border-line font-mono text-xs sm:text-sm text-ink leading-relaxed whitespace-pre-wrap overflow-auto">
                  {textValue}
                </pre>
              ) : isImage && blobUrl ? (
                <div className="flex-1 flex items-center justify-center min-h-[32vh]">
                  <img
                    src={blobUrl}
                    alt={file.name}
                    className="max-h-full max-w-full rounded-2xl object-contain shadow-card"
                  />
                </div>
              ) : isAudio && blobUrl ? (
                <div className="flex-1 py-12 flex items-center justify-center">
                  <audio controls src={blobUrl} className="w-full max-w-md" />
                </div>
              ) : isVideo && blobUrl ? (
                <div className="flex-1 flex items-center justify-center">
                  <video
                    controls
                    src={blobUrl}
                    className="max-h-full max-w-full rounded-2xl"
                  />
                </div>
              ) : isPdf && blobUrl ? (
                canInlinePdf ? (
                  <iframe
                    src={blobUrl}
                    title={file.name}
                    className="flex-1 w-full min-h-[50vh] rounded-2xl bg-white"
                  />
                ) : (
                  <div className="flex-1 py-12 px-4 flex flex-col items-center justify-center text-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-ink">
                        PDF ready for mobile viewer
                      </p>
                      <p className="text-xs text-ink-muted">
                        Cached locally for instant offline access
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <a
                        href={blobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2.5 rounded-full bg-accent text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow"
                      >
                        <span>Open PDF</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => onDownload(file)}
                        className="px-4 py-2.5 rounded-full bg-surface border border-line-strong text-ink text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save Copy</span>
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex-1 py-16 flex flex-col items-center justify-center text-center gap-3 text-xs text-ink-secondary">
                  <p>
                    Document ({effectiveMime || 'binary'}). Tap Download above to open locally.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
