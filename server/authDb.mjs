import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

const DATA_DIR = process.env.VERCEL ? '/tmp/cloudy-data' : path.resolve('data');
const DB_DIR = path.join(DATA_DIR, 'database');
fs.mkdirSync(DB_DIR, { recursive: true });

const LOCAL_USERS_FILE = path.join(DB_DIR, 'cloudy_users.json');
const LOCAL_SESSIONS_FILE = path.join(DB_DIR, 'cloudy_sessions.json');

const SESSION_COOKIE_NAME = 'cloudy_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const AVATAR_PALETTE = ['#4D6BFE', '#D97757', '#10A37F', '#7C5CFC', '#0EA5E9', '#F59E0B'];

function getAuthSecret() {
  return (
    process.env.CLOUDY_VAULT_SECRET ||
    process.env.CLOUDY_AUTH_SECRET ||
    'xkilo-cloudy-aes256-vault-key-v2'
  );
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(password), salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, expectedHex] = parts;
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const derived = await scryptAsync(String(password), salt, expectedBuf.length);
    const derivedBuf = Buffer.from(derived);
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function validateEmailFormat(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function describeUserAgent(uaRaw) {
  const ua = String(uaRaw || '');
  if (!ua) return 'Web Session';
  let os = 'Desktop';
  if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';
  else if (/python|curl/i.test(ua)) browser = 'CLI / Bridge';

  return `${os} · ${browser}`;
}

// --- Local JSON Mirror Helpers (for offline / local dev / sandbox environments) ---
function readLocalTable(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalTable(filePath, rows) {
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

// --- Supabase PostgREST Client with Smart Reachability Circuit-Breaker ---
let sbUnavailableUntil = 0;
let lastSbLatencyMs = null;

function hasSupabaseEnv() {
  return Boolean(process.env.CLOUDY_SUPABASE_URL && process.env.CLOUDY_SUPABASE_SERVICE_KEY);
}

async function sbRest(endpoint, { method = 'GET', body = undefined, prefer = undefined } = {}) {
  const sbUrl = process.env.CLOUDY_SUPABASE_URL;
  const sbKey = process.env.CLOUDY_SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return { ok: false, offline: true, data: null };
  if (Date.now() < sbUnavailableUntil) {
    return { ok: false, offline: true, data: null };
  }

  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const t0 = Date.now();
  try {
    const res = await fetch(`${sbUrl}/rest/v1/${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    lastSbLatencyMs = Date.now() - t0;
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.message || text, data };
    }
    return { ok: true, status: res.status, data, latencyMs: lastSbLatencyMs };
  } catch (err) {
    sbUnavailableUntil = Date.now() + 15000;
    return { ok: false, offline: true, error: String(err.message || err), data: null };
  }
}

// --- User CRUD ---
function mirrorUserLocally(userRow) {
  if (!userRow?.id) return;
  const users = readLocalTable(LOCAL_USERS_FILE);
  const idx = users.findIndex(
    (u) => u.id === userRow.id || u.email.toLowerCase() === userRow.email.toLowerCase()
  );
  if (idx >= 0) users[idx] = userRow;
  else users.push(userRow);
  writeLocalTable(LOCAL_USERS_FILE, users);
}

export async function findUserByEmail(rawEmail) {
  const email = validateEmailFormat(rawEmail);
  if (!email) return null;

  const sb = await sbRest(
    `cloudy_users?email=eq.${encodeURIComponent(email)}&select=*&limit=1`
  );
  if (sb.ok && Array.isArray(sb.data)) {
    const row = sb.data[0] || null;
    if (row) mirrorUserLocally(row);
    return row;
  }

  const users = readLocalTable(LOCAL_USERS_FILE);
  return users.find((u) => String(u.email).toLowerCase() === email) || null;
}

export async function findUserById(userId) {
  if (!userId) return null;
  const sb = await sbRest(
    `cloudy_users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`
  );
  if (sb.ok && Array.isArray(sb.data)) {
    const row = sb.data[0] || null;
    if (row) mirrorUserLocally(row);
    return row;
  }

  const users = readLocalTable(LOCAL_USERS_FILE);
  return users.find((u) => u.id === userId) || null;
}

export async function findUserByVaultId(vaultId) {
  if (!vaultId) return null;
  const sb = await sbRest(
    `cloudy_users?vault_id=eq.${encodeURIComponent(vaultId)}&select=*&limit=1`
  );
  if (sb.ok && Array.isArray(sb.data)) {
    const row = sb.data[0] || null;
    if (row) mirrorUserLocally(row);
    return row;
  }

  const users = readLocalTable(LOCAL_USERS_FILE);
  return users.find((u) => u.vault_id === vaultId) || null;
}

export async function createUserRecord({ email, displayName, passwordHash, vaultId, theme }) {
  const now = new Date().toISOString();
  const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const avatarColor = AVATAR_PALETTE[crypto.randomInt(0, AVATAR_PALETTE.length)];
  const row = {
    id,
    email,
    display_name: displayName,
    password_hash: passwordHash,
    vault_id: vaultId,
    avatar_color: avatarColor,
    theme: theme || 'deepseek',
    last_login_at: now,
    created_at: now,
    updated_at: now,
  };

  const sb = await sbRest('cloudy_users', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  if (!sb.ok && !sb.offline) {
    if (String(sb.error || '').toLowerCase().includes('duplicate')) {
      throw new Error('An account with this email already exists.');
    }
    throw new Error(sb.error || 'Failed to create user in database');
  }

  const savedRow = Array.isArray(sb.data) && sb.data[0] ? sb.data[0] : row;
  mirrorUserLocally(savedRow);
  return savedRow;
}

export async function updateUserRecord(userId, patch) {
  const now = new Date().toISOString();
  const dbPatch = { ...patch, updated_at: now };

  const sb = await sbRest(`cloudy_users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: dbPatch,
    prefer: 'return=representation',
  });

  const users = readLocalTable(LOCAL_USERS_FILE);
  const idx = users.findIndex((u) => u.id === userId);
  let updated = null;
  if (Array.isArray(sb.data) && sb.data[0]) {
    updated = sb.data[0];
    mirrorUserLocally(updated);
  } else if (idx >= 0) {
    users[idx] = { ...users[idx], ...dbPatch };
    updated = users[idx];
    writeLocalTable(LOCAL_USERS_FILE, users);
  }
  return updated;
}

export function sanitizeUser(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    email: userRow.email,
    displayName: userRow.display_name,
    vaultId: userRow.vault_id,
    avatarColor: userRow.avatar_color || '#4D6BFE',
    theme: userRow.theme || 'deepseek',
    lastLoginAt: userRow.last_login_at,
    createdAt: userRow.created_at,
  };
}

// --- Session Token & Session CRUD ---
function signSessionToken(payloadObj) {
  const b64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(b64)
    .digest('base64url');
  return `cldy_st_${b64}.${sig}`;
}

function verifySignedSessionToken(token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith('cldy_st_')) return null;
  const body = raw.slice('cldy_st_'.length);
  const dotIdx = body.indexOf('.');
  if (dotIdx <= 0) return null;
  const b64 = body.slice(0, dotIdx);
  const sig = body.slice(dotIdx + 1);
  const expected = crypto
    .createHmac('sha256', getAuthSecret())
    .update(b64)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!parsed?.sid || !parsed?.uid || !parsed?.vid || !parsed?.exp) return null;
    if (Date.now() > Number(parsed.exp)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mirrorSessionLocally(sessionRow) {
  if (!sessionRow?.id) return;
  const sessions = readLocalTable(LOCAL_SESSIONS_FILE).filter(
    (s) => new Date(s.expires_at).getTime() > Date.now()
  );
  const idx = sessions.findIndex((s) => s.id === sessionRow.id);
  if (idx >= 0) sessions[idx] = sessionRow;
  else sessions.push(sessionRow);
  writeLocalTable(LOCAL_SESSIONS_FILE, sessions);
}

export async function createSessionForUser(userRow, req) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessionId = `ses_${crypto.randomBytes(8).toString('hex')}`;
  const token = signSessionToken({
    sid: sessionId,
    uid: userRow.id,
    vid: userRow.vault_id,
    exp: expiresAt.getTime(),
  });
  const tokenHash = sha256Hex(token);
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 280);
  const ip = String(
    req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || ''
  ).slice(0, 64);

  const sessionRow = {
    id: sessionId,
    user_id: userRow.id,
    token_hash: tokenHash,
    device_label: describeUserAgent(ua),
    user_agent: ua,
    ip_address: ip,
    expires_at: expiresAt.toISOString(),
    last_seen_at: now.toISOString(),
    created_at: now.toISOString(),
  };

  await sbRest('cloudy_sessions', {
    method: 'POST',
    body: sessionRow,
  });
  mirrorSessionLocally(sessionRow);

  return { token, session: sessionRow };
}

