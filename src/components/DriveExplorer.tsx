import React, { useState, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  Upload,
  FilePlus2,
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  File as FileIcon,
  Star,
  Trash2,
  RotateCcw,
  Download,
  CheckCircle2,
  Clock,
  ChevronRight,
  LayoutGrid,
  List,
  HardDrive,
  WifiOff,
  Sparkles,
  X,
} from 'lucide-react';
import type { VaultState, FolderItem, FileItem } from '../types';
import { formatBytes, formatRelativeTime } from '../lib/format';
import type { NavTab } from './Sidebar';

interface DriveExplorerProps {
  mode: Extract<NavTab, 'drive' | 'offline' | 'starred' | 'trash'>;
  vault: VaultState;
  currentFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  searchQuery: string;
  isOffline: boolean;
  onUploadFiles: (files: FileList | File[], folderId: string | null, accountId: string) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null, color: string) => Promise<void>;
  onCreateNote: (
    name: string,
    content: string,
    mimeType: string,
    kind: 'note' | 'dataset',
    folderId: string | null,
    accountId: string,
    tags: string[]
  ) => Promise<void>;
  onOpenFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  onToggleStarFile: (file: FileItem) => void;
  onToggleOfflineFile: (file: FileItem) => void;
  onTrashOrDeleteFile: (file: FileItem, permanent?: boolean) => void;
  onRestoreFile: (file: FileItem) => void;
  onTrashOrDeleteFolder: (folder: FolderItem, permanent?: boolean) => void;
  onOpenProvidersTab: () => void;
}

const FOLDER_COLORS = ['#38B6FF', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];

