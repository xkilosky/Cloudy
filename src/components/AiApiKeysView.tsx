import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Play,
  Download,
} from 'lucide-react';
import type { VaultState, AiApiKey } from '../types';
import { formatRelativeTime } from '../lib/format';
import { getOrCreateVaultId } from '../lib/vaultClient';
import { loadOfflineSnapshot } from '../lib/offlineDb';

interface AiApiKeysViewProps {
  vault: VaultState;
  isOffline: boolean;
  onCreateKey: (
    name: string,
    scope: 'read' | 'read_write',
    allowedFolderIds: string[]
  ) => Promise<void>;
  onToggleKeyActive: (key: AiApiKey) => Promise<void>;
  onDeleteKey: (keyId: string) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

export const AiApiKeysView: React.FC<AiApiKeysViewProps> = ({
  vault,
  isOffline,
  onCreateKey,
  onToggleKeyActive,
  onDeleteKey,
  onRefreshState,
}) => {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read');
  const [folderRestriction, setFolderRestriction] = useState<string>('all');
  const [creating, setCreating] = useState(false);

  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<'ollama' | 'curl'>('ollama');

  const activeKeyObj =
    vault.apiKeys.find((k) => k.active) || vault.apiKeys[0] || null;
  const [testEndpoint, setTestEndpoint] = useState<string>('/api/v1/ai/files');
  const [testOutput, setTestOutput] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://127.0.0.1:3000';
  const activeKeyToken = activeKeyObj?.key || 'cldy_sk_YOUR_KEY';
  const offlineZipHref = `/api/ai-keys/offline-bundle.zip?vaultId=${encodeURIComponent(getOrCreateVaultId())}`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateKey(
        name.trim(),
        scope,
        folderRestriction === 'all' ? [] : [folderRestriction]
      );
      setName('');
    } finally {
      setCreating(false);
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const runLiveTest = async () => {
    if (!activeKeyObj) return;
    setTesting(true);
    try {
      if (isOffline) {
        try {
          const resp = await fetch(testEndpoint, {
            headers: {
              Authorization: `Bearer ${activeKeyObj.key}`,
              'X-Cloudy-Offline-Test': '1',
            },
          });
          if (resp.ok) {
            setTestOutput(JSON.stringify(await resp.json(), null, 2));
            return;
          }
        } catch {
          // IndexedDB fallback
        }
        const snap = await loadOfflineSnapshot();
        setTestOutput(
          JSON.stringify(
            {
              ok: true,
              mode: 'offline-vault',
              files: (snap?.files || []).filter((f) => !f.trashed),
            },
            null,
            2
          )
        );
        return;
      }

      const res = await fetch(testEndpoint, {
        headers: { Authorization: `Bearer ${activeKeyObj.key}` },
      });
      setTestOutput(JSON.stringify(await res.json(), null, 2));
      await onRefreshState();
    } catch (err) {
      setTestOutput(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    } finally {
      setTesting(false);
    }
  };

  const ollamaSnippet = `import json, urllib.request

# Auto-fallback: Online Cloud (${origin}) -> Local Auto-Sync Server (127.0.0.1:8765)
URLS = ["${origin}", "http://127.0.0.1:8765"]
API_KEY = "${activeKeyToken}"

def cloudy(path):
    for base in URLS:
        try:
            req = urllib.request.Request(
                f"{base}{path}",
                headers={"Authorization": f"Bearer {API_KEY}"}
            )
            return json.loads(urllib.request.urlopen(req, timeout=4).read().decode())
        except Exception:
            continue
    raise RuntimeError("Offline AI Server not running")

hits = cloudy("/api/v1/ai/search?q=Cloudy")["results"]
context = "\\n\\n".join(
    cloudy(f"/api/v1/ai/files/{h['id']}/content")["content"]
    for h in hits[:3]
)

req = urllib.request.Request(
    "http://127.0.0.1:11434/api/generate",
    data=json.dumps({
        "model": "llama3.2",
        "prompt": f"{context}\\n\\nSummarize these files.",
        "stream": False
    }).encode(),
    headers={"Content-Type": "application/json"}
)
print(json.loads(urllib.request.urlopen(req).read().decode())["response"])`;

  const curlSnippet = `# List accessible carpetas (Online or Local 127.0.0.1:8765)
curl -s "${origin}/api/v1/ai/folders" -H "Authorization: Bearer ${activeKeyToken}"

# Search vault files
curl -s "${origin}/api/v1/ai/search?q=Cloudy" -H "Authorization: Bearer ${activeKeyToken}"

# Read file content skill
curl -s "${origin}/api/v1/ai/files/fil_welcome/content" -H "Authorization: Bearer ${activeKeyToken}"

# Force instant sync on Local Offline AI Server when internet returns
curl -s -X POST "http://127.0.0.1:8765/api/v1/ai/sync" -H "Authorization: Bearer ${activeKeyToken}"`;

  const codeToDisplay = snippetTab === 'ollama' ? ollamaSnippet : curlSnippet;

  return (
    <div className="flex-1 px-4 sm:px-8 py-7">
      <div className="max-w-5xl mx-auto space-y-9">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">
              Local AI API Keys
            </h1>
            <p className="text-xs text-ink-secondary mt-1">
              Scoped REST keys for local models (Ollama, DeepSeek, Qwen, llama.cpp) — works 100% offline & auto-syncs live whenever internet is available.
            </p>
          </div>

          <motion.a
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            href={offlineZipHref}
            className="px-4 py-2.5 rounded-full bg-surface hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center gap-2 shadow-card transition w-fit"
          >
            <Download className="w-4 h-4 text-accent" />
            Offline AI Server · Auto-Sync (.zip)
          </motion.a>
        </div>

        {/* Create Key Composer Bar */}
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleCreate}
          className="rounded-3xl bg-surface border border-line-strong p-3.5 shadow-card flex flex-col md:flex-row items-stretch md:items-center gap-2.5"
        >
          <input
            type="text"
            required
            disabled={isOffline}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key label (e.g. Ollama / Qwen Local)"
            className="flex-1 px-4 py-2.5 rounded-2xl bg-canvas border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-xs text-ink placeholder:text-ink-muted transition-all"
          />

          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'read' | 'read_write')}
            className="px-3.5 py-2.5 rounded-2xl bg-canvas border border-line text-xs text-ink focus:outline-none"
          >
            <option value="read">Read Only</option>
            <option value="read_write">Read & Write</option>
          </select>

