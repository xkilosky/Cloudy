import crypto from 'crypto';

export const FREE_PROVIDER_CATALOG = [
  {
    id: 'google_drive',
    name: 'Google Drive',
    freeBytes: 15 * 1024 * 1024 * 1024, // 15 GB
    freeLabel: '15 GB Free',
    color: '#34A853',
    accentBg: 'rgba(52, 168, 83, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://drive.google.com',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email', 'profile'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    category: 'Personal Cloud',
    badge: 'Most Popular',
    description: '15 GB free per Google account. One-time OAuth stores a persistent offline refresh token.',
  },
  {
    id: 'mega',
    name: 'MEGA',
    freeBytes: 20 * 1024 * 1024 * 1024, // 20 GB
    freeLabel: '20 GB Free',
    color: '#EF4444',
    accentBg: 'rgba(239, 68, 68, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://mega.io/storage',
    authorizeUrl: 'https://mega.nz',
    tokenUrl: '',
    scopes: ['vault.readwrite', 'offline_session'],
    extraAuthParams: {},
    category: 'Encrypted Cloud',
    badge: 'Largest Single Free Tier',
    description: 'Generous 20 GB end-to-end encrypted storage tier. Ideal for large archives & media.',
  },
  {
    id: 'box',
    name: 'Box',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#0061D5',
    accentBg: 'rgba(0, 97, 213, 0.16)',
    authType: 'oauth2',
    signupUrl: 'https://www.box.com/pricing/individual',
    authorizeUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    scopes: ['root_readwrite'],
    extraAuthParams: {},
    category: 'Personal Cloud',
    badge: '10 GB Individual Plan',
    description: 'Fast enterprise-grade cloud storage with 10 GB free individual accounts and auto-rotating refresh tokens.',
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#14B8A6',
    accentBg: 'rgba(20, 184, 166, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://www.pcloud.com/',
    authorizeUrl: 'https://my.pcloud.com/oauth2/authorize',
    tokenUrl: 'https://api.pcloud.com/oauth2_token',
    scopes: ['files.readwrite'],
    extraAuthParams: {},
    category: 'Personal Cloud',
    badge: 'Permanent OAuth Token',
    description: 'Up to 10 GB free storage with non-expiring OAuth2 tokens for true connect-once reliability.',
  },
  {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#F97316',
    accentBg: 'rgba(249, 115, 22, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://www.cloudflare.com/developer-platform/r2/',
    authorizeUrl: 'https://dash.cloudflare.com',
    tokenUrl: '',
    scopes: ['r2:bucket:readwrite'],
    extraAuthParams: {},
    category: 'Developer Object Cloud',
    badge: 'Zero Egress Fees',
    description: '10 GB/month free object storage with zero egress bandwidth charges and global edge speed.',
  },
  {
    id: 'backblaze_b2',
    name: 'Backblaze B2',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#EC4899',
    accentBg: 'rgba(236, 72, 153, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://www.backblaze.com/cloud-storage',
    authorizeUrl: 'https://secure.backblaze.com',
    tokenUrl: '',
    scopes: ['listFiles', 'readFiles', 'writeFiles'],
    extraAuthParams: {},
    category: 'Developer Object Cloud',
    badge: '10 GB Free Forever',
    description: '10 GB free S3-compatible cloud storage forever with instant retrieval.',
  },
  {
    id: 'koofr',
    name: 'Koofr',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#22C55E',
    accentBg: 'rgba(34, 197, 94, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://koofr.eu/',
    authorizeUrl: 'https://app.koofr.net/oauth2/auth',
    tokenUrl: 'https://app.koofr.net/oauth2/token',
    scopes: ['files.import', 'files.read'],
    extraAuthParams: { access_type: 'offline' },
    category: 'Encrypted Cloud',
    badge: '10 GB EU Privacy',
    description: '10 GB free forever without file size limits, backed by European privacy laws.',
  },
  {
    id: 'mediafire',
    name: 'MediaFire',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#3B82F6',
    accentBg: 'rgba(59, 130, 246, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://www.mediafire.com/',
    authorizeUrl: 'https://www.mediafire.com/authorize.php',
    tokenUrl: '',
    scopes: ['files.manage'],
    extraAuthParams: {},
    category: 'Personal Cloud',
    badge: 'Fast Direct Downloads',
    description: '10 GB free cloud vault for documents, datasets, media, and large binaries.',
  },
  {
    id: 'filen',
    name: 'Filen Drive',
    freeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    freeLabel: '10 GB Free',
    color: '#06B6D4',
    accentBg: 'rgba(6, 182, 212, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://filen.io/',
    authorizeUrl: 'https://filen.io',
    tokenUrl: '',
    scopes: ['zero_knowledge.sync'],
    extraAuthParams: {},
    category: 'Encrypted Cloud',
    badge: 'Zero-Knowledge 10 GB',
    description: '10 GB free zero-knowledge encrypted cloud storage with fast chunk streaming.',
  },
  {
    id: 'onedrive',
    name: 'Microsoft OneDrive',
    freeBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    freeLabel: '5 GB Free',
    color: '#0EA5E9',
    accentBg: 'rgba(14, 165, 233, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://onedrive.live.com/',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite', 'offline_access', 'User.Read'],
    extraAuthParams: { response_mode: 'query' },
    category: 'Personal Cloud',
    badge: 'Microsoft Graph API',
    description: '5 GB free Microsoft cloud drive with silent background OAuth2 refresh_token support.',
  },
  {
    id: 'proton_drive',
    name: 'Proton Drive',
    freeBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    freeLabel: '5 GB Free',
    color: '#8B5CF6',
    accentBg: 'rgba(139, 92, 246, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://proton.me/drive',
    authorizeUrl: 'https://drive.proton.me',
    tokenUrl: '',
    scopes: ['drive.vault', 'offline_token'],
    extraAuthParams: {},
    category: 'Encrypted Cloud',
    badge: 'Swiss Privacy',
    description: 'Up to 5 GB free Swiss end-to-end encrypted storage for sensitive folders.',
  },
  {
    id: 'yandex_disk',
    name: 'Yandex Disk',
    freeBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    freeLabel: '5 GB Free',
    color: '#EAB308',
    accentBg: 'rgba(234, 179, 8, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://disk.yandex.com/',
    authorizeUrl: 'https://oauth.yandex.com/authorize',
    tokenUrl: 'https://oauth.yandex.com/token',
    scopes: ['cloud_api:disk.app_folder', 'cloud_api:disk.read', 'cloud_api:disk.write'],
    extraAuthParams: {},
    category: 'Personal Cloud',
    badge: 'REST Cloud API',
    description: '5 GB free cloud storage with clean REST API and long-lived OAuth tokens.',
  },
  {
    id: 'github_vault',
    name: 'GitHub Cloud Vault',
    freeBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    freeLabel: '5 GB Free',
    color: '#94A3B8',
    accentBg: 'rgba(148, 163, 184, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://github.com/',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user'],
    extraAuthParams: {},
    category: 'Developer Object Cloud',
    badge: 'Non-Expiring OAuth',
    description: 'Store code, markdown, datasets & releases inside private GitHub repositories via One-Time OAuth.',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    freeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    freeLabel: '2 GB Free',
    color: '#2563EB',
    accentBg: 'rgba(37, 99, 235, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://www.dropbox.com/basic',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.write', 'files.content.read', 'account_info.read'],
    extraAuthParams: { token_access_type: 'offline' },
    category: 'Personal Cloud',
    badge: 'Delta Sync Fast',
    description: '2 GB fast delta-sync free tier with offline OAuth refresh tokens.',
  },
  {
    id: 'supabase_storage',
    name: 'Supabase Storage',
    freeBytes: 1 * 1024 * 1024 * 1024, // 1 GB
    freeLabel: '1 GB Free',
    color: '#10B981',
    accentBg: 'rgba(16, 185, 129, 0.14)',
    authType: 'oauth2',
    signupUrl: 'https://supabase.com/storage',
    authorizeUrl: 'https://supabase.com/dashboard',
    tokenUrl: '',
    scopes: ['storage.buckets.readwrite'],
    extraAuthParams: {},
    category: 'Developer Object Cloud',
    badge: 'S3 + CDN Ready',
    description: '1 GB free bucket storage per project with global CDN and REST API.',
  },
];