function renderFileIcon(file: FileItem) {
  const m = (file.mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return <FileImage className="w-5 h-5 text-pink-400" />;
  if (m.includes('json') || file.kind === 'dataset' || /\.(js|ts|py|sh|html|css)$/i.test(file.name)) {
    return <FileCode className="w-5 h-5 text-amber-400" />;
  }
  if (m.includes('zip') || m.includes('tar') || m.includes('gzip')) {
    return <FileArchive className="w-5 h-5 text-purple-400" />;
  }
  if (m.startsWith('text/') || file.kind === 'note' || m.includes('pdf')) {
    return <FileText className="w-5 h-5 text-sky-400" />;
  }
  return <FileIcon className="w-5 h-5 text-slate-400" />;
}

export const DriveExplorer: React.FC<DriveExplorerProps> = ({
  mode,
  vault,
  currentFolderId,
  onSelectFolder,
  searchQuery,
  isOffline,
  onUploadFiles,
  onCreateFolder,
  onCreateNote,
  onOpenFile,
  onDownloadFile,
  onToggleStarFile,
  onToggleOfflineFile,
  onTrashOrDeleteFile,
  onRestoreFile,
  onTrashOrDeleteFolder,
  onOpenProvidersTab,
}) => {
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [targetAccountId, setTargetAccountId] = useState<string>('auto');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Modals
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [noteTemplate, setNoteTemplate] = useState<'md' | 'txt' | 'json'>('md');
  const [noteTags, setNoteTags] = useState('ai-ready, offline');
  const [noteContent, setNoteContent] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Build Breadcrumbs
  const breadcrumbs: FolderItem[] = [];
  if (mode === 'drive' && currentFolderId) {
    let curr = vault.folders.find((f) => f.id === currentFolderId) || null;
    const seen = new Set<string>();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      breadcrumbs.unshift(curr);
      curr = curr.parentId ? vault.folders.find((f) => f.id === curr!.parentId) || null : null;
    }
  }

  // Filter folders & files according to active mode, searchQuery, and providerFilter
  const q = searchQuery.trim().toLowerCase();

  const visibleFolders = vault.folders.filter((fld) => {
    if (mode === 'trash') return fld.trashed;
    if (fld.trashed) return false;
    if (q) return fld.name.toLowerCase().includes(q);
    if (mode === 'offline') return fld.offlinePinned !== false;
    if (mode === 'starred') return fld.starred;
    return fld.parentId === currentFolderId;
  });

  const visibleFiles = vault.files.filter((fl) => {
    if (mode === 'trash') return fl.trashed;
    if (fl.trashed) return false;
    if (providerFilter !== 'all' && fl.accountId !== providerFilter) return false;
    if (q) {
      return (
        fl.name.toLowerCase().includes(q) ||
        (fl.textContent || '').toLowerCase().includes(q) ||
        (fl.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (mode === 'offline') return fl.offlinePinned !== false;
    if (mode === 'starred') return fl.starred;
    return fl.folderId === currentFolderId;
  });

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setIsUploading(true);
      try {
        await onUploadFiles(e.dataTransfer.files, currentFolderId, targetAccountId);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsUploading(true);
      try {
        await onUploadFiles(e.target.files, currentFolderId, targetAccountId);
      } finally {
        setIsUploading(false);
        e.target.value = '';
      }
    }
  };

  const submitNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    await onCreateFolder(folderName.trim(), mode === 'drive' ? currentFolderId : null, folderColor);
    setFolderName('');
    setShowFolderModal(false);
  };

  const submitNewNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteName.trim()) return;
    const ext = noteTemplate === 'md' ? '.md' : noteTemplate === 'json' ? '.json' : '.txt';
    const finalName = noteName.trim().includes('.') ? noteName.trim() : `${noteName.trim()}${ext}`;
    const mime =
      noteTemplate === 'md'
        ? 'text/markdown'
        : noteTemplate === 'json'
          ? 'application/json'
          : 'text/plain';
    const tags = noteTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await onCreateNote(
      finalName,
      noteContent,
      mime,
      noteTemplate === 'json' ? 'dataset' : 'note',
      mode === 'drive' ? currentFolderId : null,
      targetAccountId,
      tags
    );
    setNoteName('');
    setNoteContent('');
    setShowNoteModal(false);
  };

  const getAccountColor = (accId: string) => {
    return vault.accounts.find((a) => a.id === accId)?.color || '#38B6FF';
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className="relative flex-1 p-4 sm:p-6 lg:p-7 space-y-6"
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-4 z-40 rounded-3xl border-2 border-dashed border-sky-400 bg-sky-950/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-12 h-12 text-sky-400 mb-3 animate-bounce" />
          <p className="text-lg font-bold text-white">Drop files anywhere to upload & cache offline</p>
          <p className="text-sm text-sky-300 mt-1">
            Auto-routed via Cloudy Smart Pool ({vault.settings.allocationRule.replace('_', ' ')})
          </p>
        </div>
      )}

      {/* Offline Banner when in Offline Vault Mode */}
      {isOffline && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-300 shrink-0">
              <WifiOff className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-amber-200">
                Air-Gapped Offline Mode Active — Reading from Local IndexedDB Vault
              </h3>
              <p className="text-xs text-amber-200/80">
                All carpetas, files, and notes you added online remain 100% accessible offline. Any new offline items will auto-sync once back online.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header + Actions Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {/* Breadcrumbs or Section Title */}
          {mode === 'drive' ? (
            <div className="flex items-center flex-wrap gap-1.5 text-sm font-semibold">
              <button
                onClick={() => onSelectFolder(null)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  currentFolderId === null
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                All Carpetas & Files
              </button>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                    <button
                      onClick={() => onSelectFolder(crumb.id)}
                      className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1.5 ${
                        isLast
                          ? 'bg-sky-500/15 text-white border border-sky-500/30'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5" style={{ color: crumb.color }} />
                      {crumb.name}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          ) : (
            <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
              {mode === 'offline' && (
                <>
                  <WifiOff className="w-5 h-5 text-sky-400" />
                  Offline Synced Vault
                </>
              )}
              {mode === 'starred' && (
                <>
                  <Star className="w-5 h-5 text-amber-400" />
                  Starred Carpetas & Files
                </>
              )}
              {mode === 'trash' && (
                <>
                  <Trash2 className="w-5 h-5 text-rose-400" />
                  Trash
                </>
              )}
            </h1>
          )}
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'offline'
              ? 'Files & carpetas cached locally in IndexedDB — accessible anytime without internet & readable by your local AI keys.'
              : mode === 'trash'
                ? 'Restore items or delete them permanently to free cloud provider quota.'
                : `Pooled across ${vault.accounts.length} connected drive${vault.accounts.length === 1 ? '' : 's'} · Auto-synced for offline access`}
          </p>
        </div>

        {/* Action Buttons */}
        {mode !== 'trash' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Target Provider Selector for Uploads */}
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              title="Choose which cloud provider receives new uploads"
              className="px-3 py-2 rounded-xl bg-[#0C1322] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500/50"
            >
              <option value="auto">
                ⚡ Auto Route ({vault.settings.allocationRule.replace('_', ' ')})
              </option>
              {vault.accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  ☁️ {acc.accountLabel} ({formatBytes(acc.quotaBytes - acc.usedBytes, 0)} free)
                </option>
              ))}
            </select>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-sky-500/20 transition"
            >
              <Upload className="w-3.5 h-3.5" />
              {isUploading ? 'Uploading...' : 'Upload Files'}
            </button>

            <button
              onClick={() => setShowFolderModal(true)}
              className="px-3 py-2 rounded-xl bg-[#0C1322] hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
              New Carpeta
            </button>

            <button
              onClick={() => {
                setNoteTemplate('md');
                setNoteContent('# New Cloudy Note\n\nAccessible online, offline, and via Local AI API keys.\n');
                setShowNoteModal(true);
              }}
              className="px-3 py-2 rounded-xl bg-[#0C1322] hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />
              New Note / AI Doc
            </button>
          </div>
        )}
      </div>

      {/* Provider Filter Pills + View Switcher */}
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setProviderFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0 ${
              providerFilter === 'all'
                ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30'
                : 'bg-[#0C1322] text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All Providers ({vault.accounts.length})
          </button>
          {vault.accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setProviderFilter(acc.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shrink-0 ${
                providerFilter === acc.id
                  ? 'bg-slate-800 text-white border border-slate-600'
                  : 'bg-[#0C1322] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: acc.color }}
              />
              {acc.accountLabel}
            </button>
          ))}
          {vault.accounts.length < 3 && (
            <button
              onClick={onOpenProvidersTab}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-400 hover:bg-sky-500/10 border border-dashed border-sky-500/30 flex items-center gap-1 shrink-0 transition"
            >
              <Sparkles className="w-3 h-3" />
              + Connect Free Drives
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-[#0C1322] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setViewLayout('grid')}
            className={`p-1.5 rounded-lg transition ${
              viewLayout === 'grid' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-white'
            }`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewLayout('list')}
            className={`p-1.5 rounded-lg transition ${
              viewLayout === 'list' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-white'
            }`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Carpetas (Folders) Section */}
      {visibleFolders.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Carpetas · Folders ({visibleFolders.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleFolders.map((fld) => {
              const itemCount =
                vault.files.filter((f) => !f.trashed && f.folderId === fld.id).length +
                vault.folders.filter((sub) => !sub.trashed && sub.parentId === fld.id).length;

              return (
                <div
                  key={fld.id}
                  onClick={() => {
                    if (mode !== 'trash') {
                      onSelectFolder(fld.id);
                    }
                  }}
                  className="group relative rounded-2xl bg-[#0B1220] hover:bg-[#101A2E] border border-slate-800/90 hover:border-sky-500/40 p-4 cursor-pointer transition flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${fld.color || '#38B6FF'}1F` }}
                    >
                      <Folder className="w-5 h-5" style={{ color: fld.color || '#38B6FF' }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{fld.name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span>{itemCount} items</span>
                        <span>·</span>
                        <span className="text-emerald-400 flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" />
                          Offline
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrashOrDeleteFolder(fld, mode === 'trash');
                    }}
                    title={mode === 'trash' ? 'Delete permanently' : 'Move folder to trash'}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Files & Notes Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Files, Notes & AI Datasets ({visibleFiles.length})
          </h2>
        </div>

        {visibleFiles.length === 0 && visibleFolders.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-[#090F1C]/60 p-12 text-center">
            <HardDrive className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-200">
              {q ? 'No matching files or carpetas found' : 'This carpeta is empty'}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
              Upload files, create nested carpetas, or write Markdown/JSON notes. Everything you add online is automatically cached in your local Offline Vault and accessible via your AI API keys.
            </p>
            {mode !== 'trash' && (
              <div className="flex items-center justify-center gap-2.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition"
                >
                  Upload Files
                </button>
                <button
                  onClick={() => setShowFolderModal(true)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
                >
                  Create Carpeta
                </button>
              </div>
            )}
          </div>
        ) : viewLayout === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {visibleFiles.map((file) => {
              const accColor = getAccountColor(file.accountId);
              return (
                <div
                  key={file.id}
                  onClick={() => onOpenFile(file)}
                  className="group rounded-2xl bg-[#0B1220] hover:bg-[#101A2E] border border-slate-800/90 hover:border-sky-500/40 p-4 cursor-pointer transition flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-center shrink-0">
                        {renderFileIcon(file)}
                      </div>
                      <div className="flex items-center gap-1">
                        {mode !== 'trash' ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleStarFile(file);
                              }}
                              className={`p-1.5 rounded-lg transition ${
                                file.starred
                                  ? 'text-amber-400'
                                  : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-amber-300'
                              }`}
                              title="Star file"
                            >
                              <Star className={`w-4 h-4 ${file.starred ? 'fill-amber-400' : ''}`} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDownloadFile(file);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-sky-400 transition"
                              title="Download file (works offline)"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTrashOrDeleteFile(file, false);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-400 transition"
                              title="Move to trash"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRestoreFile(file);
                              }}
                              className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10"
                              title="Restore file"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTrashOrDeleteFile(file, true);
                              }}
                              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                              title="Delete permanently"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <h3 className="mt-3 text-sm font-semibold text-white truncate" title={file.name}>
                      {file.name}
                    </h3>

                    {file.textContent && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {file.textContent.slice(0, 120)}
                      </p>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-800/70 flex items-center justify-between gap-2 text-[11px]">
                    {/* Provider Pill */}
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-medium truncate max-w-[140px]"
                      style={{
                        backgroundColor: `${accColor}1A`,
                        color: accColor,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: accColor }}
                      />
                      <span className="truncate">{file.providerName}</span>
                    </span>

                    <div className="flex items-center gap-2 text-slate-400 shrink-0 tabular-nums">
                      <span>{formatBytes(file.size)}</span>
                      {file.pendingOfflineSync ? (
                        <span title="Created offline — queued for cloud sync">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                        </span>
                      ) : file.offlinePinned !== false ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleOfflineFile(file);
                          }}
                          title="Available Offline (IndexedDB Cached)"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="rounded-2xl border border-slate-800/90 bg-[#0B1220] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Provider</th>
                  <th className="py-3 px-4 hidden md:table-cell">Offline</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Size</th>
                  <th className="py-3 px-4 hidden lg:table-cell">Updated</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {visibleFiles.map((file) => {
                  const accColor = getAccountColor(file.accountId);
                  return (
                    <tr
                      key={file.id}
                      onClick={() => onOpenFile(file)}
                      className="hover:bg-slate-800/35 cursor-pointer transition"
                    >
                      <td className="py-3 px-4 font-medium text-white">
                        <div className="flex items-center gap-2.5">
                          {renderFileIcon(file)}
                          <span className="truncate max-w-[220px] sm:max-w-xs">{file.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
                          style={{ backgroundColor: `${accColor}1A`, color: accColor }}
                        >
                          {file.providerName}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs">
                        {file.offlinePinned !== false ? (
                          <span className="text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Synced Offline
                          </span>
                        ) : (
                          <span className="text-slate-500">Online only</span>
                        )}
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell text-xs text-slate-400 font-mono tabular-nums">
                        {formatBytes(file.size)}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell text-xs text-slate-400">
                        {formatRelativeTime(file.updatedAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDownloadFile(file);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onTrashOrDeleteFile(file, mode === 'trash');
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* New Carpeta Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={submitNewFolder}
            className="w-full max-w-md rounded-2xl bg-[#0C1322] border border-slate-800 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-sky-400" />
                Create New Carpeta (Folder)
              </h3>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Carpeta Name
              </label>
              <input
                type="text"
                autoFocus
                required
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="e.g. Offline Research Papers"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Folder Accent Color
              </label>
              <div className="flex items-center gap-2.5">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFolderColor(c)}
                    className={`w-7 h-7 rounded-full transition ${
                      folderColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0C1322]' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold"
              >
                Create Carpeta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Note / AI Dataset Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={submitNewNote}
            className="w-full max-w-xl rounded-2xl bg-[#0C1322] border border-slate-800 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FilePlus2 className="w-5 h-5 text-emerald-400" />
                Create Online/Offline Note or AI Context File
              </h3>
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">File Name</label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={noteName}
                  onChange={(e) => setNoteName(e.target.value)}
                  placeholder="Project-Notes"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Format</label>
                <select
                  value={noteTemplate}
                  onChange={(e) => {
                    const fmt = e.target.value as 'md' | 'txt' | 'json';
                    setNoteTemplate(fmt);
                    if (fmt === 'json') {
                      setNoteContent('{\n  "topic": "Local AI Context",\n  "notes": []\n}');
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#060A14] border border-slate-800 text-sm text-white"
                >
                  <option value="md">Markdown (.md)</option>
                  <option value="txt">Plain Text (.txt)</option>
                  <option value="json">AI Dataset (.json)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Content (Indexed for Offline & Local AI Models)
              </label>
              <textarea
                rows={7}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full p-3.5 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-xs font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={noteTags}
                onChange={(e) => setNoteTags(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-[#060A14] border border-slate-800 text-xs text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold"
              >
                Save & Cache Offline
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
