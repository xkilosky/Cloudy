import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Play,
  PlugZap,
  Download,
  RefreshCw,
  Send,
  Sparkles,
  Blocks,
  Terminal,
  Cpu,
  SlidersHorizontal,
  Radar,
  Wand2,
  CheckCircle2,
  AppWindow,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  ExternalLink,
} from 'lucide-react';
import type { AiApiKey, AiTrustLevel, VaultState } from '../types';
import { formatRelativeTime } from '../lib/format';
import { loadOfflineSnapshot } from '../lib/offlineDb';
import { getOrCreateVaultId, getAuthToken } from '../lib/vaultClient';
import {
  detectLocalAiRuntimes,
  askLocalAiWithVaultSkills,
  getSavedCustomLocalAiUrl,
  saveCustomLocalAiUrl,
  type DetectedLocalModel,
  type ChatTurnMessage,
} from '../lib/localAiPlugPlay';
import {
  scanForAiApps,
  autoConnectMcpAppViaBridge,
  type DetectedAiApp,
  type CustomAppCapabilityHint,
} from '../lib/aiAppScanner';

interface AiApiKeysViewProps {
  vault: VaultState;
  isOffline: boolean;
  onCreateKey: (
    name: string,
    trustLevel: AiTrustLevel,
    allowedFolderIds: string[]
  ) => Promise<AiApiKey | null>;
  onUpdateKeyTrustLevel: (
    key: AiApiKey,
    trustLevel: AiTrustLevel
  ) => Promise<void>;
  onToggleKeyActive: (key: AiApiKey) => Promise<void>;
  onDeleteKey: (keyId: string) => Promise<void>;
  onSaveGeneratedNote: (
    name: string,
    content: string,
    folderId: string | null
  ) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

const POPULAR_APP_PRESETS = [
  'Cursor',
  'Claude Desktop',
  'LM Studio',
  'Ollama',
  'OpenWebUI',
  'Windsurf',
  'AnythingLLM',
  'Jan',
];

interface TrustMeta {
  id: AiTrustLevel;
  label: string;
  subtitle: string;
  toolsCount: number;
  summary: string;
  badgeClass: string;
  ringClass: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TRUST_LEVEL_OPTIONS: TrustMeta[] = [
  {
    id: 'normal',
    label: 'Normal',
    subtitle: 'Read & Search',
    toolsCount: 4,
    summary:
      'Safe read-only access: list carpetas & files, search vault, and read file contents. Blocks edits & deletes.',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    ringClass: 'border-sky-500/60 bg-sky-500/10',
    icon: Shield,
  },
  {
    id: 'medium',
    label: 'Medium',
    subtitle: 'Create & Edit',
    toolsCount: 7,
    summary:
      'Balanced workspace access: read + create carpetas, save notes, and edit files. Blocks file moves & deletion.',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    ringClass: 'border-amber-500/60 bg-amber-500/10',
    icon: ShieldAlert,
  },
  {
    id: 'proved',
    label: 'Proved',
    subtitle: 'Full Trusted Agent',
    toolsCount: 10,
    summary:
      'Full verified control: read, create, edit, organize/move across carpetas, delete files, and inspect Cloud Pool.',
    badgeClass: 'bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/35',
    ringClass: 'border-[#10A37F]/70 bg-[#10A37F]/10',
    icon: ShieldCheck,
  },
];

function resolveKeyTrust(key?: AiApiKey | null): AiTrustLevel {
  if (!key) return 'normal';
  const raw = String(key.trustLevel || '').toLowerCase();
  if (raw === 'proved') return 'proved';
  if (raw === 'medium' || raw === 'middium') return 'medium';
  if (raw === 'normal') return 'normal';
  return key.scope === 'read_write' ? 'proved' : 'normal';
}

function getTrustMeta(level: AiTrustLevel): TrustMeta {
  return (
    TRUST_LEVEL_OPTIONS.find((t) => t.id === level) || TRUST_LEVEL_OPTIONS[0]
  );
}

interface McpHandshakeResult {
  ok: boolean;
  latencyMs: number;
  protocolVersion?: string;
  serverName?: string;
  trustLevel?: AiTrustLevel;
  tools?: string[];
  error?: string;
}

export const AiApiKeysView: React.FC<AiApiKeysViewProps> = ({
  vault,
  isOffline,
  onCreateKey,
  onUpdateKeyTrustLevel,
  onToggleKeyActive,
  onDeleteKey,
  onSaveGeneratedNote,
  onRefreshState,
}) => {
  const [sectionTab, setSectionTab] = useState<
    'keys' | 'apps_chat' | 'rest_code'
  >('keys');

  // Key generator state
  const [name, setName] = useState('');
  const [trustLevel, setTrustLevel] = useState<AiTrustLevel>('medium');
  const [folderRestriction, setFolderRestriction] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<AiApiKey | null>(null);

  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<'ollama' | 'curl'>('ollama');
  const [mcpFormatTab, setMcpFormatTab] = useState<
    'fast_json' | 'claude' | 'headers' | 'offline_py'
  >('fast_json');

  const activeKeys = vault.apiKeys.filter((k) => k.active);
  const preferredKey =
    activeKeys.find((k) => resolveKeyTrust(k) === 'proved') ||
    activeKeys.find((k) => resolveKeyTrust(k) === 'medium') ||
    activeKeys[0] ||
    vault.apiKeys[0];

  const [selectedKeyId, setSelectedKeyId] = useState<string>(
    preferredKey?.id || ''
  );

  // Sync selected key if keys list changes
  useEffect(() => {
    if (
      !vault.apiKeys.some((k) => k.id === selectedKeyId) &&
      preferredKey?.id
    ) {
      setSelectedKeyId(preferredKey.id);
    }
  }, [vault.apiKeys, selectedKeyId, preferredKey?.id]);

  // MCP Fast Connection live handshake tester
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpTestResult, setMcpTestResult] =
    useState<McpHandshakeResult | null>(null);

  // REST Endpoint tester
  const [testEndpoint, setTestEndpoint] = useState('/api/v1/ai/status');
  const [testOutput, setTestOutput] = useState<string>('');
  const [testing, setTesting] = useState(false);

