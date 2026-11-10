import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Upload,
  Zap,
  X,
  Loader2,
  Search,
  Cloud,
} from 'lucide-react';
import type {
  VaultState,
  ProviderCatalogItem,
  AllocationRule,
} from '../types';
import { formatBytes } from '../lib/format';
import { apiFetch } from '../lib/vaultClient';
import { ConnectProviderModal } from './ConnectProviderModal';

interface ProvidersHubProps {
  vault: VaultState;
  isOffline: boolean;
  onConnectCredentials: (
    providerId: string,
    credentials: Record<string, string>
  ) => Promise<void>;
  onSyncAccount: (accountId: string) => Promise<void>;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onUpdateAllocationRule: (rule: AllocationRule) => Promise<void>;
  onConnectedRefresh: (label?: string) => Promise<void>;
}

const RULES: { id: AllocationRule; label: string }[] = [
  { id: 'most_free', label: 'Most Free' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'by_type', label: 'By File Type' },
  { id: 'mirror', label: '2x Mirror' },
];

type CatalogFilter = 'all' | 'instant' | 'connected' | 's3';

function getProviderBadgeStyle(providerId: string, name: string) {
  const map: Record<string, { code: string; color: string; bg: string }> = {
    gdrive: { code: 'GD', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.14)' },
    onedrive: { code: 'OD', color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.14)' },
    dropbox: { code: 'DB', color: '#4D6BFE', bg: 'rgba(77, 107, 254, 0.15)' },
    mega: { code: 'MG', color: '#F87171', bg: 'rgba(248, 113, 113, 0.14)' },
    box: { code: 'BX', color: '#60A5FA', bg: 'rgba(96, 165, 250, 0.14)' },
    pcloud: { code: 'PC', color: '#2DD4BF', bg: 'rgba(45, 212, 191, 0.14)' },
    github: { code: 'GH', color: '#E2E8F0', bg: 'rgba(226, 232, 240, 0.12)' },
    r2: { code: 'R2', color: '#FB923C', bg: 'rgba(251, 146, 60, 0.14)' },
    b2: { code: 'B2', color: '#F87171', bg: 'rgba(248, 113, 113, 0.14)' },
    supabase: { code: 'SB', color: '#10A37F', bg: 'rgba(16, 163, 127, 0.15)' },
    nextcloud: { code: 'NC', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.14)' },
    koofr: { code: 'KF', color: '#34D399', bg: 'rgba(52, 211, 153, 0.14)' },
    yandex: { code: 'YD', color: '#FBBF24', bg: 'rgba(251, 191, 36, 0.14)' },
    webdav: { code: 'WD', color: '#A78BFA', bg: 'rgba(167, 139, 250, 0.14)' },
  };
  if (map[providerId]) return map[providerId];
  const letters = (name || 'CL')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return { code: letters, color: '#A4ABC0', bg: 'rgba(164, 171, 192, 0.12)' };
}

