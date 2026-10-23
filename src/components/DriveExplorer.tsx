import React, { useState, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  Upload,
  FilePlus2,
  FileText,
  FileCode,
  FileImage,
  File as FileIcon,
  Trash2,
  RotateCcw,
  Download,
  ChevronRight,
  X,
} from 'lucide-react';
import type { VaultState, FolderItem, FileItem } from '../types';
import { formatBytes, formatRelativeTime } from '../lib/format';

interface DriveExplorerProps {
  vault: VaultState;
  currentFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  searchQuery: string;
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
  onTrashOrDeleteFile: (file: FileItem, permanent?: boolean) => void;
  onRestoreFile: (file: FileItem) => void;
  onTrashOrDeleteFolder: (folder: FolderItem, permanent?: boolean) => void;
}

function getFileIcon(file: FileItem) {
  const m = (file.mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return <FileImage className="w-4 h-4 text-[#00F0FF]" />;
  if (m.includes('json') || file.kind === 'dataset' || /\.(js|ts|py|sh|html|css)$/i.test(file.name)) {
    return <FileCode className="w-4 h-4 text-[#00F0FF]" />;
  }
  if (m.startsWith('text/') || file.kind === 'note' || m.includes('pdf')) {
    return <FileText className="w-4 h-4 text-[#00F0FF]" />;
  }
  return <FileIcon className="w-4 h-4 text-zinc-400" />;
}

export const DriveExplorer: React.FC<DriveExplorerProps> = ({
  vault,
  currentFolderId,
  onSelectFolder,
  searchQuery,
  onUploadFiles,
  onCreateFolder,
  onCreateNote,
  onOpenFile,
  onDownloadFile,
  onTrashOrDeleteFile,
  onRestoreFile,
  onTrashOrDeleteFolder,
}) => {
  const [filterView, setFilterView] = useState<'all' | 'offline' | 'trash'>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [noteFormat, setNoteFormat] = useState<'md' | 'txt' | 'json'>('md');
  const [noteContent, setNoteContent] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const breadcrumbs: FolderItem[] = [];
  if (filterView === 'all' && currentFolderId) {
    let curr = vault.folders.find((f) => f.id === currentFolderId) || null;
    const seen = new Set<string>();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      breadcrumbs.unshift(curr);
      curr = curr.parentId ? vault.folders.find((f) => f.id === curr!.parentId) || null : null;
    }
  }

  const q = searchQuery.trim().toLowerCase();

  const visibleFolders = vault.folders.filter((fld) => {
    if (filterView === 'trash') return fld.trashed;
    if (fld.trashed) return false;
    if (q) return fld.name.toLowerCase().includes(q);
    if (filterView === 'offline') return fld.offlinePinned !== false;
    return fld.parentId === currentFolderId;
  });

  const visibleFiles = vault.files.filter((fl) => {
    if (filterView === 'trash') return fl.trashed;
    if (fl.trashed) return false;
    if (q) {
      return (
        fl.name.toLowerCase().includes(q) ||
        (fl.textContent || '').toLowerCase().includes(q)
      );
    }
    if (filterView === 'offline') return fl.offlinePinned !== false;
    return fl.folderId === currentFolderId;
  });

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      setIsUploading(true);
      try {
        await onUploadFiles(e.dataTransfer.files, currentFolderId);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setIsUploading(true);
      try {
        await onUploadFiles(e.target.files, currentFolderId);
      } finally {
        setIsUploading(false);
        e.target.value = '';
      }
    }
  };

  const submitFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    await onCreateFolder(folderName.trim(), filterView === 'all' ? currentFolderId : null);
    setFolderName('');
    setShowFolderModal(false);
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteName.trim()) return;
    const ext = noteFormat === 'md' ? '.md' : noteFormat === 'json' ? '.json' : '.txt';
    const finalName = noteName.trim().includes('.') ? noteName.trim() : `${noteName.trim()}${ext}`;
    const mime =
      noteFormat === 'md'
        ? 'text/markdown'
        : noteFormat === 'json'
          ? 'application/json'
          : 'text/plain';
    await onCreateNote(
      finalName,
      noteContent,
      mime,
      noteFormat === 'json' ? 'dataset' : 'note',
      filterView === 'all' ? currentFolderId : null
    );
    setNoteName('');
    setNoteContent('');
    setShowNoteModal(false);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className="flex-1 px-5 sm:px-8 py-8"
    >
      <div className="max-w-6xl mx-auto space-y-8">
        {isDragging && (
          <div className="fixed inset-6 z-40 rounded-3xl border border-dashed border-[#00F0FF] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
            <Upload className="w-10 h-10 text-[#00F0FF] mb-3" />
            <p className="text-base font-semibold text-white">Drop files to upload</p>
          </div>
        )}

        {/* Single Minimalist Toolbar Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Segmented Filter */}
            <div className="inline-flex items-center bg-[#080A0E] border border-white/[0.08] rounded-xl p-1 text-xs">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'offline', label: 'Offline' },
                  { id: 'trash', label: 'Trash' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setFilterView(tab.id);
                    if (tab.id !== 'all') onSelectFolder(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    filterView === tab.id
                      ? 'bg-[#00F0FF] text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Clean Breadcrumb */}
            {filterView === 'all' && breadcrumbs.length > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <button
                  onClick={() => onSelectFolder(null)}
                  className="text-zinc-500 hover:text-white transition"
                >
                  Root
                </button>
                {breadcrumbs.map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                    <button
                      onClick={() => onSelectFolder(crumb.id)}
                      className="text-white font-medium hover:text-[#00F0FF] transition"
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Clean Action Buttons */}
          {filterView !== 'trash' && (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
              <button
                onClick={() => setShowFolderModal(true)}
                className="px-3.5 py-2 rounded-xl bg-[#080A0E] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#00F0FF]" />
                Folder
              </button>
              <button
                onClick={() => {
                  setNoteFormat('md');
                  setNoteContent('');
                  setShowNoteModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#080A0E] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-[#00F0FF]" />
                Note
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center gap-1.5 shadow-[0_0_20px_rgba(0,240,255,0.2)] transition"
              >
                <Upload className="w-3.5 h-3.5" />
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          )}
        </div>

        {/* Carpetas Grid */}
        {visibleFolders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
              Carpetas
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {visibleFolders.map((fld) => {
                const count =
                  vault.files.filter((f) => !f.trashed && f.folderId === fld.id).length +
                  vault.folders.filter((s) => !s.trashed && s.parentId === fld.id).length;

                return (
                  <div
                    key={fld.id}
                    onClick={() => {
                      if (filterView !== 'trash') {
                        setFilterView('all');
                        onSelectFolder(fld.id);
                      }
                    }}
                    className="group rounded-2xl bg-[#07090C] hover:bg-[#0C0F14] border border-white/[0.07] hover:border-[#00F0FF]/40 px-4 py-3.5 cursor-pointer transition flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Folder className="w-4 h-4 text-[#00F0FF] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{fld.name}</div>
                        <div className="text-[11px] text-zinc-500">{count} items</div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTrashOrDeleteFolder(fld, filterView === 'trash');
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-red-400 transition"
                      title="Delete folder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Files Table / Clean List */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
            Files
          </h2>

          {visibleFiles.length === 0 && visibleFolders.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-[#06070A] py-16 px-6 text-center space-y-3">
              <p className="text-sm text-zinc-400">
                {q ? 'No matching files found.' : 'No files here yet.'}
              </p>
              {filterView !== 'trash' && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-[#00F0FF] text-black text-xs font-bold transition"
                >
                  Upload Files
                </button>
              )}
            </div>
          ) : visibleFiles.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-[#06070A] divide-y divide-white/[0.05] overflow-hidden">
              {visibleFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => onOpenFile(file)}
                  className="group px-4 sm:px-5 py-3.5 hover:bg-white/[0.03] cursor-pointer transition flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {getFileIcon(file)}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate flex items-center gap-2">
                        <span className="truncate">{file.name}</span>
                        {file.offlinePinned !== false && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] shrink-0"
                            title="Synced Offline"
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                        <span className="text-zinc-400">{file.providerName}</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
                        <span className="hidden sm:inline">·</span>
                        <span className="hidden sm:inline">{formatRelativeTime(file.updatedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {filterView !== 'trash' ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDownloadFile(file);
                          }}
                          className="p-2 rounded-lg text-zinc-500 hover:text-[#00F0FF] transition"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrashOrDeleteFile(file, false);
                          }}
                          className="p-2 rounded-lg text-zinc-500 hover:text-red-400 transition"
                          title="Trash"
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
                          className="p-2 rounded-lg text-[#00F0FF] hover:bg-[#00F0FF]/10"
                          title="Restore"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrashOrDeleteFile(file, true);
                          }}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {/* Minimalist New Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={submitFolder}
            className="w-full max-w-sm rounded-2xl bg-[#080A0E] border border-white/10 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">New Carpeta</h3>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              required
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#00F0FF] text-black text-xs font-bold"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Minimalist New Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={submitNote}
            className="w-full max-w-lg rounded-2xl bg-[#080A0E] border border-white/10 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">New Note / AI File</h3>
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                autoFocus
                required
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                placeholder="Filename"
                className="flex-1 px-3.5 py-2 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-sm text-white"
              />
              <select
                value={noteFormat}
                onChange={(e) => setNoteFormat(e.target.value as 'md' | 'txt' | 'json')}
                className="px-3 py-2 rounded-xl bg-black border border-white/10 text-xs text-white"
              >
                <option value="md">.md</option>
                <option value="txt">.txt</option>
                <option value="json">.json</option>
              </select>
            </div>
            <textarea
              rows={7}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Write markdown, notes, or JSON context for your offline AI models..."
              className="w-full p-3.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#00F0FF] text-black text-xs font-bold"
              >
                Save File
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