          <select
            value={folderRestriction}
            onChange={(e) => setFolderRestriction(e.target.value)}
            className="px-3.5 py-2.5 rounded-2xl bg-canvas border border-line text-xs text-ink focus:outline-none"
          >
            <option value="all">All Carpetas</option>
            {vault.folders
              .filter((f) => !f.trashed)
              .map((fld) => (
                <option key={fld.id} value={fld.id}>
                  Only: {fld.name}
                </option>
              ))}
          </select>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={creating || isOffline}
            className="px-5 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-glow transition shrink-0 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Creating...' : 'Create Key'}
          </motion.button>
        </motion.form>

        {/* Active Keys */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
            Active Keys
          </h2>
          <div className="rounded-2xl border border-line bg-surface shadow-card divide-y divide-line overflow-hidden">
            {vault.apiKeys.map((k) => {
              const revealed = Boolean(revealedIds[k.id]);
              return (
                <div
                  key={k.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-elevated/40 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-ink">
                        {k.name}
                      </span>
                      <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-elevated text-ink-secondary">
                        {k.scope}
                      </span>
                      {!k.active && (
                        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-300">
                          paused
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {k.usageCount} requests · Last used{' '}
                      {formatRelativeTime(k.lastUsedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="px-3.5 py-1.5 rounded-xl bg-canvas border border-line text-xs font-mono text-accent max-w-[230px] truncate">
                      {revealed ? k.key : k.keyPrefix}
                    </code>

                    <button
                      onClick={() =>
                        setRevealedIds((p) => ({ ...p, [k.id]: !revealed }))
                      }
                      className="p-2 rounded-xl text-ink-muted hover:text-ink hover:bg-elevated transition"
                    >
                      {revealed ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      onClick={() => copyText(k.id, k.key)}
                      className="px-3.5 py-1.5 rounded-full bg-accent-soft hover:bg-accent text-accent hover:text-accent-fg text-xs font-semibold inline-flex items-center gap-1 transition"
                    >
                      {copiedId === k.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </>
                      )}
                    </button>

                    <button
                      disabled={isOffline}
                      onClick={() => onToggleKeyActive(k)}
                      className="px-3 py-1.5 rounded-full bg-elevated hover:bg-canvas text-xs text-ink-secondary hover:text-ink transition"
                    >
                      {k.active ? 'Pause' : 'Enable'}
                    </button>

                    {vault.apiKeys.length > 1 && (
                      <button
                        disabled={isOffline}
                        onClick={() => onDeleteKey(k.id)}
                        className="p-2 rounded-xl text-ink-muted hover:text-red-400 hover:bg-elevated transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Code Snippets + Live Endpoint Runner */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 rounded-3xl bg-surface border border-line p-5 space-y-4 shadow-card">
            <div className="flex items-center justify-between">
              <div className="inline-flex bg-canvas border border-line rounded-full p-1 text-xs">
                {(['ollama', 'curl'] as const).map((tab) => {
                  const active = snippetTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setSnippetTab(tab)}
                      className={`relative px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                        active ? 'text-accent-fg' : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="aiSnippetTab"
                          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-full bg-accent shadow-glow"
                        />
                      )}
                      <span className="relative z-10">
                        {tab === 'ollama' ? 'Python + Local LLM' : 'cURL REST'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => copyText('snippet', codeToDisplay)}
                className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-medium"
              >
                {copiedId === 'snippet' ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </>
                )}
              </button>
            </div>

            <pre className="p-4 rounded-2xl bg-canvas border border-line text-xs font-mono text-ink overflow-x-auto leading-relaxed">
              {codeToDisplay}
            </pre>
          </div>

          <div className="lg:col-span-5 rounded-3xl bg-surface border border-line p-5 space-y-4 shadow-card">
            <div className="text-xs font-medium text-ink-secondary">
              Interactive Endpoint Tester
            </div>
            <div className="flex gap-2">
              <select
                value={testEndpoint}
                onChange={(e) => setTestEndpoint(e.target.value)}
                className="flex-1 px-3.5 py-2 rounded-2xl bg-canvas border border-line text-xs font-mono text-ink focus:outline-none"
              >
                <option value="/api/v1/ai/status">GET /api/v1/ai/status</option>
                <option value="/api/v1/ai/sync-manifest">
                  GET /api/v1/ai/sync-manifest
                </option>
                <option value="/api/v1/ai/folders">GET /api/v1/ai/folders</option>
                <option value="/api/v1/ai/files">GET /api/v1/ai/files</option>
                <option value="/api/v1/ai/search?q=Cloudy">
                  GET /api/v1/ai/search?q=Cloudy
                </option>
                <option value="/api/v1/ai/files/fil_welcome/content">
                  GET /api/v1/ai/files/fil_welcome/content
                </option>
              </select>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={runLiveTest}
                disabled={testing || !activeKeyObj}
                className="px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center gap-1.5 shadow-glow transition"
              >
                <Play className="w-3.5 h-3.5" />
                Run
              </motion.button>
            </div>

            <pre className="p-4 rounded-2xl bg-canvas border border-line text-[11px] font-mono text-ink-secondary h-52 overflow-auto">
              {testOutput || '// Click Run to inspect live JSON response'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