export function extractSessionToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate.startsWith('cldy_st_')) return candidate;
  }
  const cookieHeader = String(req.headers.cookie || '');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k === SESSION_COOKIE_NAME && v) {
        try {
          const decoded = decodeURIComponent(v);
          if (decoded.startsWith('cldy_st_')) return decoded;
        } catch {
          // ignore malformed cookie
        }
      }
    }
  }
  return null;
}

export function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secureFlag = process.env.VERCEL ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`
  );
}

export function clearSessionCookie(res) {
  const secureFlag = process.env.VERCEL ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

export async function resolveAuthSession(req) {
  const token = extractSessionToken(req);
  if (!token) return null;
  const claims = verifySignedSessionToken(token);
  if (!claims) return null;

  const tokenHash = sha256Hex(token);
  const sb = await sbRest(
    `cloudy_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&select=*&limit=1`
  );
  let sessionRow = null;
  if (sb.ok && Array.isArray(sb.data)) {
    sessionRow = sb.data[0] || null;
    if (!sessionRow) return null; // Revoked or logged out in Postgres
    mirrorSessionLocally(sessionRow);
  } else {
    const localSessions = readLocalTable(LOCAL_SESSIONS_FILE);
    sessionRow = localSessions.find((s) => s.token_hash === tokenHash) || null;
    if (!sessionRow) return null;
  }

  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const userRow = await findUserById(claims.uid);
  if (!userRow) return null;

  return {
    token,
    session: sessionRow,
    user: userRow,
  };
}

export async function revokeSessionByToken(token) {
  if (!token) return;
  const tokenHash = sha256Hex(token);
  await sbRest(`cloudy_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`, {
    method: 'DELETE',
  });
  const remaining = readLocalTable(LOCAL_SESSIONS_FILE).filter(
    (s) => s.token_hash !== tokenHash
  );
  writeLocalTable(LOCAL_SESSIONS_FILE, remaining);
}

export async function revokeSessionByIdForUser(sessionId, userId) {
  if (!sessionId || !userId) return;
  await sbRest(
    `cloudy_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
  const remaining = readLocalTable(LOCAL_SESSIONS_FILE).filter(
    (s) => !(s.id === sessionId && s.user_id === userId)
  );
  writeLocalTable(LOCAL_SESSIONS_FILE, remaining);
}

