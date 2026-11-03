import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  FileText,
  FileCode2,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  Upload,
  FolderPlus,
  FilePlus2,
  ChevronRight,
  Download,
  Trash2,
  RotateCcw,
  X,
  Sparkles,
  Cloud,
  ArrowUpDown,
  Search,
} from 'lucide-react';
import type { VaultState, FolderItem, FileItem } from '../types';
import { formatBytes, formatRelativeTime } from '../lib/format';

interface DriveExplorerProps {
  vault: VaultState;
  currentFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onNavigateToProviders: () => void;
  searchQuery: string;
  onClearSearch: () => void;
  isOffline: boolean;
  onUploadFiles: (files: FileList | File[], folderId: string | null) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onCreateNote: (
    name: string,
    content: string,
    mimeType: string,
    kind: 'note' | 'dataset',
    folderId: string | null
  ) => Promise<void>;
  onOpenFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  onTrashOrDeleteFile: (file: FileItem, permanent?: boolean) => Promise<void>;
  onRestoreFile: (file: FileItem) => Promise<void>;
  onTrashOrDeleteFolder: (folder: FolderItem, permanent?: boolean) => Promise<void>;
  onRestoreFolder: (folder: FolderItem) => Promise<void>;
}

type SortBy = 'recent' | 'name' | 'size';

function getFileVisual(mimeType: string, name: string) {
  const lower = (name || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return { Icon: ImageIcon, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.14)' };
  }
  if (mime.startsWith('video/')) {
    return { Icon: Film, color: '#4D6BFE', bg: 'rgba(77, 107, 254, 0.14)' };
  }
  if (mime.startsWith('audio/')) {
    return { Icon: Music, color: '#EC4899', bg: 'rgba(236, 72, 153, 0.14)' };
  }
  if (
    mime.includes('json') ||
    /\.(js|ts|tsx|py|json|yaml|yml|sh|sql|html|css)$/.test(lower)
  ) {
    return { Icon: FileCode2, color: '#10A37F', bg: 'rgba(16, 163, 127, 0.14)' };
  }
  if (mime.includes('zip') || mime.includes('tar') || /\.(zip|rar|7z|gz)$/.test(lower)) {
    return { Icon: FileArchive, color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.14)' };
  }
  return { Icon: FileText, color: '#D97757', bg: 'rgba(217, 119, 87, 0.14)' };
}

