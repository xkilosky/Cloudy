import React, { useState } from 'react';
import { X, ExternalLink, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import type { ProviderCatalogItem } from '../types';
import { getOrCreateVaultId } from '../lib/vaultClient';

interface ConnectProviderModalProps {
  provider: ProviderCatalogItem | null;
  onClose: () => void;
  onConnectCredentials: (
    providerId: string,
    credentials: Record<string, string>
  ) => Promise<void>;
}

export const ConnectProviderModal: React.FC<ConnectProviderModalProps> = ({
  provider,
  onClose,
  onConnectCredentials,
}) => {
  const [oauthTab, setOauthTab] = useState<'redirect' | 'token'>('redirect');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);

  // Form states across auth modes
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  // MEGA
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPassword, setMegaPassword] = useState('');
  const [megaMfa, setMegaMfa] = useState('');

  // GitHub
  const [ghToken, setGhToken] = useState('');
  const [ghRepo, setGhRepo] = useState('cloudy-vault');

  // S3 (R2 / B2 / Storj)
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');

  // WebDAV (Koofr / Yandex / Nextcloud)
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');

  // Supabase
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');
  const [sbBucket, setSbBucket] = useState('cloudy-vault');

  if (!provider) return null;

  const callbackUri = `${window.location.origin}/api/oauth/callback`;

  const copyCallback = () => {
    navigator.clipboard.writeText(callbackUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  const handleLaunchRealOAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!provider.oauthConfigured && !clientId.trim()) {
      setErrorMsg(`Enter your ${provider.name} OAuth Client ID to initiate OAuth 2.0.`);
      return;
    }
    const qs = new URLSearchParams({
      vaultId: getOrCreateVaultId(),
    });
    if (clientId.trim()) qs.set('clientId', clientId.trim());
    if (clientSecret.trim()) qs.set('clientSecret', clientSecret.trim());

    const width = 520;
    const height = 660;
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
      if (provider.authMode === 'mega') {
        creds = { email: megaEmail, password: megaPassword, mfaCode: megaMfa };
      } else if (provider.authMode === 'github') {
        creds = { accessToken: ghToken.trim(), repoName: ghRepo.trim() || 'cloudy-vault' };
      } else if (provider.authMode === 's3') {
        creds = {
          endpoint: (s3Endpoint || provider.defaultEndpoint || '').trim(),
          accessKeyId: s3AccessKey.trim(),
          secretAccessKey: s3SecretKey.trim(),
          bucket: s3Bucket.trim(),
        };
      } else if (provider.authMode === 'webdav') {
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
        creds = {
          accessToken: accessToken.trim(),
          refreshToken: refreshToken.trim(),
        };
      }

      await onConnectCredentials(provider.id, creds);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#07090C] border border-white/10 p-6 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-[#00F0FF] uppercase tracking-wider">
              {provider.freeLabel} · Live Verification
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

        {/* --- MODE 1: OAuth 2.0 Providers (Google Drive, Dropbox, OneDrive, Box, pCloud) --- */}
        {provider.authMode === 'oauth2' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 bg-black border border-white/[0.08] rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setOauthTab('redirect')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  oauthTab === 'redirect'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                One-Time OAuth 2.0
              </button>
              <button
                type="button"
                onClick={() => setOauthTab('token')}
                className={`py-1.5 rounded-lg font-medium transition ${
                  oauthTab === 'token'
                    ? 'bg-[#00F0FF] text-black font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Access Token
              </button>
            </div>

            {oauthTab === 'redirect' ? (
              <form onSubmit={handleLaunchRealOAuth} className="space-y-3.5">
                {!provider.oauthConfigured && (
                  <>
                    <div className="p-3 rounded-xl bg-black border border-white/[0.07] space-y-2 text-xs">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>Redirect URI:</span>
                        <button
                          type="button"
                          onClick={copyCallback}
                          className="text-[#00F0FF] inline-flex items-center gap-1 font-medium"
                        >
                          {copiedUri ? (
                            <>
                              <Check className="w-3 h-3" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Copy URI
                            </>
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-zinc-300 truncate">
                        {callbackUri}
                      </div>
                      {provider.consoleUrl && (
                        <a
                          href={provider.consoleUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-[#00F0FF] hover:underline inline-flex items-center gap-1"
                        >
                          Open {provider.name} OAuth Console <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <input
                      type="text"
                      required
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder={`${provider.name} OAuth Client ID`}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                    />
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="Client Secret (if required by app)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                    />
                  </>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold transition"
                >
                  Continue to {provider.name} OAuth
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmitDirect} className="space-y-3">
                <input
                  type="password"
                  required
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={`${provider.name} OAuth Access Token`}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <input
                  type="password"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="Refresh Token (optional, for auto-renewal)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {loading ? 'Verifying Account...' : `Verify & Connect ${provider.name}`}
                </button>
              </form>
            )}
          </div>
        )}

        {/* --- MODE 2: MEGA Direct Login (20 GB Free, Zero Dev Console!) --- */}
        {provider.authMode === 'mega' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            <p className="text-xs text-zinc-400">
              Sign in with your real MEGA account. Cloudy derives an encrypted session key and never stores your password.
            </p>
            <input
              type="email"
              required
              value={megaEmail}
              onChange={(e) => setMegaEmail(e.target.value)}
              placeholder="MEGA Email"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="password"
              required
              value={megaPassword}
              onChange={(e) => setMegaPassword(e.target.value)}
              placeholder="MEGA Password"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
            />
            <input
              type="text"
              value={megaMfa}
              onChange={(e) => setMegaMfa(e.target.value)}
              placeholder="2FA Code (only if 2FA enabled)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Connecting MEGA...' : 'Connect MEGA (20 GB)'}
            </button>
          </form>
        )}

        {/* --- MODE 3: GitHub Private Repo Storage --- */}
        {provider.authMode === 'github' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1"
              >
                1-Click Generate GitHub Token (repo scope) <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <input
              type="password"
              required
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              placeholder="ghp_... Personal Access Token"
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

        {/* --- MODE 4: S3-Compatible (Storj 25 GB, Cloudflare R2 10 GB, Backblaze B2 10 GB) --- */}
        {provider.authMode === 's3' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1"
              >
                Get {provider.name} S3 Keys <ExternalLink className="w-3 h-3" />
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

        {/* --- MODE 5: WebDAV (Koofr 10 GB, Yandex Disk 5 GB, Nextcloud) --- */}
        {provider.authMode === 'webdav' && (
          <form onSubmit={handleSubmitDirect} className="space-y-3">
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1"
              >
                Generate {provider.name} App Password <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <input
              type="url"
              required
              value={webdavUrl || provider.defaultWebdavUrl || ''}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="WebDAV Server URL (https://...)"
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
              {loading ? 'Verifying WebDAV...' : `Connect ${provider.name}`}
            </button>
          </form>
        )}

        {/* --- MODE 6: Supabase Storage (1 GB Free) --- */}
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
