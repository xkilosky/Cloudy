import React, { useRef, useState } from 'react';
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

  const [showRcloneModal, setShowRcloneModal] = useState(false);
  const [rcloneText, setRcloneText] = useState('');
  const [importingRclone, setImportingRclone] = useState(false);
  const [rcloneErr, setRcloneErr] = useState<string | null>(null);
  const confFileRef = useRef<HTMLInputElement>(null);

  const rawQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = rawQuota > 0 ? Math.min(100, (totalUsed / rawQuota) * 100) : 0;

  const handleSync = async (id: string) => {
    setSyncingAccId(id);
    try {
      await onSyncAccount(id);
    } finally {
      setSyncingAccId(null);
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

  return (
    <div className="flex-1 px-4 sm:px-8 py-7">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Ambient Storage Pool Hero Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="relative overflow-hidden rounded-3xl bg-surface border border-line-strong p-6 sm:p-8 shadow-card flex flex-col lg:flex-row lg:items-center justify-between gap-6"
        >
          <div
            className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-35"
            style={{ background: 'var(--accent-soft)' }}
          />

          <div className="relative space-y-3 flex-1 max-w-xl">
            <div className="text-xs font-medium text-ink-secondary">
              Unified Cloud Pool · Free Storage. One System. Your Rules.
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl sm:text-4xl font-bold text-ink font-mono tabular-nums tracking-tight">
                {rawQuota > 0 ? formatBytes(rawQuota, 1) : '0 GB'}
              </span>
              <span className="text-sm text-ink-muted font-mono tabular-nums">
                {rawQuota > 0
                  ? `${formatBytes(totalUsed)} used`
                  : 'Connect a real account below'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-canvas overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${rawQuota > 0 ? Math.max(3, usedPct) : 0}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="h-full bg-accent rounded-full"
              />
            </div>
          </div>

          <div className="relative flex flex-col sm:flex-row items-start sm:items-end gap-3.5">
            {/* Gliding Routing Rule Pills */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-ink-muted">
                Routing Strategy
              </div>
              <div className="inline-flex flex-wrap gap-1 bg-canvas border border-line p-1 rounded-full">
                {RULES.map((r) => {
                  const active = vault.settings.allocationRule === r.id;
                  return (
                    <button
                      key={r.id}
                      disabled={isOffline}
                      onClick={() => onUpdateAllocationRule(r.id)}
                      className={`relative px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        active ? 'text-accent-fg' : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="routingRulePill"
                          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-full bg-accent shadow-glow"
                        />
                      )}
                      <span className="relative z-10">{r.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              disabled={isOffline}
              onClick={() => setShowRcloneModal(true)}
              className="px-4 py-2 rounded-full bg-elevated hover:bg-canvas border border-line-strong text-ink text-xs font-medium inline-flex items-center gap-2 transition shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-accent" />
              Import rclone.conf
            </motion.button>
          </div>
        </motion.div>

        {/* Connected Accounts */}
        <section className="space-y-3.5">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
            Verified Connected Accounts · {vault.accounts.length}
          </h2>
          {vault.accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface/40 p-6 text-center text-xs text-ink-secondary">
              No storage accounts connected yet. Every account below authenticates directly against the real provider — sign in to stack free storage.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {vault.accounts.map((acc, idx) => {
                const pct = Math.min(
                  100,
                  (acc.usedBytes / Math.max(acc.quotaBytes, 1)) * 100
                );
                return (
                  <motion.div
                    key={acc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(idx * 0.04, 0.2) }}
                    whileHover={{ y: -2 }}
                    className="rounded-2xl bg-surface border border-line hover:border-line-strong p-5 flex flex-col justify-between gap-4 shadow-card transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-ink truncate flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#10A37F] shrink-0" />
                          <span className="truncate">{acc.accountLabel}</span>
                        </div>
                        <div className="text-xs text-ink-muted truncate mt-0.5">
                          {acc.email}
                        </div>
                      </div>

                      {!isOffline && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleSync(acc.id)}
                            disabled={syncingAccId === acc.id}
                            className="p-1.5 rounded-lg text-ink-secondary hover:text-ink hover:bg-elevated transition"
                            title="Sync remote files & quota"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                syncingAccId === acc.id ? 'animate-spin text-accent' : ''
                              }`}
                            />
                          </button>
                          <button
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
                        <span>{formatBytes(acc.usedBytes)}</span>
                        <span className="text-ink font-medium">
                          {formatBytes(acc.quotaBytes, 0)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(3, pct)}%` }}
                          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                          className="h-full bg-accent rounded-full"
                        />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>

        {/* Provider Catalog Grid */}
        <section className="space-y-3.5">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
            Add Free Cloud Storage
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {vault.providersCatalog.map((provider, idx) => {
              const count = vault.accounts.filter(
                (a) => a.providerId === provider.id
              ).length;

              return (
                <motion.div
                  key={provider.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: Math.min(idx * 0.03, 0.24) }}
                  whileHover={{ y: -2 }}
                  className="rounded-2xl bg-surface hover:bg-elevated/60 border border-line hover:border-line-strong p-5 flex flex-col justify-between gap-4 shadow-card transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[14px] font-semibold text-ink flex items-center gap-2">
                        {provider.name}
                        {count > 0 && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#10A37F]/15 text-[#10A37F]">
                            {count}
                          </span>
                        )}
                      </h3>
                      <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-accent-soft text-accent">
                        {provider.freeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      {provider.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-line">
                    {provider.zeroConsole ? (
                      <span className="text-[11px] text-[#10A37F] inline-flex items-center gap-1 font-medium">
                        <Zap className="w-3 h-3" /> Instant Sign-In
                      </span>
                    ) : (
                      <a
                        href={provider.signupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1 transition"
                      >
                        Free Account <ExternalLink className="w-3 h-3" />
                      </a>
                    )}

                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      disabled={isOffline}
                      onClick={() => setSelectedProvider(provider)}
                      className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center gap-1 shadow-glow transition disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Connect
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      </div>

      <ConnectProviderModal
        provider={selectedProvider}
        onClose={() => setSelectedProvider(null)}
        onConnectCredentials={onConnectCredentials}
        onConnectedRefresh={onConnectedRefresh}
      />

      {/* Spring rclone.conf Modal */}
      <AnimatePresence>
        {showRcloneModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRcloneModal(false)}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleImportRclone}
              className="w-full max-w-md rounded-3xl bg-surface border border-line-strong p-6 space-y-4 shadow-float"
            >
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
                {importingRclone && <Loader2 className="w-4 h-4 animate-spin" />}
                {importingRclone ? 'Verifying Accounts...' : 'Mount All Accounts'}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
