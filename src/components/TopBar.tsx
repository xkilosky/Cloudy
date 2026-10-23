import React from 'react';
import { Search, Wifi, WifiOff, X } from 'lucide-react';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOffline: boolean;
  onToggleOffline: () => void;
  pendingSyncCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onSearchChange,
  isOffline,
  onToggleOffline,
  pendingSyncCount,
}) => {
  return (
    <header className="sticky top-0 z-20 bg-black/85 backdrop-blur-xl border-b border-white/[0.07] px-5 sm:px-8 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        {/* Mobile Brand */}
        <div className="flex lg:hidden items-center gap-2.5 shrink-0">
          <img src="/cloudy-logo.png" alt="Cloudy" className="w-7 h-7 object-contain" />
          <span className="text-sm font-bold tracking-wider text-white">CLOUDY</span>
        </div>

        {/* Clean Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files & carpetas..."
            className="w-full pl-10 pr-8 py-2 rounded-xl bg-[#080A0E] border border-white/[0.08] focus:border-[#00F0FF] focus:outline-none text-sm text-white placeholder:text-zinc-600 transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Clean Online / Offline Pill */}
        <button
          onClick={onToggleOffline}
          title={
            isOffline
              ? 'Offline Mode — reading local IndexedDB vault. Click to go Online.'
              : 'Online & Synced. Click to test Offline Mode.'
          }
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition shrink-0 ${
            isOffline
              ? 'bg-[#00F0FF]/10 border-[#00F0FF]/40 text-[#00F0FF]'
              : 'bg-[#080A0E] border-white/[0.08] text-zinc-300 hover:border-white/20'
          }`}
        >
          {isOffline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>Offline Vault</span>
              {pendingSyncCount > 0 && (
                <span className="font-mono text-[10px] opacity-80">
                  ({pendingSyncCount})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
              <Wifi className="w-3.5 h-3.5 text-zinc-400 hidden sm:inline" />
              <span>Online</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
