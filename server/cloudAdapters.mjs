import crypto from 'crypto';
import { Storage as MegaStorage } from 'megajs';

// --- AES-256-GCM Credential Sealing so tokens survive serverless cold starts securely ---
const VAULT_SECRET = crypto
  .createHash('sha256')
  .update(process.env.CLOUDY_VAULT_SECRET || 'xkilo-cloudy-aes256-vault-key-v2')
  .digest();

export function sealCredentials(credsObj) {
  if (!credsObj) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_SECRET, iv);
  const json = Buffer.from(JSON.stringify(credsObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function unsealCredentials(sealed) {
  if (!sealed || typeof sealed !== 'string') return null;
  try {
    const [ivB64, tagB64, dataB64] = sealed.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      VAULT_SECRET,
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return null;
  }
}

// --- Pure Node Crypto AWS Signature V4 Helper (for Cloudflare R2, Backblaze B2, Storj) ---
function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function s3SignedFetch({
  endpoint,
  region = 'auto',
  accessKeyId,
  secretAccessKey,
  bucket,
  key = '',
  method = 'GET',
  query = {},
  body = Buffer.alloc(0),
  contentType = '',
}) {
  const base = endpoint.replace(/\/+$/, '');
  const cleanKey = key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : '';
  const url = new URL(`${base}/${encodeURIComponent(bucket)}${cleanKey}`);
  const sortedQueryKeys = Object.keys(query).sort();
  for (const k of sortedQueryKeys) {
    url.searchParams.set(k, query[k]);
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((h) => `${h}:${headers[h].trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalQuery = sortedQueryKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url.toString(), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : body,
  });
}

// --- Google Service Account RS256 JWT Assertion Minter (Zero OAuth Consent Screen, Never Expires) ---
async function mintGoogleServiceAccountToken(sa) {
  const nowSec = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimB64 = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  ).toString('base64url');

  const unsigned = `${headerB64}.${claimB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sigB64 = signer.sign(sa.private_key).toString('base64url');
  const assertion = `${unsigned}.${sigB64}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Service Account token error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3500) * 1000,
  };
}

// Smart parser for raw token, OAuth Playground JSON, rclone JSON, or Google Service Account JSON
async function normalizeSmartTokenInput(rawCreds = {}) {
  const out = { ...rawCreds };
  const candidate = (rawCreds.smartPayload || rawCreds.accessToken || '').trim();
  if (candidate.startsWith('{') || candidate.includes('"access_token"') || candidate.includes('"private_key"')) {
    const startIdx = candidate.indexOf('{');
    const endIdx = candidate.lastIndexOf('}');
    const jsonSlice = startIdx >= 0 && endIdx > startIdx ? candidate.slice(startIdx, endIdx + 1) : candidate;
    const parsed = JSON.parse(jsonSlice);

    if (parsed.type === 'service_account' && parsed.client_email && parsed.private_key) {
      const minted = await mintGoogleServiceAccountToken(parsed);
      return {
        serviceAccount: {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
        },
        accessToken: minted.accessToken,
        expiresAt: minted.expiresAt,
      };
    }

    out.accessToken = parsed.access_token || parsed.accessToken || out.accessToken;
    out.refreshToken = parsed.refresh_token || parsed.refreshToken || out.refreshToken;
    if (parsed.expires_in) {
      out.expiresAt = Date.now() + Number(parsed.expires_in) * 1000;
    } else if (parsed.expiry) {
      const ts = Date.parse(parsed.expiry);
      if (!Number.isNaN(ts)) out.expiresAt = ts;
    }
  }
  return out;
}

// --- Silent OAuth 2.0 / Service Account Token Refresh ---
export async function getValidOAuthToken(account, getOAuthConfig, onTokensUpdated) {
  const creds = account.credentials || unsealCredentials(account.sealedCredentials) || {};

  // Auto-refresh Google Service Account JWT when near expiry
  if (creds.serviceAccount) {
    const notExpired = creds.accessToken && creds.expiresAt && Date.now() < creds.expiresAt - 60_000;
    if (notExpired) return creds.accessToken;
    const minted = await mintGoogleServiceAccountToken(creds.serviceAccount);
    const updated = { ...creds, accessToken: minted.accessToken, expiresAt: minted.expiresAt };
    if (onTokensUpdated) onTokensUpdated(updated);
    return updated.accessToken;
  }

  if (!creds.accessToken) {
    throw new Error(`Missing access token for ${account.providerName}`);
  }
  const notExpired = !creds.expiresAt || Date.now() < creds.expiresAt - 60_000;
  if (notExpired || !creds.refreshToken) {
    return creds.accessToken;
  }

  const tokenUrls = {
    google_drive: 'https://oauth2.googleapis.com/token',
    dropbox: 'https://api.dropboxapi.com/oauth2/token',
    onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    box: 'https://api.box.com/oauth2/token',
  };

  const tokenUrl = tokenUrls[account.providerId];
  const appCfg = getOAuthConfig ? getOAuthConfig(account.providerId) : null;
  const clientId = creds.clientId || appCfg?.clientId;
  const clientSecret = creds.clientSecret || appCfg?.clientSecret || '';

  if (!tokenUrl || !clientId) {
    return creds.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: clientId,
  });
  if (clientSecret) params.set('client_secret', clientSecret);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: params.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const updatedCreds = {
    ...creds,
    accessToken: data.access_token || creds.accessToken,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : creds.expiresAt,
  };
  if (onTokensUpdated) onTokensUpdated(updatedCreds);
  return updatedCreds.accessToken;
}

// --- Verify Credentials & Fetch Real Quota / User Info ---
export async function verifyAndInspectProvider(providerId, inputCreds) {
  const rawCreds = ['google_drive', 'dropbox', 'onedrive', 'box'].includes(providerId)
    ? await normalizeSmartTokenInput(inputCreds)
    : inputCreds;

  // 1. Google Drive (OAuth2, Playground JSON, rclone JSON, or Service Account JSON)
  if (providerId === 'google_drive') {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)',
      { headers: { Authorization: `Bearer ${rawCreds.accessToken}` } }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Drive verification failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    const limit = Number(data.storageQuota?.limit || 15 * 1024 ** 3);
    const usage = Number(data.storageQuota?.usage || 0);
    const email = rawCreds.serviceAccount?.client_email || data.user?.emailAddress || 'google-drive-user';
    return {
      email,
      accountLabel: data.user?.displayName ? `Google Drive (${data.user.displayName})` : `Google Drive (${email})`,
      quotaBytes: limit,
      usedBytes: usage,
      credentials: rawCreds,
    };
  }

  // 2. Dropbox (OAuth2)
  if (providerId === 'dropbox') {
    const [accRes, spaceRes] = await Promise.all([
      fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawCreds.accessToken}` },
      }),
      fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawCreds.accessToken}` },
      }),
    ]);
    if (!accRes.ok) {
      const err = await accRes.text();
      throw new Error(`Dropbox verification failed (${accRes.status}): ${err}`);
    }
    const acc = await accRes.json();
    const space = spaceRes.ok ? await spaceRes.json() : {};
    const allocated = Number(space.allocation?.allocated || 2 * 1024 ** 3);
    const used = Number(space.used || 0);
    return {
      email: acc.email || 'dropbox-user',
      accountLabel: acc.name?.display_name ? `Dropbox (${acc.name.display_name})` : 'Dropbox',
      quotaBytes: allocated,
      usedBytes: used,
      credentials: rawCreds,
    };
  }

  // 3. Microsoft OneDrive (OAuth2 Graph API)
  if (providerId === 'onedrive') {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { Authorization: `Bearer ${rawCreds.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OneDrive verification failed (${res.status}): ${err}`);
    }
    const drive = await res.json();
    return {
      email: drive.owner?.user?.email || drive.owner?.user?.displayName || 'onedrive-user',
      accountLabel: drive.owner?.user?.displayName
        ? `OneDrive (${drive.owner.user.displayName})`
        : 'Microsoft OneDrive',
      quotaBytes: Number(drive.quota?.total || 5 * 1024 ** 3),
      usedBytes: Number(drive.quota?.used || 0),
      credentials: rawCreds,
    };
  }

  // 4. Box (OAuth2)
  if (providerId === 'box') {
    const res = await fetch('https://api.box.com/2.0/users/me', {
      headers: { Authorization: `Bearer ${rawCreds.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Box verification failed (${res.status}): ${err}`);
    }
    const me = await res.json();
    return {
      email: me.login || 'box-user',
      accountLabel: me.name ? `Box (${me.name})` : 'Box',
      quotaBytes: Number(me.space_amount || 10 * 1024 ** 3),
      usedBytes: Number(me.space_used || 0),
      credentials: rawCreds,
    };
  }

  // 5. pCloud (Direct Email + Password getauth=1 OR OAuth2 US / EU — Zero Developer Console!)
  if (providerId === 'pcloud') {
    // Mode A: Direct Email + Password login (no OAuth app required!)
    if (rawCreds.email && rawCreds.password) {
      for (const host of ['https://api.pcloud.com', 'https://eapi.pcloud.com']) {
        const body = new URLSearchParams({
          getauth: '1',
          logout: '1',
          username: rawCreds.email.trim(),
          password: rawCreds.password,
        });
        if (rawCreds.mfaCode) body.set('code', rawCreds.mfaCode.trim());
        const res = await fetch(`${host}/userinfo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (res.ok) {
          const info = await res.json();
          if (info.result === 0 && info.auth) {
            return {
              email: info.email || rawCreds.email.trim(),
              accountLabel: `pCloud (${info.email || rawCreds.email.trim()})`,
              quotaBytes: Number(info.quota || 10 * 1024 ** 3),
              usedBytes: Number(info.usedquota || 0),
              credentials: { authToken: info.auth, apiHost: host },
            };
          }
        }
      }
      throw new Error('pCloud login failed. Check your email, password, or 2FA code.');
    }

    // Mode B: OAuth token / auth token
    const tok = rawCreds.authToken || rawCreds.accessToken;
    for (const host of ['https://api.pcloud.com', 'https://eapi.pcloud.com']) {
      const url = rawCreds.authToken
        ? `${host}/userinfo?auth=${encodeURIComponent(rawCreds.authToken)}`
        : `${host}/userinfo`;
      const res = await fetch(url, {
        headers: rawCreds.authToken ? {} : { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const info = await res.json();
        if (info.result === 0) {
          return {
            email: info.email || 'pcloud-user',
            accountLabel: `pCloud (${info.email || 'Connected'})`,
            quotaBytes: Number(info.quota || 10 * 1024 ** 3),
            usedBytes: Number(info.usedquota || 0),
            credentials: { ...rawCreds, apiHost: host },
          };
        }
      }
    }
    throw new Error('pCloud verification failed on both US and EU endpoints.');
  }

  // 6. GitHub Cloud Vault (OAuth2 or Personal Access Token -> Real Private Repo)
  if (providerId === 'github_vault') {
    const ghHeaders = {
      Authorization: `Bearer ${rawCreds.accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Cloudy-XKilo-Vault',
    };
    const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
    if (!userRes.ok) {
      const err = await userRes.text();
      throw new Error(`GitHub authentication failed (${userRes.status}): ${err}`);
    }
    const user = await userRes.json();
    const repoName = (rawCreds.repoName || 'cloudy-vault').trim().replace(/[^a-zA-Z0-9._-]/g, '-');

    // Ensure repository exists (or create private vault repo)
    let repoRes = await fetch(`https://api.github.com/repos/${user.login}/${repoName}`, {
      headers: ghHeaders,
    });
    if (repoRes.status === 404) {
      repoRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          description: 'Cloudy by X-Kilo Private Storage Vault',
          private: true,
          auto_init: true,
        }),
      });
    }
    if (!repoRes.ok) {
      const err = await repoRes.text();
      throw new Error(
        `Authenticated as @${user.login}, but failed to access/create repo "${repoName}" (ensure token has "repo" scope): ${err}`
      );
    }
    const repoInfo = await repoRes.json();
    return {
      email: `${user.login}@github.com`,
      accountLabel: `GitHub (${user.login}/${repoName})`,
      quotaBytes: 5 * 1024 ** 3,
      usedBytes: Number(repoInfo.size || 0) * 1024,
      credentials: {
        accessToken: rawCreds.accessToken,
        owner: user.login,
        repo: repoName,
        defaultBranch: repoInfo.default_branch || 'main',
      },
    };
  }

  // 7. MEGA (Real 20 GB Encrypted Cloud via megajs)
  if (providerId === 'mega') {
    if (!rawCreds.email || (!rawCreds.password && !rawCreds.sessionDump)) {
      throw new Error('MEGA email and password are required to authenticate your MEGA account.');
    }
    const storage = rawCreds.sessionDump
      ? MegaStorage.fromJSON(rawCreds.sessionDump)
      : new MegaStorage({
          email: rawCreds.email.trim(),
          password: rawCreds.password,
          secondFactorCode: rawCreds.mfaCode ? String(rawCreds.mfaCode).trim() : undefined,
          keepalive: false,
          autologin: true,
        });

    await storage.ready;
    const info = await storage.getAccountInfo();
    const sessionDump = storage.dump();
    if (typeof storage.close === 'function') storage.close();

    return {
      email: rawCreds.email.trim(),
      accountLabel: `MEGA (${rawCreds.email.trim()})`,
      quotaBytes: Number(info.spaceTotal || 20 * 1024 ** 3),
      usedBytes: Number(info.spaceUsed || 0),
      // Store ONLY encrypted sessionDump — never plaintext password!
      credentials: {
        email: rawCreds.email.trim(),
        sessionDump,
      },
    };
  }

  // 8. S3-Compatible Clouds: Cloudflare R2, Backblaze B2, Storj
  if (['cloudflare_r2', 'backblaze_b2', 'storj'].includes(providerId)) {
    const { endpoint, accessKeyId, secretAccessKey, bucket, region = 'auto' } = rawCreds;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('Endpoint URL, Access Key ID, Secret Access Key, and Bucket Name are required.');
    }
    const res = await s3SignedFetch({
      endpoint,
      region,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      bucket: bucket.trim(),
      method: 'GET',
      query: { 'list-type': '2', 'max-keys': '200' },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`S3 bucket verification failed (${res.status}): ${txt.slice(0, 240)}`);
    }
    const xml = await res.text();
    let used = 0;
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      used += Number(m[1] || 0);
    }
    const defaultFree =
      providerId === 'storj' ? 25 * 1024 ** 3 : 10 * 1024 ** 3;
    return {
      email: `${bucket.trim()}@${providerId}`,
      accountLabel: `${bucket.trim()} (${providerId.replace('_', ' ').toUpperCase()})`,
      quotaBytes: defaultFree,
      usedBytes: used,
      credentials: {
        endpoint: endpoint.trim().replace(/\/+$/, ''),
        region: region || 'auto',
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        bucket: bucket.trim(),
      },
    };
  }

  // 9. WebDAV Clouds: Koofr, Yandex Disk, Nextcloud
  if (['koofr', 'yandex_disk', 'nextcloud'].includes(providerId)) {
    const defaultUrls = {
      koofr: 'https://app.koofr.net/dav/Koofr',
      yandex_disk: 'https://webdav.yandex.com',
    };
    const webdavUrl = (rawCreds.webdavUrl || defaultUrls[providerId] || '').trim().replace(/\/+$/, '');
    if (!webdavUrl || !rawCreds.username || !rawCreds.password) {
      throw new Error('WebDAV URL, Username/Email, and App Password are required.');
    }
    const basic = Buffer.from(`${rawCreds.username.trim()}:${rawCreds.password}`).toString('base64');
    const propBody = `<?xml version="1.0" encoding="utf-8" ?>
      <D:propfind xmlns:D="DAV:">
        <D:prop><D:quota-available-bytes/><D:quota-used-bytes/></D:prop>
      </D:propfind>`;

    const res = await fetch(`${webdavUrl}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${basic}`,
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: propBody,
    });
    if (!res.ok && res.status !== 207) {
      throw new Error(`WebDAV authentication failed (HTTP ${res.status}). Check your username & app password.`);
    }
    const xml = await res.text();
    const usedMatch = xml.match(/quota-used-bytes[^>]*>(\d+)</i);
    const availMatch = xml.match(/quota-available-bytes[^>]*>(\d+)</i);
    const used = usedMatch ? Number(usedMatch[1]) : 0;
    const avail = availMatch ? Number(availMatch[1]) : 10 * 1024 ** 3;
    return {
      email: rawCreds.username.trim(),
      accountLabel: `${providerId.replace('_', ' ')} (${rawCreds.username.trim()})`,
      quotaBytes: used + Math.max(avail, 0),
      usedBytes: used,
      credentials: {
        webdavUrl,
        username: rawCreds.username.trim(),
        password: rawCreds.password,
      },
    };
  }

  // 10. Supabase Storage (Real Supabase Bucket REST API)
  if (providerId === 'supabase_storage') {
    const projectUrl = (rawCreds.projectUrl || '').trim().replace(/\/+$/, '');
    const apiKey = (rawCreds.apiKey || '').trim();
    const bucket = (rawCreds.bucket || 'cloudy-vault').trim();
    if (!projectUrl || !apiKey) {
      throw new Error('Supabase Project URL and Service Role Key are required.');
    }
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
    };
    const bRes = await fetch(`${projectUrl}/storage/v1/bucket`, { headers });
    if (!bRes.ok) {
      const txt = await bRes.text();
      throw new Error(`Supabase Storage verification failed (${bRes.status}): ${txt}`);
    }
    const buckets = await bRes.json();
    const exists = Array.isArray(buckets) && buckets.some((b) => b.name === bucket || b.id === bucket);
    if (!exists) {
      await fetch(`${projectUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false }),
      });
    }
    const hostLabel = new URL(projectUrl).hostname.split('.')[0];
    return {
      email: `${hostLabel}@supabase.co`,
      accountLabel: `Supabase (${hostLabel}/${bucket})`,
      quotaBytes: 1 * 1024 ** 3,
      usedBytes: 0,
      credentials: { projectUrl, apiKey, bucket },
    };
  }

  throw new Error(`Unsupported provider "${providerId}"`);
}

// --- Upload Real Binary File to Connected Upstream Cloud Provider ---
export async function uploadFileToRemoteProvider(
  account,
  fileName,
  buffer,
  mimeType,
  getOAuthConfig,
  onTokensUpdated
) {
  const providerId = account.providerId;
  if (providerId === 'xkilo_core') return null;

  const creds = account.credentials || unsealCredentials(account.sealedCredentials) || {};
  const safeName = fileName.replace(/[/\\]/g, '_');

  if (providerId === 'google_drive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const boundary = `cloudy_${crypto.randomBytes(8).toString('hex')}`;
    const meta = JSON.stringify({ name: safeName, mimeType });
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        'utf8'
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--`, 'utf8'),
    ]);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}): ${await res.text()}`);
    const out = await res.json();
    return { remoteId: out.id, remotePath: out.name, webUrl: out.webViewLink || null };
  }

  if (providerId === 'dropbox') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const remotePath = `/Cloudy/${Date.now()}_${safeName}`;
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: remotePath, mode: 'overwrite', autorename: true }),
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(`Dropbox upload failed (${res.status}): ${await res.text()}`);
    const out = await res.json();
    return { remoteId: out.id, remotePath: out.path_display || remotePath };
  }

  if (providerId === 'onedrive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const remotePath = `Cloudy/${Date.now()}_${safeName}`;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(remotePath)}:/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
        body: buffer,
      }
    );
    if (!res.ok) throw new Error(`OneDrive upload failed (${res.status}): ${await res.text()}`);
    const out = await res.json();
    return { remoteId: out.id, remotePath, webUrl: out.webUrl || null };
  }

  if (providerId === 'box') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const fd = new FormData();
    fd.append('attributes', JSON.stringify({ name: `${Date.now()}_${safeName}`, parent: { id: '0' } }));
    fd.append('file', new Blob([buffer], { type: mimeType }), safeName);
    const res = await fetch('https://upload.box.com/api/2.0/files/content', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`Box upload failed (${res.status}): ${await res.text()}`);
    const out = await res.json();
    const entry = out.entries?.[0];
    return { remoteId: entry?.id, remotePath: entry?.name };
  }

  if (providerId === 'pcloud') {
    const host = creds.apiHost || 'https://api.pcloud.com';
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: mimeType }), safeName);
    const authQs = creds.authToken ? `&auth=${encodeURIComponent(creds.authToken)}` : '';
    const res = await fetch(`${host}/uploadfile?folderid=0&nopartial=1${authQs}`, {
      method: 'POST',
      headers: creds.authToken ? {} : { Authorization: `Bearer ${creds.accessToken}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`pCloud upload failed (${res.status})`);
    const out = await res.json();
    if (out.result !== 0) throw new Error(`pCloud upload error: ${out.error || out.result}`);
    const fileId = out.fileids?.[0];
    return { remoteId: String(fileId || ''), remotePath: safeName };
  }

  if (providerId === 'github_vault') {
    const remotePath = `cloudy/${Date.now()}_${safeName}`;
    const res = await fetch(
      `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${encodeURI(remotePath)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Cloudy-XKilo-Vault',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Upload ${safeName} via Cloudy`,
          content: buffer.toString('base64'),
        }),
      }
    );
    if (!res.ok) throw new Error(`GitHub upload failed (${res.status}): ${await res.text()}`);
    const out = await res.json();
    return {
      remoteId: out.content?.sha,
      remotePath,
      webUrl: out.content?.html_url || null,
    };
  }

  if (providerId === 'mega') {
    const storage = MegaStorage.fromJSON(creds.sessionDump);
    await storage.ready;
    try {
      let targetDir = storage.root.children?.find((c) => c.directory && c.name === 'Cloudy');
      if (!targetDir) {
        targetDir = await storage.mkdir('Cloudy');
      }
      const uploaded = await targetDir.upload({ name: safeName, size: buffer.byteLength }, buffer)
        .complete;
      return { remoteId: uploaded.nodeId, remotePath: `/Cloudy/${safeName}` };
    } finally {
      if (typeof storage.close === 'function') storage.close();
    }
  }

  if (['cloudflare_r2', 'backblaze_b2', 'storj'].includes(providerId)) {
    const key = `cloudy/${Date.now()}_${safeName}`;
    const res = await s3SignedFetch({
      ...creds,
      key,
      method: 'PUT',
      body: buffer,
      contentType: mimeType,
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${await res.text()}`);
    return { remoteId: key, remotePath: key };
  }

  if (['koofr', 'yandex_disk', 'nextcloud'].includes(providerId)) {
    const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const remotePath = `Cloudy_${Date.now()}_${safeName}`;
    const res = await fetch(`${creds.webdavUrl}/${encodeURIComponent(remotePath)}`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': mimeType },
      body: buffer,
    });
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`WebDAV upload failed (${res.status})`);
    }
    return { remoteId: remotePath, remotePath };
  }

  if (providerId === 'supabase_storage') {
    const prefix = creds.keyPrefix || '';
    const remotePath = `${prefix}files/${Date.now()}_${safeName}`;
    const res = await fetch(
      `${creds.projectUrl}/storage/v1/object/${creds.bucket}/${encodeURI(remotePath)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          apikey: creds.apiKey,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );
    if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
    return { remoteId: remotePath, remotePath };
  }

  return null;
}

// --- Download Real Binary File from Upstream Cloud Provider ---
export async function downloadFileFromRemoteProvider(
  account,
  fileRecord,
  getOAuthConfig,
  onTokensUpdated
) {
  const providerId = account.providerId;
  const creds = account.credentials || unsealCredentials(account.sealedCredentials) || {};
  const remoteId = fileRecord.remoteId;
  const remotePath = fileRecord.remotePath;
  if (!remoteId && !remotePath) return null;

  if (providerId === 'google_drive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'dropbox') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: remotePath || remoteId }),
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'onedrive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(remoteId)}/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'box') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch(
      `https://api.box.com/2.0/files/${encodeURIComponent(remoteId)}/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'pcloud') {
    const host = creds.apiHost || 'https://api.pcloud.com';
    const authQs = creds.authToken ? `&auth=${encodeURIComponent(creds.authToken)}` : '';
    const linkRes = await fetch(
      `${host}/getfilelink?fileid=${encodeURIComponent(remoteId)}${authQs}`,
      { headers: creds.authToken ? {} : { Authorization: `Bearer ${creds.accessToken}` } }
    );
    if (!linkRes.ok) return null;
    const linkData = await linkRes.json();
    if (linkData.result !== 0 || !linkData.hosts?.[0] || !linkData.path) return null;
    const fileRes = await fetch(`https://${linkData.hosts[0]}${linkData.path}`);
    if (!fileRes.ok) return null;
    return Buffer.from(await fileRes.arrayBuffer());
  }

  if (providerId === 'github_vault') {
    const res = await fetch(
      `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${encodeURI(remotePath)}`,
      {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          Accept: 'application/vnd.github.raw',
          'User-Agent': 'Cloudy-XKilo-Vault',
        },
      }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'mega') {
    const storage = MegaStorage.fromJSON(creds.sessionDump);
    await storage.ready;
    try {
      const target = Object.values(storage.files || {}).find((f) => f.nodeId === remoteId);
      if (!target) return null;
      return await target.downloadBuffer({});
    } finally {
      if (typeof storage.close === 'function') storage.close();
    }
  }

  if (['cloudflare_r2', 'backblaze_b2', 'storj'].includes(providerId)) {
    const res = await s3SignedFetch({
      ...creds,
      key: remotePath || remoteId,
      method: 'GET',
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (['koofr', 'yandex_disk', 'nextcloud'].includes(providerId)) {
    const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const res = await fetch(`${creds.webdavUrl}/${encodeURIComponent(remotePath || remoteId)}`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  if (providerId === 'supabase_storage') {
    const res = await fetch(
      `${creds.projectUrl}/storage/v1/object/${creds.bucket}/${encodeURI(remotePath || remoteId)}`,
      {
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          apikey: creds.apiKey,
        },
      }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  return null;
}

// --- List Existing Remote Files from User's Connected Cloud Account ---
export async function listRemoteProviderFiles(account, getOAuthConfig, onTokensUpdated) {
  const providerId = account.providerId;
  const creds = account.credentials || unsealCredentials(account.sealedCredentials) || {};

  if (providerId === 'google_drive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/files?pageSize=50&q=trashed=false+and+mimeType!='application/vnd.google-apps.folder'&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []).map((f) => ({
      remoteId: f.id,
      remotePath: f.name,
      name: f.name,
      mimeType: f.mimeType || 'application/octet-stream',
      size: Number(f.size || 0),
      updatedAt: f.modifiedTime || new Date().toISOString(),
    }));
  }

  if (providerId === 'dropbox') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: false, limit: 50 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.entries || [])
      .filter((e) => e['.tag'] === 'file')
      .map((e) => ({
        remoteId: e.id,
        remotePath: e.path_lower || e.path_display,
        name: e.name,
        mimeType: 'application/octet-stream',
        size: Number(e.size || 0),
        updatedAt: e.server_modified || new Date().toISOString(),
      }));
  }

  if (providerId === 'onedrive') {
    const token = await getValidOAuthToken(account, getOAuthConfig, onTokensUpdated);
    const res = await fetch('https://graph.microsoft.com/v1.0/me/drive/root/children?$top=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.value || [])
      .filter((item) => item.file)
      .map((item) => ({
        remoteId: item.id,
        remotePath: item.name,
        name: item.name,
        mimeType: item.file?.mimeType || 'application/octet-stream',
        size: Number(item.size || 0),
        updatedAt: item.lastModifiedDateTime || new Date().toISOString(),
      }));
  }

  if (providerId === 'github_vault') {
    const res = await fetch(
      `https://api.github.com/repos/${creds.owner}/${creds.repo}/git/trees/${creds.defaultBranch || 'main'}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Cloudy-XKilo-Vault',
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tree || [])
      .filter((t) => t.type === 'blob')
      .slice(0, 60)
      .map((t) => ({
        remoteId: t.sha,
        remotePath: t.path,
        name: t.path.split('/').pop(),
        mimeType: 'application/octet-stream',
        size: Number(t.size || 0),
        updatedAt: new Date().toISOString(),
      }));
  }

  if (providerId === 'mega') {
    const storage = MegaStorage.fromJSON(creds.sessionDump);
    await storage.ready;
    try {
      const allFiles = Object.values(storage.files || {})
        .filter((f) => !f.directory && f.name)
        .slice(0, 60);
      return allFiles.map((f) => ({
        remoteId: f.nodeId,
        remotePath: f.name,
        name: f.name,
        mimeType: 'application/octet-stream',
        size: Number(f.size || 0),
        updatedAt: f.timestamp ? new Date(f.timestamp * 1000).toISOString() : new Date().toISOString(),
      }));
    } finally {
      if (typeof storage.close === 'function') storage.close();
    }
  }

  if (['cloudflare_r2', 'backblaze_b2', 'storj'].includes(providerId)) {
    const res = await s3SignedFetch({
      ...creds,
      method: 'GET',
      query: { 'list-type': '2', 'max-keys': '60' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const inner = block[1];
      const key = inner.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const size = Number(inner.match(/<Size>(\d+)<\/Size>/)?.[1] || 0);
      if (key && !key.endsWith('/')) {
        items.push({
          remoteId: key,
          remotePath: key,
          name: key.split('/').pop(),
          mimeType: 'application/octet-stream',
          size,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return items;
  }

  if (providerId === 'pcloud') {
    const host = creds.apiHost || 'https://api.pcloud.com';
    const authQs = creds.authToken ? `&auth=${encodeURIComponent(creds.authToken)}` : '';
    const res = await fetch(`${host}/listfolder?folderid=0${authQs}`, {
      headers: creds.authToken ? {} : { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const contents = data.metadata?.contents || [];
    return contents
      .filter((c) => !c.isfolder)
      .slice(0, 60)
      .map((c) => ({
        remoteId: String(c.fileid),
        remotePath: c.name,
        name: c.name,
        mimeType: c.contenttype || 'application/octet-stream',
        size: Number(c.size || 0),
        updatedAt: c.modified ? new Date(c.modified).toISOString() : new Date().toISOString(),
      }));
  }

  return [];
}

// --- Zero-Console Nextcloud 1-Click Login Flow v2 (No OAuth App Required!) ---
export async function initNextcloudLoginFlow(serverUrl) {
  let clean = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }
  // Strip /remote.php/... if user pasted WebDAV URL instead of base URL
  const davIdx = clean.indexOf('/remote.php');
  if (davIdx > 0) clean = clean.slice(0, davIdx);

  const res = await fetch(`${clean}/index.php/login/v2`, {
    method: 'POST',
    headers: { 'User-Agent': 'Cloudy by X-Kilo' },
  });
  if (!res.ok) {
    throw new Error(`Nextcloud Login Flow v2 unavailable on ${clean} (${res.status})`);
  }
  const data = await res.json();
  if (!data.login || !data.poll?.endpoint || !data.poll?.token) {
    throw new Error('Unexpected response from Nextcloud Login Flow v2.');
  }
  return {
    loginUrl: data.login,
    pollEndpoint: data.poll.endpoint,
    pollToken: data.poll.token,
  };
}

export async function pollNextcloudLoginFlow(pollEndpoint, pollToken) {
  const res = await fetch(pollEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: pollToken }).toString(),
  });
  if (res.status === 404) {
    return { pending: true };
  }
  if (!res.ok) {
    throw new Error(`Nextcloud poll failed (${res.status})`);
  }
  const data = await res.json();
  const base = String(data.server || '').replace(/\/+$/, '');
  const webdavUrl = `${base}/remote.php/dav/files/${encodeURIComponent(data.loginName)}`;
  return {
    pending: false,
    credentials: {
      webdavUrl,
      username: data.loginName,
      password: data.appPassword,
    },
  };
}

// --- Multi-Cloud rclone.conf Parser (Connects All Accounts in 1 Click, Zero Console!) ---
export function parseRcloneConfig(confText) {
  const sections = [];
  let current = null;

  for (const rawLine of String(confText || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      current = { name: secMatch[1].trim(), props: {} };
      sections.push(current);
      continue;
    }
    if (current) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim();
        current.props[k] = v;
      }
    }
  }

  const mapped = [];
  for (const sec of sections) {
    const t = (sec.props.type || '').toLowerCase();
    if (t === 'drive') {
      mapped.push({
        sectionName: sec.name,
        providerId: 'google_drive',
        credentials: {
          smartPayload: sec.props.token || sec.props.service_account_credentials || '',
          clientId: sec.props.client_id || '',
          clientSecret: sec.props.client_secret || '',
        },
      });
    } else if (t === 'dropbox') {
      mapped.push({
        sectionName: sec.name,
        providerId: 'dropbox',
        credentials: {
          smartPayload: sec.props.token || '',
          clientId: sec.props.client_id || '',
          clientSecret: sec.props.client_secret || '',
        },
      });
    } else if (t === 'onedrive') {
      mapped.push({
        sectionName: sec.name,
        providerId: 'onedrive',
        credentials: {
          smartPayload: sec.props.token || '',
          clientId: sec.props.client_id || '',
          clientSecret: sec.props.client_secret || '',
        },
      });
    } else if (t === 'box') {
      mapped.push({
        sectionName: sec.name,
        providerId: 'box',
        credentials: {
          smartPayload: sec.props.token || '',
          clientId: sec.props.client_id || '',
          clientSecret: sec.props.client_secret || '',
        },
      });
    } else if (t === 'pcloud') {
      let tok = '';
      try {
        tok = JSON.parse(sec.props.token || '{}').access_token || '';
      } catch {
        tok = sec.props.token || '';
      }
      mapped.push({
        sectionName: sec.name,
        providerId: 'pcloud',
        credentials: {
          accessToken: tok,
          apiHost: sec.props.hostname ? `https://${sec.props.hostname}` : 'https://api.pcloud.com',
        },
      });
    } else if (t === 's3') {
      const ep = sec.props.endpoint || '';
      const pid = ep.includes('r2.cloudflarestorage')
        ? 'cloudflare_r2'
        : ep.includes('backblazeb2')
          ? 'backblaze_b2'
          : 'storj';
      mapped.push({
        sectionName: sec.name,
        providerId: pid,
        credentials: {
          endpoint: ep.startsWith('http') ? ep : `https://${ep}`,
          accessKeyId: sec.props.access_key_id || '',
          secretAccessKey: sec.props.secret_access_key || '',
          bucket: sec.props.bucket || sec.name,
        },
      });
    } else if (t === 'webdav' && sec.props.url && sec.props.user && !sec.props.pass?.startsWith('*')) {
      const u = sec.props.url;
      const pid = u.includes('koofr') ? 'koofr' : u.includes('yandex') ? 'yandex_disk' : 'nextcloud';
      mapped.push({
        sectionName: sec.name,
        providerId: pid,
        credentials: {
          webdavUrl: u,
          username: sec.props.user,
          password: sec.props.pass || '',
        },
      });
    }
  }
  return mapped;
}

