export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(decimals)} ${sizes[i]}`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function isTextEditable(mimeType: string, name: string): boolean {
  const m = (mimeType || '').toLowerCase();
  if (
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('javascript') ||
    m.includes('typescript') ||
    m.includes('xml') ||
    m.includes('yaml') ||
    m.includes('csv')
  ) {
    return true;
  }
  return /\.(md|txt|json|csv|js|ts|tsx|jsx|py|sh|yml|yaml|html|css|sql|log)$/i.test(name || '');
}