export const DriveExplorer: React.FC<DriveExplorerProps> = ({
  vault,
  currentFolderId,
  onSelectFolder,
  onNavigateToProviders,
  searchQuery,
  onClearSearch,
  onUploadFiles,
  onCreateFolder,
  onCreateNote,
  onOpenFile,
  onDownloadFile,
  onTrashOrDeleteFile,
  onRestoreFile,
  onTrashOrDeleteFolder,
  onRestoreFolder,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [viewFilter, setViewFilter] = useState<'active' | 'trash'>('active');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [noteContent, setNoteContent] = useState('');

  const rawQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;

  const trashTotalCount = useMemo(() => {
    const tf = vault.folders.filter((f) => f.trashed).length;
    const tfl = vault.files.filter((f) => f.trashed).length;
    return tf + tfl;
  }, [vault.folders, vault.files]);

  const breadcrumbs = useMemo(() => {
    const chain: FolderItem[] = [];
    let ptr = currentFolderId
      ? vault.folders.find((f) => f.id === currentFolderId) || null
      : null;
    const guard = new Set<string>();
    while (ptr && !guard.has(ptr.id)) {
      guard.add(ptr.id);
      chain.unshift(ptr);
      ptr = ptr.parentId
        ? vault.folders.find((f) => f.id === ptr!.parentId) || null
        : null;
    }
    return chain;
  }, [vault.folders, currentFolderId]);

  const q = searchQuery.trim().toLowerCase();

  const visibleFolders = useMemo(() => {
    const filtered = vault.folders.filter((f) => {
      if (viewFilter === 'trash') return Boolean(f.trashed);
      if (f.trashed) return false;
      if (q) return f.name.toLowerCase().includes(q);
      return (f.parentId || null) === (currentFolderId || null);
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return (
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
      );
    });
  }, [vault.folders, viewFilter, q, currentFolderId, sortBy]);

  const visibleFiles = useMemo(() => {
    const filtered = vault.files.filter((fl) => {
      if (viewFilter === 'trash') return Boolean(fl.trashed);
      if (fl.trashed) return false;
      if (accountFilter !== 'all' && fl.accountId !== accountFilter) return false;
      if (q) {
        return (
          fl.name.toLowerCase().includes(q) ||
          (fl.textContent || '').toLowerCase().includes(q)
        );
      }
      return (fl.folderId || null) === (currentFolderId || null);
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      return (
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
      );
    });
  }, [vault.files, viewFilter, accountFilter, q, currentFolderId, sortBy]);

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const fl of vault.files) {
      if (!fl.trashed && fl.folderId) {
        map.set(fl.folderId, (map.get(fl.folderId) || 0) + 1);
      }
    }
    return map;
  }, [vault.files]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) {
      setUploading(true);
      try {
        await onUploadFiles(e.dataTransfer.files, currentFolderId);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleSubmitFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim(), currentFolderId);
    setNewFolderName('');
    setShowFolderModal(false);
  };

  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteName.trim()) return;
    const finalName = noteName.includes('.')
      ? noteName.trim()
      : `${noteName.trim()}.md`;
    const mime = finalName.endsWith('.json')
      ? 'application/json'
      : 'text/markdown';
    await onCreateNote(finalName, noteContent, mime, 'note', currentFolderId);
    setNoteName('');
    setNoteContent('');
    setShowNoteModal(false);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types?.includes('Files')) {
          dragDepthRef.current += 1;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
      className="relative flex-1 px-3.5 sm:px-8 py-5 sm:py-7 min-w-0"
    >
      {/* Spring Drag & Drop Overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-4 z-40 rounded-3xl bg-canvas/90 backdrop-blur-xl border-2 border-dashed border-accent flex flex-col items-center justify-center gap-3 pointer-events-none shadow-float"
          >
            <div className="w-14 h-14 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
              <Upload className="w-7 h-7" />
            </div>
            <p className="text-base font-semibold text-ink">
              Drop files to upload to your pooled cloud
            </p>
            <p className="text-xs text-ink-secondary">
              Automatically synced to your Offline Vault
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8 min-w-0">
        {/* Compact Mobile Cloud Pool Capsule (Visible on <lg where Sidebar is hidden) */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.99 }}
          onClick={onNavigateToProviders}
          className="lg:hidden w-full p-3.5 rounded-2xl bg-surface/90 border border-line hover:border-line-strong flex items-center justify-between gap-3 text-left shadow-card transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ink truncate">
                  {vault.accounts.length > 0
                    ? `Cloud Pool · ${vault.accounts.length} Connected`
                    : 'No Cloud Storage Connected'}
                </span>
                <span className="font-mono text-[11px] font-semibold text-ink-secondary tabular-nums shrink-0">
                  {rawQuota > 0
                    ? `${formatBytes(totalUsed)} / ${formatBytes(rawQuota, 0)}`
                    : '+ Connect Free'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${rawQuota > 0 ? Math.max(4, usedPct) : 0}%` }}
                />
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
        </motion.button>

        {/* Active Search Filter Pill */}
        <AnimatePresence>
          {q && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-accent-soft border border-accent/35 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Search className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-ink truncate">
                  Filtering for <strong className="font-semibold">&ldquo;{searchQuery}&rdquo;</strong>
                </span>
                <span className="text-ink-muted shrink-0">
                  · {visibleFolders.length + visibleFiles.length} match
                  {visibleFolders.length + visibleFiles.length === 1 ? '' : 'es'}
                </span>
              </div>
              <button
                type="button"
                onClick={onClearSearch}
                className="shrink-0 px-2.5 py-1 rounded-full bg-surface text-ink-secondary hover:text-ink text-[11px] font-medium inline-flex items-center gap-1"
              >
                <span>Clear</span>
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header Bar: Scrollable Breadcrumbs + Balanced Studio Composer Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
            {/* Scrollable Breadcrumb Trail */}
            <div className="flex items-center gap-1 text-sm overflow-x-auto no-scrollbar min-w-0 py-0.5">
              <button
                type="button"
                onClick={() => {
                  setViewFilter('active');
                  onSelectFolder(null);
                }}
                className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[13px] font-semibold transition-colors ${
                  !currentFolderId && viewFilter === 'active'
                    ? 'text-ink bg-surface border border-line shadow-card'
                    : 'text-ink-secondary hover:text-ink'
                }`}
              >
                My Vault
              </button>

              {viewFilter === 'active' &&
                breadcrumbs.map((b) => (
                  <React.Fragment key={b.id}>
                    <ChevronRight className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      onClick={() => onSelectFolder(b.id)}
                      className={`shrink-0 max-w-[150px] truncate px-2.5 py-1.5 rounded-xl text-[13px] font-medium transition-colors ${
                        b.id === currentFolderId
                          ? 'text-ink bg-surface border border-line shadow-card'
                          : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      {b.name}
                    </motion.button>
                  </React.Fragment>
                ))}
            </div>

            {/* Segmented Active / Trash Pill */}
            <div className="shrink-0 inline-flex bg-surface border border-line rounded-full p-0.5 text-xs">
              {(['active', 'trash'] as const).map((tab) => {
                const active = viewFilter === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setViewFilter(tab)}
                    className={`relative px-3 py-1 rounded-full font-medium transition-colors ${
                      active ? 'text-ink' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="explorerViewFilter"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        className="absolute inset-0 rounded-full bg-elevated border border-line-strong"
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1">
                      {tab === 'active' ? 'Files' : 'Trash'}
                      {tab === 'trash' && trashTotalCount > 0 && (
                        <span className="text-[10px] font-mono opacity-80">
                          ({trashTotalCount})
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Balanced Action Pills (3-Col Grid on Mobile, Inline Row on Desktop) */}
          <div className="grid grid-cols-3 sm:flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                if (e.target.files?.length) {
                  setUploading(true);
                  try {
                    await onUploadFiles(e.target.files, currentFolderId);
                  } finally {
                    setUploading(false);
                    e.target.value = '';
                  }
                }
              }}
            />

            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowFolderModal(true)}
              className="px-3 sm:px-3.5 py-2.5 sm:py-2 rounded-2xl sm:rounded-full bg-surface hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-card transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
              <span className="truncate">Carpeta</span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowNoteModal(true)}
              className="px-3 sm:px-3.5 py-2.5 sm:py-2 rounded-2xl sm:rounded-full bg-surface hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-card transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-[#10A37F] shrink-0" />
              <span className="truncate">Note</span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ y: -1, scale: 1.01 }}
              whileTap={{ scale: 0.97 }}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 sm:px-4 py-2.5 sm:py-2 rounded-2xl sm:rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-glow transition-colors disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {uploading ? 'Uploading...' : 'Upload'}
              </span>
            </motion.button>
          </div>
        </div>

        {/* Cloud Filter Chips & Sort Control (Shown when multiple clouds exist or files present) */}
        {(vault.accounts.length > 1 || visibleFiles.length > 1) &&
          viewFilter === 'active' && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
                {vault.accounts.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setAccountFilter('all')}
                      className={`shrink-0 px-3 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                        accountFilter === 'all'
                          ? 'bg-accent-soft border-accent/50 text-ink'
                          : 'bg-surface/70 border-line text-ink-secondary hover:text-ink'
                      }`}
                    >
                      All Clouds ({vault.accounts.length})
                    </button>
                    {vault.accounts.map((acc) => {
                      const active = accountFilter === acc.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() =>
                            setAccountFilter(active ? 'all' : acc.id)
                          }
                          className={`shrink-0 max-w-[180px] truncate px-3 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                            active
                              ? 'bg-accent-soft border-accent/50 text-ink'
                              : 'bg-surface/70 border-line text-ink-secondary hover:text-ink'
                          }`}
                        >
                          {acc.accountLabel}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setSortBy((prev) =>
                    prev === 'recent'
                      ? 'name'
                      : prev === 'name'
                        ? 'size'
                        : 'recent'
                  )
                }
                className="shrink-0 px-3 py-1 rounded-full bg-surface/80 hover:bg-surface border border-line text-[11.5px] font-medium text-ink-secondary hover:text-ink inline-flex items-center gap-1.5 transition-colors"
                title="Cycle sort order"
              >
                <ArrowUpDown className="w-3 h-3 text-accent" />
                <span>
                  {sortBy === 'recent'
                    ? 'Recent'
                    : sortBy === 'name'
                      ? 'A–Z'
                      : 'Largest'}
                </span>
              </button>
            </div>
          )}

        {/* Carpetas (Folders) Grid */}
        <AnimatePresence mode="popLayout">
          {visibleFolders.length > 0 && (
            <motion.section
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
                Carpetas · {visibleFolders.length}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                {visibleFolders.map((folder, idx) => {
                  const count = folderCounts.get(folder.id) || 0;
                  return (
                    <motion.div
                      layout
                      key={folder.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{
                        duration: 0.22,
                        delay: Math.min(idx * 0.03, 0.18),
                      }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.985 }}
                      onClick={() => {
                        if (viewFilter === 'active') onSelectFolder(folder.id);
                      }}
                      className="group rounded-2xl bg-surface hover:bg-elevated/90 border border-line hover:border-line-strong p-3.5 sm:p-4 flex items-center justify-between gap-2.5 cursor-pointer shadow-card transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-[#D97757]/15 text-[#E58A6B] flex items-center justify-center shrink-0">
                          <Folder className="w-[18px] h-[18px] fill-[#D97757]/20" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium text-ink truncate">
                            {folder.name}
                          </div>
                          <div className="text-[11px] text-ink-muted">
                            {count} {count === 1 ? 'file' : 'files'}
                          </div>
                        </div>
                      </div>

                      {/* Always accessible on mobile touchscreens; hover-revealed on desktop */}
                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {viewFilter === 'trash' && (
                          <button
                            type="button"
                            onClick={() => onRestoreFolder(folder)}
                            className="p-2 rounded-xl text-ink-secondary hover:text-[#10A37F] hover:bg-canvas/60 active:bg-canvas/80 transition"
                            title="Restore carpeta"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onTrashOrDeleteFolder(folder, viewFilter === 'trash')
                          }
                          className={`${
                            viewFilter === 'trash'
                              ? 'opacity-100'
                              : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'
                          } p-2 rounded-xl text-ink-muted hover:text-red-400 hover:bg-canvas/60 active:bg-canvas/80 transition`}
                          title={
                            viewFilter === 'trash'
                              ? 'Delete forever'
                              : 'Move to trash'
                          }
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Files List */}
        <section className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
            Files · {visibleFiles.length}
          </div>

          {visibleFiles.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() =>
                viewFilter === 'active' && fileInputRef.current?.click()
              }
              className="rounded-3xl border border-dashed border-line-strong bg-surface/40 hover:bg-surface/70 py-14 sm:py-16 px-6 text-center space-y-3 cursor-pointer transition-colors"
            >
              <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent mx-auto flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">
                  {viewFilter === 'trash'
                    ? 'Trash is clean'
                    : q
                      ? 'No matching files found'
                      : 'Tap to upload or drop files anywhere'}
                </p>
                {viewFilter === 'active' && !q && (
                  <p className="text-xs text-ink-muted">
                    Routed automatically to your connected cloud pool & cached offline
                  </p>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="rounded-2xl border border-line bg-surface shadow-card divide-y divide-line overflow-hidden"
            >
              <AnimatePresence initial={false}>
                {visibleFiles.map((file, idx) => {
                  const { Icon, color, bg } = getFileVisual(
                    file.mimeType,
                    file.name
                  );
                  return (
                    <motion.div
                      layout
                      key={file.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: Math.min(idx * 0.025, 0.15),
                      }}
                      onClick={() => onOpenFile(file)}
                      className="group px-3.5 sm:px-5 py-3.5 hover:bg-elevated/65 active:bg-elevated/80 flex items-center justify-between gap-2.5 sm:gap-4 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: bg, color }}
                        >
                          <Icon className="w-[18px] h-[18px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-medium text-ink flex items-center gap-2 min-w-0">
                            <span className="truncate">{file.name}</span>
                            {file.pendingOfflineSync && (
                              <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#D97757]/15 text-[#F0A085]">
                                queued
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-ink-muted flex items-center gap-1.5 sm:gap-2 mt-0.5 min-w-0">
                            <span className="font-mono tabular-nums shrink-0">
                              {formatBytes(file.size)}
                            </span>
                            <span className="shrink-0">·</span>
                            <span className="text-ink-secondary truncate max-w-[135px] sm:max-w-[240px]">
                              {file.providerName}
                            </span>
                            <span className="hidden sm:inline shrink-0">·</span>
                            <span className="hidden sm:inline shrink-0">
                              {formatRelativeTime(file.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-0.5 sm:gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {viewFilter === 'trash' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onRestoreFile(file)}
                              className="p-2 rounded-xl text-ink-secondary hover:text-[#10A37F] hover:bg-canvas/50 active:bg-canvas/80 transition"
                              title="Restore"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onTrashOrDeleteFile(file, true)}
                              className="p-2 rounded-xl text-ink-secondary hover:text-red-400 hover:bg-canvas/50 active:bg-canvas/80 transition"
                              title="Delete permanently"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onDownloadFile(file)}
                              className="p-2 rounded-xl text-ink-muted hover:text-ink hover:bg-canvas/50 active:bg-canvas/80 transition"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onTrashOrDeleteFile(file, false)}
                              className="p-2 rounded-xl text-ink-muted hover:text-red-400 hover:bg-canvas/50 active:bg-canvas/80 transition"
                              title="Move to trash"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </div>

      {/* Responsive Bottom-Sheet / Dialog: New Carpeta Modal */}
      <AnimatePresence>
        {showFolderModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setShowFolderModal(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSubmitFolder}
              className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-surface border-t sm:border border-line-strong p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4 shadow-float max-h-[90dvh] overflow-y-auto"
            >
              <div className="w-10 h-1 rounded-full bg-line-strong mx-auto sm:hidden" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">New Carpeta</h3>
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="p-1.5 rounded-full text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                autoFocus
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Carpeta name..."
                className="w-full px-4 py-3 sm:py-2.5 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-sm text-ink transition-all"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-2.5 sm:py-2 rounded-full text-xs font-medium text-ink-secondary hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 sm:py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-glow transition"
                >
                  Create Carpeta
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Responsive Bottom-Sheet / Dialog: New Note Modal */}
      <AnimatePresence>
        {showNoteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setShowNoteModal(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSubmitNote}
              className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-surface border-t sm:border border-line-strong p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4 shadow-float max-h-[92dvh] overflow-y-auto"
            >
              <div className="w-10 h-1 rounded-full bg-line-strong mx-auto sm:hidden" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">New Note</h3>
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="p-1.5 rounded-full text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                autoFocus
                type="text"
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                placeholder="Title.md"
                className="w-full px-4 py-3 sm:py-2.5 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-sm text-ink transition-all"
              />
              <textarea
                rows={6}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write markdown, prompts, or JSON context for your local AI..."
                className="w-full p-4 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-sm font-mono text-ink resize-none transition-all"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="px-4 py-2.5 sm:py-2 rounded-full text-xs font-medium text-ink-secondary hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 sm:py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-glow transition"
                >
                  Save Note
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