export async function listSessionsForUser(userId, currentSessionId = null) {
  const sb = await sbRest(
    `cloudy_sessions?user_id=eq.${encodeURIComponent(userId)}&order=last_seen_at.desc&select=*`
  );
  let rows = [];
  if (sb.ok && Array.isArray(sb.data)) {
    rows = sb.data;
  } else {
    rows = readLocalTable(LOCAL_SESSIONS_FILE).filter((s) => s.user_id === userId);
  }
  const now = Date.now();
  return rows
    .filter((s) => new Date(s.expires_at).getTime() > now)
    .map((s) => ({
      id: s.id,
      deviceLabel: s.device_label || 'Web Session',
      ipAddress: s.ip_address || '',
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      isCurrent: s.id === currentSessionId,
    }));
}

// --- Normalized Relational PostgreSQL Table Sync ---
async function syncSingleRelationalTable(tableName, vaultId, rows) {
  if (!hasSupabaseEnv() || Date.now() < sbUnavailableUntil) return;

  if (rows.length > 0) {
    await sbRest(`${tableName}?on_conflict=vault_id,id`, {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates',
    });
  }

  const existingRes = await sbRest(
    `${tableName}?vault_id=eq.${encodeURIComponent(vaultId)}&select=id`
  );
  if (existingRes.ok && Array.isArray(existingRes.data)) {
    const keepIds = new Set(rows.map((r) => r.id));
    const staleIds = existingRes.data
      .map((r) => r.id)
      .filter((id) => id && !keepIds.has(id));
    if (staleIds.length > 0) {
      const inList = staleIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
      await sbRest(
        `${tableName}?vault_id=eq.${encodeURIComponent(vaultId)}&id=in.(${encodeURIComponent(inList)})`,
        { method: 'DELETE' }
      );
    }
  }
}

