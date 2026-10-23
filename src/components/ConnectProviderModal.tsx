import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Upload,
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

export const ConnectProviderModal: React.FC<ConnectProviderModalProps> = ({
  provider,
  onClose,
  onConnectCredentials,
  onConnectedRefresh,
}) => {
  // Default to ZERO-CONSOLE Instant Connect so users never have to configure OAuth apps!
  const [oauthTab, setOauthTab] = useState<'instant' | 'custom_oauth'>('instant');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  // Instant smart token / JSON / Service Account input
  const [smartPayload, setSmartPayload] = useState('');
  const saFileRef = useRef<HTMLInputElement>(null);

  // Custom OAuth2 keys (optional secondary tab)
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  // Email + Password Direct Login (MEGA 20 GB & pCloud 10 GB)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginMfa, setLoginMfa] = useState('');

  // Nextcloud 1-Click Login Flow v2
  const [ncMode, setNcMode] = useState<'flow' | 'manual'>('flow');
  const [ncServerUrl, setNcServerUrl] = useState('https://cloud.tab.digital');
  const [ncPolling, setNcPolling] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  // GitHub
  const [ghToken, setGhToken] = useState('');
  const [ghRepo, setGhRepo] = useState('cloudy-vault');

  // S3 (Storj / R2 / B2)
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');

  // WebDAV (Koofr / Yandex / Manual Nextcloud)
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');

  // Supabase
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');
  const [sbBucket, setSbBucket] = useState('cloudy-vault');

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    setErrorMsg(null);
    setOauthTab('instant');
    setSmartPayload('');
    setNcPolling(false);
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);

    try {
      const raw = localStorage.getItem(`cloudy_oauth_app_${provider.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        setClientId(parsed.clientId || '');
        setClientSecret(parsed.clientSecret || '');
      } else {
        setClientId('');
        setClientSecret('');
      }
    } catch {
      setClientId('');
      setClientSecret('');
    }
  }, [provider]);

  if (!provider) return null;

  const callbackUri = `${window.location.origin}/api/oauth/callback`;
  const rcloneTypeMap: Record<string, string> = {
    google_drive: 'drive',
    dropbox: 'dropbox',
    onedrive: 'onedrive',
    box: 'box',
  };
  const rcloneCmd = `rclone authorize "${rcloneTypeMap[provider.id] || 'drive'}"`;

  const copyText = (txt: string, kind: 'cmd' | 'uri') => {
    navigator.clipboard.writeText(txt);
    if (kind === 'cmd') {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } else {
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    }
  };

  const handleServiceAccountFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    setSmartPayload(txt);
    e.target.value = '';
  };

  // Nextcloud 1-Click Browser Login Flow v2 (Zero OAuth Console!)
  const handleStartNextcloudFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/nextcloud/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: ncServerUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Nextcloud Login Flow');

      const width = 520;
      const height = 680;
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
          // keep polling until authorized
        }
      }, 2200);
    } catch (err: unknown) {
      setLoading(false);
      setNcPolling(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLaunchCustomOAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!provider.oauthConfigured && !clientId.trim()) {
      setErrorMsg(`Enter your ${provider.name} OAuth Client ID.`);
      return;
    }
    if (clientId.trim()) {
      try {
        localStorage.setItem(
          `cloudy_oauth_app_${provider.id}`,
          JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
        );
      } catch {
        // ignore
      }
    }
    const qs = new URLSearchParams({ vaultId: getOrCreateVaultId() });
    if (clientId.trim()) qs.set('clientId', clientId.trim());
    if (clientSecret.trim()) qs.set('clientSecret', clientSecret.trim());

    const width = 520;
    const height = 680;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      `/api/oauth/${provider.id}/authorize?${qs.toString()}`,
      `cloudy_oauth_${provider.id}`,
      `width=${width},height=${height},left=${left},top=${top}`
    );
    if (!popup) {
      window.location.href = `/api/oauth/${provider.id}/authorize?${qs.toString()}`;
    } else {
      onClose();
    }
  };

  const handleSubmitDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      let creds: Record<string, string> = {};
      if (provider.authMode === 'mega' || provider.authMode === 'pcloud') {
        creds = { email: loginEmail, password: loginPassword, mfaCode: loginMfa };
      } else if (provider.authMode === 'github') {
        creds = { accessToken: ghToken.trim(), repoName: ghRepo.trim() || 'cloudy-vault' };
      } else if (provider.authMode === 's3') {
        creds = {
          endpoint: (s3Endpoint || provider.defaultEndpoint || '').trim(),
          accessKeyId: s3AccessKey.trim(),
          secretAccessKey: s3SecretKey.trim(),
          bucket: s3Bucket.trim(),
        };
      } else if (provider.authMode === 'webdav' || provider.authMode === 'nextcloud') {
        creds = {
          webdavUrl: (webdavUrl || provider.defaultWebdavUrl || '').trim(),
          username: webdavUser.trim(),
          password: webdavPass,
        };
      } else if (provider.authMode === 'supabase') {
        creds = {
          projectUrl: sbUrl.trim(),
          apiKey: sbKey.trim(),
          bucket: sbBucket.trim() || 'cloudy-vault',
        };
      } else {
        creds = { smartPayload: smartPayload.trim() };
      }

      await onConnectCredentials(provider.id, creds);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#07090C] border border-white/10 p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-[#00F0FF] uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              {provider.freeLabel} · No OAuth App Setup Needed
            </div>
            <h3 className="text-base font-bold text-white mt-0.5">
              Connect {provider.name}
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

        {/* --- DIRECT EMAIL + PASSWORD (MEGA 20 GB & pCloud 10 GB — ZERO CONSOLE!) --- */}
        {(provider.authMode === 'mega' || provider.authMode === 'pcloud') && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Sign in directly with your {provider.name} email & password. Cloudy exchanges them for an encrypted session token and never stores your password.
            </p>
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder={`${provider.name} Email`}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="password"
              required
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder={`${provider.name} Password`}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="text"
              value={loginMfa}
              onChange={(e) => setLoginMfa(e.target.value)}
              placeholder="2FA Code (only if 2FA enabled)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? `Signing in to ${provider.name}...` : `Sign In & Mount ${provider.freeLabel}`}
            </button>
          </form>
        )}

        {/* --- NEXTCLOUD 1-CLICK BROWSER LOGIN FLOW V2 (ZERO CONSOLE!) --- */}
        {provider.authMode === 'nextcloud' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 bg-black border border-white/[0.08] rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setNcMode('flow')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  ncMode === 'flow'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                1-Click Browser Login
              </button>
              <button
                type="button"
                onClick={() => setNcMode('manual')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  ncMode === 'manual'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Manual WebDAV
              </button>
            </div>

            {ncMode === 'flow' ? (
              <form onSubmit={handleStartNextcloudFlow} className="space-y-3">
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Enter any Nextcloud server URL (e.g. free 8 GB{' '}
                  <a
                    href="https://tab.digital/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00F0FF] underline"
                  >
                    Tab.Digital
                  </a>{' '}
                  or{' '}
                  <a
                    href="https://user.disroot.org/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00F0FF] underline"
                  >
                    Disroot
                  </a>
                  ) and click Sign In — no OAuth keys needed.
                </p>
                <input
                  type="text"
                  required
                  value={ncServerUrl}
                  onChange={(e) => setNcServerUrl(e.target.value)}
                  placeholder="https://cloud.tab.digital"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  disabled={loading || ncPolling}
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
                >
                  {(loading || ncPolling) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {ncPolling
                    ? 'Waiting for "Grant Access" in popup...'
                    : '1-Click Sign In with Nextcloud'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmitDirect} className="space-y-3">
                <input
                  type="url"
                  required
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  placeholder="https://your-nextcloud/remote.php/dav/files/user"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <input
                  type="text"
                  required
                  value={webdavUser}
                  onChange={(e) => setWebdavUser(e.target.value)}
                  placeholder="Username"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
                />
                <input
                  type="password"
                  required
                  value={webdavPass}
                  onChange={(e) => setWebdavPass(e.target.value)}
                  placeholder="Password / App Password"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold"
                >
                  {loading ? 'Verifying...' : 'Connect WebDAV'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* --- ZERO-CONSOLE INSTANT CONNECT FOR GOOGLE DRIVE / ONEDRIVE / DROPBOX / BOX --- */}
        {provider.authMode === 'oauth2' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 bg-black border border-white/[0.08] rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setOauthTab('instant')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  oauthTab === 'instant'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Instant (No App Setup)
              </button>
              <button
                type="button"
                onClick={() => setOauthTab('custom_oauth')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  oauthTab === 'custom_oauth'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Custom OAuth App
              </button>
            </div>

            {oauthTab === 'instant' ? (
              <form onSubmit={handleSubmitDirect} className="space-y-3.5">
                {provider.id === 'google_drive' && (
                  <div className="p-3.5 rounded-xl bg-black border border-[#00F0FF]/25 space-y-2.5 text-xs">
                    <div className="font-semibold text-white">
                      Skip Google Cloud Console completely:
                    </div>
                    <a
                      href="https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET"
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2 px-3 rounded-lg bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 text-[#00F0FF] font-semibold inline-flex items-center justify-between transition"
                    >
                      <span>1. Authorize in Google Verified Playground</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <div className="text-[11px] text-zinc-400 leading-relaxed">
                      Click blue <strong>Authorize APIs</strong> →{' '}
                      <strong>Exchange authorization code for tokens</strong> → paste the{' '}
                      <code className="text-zinc-200">Access token</code> or JSON below.
                    </div>
                  </div>
                )}

                {provider.id === 'onedrive' && (
                  <div className="p-3 rounded-xl bg-black border border-white/[0.08] space-y-2 text-xs">
                    <a
                      href="https://developer.microsoft.com/en-us/graph/graph-explorer"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#00F0FF] font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      Open Microsoft Verified Graph Explorer <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <p className="text-[11px] text-zinc-400">
                      Sign in → click the <strong>Access token</strong> tab → copy & paste below (zero Azure app setup).
                    </p>
                  </div>
                )}

                {provider.id === 'dropbox' && (
                  <div className="p-3 rounded-xl bg-black border border-white/[0.08] space-y-1.5 text-xs">
                    <a
                      href="https://www.dropbox.com/developers/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#00F0FF] font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      Get 1-Click Generated Access Token <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <p className="text-[11px] text-zinc-400">
                      Or paste output from <code className="text-zinc-200">{rcloneCmd}</code> for permanent auto-refresh.
                    </p>
                  </div>
                )}

                {/* Universal 1-Line rclone helper (uses rclone's pre-verified OAuth client!) */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-black border border-white/[0.07] text-[11px]">
                  <span className="font-mono text-zinc-400 truncate">
                    Permanent CLI: <span className="text-zinc-200">{rcloneCmd}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(rcloneCmd, 'cmd')}
                    className="text-[#00F0FF] shrink-0 ml-2 inline-flex items-center gap-1 font-medium"
                  >
                    {copiedCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedCmd ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <textarea
                  required
                  rows={3}
                  value={smartPayload}
                  onChange={(e) => setSmartPayload(e.target.value)}
                  placeholder={
                    provider.id === 'google_drive'
                      ? 'Paste Access Token (ya29...), Playground JSON, rclone JSON, or Service Account JSON...'
                      : `Paste ${provider.name} Access Token or rclone JSON {"access_token":"..."}`
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white resize-none"
                />

                {provider.id === 'google_drive' && (
                  <div>
                    <input
                      ref={saFileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleServiceAccountFile}
                    />
                    <button
                      type="button"
                      onClick={() => saFileRef.current?.click()}
                      className="text-[11px] text-zinc-400 hover:text-[#00F0FF] inline-flex items-center gap-1.5 transition"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Or upload Google Service Account .json (never expires)
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {loading ? 'Verifying Live Quota...' : `Connect ${provider.name} Now`}
                </button>
              </form>
            ) : (
              <form onSubmit={handleLaunchCustomOAuth} className="space-y-3">
                <div className="p-3 rounded-xl bg-black border border-white/[0.07] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Redirect URI:</span>
                    <button
                      type="button"
                      onClick={() => copyText(callbackUri, 'uri')}
                      className="text-[#00F0FF] inline-flex items-center gap-1 font-medium"
                    >
                      {copiedUri ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedUri ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-300 truncate">
                    {callbackUri}
                  </div>
                </div>
                <input
                  type="text"
                  required={!provider.oauthConfigured}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={`${provider.name} OAuth Client ID`}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold"
                >
                  Redirect to {provider.name}
                </button>
              </form>
            )}
          </div>
        )}

        {/* --- GITHUB PRIVATE REPO STORAGE (1-CLICK PREFILLED TOKEN) --- */}
        {provider.authMode === 'github' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2 px-3 rounded-xl bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 text-[#00F0FF] text-xs font-semibold inline-flex items-center justify-between transition"
              >
                <span>1-Click Generate GitHub Token (pre-filled)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <input
              type="password"
              required
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              placeholder="Paste ghp_... Token"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="text"
              value={ghRepo}
              onChange={(e) => setGhRepo(e.target.value)}
              placeholder="Private Repository Name (cloudy-vault)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Verifying GitHub...' : 'Mount GitHub Vault'}
            </button>
          </form>
        )}

        {/* --- S3 COMPATIBLE (Storj 25 GB, R2 10 GB, Backblaze B2 10 GB) --- */}
        {provider.authMode === 's3' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1"
              >
                Get {provider.name} Access Keys <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <input
              type="url"
              required
              value={s3Endpoint || provider.defaultEndpoint || ''}
              onChange={(e) => setS3Endpoint(e.target.value)}
              placeholder="S3 Endpoint URL (https://...)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
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
              placeholder="Secret Access Key"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Verifying Bucket...' : `Connect ${provider.name}`}
            </button>
          </form>
        )}

        {/* --- WEBDAV (Koofr 10 GB, Yandex Disk 5 GB) --- */}
        {provider.authMode === 'webdav' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1"
              >
                1-Click Generate {provider.name} App Password <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <input
              type="url"
              required
              value={webdavUrl || provider.defaultWebdavUrl || ''}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="WebDAV Server URL"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="text"
              required
              value={webdavUser}
              onChange={(e) => setWebdavUser(e.target.value)}
              placeholder="Account Email / Username"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="password"
              required
              value={webdavPass}
              onChange={(e) => setWebdavPass(e.target.value)}
              placeholder="App Password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Verifying...' : `Connect ${provider.name}`}
            </button>
          </form>
        )}

        {/* --- SUPABASE STORAGE (1 GB Free) --- */}
        {provider.authMode === 'supabase' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            <input
              type="url"
              required
              value={sbUrl}
              onChange={(e) => setSbUrl(e.target.value)}
              placeholder="https://your-project.supabase.co"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="password"
              required
              value={sbKey}
              onChange={(e) => setSbKey(e.target.value)}
              placeholder="Supabase Service Role Key"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <input
              type="text"
              value={sbBucket}
              onChange={(e) => setSbBucket(e.target.value)}
              placeholder="Bucket Name (cloudy-vault)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Verifying Bucket...' : 'Connect Supabase Storage'}
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-500">
          <span>Need a free account?</span>
          <a
            href={provider.signupUrl}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 hover:text-[#00F0FF] inline-flex items-center gap-1 transition"
          >
            Sign up at {provider.name} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
