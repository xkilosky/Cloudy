import crypto from 'crypto';

export const FREE_PROVIDER_CATALOG = [
  {
    id: 'mega',
    name: 'MEGA',
    freeBytes: 20 * 1024 * 1024 * 1024,
    freeLabel: '20 GB Free',
    authMode: 'mega',
    zeroConsole: true,
    signupUrl: 'https://mega.io/storage',
    consoleUrl: 'https://mega.nz',
    scopes: ['encrypted_drive.readwrite'],
    description: 'Email + Password sign-in. Done in 5 seconds — stack multiple 20 GB accounts.',
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    freeBytes: 10 * 1024 * 1024 * 1024,
    freeLabel: '10 GB Free',
    authMode: 'pcloud',
    zeroConsole: true,
    signupUrl: 'https://www.pcloud.com/',
    consoleUrl: 'https://my.pcloud.com/',
    authorizeUrl: 'https://my.pcloud.com/oauth2/authorize',
    tokenUrl: 'https://api.pcloud.com/oauth2_token',
    scopes: [],
    extraAuthParams: {},
    description: 'Email + Password sign-in. Done in 5 seconds — mounts 10 GB immediately.',
  },
  {
    id: 'onedrive',
    name: 'Microsoft OneDrive',
    freeBytes: 5 * 1024 * 1024 * 1024,
    freeLabel: '5 GB Free',
    authMode: 'oauth2',
    zeroConsole: true,
    signupUrl: 'https://onedrive.live.com/',
    consoleUrl: 'https://developer.microsoft.com/en-us/graph/graph-explorer',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite', 'offline_access', 'User.Read'],
    extraAuthParams: { response_mode: 'query' },
    description: '1-Click Sign in with Microsoft popup — zero tokens to copy, mounts 5 GB automatically.',
  },
  {
    id: 'github_vault',
    name: 'GitHub Cloud',
    freeBytes: 5 * 1024 * 1024 * 1024,
    freeLabel: '5 GB Free',
    authMode: 'github',
    zeroConsole: true,
    signupUrl: 'https://github.com/',
    consoleUrl: 'https://github.com/settings/tokens/new?scopes=repo&description=Cloudy-XKilo',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user'],
    extraAuthParams: {},
    description: '1-Click Sign in with GitHub popup — auto-creates your private cloud vault in seconds.',
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    freeBytes: 8 * 1024 * 1024 * 1024,
    freeLabel: '8–15 GB Free',
    authMode: 'nextcloud',
    zeroConsole: true,
    defaultWebdavUrl: 'https://cloud.tab.digital',
    signupUrl: 'https://nextcloud.com/sign-up/',
    consoleUrl: '',
    scopes: ['webdav.readwrite'],
    description: '1-Click Sign in with Browser — pick Tab.Digital (8 GB) or Disroot and click Grant Access.',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    freeBytes: 15 * 1024 * 1024 * 1024,
    freeLabel: '15 GB Free',
    authMode: 'oauth2',
    zeroConsole: true,
    signupUrl: 'https://drive.google.com',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.file',
    ],
    fullScopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    description: '15 GB Google Drive — quick 2-click authorize popup or Service Account JSON.',
  },
  {
    id: 'koofr',
    name: 'Koofr',
    freeBytes: 10 * 1024 * 1024 * 1024,
    freeLabel: '10 GB Free',
    authMode: 'webdav',
    zeroConsole: true,
    defaultWebdavUrl: 'https://app.koofr.net/dav/Koofr',
    signupUrl: 'https://koofr.eu/',
    consoleUrl: 'https://app.koofr.net/app/admin/preferences/password',
    scopes: ['webdav.readwrite'],
    description: '10 GB free EU cloud storage via Email + Koofr App Password — zero OAuth console.',
  },
  {
    id: 'storj',
    name: 'Storj Cloud',
    freeBytes: 25 * 1024 * 1024 * 1024,
    freeLabel: '25 GB Free',
    authMode: 's3',
    zeroConsole: true,
    defaultEndpoint: 'https://gateway.storjshare.io',
    signupUrl: 'https://www.storj.io/',
    consoleUrl: 'https://us1.storj.io/access',
    scopes: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
    description: '25 GB free S3-compatible decentralized cloud. Connect directly with S3 Gateway keys.',
  },
  {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    freeBytes: 10 * 1024 * 1024 * 1024,
    freeLabel: '10 GB Free',
    authMode: 's3',
    zeroConsole: true,
    defaultEndpoint: '',
    signupUrl: 'https://www.cloudflare.com/developer-platform/r2/',
    consoleUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    scopes: ['r2:ObjectReadWrite'],
    description: '10 GB/month free object storage with zero egress fees via S3 API credentials.',
  },
  {
    id: 'backblaze_b2',
    name: 'Backblaze B2',
    freeBytes: 10 * 1024 * 1024 * 1024,
    freeLabel: '10 GB Free',
    authMode: 's3',
    zeroConsole: true,
    defaultEndpoint: 'https://s3.us-west-004.backblazeb2.com',
    signupUrl: 'https://www.backblaze.com/cloud-storage',
    consoleUrl: 'https://secure.backblaze.com/app_keys.htm',
    scopes: ['b2:ReadWrite'],
    description: '10 GB free S3-compatible storage forever via Application Key ID & Secret.',
  },
  {
    id: 'yandex_disk',
    name: 'Yandex Disk',
    freeBytes: 5 * 1024 * 1024 * 1024,
    freeLabel: '5 GB Free',
    authMode: 'webdav',
    zeroConsole: true,
    defaultWebdavUrl: 'https://webdav.yandex.com',
    signupUrl: 'https://disk.yandex.com/',
    consoleUrl: 'https://id.yandex.com/security/app-passwords',
    scopes: ['webdav.readwrite'],
    description: '5 GB free cloud storage via Email + App Password (zero OAuth app setup).',
  },
  {
    id: 'box',
    name: 'Box',
    freeBytes: 10 * 1024 * 1024 * 1024,
    freeLabel: '10 GB Free',
    authMode: 'oauth2',
    signupUrl: 'https://www.box.com/pricing/individual',
    consoleUrl: 'https://app.box.com/developers/console',
    authorizeUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    scopes: ['root_readwrite'],
    extraAuthParams: {},
    description: '10 GB free cloud drive — connect instantly via Developer Token or rclone.',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    freeBytes: 2 * 1024 * 1024 * 1024,
    freeLabel: '2 GB Free',
    authMode: 'oauth2',
    signupUrl: 'https://www.dropbox.com/basic',
    consoleUrl: 'https://www.dropbox.com/developers/apps',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.write', 'files.content.read', 'account_info.read'],
    extraAuthParams: { token_access_type: 'offline' },
    description: '2 GB cloud storage — connect via 1-click Generated Access Token, rclone, or OAuth.',
  },
  {
    id: 'supabase_storage',
    name: 'Supabase Storage',
    freeBytes: 1 * 1024 * 1024 * 1024,
    freeLabel: '1 GB Free',
    authMode: 'supabase',
    zeroConsole: true,
    signupUrl: 'https://supabase.com/storage',
    consoleUrl: 'https://supabase.com/dashboard/projects',
    scopes: ['storage.buckets.readwrite'],
    description: '1 GB free storage per Supabase project via Project URL & API Key.',
  },
];