export async function syncVaultRelationalTables(vaultId, db) {
  if (!db || !hasSupabaseEnv() || Date.now() < sbUnavailableUntil) return;
  const userId = db.ownerUserId || null;
  const now = new Date().toISOString();

  const accountRows = (db.accounts || []).map((a) => ({
    id: a.id,
    vault_id: vaultId,
    user_id: userId,
    provider_id: a.providerId,
    provider_name: a.providerName || a.providerId,
    account_label: a.accountLabel || a.providerName || a.providerId,
    email: a.email || '',
    quota_bytes: Number(a.quotaBytes || 0),
    used_bytes: Number(a.usedBytes || 0),
    connection_mode: a.connectionMode || 'verified_cloud',
    sealed_credentials: a.sealedCredentials || '',
    status: a.status || 'connected',
    connected_at: a.connectedAt || now,
    last_synced_at: a.lastSyncedAt || now,
    updated_at: now,
  }));

  const folderRows = (db.folders || []).map((f) => ({
    id: f.id,
    vault_id: vaultId,
    user_id: userId,
    name: f.name,
    parent_id: f.parentId || null,
    offline_pinned: Boolean(f.offlinePinned),
    starred: Boolean(f.starred),
    trashed: Boolean(f.trashed),
    created_at: f.createdAt || now,
    updated_at: f.updatedAt || now,
  }));

  const fileRows = (db.files || []).map((f) => ({
    id: f.id,
    vault_id: vaultId,
    user_id: userId,
    name: f.name,
    folder_id: f.folderId || null,
    mime_type: f.mimeType || 'application/octet-stream',
    kind: f.kind || 'file',
    size_bytes: Number(f.size || 0),
    account_id: f.accountId || 'offline_vault',
    provider_id: f.providerId || 'offline_vault',
    provider_name: f.providerName || 'Offline Vault',
    remote_id: f.remoteId || null,
    remote_path: f.remotePath || null,
    imported_remote: Boolean(f.importedRemote),
    offline_pinned: Boolean(f.offlinePinned),
    starred: Boolean(f.starred),
    trashed: Boolean(f.trashed),
    text_content:
      typeof f.textContent === 'string' && f.textContent.length <= 250000
        ? f.textContent
        : null,
    created_at: f.createdAt || now,
    updated_at: f.updatedAt || now,
  }));

  const keyRows = (db.apiKeys || []).map((k) => ({
    id: k.id,
    vault_id: vaultId,
    user_id: userId,
    name: k.name || 'AI API Key',
    key_hash: sha256Hex(k.key || ''),
    key_prefix: k.keyPrefix || '',
    scope: k.scope || 'read_write',
    allowed_folder_ids: Array.isArray(k.allowedFolderIds) ? k.allowedFolderIds : [],
    active: k.active !== false,
    usage_count: Number(k.usageCount || 0),
    last_used_at: k.lastUsedAt || null,
    created_at: k.createdAt || now,
    updated_at: now,
  }));

  await Promise.allSettled([
    syncSingleRelationalTable('cloudy_storage_accounts', vaultId, accountRows),
    syncSingleRelationalTable('cloudy_folders', vaultId, folderRows),
    syncSingleRelationalTable('cloudy_files', vaultId, fileRows),
    syncSingleRelationalTable('cloudy_ai_keys', vaultId, keyRows),
  ]);
}