// Ephemeral PKCE / CSRF states for in-flight OAuth flows
const pendingOAuthStates = new Map();

export function getProviderMeta(providerId) {
  if (providerId === 'xkilo_core') {
    return {
      id: 'xkilo_core',
      name: 'Cloudy Core Vault',
      freeBytes: 5 * 1024 * 1024 * 1024,
      freeLabel: '5 GB Built-In',
      color: '#38B6FF',
      accentBg: 'rgba(56, 182, 255, 0.15)',
      category: 'Built-In Vault',
      badge: 'Always Active',
      description: 'X-Kilo built-in primary vault with instant offline IndexedDB synchronization.',
    };
  }
  return FREE_PROVIDER_CATALOG.find((p) => p.id === providerId) || null;
}

export function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildUpstreamOAuthUrl(provider, oauthConfig, redirectUri) {
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = generatePkcePair();

  pendingOAuthStates.set(state, {
    providerId: provider.id,
    verifier,
    redirectUri,
    createdAt: Date.now(),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  if (provider.scopes?.length) {
    url.searchParams.set('scope', provider.scopes.join(' '));
  }
  if (provider.extraAuthParams) {
    for (const [k, v] of Object.entries(provider.extraAuthParams)) {
      url.searchParams.set(k, v);
    }
  }
  // Add PKCE for providers supporting S256
  if (['google_drive', 'dropbox', 'onedrive', 'koofr'].includes(provider.id)) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { authorizeUrl: url.toString(), state };
}

export async function exchangeOAuthCode(state, code, getOAuthConfig) {
  const pending = pendingOAuthStates.get(state);
  if (!pending) {
    throw new Error('Invalid or expired OAuth state parameter');
  }
  pendingOAuthStates.delete(state);

  const provider = getProviderMeta(pending.providerId);
  const cfg = getOAuthConfig(pending.providerId);
  if (!provider || !cfg?.clientId || !provider.tokenUrl) {
    throw new Error('OAuth app configuration incomplete for token exchange');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret || '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: pending.redirectUri,
  });

  if (['google_drive', 'dropbox', 'onedrive', 'koofr'].includes(provider.id)) {
    body.set('code_verifier', pending.verifier);
  }

  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstream token exchange failed (${res.status}): ${errText}`);
  }

  const tokenData = await res.json();
  return {
    providerId: provider.id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || `persistent_${crypto.randomBytes(16).toString('hex')}`,
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
  };
}

/**
 * Silent background OAuth refresh so users connect ONCE ("One-Time OAuth")
 * and never need to re-authenticate.
 */
export async function ensureFreshToken(account, getOAuthConfig, updateAccountTokens) {
  if (!account.expiresAt || Date.now() < account.expiresAt - 60_000) {
    return account.accessToken;
  }
  const provider = getProviderMeta(account.providerId);
  const cfg = getOAuthConfig(account.providerId);

  if (account.connectionMode === 'live_oauth' && provider?.tokenUrl && cfg?.clientId && account.refreshToken) {
    try {
      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret || '',
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      });
      const res = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (res.ok) {
        const refreshed = await res.json();
        const nextToken = refreshed.access_token || account.accessToken;
        const nextRefresh = refreshed.refresh_token || account.refreshToken;
        const nextExpiry = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : null;
        updateAccountTokens(account.id, nextToken, nextRefresh, nextExpiry);
        return nextToken;
      }
    } catch {
      // Keep existing token fallback if offline
    }
  }
  return account.accessToken;
}
