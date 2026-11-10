import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Wifi,
  WifiOff,
  RefreshCw,
  X,
  LogIn,
  LogOut,
  Palette,
  Cloud,
  Database,
  SlidersHorizontal,
} from 'lucide-react';
import type { AuthUser, VaultState } from '../types';
import type { NavTab } from './Sidebar';
import { STUDIO_THEMES, type StudioTheme } from '../lib/theme';
import { formatBytes } from '../lib/format';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onResetFolder: () => void;
  vault: VaultState;
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
  onLogout: () => void;
}

const TAB_TITLES: Record<NavTab, string> = {
  files: 'Files & Carpetas',
  providers: 'Cloud Pool',
  'ai-keys': 'AI & MCP Studio',
  database: 'Database & Auth',
  android: 'Android App',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onResetFolder,
  vault,
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
  onLogout,
}) => {
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);

  const rawQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth < 640) {
          setMobileSearchOpen(true);
          setTimeout(() => mobileInputRef.current?.focus(), 40);
        } else {
          desktopInputRef.current?.focus();
        }
      } else if (e.key === 'Escape') {
        setQuickMenuOpen(false);
        if (!searchQuery) setMobileSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchQuery]);

  // Close quick menu when tapping outside
  useEffect(() => {
    if (!quickMenuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setQuickMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [quickMenuOpen]);

  const handleSearchInput = (val: string) => {
    onSearchChange(val);
    if (val.trim() && activeTab !== 'files') {
      onSelectTab('files');
    }
  };

  const activeFilesCount = vault.files.filter((f) => !f.trashed).length;
  const activeFoldersCount = vault.folders.filter((f) => !f.trashed).length;

  const desktopSubtitle =
    activeTab === 'files'
      ? `${activeFoldersCount} carpeta${activeFoldersCount === 1 ? '' : 's'} · ${activeFilesCount} file${activeFilesCount === 1 ? '' : 's'}`
      : activeTab === 'providers'
        ? `${vault.accounts.length} cloud${vault.accounts.length === 1 ? '' : 's'} · ${rawQuota > 0 ? formatBytes(rawQuota, 0) : '0 GB'} pooled`
        : activeTab === 'ai-keys'
          ? `${vault.apiKeys.length} key${vault.apiKeys.length === 1 ? '' : 's'} · Streamable HTTP MCP`
          : activeTab === 'database'
            ? authUser
              ? authUser.email
              : 'Local Guest Vault'
            : 'Offline WebAPK & Capacitor';

  return (
    <header className="sticky top-0 z-30 pt-safe bg-canvas/96 sm:bg-canvas/85 sm:backdrop-blur-xl border-b border-line">
      <div className="max-w-6xl mx-auto relative h-14 sm:h-16 px-3.5 sm:px-6 lg:px-8 flex items-center justify-between gap-2.5 sm:gap-4">
        {/* Mobile Brand + Active View Label */}
        <button
          type="button"
          onClick={() => {
            onSelectTab('files');
            onResetFolder();
          }}
          className="flex items-center gap-2.5 lg:hidden min-w-0 text-left shrink"
        >
          <div className="w-8 h-8 rounded-xl bg-surface border border-line-strong flex items-center justify-center shrink-0 shadow-card">
            <img
              src="/cloudy-logo.png"
              alt="Cloudy"
              className="w-5 h-5 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-ink leading-tight truncate">
              Cloudy
            </div>
            <div className="text-[10.5px] text-ink-muted leading-tight truncate">
              {TAB_TITLES[activeTab]}
            </div>
          </div>
        </button>

        {/* Desktop Active Section Anchor */}
        <div className="hidden lg:flex items-center gap-3 min-w-0 shrink-0">
          <h2 className="text-[14.5px] font-semibold text-ink tracking-tight">
            {TAB_TITLES[activeTab]}
          </h2>
          <span className="h-3.5 w-px bg-line-strong" />
          <span className="text-xs text-ink-muted truncate max-w-[240px]">
            {desktopSubtitle}
          </span>
        </div>

        {/* Desktop / Tablet Pill Search Input */}
        <div className="hidden sm:block relative flex-1 max-w-sm lg:max-w-md lg:ml-auto group">
          <Search className="w-4 h-4 text-ink-muted group-focus-within:text-accent absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />
          <input
            ref={desktopInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search files, carpetas, notes..."
            className="w-full pl-10 pr-14 py-2 rounded-full bg-surface/90 hover:bg-surface focus:bg-surface border border-line focus:border-accent/60 focus:ring-4 focus:ring-accent-soft focus:outline-none text-[13px] text-ink placeholder:text-ink-muted transition-all"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-ink-muted hover:text-ink"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="hidden md:inline-flex items-center gap-0.5 absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-elevated/80 border border-line text-[10px] font-mono text-ink-muted pointer-events-none">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" ref={menuContainerRef}>
          {/* Mobile Expandable Search Trigger */}
          <button
            type="button"
            onClick={() => {
              setMobileSearchOpen(true);
              setQuickMenuOpen(false);
              setTimeout(() => mobileInputRef.current?.focus(), 40);
            }}
            aria-label="Search vault"
            className={`sm:hidden relative w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
              searchQuery
                ? 'bg-accent-soft border-accent/50 text-accent'
                : 'bg-surface border-line text-ink-secondary active:bg-elevated'
            }`}
          >
            <Search className="w-4 h-4" />
            {searchQuery && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" />
            )}
          </button>

          {/* Force Sync Button (Desktop + Tablet) */}
          {!isOffline && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={onForceSync}
              title="Live Auto-Sync active — click to sync immediately"
              className="hidden sm:flex w-9 h-9 rounded-full bg-surface border border-line hover:border-line-strong text-ink-secondary hover:text-ink items-center justify-center transition-colors shadow-card"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-accent' : ''}`}
              />
            </motion.button>
          )}

          {/* Live Online / Offline Status Pill */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={onToggleOffline}
            title="Toggle Online Auto-Sync / Offline Vault Mode"
            className={`h-9 px-2.5 sm:px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 sm:gap-2 transition-colors shadow-card ${
              isOffline
                ? 'bg-[#D97757]/15 border-[#D97757]/40 text-[#F0A085]'
                : 'bg-surface border-line-strong text-ink'
            }`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
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
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11.5px] sm:text-xs">
                  Offline{pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}
                </span>
              </>
            ) : (
              <>
                {isSyncing ? (
                  <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin shrink-0 sm:hidden" />
                ) : (
                  <Wifi className="w-3.5 h-3.5 text-[#10A37F] shrink-0" />
                )}
                <span className="text-[11.5px] sm:hidden">
                  {isSyncing ? 'Sync' : 'Live'}
                </span>
                <span className="hidden sm:inline">
                  {isSyncing ? 'Syncing...' : 'Auto-Sync Live'}
                </span>
              </>
            )}
          </motion.button>

          {/* Studio Settings & Account Popover Trigger */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => setQuickMenuOpen((v) => !v)}
            aria-label="Account & Studio Settings"
            className="relative w-9 h-9 rounded-full flex items-center justify-center border border-line-strong shadow-card shrink-0 transition-transform"
            style={
              authUser
                ? { backgroundColor: authUser.avatarColor || '#4D6BFE', color: '#fff' }
                : undefined
            }
          >
            {authUser ? (
              <span className="text-xs font-semibold tracking-tight">
                {(authUser.displayName || authUser.email).slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <span className="w-full h-full rounded-full bg-surface flex items-center justify-center text-ink-secondary hover:text-ink">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
            )}
          </motion.button>

          {/* Floating Glass Studio & Account Popover */}
          <AnimatePresence>
            {quickMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 440, damping: 32 }}
                className="absolute right-3 sm:right-8 top-[calc(100%+0.5rem)] w-[min(20rem,calc(100vw-1.5rem))] rounded-3xl bg-surface/98 backdrop-blur-2xl border border-line-strong shadow-float p-4 space-y-4 z-50"
              >
                {/* User / Guest Card */}
                {authUser ? (
                  <div className="flex items-center justify-between gap-2.5 pb-3 border-b border-line">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ backgroundColor: authUser.avatarColor || '#4D6BFE' }}
                      >
                        {(authUser.displayName || authUser.email)
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-ink truncate">
                          {authUser.displayName}
                        </div>
                        <div className="text-[11px] text-ink-muted truncate">
                          {authUser.email}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        onOpenAccountTab();
                      }}
                      className="shrink-0 px-2.5 py-1.5 rounded-xl bg-elevated hover:bg-canvas border border-line text-[11px] font-medium text-ink transition-colors"
                    >
                      Profile
                    </button>
                  </div>
                ) : (
                  <div className="pb-3 border-b border-line space-y-2">
                    <div className="text-xs font-medium text-ink">
                      Local Guest Vault
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        onOpenAuthScreen();
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-card transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Sign In / Create Account</span>
                    </button>
                  </div>
                )}

                {/* Pooled Storage Meter (Especially helpful on Mobile!) */}
                <button
                  type="button"
                  onClick={() => {
                    setQuickMenuOpen(false);
                    onSelectTab('providers');
                  }}
                  className="w-full p-3 rounded-2xl bg-canvas/85 hover:bg-canvas border border-line text-left space-y-2 transition-colors"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-secondary font-medium inline-flex items-center gap-1.5">
                      <Cloud className="w-3.5 h-3.5 text-accent" />
                      Pooled Storage ({vault.accounts.length})
                    </span>
                    <span className="font-mono font-semibold text-ink tabular-nums">
                      {rawQuota > 0 ? formatBytes(rawQuota, 1) : '0 GB'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{
                        width: `${rawQuota > 0 ? Math.max(4, usedPct) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-ink-muted">
                    <span>
                      {rawQuota > 0
                        ? `${formatBytes(totalUsed)} used`
                        : 'No cloud connected yet'}
                    </span>
                    <span className="text-accent font-medium">+ Add Cloud</span>
                  </div>
                </button>

                {/* Studio Theme Selector */}
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-ink-muted flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-accent" />
                    <span>Studio Palette</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STUDIO_THEMES.map((t) => {
                      const selected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onChangeTheme(t.id)}
                          className={`px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all ${
                            selected
                              ? 'bg-elevated border-accent/60 text-ink shadow-card'
                              : 'bg-canvas/70 border-line text-ink-secondary hover:text-ink'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: t.swatch }}
                          />
                          <span className="truncate">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Actions Footer */}
                <div className="pt-2 border-t border-line flex items-center justify-between gap-2">
                  {!isOffline ? (
                    <button
                      type="button"
                      onClick={() => {
                        onForceSync();
                        setQuickMenuOpen(false);
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          isSyncing ? 'animate-spin text-accent' : 'text-accent'
                        }`}
                      />
                      <span>Sync Now</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleOffline();
                        setQuickMenuOpen(false);
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      <span>Go Online</span>
                    </button>
                  )}

                  {authUser ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        onLogout();
                      }}
                      className="py-2 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-xs font-medium text-red-300 inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        onOpenAccountTab();
                      }}
                      className="py-2 px-3 rounded-xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink-secondary hover:text-ink inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>DB</span>
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Full-Width Mobile Expandable Search Overlay */}
        <AnimatePresence>
          {mobileSearchOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="sm:hidden absolute inset-0 px-3 bg-canvas/98 backdrop-blur-2xl flex items-center gap-2 z-40"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-accent absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={mobileInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="Search files, carpetas, notes..."
                  className="w-full pl-10 pr-9 py-2 rounded-full bg-surface border border-accent/60 focus:outline-none text-ink placeholder:text-ink-muted"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-ink-muted hover:text-ink"
                    aria-label="Clear search text"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMobileSearchOpen(false)}
                className="px-3 py-2 rounded-full text-xs font-semibold text-ink-secondary active:text-ink shrink-0"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
};
