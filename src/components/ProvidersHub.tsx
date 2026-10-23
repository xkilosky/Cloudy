import React, { useState } from 'react';
import {
  Cloud,
  ShieldCheck,
  Plus,
  ExternalLink,
  Trash2,
  Sliders,
  Zap,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import type {
  VaultState,
  ProviderCatalogItem,
  AllocationRule,
} from '../types';
import { formatBytes } from '../lib/format';
import { OneTimeOAuthModal } from './OneTimeOAuthModal';

interface ProvidersHubProps {
  vault: VaultState;
  isOffline: boolean;
  onConnectProvider: (
    providerId: string,
    email: string,
    accountLabel: string
  ) => Promise<void>;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onUpdateAllocationRule: (rule: AllocationRule) => Promise<void>;
  onSaveLiveOAuthApp: (
    providerId: string,
    clientId: string,
    clientSecret: string
  ) => Promise<void>;
}

const RULES: {
  id: AllocationRule;
  title: string;
  desc: string;
}[] = [
  {
    id: 'most_free',
    title: 'Most Free Space First',
    desc: 'Routes every new upload to the connected cloud provider with the largest available free quota.',
  },
  {
    id: 'waterfall',
    title: 'Waterfall Spillover (95%)',
    desc: 'Fills your connected providers in order up to 95%, then automatically overflows to the next drive.',
  },
  {
    id: 'by_type',
    title: 'Smart File-Type Routing',
    desc: 'Docs/Notes → Google Drive or Box · Media/Archives → MEGA or R2 · Code/JSON → GitHub Vault.',
  },
  {
    id: 'mirror',
    title: '2x Redundant Cloud Mirror',
    desc: 'Writes files simultaneously across two separate connected cloud providers for zero-loss backup.',
  },
];

export const ProvidersHub: React.FC<ProvidersHubProps> = ({
  vault,
  isOffline,
  onConnectProvider,
  onDisconnectAccount,
  onUpdateAllocationRule,
  onSaveLiveOAuthApp,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeOAuthProvider, setActiveOAuthProvider] =
    useState<ProviderCatalogItem | null>(null);
  const [connectingBatch, setConnectingBatch] = useState(false);

  const categories = [
    'All',
    'Personal Cloud',
    'Encrypted Cloud',
    'Developer Object Cloud',
  ];

  const filteredCatalog = vault.providersCatalog.filter(
    (p) => selectedCategory === 'All' || p.category === selectedCategory
  );

  const totalQuota = vault.summary.totalQuotaBytes || 0;
  const totalUsed = vault.summary.totalUsedBytes || 0;
  const maxCatalogPool = vault.summary.maxCatalogFreeBytes + 5 * 1024 * 1024 * 1024;

  const handleQuickStackTopProviders = async () => {
    setConnectingBatch(true);
    try {
      const topIds = ['mega', 'google_drive', 'box', 'pcloud', 'cloudflare_r2'];
      for (const pid of topIds) {
        const already = vault.accounts.some((a) => a.providerId === pid);
        if (!already) {
          await onConnectProvider(pid, `vault@${pid.replace('_', '')}.com`, '');
        }
      }
    } finally {
      setConnectingBatch(false);
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Hero Storage Pool Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-[#0D182E] via-[#0A1222] to-[#070C17] border border-sky-500/25 p-6 sm:p-7 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              All Providers · One-Time OAuth · Persistent Refresh Tokens
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Obtain & Pool Free Cloud Storage
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Connect all 15 free-tier cloud providers once via <strong>One-Time OAuth</strong>. Cloudy merges them into one unified drive (<span className="text-sky-300 font-semibold">133 GB+ on first pass</span>, unlimited when stacking multiple accounts) and keeps your files accessible offline.
            </p>
          </div>

          <div className="rounded-2xl bg-[#060A14]/90 border border-slate-800 p-5 min-w-[260px] space-y-3">
            <div className="text-xs text-slate-400 font-medium">Total Active Free Pool</div>
            <div className="text-3xl font-extrabold text-white font-mono tabular-nums">
              {formatBytes(totalQuota, 1)}
            </div>
            <div className="text-xs text-slate-400 tabular-nums">
              {formatBytes(totalUsed)} used across{' '}
              <span className="text-sky-400 font-semibold">
                {vault.accounts.length} connected drives
              </span>
            </div>
            {!isOffline && vault.accounts.length < 6 && (
              <button
                onClick={handleQuickStackTopProviders}
                disabled={connectingBatch}
                className="w-full py-2 px-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-md shadow-sky-500/20"
              >
                <Zap className="w-3.5 h-3.5" />
                {connectingBatch
                  ? 'Connecting Top Drives...'
                  : '1-Click Stack Top 5 Drives (+65 GB)'}
              </button>
            )}
          </div>
        </div>

        {/* Visual Stacked Quota Breakdown */}
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Provider Capacity Breakdown</span>
            <span className="font-mono tabular-nums">
              {Math.min(100, Math.round((totalQuota / maxCatalogPool) * 100))}% of single-account catalog unlocked
            </span>
          </div>
          <div className="h-3.5 w-full rounded-full bg-[#05080F] border border-slate-800 p-0.5 flex gap-1 overflow-hidden">
            {vault.accounts.map((acc) => {
              const pct = Math.max(3, (acc.quotaBytes / Math.max(totalQuota, 1)) * 100);
              return (
                <div
                  key={acc.id}
                  style={{ width: `${pct}%`, backgroundColor: acc.color }}
                  className="h-full rounded-full transition-all duration-500"
                  title={`${acc.accountLabel}: ${formatBytes(acc.quotaBytes)}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            {vault.accounts.map((acc) => (
              <div key={acc.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: acc.color }}
                />
                <span className="font-medium">{acc.accountLabel}</span>
                <span className="text-slate-500 font-mono">
                  ({formatBytes(acc.quotaBytes, 0)})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connected Drives List */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-sky-400" />
          Connected Storage Accounts ({vault.accounts.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {vault.accounts.map((acc) => {
            const pctUsed = Math.min(100, (acc.usedBytes / Math.max(acc.quotaBytes, 1)) * 100);
            return (
              <div
                key={acc.id}
                className="rounded-2xl bg-[#0B1220] border border-slate-800/90 p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: acc.color }}
                      />
                      <span className="text-sm font-bold text-white">
                        {acc.accountLabel}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{acc.email}</div>
                  </div>

                  {acc.id !== 'acc_xkilo_core' && !isOffline && (
                    <button
                      onClick={() => onDisconnectAccount(acc.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="Disconnect drive (files auto-migrate safely to Core Vault)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono tabular-nums">
                    <span className="text-slate-300">{formatBytes(acc.usedBytes)} used</span>
                    <span className="text-slate-400">{formatBytes(acc.quotaBytes, 0)} free tier</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, pctUsed)}%`,
                        backgroundColor: acc.color,
                      }}
                    />
                  </div>
                  <div className="pt-1 flex items-center justify-between text-[11px]">
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      One-Time OAuth Active
                    </span>
                    <span className="text-slate-500">Auto-Refresh On</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* "Your Rules" Smart Allocation Engine */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            One System. Your Rules — Smart Allocation Policy
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {RULES.map((rule) => {
            const selected = vault.settings.allocationRule === rule.id;
            return (
              <button
                key={rule.id}
                disabled={isOffline}
                onClick={() => onUpdateAllocationRule(rule.id)}
                className={`text-left p-4 rounded-2xl border transition ${
                  selected
                    ? 'bg-sky-500/12 border-sky-400/60 shadow-lg shadow-sky-500/10'
                    : 'bg-[#0B1220] border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-white">{rule.title}</span>
                  {selected && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{rule.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* All 15 Free Cloud Storage Providers Directory */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Cloud className="w-5 h-5 text-sky-400" />
              All Free Storage Providers ({vault.providersCatalog.length} Providers · Stack Multiple Accounts)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect any provider with One-Time OAuth. You can even connect multiple accounts of the same provider to multiply your free quota.
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  selectedCategory === cat
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'bg-[#0B1220] text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCatalog.map((provider) => {
            const connectedCount = vault.accounts.filter(
              (a) => a.providerId === provider.id
            ).length;

            return (
              <div
                key={provider.id}
                className="rounded-2xl bg-[#0B1220] hover:bg-[#0E1729] border border-slate-800/90 hover:border-slate-700 p-5 flex flex-col justify-between gap-4 transition"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
                        style={{
                          backgroundColor: provider.accentBg,
                          color: provider.color,
                        }}
                      >
                        {provider.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          {provider.name}
                          {connectedCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                              {connectedCount} linked
                            </span>
                          )}
                        </h3>
                        <span className="text-[11px] text-slate-400">{provider.badge}</span>
                      </div>
                    </div>

                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-extrabold font-mono shrink-0"
                      style={{
                        backgroundColor: provider.accentBg,
                        color: provider.color,
                      }}
                    >
                      {provider.freeLabel}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {provider.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <a
                    href={provider.signupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-400 hover:text-sky-300 inline-flex items-center gap-1 transition"
                  >
                    Get Free Tier <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    disabled={isOffline}
                    onClick={() => setActiveOAuthProvider(provider)}
                    className="px-3.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500 hover:text-slate-950 text-sky-300 border border-sky-500/30 text-xs font-bold inline-flex items-center gap-1.5 transition disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {connectedCount > 0 ? 'Add Another Account' : 'One-Time OAuth'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <OneTimeOAuthModal
        provider={activeOAuthProvider}
        onClose={() => setActiveOAuthProvider(null)}
        onConnectOneTime={onConnectProvider}
        onSaveLiveOAuthApp={onSaveLiveOAuthApp}
      />
    </div>
  );
};
