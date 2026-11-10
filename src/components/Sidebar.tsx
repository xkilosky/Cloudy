import React from 'react';
import { motion } from 'framer-motion';
import {
  FolderClosed,
  GitBranch,
  Cloud,
  Zap,
  Database,
  Smartphone,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LogIn,
  Plus,
} from 'lucide-react';
import type { AuthUser, VaultState } from '../types';
import { formatBytes } from '../lib/format';
import { STUDIO_THEMES, type StudioTheme } from '../lib/theme';

export type NavTab =
  | 'files'
  | 'repo'
  | 'providers'
  | 'ai-keys'
  | 'database'
  | 'android';

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

interface NavItemDef {
  id: NavTab;
  label: string;
  section: 'workspace' | 'system';
  icon: React.ElementType;
}

const NAV_ITEMS: NavItemDef[] = [
  {
    id: 'files',
    label: 'Files & Carpetas',
    section: 'workspace',
    icon: FolderClosed,
  },
  {
    id: 'repo',
    label: 'Repo',
    section: 'workspace',
    icon: GitBranch,
  },
  {
    id: 'providers',
    label: 'Cloud Pool',
    section: 'workspace',
    icon: Cloud,
  },
  {
    id: 'ai-keys',
    label: 'AI & MCP',
    section: 'system',
    icon: Zap,
  },
  {
    id: 'database',
    label: 'Database & Auth',
    section: 'system',
    icon: Database,
  },
  {
    id: 'android',
    label: 'Android App',
    section: 'system',
    icon: Smartphone,
  },
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
  const usedPct =
    rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;
  const activeFileCount = vault.files.filter((f) => !f.trashed).length;
  const activeReposCount = (vault.repos || []).length;
  const activeKeysCount = vault.apiKeys.filter((k) => k.active).length;

  const getBadgeForTab = (id: NavTab): string | null => {
    if (id === 'files' && activeFileCount > 0) return String(activeFileCount);
    if (id === 'repo' && activeReposCount > 0) return String(activeReposCount);
    if (id === 'providers') return String(vault.accounts.length);
    if (id === 'ai-keys' && activeKeysCount > 0) return String(activeKeysCount);
    return null;
  };

  const renderNavGroup = (
    title: string,
    items: NavItemDef[]
  ): React.ReactNode => (
    <div className="space-y-1">
      {!collapsed && (
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        const badge = getBadgeForTab(item.id);

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelectTab(item.id);
              if (item.id === 'files') onResetFolder();
            }}
            title={collapsed ? item.label : undefined}
            className={`relative w-full flex items-center ${
              collapsed ? 'justify-center px-0' : 'px-3 gap-2.5'
            } py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
              active
                ? 'text-ink'
                : 'text-ink-secondary hover:text-ink hover:bg-surface/50'
            }`}
          >
            {active && (
              <motion.div
                layoutId="sidebarActivePill"
                transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                className="absolute inset-0 rounded-xl bg-surface border border-line-strong shadow-card"
              />
            )}
            {active && !collapsed && (
              <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-accent z-10" />
            )}

            <span className="relative z-10 flex items-center justify-center shrink-0">
              <Icon
                className={`w-[17px] h-[17px] transition-colors ${
                  active ? 'text-accent' : ''
                }`}
              />
            </span>

            {!collapsed && (
              <span className="relative z-10 truncate">{item.label}</span>
            )}

            {!collapsed && badge !== null && (
              <span
                className={`relative z-10 ml-auto text-[10.5px] font-mono px-1.5 py-0.5 rounded-md tabular-nums ${
                  active
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'bg-elevated/80 text-ink-muted'
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 252 }}
      transition={{ type: 'spring', stiffness: 380, damping: 35 }}
      className="hidden lg:flex flex-col shrink-0 sticky top-0 h-[100dvh] bg-sidebar border-r border-line select-none overflow-hidden z-20"
    >
      {/* Brand Header */}
      <div className="h-16 px-3.5 flex items-center justify-between gap-2 border-b border-line/70 shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectTab('files');
            onResetFolder();
          }}
          className="flex items-center gap-2.5 min-w-0 group text-left"
        >
          <div className="w-9 h-9 rounded-xl bg-surface border border-line-strong flex items-center justify-center shrink-0 shadow-card group-hover:border-accent/50 transition-colors">
            <img
              src="/cloudy-logo.png"
              alt="Cloudy"
              className="w-5 h-5 object-contain"
            />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold tracking-tight text-ink leading-tight truncate flex items-center gap-1.5">
                <span>Cloudy</span>
                <span className="text-[9.5px] font-mono font-semibold px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                  OS
                </span>
              </div>
              <div className="text-[11px] text-ink-muted truncate">
                X-Kilo · Cloud &amp; AI Vault
              </div>
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface/80 transition shrink-0"
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 px-2.5 py-4 space-y-5 overflow-y-auto no-scrollbar">
        {renderNavGroup(
          'Workspace',
          NAV_ITEMS.filter((i) => i.section === 'workspace')
        )}
        {renderNavGroup(
          'AI & Infrastructure',
          NAV_ITEMS.filter((i) => i.section === 'system')
        )}
      </nav>

      {/* Bottom Dock: Storage Meter + Palette + User */}
      <div className="shrink-0 space-y-2.5 p-2.5 border-t border-line bg-sidebar">
        {!collapsed && (
          <button
            type="button"
            onClick={() => onSelectTab('providers')}
            className="w-full p-3 rounded-xl bg-surface/85 hover:bg-surface border border-line hover:border-line-strong text-left space-y-2 shadow-card transition-colors group"
          >
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-ink-secondary font-medium">
                Cloud Pool
              </span>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {rawQuota > 0 ? formatBytes(rawQuota, 0) : '0 GB'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
              <div
                style={{
                  width: `${rawQuota > 0 ? Math.max(4, usedPct) : 0}%`,
                }}
                className="h-full rounded-full bg-accent transition-all duration-500"
              />
            </div>
            <div className="flex items-center justify-between text-[10.5px] text-ink-muted">
              <span>
                {rawQuota > 0
                  ? `${formatBytes(totalUsed)} used`
                  : 'No cloud linked'}
              </span>
              <span className="text-accent font-medium inline-flex items-center gap-0.5 group-hover:underline">
                <Plus className="w-3 h-3" /> Add
              </span>
            </div>
          </button>
        )}

        {/* Compact Studio Palette Row */}
        <div
          className={`flex ${
            collapsed
              ? 'flex-col items-center gap-1.5 py-1'
              : 'items-center justify-between px-2 py-1'
          }`}
        >
          {!collapsed && (
            <span className="text-[11px] font-medium text-ink-muted">
              Palette
            </span>
          )}
          <div
            className={`flex ${
              collapsed ? 'flex-col gap-1.5' : 'items-center gap-1.5'
            }`}
          >
            {STUDIO_THEMES.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeTheme(t.id)}
                  title={`${t.label} palette`}
                  className={`relative w-5 h-5 rounded-full flex items-center justify-center transition-transform ${
                    isSelected
                      ? 'scale-110'
                      : 'opacity-60 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full"
                    style={{ backgroundColor: t.swatch }}
                  />
                  {isSelected && (
                    <span
                      className="absolute inset-0 rounded-full border-2"
                      style={{ borderColor: t.swatch }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* User Account Strip */}
        <div className="pt-2 border-t border-line/70">
          {authUser ? (
            <div
              className={`flex items-center ${
                collapsed ? 'justify-center' : 'justify-between gap-2 px-1'
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
                  style={{
                    backgroundColor: authUser.avatarColor || '#4D6BFE',
                  }}
                >
                  {(authUser.displayName || authUser.email)
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                {!collapsed && (
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink truncate">
                      {authUser.displayName}
                    </div>
                    <div className="text-[10.5px] text-ink-muted truncate">
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
              className={`w-full py-2 px-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold flex items-center ${
                collapsed ? 'justify-center' : 'justify-center gap-2'
              } shadow-card transition-colors`}
            >
              <LogIn className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Sign In / Sign Up</span>}
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );
};