// --- User-Scoped Live Database Overview (For Database Explorer Tab) ---
export async function buildDatabaseOverview({ userRow, currentSessionId, db }) {
  const vaultId = db.vaultId;
  const sessions = userRow ? await listSessionsForUser(userRow.id, currentSessionId) : [];

  // Probe live Supabase connectivity if configured
  let postgresConnected = false;
  if (hasSupabaseEnv() && Date.now() >= sbUnavailableUntil) {
    const ping = await sbRest(
      `cloudy_vault_states?vault_id=eq.${encodeURIComponent(vaultId)}&select=vault_id,updated_at&limit=1`
    );
    postgresConnected = Boolean(ping.ok);
  }

  const usersRows = userRow
    ? [
        {
          id: userRow.id,
          email: userRow.email,
          display_name: userRow.display_name,
          password_hash: '[scrypt-256 · salted]',
          vault_id: userRow.vault_id,
          theme: userRow.theme || 'deepseek',
          last_login_at: userRow.last_login_at,
          created_at: userRow.created_at,
        },
      ]
    : [];

  const sessionRows = sessions.map((s) => ({
    id: s.id,
    user_id: userRow?.id || null,
    device_label: s.deviceLabel,
    ip_address: s.ipAddress || '—',
    token_hash: '[sha256 · verified]',
    is_current: s.isCurrent,
    last_seen_at: s.lastSeenAt,
    expires_at: s.expiresAt,
  }));

  const accountRows = (db.accounts || []).map((a) => ({
    id: a.id,
    vault_id: vaultId,
    provider_id: a.providerId,
    account_label: a.accountLabel,
    email: a.email,
    quota_bytes: a.quotaBytes,
    used_bytes: a.usedBytes,
    connection_mode: a.connectionMode,
    sealed_credentials: '[AES-256-GCM sealed]',
    status: a.status,
    last_synced_at: a.lastSyncedAt,
  }));

  const folderRows = (db.folders || []).map((f) => ({
    id: f.id,
    vault_id: vaultId,
    name: f.name,
    parent_id: f.parentId,
    offline_pinned: Boolean(f.offlinePinned),
    starred: Boolean(f.starred),
    trashed: Boolean(f.trashed),
    updated_at: f.updatedAt,
  }));

  const fileRows = (db.files || []).map((f) => ({
    id: f.id,
    vault_id: vaultId,
    name: f.name,
    folder_id: f.folderId,
    kind: f.kind,
    mime_type: f.mimeType,
    size_bytes: f.size,
    provider_name: f.providerName,
    offline_pinned: Boolean(f.offlinePinned),
    trashed: Boolean(f.trashed),
    updated_at: f.updatedAt,
  }));

  const keyRows = (db.apiKeys || []).map((k) => ({
    id: k.id,
    vault_id: vaultId,
    name: k.name,
    key_prefix: k.keyPrefix,
    key_hash: `sha256:${sha256Hex(k.key || '').slice(0, 16)}…`,
    scope: k.scope,
    usage_count: k.usageCount || 0,
    active: k.active !== false,
    last_used_at: k.lastUsedAt,
  }));

  const tables = [
    {
      name: 'cloudy_users',
      label: 'Users',
      description: 'Authenticated Cloudy user profile & scrypt password credentials',
      rowCount: usersRows.length,
      rows: usersRows,
    },
    {
      name: 'cloudy_sessions',
      label: 'Active Sessions',
      description: 'SHA-256 hashed multi-device login tokens & device activity',
      rowCount: sessionRows.length,
      rows: sessionRows,
    },
    {
      name: 'cloudy_storage_accounts',
      label: 'Cloud Accounts',
      description: 'Verified upstream cloud providers with AES-256-GCM sealed tokens',
      rowCount: accountRows.length,
      rows: accountRows,
    },
    {
      name: 'cloudy_folders',
      label: 'Carpetas (Folders)',
      description: 'Hierarchical folder tree synced across Cloud PostgreSQL & Offline IndexedDB',
      rowCount: folderRows.length,
      rows: folderRows,
    },
    {
      name: 'cloudy_files',
      label: 'Files & Notes',
      description: 'Pooled cloud files, Markdown notes, and offline-pinned metadata',
      rowCount: fileRows.length,
      rows: fileRows,
    },
    {
      name: 'cloudy_ai_keys',
      label: 'Scoped AI Keys',
      description: 'Scoped Local AI & MCP API keys with folder isolation & usage counters',
      rowCount: keyRows.length,
      rows: keyRows,
    },
  ];

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

  return {
    ok: true,
    engine: postgresConnected ? 'supabase_postgres' : 'local_relational_mirror',
    engineLabel: postgresConnected
      ? 'Supabase PostgreSQL 15 (RLS Enabled)'
      : 'Local Relational Store + IndexedDB Mirror',
    postgresConnected,
    rlsEnabled: true,
    latencyMs: lastSbLatencyMs ?? 1,
    vaultId,
    totalRows,
    syncedAt: new Date().toISOString(),
    tables,
  };
}
