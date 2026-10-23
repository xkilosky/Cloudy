import React, { useState } from 'react';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Play,
  Terminal,
  Download,
  Folder,
  Shield,
  Activity,
} from 'lucide-react';
import type { VaultState, AiApiKey } from '../types';
import { formatRelativeTime } from '../lib/format';
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
  const [restrictFolders, setRestrictFolders] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<'ollama' | 'curl' | 'llamacpp'>('ollama');

  // Live REST API Tester state
  const activeKeyObj = vault.apiKeys.find((k) => k.active) || vault.apiKeys[0] || null;
  const [testEndpoint, setTestEndpoint] = useState<string>('/api/v1/ai/search?q=Cloudy');
  const [testOutput, setTestOutput] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  const activeKeyToken = activeKeyObj?.key || 'cldy_sk_YOUR_API_KEY';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateKey(
        name.trim(),
        scope,
        restrictFolders ? selectedFolders : []
      );
      setName('');
      setSelectedFolders([]);
      setRestrictFolders(false);
    } finally {
      setCreating(false);
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleFolderCheck = (fid: string) => {
    setSelectedFolders((prev) =>
      prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]
    );
  };

  const runLiveTest = async () => {
    if (!activeKeyObj) return;
    setTesting(true);
    try {
      if (isOffline) {
        // Test against Service Worker offline vault or client IndexedDB fallback
        try {
          const resp = await fetch(testEndpoint, {
            headers: {
              Authorization: `Bearer ${activeKeyObj.key}`,
              'X-Cloudy-Offline-Test': '1',
            },
          });
          if (resp.ok) {
            const json = await resp.json();
            setTestOutput(JSON.stringify(json, null, 2));
            return;
          }
        } catch {
          // Direct IndexedDB evaluation fallback if SW hasn't intercepted yet
        }
        const snap = await loadOfflineSnapshot();
        const files = (snap?.files || []).filter((f) => !f.trashed);
        const folders = (snap?.folders || []).filter((f) => !f.trashed);
        setTestOutput(
          JSON.stringify(
            {
              ok: true,
              mode: 'indexeddb-offline-vault',
              endpoint: testEndpoint,
              keyName: activeKeyObj.name,
              foldersCount: folders.length,
              filesCount: files.length,
              files: files.map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                snippet: (f.textContent || '').slice(0, 240),
              })),
            },
            null,
            2
          )
        );
        return;
      }

      const res = await fetch(testEndpoint, {
        headers: {
          Authorization: `Bearer ${activeKeyObj.key}`,
        },
      });
      const json = await res.json();
      setTestOutput(JSON.stringify(json, null, 2));
      await onRefreshState();
    } catch (err) {
      setTestOutput(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    } finally {
      setTesting(false);
    }
  };

  const ollamaSnippet = `import json, urllib.request

# Works online against Cloudy (${origin})
# OR 100% offline via Cloudy's Local Offline Server (http://127.0.0.1:8765)
CLOUDY_URL = "${origin}"
CLOUDY_KEY = "${activeKeyToken}"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

def cloudy_get(endpoint):
    req = urllib.request.Request(
        f"{CLOUDY_URL}{endpoint}",
        headers={"Authorization": f"Bearer {CLOUDY_KEY}"}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

# 1. Search offline synced carpetas & files
hits = cloudy_get("/api/v1/ai/search?q=Cloudy")["results"]

# 2. Read full file contents for local LLM context
docs = []
for h in hits[:3]:
    data = cloudy_get(f"/api/v1/ai/files/{h['id']}/content")
    docs.append(f"File: {h['folderPath']}/{h['name']}\\n{data['content']}")

# 3. Ask local offline Ollama model (llama3.2 / qwen2.5 / mistral)
payload = {
    "model": "llama3.2",
    "prompt": "\\n\\n".join(docs) + "\\n\\nQuestion: Summarize my Cloudy files.",
    "stream": False
}
req = urllib.request.Request(
    OLLAMA_URL,
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"}
)
print(json.loads(urllib.request.urlopen(req).read().decode())["response"])`;

  const curlSnippet = `# 1. List all accessible carpetas (folders)
curl -s "${origin}/api/v1/ai/folders" \\
  -H "Authorization: Bearer ${activeKeyToken}"

# 2. Search offline files & notes by keyword
curl -s "${origin}/api/v1/ai/search?q=Cloudy" \\
  -H "Authorization: Bearer ${activeKeyToken}"

# 3. Read a specific file's full text/markdown/JSON content
curl -s "${origin}/api/v1/ai/files/fil_welcome/content" \\
  -H "Authorization: Bearer ${activeKeyToken}"`;

  const llamaCppSnippet = `import requests

CLOUDY_URL = "${origin}"
HEADERS = {"Authorization": "Bearer ${activeKeyToken}"}

# Fetch all files from Cloudy vault
files = requests.get(f"{CLOUDY_URL}/api/v1/ai/files", headers=HEADERS).json()["files"]
first_id = files[0]["id"]
doc = requests.get(f"{CLOUDY_URL}/api/v1/ai/files/{first_id}/content", headers=HEADERS).json()

# Send to local llama.cpp / LM Studio OpenAI-compatible server (offline)
resp = requests.post(
    "http://127.0.0.1:8080/v1/chat/completions",
    json={
        "model": "local-model",
        "messages": [
            {"role": "system", "content": f"Reference file {doc['file']['name']}:\\n{doc['content']}"},
            {"role": "user", "content": "Explain the key points in this file."}
        ]
    }
)
print(resp.json()["choices"][0]["message"]["content"])`;

  const currentSnippet =
    snippetTab === 'ollama'
      ? ollamaSnippet
      : snippetTab === 'curl'
        ? curlSnippet
        : llamaCppSnippet;

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Header + Offline Vault Bundle Download */}
      <div className="rounded-3xl bg-gradient-to-br from-[#0D182E] via-[#0A1222] to-[#070C17] border border-sky-500/25 p-6 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold">
            <KeyRound className="w-3.5 h-3.5" />
            Local Offline AI REST API · Scoped Keys
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            API Keys for Local Offline AI Models
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Generate scoped <code className="text-sky-300 font-mono">cldy_sk_...</code> API keys so your local offline AI models (<strong>Ollama</strong>, <strong>llama.cpp</strong>, <strong>LM Studio</strong>, Python scripts, or Android Termux) can list carpetas, search files, and read offline file contents over simple REST endpoints.
          </p>
        </div>

        <a
          href="/api/ai-keys/offline-bundle.zip"
          className="shrink-0 rounded-2xl bg-[#060A14] hover:bg-slate-900 border border-sky-500/40 p-4 flex items-center gap-3.5 transition group"
        >
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-white group-hover:text-sky-300 transition">
              Download Offline AI Vault (.zip)
            </div>
            <div className="text-[11px] text-slate-400 max-w-[210px]">
              Includes synced offline files + zero-dep Python local server (<span className="font-mono">127.0.0.1:8765</span>)
            </div>
          </div>
        </a>
      </div>

      {/* Create Key + Active Keys Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Create New API Key Form */}
        <form
          onSubmit={handleCreate}
          className="xl:col-span-5 rounded-2xl bg-[#0B1220] border border-slate-800/90 p-5 space-y-4 h-fit"
        >
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-sky-400" />
            Generate New AI API Key
          </h2>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Key Name / Local Model Label
            </label>
            <input
              type="text"
              required
              disabled={isOffline}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ollama Llama-3.2 Offline"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#060A14] border border-slate-800 focus:border-sky-500 focus:outline-none text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Access Scope
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope('read')}
                className={`p-2.5 rounded-xl border text-left text-xs transition ${
                  scope === 'read'
                    ? 'bg-sky-500/15 border-sky-500/50 text-white'
                    : 'bg-[#060A14] border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-bold">Read & Search Only</div>
                <div className="text-[11px] opacity-80">Safe default for RAG</div>
              </button>
              <button
                type="button"
                onClick={() => setScope('read_write')}
                className={`p-2.5 rounded-xl border text-left text-xs transition ${
                  scope === 'read_write'
                    ? 'bg-sky-500/15 border-sky-500/50 text-white'
                    : 'bg-[#060A14] border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-bold">Read & Write Notes</div>
                <div className="text-[11px] opacity-80">AI can save summaries</div>
              </button>
            </div>
          </div>

          {/* Carpeta Restriction */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={restrictFolders}
                onChange={(e) => setRestrictFolders(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-sky-500"
              />
              <span>Restrict key to specific carpetas (folders) only</span>
            </label>

            {restrictFolders && (
              <div className="p-3 rounded-xl bg-[#060A14] border border-slate-800 max-h-36 overflow-y-auto space-y-1.5">
                {vault.folders
                  .filter((f) => !f.trashed)
                  .map((fld) => (
                    <label
                      key={fld.id}
                      className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFolders.includes(fld.id)}
                        onChange={() => toggleFolderCheck(fld.id)}
                      />
                      <Folder className="w-3.5 h-3.5" style={{ color: fld.color }} />
                      <span>{fld.name}</span>
                    </label>
                  ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={creating || isOffline}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs transition disabled:opacity-40"
          >
            {creating ? 'Generating Key...' : 'Create Cloudy AI API Key'}
          </button>
        </form>

        {/* Active Keys List */}
        <div className="xl:col-span-7 space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Your Active AI API Keys ({vault.apiKeys.length})
          </h2>

          <div className="space-y-3">
            {vault.apiKeys.map((k) => {
              const isRevealed = Boolean(revealedIds[k.id]);
              return (
                <div
                  key={k.id}
                  className="rounded-2xl bg-[#0B1220] border border-slate-800/90 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{k.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            k.active
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {k.active ? 'Active' : 'Paused'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                          {k.scope}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {k.allowedFolderIds.length === 0
                          ? 'Access: All Offline Carpetas & Files'
                          : `Restricted to ${k.allowedFolderIds.length} folder(s)`}{' '}
                        · {k.usageCount} API calls · Last used {formatRelativeTime(k.lastUsedAt)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={isOffline}
                        onClick={() => onToggleKeyActive(k)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium"
                      >
                        {k.active ? 'Pause' : 'Enable'}
                      </button>
                      {vault.apiKeys.length > 1 && (
                        <button
                          disabled={isOffline}
                          onClick={() => onDeleteKey(k.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Revoke key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Secret Key String Row */}
                  <div className="flex items-center gap-2 bg-[#060A14] border border-slate-800 rounded-xl px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-sky-300 truncate">
                      {isRevealed ? k.key : k.keyPrefix}
                    </code>
                    <button
                      onClick={() =>
                        setRevealedIds((prev) => ({ ...prev, [k.id]: !isRevealed }))
                      }
                      className="p-1 text-slate-400 hover:text-white"
                      title={isRevealed ? 'Hide key' : 'Reveal full key'}
                    >
                      {isRevealed ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => copyText(k.id, k.key)}
                      className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      {copiedId === k.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Key
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Simple REST Endpoints + Copy-Paste Python / Ollama / cURL Snippets */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Code Snippets */}
        <div className="xl:col-span-7 rounded-2xl bg-[#0B1220] border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-sky-400" />
              Ready-to-Run Local AI Snippets
            </h2>
            <div className="flex items-center gap-1 bg-[#060A14] p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setSnippetTab('ollama')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  snippetTab === 'ollama'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Python + Ollama
              </button>
              <button
                onClick={() => setSnippetTab('curl')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  snippetTab === 'curl'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                cURL REST
              </button>
              <button
                onClick={() => setSnippetTab('llamacpp')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  snippetTab === 'llamacpp'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                llama.cpp / LM Studio
              </button>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => copyText('snippet', currentSnippet)}
              className="absolute right-3 top-3 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1"
            >
              {copiedId === 'snippet' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Code
                </>
              )}
            </button>
            <pre className="p-4 rounded-2xl bg-[#060A14] border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
              {currentSnippet}
            </pre>
          </div>

          {/* Clean REST Endpoint Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-xl bg-[#060A14] border border-slate-800/80">
              <span className="text-emerald-400 font-bold">GET</span>{' '}
              <span className="text-slate-300">/api/v1/ai/folders</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#060A14] border border-slate-800/80">
              <span className="text-emerald-400 font-bold">GET</span>{' '}
              <span className="text-slate-300">/api/v1/ai/files</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#060A14] border border-slate-800/80">
              <span className="text-emerald-400 font-bold">GET</span>{' '}
              <span className="text-slate-300">/api/v1/ai/search?q=...</span>
            </div>
            <div className="p-2.5 rounded-xl bg-[#060A14] border border-slate-800/80">
              <span className="text-emerald-400 font-bold">GET</span>{' '}
              <span className="text-slate-300">/api/v1/ai/files/:id/content</span>
            </div>
          </div>
        </div>

        {/* Live Interactive REST Endpoint Tester */}
        <div className="xl:col-span-5 rounded-2xl bg-[#0B1220] border border-slate-800/90 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Live AI REST Endpoint Tester
              </h2>
              <span className="text-[11px] text-slate-400">
                {isOffline ? 'Offline Vault Mode' : 'Live REST API'}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                '/api/v1/ai/status',
                '/api/v1/ai/folders',
                '/api/v1/ai/files',
                '/api/v1/ai/search?q=Cloudy',
                '/api/v1/ai/files/fil_welcome/content',
              ].map((ep) => (
                <button
                  key={ep}
                  onClick={() => setTestEndpoint(ep)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono transition ${
                    testEndpoint === ep
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-[#060A14] text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {ep.replace('/api/v1/ai', '')}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={testEndpoint}
                onChange={(e) => setTestEndpoint(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-[#060A14] border border-slate-800 text-xs font-mono text-white"
              />
              <button
                onClick={runLiveTest}
                disabled={testing || !activeKeyObj}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition"
              >
                <Play className="w-3.5 h-3.5" />
                {testing ? '...' : 'Run'}
              </button>
            </div>

            <pre className="p-3.5 rounded-2xl bg-[#060A14] border border-slate-800 text-[11px] font-mono text-emerald-300 h-60 overflow-auto">
              {testOutput ||
                '// Click "Run" above to test your Cloudy AI API Key against your folders & files (works both online & offline!)'}
            </pre>
          </div>

          {vault.aiAuditLog.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80">
              <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                Recent AI Key Requests
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {vault.aiAuditLog.slice(0, 4).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-[11px] font-mono text-slate-400"
                  >
                    <span className="truncate max-w-[240px]">
                      <span className="text-sky-400">{entry.method}</span> {entry.endpoint}
                    </span>
                    <span className="text-emerald-400">{entry.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
