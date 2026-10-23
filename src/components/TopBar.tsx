import React from 'react';
import {
  Search,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOffline: boolean;
  simulatedOffline: boolean;
  onToggleSimulatedOffline: () => void;
  pendingSyncCount: number;
  onSyncNow: () => void;
  isSyncing: boolean;
  onOpenAndroidModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onSearchChange,
  isOffline,
  simulatedOffline,
  onToggleSimulatedOffline,
  pendingSyncCount,
  onSyncNow,
  isSyncing,
  onOpenAndroidModal,
}) => {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#060A14]/90 backdrop-blur-xl px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Mobile Brand Mark */}
        <div className="flex lg:hidden items-center gap-2.5 shrink-0">
          <img src="/cloudy-logo.png" alt="Cloudy" className="w-8 h-8 object-contain" />
          <div>
            <div className="text-sm font-bold text-white leading-none">CLOUDY</div>
            <div className="text-[10px] text-sky-400 font-medium">X-Kilo</div>
          </div>
        </div>

        {/* Global Search */}
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files, carpetas (folders), tags, or offline AI notes..."
            className="w-full pl-10 pr-9 py-2 rounded-xl bg-[#0C1322] border border-slate-800 focus:border-sky-500/60 focus:outline-none text-sm text-slate-100 placeholder:text-slate-500 transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Controls: Online/Offline Switch + Sync + Android */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Online / Offline Mode Pill & Interactive Test Switch */}
          <button
            onClick={onToggleSimulatedOffline}
            title={
              isOffline
                ? 'Currently browsing local IndexedDB Offline Vault. Click to reconnect Online & sync.'
                : 'Online & Synced. Click to test Air-Gapped Offline Mode!'
            }
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              isOffline
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            {isOffline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">
                  Offline Vault {simulatedOffline ? '(Test)' : ''}
                </span>
                {pendingSyncCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-100 font-mono text-[10px]">
                    {pendingSyncCount} queued
                  </span>
                )}
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Online · Offline Ready</span>
              </>
            )}
          </button>

          {/* Sync button */}
          <button
            onClick={onSyncNow}
            disabled={isSyncing || isOffline}
            title="Sync online & offline vaults now"
            className="p-2 rounded-xl bg-[#0C1322] border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 disabled:opacity-40 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          {/* Android Install Button */}
          <button
            onClick={onOpenAndroidModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Android App</span>
          </button>
        </div>
      </div>
    </header>
  );
};
