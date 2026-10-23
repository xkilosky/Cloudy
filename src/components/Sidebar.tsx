import React from 'react';
import {
  HardDrive,
  WifiOff,
  Star,
  Cloud,
  KeyRound,
  Trash2,
  Folder,
  Smartphone,
  Plus,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { VaultState, FolderItem } from '../types';
import { formatBytes } from '../lib/format';

export type NavTab = 'drive' | 'offline' | 'starred' | 'providers' | 'ai-keys' | 'trash';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  currentFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  vault: VaultState;
  onOpenAndroidModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  currentFolderId,
  onSelectFolder,
  vault,
  onOpenAndroidModal,
}) => {
  const rootFolders = vault.folders.filter((f) => !f.trashed && f.parentId === null);
  const totalQuota = vault.summary.totalQuotaBytes || 1;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const offlineCount = vault.files.filter((f) => !f.trashed && f.offlinePinned !== false).length;

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }[] = [
    { id: 'drive', label: 'Files & Carpetas', icon: HardDrive },
    { id: 'offline', label: 'Offline Vault', icon: WifiOff, badge: String(offlineCount) },
    { id: 'starred', label: 'Starred', icon: Star },
    {
      id: 'providers',
      label: 'Free Storage Pool',
      icon: Cloud,
      badge: `${vault.accounts.length}`,
    },
    {
      id: 'ai-keys',
      label: 'Local AI API Keys',
      icon: KeyRound,
      badge: 'REST',
    },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ];

  return (
    <aside className="hidden lg:flex lg:w-72 xl:w-76 shrink-0 flex-col border-r border-slate-800/80 bg-[#070B14]/95 select-none">
      {/* Brand Header */}
      <div className="p-5 pb-4 border-b border-slate-800/70">
        <button
          onClick={() => {
            onSelectTab('drive');
            onSelectFolder(null);
          }}
          className="flex items-center gap-3.5 text-left group w-full"
        >
          <div className="relative w-11 h-11 rounded-2xl bg-[#0B1222] border border-sky-500/30 flex items-center justify-center shadow-lg shadow-sky-500/10 group-hover:border-sky-400/60 transition">
            <img
              src="/cloudy-logo.png"
              alt="Cloudy Logo"
              className="w-8 h-8 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-white">CLOUDY</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                X-Kilo
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Free Storage. One System. Your Rules.
            </p>
          </div>
        </button>
      </div>

      {/* Unified Multi-Provider Storage Meter */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-[#0C1323] border border-slate-800/90 p-3.5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold text-slate-200">Unified Free Pool</span>
            <span className="font-mono tabular-nums text-sky-400 font-semibold">
              {formatBytes(totalQuota, 0)}
            </span>
          </div>

          {/* Stacked Bar by Provider */}
          <div className="h-2.5 w-full rounded-full bg-slate-900 overflow-hidden flex gap-0.5 p-0.5 border border-slate-800">
            {vault.accounts.map((acc) => {
              const sharePct = Math.max(4, (acc.quotaBytes / totalQuota) * 100);
              return (
                <div
                  key={acc.id}
                  style={{ width: `${sharePct}%`, backgroundColor: acc.color }}
                  title={`${acc.accountLabel}: ${formatBytes(acc.usedBytes)} / ${formatBytes(acc.quotaBytes)}`}
                  className="h-full first:rounded-l-full last:rounded-r-full opacity-90 hover:opacity-100 transition"
                />
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
            <span>{formatBytes(totalUsed)} used</span>
            <span>{vault.accounts.length} {vault.accounts.length === 1 ? 'drive' : 'drives'}</span>
          </div>

          <button
            onClick={() => onSelectTab('providers')}
            className="mt-2.5 w-full py-1.5 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Claim More Free GB (128+ GB)
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          System Workspace
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
                if (item.id === 'drive') onSelectFolder(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                active
                  ? 'bg-gradient-to-r from-sky-500/20 to-blue-600/10 text-white border border-sky-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/45 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded-md ${
                    active
                      ? 'bg-sky-500/25 text-sky-200'
                      : 'bg-slate-800/90 text-slate-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Root Folders ("Carpetas") Quick Tree */}
        {rootFolders.length > 0 && (
          <div className="pt-4">
            <div className="px-2.5 pb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <span>Carpetas (Folders)</span>
              <span>{rootFolders.length}</span>
            </div>
            <div className="space-y-0.5">
              {rootFolders.map((fld: FolderItem) => {
                const isSelected = activeTab === 'drive' && currentFolderId === fld.id;
                return (
                  <button
                    key={fld.id}
                    onClick={() => {
                      onSelectTab('drive');
                      onSelectFolder(fld.id);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                      isSelected
                        ? 'bg-slate-800/90 text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Folder
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: fld.color || '#38B6FF' }}
                      />
                      <span className="truncate">{fld.name}</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Android Download CTA Card */}
      <div className="p-3.5 border-t border-slate-800/80">
        <button
          onClick={onOpenAndroidModal}
          className="w-full rounded-2xl p-3 bg-gradient-to-br from-[#0F1B33] to-[#091224] hover:from-[#132342] hover:to-[#0C1830] border border-sky-500/30 text-left transition group shadow-lg shadow-black/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  Download Android
                  <Sparkles className="w-3 h-3 text-sky-400" />
                </div>
                <div className="text-[11px] text-slate-400">Offline PWA + .APK</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 transition" />
          </div>
        </button>
      </div>
    </aside>
  );
};