// Stateless signed OAuth state so OAuth redirects work even across serverless Lambda instances!
const STATE_SECRET = crypto
  .createHash('sha256')
  .update(process.env.CLOUDY_OAUTH_STATE_SECRET || 'xkilo-cloudy-stateless-oauth-v2')
  .digest();

export function getProviderMeta(providerId) {
  if (providerId === 'xkilo_core') {
    return {
      id: 'xkilo_core',
      name: 'Local Device Vault',
      freeBytes: 5 * 1024 * 1024 * 1024,
      freeLabel: 'Built-In',
      authMode: 'builtin',
      description: 'Built-in Cloudy local & offline storage vault.',
    };
  }
  return FREE_PROVIDER_CATALOG.find((p) => p.id === providerId) || null;
}

function encodeSignedState(payload) {
  const dataB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(dataB64).digest('base64url');
  return `${dataB64}.${sig}`;
}

function decodeSignedState(stateStr) {
  if (!stateStr || !stateStr.includes('.')) return null;
  const [dataB64, sig] = stateStr.split('.');
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(dataB64).digest('base64url');
  if (sig !== expected) return null;
  const parsed = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8'));
  if (Date.now() - parsed.ts > 20 * 60 * 1000) return null;
  return parsed;
}

export function buildUpstreamOAuthUrl(
  provider,
  oauthConfig,
  redirectUri,
  vaultId = 'default',
  scopeMode = 'default'
) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const state = encodeSignedState({
    pid: provider.id,
    v: verifier,
    r: redirectUri,
    vid: vaultId,
    cid: oauthConfig.clientId,
    cs: oauthConfig.clientSecret || '',
    ts: Date.now(),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  const chosenScopes =
    scopeMode === 'full' && provider.fullScopes?.length
      ? provider.fullScopes
      : provider.scopes;

  if (chosenScopes?.length) {
    url.searchParams.set('scope', chosenScopes.join(' '));
  }
  if (provider.extraAuthParams) {
    for (const [k, v] of Object.entries(provider.extraAuthParams)) {
      url.searchParams.set(k, v);
    }
  }
  if (['google_drive', 'dropbox', 'onedrive'].includes(provider.id)) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { authorizeUrl: url.toString(), state };
}

export async function exchangeOAuthCode(stateStr, code, getOAuthConfig) {
  const pending = decodeSignedState(stateStr);
  if (!pending) {
    throw new Error('Invalid or expired OAuth state token. Please try connecting again.');
  }

  const provider = getProviderMeta(pending.pid);
  const fallbackCfg = getOAuthConfig ? getOAuthConfig(pending.pid) : null;
  const clientId = pending.cid || fallbackCfg?.clientId;
  const clientSecret = pending.cs || fallbackCfg?.clientSecret || '';

  if (!provider || !clientId || !provider.tokenUrl) {
    throw new Error('Missing OAuth Client ID or token endpoint for token exchange.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: pending.r,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  if (['google_drive', 'dropbox', 'onedrive'].includes(provider.id)) {
    body.set('code_verifier', pending.v);
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
    throw new Error(`Upstream OAuth token exchange failed (${res.status}): ${errText}`);
  }

  const tokenData = await res.json();
  if (tokenData.error) {
    throw new Error(`OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  return {
    providerId: provider.id,
    vaultId: pending.vid || 'default',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
    clientId,
    clientSecret,
  };
}
