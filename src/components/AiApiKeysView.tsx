import React, { useState } from 'react';
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

  const activeKeyObj = vault.apiKeys.find((k) => k.active) || vault.apiKeys[0] || null;
  const [testEndpoint, setTestEndpoint] = useState<string>('/api/v1/ai/files');
  const [testOutput, setTestOutput] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
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
          // IndexedDB direct fallback
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

# Online (${origin}) OR Offline Server (http://127.0.0.1:8765)
CLOUDY_URL = "${origin}"
API_KEY = "${activeKeyToken}"

def cloudy(path):
    req = urllib.request.Request(
        f"{CLOUDY_URL}{path}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    return json.loads(urllib.request.urlopen(req).read().decode())

# Search offline synced files & pass to local Ollama
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

  const curlSnippet = `# List accessible carpetas (folders)
curl -s "${origin}/api/v1/ai/folders" -H "Authorization: Bearer ${activeKeyToken}"

# Search offline files
curl -s "${origin}/api/v1/ai/search?q=Cloudy" -H "Authorization: Bearer ${activeKeyToken}"

# Read file text content
curl -s "${origin}/api/v1/ai/files/fil_welcome/content" -H "Authorization: Bearer ${activeKeyToken}"`;

  const codeToDisplay = snippetTab === 'ollama' ? ollamaSnippet : curlSnippet;

  return (
    <div className="flex-1 px-5 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Top Row: Title + Offline Server Bundle Download */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Local AI API Keys</h1>
            <p className="text-xs text-zinc-500 mt-1">
              Scoped REST API keys so local offline models (Ollama, llama.cpp, Python) can read your files.
            </p>
          </div>

          <a
            href={offlineZipHref}
            className="px-4 py-2.5 rounded-xl bg-[#07090C] hover:bg-white/[0.05] border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-bold inline-flex items-center gap-2 transition w-fit"
          >
            <Download className="w-4 h-4" />
            Download Offline AI Server (.zip)
          </a>
        </div>

        {/* Clean Single-Bar Create Key Form */}
        <form
          onSubmit={handleCreate}
          className="rounded-2xl bg-[#07090C] border border-white/[0.08] p-4 flex flex-col md:flex-row items-stretch md:items-center gap-3"
        >
          <input
            type="text"
            required
            disabled={isOffline}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New key name (e.g. Ollama Local)"
            className="flex-1 px-3.5 py-2 rounded-xl bg-black border border-white/10 focus:border-[#00F0FF] focus:outline-none text-xs text-white"
          />

          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'read' | 'read_write')}
            className="px-3 py-2 rounded-xl bg-black border border-white/10 text-xs text-white"
          >
            <option value="read">Read Only</option>
            <option value="read_write">Read & Write</option>
          </select>

          <select
            value={folderRestriction}
            onChange={(e) => setFolderRestriction(e.target.value)}
            className="px-3 py-2 rounded-xl bg-black border border-white/10 text-xs text-white"
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

          <button
            type="submit"
            disabled={creating || isOffline}
            className="px-4 py-2 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-1.5 transition shrink-0 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </form>

        {/* Active Keys */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
            Active Keys
          </h2>
          <div className="rounded-2xl border border-white/[0.08] bg-[#07090C] divide-y divide-white/[0.06] overflow-hidden">
            {vault.apiKeys.map((k) => {
              const revealed = Boolean(revealedIds[k.id]);
              return (
                <div
                  key={k.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-white">{k.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-zinc-300">
                        {k.scope}
                      </span>
                      {!k.active && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-300">
                          paused
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {k.usageCount} requests · Last used {formatRelativeTime(k.lastUsedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <code className="px-3 py-1.5 rounded-xl bg-black border border-white/[0.08] text-xs font-mono text-[#00F0FF] max-w-[230px] truncate">
                      {revealed ? k.key : k.keyPrefix}
                    </code>

                    <button
                      onClick={() =>
                        setRevealedIds((p) => ({ ...p, [k.id]: !revealed }))
                      }
                      className="p-2 rounded-lg text-zinc-500 hover:text-white"
                      title={revealed ? 'Hide' : 'Reveal'}
                    >
                      {revealed ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      onClick={() => copyText(k.id, k.key)}
                      className="px-3 py-1.5 rounded-xl bg-[#00F0FF]/10 hover:bg-[#00F0FF] text-[#00F0FF] hover:text-black border border-[#00F0FF]/30 text-xs font-bold inline-flex items-center gap-1 transition"
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
                      className="px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-xs text-zinc-300"
                    >
                      {k.active ? 'Pause' : 'Enable'}
                    </button>

                    {vault.apiKeys.length > 1 && (
                      <button
                        disabled={isOffline}
                        onClick={() => onDeleteKey(k.id)}
                        className="p-2 rounded-lg text-zinc-500 hover:text-red-400"
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

        {/* Code Snippets + Clean Live Tester */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl bg-[#07090C] border border-white/[0.08] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="inline-flex bg-black border border-white/[0.08] rounded-xl p-1 text-xs">
                <button
                  onClick={() => setSnippetTab('ollama')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    snippetTab === 'ollama'
                      ? 'bg-[#00F0FF] text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Python + Ollama
                </button>
                <button
                  onClick={() => setSnippetTab('curl')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    snippetTab === 'curl'
                      ? 'bg-[#00F0FF] text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  cURL REST
                </button>
              </div>

              <button
                onClick={() => copyText('snippet', codeToDisplay)}
                className="text-xs text-[#00F0FF] hover:underline inline-flex items-center gap-1 font-medium"
              >
                {copiedId === 'snippet' ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy Snippet
                  </>
                )}
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-black border border-white/[0.06] text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed">
              {codeToDisplay}
            </pre>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-[#07090C] border border-white/[0.08] p-5 space-y-4">
            <div className="text-xs font-medium text-zinc-400">Test Endpoint</div>
            <div className="flex gap-2">
              <select
                value={testEndpoint}
                onChange={(e) => setTestEndpoint(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-black border border-white/10 text-xs font-mono text-white"
              >
                <option value="/api/v1/ai/status">GET /api/v1/ai/status</option>
                <option value="/api/v1/ai/folders">GET /api/v1/ai/folders</option>
                <option value="/api/v1/ai/files">GET /api/v1/ai/files</option>
                <option value="/api/v1/ai/search?q=Cloudy">GET /api/v1/ai/search?q=Cloudy</option>
                <option value="/api/v1/ai/files/fil_welcome/content">
                  GET /api/v1/ai/files/fil_welcome/content
                </option>
              </select>
              <button
                onClick={runLiveTest}
                disabled={testing || !activeKeyObj}
                className="px-4 py-2 rounded-xl bg-[#00F0FF] text-black font-bold text-xs inline-flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                Run
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-black border border-white/[0.06] text-[11px] font-mono text-[#00F0FF] h-52 overflow-auto">
              {testOutput || '// Click Run to inspect live JSON response'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
