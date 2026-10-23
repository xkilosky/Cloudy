import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  RefreshCw,
  Download,
  ShieldCheck,
  Search,
  User,
  Lock,
  LogOut,
  Trash2,
  CheckCircle2,
  Server,
  HardDrive,
  LogIn,
  Loader2,
} from 'lucide-react';
import type { AuthUser, DatabaseOverview, VaultState } from '../types';
import { apiFetch, updateCachedAuthUser } from '../lib/vaultClient';
import { formatBytes } from '../lib/format';

interface DatabaseViewProps {
  vault: VaultState;
  authUser: AuthUser | null;
  isOffline: boolean;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
  onOpenAuthScreen: () => void;
  onShowToast: (msg: string) => void;
}

const AVATAR_SWATCHES = [
  '#4D6BFE',
  '#D97757',
  '#10A37F',
  '#7C5CFC',
  '#0EA5E9',
  '#F59E0B',
];

function buildOfflineFallbackOverview(
  vault: VaultState,
  authUser: AuthUser | null
): DatabaseOverview {
  const vid = vault.vaultId || authUser?.vaultId || 'local';
  const tables = [
    {
      name: 'cloudy_users',
      label: 'Users',
      description: 'Cached user profile stored in Offline Vault',
      rowCount: authUser ? 1 : 0,
      rows: authUser
        ? [
            {
              id: authUser.id,
              email: authUser.email,
              display_name: authUser.displayName,
              password_hash: '[scrypt-256 · salted]',
              vault_id: authUser.vaultId,
              theme: authUser.theme,
              created_at: authUser.createdAt,
            },
          ]
        : [],
    },
    {
      name: 'cloudy_sessions',
      label: 'Active Sessions',
      description: 'Cached offline device session',
      rowCount: authUser ? 1 : 0,
      rows: authUser
        ? [
            {
              id: 'ses_offline_cached',
              user_id: authUser.id,
              device_label: 'Offline Cached Session',
              is_current: true,
              token_hash: '[sha256 · cached]',
            },
          ]
        : [],
    },
    {
      name: 'cloudy_storage_accounts',
      label: 'Cloud Accounts',
      description: 'Verified upstream cloud providers cached in IndexedDB',
      rowCount: vault.accounts.length,
      rows: vault.accounts.map((a) => ({
        id: a.id,
        vault_id: vid,
        provider_id: a.providerId,
        account_label: a.accountLabel,
        email: a.email,
        quota_bytes: a.quotaBytes,
        used_bytes: a.usedBytes,
        sealed_credentials: '[AES-256-GCM sealed]',
        status: a.status,
      })),
    },
    {
      name: 'cloudy_folders',
      label: 'Carpetas (Folders)',
      description: 'Hierarchical folder tree mirrored in IndexedDB',
      rowCount: vault.folders.length,
      rows: vault.folders.map((f) => ({
        id: f.id,
        vault_id: vid,
        name: f.name,
        parent_id: f.parentId,
        offline_pinned: f.offlinePinned,
        trashed: f.trashed,
        updated_at: f.updatedAt,
      })),
    },
    {
      name: 'cloudy_files',
      label: 'Files & Notes',
      description: 'Pooled cloud files & Markdown notes mirrored in IndexedDB',
      rowCount: vault.files.length,
      rows: vault.files.map((f) => ({
        id: f.id,
        vault_id: vid,
        name: f.name,
        folder_id: f.folderId,
        kind: f.kind,
        size_bytes: f.size,
        provider_name: f.providerName,
        offline_pinned: f.offlinePinned,
        trashed: f.trashed,
      })),
    },
    {
      name: 'cloudy_ai_keys',
      label: 'Scoped AI Keys',
      description: 'Scoped Local AI & MCP API keys',
      rowCount: vault.apiKeys.length,
      rows: vault.apiKeys.map((k) => ({
        id: k.id,
        vault_id: vid,
        name: k.name,
        key_prefix: k.keyPrefix,
        scope: k.scope,
        usage_count: k.usageCount,
        active: k.active,
      })),
    },
  ];
  return {
    ok: true,
    engine: 'local_relational_mirror',
    engineLabel: 'IndexedDB Offline Mirror (cloudy_offline_vault)',
    postgresConnected: false,
    rlsEnabled: true,
    latencyMs: 1,
    vaultId: vid,
    totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
    syncedAt: new Date().toISOString(),
    tables,
  };
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({
  vault,
  authUser,
  isOffline,
  onUserUpdated,
  onLogout,
  onOpenAuthScreen,
  onShowToast,
}) => {
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>('cloudy_files');
  const [tableFilter, setTableFilter] = useState('');

  // Profile form state
  const [displayName, setDisplayName] = useState(authUser?.displayName || '');
  const [avatarColor, setAvatarColor] = useState(authUser?.avatarColor || '#4D6BFE');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (authUser) {
      setDisplayName(authUser.displayName);
      setAvatarColor(authUser.avatarColor || '#4D6BFE');
    }
  }, [authUser]);

  const loadOverview = useCallback(async () => {
    if (isOffline) {
      setOverview(buildOfflineFallbackOverview(vault, authUser));
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await apiFetch('/api/database/overview');
      if (!res.ok) throw new Error('Failed to load database overview');
      const data = (await res.json()) as DatabaseOverview;
      setOverview(data);
    } catch {
      setOverview(buildOfflineFallbackOverview(vault, authUser));
    } finally {
      setLoading(false);
    }
  }, [isOffline, vault, authUser]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleSyncDatabase = async () => {
    if (isOffline) {
      onShowToast('Currently offline — changes will sync to PostgreSQL when online');
      return;
    }
    setSyncing(true);
    try {
      const res = await apiFetch('/api/database/sync', { method: 'POST' });
      const data = (await res.json()) as DatabaseOverview;
      if (res.ok && data?.ok) {
        setOverview(data);
        onShowToast('Synced all relational tables with PostgreSQL');
      }
    } catch {
      onShowToast('Database sync failed — check connection');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      project: 'Cloudy by X-Kilo',
      user: authUser,
      databaseOverview: overview,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cloudy-database-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Exported database backup JSON');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || isOffline) return;
    setSavingProfile(true);
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          avatarColor,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Could not update profile');
      }
      const nextUser = data.user as AuthUser;
      updateCachedAuthUser(nextUser);
      onUserUpdated(nextUser);
      loadOverview();
      onShowToast('Profile saved to database');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Profile update failed');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || isOffline) return;
    setSavingPassword(true);
    try {
      const res = await apiFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Password update failed');
      }
      setCurrentPassword('');
      setNewPassword('');
      onShowToast('Password updated securely');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Password update failed');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await apiFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onShowToast('Revoked device session');
        loadOverview();
      }
    } catch {
      onShowToast('Could not revoke session');
    }
  };

  const activeTable = useMemo(() => {
    if (!overview?.tables?.length) return null;
    return (
      overview.tables.find((t) => t.name === selectedTable) || overview.tables[0]
    );
  }, [overview, selectedTable]);

  const filteredRows = useMemo(() => {
    if (!activeTable) return [];
    const q = tableFilter.trim().toLowerCase();
    if (!q) return activeTable.rows;
    return activeTable.rows.filter((row) =>
      Object.values(row).some((val) =>
        String(val ?? '')
          .toLowerCase()
          .includes(q)
      )
    );
  }, [activeTable, tableFilter]);

  const tableColumns = useMemo(() => {
    if (!activeTable || activeTable.rows.length === 0) return [];
    return Object.keys(activeTable.rows[0]);
  }, [activeTable]);

  const formatCellValue = (col: string, val: unknown): React.ReactNode => {
    if (val === null || val === undefined || val === '') {
      return <span className="text-ink-muted">—</span>;
    }
    if (typeof val === 'boolean') {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
            val
              ? 'bg-[#10A37F]/15 text-[#6EE7B7] border border-[#10A37F]/30'
              : 'bg-canvas text-ink-muted border border-line'
          }`}
        >
          {val ? 'true' : 'false'}
        </span>
      );
    }
    if (col.endsWith('_bytes') && typeof val === 'number') {
      return (
        <span className="font-mono text-ink">
          {formatBytes(val)} <span className="text-ink-muted">({val})</span>
        </span>
      );
    }
    const str = String(val);
    if (str.startsWith('[') && str.endsWith(']')) {
      return (
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-accent-soft text-accent">
          {str}
        </span>
      );
    }
    return <span className="font-mono text-[12px] text-ink">{str}</span>;
  };

  return (
    <div className="flex-1 px-4 sm:px-8 py-7">
      <div className="max-w-5xl mx-auto space-y-6 pb-20">
        {/* Guest Upgrade Callout */}
      {!authUser && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-3xl bg-surface border border-accent/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-card"
        >
          <div className="space-y-1">
            <div className="text-sm font-semibold text-ink flex items-center gap-2">
              <Database className="w-4 h-4 text-accent" />
              <span>Running in Local Guest Vault Mode</span>
            </div>
            <p className="text-[12.5px] text-ink-secondary">
              Sign in or create a Cloudy account to bind your connected storage providers,
              carpetas, files, and AI keys to your PostgreSQL account across web and Android.
            </p>
          </div>
          <button
            onClick={onOpenAuthScreen}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In / Create Account</span>
          </button>
        </motion.div>
      )}

      {/* Header & Engine Status */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-card space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-accent-soft border border-accent/30 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-semibold text-ink tracking-tight">
                  Cloudy Database & Account
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                    overview?.postgresConnected
                      ? 'bg-[#10A37F]/15 border-[#10A37F]/35 text-[#6EE7B7]'
                      : 'bg-accent-soft border-accent/30 text-accent'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      overview?.postgresConnected ? 'bg-[#10A37F]' : 'bg-accent'
                    }`}
                  />
                  {overview?.engineLabel || 'Connecting...'}
                </span>
              </div>
              <p className="text-[13px] text-ink-secondary mt-1">
                Normalized relational schema syncing users, sessions, verified cloud accounts,
                carpetas, files, and scoped AI keys with offline IndexedDB mirroring.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleSyncDatabase}
              disabled={syncing || isOffline}
              className="px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium flex items-center gap-2 transition-colors shadow-card"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Database'}</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleExportJson}
              className="px-3.5 py-2 rounded-xl bg-elevated hover:bg-canvas border border-line-strong text-ink text-xs font-medium flex items-center gap-2 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </motion.button>
          </div>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-canvas border border-line">
            <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-accent" />
              Primary Engine
            </div>
            <div className="text-sm font-semibold text-ink mt-1 truncate">
              {overview?.postgresConnected ? 'PostgreSQL 15' : 'Local SQL Mirror'}
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5 font-mono">
              Latency: {overview?.latencyMs ?? 1} ms
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-canvas border border-line">
            <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#10A37F]" />
              Relational Rows
            </div>
            <div className="text-sm font-semibold text-ink mt-1 font-mono">
              {overview?.totalRows ?? 0} rows
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              Across 6 `cloudy_*` tables
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-canvas border border-line">
            <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-accent" />
              Offline Mirror
            </div>
            <div className="text-sm font-semibold text-ink mt-1">IndexedDB v1</div>
            <div className="text-[11px] text-ink-muted mt-0.5 font-mono truncate">
              cloudy_offline_vault
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-canvas border border-line">
            <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#10A37F]" />
              Security & RLS
            </div>
            <div className="text-sm font-semibold text-ink mt-1">
              scrypt + AES-256
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5 font-mono truncate">
              Vault: {overview?.vaultId || vault.vaultId}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Relational Table Inspector */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Relational Table Inspector
            </h3>
            <p className="text-[12px] text-ink-muted mt-0.5">
              {activeTable?.description || 'Inspect live user-scoped database records'}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              placeholder="Filter rows..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-canvas border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
            />
          </div>
        </div>

        {/* Table Selector Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(overview?.tables || []).map((tbl) => {
            const active = activeTable?.name === tbl.name;
            return (
              <button
                key={tbl.name}
                type="button"
                onClick={() => setSelectedTable(tbl.name)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-mono border flex items-center gap-2 transition-colors ${
                  active
                    ? 'bg-accent-soft border-accent/50 text-ink font-semibold'
                    : 'bg-canvas border-line text-ink-secondary hover:text-ink'
                }`}
              >
                <span>{tbl.name}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    active ? 'bg-accent text-white' : 'bg-surface text-ink-muted'
                  }`}
                >
                  {tbl.rowCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table Data Grid */}
        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>Querying database tables...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-10 text-center rounded-2xl bg-canvas border border-line text-xs text-ink-muted">
            No matching rows in <span className="font-mono">{activeTable?.name}</span>.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-canvas">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-elevated/60">
                  {tableColumns.map((col) => (
                    <th
                      key={col}
                      className="px-3.5 py-2.5 text-[11px] font-mono font-semibold text-ink-secondary whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                  {activeTable?.name === 'cloudy_sessions' && authUser && (
                    <th className="px-3.5 py-2.5 text-[11px] font-mono font-semibold text-ink-secondary text-right">
                      action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRows.map((row, idx) => (
                  <tr
                    key={String(row.id || idx)}
                    className="hover:bg-surface/60 transition-colors"
                  >
                    {tableColumns.map((col) => (
                      <td
                        key={col}
                        className="px-3.5 py-2.5 text-xs whitespace-nowrap max-w-[260px] truncate"
                      >
                        {formatCellValue(col, row[col])}
                      </td>
                    ))}
                    {activeTable?.name === 'cloudy_sessions' && authUser && (
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        {row.is_current ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#10A37F] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            This device
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRevokeSession(String(row.id))}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[11px] transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Revoke
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Authenticated Account & Password Settings */}
      {authUser && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Profile Card */}
          <form
            onSubmit={handleSaveProfile}
            className="p-6 rounded-3xl bg-surface border border-line shadow-card space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-card"
                  style={{ backgroundColor: avatarColor }}
                >
                  {(displayName || authUser.email).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <User className="w-4 h-4 text-accent" />
                    Account Profile
                  </h3>
                  <p className="text-[12px] text-ink-muted">{authUser.email}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line focus:border-accent focus:outline-none text-[13px] text-ink"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                Avatar Accent
              </label>
              <div className="flex items-center gap-2">
                {AVATAR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setAvatarColor(swatch)}
                    className={`w-6 h-6 rounded-full transition-transform ${
                      avatarColor === swatch
                        ? 'scale-115 ring-2 ring-white/80'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile || isOffline}
              className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>

          {/* Security / Password Card */}
          <form
            onSubmit={handleChangePassword}
            className="p-6 rounded-3xl bg-surface border border-line shadow-card space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-accent" />
                Password & Security
              </h3>
              <p className="text-[12px] text-ink-muted mt-0.5">
                Hashed with salted scrypt-256 before writing to `cloudy_users`.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                Current Password
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line focus:border-accent focus:outline-none text-[13px] text-ink"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                New Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line focus:border-accent focus:outline-none text-[13px] text-ink"
              />
            </div>

            <button
              type="submit"
              disabled={savingPassword || isOffline}
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-canvas border border-line-strong disabled:opacity-50 text-ink text-xs font-medium transition-colors"
            >
              {savingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
      </div>
    </div>
  );
};
