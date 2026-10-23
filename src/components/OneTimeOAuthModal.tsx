import React, { useState } from 'react';
import {
  ShieldCheck,
  ExternalLink,
  KeyRound,
  X,
  CheckCircle2,
  Lock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ProviderCatalogItem } from '../types';

interface OneTimeOAuthModalProps {
  provider: ProviderCatalogItem | null;
  onClose: () => void;
  onConnectOneTime: (
    providerId: string,
    email: string,
    accountLabel: string
  ) => Promise<void>;
  onSaveLiveOAuthApp: (
    providerId: string,
    clientId: string,
    clientSecret: string
  ) => Promise<void>;
}

export const OneTimeOAuthModal: React.FC<OneTimeOAuthModalProps> = ({
  provider,
  onClose,
  onConnectOneTime,
  onSaveLiveOAuthApp,
}) => {
  const [email, setEmail] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [showLiveConfig, setShowLiveConfig] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savedLiveConfig, setSavedLiveConfig] = useState(false);

  if (!provider) return null;

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    try {
      const fallbackEmail =
        email.trim() || `account@${provider.id.replace(/_/g, '')}.com`;
      await onConnectOneTime(provider.id, fallbackEmail, accountLabel.trim());
      onClose();
    } finally {
      setConnecting(false);
    }
  };

  const handleOpenPopupOAuth = () => {
    const width = 500;
    const height = 640;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      `/api/oauth/${provider.id}/authorize`,
      `cloudy_oauth_${provider.id}`,
      `width=${width},height=${height},left=${left},top=${top}`
    );
    onClose();
  };

  const handleSaveOAuthKeys = async () => {
    await onSaveLiveOAuthApp(provider.id, clientId, clientSecret);
    setSavedLiveConfig(true);
    setTimeout(() => setSavedLiveConfig(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl bg-[#0B1220] border border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Accent Banner */}
        <div
          className="px-6 py-5 border-b border-slate-800/80 flex items-start justify-between gap-3"
          style={{ background: `linear-gradient(135deg, ${provider.color}1C, #080D18)` }}
        >
          <div>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold mb-2"
              style={{ backgroundColor: provider.accentBg, color: provider.color }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {provider.freeLabel} · One-Time OAuth 2.0
            </span>
            <h3 className="text-lg font-bold text-white">
              Connect {provider.name} to Cloudy
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Authorize once — Cloudy stores a persistent refresh token and auto-renews silently.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAuthorize} className="p-6 space-y-4">
          {/* OAuth Permissions Box */}
          <div className="rounded-2xl bg-[#060A14] border border-slate-800/90 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                One-Time OAuth Token Policy
              </span>
              <span className="text-emerald-400">offline_access = enabled</span>
            </div>
            <div className="text-slate-400">
              Requested Scopes:{' '}
              <span className="font-mono text-slate-300">
                {provider.scopes.join(', ')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Account Email / Identifier
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${provider.id.replace(/_/g, '')}.com`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Drive Label (Optional)
              </label>
              <input
                type="text"
                value={accountLabel}
                onChange={(e) => setAccountLabel(e.target.value)}
                placeholder={`${provider.name} Vault`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-xs text-white"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="submit"
              disabled={connecting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              {connecting
                ? 'Authorizing...'
                : `One-Time Authorize (+${provider.freeLabel})`}
            </button>

            <button
              type="button"
              onClick={handleOpenPopupOAuth}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              OAuth Popup Window
            </button>
          </div>

          {/* Need a free account first? */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-400">Don't have a free {provider.name} account yet?</span>
            <a
              href={provider.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:text-sky-300 font-semibold inline-flex items-center gap-1"
            >
              Claim {provider.freeLabel} <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Expandable Live Upstream OAuth Client Credentials */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowLiveConfig(!showLiveConfig)}
              className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 py-1"
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                Optional: Custom Upstream OAuth Client ID & Secret
                {provider.liveOAuthConfigured && (
                  <span className="text-emerald-400 font-semibold">(Configured)</span>
                )}
              </span>
              {showLiveConfig ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showLiveConfig && (
              <div className="mt-2 p-3.5 rounded-2xl bg-[#060A14] border border-slate-800 space-y-2.5">
                <p className="text-[11px] text-slate-400">
                  Enter OAuth 2.0 credentials from {provider.name}'s developer console to redirect OAuth Popup logins directly to{' '}
                  <span className="font-mono text-slate-300">{provider.authorizeUrl}</span>.
                </p>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="OAuth Client ID"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B1220] border border-slate-800 text-xs text-white font-mono"
                />
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="OAuth Client Secret"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B1220] border border-slate-800 text-xs text-white font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveOAuthKeys}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300"
                >
                  {savedLiveConfig ? '✓ Saved OAuth App Keys' : 'Save OAuth Credentials'}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
