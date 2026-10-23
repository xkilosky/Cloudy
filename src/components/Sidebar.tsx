import React from 'react';
import {
  FolderClosed,
  Cloud,
  KeyRound,
  Smartphone,
} from 'lucide-react';
import type { VaultState } from '../types';
import { formatBytes } from '../lib/format';

export type NavTab = 'files' | 'providers' | 'ai-keys' | 'android';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onResetFolder: () => void;
  vault: VaultState;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onResetFolder,
  vault,
}) => {
  const totalQuota = Math.max(vault.summary.totalQuotaBytes || 1, 1);
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = Math.min(100, (totalUsed / totalQuota) * 100);

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'files', label: 'Files', icon: FolderClosed },
    { id: 'providers', label: 'Storage', icon: Cloud },
    { id: 'ai-keys', label: 'AI API', icon: KeyRound },
    { id: 'android', label: 'Android', icon: Smartphone },
  ];

  return (
    <aside className="hidden lg:flex lg:w-60 shrink-0 flex-col justify-between border-r border-white/[0.07] bg-black px-4 py-6 select-none">
      <div className="space-y-8">
        {/* Minimalist Brand */}
        <button
          onClick={() => {
            onSelectTab('files');
            onResetFolder();
          }}
          className="flex items-center gap-3 px-2 text-left group w-full"
        >
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-8 h-8 object-contain"
          />
          <div>
            <div className="text-sm font-bold tracking-wider text-white flex items-center gap-2">
              CLOUDY
              <span className="text-[10px] font-mono text-[#00F0FF]">X-KILO</span>
            </div>
          </div>
        </button>

        {/* Clean 4-Item Navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  if (item.id === 'files') onResetFolder();
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  active
                    ? 'bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/30'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Minimalist Storage Meter */}
      <button
        onClick={() => onSelectTab('providers')}
        className="w-full text-left rounded-2xl bg-[#07090C] hover:bg-[#0B0E13] border border-white/[0.07] hover:border-[#00F0FF]/30 p-4 transition space-y-2.5"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Storage Pool</span>
          <span className="font-mono text-[#00F0FF] font-semibold tabular-nums">
            {formatBytes(totalQuota, 0)}
          </span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full bg-[#00F0FF] rounded-full transition-all duration-300"
            style={{ width: `${Math.max(2, usedPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-500 tabular-nums">
          <span>{formatBytes(totalUsed)} used</span>
          <span>{vault.accounts.length} connected</span>
        </div>
      </button>
    </aside>
  );
};