  // AI App Scanner State
  const [scanningApps, setScanningApps] = useState(false);
  const [detectedApps, setDetectedApps] = useState<DetectedAiApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [customAppName, setCustomAppName] = useState('');
  const [customAppPortOrUrl, setCustomAppPortOrUrl] = useState('');
  const [capabilityHint, setCapabilityHint] =
    useState<CustomAppCapabilityHint>('auto');
  const [autoConnectingAppId, setAutoConnectingAppId] = useState<string | null>(
    null
  );
  const [autoConnectBanner, setAutoConnectBanner] = useState<string | null>(
    null
  );

  // Local AI Model Scanner & Built-in Vault Chat
  const [scanningModels, setScanningModels] = useState(false);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [bridgeOnlineSync, setBridgeOnlineSync] = useState(false);
  const [detectedRuntimes, setDetectedRuntimes] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<DetectedLocalModel[]>([]);
  const [selectedModelUid, setSelectedModelUid] = useState<string>('');
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState(() =>
    getSavedCustomLocalAiUrl()
  );

  const [chatHistory, setChatHistory] = useState<ChatTurnMessage[]>([]);
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const selectedKeyObj =
    vault.apiKeys.find((k) => k.id === selectedKeyId) || preferredKey || null;
  const selectedKeyTrust = resolveKeyTrust(selectedKeyObj);
  const selectedTrustMeta = getTrustMeta(selectedKeyTrust);
  const activeKeyToken = selectedKeyObj?.key || 'cldy_sk_YOUR_KEY';
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000';

  const fastMcpUrl = `${origin}/api/mcp?key=${encodeURIComponent(activeKeyToken)}`;
  const bareMcpUrl = `${origin}/api/mcp`;

