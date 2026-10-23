import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Zap,
} from 'lucide-react';
import type { ProviderCatalogItem } from '../types';
import { apiFetch, getOrCreateVaultId } from '../lib/vaultClient';

interface ConnectProviderModalProps {
  provider: ProviderCatalogItem | null;
  onClose: () => void;
  onConnectCredentials: (
    providerId: string,
    credentials: Record<string, string>
  ) => Promise<void>;
  onConnectedRefresh: (label?: string) => Promise<void>;
}

const NEXTCLOUD_PRESETS = [
  { label: 'Tab.Digital (8 GB)', url: 'https://cloud.tab.digital' },
  { label: 'Disroot Cloud', url: 'https://cloud.disroot.org' },
];

export const ConnectProviderModal: React.FC<ConnectProviderModalProps> = ({
  provider,
  onClose,
  onConnectCredentials,
  onConnectedRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Email + Password (MEGA 20 GB, pCloud 10 GB, Koofr 10 GB, Yandex 5 GB)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  // 1-Click Device Flow state (GitHub & Microsoft OneDrive — zero tokens!)
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);

  // Nextcloud 1-Click Browser Login Flow v2
  const [ncServerUrl, setNcServerUrl] = useState('https://cloud.tab.digital');
  const [ncCustom, setNcCustom] = useState(false);
  const [ncPolling, setNcPolling] = useState(false);

  // Google Drive / Dropbox / Box simple token
  const [smartPayload, setSmartPayload] = useState('');

  // S3 & Supabase
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');

  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    setErrorMsg(null);
    setLoading(false);
    setDeviceFlow(null);
    setNcPolling(false);
    setShowMfa(false);
    setSmartPayload('');
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
  }, [provider]);

  if (!provider) return null;

  const isDeviceFlowProvider =
    provider.id === 'github_vault' || provider.id === 'onedrive';

  // --- 1-CLICK SIGN IN FOR GITHUB & MICROSOFT ONEDRIVE (ZERO TYPING!) ---
  const handleStartDeviceSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/device-auth/${provider.id}/start`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start sign-in');

      setDeviceFlow({
        userCode: data.userCode,
        verificationUri: data.verificationUri,
      });

      try {
        await navigator.clipboard.writeText(data.userCode);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 3000);
      } catch {
        // ignore clipboard denial
      }

      const width = 520;
      const height = 660;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(
        data.verificationUri,
        `cloudy_device_${provider.id}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      setLoading(false);

      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      const pollMs = Math.max(3000, (data.interval || 5) * 1000);
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const pRes = await apiFetch(`/api/device-auth/${provider.id}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode: data.deviceCode }),
          });
          const pData = await pRes.json();
          if (pData.ok && !pData.pending) {
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
            setDeviceFlow(null);
            await onConnectedRefresh(pData.account?.accountLabel || provider.name);
            onClose();
          }
        } catch {
          // keep polling while user approves in popup
        }
      }, pollMs);
    } catch (err: unknown) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // --- 1-CLICK SIGN IN FOR NEXTCLOUD (ZERO TYPING!) ---
  const handleStartNextcloudFlow = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/nextcloud/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: ncServerUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Nextcloud sign-in');

      const width = 520;
      const height = 660;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(
        data.loginUrl,
        'cloudy_nextcloud_login',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      setNcPolling(true);
      setLoading(false);

      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const pRes = await apiFetch('/api/nextcloud/login-poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pollEndpoint: data.pollEndpoint,
              pollToken: data.pollToken,
            }),
          });
          const pData = await pRes.json();
          if (pData.ok && !pData.pending) {
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
            setNcPolling(false);
            await onConnectedRefresh(pData.account?.accountLabel || 'Nextcloud');
            onClose();
          }
        } catch {
          // keep polling
        }
      }, 2200);
    } catch (err: unknown) {
      setLoading(false);
      setNcPolling(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // --- SUBMIT EMAIL+PASSWORD OR TOKEN ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      let creds: Record<string, string> = {};
      if (provider.authMode === 'mega' || provider.authMode === 'pcloud') {
        creds = { email: email.trim(), password, mfaCode: mfaCode.trim() };
      } else if (provider.authMode === 'webdav') {
        creds = {
          webdavUrl: (provider.defaultWebdavUrl || '').trim(),
          username: email.trim(),
          password,
        };
      } else if (provider.authMode === 's3') {
        creds = {
          endpoint: (s3Endpoint || provider.defaultEndpoint || '').trim(),
          bucket: s3Bucket.trim(),
          accessKeyId: s3AccessKey.trim(),
          secretAccessKey: s3SecretKey.trim(),
        };
      } else if (provider.authMode === 'supabase') {
        creds = {
          projectUrl: sbUrl.trim(),
          apiKey: sbKey.trim(),
          bucket: 'cloudy-vault',
        };
      } else {
        creds = { smartPayload: smartPayload.trim() };
      }

      await onConnectCredentials(provider.id, creds);
      onClose();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      if (m.toLowerCase().includes('2fa') || m.toLowerCase().includes('mfa')) {
        setShowMfa(true);
      }
      setErrorMsg(m);
    } finally {
      setLoading(false);
    }
  };

  const openGooglePlaygroundPopup = () => {
    const u =
      'https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET';
    const width = 620;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(u, 'cloudy_gplayground', `width=${width},height=${height},left=${left},top=${top}`);
  };

  const launchSavedOAuthPopup = () => {
    const qs = new URLSearchParams({ vaultId: getOrCreateVaultId() });
    const width = 520;
    const height = 660;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      `/api/oauth/${provider.id}/authorize?${qs.toString()}`,
      `cloudy_oauth_${provider.id}`,
      `width=${width},height=${height},left=${left},top=${top}`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#07090C] border border-white/10 p-6 space-y-5 shadow-2xl">
        {/* Clean Minimalist Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-[#00F0FF] uppercase tracking-wider flex items-center gap-1">
              <Zap className="w-3 h-3" /> {provider.freeLabel}
            </div>
            <h3 className="text-base font-bold text-white mt-0.5">
              {provider.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {/* === 1. ONE-CLICK POPUP SIGN-IN (GitHub & Microsoft OneDrive — ZERO INPUTS!) === */}
        {isDeviceFlowProvider && (
          <div className="space-y-4">
            {!deviceFlow ? (
              <button
                type="button"
                disabled={loading}
                onClick={handleStartDeviceSignIn}
                className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign in with {provider.name}
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-black border border-[#00F0FF]/40 text-center space-y-3">
                <div className="text-[11px] text-zinc-400">
                  Enter this code in the popup (already copied):
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-mono font-bold tracking-widest text-[#00F0FF]">
                    {deviceFlow.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(deviceFlow.userCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="p-1.5 rounded-lg bg-white/[0.06] text-zinc-300 hover:text-white"
                  >
                    {copiedCode ? (
                      <Check className="w-4 h-4 text-[#00F0FF]" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 pt-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00F0FF]" />
                  <span>Waiting for approval...</span>
                </div>
                <a
                  href={deviceFlow.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[#00F0FF] hover:underline inline-flex items-center gap-1"
                >
                  Re-open login window <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* === 2. TWO-FIELD EMAIL + PASSWORD SIGN-IN (MEGA 20 GB, pCloud 10 GB, Koofr, Yandex) === */}
        {(provider.authMode === 'mega' ||
          provider.authMode === 'pcloud' ||
          provider.authMode === 'webdav') && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                provider.authMode === 'webdav' ? 'App Password' : 'Password'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />

            {showMfa && (
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="2FA Code"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Signing in...' : `Sign In (${provider.freeLabel})`}
            </button>

            {provider.authMode === 'webdav' && provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-[11px] text-zinc-400 hover:text-[#00F0FF] transition"
              >
                Get {provider.name} App Password →
              </a>
            )}
          </form>
        )}

        {/* === 3. ONE-CLICK NEXTCLOUD SIGN-IN === */}
        {provider.authMode === 'nextcloud' && (
          <div className="space-y-3.5">
            <div className="flex flex-wrap gap-1.5">
              {NEXTCLOUD_PRESETS.map((p) => {
                const active = !ncCustom && ncServerUrl === p.url;
                return (
                  <button
                    key={p.url}
                    type="button"
                    onClick={() => {
                      setNcCustom(false);
                      setNcServerUrl(p.url);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                      active
                        ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                        : 'bg-black border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setNcCustom(true)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                  ncCustom
                    ? 'bg-[#00F0FF]/15 border-[#00F0FF] text-[#00F0FF]'
                    : 'bg-black border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                Custom
              </button>
            </div>

            {ncCustom && (
              <input
                type="text"
                value={ncServerUrl}
                onChange={(e) => setNcServerUrl(e.target.value)}
                placeholder="https://your-nextcloud-server.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
              />
            )}

            <button
              type="button"
              disabled={loading || ncPolling}
              onClick={handleStartNextcloudFlow}
              className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
            >
              {(loading || ncPolling) && <Loader2 className="w-4 h-4 animate-spin" />}
              {ncPolling ? 'Click "Grant Access" in popup...' : '1-Click Sign In'}
            </button>
          </div>
        )}

        {/* === 4. GOOGLE DRIVE / DROPBOX / BOX (CLEAN 2-STEP EXPRESS) === */}
        {provider.authMode === 'oauth2' && !isDeviceFlowProvider && (
          <form onSubmit={handleSubmit} className="space-y-3">
            {provider.oauthConfigured && (
              <button
                type="button"
                onClick={launchSavedOAuthPopup}
                className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold transition"
              >
                1-Click Sign in with {provider.name}
              </button>
            )}

            {provider.id === 'google_drive' ? (
              <button
                type="button"
                onClick={openGooglePlaygroundPopup}
                className="w-full py-2.5 px-3.5 rounded-xl bg-black hover:bg-white/[0.04] border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-bold inline-flex items-center justify-between transition"
              >
                <span>1. Authorize Google Account</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              provider.consoleUrl && (
                <a
                  href={provider.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-2.5 px-3.5 rounded-xl bg-black hover:bg-white/[0.04] border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-bold inline-flex items-center justify-between transition"
                >
                  <span>1. Generate {provider.name} Token</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )
            )}

            <input
              type="password"
              required
              value={smartPayload}
              onChange={(e) => setSmartPayload(e.target.value)}
              placeholder="2. Paste Token Here"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        )}

        {/* === 5. S3 BUCKETS (Storj / R2 / Backblaze B2) === */}
        {provider.authMode === 's3' && (
          <form onSubmit={handleSubmit} className="space-y-2.5">
            {!provider.defaultEndpoint && (
              <input
                type="url"
                required
                value={s3Endpoint}
                onChange={(e) => setS3Endpoint(e.target.value)}
                placeholder="S3 Endpoint URL"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
              />
            )}
            <input
              type="text"
              required
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              placeholder="Bucket Name"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="text"
              required
              value={s3AccessKey}
              onChange={(e) => setS3AccessKey(e.target.value)}
              placeholder="Access Key ID"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="password"
              required
              value={s3SecretKey}
              onChange={(e) => setS3SecretKey(e.target.value)}
              placeholder="Secret Key"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Connecting...' : 'Connect Bucket'}
            </button>
          </form>
        )}

        {/* === 6. SUPABASE STORAGE === */}
        {provider.authMode === 'supabase' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="url"
              required
              value={sbUrl}
              onChange={(e) => setSbUrl(e.target.value)}
              placeholder="https://project.supabase.co"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="password"
              required
              value={sbKey}
              onChange={(e) => setSbKey(e.target.value)}
              placeholder="Service Role Key"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Connect
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
