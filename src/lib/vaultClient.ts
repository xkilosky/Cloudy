const VAULT_STORAGE_KEY = 'cloudy_xkilo_vault_id';

export function getOrCreateVaultId(): string {
  if (typeof window === 'undefined') return 'default';
  let vid = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!vid) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    vid = `vlt_${hex}`;
    localStorage.setItem(VAULT_STORAGE_KEY, vid);
  }
  return vid;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('X-Cloudy-Vault-ID', getOrCreateVaultId());
  return fetch(input, { ...init, headers });
}