  // Official 1-click IDE deep links
  const cursorInstallHref = (() => {
    try {
      const cfg = btoa(JSON.stringify({ url: fastMcpUrl }));
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=cloudy-vault&config=${encodeURIComponent(cfg)}`;
    } catch {
      return '#';
    }
  })();

  const vscodeInstallHref = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: 'cloudy-vault',
      type: 'http',
      url: fastMcpUrl,
    })
  )}`;

  const withAuthQuery = (baseUrl: string) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const vid = encodeURIComponent(getOrCreateVaultId());
    const tok = getAuthToken();
    return `${baseUrl}${sep}vaultId=${vid}${tok ? `&token=${encodeURIComponent(tok)}` : ''}`;
  };

  const offlineZipHref = withAuthQuery(
    selectedKeyObj
      ? `/api/ai-keys/offline-bundle.zip?keyId=${encodeURIComponent(selectedKeyObj.id)}`
      : '/api/ai-keys/offline-bundle.zip'
  );
  const openWebUiHref = withAuthQuery(
    selectedKeyObj
      ? `/api/ai-keys/openwebui-tool.py?keyId=${encodeURIComponent(selectedKeyObj.id)}`
      : '/api/ai-keys/openwebui-tool.py'
  );

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  const runMcpFastTest = async () => {
    if (!selectedKeyObj) return;
    setMcpTesting(true);
    setMcpTestResult(null);
    const t0 = performance.now();
    try {
      const initRes = await fetch(
        `/api/mcp?key=${encodeURIComponent(selectedKeyObj.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'cloudy-fast-tester', version: '2.0.0' },
            },
          }),
        }
      );
      const initJson = await initRes.json();
      if (!initRes.ok || initJson.error) {
        throw new Error(
          initJson?.error?.message || `HTTP ${initRes.status}`
        );
      }

      const toolsRes = await fetch(
        `/api/mcp?key=${encodeURIComponent(selectedKeyObj.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }),
        }
      );
      const toolsJson = await toolsRes.json();
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      const toolNames: string[] = (toolsJson?.result?.tools || []).map(
        (t: { name: string }) => t.name
      );

      setMcpTestResult({
        ok: true,
        latencyMs,
        protocolVersion: initJson?.result?.protocolVersion || '2025-03-26',
        serverName: initJson?.result?.serverInfo?.name || 'cloudy-xkilo-vault-mcp',
        trustLevel: selectedKeyTrust,
        tools: toolNames,
      });
      await onRefreshState();
    } catch (err) {
      setMcpTestResult({
        ok: false,
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMcpTesting(false);
    }
  };

  const runAppScan = useCallback(
    async (opts?: {
      nameOverride?: string;
      urlOverride?: string;
      hintOverride?: CustomAppCapabilityHint;
      selectFirst?: boolean;
      passiveMount?: boolean;
    }) => {
      setScanningApps(true);
      setAutoConnectBanner(null);
      try {
        const res = await scanForAiApps({
          apiKey: activeKeyToken,
          origin,
          customAppName: opts?.nameOverride ?? customAppName,
          customAppUrl: opts?.urlOverride ?? customAppPortOrUrl,
          capabilityHint: opts?.hintOverride ?? capabilityHint,
          passiveMount: opts?.passiveMount,
        });
        setBridgeRunning(res.bridgeRunning);
        setDetectedApps(res.apps);
        if (res.apps.length > 0) {
          setSelectedAppId((prev) =>
            opts?.selectFirst || !res.apps.some((a) => a.id === prev)
              ? res.apps[0].id
              : prev
          );
        }
      } finally {
        setScanningApps(false);
      }
    },
    [activeKeyToken, origin, customAppName, customAppPortOrUrl, capabilityHint]
  );

  const scanLocalAiModels = useCallback(
    async (customOverride?: string, passiveMount = false) => {
      setScanningModels(true);
      try {
        const res = await detectLocalAiRuntimes(
          selectedKeyObj?.key,
          customOverride ?? customUrlInput,
          { passiveMount }
        );
        setBridgeRunning(res.bridgeRunning);
        setBridgeOnlineSync(res.bridgeOnlineSync);
        setDetectedRuntimes(res.detectedRuntimes);
        setLocalModels(res.models);
        if (res.models.length > 0) {
          setSelectedModelUid((prev) =>
            res.models.some((m) => m.uid === prev) ? prev : res.models[0].uid
          );
        }
      } finally {
        setScanningModels(false);
      }
    },
    [selectedKeyObj?.key, customUrlInput]
  );

  useEffect(() => {
    setMcpTestResult(null);
    scanLocalAiModels(undefined, true);
    runAppScan({ passiveMount: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyObj?.id, selectedKeyTrust]);

  const activeAppGuide =
    detectedApps.find((a) => a.id === selectedAppId) || detectedApps[0] || null;

  const selectedModel =
    localModels.find((m) => m.uid === selectedModelUid) ||
    localModels[0] ||
    null;

  const handleAutoConnectApp = async (appId: string) => {
    if (!selectedKeyObj) {
      setAutoConnectBanner('Please generate or select an active AI key first.');
      return;
    }
    setAutoConnectingAppId(appId);
    setAutoConnectBanner(null);
    try {
      const res = await autoConnectMcpAppViaBridge(appId, selectedKeyObj.key);
      setAutoConnectBanner(res.message);
    } catch (err) {
      setAutoConnectBanner(
        err instanceof Error ? err.message : 'Auto-connect failed'
      );
    } finally {
      setAutoConnectingAppId(null);
    }
  };

  const handleSendChat = async (promptOverride?: string) => {
    const text = (promptOverride ?? chatPrompt).trim();
    if (!text || !selectedModel || chatLoading) return;

    const nextHistory: ChatTurnMessage[] = [
      ...chatHistory,
      { role: 'user', content: text },
    ];
    setChatHistory(nextHistory);
    if (!promptOverride) setChatPrompt('');
    setChatError(null);
    setChatLoading(true);

    try {
      const { reply, usedSkills } = await askLocalAiWithVaultSkills({
        selectedModel,
        messages: nextHistory,
        vault,
        activeKey: selectedKeyObj,
        onSaveGeneratedNote,
        onRefreshVault: onRefreshState,
      });
      setChatHistory([
        ...nextHistory,
        { role: 'assistant', content: reply, skills: usedSkills },
      ]);
      await onRefreshState();
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'Failed to reach local AI model'
      );
    } finally {
      setChatLoading(false);
    }
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const created = await onCreateKey(
        name.trim(),
        trustLevel,
        folderRestriction === 'all' ? [] : [folderRestriction]
      );
      setName('');
      if (created) {
        setSelectedKeyId(created.id);
        setNewlyCreatedKey(created);
        setRevealedIds((prev) => ({ ...prev, [created.id]: true }));
      }
    } finally {
      setCreating(false);
    }
  };

  const runLiveTest = async () => {
    if (!selectedKeyObj) return;
    setTesting(true);
    try {
      if (isOffline) {
        try {
          const resp = await fetch(testEndpoint, {
            headers: {
              Authorization: `Bearer ${selectedKeyObj.key}`,
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
              trustLevel: selectedKeyTrust,
              files: (snap?.files || []).filter((f) => !f.trashed),
            },
            null,
            2
          )
        );
        return;
      }

      const res = await fetch(testEndpoint, {
        headers: { Authorization: `Bearer ${selectedKeyObj.key}` },
      });
      setTestOutput(JSON.stringify(await res.json(), null, 2));
      await onRefreshState();
    } catch (err) {
      setTestOutput(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    } finally {
      setTesting(false);
    }
  };

  const mcpSnippetByTab: Record<typeof mcpFormatTab, string> = {
    fast_json: JSON.stringify(
      {
        mcpServers: {
          'cloudy-vault': {
            url: fastMcpUrl,
          },
        },
      },
      null,
      2
    ),
    claude: JSON.stringify(
      {
        mcpServers: {
          'cloudy-vault': {
            command: 'npx',
            args: ['-y', 'mcp-remote', fastMcpUrl],
          },
        },
      },
      null,
      2
    ),
    headers: JSON.stringify(
      {
        mcpServers: {
          'cloudy-vault': {
            url: bareMcpUrl,
            headers: {
              Authorization: `Bearer ${activeKeyToken}`,
            },
          },
        },
      },
      null,
      2
    ),
    offline_py: JSON.stringify(
      {
        mcpServers: {
          'cloudy-vault': {
            command: 'python3',
            args: ['/path/to/Cloudy-PlugAndPlay-AI/cloudy_mcp_server.py'],
            env: {
              CLOUDY_API_KEY: activeKeyToken,
              CLOUDY_REMOTE_URL: origin,
            },
          },
        },
      },
      null,
      2
    ),
  };

  const ollamaCorsCmd =
    typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
      ? 'set OLLAMA_ORIGINS=* && ollama serve'
      : 'OLLAMA_ORIGINS="*" ollama serve';

  const ollamaSnippet = `import json, urllib.request

# Auto-fallback: Local Auto-Sync Bridge (127.0.0.1:8765) -> Online Cloud (${origin})
URLS = ["http://127.0.0.1:8765", "${origin}"]
API_KEY = "${activeKeyToken}" # Trust Level: ${selectedKeyTrust.toUpperCase()}

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
    cloudy(f"{'/api/v1/ai/files/' + h['id'] + '/content'}")["content"]
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

  const curlSnippet = `# MCP Fast Connection URL (${selectedKeyTrust.toUpperCase()} Trust · ${selectedTrustMeta.toolsCount} tools):
# ${fastMcpUrl}

# OpenAI-Compatible Local Bridge Base URL: http://127.0.0.1:8765/v1
# API Key: ${activeKeyToken}

# Check key status & trust level
curl -s "${origin}/api/v1/ai/status" -H "Authorization: Bearer ${activeKeyToken}"

# List accessible carpetas
curl -s "${origin}/api/v1/ai/folders" -H "Authorization: Bearer ${activeKeyToken}"`;

  const codeToDisplay = snippetTab === 'ollama' ? ollamaSnippet : curlSnippet;
  const selectedComposerMeta = getTrustMeta(trustLevel);

  return (
    <div className="flex-1 px-3.5 sm:px-8 py-5 sm:py-7 min-w-0">
      <div className="max-w-5xl mx-auto space-y-6 min-w-0">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-ink tracking-tight">
                AI Section &amp; MCP Fast Connection
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-semibold">
                Streamable HTTP MCP
              </span>
            </div>
            <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
              Generate scoped AI keys with <strong className="text-ink">Normal</strong>,{' '}
              <strong className="text-ink">Medium</strong>, or{' '}
              <strong className="text-ink">Proved</strong> trust levels and connect any MCP client in one click.
            </p>
          </div>
        </div>

        {/* SPOTLIGHT GRID: GENERATE KEY (TRUST LEVELS) + MCP FAST CONNECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-w-0">
          {/* LEFT CARD: GENERATE KEY + KEY TRUST LEVEL (Normal / Medium / Proved) */}
          <form
            onSubmit={handleGenerateKey}
            className="lg:col-span-6 rounded-3xl bg-surface border border-line-strong p-4 sm:p-5 shadow-card flex flex-col justify-between gap-4 min-w-0"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Generate Key
                    </h2>
                    <p className="text-[11px] text-ink-muted">
                      Choose Key Trust Level &amp; carpeta access
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full border text-[10.5px] font-semibold ${selectedComposerMeta.badgeClass}`}
                >
                  {selectedComposerMeta.label} · {selectedComposerMeta.toolsCount} tools
                </span>
              </div>

              {/* Key Name + Folder Scope */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Key name (optional, e.g. Cursor / Claude)"
                  className="sm:col-span-7 px-3.5 py-2.5 rounded-2xl bg-canvas border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
                />
                <select
                  value={folderRestriction}
                  onChange={(e) => setFolderRestriction(e.target.value)}
                  className="sm:col-span-5 px-3 py-2.5 rounded-2xl bg-canvas border border-line text-xs text-ink focus:outline-none truncate"
                >
                  <option value="all">Scope: All Carpetas</option>
                  {vault.folders
                    .filter((f) => !f.trashed)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        Only: {f.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Key Trust Level Selector: Normal / Medium / Proved */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    Key Trust Level
                  </span>
                  <span className="text-[11px] text-ink-secondary">
                    {selectedComposerMeta.subtitle}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {TRUST_LEVEL_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = trustLevel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTrustLevel(opt.id)}
                        className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1.5 min-w-0 ${
                          active
                            ? `${opt.ringClass} shadow-card`
                            : 'bg-canvas border-line hover:border-line-strong'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              active ? 'text-ink' : 'text-ink-muted'
                            }`}
                          />
                          <span className="text-[10px] font-mono text-ink-muted">
                            {opt.toolsCount}t
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-ink truncate">
                          {opt.label}
                        </div>
                        <div className="text-[10.5px] text-ink-secondary truncate">
                          {opt.subtitle}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-[11.5px] text-ink-secondary leading-relaxed px-0.5">
                  {selectedComposerMeta.summary}
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 px-4 rounded-2xl bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center justify-center gap-2 shadow-glow transition active:scale-[0.99] disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {creating
                  ? 'Generating Key...'
                  : `Generate ${selectedComposerMeta.label} Key`}
              </button>

              {newlyCreatedKey && (
                <div className="p-3 rounded-2xl bg-[#10A37F]/12 border border-[#10A37F]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#10A37F] flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Ready: {newlyCreatedKey.name} (
                        {resolveKeyTrust(newlyCreatedKey).toUpperCase()})
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-ink truncate mt-0.5">
                      {newlyCreatedKey.key}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyText('new_key', newlyCreatedKey.key)}
                      className="px-2.5 py-1.5 rounded-xl bg-surface hover:bg-elevated border border-line text-[11px] font-semibold text-ink inline-flex items-center gap-1 transition"
                    >
                      {copiedId === 'new_key' ? (
                        <>
                          <Check className="w-3 h-3 text-[#10A37F]" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Key
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'new_mcp',
                          `${origin}/api/mcp?key=${encodeURIComponent(newlyCreatedKey.key)}`
                        )
                      }
                      className="px-2.5 py-1.5 rounded-xl bg-accent text-accent-fg text-[11px] font-semibold inline-flex items-center gap-1 transition"
                    >
                      {copiedId === 'new_mcp' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3" /> MCP URL
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>

          {/* RIGHT CARD: MCP FAST CONNECTION (Zero-Install Instant Connect) */}
          <div className="lg:col-span-6 rounded-3xl bg-surface border border-line-strong p-4 sm:p-5 shadow-card flex flex-col justify-between gap-4 min-w-0">
            <div className="space-y-4 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-[#10A37F]/15 text-[#10A37F] flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-semibold text-ink">
                        MCP Fast Connection
                      </h2>
                      <span className="px-2 py-0.5 rounded-full bg-[#10A37F]/15 text-[#10A37F] text-[10px] font-semibold">
                        Zero Install
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-muted">
                      Instant remote &amp; local MCP endpoint — no Python or paths needed
                    </p>
                  </div>
                </div>

                {/* Linked Key Selector */}
                {vault.apiKeys.length > 0 && (
                  <select
                    value={selectedKeyObj?.id || ''}
                    onChange={(e) => setSelectedKeyId(e.target.value)}
                    title="Active key for MCP Fast Connection"
                    className="max-w-full sm:max-w-[210px] truncate px-3 py-1.5 rounded-full bg-canvas border border-line text-[11px] text-ink focus:outline-none"
                  >
                    {vault.apiKeys.map((k) => {
                      const tl = resolveKeyTrust(k);
                      return (
                        <option key={k.id} value={k.id} className="bg-surface">
                          {k.name} · {getTrustMeta(tl).label}
                          {!k.active ? ' (Paused)' : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {/* Instant MCP Server URL Copy Bar */}
              <div className="p-3 rounded-2xl bg-canvas border border-line space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-ink-secondary">
                    Instant MCP Server URL
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${selectedTrustMeta.badgeClass}`}
                  >
                    {selectedTrustMeta.label} Trust · {selectedTrustMeta.toolsCount} MCP Tools
                  </span>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface border border-line font-mono text-[11px] text-ink truncate">
                    {fastMcpUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('fast_mcp_url', fastMcpUrl)}
                    className="shrink-0 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow transition"
                  >
                    {copiedId === 'fast_mcp_url' ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy URL
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 1-Click Fast Launchers + Handshake Test */}
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={cursorInstallHref}
                  className="px-3 py-2 rounded-xl bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  1-Click Cursor
                </a>
                <a
                  href={vscodeInstallHref}
                  className="px-3 py-2 rounded-xl bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  1-Click VS Code
                </a>
                <button
                  type="button"
                  disabled={mcpTesting || !selectedKeyObj || isOffline}
                  onClick={runMcpFastTest}
                  className="px-3.5 py-2 rounded-xl bg-canvas hover:bg-elevated border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 transition disabled:opacity-50 ml-auto"
                >
                  <Play
                    className={`w-3.5 h-3.5 text-[#10A37F] ${
                      mcpTesting ? 'animate-pulse' : ''
                    }`}
                  />
                  {mcpTesting ? 'Testing MCP...' : 'Test Connection'}
                </button>
              </div>

              {/* Live Handshake Output */}
              {mcpTestResult && (
                <div
                  className={`p-3 rounded-2xl border text-xs space-y-2 ${
                    mcpTestResult.ok
                      ? 'bg-[#10A37F]/10 border-[#10A37F]/35 text-ink'
                      : 'bg-red-500/10 border-red-500/35 text-red-300'
                  }`}
                >
                  {mcpTestResult.ok ? (
                    <>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold text-[#10A37F] inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          MCP Connected ({mcpTestResult.latencyMs}ms ·{' '}
                          {mcpTestResult.protocolVersion})
                        </span>
                        <span className="text-[11px] text-ink-secondary">
                          {mcpTestResult.tools?.length || 0} tools unlocked
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(mcpTestResult.tools || []).map((tName) => (
                          <span
                            key={tName}
                            className="px-2 py-0.5 rounded-md bg-surface/90 border border-line text-[10.5px] font-mono text-ink"
                          >
                            {tName}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div>MCP Error: {mcpTestResult.error}</div>
                  )}
                </div>
              )}

              {/* Ready-to-Paste MCP Config Tabs */}
              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="inline-flex bg-canvas border border-line rounded-xl p-0.5 text-[11px] flex-wrap">
                    {(
                      [
                        { id: 'fast_json', label: 'Fast JSON' },
                        { id: 'claude', label: 'Claude Desktop' },
                        { id: 'headers', label: 'Headers' },
                        { id: 'offline_py', label: 'Offline .py' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMcpFormatTab(t.id)}
                        className={`px-2.5 py-1 rounded-lg font-medium transition ${
                          mcpFormatTab === t.id
                            ? 'bg-accent text-accent-fg'
                            : 'text-ink-secondary hover:text-ink'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      copyText('mcp_cfg_box', mcpSnippetByTab[mcpFormatTab])
                    }
                    className="text-xs text-accent hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    {copiedId === 'mcp_cfg_box' ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copied Config
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy JSON
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-3 rounded-2xl bg-canvas border border-line text-[11px] font-mono text-ink max-w-full overflow-x-auto leading-relaxed max-h-36">
                  {mcpSnippetByTab[mcpFormatTab]}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* LOWER WORKSPACE TABS */}
        <div className="grid grid-cols-3 sm:inline-flex bg-surface border border-line-strong rounded-2xl sm:rounded-full p-1 text-xs shadow-card w-full sm:w-fit">
          {[
            {
              id: 'keys' as const,
              label: `Keys & Trust (${vault.apiKeys.length})`,
              icon: ShieldCheck,
            },
            {
              id: 'apps_chat' as const,
              label: 'App Scanner & Chat',
              icon: PlugZap,
            },
            {
              id: 'rest_code' as const,
              label: 'REST & Snippets',
              icon: Terminal,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = sectionTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSectionTab(tab.id)}
                className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-xl sm:rounded-full font-medium inline-flex items-center justify-center gap-1.5 transition-colors min-w-0 ${
                  active
                    ? 'bg-accent text-accent-fg shadow-glow'
                    : 'text-ink-secondary hover:text-ink'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {sectionTab === 'keys' ? (
            <motion.div
              key="keys"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="space-y-4"
            >
              <div className="rounded-3xl bg-surface border border-line divide-y divide-line overflow-hidden shadow-card">
                {vault.apiKeys.map((k) => {
                  const revealed = Boolean(revealedIds[k.id]);
                  const kTrust = resolveKeyTrust(k);
                  const kMeta = getTrustMeta(kTrust);
                  const isSelected = selectedKeyObj?.id === k.id;
                  const folderLabels =
                    k.allowedFolderIds.length === 0
                      ? 'All Carpetas'
                      : k.allowedFolderIds
                          .map(
                            (fid) =>
                              vault.folders.find((fl) => fl.id === fid)?.name ||
                              fid
                          )
                          .join(', ');

                  return (
                    <div
                      key={k.id}
                      className={`px-4 sm:px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 transition-colors ${
                        isSelected ? 'bg-accent-soft/25' : 'hover:bg-elevated/40'
                      }`}
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedKeyId(k.id)}
                            className="text-[13.5px] font-semibold text-ink hover:text-accent inline-flex items-center gap-1.5 text-left"
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isSelected ? 'bg-accent' : 'bg-line-strong'
                              }`}
                            />
                            {k.name}
                          </button>

                          <span
                            className={`text-[10.5px] px-2.5 py-0.5 rounded-full border font-semibold ${kMeta.badgeClass}`}
                          >
                            {kMeta.label} Trust
                          </span>

                          <span
                            className={`text-[10.5px] px-2.5 py-0.5 rounded-full font-medium ${
                              k.active
                                ? 'bg-[#10A37F]/15 text-[#10A37F]'
                                : 'bg-elevated text-ink-muted'
                            }`}
                          >
                            {k.active ? 'Active' : 'Paused'}
                          </span>

                          <span className="text-[10.5px] px-2.5 py-0.5 rounded-full bg-elevated text-ink-secondary">
                            {folderLabels}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono text-ink-muted min-w-0">
                          <span className="truncate max-w-full">
                            {revealed ? k.key : k.keyPrefix}
                          </span>
                          <span className="text-[11px] font-sans shrink-0">
                            · {k.usageCount || 0} calls ·{' '}
                            {formatRelativeTime(k.lastUsedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                        {/* Inline Live Key Trust Level Switcher */}
                        <div
                          className="inline-flex bg-canvas border border-line rounded-xl p-0.5 text-[11px]"
                          title="Switch Key Trust Level"
                        >
                          {TRUST_LEVEL_OPTIONS.map((opt) => {
                            const active = kTrust === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => onUpdateKeyTrustLevel(k, opt.id)}
                                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                                  active
                                    ? 'bg-accent text-accent-fg shadow-sm'
                                    : 'text-ink-muted hover:text-ink'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setRevealedIds((p) => ({ ...p, [k.id]: !p[k.id] }))
                          }
                          className="p-2 rounded-xl bg-elevated hover:bg-canvas text-ink-secondary hover:text-ink transition"
                          title={revealed ? 'Hide key' : 'Reveal key'}
                        >
                          {revealed ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => copyText(k.id, k.key)}
                          className="px-3 py-1.5 rounded-full bg-accent-soft hover:bg-accent text-accent hover:text-accent-fg text-xs font-semibold inline-flex items-center gap-1 transition"
                        >
                          {copiedId === k.id ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Key
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Key
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              `mcp_${k.id}`,
                              `${origin}/api/mcp?key=${encodeURIComponent(k.key)}`
                            )
                          }
                          className="px-3 py-1.5 rounded-full bg-elevated hover:bg-accent hover:text-accent-fg border border-line text-xs font-semibold text-ink inline-flex items-center gap-1 transition"
                        >
                          {copiedId === `mcp_${k.id}` ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#10A37F]" /> MCP
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5 text-[#10A37F]" /> MCP URL
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={isOffline}
                          onClick={() => onToggleKeyActive(k)}
                          className="px-3 py-1.5 rounded-full bg-elevated hover:bg-canvas text-xs text-ink-secondary hover:text-ink transition disabled:opacity-50"
                        >
                          {k.active ? 'Pause' : 'Enable'}
                        </button>

                        {vault.apiKeys.length > 1 && (
                          <button
                            type="button"
                            disabled={isOffline}
                            onClick={() => onDeleteKey(k.id)}
                            className="p-2 rounded-xl text-ink-muted hover:text-red-400 hover:bg-elevated transition disabled:opacity-50"
                            title="Revoke key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : sectionTab === 'apps_chat' ? (
            <motion.div
              key="apps_chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="space-y-6"
            >
              {/* SCAN FOR AI APPS */}
              <div className="rounded-3xl bg-surface border border-line-strong p-5 sm:p-6 shadow-card space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                      <Radar
                        className={`w-5 h-5 ${scanningApps ? 'animate-spin' : ''}`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">
                          Scan for AI Apps
                        </span>
                        {detectedApps.length > 0 ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-[#10A37F]/15 text-[#10A37F] text-[11px] font-medium">
                            {detectedApps.length} AI app
                            {detectedApps.length === 1 ? '' : 's'} detected
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-elevated text-ink-muted text-[11px] font-medium">
                            Ready to scan ports &amp; apps
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Detects installed/running AI apps and generates pre-linked MCP Fast Connection configs.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={scanningApps}
                    onClick={() => {
                      runAppScan();
                      scanLocalAiModels();
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-glow transition shrink-0"
                  >
                    <Radar
                      className={`w-3.5 h-3.5 ${scanningApps ? 'animate-spin' : ''}`}
                    />
                    {scanningApps ? 'Scanning Apps...' : 'Scan for Apps'}
                  </button>
                </div>

                {/* Presets + Custom App Matcher */}
                <div className="rounded-2xl bg-canvas border border-line p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-ink-secondary">
                      Tap any AI client for instant pre-linked setup:
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {POPULAR_APP_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setCustomAppName(preset);
                            runAppScan({
                              nameOverride: preset,
                              hintOverride: 'auto',
                              selectFirst: true,
                            });
                          }}
                          className="px-2.5 py-1 rounded-full bg-surface hover:bg-elevated border border-line text-[10.5px] text-ink-secondary hover:text-ink transition"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runAppScan({ selectFirst: true });
                    }}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                  >
                    <input
                      type="text"
                      value={customAppName}
                      onChange={(e) => setCustomAppName(e.target.value)}
                      placeholder="App name (e.g. Cursor, Cline, Local)"
                      className="sm:col-span-4 px-3.5 py-2 rounded-xl bg-surface border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
                    />
                    <input
                      type="text"
                      value={customAppPortOrUrl}
                      onChange={(e) => setCustomAppPortOrUrl(e.target.value)}
                      placeholder="Port or URL if running (e.g. 5000)"
                      className="sm:col-span-3 px-3.5 py-2 rounded-xl bg-surface border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
                    />
                    <select
                      value={capabilityHint}
                      onChange={(e) =>
                        setCapabilityHint(
                          e.target.value as CustomAppCapabilityHint
                        )
                      }
                      className="sm:col-span-3 px-3 py-2 rounded-xl bg-surface border border-line text-xs text-ink focus:outline-none"
                    >
                      <option value="auto">Auto-Detect Best Way</option>
                      <option value="mcp">App Supports MCP</option>
                      <option value="openai_url">App Supports OpenAI URL</option>
                      <option value="custom_code">Custom App / Code</option>
                    </select>
                    <button
                      type="submit"
                      disabled={scanningApps}
                      className="sm:col-span-2 px-3.5 py-2 rounded-xl bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-xs font-semibold text-ink inline-flex items-center justify-center gap-1.5 transition"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Detect
                    </button>
                  </form>
                </div>

                {detectedApps.length > 0 && activeAppGuide ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      {detectedApps.map((app) => {
                        const selected = app.id === activeAppGuide.id;
                        return (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => {
                              setSelectedAppId(app.id);
                              setAutoConnectBanner(null);
                            }}
                            className={`px-3.5 py-2 rounded-2xl border text-xs font-medium inline-flex items-center gap-2 transition ${
                              selected
                                ? 'bg-accent-soft border-accent text-ink shadow-card'
                                : 'bg-canvas border-line hover:border-line-strong text-ink-secondary hover:text-ink'
                            }`}
                          >
                            <AppWindow className="w-3.5 h-3.5 text-accent" />
                            <span>{app.name}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-2xl bg-canvas border border-line-strong p-4 sm:p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-ink">
                              Connect Cloudy → {activeAppGuide.name}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full bg-[#10A37F]/15 text-[#10A37F] text-[11px] font-semibold">
                              ✓ {activeAppGuide.bestMethodBadge}
                            </span>
                          </div>
                          <p className="text-xs text-ink-secondary mt-1 leading-relaxed">
                            {activeAppGuide.whyBest}
                          </p>
                        </div>
                      </div>

                      {autoConnectBanner && (
                        <div className="px-3.5 py-2.5 rounded-xl bg-[#10A37F]/15 border border-[#10A37F]/40 text-xs text-[#10A37F] flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{autoConnectBanner}</span>
                        </div>
                      )}

                      <div className="space-y-3">
                        {activeAppGuide.steps.map((step) => {
                          const action = step.action;
                          return (
                            <div
                              key={step.stepNumber}
                              className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface border border-line"
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                                  {step.stepNumber}
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-xs font-semibold text-ink">
                                    {step.title}
                                  </div>
                                  <p className="text-[11.5px] text-ink-secondary leading-relaxed">
                                    {step.detail}
                                  </p>
                                </div>
                              </div>

                              {action && (
                                <div className="shrink-0 pl-9 md:pl-0">
                                  {action.type === 'download_zip' && (
                                    <a
                                      href={offlineZipHref}
                                      className="px-3.5 py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow transition"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {action.label}
                                    </a>
                                  )}
                                  {action.type === 'download_openwebui' && (
                                    <a
                                      href={openWebUiHref}
                                      className="px-3.5 py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow transition"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {action.label}
                                    </a>
                                  )}
                                  {action.type === 'copy' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        copyText(action.id, action.value)
                                      }
                                      className="px-3.5 py-2 rounded-full bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 transition"
                                    >
                                      {copiedId === action.id ? (
                                        <>
                                          <Check className="w-3.5 h-3.5 text-[#10A37F]" />
                                          Copied!
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3.5 h-3.5" />
                                          {action.label}
                                        </>
                                      )}
                                    </button>
                                  )}
                                  {action.type === 'auto_connect_mcp' && (
                                    <button
                                      type="button"
                                      disabled={
                                        autoConnectingAppId === action.appId
                                      }
                                      onClick={() =>
                                        handleAutoConnectApp(action.appId)
                                      }
                                      className="px-4 py-2 rounded-full bg-[#10A37F] hover:opacity-90 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-card transition disabled:opacity-50"
                                    >
                                      <Wand2 className="w-3.5 h-3.5" />
                                      {autoConnectingAppId === action.appId
                                        ? 'Connecting...'
                                        : action.label}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-canvas border border-line p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-ink-secondary leading-relaxed">
                      Tap a preset chip above (like <strong className="text-ink">Cursor</strong> or{' '}
                      <strong className="text-ink">Claude Desktop</strong>) for instant setup, or download the offline local bridge.
                    </div>
                    <a
                      href={offlineZipHref}
                      className="px-4 py-2 rounded-full bg-surface hover:bg-elevated border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 shrink-0 transition"
                    >
                      <Download className="w-3.5 h-3.5 text-accent" />
                      Offline Bridge (.zip)
                    </a>
                  </div>
                )}
              </div>

              {/* BUILT-IN VAULT CHAT */}
              <div className="rounded-3xl bg-surface border border-line p-5 sm:p-6 shadow-card space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">
                          Chat Directly With Your Local AI Models
                        </span>
                        {localModels.length > 0 ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-[#10A37F]/15 text-[#10A37F] text-[11px] font-medium">
                            {localModels.length} model
                            {localModels.length === 1 ? '' : 's'} ready
                            {detectedRuntimes.length > 0
                              ? ` · ${detectedRuntimes.join(', ')}`
                              : ''}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-elevated text-ink-muted text-[11px] font-medium">
                            {bridgeRunning
                              ? 'Bridge Active · Start Ollama or LM Studio'
                              : 'No local runtime open'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Test local models against your Cloudy carpetas &amp; files right here
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowCustomUrl((v) => !v)}
                      className="px-3 py-2 rounded-full bg-canvas hover:bg-elevated border border-line text-xs text-ink-secondary hover:text-ink inline-flex items-center gap-1.5 transition"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Custom Port
                    </button>

                    <button
                      type="button"
                      disabled={scanningModels}
                      onClick={() => scanLocalAiModels()}
                      className="px-3.5 py-2 rounded-full bg-elevated hover:bg-canvas border border-line-strong text-xs font-medium text-ink inline-flex items-center gap-1.5 transition"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          scanningModels ? 'animate-spin' : ''
                        }`}
                      />
                      Refresh Models
                    </button>
                  </div>
                </div>

                {showCustomUrl && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 rounded-2xl bg-canvas border border-line">
                    <input
                      type="text"
                      value={customUrlInput}
                      onChange={(e) => setCustomUrlInput(e.target.value)}
                      placeholder="Custom local OpenAI/Ollama URL (e.g. http://127.0.0.1:5000)"
                      className="flex-1 px-3.5 py-2 rounded-xl bg-surface border border-line text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        saveCustomLocalAiUrl(customUrlInput);
                        scanLocalAiModels(customUrlInput);
                      }}
                      className="px-4 py-2 rounded-xl bg-elevated hover:bg-accent hover:text-accent-fg text-xs font-medium text-ink transition"
                    >
                      Save &amp; Scan
                    </button>
                  </div>
                )}

                {localModels.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-canvas border border-line">
                      <span className="text-[11px] text-ink-muted shrink-0">
                        Active Local Model:
                      </span>
                      <select
                        value={selectedModel?.uid || ''}
                        onChange={(e) => setSelectedModelUid(e.target.value)}
                        className="flex-1 bg-transparent text-xs font-medium text-ink focus:outline-none truncate"
                      >
                        {localModels.map((m) => (
                          <option
                            key={m.uid}
                            value={m.uid}
                            className="bg-surface"
                          >
                            {m.name} ({m.providerName})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-2xl bg-canvas border border-line p-4 space-y-3">
                      {chatHistory.length === 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-ink-muted mr-1">
                            Try a Vault Skill:
                          </span>
                          {[
                            'Read my files and summarize them',
                            'What carpetas and notes are in my vault?',
                          ].map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => handleSendChat(q)}
                              className="px-3 py-1.5 rounded-full bg-surface hover:bg-elevated border border-line text-[11px] text-ink-secondary hover:text-ink transition"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                          {chatHistory.map((turn, idx) => (
                            <div
                              key={idx}
                              className={`flex flex-col ${
                                turn.role === 'user'
                                  ? 'items-end'
                                  : 'items-start'
                              }`}
                            >
                              {turn.skills && turn.skills.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-1.5">
                                  {turn.skills.map((s, sIdx) => (
                                    <span
                                      key={sIdx}
                                      className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[10px] font-mono"
                                    >
                                      ⚡ {s.skill}({s.detail})
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div
                                className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-xs whitespace-pre-wrap leading-relaxed ${
                                  turn.role === 'user'
                                    ? 'bg-accent text-accent-fg'
                                    : 'bg-surface border border-line text-ink'
                                }`}
                              >
                                {turn.content}
                              </div>
                            </div>
                          ))}
                          {chatLoading && (
                            <div className="text-xs text-ink-muted animate-pulse px-1">
                              Reading vault files &amp; thinking locally...
                            </div>
                          )}
                        </div>
                      )}

                      {chatError && (
                        <div className="text-xs text-red-400 px-1">
                          {chatError}
                        </div>
                      )}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSendChat();
                        }}
                        className="flex items-center gap-2 pt-1"
                      >
                        <input
                          type="text"
                          value={chatPrompt}
                          onChange={(e) => setChatPrompt(e.target.value)}
                          placeholder={`Ask ${selectedModel?.name || 'Local AI'} about your Cloudy files...`}
                          className="flex-1 px-4 py-2.5 rounded-full bg-surface border border-line focus:border-accent focus:outline-none text-xs text-ink placeholder:text-ink-muted"
                        />
                        <button
                          type="submit"
                          disabled={chatLoading || !chatPrompt.trim()}
                          className="p-2.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50 transition shadow-glow"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-ink-muted">
                    Start Ollama (
                    <button
                      type="button"
                      onClick={() => copyText('cors', ollamaCorsCmd)}
                      className="text-accent hover:underline font-mono"
                    >
                      {copiedId === 'cors' ? 'Copied!' : ollamaCorsCmd}
                    </button>
                    ) or use <strong className="text-ink">MCP Fast Connection</strong> above with any desktop AI client.
                  </div>
                )}
              </div>

              {/* Offline Bridge & OpenWebUI Downloads */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-3xl bg-surface border border-line p-5 flex flex-col justify-between gap-4 shadow-card">
                  <div className="space-y-2">
                    <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                      <Blocks className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      Offline Plug &amp; Play Bridge (.zip)
                    </h3>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Includes local 15s Auto-Sync server (<code className="text-ink">127.0.0.1:8765/v1</code>) + zero-dependency offline Python MCP script.
                    </p>
                  </div>
                  <a
                    href={offlineZipHref}
                    className="w-full py-2.5 px-4 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-glow transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Plug &amp; Play Pack (.zip)
                  </a>
                </div>

                <div className="rounded-3xl bg-surface border border-line p-5 flex flex-col justify-between gap-4 shadow-card">
                  <div className="space-y-2">
                    <div className="w-9 h-9 rounded-xl bg-[#10A37F]/15 text-[#10A37F] flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      OpenWebUI 1-Click Tool (.py)
                    </h3>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Pre-linked with <strong className="text-ink">{selectedKeyObj?.name || 'your key'}</strong>. Import once in{' '}
                      <span className="text-ink">Workspace → Tools</span>.
                    </p>
                  </div>
                  <a
                    href={openWebUiHref}
                    className="w-full py-2.5 px-4 rounded-full bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-ink text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download OpenWebUI Skill (.py)
                  </a>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="rest_code"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-w-0"
            >
              <div className="lg:col-span-7 min-w-0 rounded-3xl bg-surface border border-line p-4 sm:p-5 space-y-4 shadow-card">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="inline-flex bg-canvas border border-line rounded-full p-1 text-xs">
                    {(['ollama', 'curl'] as const).map((tab) => {
                      const active = snippetTab === tab;
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setSnippetTab(tab)}
                          className={`px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                            active
                              ? 'bg-accent text-accent-fg shadow-glow'
                              : 'text-ink-secondary hover:text-ink'
                          }`}
                        >
                          {tab === 'ollama' ? 'Python + Local LLM' : 'cURL & MCP'}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
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

                <pre className="p-3.5 sm:p-4 rounded-2xl bg-canvas border border-line text-xs font-mono text-ink max-w-full overflow-x-auto leading-relaxed">
                  {codeToDisplay}
                </pre>
              </div>

              <div className="lg:col-span-5 min-w-0 rounded-3xl bg-surface border border-line p-4 sm:p-5 space-y-4 shadow-card">
                <div className="text-xs font-medium text-ink-secondary">
                  Interactive Endpoint Tester ({selectedTrustMeta.label} Trust)
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <select
                    value={testEndpoint}
                    onChange={(e) => setTestEndpoint(e.target.value)}
                    className="min-w-0 flex-1 truncate px-3 py-2 rounded-2xl bg-canvas border border-line text-xs font-mono text-ink focus:outline-none"
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
                  </select>
                  <button
                    type="button"
                    onClick={runLiveTest}
                    disabled={testing || !selectedKeyObj}
                    className="shrink-0 px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center gap-1.5 shadow-glow transition disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Run
                  </button>
                </div>

                <pre className="p-3.5 sm:p-4 rounded-2xl bg-canvas border border-line text-[11px] font-mono text-ink-secondary h-52 max-w-full overflow-auto">
                  {testOutput || '// Tap Run to inspect live JSON response'}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
