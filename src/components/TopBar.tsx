import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Wifi, WifiOff, RefreshCw, X, LogIn } from 'lucide-react';
import type { AuthUser } from '../types';
import { STUDIO_THEMES, type StudioTheme } from '../lib/theme';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOffline: boolean;
  isSyncing: boolean;
  onToggleOffline: () => void;
  onForceSync: () => void;
  pendingSyncCount: number;
  theme: StudioTheme;
  onChangeTheme: (theme: StudioTheme) => void;
  authUser: AuthUser | null;
  onOpenAccountTab: () => void;
  onOpenAuthScreen: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onSearchChange,
  isOffline,
  isSyncing,
  onToggleOffline,
  onForceSync,
  pendingSyncCount,
  theme,
  onChangeTheme,
  authUser,
  onOpenAccountTab,
  onOpenAuthScreen,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-20 h-16 px-4 sm:px-8 bg-canvas/80 backdrop-blur-xl border-b border-line flex items-center justify-between gap-3">
      {/* Mobile Brand */}
      <div className="flex items-center gap-2.5 lg:hidden shrink-0">
        <div className="w-8 h-8 rounded-xl bg-surface border border-line-strong flex items-center justify-center">
          <img
            src="/cloudy-logo.png"
            alt="Cloudy"
            className="w-5 h-5 object-contain"
          />
        </div>
        <span className="text-sm font-semibold text-ink">Cloudy</span>
      </div>

      {/* ChatGPT / Claude-Style Pill Search Input */}
      <div className="relative flex-1 max-w-md group">
        <Search className="w-4 h-4 text-ink-muted group-focus-within:text-accent absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files, carpetas, notes..."
          className="w-full pl-10 pr-14 py-2 rounded-full bg-surface/85 hover:bg-surface focus:bg-surface border border-line focus:border-accent/60 focus:ring-4 focus:ring-accent-soft focus:outline-none text-[13px] text-ink placeholder:text-ink-muted transition-all"
        />
        {searchQuery ? (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-ink-muted hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center gap-0.5 absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-elevated/80 border border-line text-[10px] font-mono text-ink-muted pointer-events-none">
            ⌘K
          </kbd>
        )}
      </div>

      {/* Right Controls: Mobile Theme Dots + Live Auto-Sync + Account Avatar */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex lg:hidden items-center gap-1 bg-surface border border-line rounded-full px-2 py-1">
          {STUDIO_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeTheme(t.id)}
              className={`w-3.5 h-3.5 rounded-full transition-transform ${
                theme === t.id ? 'scale-125 ring-1 ring-white/70' : 'opacity-55'
              }`}
              style={{ backgroundColor: t.swatch }}
              aria-label={t.label}
            />
          ))}
        </div>

        {!isOffline && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            onClick={onForceSync}
            title="Live Auto-Sync active — click to sync immediately"
            className="p-2 rounded-full bg-surface border border-line hover:border-line-strong text-ink-secondary hover:text-ink transition-colors shadow-card"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-accent' : ''}`}
            />
          </motion.button>
        )}

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onToggleOffline}
          title="Toggle Online Auto-Sync / Offline Vault Mode"
          className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-2 transition-colors shadow-card ${
            isOffline
              ? 'bg-[#D97757]/15 border-[#D97757]/40 text-[#F0A085]'
              : 'bg-surface border-line-strong text-ink'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {!isOffline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10A37F] opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isOffline ? 'bg-[#D97757]' : 'bg-[#10A37F]'
              }`}
            />
          </span>
          {isOffline ? (
            <>
              <WifiOff className="w-3.5 h-3.5" />
              <span>
                Offline{pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}
              </span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-[#10A37F]" />
              <span className="hidden sm:inline">
                {isSyncing ? 'Syncing...' : 'Auto-Sync Live'}
              </span>
            </>
          )}
        </motion.button>

        {authUser ? (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onOpenAccountTab}
            title={`${authUser.displayName} (${authUser.email}) — Database & Account`}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold border border-white/15 shadow-card shrink-0"
            style={{ backgroundColor: authUser.avatarColor || '#4D6BFE' }}
          >
            {(authUser.displayName || authUser.email).slice(0, 2).toUpperCase()}
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={onOpenAuthScreen}
            className="px-3 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-medium flex items-center gap-1.5 shadow-card transition-colors"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign In</span>
          </motion.button>
        )}
      </div>
    </header>
  );
};
