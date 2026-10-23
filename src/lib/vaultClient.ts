import type { AuthUser } from '../types';

const VAULT_STORAGE_KEY = 'cloudy_xkilo_vault_id';
const AUTH_TOKEN_KEY = 'cloudy_xkilo_auth_token';
const AUTH_USER_KEY = 'cloudy_xkilo_auth_user';
const GUEST_MODE_KEY = 'cloudy_xkilo_guest_mode';

function generateRandomVaultId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `vlt_${hex}`;
}

export function getOrCreateVaultId(): string {
  if (typeof window === 'undefined') return 'default';
  const authUser = getCachedAuthUser();
  if (authUser?.vaultId) {
    return authUser.vaultId;
  }
  let vid = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!vid) {
    vid = generateRandomVaultId();
    localStorage.setItem(VAULT_STORAGE_KEY, vid);
  }
  return vid;
}

export function setVaultId(vaultId: string): void {
  if (typeof window === 'undefined' || !vaultId) return;
  localStorage.setItem(VAULT_STORAGE_KEY, vaultId);
}

export function resetToFreshGuestVault(): string {
  const vid = generateRandomVaultId();
  if (typeof window !== 'undefined') {
    localStorage.setItem(VAULT_STORAGE_KEY, vid);
  }
  return vid;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getCachedAuthUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    return parsed?.id && parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.removeItem(GUEST_MODE_KEY);
  if (user.vaultId) {
    localStorage.setItem(VAULT_STORAGE_KEY, user.vaultId);
  }
}

export function updateCachedAuthUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  if (user.vaultId) {
    localStorage.setItem(VAULT_STORAGE_KEY, user.vaultId);
  }
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(GUEST_MODE_KEY);
}

export function isGuestModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(GUEST_MODE_KEY) === '1';
}

export function setGuestModeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) {
    localStorage.setItem(GUEST_MODE_KEY, '1');
  } else {
    localStorage.removeItem(GUEST_MODE_KEY);
  }
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('X-Cloudy-Vault-ID', getOrCreateVaultId());
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
