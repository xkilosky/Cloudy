import React, { useState } from 'react';
import { Plus, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import type {
  VaultState,
  ProviderCatalogItem,
  AllocationRule,
} from '../types';
import { formatBytes } from '../lib/format';
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
}) => {
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderCatalogItem | null>(null);
  const [syncingAccId, setSyncingAccId] = useState<string | null>(null);

  const totalQuota = Math.max(vault.summary.totalQuotaBytes || 1, 1);
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const usedPct = Math.min(100, (totalUsed / totalQuota) * 100);

  const handleSync = async (id: string) => {
    setSyncingAccId(id);
    try {
      await onSyncAccount(id);
    } finally {
      setSyncingAccId(null);
    }
  };

  return (
    <div className="flex-1 px-5 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Clean Top Pool Summary + Routing Rule */}
        <div className="rounded-2xl bg-[#07090C] border border-white/[0.08] p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 flex-1 max-w-xl">
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-500">
              Unified Storage Pool
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl sm:text-4xl font-bold text-[#00F0FF] font-mono tabular-nums">
                {formatBytes(totalQuota, 1)}
              </span>
              <span className="text-sm text-zinc-500 font-mono tabular-nums">
                / {formatBytes(totalUsed)} used
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
              <div
                className="h-full bg-[#00F0FF] rounded-full transition-all duration-500"
                style={{ width: `${Math.max(2, usedPct)}%` }}
              />
            </div>
          </div>

          {/* Minimalist Routing Rule Selector */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
              Allocation Rule
            </div>
            <div className="inline-flex flex-wrap gap-1.5 bg-black border border-white/[0.08] p-1 rounded-xl">
              {RULES.map((r) => {
                const active = vault.settings.allocationRule === r.id;
                return (
                  <button
                    key={r.id}
                    disabled={isOffline}
                    onClick={() => onUpdateAllocationRule(r.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      active
                        ? 'bg-[#00F0FF] text-black font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Connected Accounts */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
            Connected Accounts ({vault.accounts.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {vault.accounts.map((acc) => {
              const pct = Math.min(100, (acc.usedBytes / Math.max(acc.quotaBytes, 1)) * 100);
              const isCore = acc.providerId === 'xkilo_core';
              return (
                <div
                  key={acc.id}
                  className="rounded-2xl bg-[#07090C] border border-white/[0.08] p-5 flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#00F0FF] shrink-0" />
                        <span className="truncate">{acc.accountLabel}</span>
                      </div>
                      <div className="text-xs text-zinc-500 truncate mt-0.5">
                        {acc.email}
                      </div>
                    </div>

                    {!isCore && !isOffline && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleSync(acc.id)}
                          disabled={syncingAccId === acc.id}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-[#00F0FF] transition"
                          title="Sync remote files & quota"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              syncingAccId === acc.id ? 'animate-spin text-[#00F0FF]' : ''
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => onDisconnectAccount(acc.id)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 transition"
                          title="Disconnect account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono text-zinc-400 tabular-nums">
                      <span>{formatBytes(acc.usedBytes)}</span>
                      <span className="text-white">{formatBytes(acc.quotaBytes, 0)}</span>
                    </div>
                    <div className="h-1 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-[#00F0FF] rounded-full"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Connect Real Storage Providers */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
              Connect Free Cloud Storage
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {vault.providersCatalog.map((provider) => {
              const count = vault.accounts.filter(
                (a) => a.providerId === provider.id
              ).length;

              return (
                <div
                  key={provider.id}
                  className="rounded-2xl bg-[#07090C] hover:bg-[#0B0E13] border border-white/[0.07] hover:border-[#00F0FF]/40 p-5 flex flex-col justify-between gap-4 transition"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        {provider.name}
                        {count > 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00F0FF]/15 text-[#00F0FF]">
                            {count}
                          </span>
                        )}
                      </h3>
                      <span className="text-xs font-mono font-semibold text-[#00F0FF]">
                        {provider.freeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      {provider.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
                    <a
                      href={provider.signupUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 transition"
                    >
                      Get Free Account <ExternalLink className="w-3 h-3" />
                    </a>

                    <button
                      disabled={isOffline}
                      onClick={() => setSelectedProvider(provider)}
                      className="px-3.5 py-1.5 rounded-xl bg-[#00F0FF]/10 hover:bg-[#00F0FF] text-[#00F0FF] hover:text-black border border-[#00F0FF]/30 text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Connect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <ConnectProviderModal
        provider={selectedProvider}
        onClose={() => setSelectedProvider(null)}
        onConnectCredentials={onConnectCredentials}
      />
    </div>
  );
};