// --- 1-Click OAuth 2.0 Device Code Flow (GitHub & Microsoft OneDrive — Zero Secrets, Zero Copy-Paste!) ---
const PUBLIC_DEVICE_CLIENTS = {
  github_vault: {
    clientId: process.env.GITHUB_DEVICE_CLIENT_ID || '178c6fc778ccc68e1d6a',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user',
  },
  onedrive: {
    clientId: process.env.ONEDRIVE_DEVICE_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    deviceCodeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'Files.ReadWrite offline_access User.Read',
  },
};

export async function startPublicDeviceFlow(providerId) {
  const cfg = PUBLIC_DEVICE_CLIENTS[providerId];
  if (!cfg) throw new Error(`Device flow not supported for ${providerId}`);

  const res = await fetch(cfg.deviceCodeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      scope: cfg.scope,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Device code request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || data.verification_url,
    interval: Number(data.interval || 5),
  };
}

export async function pollPublicDeviceFlow(providerId, deviceCode) {
  const cfg = PUBLIC_DEVICE_CLIENTS[providerId];
  if (!cfg) throw new Error(`Device flow not supported for ${providerId}`);

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (data.error) {
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return { pending: true };
    }
    throw new Error(data.error_description || data.error);
  }

  return {
    pending: false,
    credentials: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
      clientId: cfg.clientId,
      repoName: 'cloudy-vault',
    },
  };
}