export const ProvidersHub: React.FC<ProvidersHubProps> = ({
  vault,
  isOffline,
  onConnectCredentials,
  onSyncAccount,
  onDisconnectAccount,
  onUpdateAllocationRule,
  onConnectedRefresh,
}) => {
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderCatalogItem | null>(null);
  const [syncingAccId, setSyncingAccId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [showRcloneModal, setShowRcloneModal] = useState(false);
  const [rcloneText, setRcloneText] = useState('');
  const [importingRclone, setImportingRclone] = useState(false);
  const [rcloneErr, setRcloneErr] = useState<string | null>(null);
  const confFileRef = useRef<HTMLInputElement>(null);

  const rawQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const freeRemaining = Math.max(0, rawQuota - totalUsed);
  const usedPct =
    rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;

  const handleSync = async (id: string) => {
    setSyncingAccId(id);
    try {
      await onSyncAccount(id);
    } finally {
      setSyncingAccId(null);
    }
  };

  const handleSyncAll = async () => {
    if (syncingAll || isOffline || vault.accounts.length === 0) return;
    setSyncingAll(true);
    try {
      for (const acc of vault.accounts) {
        await onSyncAccount(acc.id);
      }
    } finally {
      setSyncingAll(false);
    }
  };

  const handleRcloneFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setRcloneText(await f.text());
    e.target.value = '';
  };

  const handleImportRclone = async (e: React.FormEvent) => {
    e.preventDefault();
    setRcloneErr(null);
    setImportingRclone(true);
    try {
      const res = await apiFetch('/api/accounts/import-rclone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configText: rcloneText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setShowRcloneModal(false);
      setRcloneText('');
      await onConnectedRefresh(`${data.connectedCount} Cloud Account(s)`);
    } catch (err: unknown) {
      setRcloneErr(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingRclone(false);
    }
  };

  const filteredProviders = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return vault.providersCatalog.filter((p) => {
      const isConnected = vault.accounts.some((a) => a.providerId === p.id);
      if (catalogFilter === 'instant' && !p.zeroConsole) return false;
      if (catalogFilter === 'connected' && !isConnected) return false;
      if (
        catalogFilter === 's3' &&
        p.authMode !== 's3' &&
        p.authMode !== 'supabase'
      ) {
        return false;
      }
      if (q) {
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.freeLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [vault.providersCatalog, vault.accounts, catalogFilter, catalogSearch]);

  return (
    <div className="flex-1 min-w-0">
      <div className="studio-container space-y-7">
        {/* STORAGE POOL COMMAND HERO */}
        <div className="relative overflow-hidden studio-card-strong p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div
            className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-30"
            style={{ background: 'var(--accent-soft)' }}
          />

          <div className="relative space-y-3.5 flex-1 max-w-xl">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
              <Cloud className="w-4 h-4 text-accent shrink-0" />
              <span>Unified Cloud Pool · Free Storage. One System. Your Rules.</span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl sm:text-4xl font-bold text-ink font-mono tabular-nums tracking-tight">
                {rawQuota > 0 ? formatBytes(rawQuota, 1) : '0 GB'}
              </span>
              <span className="text-xs sm:text-sm text-ink-secondary font-mono tabular-nums">
                {rawQuota > 0
                  ? `${formatBytes(freeRemaining, 1)} free · ${formatBytes(totalUsed)} used`
                  : 'Connect a verified cloud below to stack free storage'}
              </span>
            </div>

            <div className="h-2.5 w-full rounded-full bg-canvas border border-line overflow-hidden">
              <div
                style={{ width: `${rawQuota > 0 ? Math.max(3, usedPct) : 0}%` }}
                className="h-full bg-accent rounded-full transition-all duration-700"
              />
            </div>
          </div>

          <div className="relative flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Routing Strategy
              </div>
              <div className="grid grid-cols-2 sm:inline-flex gap-1 bg-canvas border border-line p-1 rounded-xl">
                {RULES.map((r) => {
                  const active = vault.settings.allocationRule === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={isOffline}
                      onClick={() => onUpdateAllocationRule(r.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium text-center transition-colors ${
                        active
                          ? 'bg-accent text-accent-fg shadow-glow'
                          : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              disabled={isOffline}
              onClick={() => setShowRcloneModal(true)}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-elevated hover:bg-canvas border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-center gap-2 transition shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-accent" />
              <span>Import rclone.conf</span>
            </button>
          </div>
        </div>

        {/* VERIFIED CONNECTED ACCOUNTS */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Verified Connected Accounts · {vault.accounts.length}
            </h2>
            {!isOffline && vault.accounts.length > 1 && (
              <button
                type="button"
                disabled={syncingAll}
                onClick={handleSyncAll}
                className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`}
                />
                <span>{syncingAll ? 'Syncing All...' : 'Sync All'}</span>
              </button>
            )}
          </div>

          {vault.accounts.length === 0 ? (
            <div className="studio-card border-dashed border-line-strong p-6 text-center text-xs text-ink-secondary leading-relaxed">
              No storage accounts connected yet. Every account below authenticates directly against the real upstream provider.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {vault.accounts.map((acc) => {
                const pct = Math.min(
                  100,
                  (acc.usedBytes / Math.max(acc.quotaBytes, 1)) * 100
                );
                const badge = getProviderBadgeStyle(
                  acc.providerId,
                  acc.providerName
                );

                return (
                  <div
                    key={acc.id}
                    className="studio-card hover:border-line-strong p-4 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-line"
                          style={{
                            backgroundColor: badge.bg,
                            color: badge.color,
                          }}
                        >
                          {badge.code}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold text-ink truncate flex items-center gap-1.5">
                            <span className="truncate">{acc.accountLabel}</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10A37F] shrink-0" />
                          </div>
                          <div className="text-xs text-ink-muted truncate">
                            {acc.email}
                          </div>
                        </div>
                      </div>

                      {!isOffline && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSync(acc.id)}
                            disabled={syncingAccId === acc.id || syncingAll}
                            className="p-1.5 rounded-lg text-ink-secondary hover:text-ink hover:bg-elevated transition"
                            title="Sync remote files & quota"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                syncingAccId === acc.id || syncingAll
                                  ? 'animate-spin text-accent'
                                  : ''
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDisconnectAccount(acc.id)}
                            className="p-1.5 rounded-lg text-ink-muted hover:text-red-400 hover:bg-elevated transition"
                            title="Disconnect account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono text-ink-secondary tabular-nums">
                        <span>{formatBytes(acc.usedBytes)} used</span>
                        <span className="text-ink font-medium">
                          {formatBytes(acc.quotaBytes, 0)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                        <div
                          style={{ width: `${Math.max(3, pct)}%` }}
                          className="h-full bg-accent rounded-full transition-all duration-500"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* PROVIDER CATALOG */}
        <section className="space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {(
                [
                  {
                    id: 'all' as CatalogFilter,
                    label: `All Clouds (${vault.providersCatalog.length})`,
                  },
                  { id: 'instant' as CatalogFilter, label: '⚡ Instant Sign-In' },
                  { id: 'connected' as CatalogFilter, label: '✓ Connected' },
                  { id: 's3' as CatalogFilter, label: 'S3 & Buckets' },
                ] as const
              ).map((chip) => {
                const active = catalogFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setCatalogFilter(chip.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-accent-soft border-accent/50 text-ink shadow-card'
                        : 'bg-surface border-line text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Filter cloud providers..."
                className="w-full pl-9 pr-8 py-2 sm:py-1.5 rounded-xl bg-surface border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-muted hover:text-ink"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {filteredProviders.length === 0 ? (
            <div className="studio-card p-8 text-center text-xs text-ink-muted">
              No cloud providers match this filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredProviders.map((provider) => {
                const connectedForProvider = vault.accounts.filter(
                  (a) => a.providerId === provider.id
                );
                const count = connectedForProvider.length;
                const badge = getProviderBadgeStyle(provider.id, provider.name);

                return (
                  <div
                    key={provider.id}
                    className={`studio-card p-4 sm:p-5 flex flex-col justify-between gap-4 ${
                      count > 0
                        ? 'border-[#10A37F]/40 hover:border-[#10A37F]/65'
                        : 'hover:border-line-strong'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-line"
                            style={{
                              backgroundColor: badge.bg,
                              color: badge.color,
                            }}
                          >
                            {badge.code}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[13.5px] font-semibold text-ink leading-snug truncate">
                              {provider.name}
                            </h3>
                            {count > 0 && (
                              <span className="inline-flex items-center text-[10px] font-semibold text-[#10A37F]">
                                ✓ {count} Connected
                              </span>
                            )}
                          </div>
                        </div>

                        <span className="shrink-0 text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-lg bg-accent-soft text-accent">
                          {provider.freeLabel}
                        </span>
                      </div>

                      <p className="text-xs text-ink-secondary leading-relaxed">
                        {provider.description}
                      </p>

                      {count > 0 && (
                        <div className="space-y-1">
                          {connectedForProvider.map((acc) => (
                            <div
                              key={acc.id}
                              className="text-[11px] text-[#6EE7B7] bg-[#10A37F]/10 border border-[#10A37F]/20 rounded-lg px-2.5 py-1 truncate"
                            >
                              {acc.accountLabel} · {acc.email}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
                      {provider.zeroConsole ? (
                        <span className="text-[11px] text-[#10A37F] inline-flex items-center gap-1 font-medium">
                          <Zap className="w-3 h-3 shrink-0" /> Instant Sign-In
                        </span>
                      ) : (
                        <a
                          href={provider.signupUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1 transition"
                        >
                          Free Account{' '}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}

                      <button
                        type="button"
                        disabled={isOffline}
                        onClick={() => setSelectedProvider(provider)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 active:scale-95 transition disabled:opacity-40 ${
                          count > 0
                            ? 'bg-elevated hover:bg-canvas border border-line-strong text-ink'
                            : 'bg-accent hover:bg-accent-hover text-accent-fg shadow-glow'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{count > 0 ? 'Add Another' : 'Connect'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ConnectProviderModal
        provider={selectedProvider}
        existingAccounts={
          selectedProvider
            ? vault.accounts.filter((a) => a.providerId === selectedProvider.id)
            : []
        }
        onSyncExistingAccount={onSyncAccount}
        onClose={() => setSelectedProvider(null)}
        onConnectCredentials={onConnectCredentials}
        onConnectedRefresh={onConnectedRefresh}
      />

      {/* Responsive Bottom-Sheet / Dialog: rclone.conf Modal */}
      <AnimatePresence>
        {showRcloneModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRcloneModal(false)}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.form
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleImportRclone}
              className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-surface border-t sm:border border-line-strong p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4 shadow-float max-h-[92dvh] overflow-y-auto"
            >
              <div className="w-10 h-1 rounded-full bg-line-strong mx-auto sm:hidden" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-accent">
                    Batch Cloud Mount
                  </div>
                  <h3 className="text-base font-semibold text-ink mt-0.5">
                    Import rclone.conf
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRcloneModal(false)}
                  className="p-1.5 rounded-full text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {rcloneErr && (
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  {rcloneErr}
                </div>
              )}

              <div>
                <input
                  ref={confFileRef}
                  type="file"
                  accept=".conf,.txt"
                  className="hidden"
                  onChange={handleRcloneFile}
                />
                <button
                  type="button"
                  onClick={() => confFileRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-elevated border border-dashed border-line-strong text-xs text-accent font-medium inline-flex items-center justify-center gap-2 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select rclone.conf File
                </button>
              </div>

              <textarea
                required
                rows={5}
                value={rcloneText}
                onChange={(e) => setRcloneText(e.target.value)}
                placeholder={`[drive]\ntype = drive\ntoken = {"access_token":"..."}`}
                className="w-full p-3.5 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-xs font-mono text-ink resize-none transition-all"
              />

              <button
                type="submit"
                disabled={importingRclone}
                className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
              >
                {importingRclone && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {importingRclone
                  ? 'Verifying Accounts...'
                  : 'Mount All Accounts'}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
