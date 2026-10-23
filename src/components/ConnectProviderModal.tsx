import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);

  const [ncServerUrl, setNcServerUrl] = useState('https://cloud.tab.digital');
  const [ncCustom, setNcCustom] = useState(false);
  const [ncPolling, setNcPolling] = useState(false);

  const [smartPayload, setSmartPayload] = useState('');

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

  const isDeviceFlowProvider =
    provider?.id === 'github_vault' || provider?.id === 'onedrive';

  const handleStartDeviceSignIn = async () => {
    if (!provider) return;
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
        // ignore
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
          // keep polling
        }
      }, pollMs);
    } catch (err: unknown) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
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
    if (!provider) return;
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

  const inputCls =
    'w-full px-4 py-2.5 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-xs text-ink placeholder:text-ink-muted transition-all';

  return (
    <AnimatePresence>
      {provider && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-surface border border-line-strong p-6 space-y-5 shadow-float"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium text-accent inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-soft">
                  <Zap className="w-3 h-3" /> {provider.freeLabel}
                </div>
                <h3 className="text-base font-semibold text-ink mt-2">
                  Connect {provider.name}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-ink-muted hover:text-ink hover:bg-elevated transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="break-words">{errorMsg}</span>
              </motion.div>
            )}

            {/* 1. One-Click Device Flow (GitHub & Microsoft OneDrive) */}
            {isDeviceFlowProvider && (
              <div className="space-y-4">
                {!deviceFlow ? (
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={loading}
                    onClick={handleStartDeviceSignIn}
                    className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Sign in with {provider.name}
                  </motion.button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-2xl bg-canvas border border-line-strong text-center space-y-3"
                  >
                    <div className="text-[11px] text-ink-secondary">
                      Enter code in popup (already copied):
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-2xl font-mono font-bold tracking-widest text-accent">
                        {deviceFlow.userCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(deviceFlow.userCode);
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }}
                        className="p-1.5 rounded-xl bg-surface text-ink-secondary hover:text-ink"
                      >
                        {copiedCode ? (
                          <Check className="w-4 h-4 text-[#10A37F]" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-ink-secondary pt-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      <span>Waiting for approval...</span>
                    </div>
                    <a
                      href={deviceFlow.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                    >
                      Re-open login window <ExternalLink className="w-3 h-3" />
                    </a>
                  </motion.div>
                )}
              </div>
            )}

            {/* 2. Two-Field Email + Password (MEGA, pCloud, Koofr, Yandex) */}
            {(provider.authMode === 'mega' ||
              provider.authMode === 'pcloud' ||
              provider.authMode === 'webdav') && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    provider.authMode === 'webdav' ? 'App Password' : 'Password'
                  }
                  className={inputCls}
                />

                {showMfa && (
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="2FA Code"
                    className={`${inputCls} font-mono`}
                  />
                )}

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Signing in...' : `Sign In · ${provider.freeLabel}`}
                </motion.button>

                {provider.authMode === 'webdav' && provider.consoleUrl && (
                  <a
                    href={provider.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center text-[11px] text-ink-muted hover:text-accent transition"
                  >
                    Get {provider.name} App Password →
                  </a>
                )}
              </form>
            )}

            {/* 3. Nextcloud 1-Click Browser Login */}
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
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          active
                            ? 'bg-accent-soft border-accent/50 text-accent'
                            : 'bg-canvas border-line text-ink-secondary hover:text-ink'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setNcCustom(true)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      ncCustom
                        ? 'bg-accent-soft border-accent/50 text-accent'
                        : 'bg-canvas border-line text-ink-secondary hover:text-ink'
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
                    className={`${inputCls} font-mono`}
                  />
                )}

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  disabled={loading || ncPolling}
                  onClick={handleStartNextcloudFlow}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {(loading || ncPolling) && <Loader2 className="w-4 h-4 animate-spin" />}
                  {ncPolling ? 'Click "Grant Access" in popup...' : '1-Click Sign In'}
                </motion.button>
              </div>
            )}

            {/* 4. Google Drive / Dropbox / Box */}
            {provider.authMode === 'oauth2' && !isDeviceFlowProvider && (
              <form onSubmit={handleSubmit} className="space-y-3">
                {provider.oauthConfigured && (
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={launchSavedOAuthPopup}
                    className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-glow transition"
                  >
                    1-Click Sign in with {provider.name}
                  </motion.button>
                )}

                {provider.id === 'google_drive' ? (
                  <button
                    type="button"
                    onClick={openGooglePlaygroundPopup}
                    className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-between transition"
                  >
                    <span>1. Authorize Google Account</span>
                    <ExternalLink className="w-3.5 h-3.5 text-accent" />
                  </button>
                ) : (
                  provider.consoleUrl && (
                    <a
                      href={provider.consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-between transition"
                    >
                      <span>1. Generate {provider.name} Token</span>
                      <ExternalLink className="w-3.5 h-3.5 text-accent" />
                    </a>
                  )
                )}

                <input
                  type="password"
                  required
                  value={smartPayload}
                  onChange={(e) => setSmartPayload(e.target.value)}
                  placeholder="2. Paste Token Here"
                  className={`${inputCls} font-mono`}
                />

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Connecting...' : 'Connect'}
                </motion.button>
              </form>
            )}

            {/* 5. S3 Buckets */}
            {provider.authMode === 's3' && (
              <form onSubmit={handleSubmit} className="space-y-2.5">
                {!provider.defaultEndpoint && (
                  <input
                    type="url"
                    required
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder="S3 Endpoint URL"
                    className={`${inputCls} font-mono`}
                  />
                )}
                <input
                  type="text"
                  required
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  placeholder="Bucket Name"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="text"
                  required
                  value={s3AccessKey}
                  onChange={(e) => setS3AccessKey(e.target.value)}
                  placeholder="Access Key ID"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="password"
                  required
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                  placeholder="Secret Key"
                  className={`${inputCls} font-mono`}
                />
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Connecting...' : 'Connect Bucket'}
                </motion.button>
              </form>
            )}

            {/* 6. Supabase */}
            {provider.authMode === 'supabase' && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="url"
                  required
                  value={sbUrl}
                  onChange={(e) => setSbUrl(e.target.value)}
                  placeholder="https://project.supabase.co"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="password"
                  required
                  value={sbKey}
                  onChange={(e) => setSbKey(e.target.value)}
                  placeholder="Service Role Key"
                  className={`${inputCls} font-mono`}
                />
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Connect
                </motion.button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
