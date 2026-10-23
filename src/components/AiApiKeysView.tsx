import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Play,
  Download,
  Sparkles,
  RefreshCw,
  Send,
  PlugZap,
  KeyRound,
  Cpu,
  Terminal,
  Blocks,
  SlidersHorizontal,
  Radar,
  Wand2,
  CheckCircle2,
  AppWindow,
} from 'lucide-react';
import type { VaultState, AiApiKey } from '../types';
import { formatRelativeTime } from '../lib/format';
import { getOrCreateVaultId } from '../lib/vaultClient';
import { loadOfflineSnapshot } from '../lib/offlineDb';
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
    scope: 'read' | 'read_write',
    allowedFolderIds: string[]
  ) => Promise<void>;
  onToggleKeyActive: (key: AiApiKey) => Promise<void>;
  onDeleteKey: (keyId: string) => Promise<void>;
  onRefreshState: () => Promise<void>;
  onSaveGeneratedNote?: (
    name: string,
    content: string,
    folderId: string | null
  ) => Promise<void>;
}

const POPULAR_APP_PRESETS = [
  'Cursor',
  'Claude Desktop',
  'LM Studio',
  'OpenWebUI',
  'ChatBox',
  'AnythingLLM',
  'Jan',
];

export const AiApiKeysView: React.FC<AiApiKeysViewProps> = ({
  vault,
  isOffline,
  onCreateKey,
  onToggleKeyActive,
  onDeleteKey,
  onRefreshState,
  onSaveGeneratedNote,
}) => {
  const [viewMode, setViewMode] = useState<'plug_play' | 'keys_code'>('plug_play');

  // Key selection for Plug & Play
  const activeKeys = vault.apiKeys.filter((k) => k.active);
  const [selectedKeyId, setSelectedKeyId] = useState<string>(
    activeKeys[0]?.id || vault.apiKeys[0]?.id || ''
  );

  const selectedKeyObj =
    vault.apiKeys.find((k) => k.id === selectedKeyId && k.active) ||
    activeKeys[0] ||
    vault.apiKeys[0] ||
    null;

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://127.0.0.1:3000';
  const vaultIdParam = encodeURIComponent(getOrCreateVaultId());
  const keyIdParam = selectedKeyObj
    ? `&keyId=${encodeURIComponent(selectedKeyObj.id)}`
    : '';
  const activeKeyToken = selectedKeyObj?.key || 'cldy_sk_YOUR_KEY';

  const offlineZipHref = `/api/ai-keys/offline-bundle.zip?vaultId=${vaultIdParam}${keyIdParam}`;
  const openWebUiHref = `/api/ai-keys/openwebui-tool.py?vaultId=${vaultIdParam}${keyIdParam}`;

  // --- Scan for AI Apps State ---
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

  // --- Local AI Model Scanner & Built-in Vault Chat State ---
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

  // --- Key Management & Developer Code Tab State ---
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read');
  const [folderRestriction, setFolderRestriction] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<'ollama' | 'curl'>('ollama');
  const [testEndpoint, setTestEndpoint] = useState<string>('/api/v1/ai/status');
  const [testOutput, setTestOutput] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2200);
  };

  const runAppScan = useCallback(
    async (opts?: {
      nameOverride?: string;
      urlOverride?: string;
      hintOverride?: CustomAppCapabilityHint;
      selectFirst?: boolean;
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
    async (customOverride?: string) => {
      setScanningModels(true);
      try {
        const res = await detectLocalAiRuntimes(
          selectedKeyObj?.key,
          customOverride ?? customUrlInput
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
    scanLocalAiModels();
    runAppScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyObj?.id]);

  const activeAppGuide =
    detectedApps.find((a) => a.id === selectedAppId) || detectedApps[0] || null;

  const selectedModel =
    localModels.find((m) => m.uid === selectedModelUid) || localModels[0] || null;

  const handleAutoConnectApp = async (appId: string) => {
    if (!selectedKeyObj) {
      setAutoConnectBanner(
        'Please create or resume an active AI API key under Keys & Permissions first.'
      );
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

  const mcpConfigSnippet = JSON.stringify(
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
  );

  const ollamaCorsCmd =
    typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
      ? 'set OLLAMA_ORIGINS=* && ollama serve'
      : 'OLLAMA_ORIGINS="*" ollama serve';

  const ollamaSnippet = `import json, urllib.request

# Auto-fallback: Local Auto-Sync Bridge (127.0.0.1:8765) -> Online Cloud (${origin})
URLS = ["http://127.0.0.1:8765", "${origin}"]
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

  const curlSnippet = `# OpenAI-Compatible Plug & Play Endpoint (Paste in Cursor / OpenWebUI / ChatBox)
# Base URL: http://127.0.0.1:8765/v1
# API Key:  ${activeKeyToken}

# List accessible carpetas
curl -s "${origin}/api/v1/ai/folders" -H "Authorization: Bearer ${activeKeyToken}"

# Read file content skill
curl -s "${origin}/api/v1/ai/files/fil_welcome/content" -H "Authorization: Bearer ${activeKeyToken}"`;

  const codeToDisplay = snippetTab === 'ollama' ? ollamaSnippet : curlSnippet;

  return (
    <div className="flex-1 px-4 sm:px-8 py-7">
      <div className="max-w-5xl mx-auto space-y-7">
        {/* Header + Segmented Mode Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">
              Plug & Play Local AI
            </h1>
            <p className="text-xs text-ink-secondary mt-1">
              Scan your AI apps for automatic setup instructions, or chat directly with your offline & online models.
            </p>
          </div>

          <div className="inline-flex bg-surface border border-line-strong rounded-full p-1 text-xs shadow-card w-fit">
            {[
              { id: 'plug_play' as const, label: 'Plug & Play', icon: PlugZap },
              { id: 'keys_code' as const, label: 'API Keys & Code', icon: KeyRound },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setViewMode(tab.id)}
                  className={`relative px-4 py-1.5 rounded-full font-medium inline-flex items-center gap-1.5 transition-colors ${
                    active ? 'text-accent-fg' : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="aiViewModePill"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-accent shadow-glow"
                    />
                  )}
                  <Icon className="relative z-10 w-3.5 h-3.5" />
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {viewMode === 'plug_play' ? (
            <motion.div
              key="plug_play"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              {/* CARD 1: SCAN FOR AI APPS (Auto-Detects Best Way + Gives Tailored Instructions) */}
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
                            Ready to scan ports & apps
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Scans local AI apps, automatically picks the best connection method, and gives exact 1-click steps.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selectedKeyObj?.id || ''}
                      onChange={(e) => setSelectedKeyId(e.target.value)}
                      title="Choose which Cloudy permission key to link"
                      className="px-3 py-2 rounded-full bg-canvas border border-line text-xs text-ink focus:outline-none"
                    >
                      {activeKeys.map((k) => (
                        <option key={k.id} value={k.id} className="bg-surface">
                          Key: {k.name} (
                          {k.scope === 'read_write' ? 'Read & Write' : 'Read'})
                        </option>
                      ))}
                    </select>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      type="button"
                      disabled={scanningApps}
                      onClick={() => {
                        runAppScan();
                        scanLocalAiModels();
                      }}
                      className="px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center gap-1.5 shadow-glow transition"
                    >
                      <Radar
                        className={`w-3.5 h-3.5 ${scanningApps ? 'animate-spin' : ''}`}
                      />
                      {scanningApps ? 'Scanning Apps...' : 'Scan for Apps'}
                    </motion.button>
                  </div>
                </div>

                {/* Custom / Unlisted App Matcher (e.g. "Local") + Popular Presets */}
                <div className="rounded-2xl bg-canvas border border-line p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-ink-secondary">
                      Connecting a desktop or custom app (like &ldquo;Local&rdquo;)? Enter it or tap below to auto-detect the best way:
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
                      placeholder="App name (e.g. Local)"
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
                        setCapabilityHint(e.target.value as CustomAppCapabilityHint)
                      }
                      className="sm:col-span-3 px-3 py-2 rounded-xl bg-surface border border-line text-xs text-ink focus:outline-none"
                    >
                      <option value="auto">Auto-Detect Best Way</option>
                      <option value="mcp">App Supports MCP / Plugins</option>
                      <option value="openai_url">App Supports OpenAI URL</option>
                      <option value="custom_code">My Own Custom App / Code</option>
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

                {/* Detected Apps Selector + Tailored Best-Way Instructions */}
                {detectedApps.length > 0 && activeAppGuide ? (
                  <div className="space-y-4">
                    {/* App Pills */}
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
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] ${
                                app.status === 'running'
                                  ? 'bg-[#10A37F]/15 text-[#10A37F]'
                                  : app.status === 'installed'
                                    ? 'bg-accent-soft text-accent'
                                    : 'bg-elevated text-ink-muted'
                              }`}
                            >
                              {app.status === 'running'
                                ? `Running${app.endpoint ? ` · ${app.endpoint.replace('http://127.0.0.1', '')}` : ''}`
                                : app.status === 'installed'
                                  ? 'Installed'
                                  : 'Matched'}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Tailored Best-Method Recommendation + Step-by-Step Guide */}
                    <motion.div
                      key={activeAppGuide.id + activeAppGuide.bestMethod}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-2xl bg-canvas border border-line-strong p-4 sm:p-5 space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-ink">
                              How to Connect Cloudy → {activeAppGuide.name}
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
                    </motion.div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-canvas border border-line p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-ink-secondary leading-relaxed">
                      No open local AI ports responded yet. Type your app name above (for example{' '}
                      <strong className="text-ink">Local</strong>), tap a preset chip, or run{' '}
                      <span className="font-mono text-ink">Start-Cloudy-AI</span> so Cloudy can scan installed desktop apps automatically.
                    </div>
                    <a
                      href={offlineZipHref}
                      className="px-4 py-2 rounded-full bg-surface hover:bg-elevated border border-line-strong text-xs font-semibold text-ink inline-flex items-center gap-1.5 shrink-0 transition"
                    >
                      <Download className="w-3.5 h-3.5 text-accent" />
                      Download Bridge (.zip)
                    </a>
                  </div>
                )}
              </div>

              {/* CARD 2: INSTANT LOCAL MODEL SCANNER + BUILT-IN VAULT CHAT */}
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
                        ) : bridgeRunning ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-medium">
                            Bridge Active · Start Ollama or LM Studio
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-elevated text-ink-muted text-[11px] font-medium">
                            No active model server yet
                          </span>
                        )}
                        {bridgeRunning && (
                          <span className="px-2 py-0.5 rounded-full bg-canvas border border-line text-[10px] text-ink-secondary">
                            {bridgeOnlineSync ? 'Auto-Sync Live' : 'Offline Vault Active'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Test your local models against your Cloudy files right here (works offline & online)
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
                        className={`w-3.5 h-3.5 ${scanningModels ? 'animate-spin' : ''}`}
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
                      Save & Scan
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
                          <option key={m.uid} value={m.uid} className="bg-surface">
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
                            'Read Quickstart.md and list key points',
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
                                turn.role === 'user' ? 'items-end' : 'items-start'
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
                              Reading vault files & thinking locally...
                            </div>
                          )}
                        </div>
                      )}

                      {chatError && (
                        <div className="text-xs text-red-400 px-1">{chatError}</div>
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
                  <div className="text-xs text-ink-muted flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Start Ollama (<button
                        type="button"
                        onClick={() => copyText('cors', ollamaCorsCmd)}
                        className="text-accent hover:underline font-mono"
                      >
                        {copiedId === 'cors' ? 'Copied!' : ollamaCorsCmd}
                      </button>) or launch <span className="text-ink font-mono">Start-Cloudy-AI</span> to chat right here.
                    </span>
                  </div>
                )}
              </div>

              {/* 3 Quick Plug & Play Download / Copy Tiles */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-3xl bg-surface border border-line p-5 flex flex-col justify-between gap-4 shadow-card">
                  <div className="space-y-2">
                    <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      Double-Click AI Bridge
                    </h3>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Windows <code className="text-ink">.bat</code>, Mac{' '}
                      <code className="text-ink">.command</code> & Linux{' '}
                      <code className="text-ink">.sh</code> launchers + 15s Live Auto-Sync + deep desktop AI app scanner.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={offlineZipHref}
                      className="w-full py-2.5 px-4 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-glow transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Plug & Play Pack (.zip)
                    </a>
                    <button
                      type="button"
                      onClick={() => copyText('v1url', 'http://127.0.0.1:8765/v1')}
                      className="w-full py-2 px-3 rounded-full bg-canvas hover:bg-elevated border border-line text-[11px] text-ink-secondary hover:text-ink inline-flex items-center justify-center gap-1.5 transition"
                    >
                      {copiedId === 'v1url' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#10A37F]" /> Copied /v1 URL
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy Local /v1 Base URL
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl bg-surface border border-line p-5 flex flex-col justify-between gap-4 shadow-card">
                  <div className="space-y-2">
                    <div className="w-9 h-9 rounded-xl bg-[#10A37F]/15 text-[#10A37F] flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      OpenWebUI 1-Click Skill
                    </h3>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Pre-filled with your API key & Online/Offline fallback URLs. Import once in{' '}
                      <span className="text-ink">Workspace → Tools</span>.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={openWebUiHref}
                      className="w-full py-2.5 px-4 rounded-full bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-ink text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Skill (.py)
                    </a>
                    <button
                      type="button"
                      onClick={() => copyText('quickkey', activeKeyToken)}
                      className="w-full py-2 px-3 rounded-full bg-canvas hover:bg-elevated border border-line text-[11px] text-ink-secondary hover:text-ink inline-flex items-center justify-center gap-1.5 transition"
                    >
                      {copiedId === 'quickkey' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#10A37F]" /> Copied API Key
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy Pre-Linked API Key
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl bg-surface border border-line p-5 flex flex-col justify-between gap-4 shadow-card">
                  <div className="space-y-2">
                    <div className="w-9 h-9 rounded-xl bg-[#D97757]/15 text-[#E58A6B] flex items-center justify-center">
                      <Blocks className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      MCP 1-Click Config
                    </h3>
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Zero-dependency MCP server (<code className="text-ink">cloudy_mcp_server.py</code>) for LM Studio, Claude Desktop, Cursor & Windsurf.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => copyText('mcpjson', mcpConfigSnippet)}
                      className="w-full py-2.5 px-4 rounded-full bg-elevated hover:bg-accent hover:text-accent-fg border border-line-strong text-ink text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
                    >
                      {copiedId === 'mcpjson' ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied MCP JSON
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy MCP Config JSON
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('keys_code')}
                      className="w-full py-2 px-3 rounded-full bg-canvas hover:bg-elevated border border-line text-[11px] text-ink-secondary hover:text-ink transition"
                    >
                      Manage Folder Scopes →
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="keys_code"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-8"
            >
              {/* Create Key Composer Bar */}
              <form
                onSubmit={handleCreate}
                className="rounded-3xl bg-surface border border-line-strong p-3.5 shadow-card flex flex-col md:flex-row items-stretch md:items-center gap-2.5"
              >
                <input
                  type="text"
                  required
                  disabled={isOffline}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Key label (e.g. Local App / Qwen)"
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
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        Only: {f.name}
                      </option>
                    ))}
                </select>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  type="submit"
                  disabled={creating || isOffline}
                  className="px-5 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center justify-center gap-1.5 shadow-glow transition disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Create Key
                </motion.button>
              </form>

              {/* Active Keys List */}
              <section className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted px-0.5">
                  Scoped Keys · {vault.apiKeys.length}
                </div>

                <div className="rounded-3xl bg-surface border border-line divide-y divide-line overflow-hidden shadow-card">
                  {vault.apiKeys.map((k) => {
                    const revealed = Boolean(revealedIds[k.id]);
                    const folderLabels =
                      k.allowedFolderIds.length === 0
                        ? 'All Carpetas'
                        : k.allowedFolderIds
                            .map(
                              (fid) =>
                                vault.folders.find((fl) => fl.id === fid)?.name || fid
                            )
                            .join(', ');

                    return (
                      <div
                        key={k.id}
                        className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-elevated/50 transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13.5px] font-medium text-ink">
                              {k.name}
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
                              {k.scope === 'read_write' ? 'Read & Write' : 'Read'} ·{' '}
                              {folderLabels}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs font-mono text-ink-muted">
                            <span className="truncate">
                              {revealed ? k.key : k.keyPrefix}
                            </span>
                            <span className="text-[11px] font-sans">
                              · {k.usageCount || 0} calls ·{' '}
                              {formatRelativeTime(k.lastUsedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() =>
                              setRevealedIds((p) => ({ ...p, [k.id]: !p[k.id] }))
                            }
                            className="p-2 rounded-xl bg-elevated hover:bg-canvas text-ink-secondary hover:text-ink transition"
                            title={revealed ? 'Hide' : 'Reveal'}
                          >
                            {revealed ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
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
                              active
                                ? 'text-accent-fg'
                                : 'text-ink-secondary hover:text-ink'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="aiSnippetTab"
                                transition={{
                                  type: 'spring',
                                  stiffness: 450,
                                  damping: 32,
                                }}
                                className="absolute inset-0 rounded-full bg-accent shadow-glow"
                              />
                            )}
                            <span className="relative z-10">
                              {tab === 'ollama' ? 'Python + Local LLM' : 'cURL & /v1'}
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
                      disabled={testing || !selectedKeyObj}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
