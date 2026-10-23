import React from 'react';
import { motion } from 'framer-motion';
import {
  FolderClosed,
  Cloud,
  KeyRound,
  Database,
  Smartphone,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LogIn,
} from 'lucide-react';
import type { AuthUser, VaultState } from '../types';
import { formatBytes } from '../lib/format';
import { STUDIO_THEMES, type StudioTheme } from '../lib/theme';

export type NavTab = 'files' | 'providers' | 'ai-keys' | 'database' | 'android';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onResetFolder: () => void;
  vault: VaultState;
  authUser: AuthUser | null;
  onLogout: () => void;
  onOpenAuthScreen: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: StudioTheme;
  onChangeTheme: (theme: StudioTheme) => void;
}

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: 'files', label: 'Files & Carpetas', icon: FolderClosed },
  { id: 'providers', label: 'Cloud Pool', icon: Cloud },
  { id: 'ai-keys', label: 'Local AI API', icon: KeyRound },
  { id: 'database', label: 'Database & Auth', icon: Database },
  { id: 'android', label: 'Android App', icon: Smartphone },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onResetFolder,
  vault,
  authUser,
  onLogout,
  onOpenAuthScreen,
  collapsed,
  onToggleCollapsed,
  theme,
  onChangeTheme,
}) => {
  const rawQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 260 }}
      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      className="hidden lg:flex flex-col shrink-0 bg-sidebar border-r border-line select-none overflow-hidden"
    >
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between gap-2">
        <button
          onClick={() => {
            onSelectTab('files');
            onResetFolder();
          }}
          className="flex items-center gap-3 min-w-0 group text-left"
        >
          <motion.div
            whileHover={{ scale: 1.05, rotate: -2 }}
            whileTap={{ scale: 0.96 }}
            className="w-9 h-9 rounded-xl bg-surface border border-line-strong flex items-center justify-center shrink-0 shadow-card"
          >
            <img
              src="/cloudy-logo.png"
              alt="Cloudy"
              className="w-6 h-6 object-contain"
            />
          </motion.div>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="min-w-0"
            >
              <div className="text-[15px] font-semibold tracking-tight text-ink leading-tight truncate">
                Cloudy
              </div>
              <div className="text-[11px] text-ink-muted truncate">
                X-Kilo · Storage OS
              </div>
            </motion.div>
          )}
        </button>

        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface/70 transition shrink-0"
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation with Shared-Element Gliding Pill */}
      <nav className="flex-1 px-3 py-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
                if (item.id === 'files') onResetFolder();
              }}
              title={collapsed ? item.label : undefined}
              className={`relative w-full flex items-center ${
                collapsed ? 'justify-center px-0' : 'px-3.5 gap-3'
              } py-2.5 rounded-xl text-[13.5px] font-medium transition-colors ${
                active
                  ? 'text-ink'
                  : 'text-ink-secondary hover:text-ink hover:bg-surface/40'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="sidebarActivePill"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-xl bg-surface border border-line-strong shadow-card"
                />
              )}
              <span className="relative z-10 flex items-center justify-center">
                <Icon
                  className={`w-[18px] h-[18px] transition-colors ${
                    active ? 'text-accent' : ''
                  }`}
                />
              </span>
              {!collapsed && (
                <span className="relative z-10 truncate">{item.label}</span>
              )}
              {!collapsed && item.id === 'providers' && (
                <span className="relative z-10 ml-auto text-[11px] font-mono px-2 py-0.5 rounded-full bg-accent-soft text-accent">
                  {vault.accounts.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Studio Palette Switcher (DeepSeek · Claude · ChatGPT · Qwen) */}
      <div className="px-3.5 py-3 border-t border-line">
        {!collapsed ? (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-muted">
              Theme
            </span>
            <div className="flex items-center gap-1.5">
              {STUDIO_THEMES.map((t) => {
                const isSelected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChangeTheme(t.id)}
                    title={`${t.label} palette`}
                    className={`relative w-5 h-5 rounded-full flex items-center justify-center transition-transform ${
                      isSelected ? 'scale-110' : 'opacity-65 hover:opacity-100 hover:scale-105'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full"
                      style={{ backgroundColor: t.swatch }}
                    />
                    {isSelected && (
                      <motion.span
                        layoutId="themeRing"
                        transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                        className="absolute inset-0 rounded-full border-2"
                        style={{ borderColor: t.swatch }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {STUDIO_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChangeTheme(t.id)}
                title={`${t.label} palette`}
                className={`w-3.5 h-3.5 rounded-full transition-transform ${
                  theme === t.id ? 'scale-125 ring-2 ring-white/50' : 'opacity-50 hover:opacity-100'
                }`}
                style={{ backgroundColor: t.swatch }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Storage Pool Capsule */}
      {!collapsed && (
        <div className="px-3.5 pb-2.5">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => onSelectTab('providers')}
            className="w-full p-3.5 rounded-2xl bg-surface/80 hover:bg-surface border border-line text-left space-y-2 shadow-card transition-colors"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-secondary font-medium">Pooled Space</span>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {rawQuota > 0 ? formatBytes(rawQuota, 0) : '0 GB'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${rawQuota > 0 ? Math.max(3, usedPct) : 0}%` }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-full bg-accent"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              <span>
                {rawQuota > 0 ? `${formatBytes(totalUsed)} used` : 'No cloud connected'}
              </span>
              <span className="text-accent font-medium">+ Add Cloud</span>
            </div>
          </motion.button>
        </div>
      )}

      {/* User Account Strip */}
      <div className="p-3 border-t border-line">
        {authUser ? (
          <div
            className={`flex items-center ${
              collapsed ? 'justify-center' : 'justify-between gap-2'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectTab('database')}
              title={`${authUser.displayName} (${authUser.email})`}
              className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-90 transition-opacity"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 shadow-card"
                style={{ backgroundColor: authUser.avatarColor || '#4D6BFE' }}
              >
                {(authUser.displayName || authUser.email).slice(0, 2).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink truncate">
                    {authUser.displayName}
                  </div>
                  <div className="text-[11px] text-ink-muted truncate">
                    {authUser.email}
                  </div>
                </div>
              )}
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                className="p-1.5 rounded-lg text-ink-muted hover:text-red-300 hover:bg-red-500/10 transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthScreen}
            title="Sign in or create account"
            className={`w-full py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-medium flex items-center ${
              collapsed ? 'justify-center' : 'justify-center gap-2'
            } transition-colors shadow-card`}
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>Sign In / Sign Up</span>}
          </button>
        )}
      </div>
    </motion.aside>
  );
};
