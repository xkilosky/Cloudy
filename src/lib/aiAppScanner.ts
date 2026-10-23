export type BestConnectionMethod =
  | 'mcp'
  | 'openwebui_tool'
  | 'openai_proxy'
  | 'in_app_and_bridge'
  | 'rest_skill_api';

export type CustomAppCapabilityHint =
  | 'auto'
  | 'mcp'
  | 'openai_url'
  | 'custom_code';

export interface InstructionStep {
  stepNumber: number;
  title: string;
  detail: string;
  action?:
    | { type: 'download_zip'; label: string }
    | { type: 'download_openwebui'; label: string }
    | { type: 'copy'; id: string; label: string; value: string }
    | { type: 'auto_connect_mcp'; appId: string; label: string };
}

export interface DetectedAiApp {
  id: string;
  name: string;
  status: 'running' | 'installed' | 'matched';
  endpoint?: string | null;
  modelsCount?: number;
  bestMethod: BestConnectionMethod;
  bestMethodBadge: string;
  whyBest: string;
  canAutoConfigure?: boolean;
  configPath?: string;
  steps: InstructionStep[];
}

export interface AppScanResult {
  bridgeRunning: boolean;
  mcpScriptPath: string;
  apps: DetectedAiApp[];
}

async function probeJson(url: string, timeoutMs = 1500): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizePortOrUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^\d{2,5}$/.test(t)) return `http://127.0.0.1:${t}`;
  if (!/^https?:\/\//i.test(t)) return `http://${t}`;
  return t.replace(/\/+$/, '');
}

export function buildInstructionsForApp(params: {
  id: string;
  name: string;
  status: 'running' | 'installed' | 'matched';
  endpoint?: string | null;
  modelsCount?: number;
  bestMethod: BestConnectionMethod;
  canAutoConfigure?: boolean;
  configPath?: string;
  bridgeRunning: boolean;
  mcpScriptPath: string;
  apiKey: string;
  origin: string;
}): DetectedAiApp {
  const {
    id,
    name,
    status,
    endpoint,
    modelsCount = 0,
    bestMethod,
    canAutoConfigure,
    configPath,
    bridgeRunning,
    mcpScriptPath,
    apiKey,
    origin,
  } = params;

  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        'cloudy-vault': {
          command: 'python3',
          args: [mcpScriptPath],
          env: {
            CLOUDY_API_KEY: apiKey,
            CLOUDY_LOCAL_URL: 'http://127.0.0.1:8765',
            CLOUDY_REMOTE_URL: origin,
          },
        },
      },
    },
    null,
    2
  );

  const customSkillPython = `# Drop-in Cloudy Skill for ${name} (Works 100% Offline + Auto-Syncs Online)
import json, urllib.parse, urllib.request

CLOUDY_URLS = ["http://127.0.0.1:8765", "${origin}"]
CLOUDY_KEY = "${apiKey}"

def cloudy_skill(path, method="GET", body=None):
    for base in CLOUDY_URLS:
        try:
            headers = {"Authorization": f"Bearer {CLOUDY_KEY}"}
            data = json.dumps(body).encode() if body else None
            if data: headers["Content-Type"] = "application/json"
            req = urllib.request.Request(f"{base}{path}", data=data, headers=headers, method=method)
            return json.loads(urllib.request.urlopen(req, timeout=4).read().decode())
        except Exception:
            continue
    raise RuntimeError("Start Cloudy Bridge (Start-Cloudy-AI) for offline access")

# Skills ready for ${name}'s AI models:
# search_files(q) -> cloudy_skill(f"/api/v1/ai/search?q={urllib.parse.quote(q)}")["results"]
# read_file(fid)  -> cloudy_skill(f"/api/v1/ai/files/{fid}/content")["content"]
# save_note(n, c) -> cloudy_skill("/api/v1/ai/files", "POST", {"name": n, "content": c})`;

  if (bestMethod === 'openwebui_tool') {
    return {
      id,
      name,
      status,
      endpoint,
      modelsCount,
      bestMethod,
      bestMethodBadge: 'Best Way: 1-Click OpenWebUI Skill (.py)',
      whyBest: `${name} natively supports Python Tools — importing Cloudy's pre-filled skill gives every local model in ${name} instant Read, Search & Save vault skills.`,
      steps: [
        {
          stepNumber: 1,
          title: 'Download your pre-linked OpenWebUI Skill file',
          detail: 'Your Cloudy API key and Online + Offline fallback URLs are already baked in.',
          action: { type: 'download_openwebui', label: 'Download cloudy_vault_skill.py' },
        },
        {
          stepNumber: 2,
          title: `Import into ${name}`,
          detail: `Open ${name}${endpoint ? ` (${endpoint})` : ''} → Workspace → Tools → Import, and choose cloudy_vault_skill.py.`,
        },
        {
          stepNumber: 3,
          title: 'Optional: Keep Offline Auto-Sync Bridge running',
          detail: 'Run Start-Cloudy-AI from the Plug & Play Pack so OpenWebUI still reads your files with zero internet.',
          action: bridgeRunning
            ? undefined
            : { type: 'download_zip', label: 'Download Plug & Play Pack (.zip)' },
        },
      ],
    };
  }

  if (bestMethod === 'mcp') {
    const appMenuHint =
      id === 'cursor'
        ? 'Open Cursor → Settings → MCP (or ~/.cursor/mcp.json)'
        : id === 'claude_desktop'
          ? 'Open Claude Desktop → Settings → Developer → Edit Config'
          : id === 'lmstudio'
            ? 'Open LM Studio → Program (right sidebar) → Install → Edit mcp.json'
            : id === 'windsurf'
              ? 'Open Windsurf → Cascade MCP Settings → Edit mcp_config.json'
              : `Open ${name}'s MCP / Tools configuration`;

    const steps: InstructionStep[] = [];

    if (!bridgeRunning) {
      steps.push({
        stepNumber: 1,
        title: 'Download & unzip the Plug & Play Pack once',
        detail: 'Includes cloudy_mcp_server.py (zero dependencies) + Start-Cloudy-AI for live offline sync.',
        action: { type: 'download_zip', label: 'Download Plug & Play Pack (.zip)' },
      });
    }

    if (bridgeRunning && canAutoConfigure) {
      steps.push({
        stepNumber: steps.length + 1,
        title: `1-Click Auto-Connect ${name}`,
        detail: `Cloudy detected ${name} on your computer${configPath ? ` (${configPath})` : ''}. Click below to inject Cloudy Vault MCP automatically.`,
        action: {
          type: 'auto_connect_mcp',
          appId: id,
          label: `Auto-Connect ${name} Now`,
        },
      });
      steps.push({
        stepNumber: steps.length + 1,
        title: `Restart ${name}`,
        detail: `Your AI models in ${name} will immediately see list_cloudy_folders, search_cloudy_files, read_cloudy_file, and write_cloudy_note.`,
      });
    } else {
      steps.push({
        stepNumber: steps.length + 1,
        title: `Paste Cloudy's MCP Config into ${name}`,
        detail: `${appMenuHint} and paste this pre-linked JSON (update the path to cloudy_mcp_server.py if needed).`,
        action: {
          type: 'copy',
          id: `mcp_${id}`,
          label: 'Copy Pre-Filled MCP JSON',
          value: mcpJson,
        },
      });
      steps.push({
        stepNumber: steps.length + 1,
        title: `Ask any AI model in ${name} to read your files`,
        detail: 'Works online and 100% offline — automatically syncs whenever internet is available.',
      });
    }

    return {
      id,
      name,
      status,
      endpoint,
      modelsCount,
      bestMethod,
      canAutoConfigure,
      configPath,
      bestMethodBadge:
        bridgeRunning && canAutoConfigure
          ? 'Best Way: 1-Click Auto-Connect (MCP)'
          : 'Best Way: Native MCP Skills',
      whyBest: `${name} supports Model Context Protocol (MCP), giving its AI models native tool-calling access to search, read, and save files in Cloudy offline & online.`,
      steps,
    };
  }

  if (bestMethod === 'in_app_and_bridge') {
    return {
      id,
      name,
      status,
      endpoint,
      modelsCount,
      bestMethod,
      bestMethodBadge: 'Best Way: Direct Vault Chat + Local /v1 Bridge',
      whyBest:
        status === 'running'
          ? `${name} is running locally right now${endpoint ? ` at ${endpoint}` : ''} — Cloudy can feed your vault files directly to its models with zero extra code.`
          : `${name} runs local models on your device — pair it with Cloudy's Double-Click Bridge for instant offline + online vault access.`,
      steps: [
        ...(!bridgeRunning
          ? [
              {
                stepNumber: 1,
                title: 'Start the Cloudy Plug & Play Bridge',
                detail:
                  'Download the pack and double-click Start-Cloudy-AI (.bat / .command / .sh) for CORS-free local model access + 15s Live Auto-Sync.',
                action: {
                  type: 'download_zip' as const,
                  label: 'Download Plug & Play Pack (.zip)',
                },
              },
            ]
          : []),
        {
          stepNumber: bridgeRunning ? 1 : 2,
          title: `Use ${name} models right inside Cloudy or any UI`,
          detail:
            'Pick your model in the Instant Local AI Scanner above to chat with your files immediately, OR paste http://127.0.0.1:8765/v1 into any external chat UI.',
          action: {
            type: 'copy',
            id: `v1_${id}`,
            label: 'Copy http://127.0.0.1:8765/v1',
            value: 'http://127.0.0.1:8765/v1',
          },
        },
      ],
    };
  }

  if (bestMethod === 'openai_proxy') {
    return {
      id,
      name,
      status,
      endpoint,
      modelsCount,
      bestMethod,
      bestMethodBadge: 'Best Way: Local OpenAI /v1 Auto-RAG URL',
      whyBest: `${name} supports custom OpenAI-compatible endpoints — pointing it at Cloudy's local /v1 bridge automatically injects your relevant Cloudy files into every prompt.`,
      steps: [
        ...(!bridgeRunning
          ? [
              {
                stepNumber: 1,
                title: 'Launch Start-Cloudy-AI once',
                detail:
                  'Unzip the Plug & Play Pack and double-click Start-Cloudy-AI so http://127.0.0.1:8765/v1 is live offline & online.',
                action: {
                  type: 'download_zip' as const,
                  label: 'Download Plug & Play Pack (.zip)',
                },
              },
            ]
          : []),
        {
          stepNumber: bridgeRunning ? 1 : 2,
          title: `Set Custom OpenAI Base URL in ${name}`,
          detail: `In ${name} → Settings / Model Provider → Custom OpenAI, paste http://127.0.0.1:8765/v1 as the API Base URL.`,
          action: {
            type: 'copy',
            id: `oai_url_${id}`,
            label: 'Copy Base URL (127.0.0.1:8765/v1)',
            value: 'http://127.0.0.1:8765/v1',
          },
        },
        {
          stepNumber: bridgeRunning ? 2 : 3,
          title: `Paste your pre-linked Cloudy API Key`,
          detail: `Paste your scoped key into ${name}'s API Key field — ${name} will list your local models and read your Cloudy vault automatically.`,
          action: {
            type: 'copy',
            id: `oai_key_${id}`,
            label: 'Copy Pre-Linked API Key',
            value: apiKey,
          },
        },
      ],
    };
  }

  // rest_skill_api (Best for custom apps like "Local", GPT4All, or developer-built AI apps)
  return {
    id,
    name,
    status,
    endpoint,
    modelsCount,
    bestMethod: 'rest_skill_api',
    bestMethodBadge: 'Best Way: Local Offline Skill API + Auto-Sync',
    whyBest: `For ${name}, connecting to Cloudy's local bridge (127.0.0.1:8765) gives ${name}'s AI models instant offline file search & reading while Cloudy handles all cloud logins and live sync automatically.`,
    steps: [
      ...(!bridgeRunning
        ? [
            {
              stepNumber: 1,
              title: 'Run Start-Cloudy-AI in the background',
              detail:
                'Download & double-click Start-Cloudy-AI so your files stay cached on 127.0.0.1:8765 offline and auto-sync every 15s when online.',
              action: {
                type: 'download_zip' as const,
                label: 'Download Plug & Play Pack (.zip)',
              },
            },
          ]
        : []),
      {
        stepNumber: bridgeRunning ? 1 : 2,
        title: `Drop this pre-configured Read/Search skill into ${name}`,
        detail: `Pre-linked with your API key — works offline via 127.0.0.1:8765 and falls back to ${origin} automatically.`,
        action: {
          type: 'copy',
          id: `skill_${id}`,
          label: `Copy Pre-Configured Skill for ${name}`,
          value: customSkillPython,
        },
      },
      {
        stepNumber: bridgeRunning ? 2 : 3,
        title: `Or paste OpenAI Base URL if ${name} has Provider Settings`,
        detail: `If ${name} accepts an OpenAI Base URL, paste http://127.0.0.1:8765/v1 and zero code is needed at all.`,
        action: {
          type: 'copy',
          id: `v1_alt_${id}`,
          label: 'Copy http://127.0.0.1:8765/v1',
          value: 'http://127.0.0.1:8765/v1',
        },
      },
    ],
  };
}

function inferBestMethodFromAppName(
  rawName: string,
  hint: CustomAppCapabilityHint
): { id: string; cleanName: string; method: BestConnectionMethod } {
  const cleanName = rawName.trim() || 'My Local AI App';
  const lower = cleanName.toLowerCase();

  if (hint === 'mcp') {
    return { id: `custom_${lower}`, cleanName, method: 'mcp' };
  }
  if (hint === 'openai_url') {
    return { id: `custom_${lower}`, cleanName, method: 'openai_proxy' };
  }
  if (hint === 'custom_code') {
    return { id: `custom_${lower}`, cleanName, method: 'rest_skill_api' };
  }

  if (lower.includes('openwebui') || lower.includes('open webui') || lower.includes('open-webui')) {
    return { id: 'openwebui', cleanName: 'OpenWebUI', method: 'openwebui_tool' };
  }
  if (lower.includes('cursor')) {
    return { id: 'cursor', cleanName: 'Cursor', method: 'mcp' };
  }
  if (lower.includes('claude')) {
    return { id: 'claude_desktop', cleanName: 'Claude Desktop', method: 'mcp' };
  }
  if (lower.includes('windsurf')) {
    return { id: 'windsurf', cleanName: 'Windsurf', method: 'mcp' };
  }
  if (lower.includes('lm studio') || lower.includes('lmstudio')) {
    return { id: 'lmstudio', cleanName: 'LM Studio', method: 'mcp' };
  }
  if (lower.includes('cline') || lower.includes('roo') || lower.includes('msty')) {
    return { id: `mcp_${lower}`, cleanName, method: 'mcp' };
  }
  if (
    lower.includes('chatbox') ||
    lower.includes('anythingllm') ||
    lower.includes('jan') ||
    lower.includes('sillytavern') ||
    lower.includes('librechat') ||
    lower.includes('lobechat') ||
    lower.includes('continue')
  ) {
    return { id: `oai_${lower}`, cleanName, method: 'openai_proxy' };
  }
  if (lower.includes('ollama') || lower.includes('llama.cpp') || lower.includes('kobold')) {
    return { id: `rt_${lower}`, cleanName, method: 'in_app_and_bridge' };
  }

  return { id: `custom_${lower.replace(/[^a-z0-9]+/g, '_')}`, cleanName, method: 'rest_skill_api' };
}

export async function scanForAiApps(params: {
  apiKey: string;
  origin: string;
  customAppName?: string;
  customAppUrl?: string;
  capabilityHint?: CustomAppCapabilityHint;
}): Promise<AppScanResult> {
  const {
    apiKey,
    origin,
    customAppName = '',
    customAppUrl = '',
    capabilityHint = 'auto',
  } = params;

  const normalizedCustomUrl = normalizePortOrUrl(customAppUrl);
  const byId = new Map<string, DetectedAiApp>();
  let bridgeRunning = false;
  let mcpScriptPath = '/path/to/Cloudy-PlugAndPlay-AI/cloudy_mcp_server.py';

  // 1. Query Local Cloudy Bridge (/api/v1/ai/scan-apps) for full OS + port discovery
  try {
    const qs = new URLSearchParams();
    if (customAppName.trim()) qs.set('customName', customAppName.trim());
    if (normalizedCustomUrl) qs.set('customUrl', normalizedCustomUrl);

    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2200);
    const res = await fetch(
      `http://127.0.0.1:8765/api/v1/ai/scan-apps?${qs.toString()}`,
      { headers, signal: ctrl.signal }
    );
    window.clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data?.ok) {
        bridgeRunning = true;
        if (data.mcpScriptPath) mcpScriptPath = String(data.mcpScriptPath);
        for (const raw of data.apps || []) {
          const built = buildInstructionsForApp({
            id: raw.id,
            name: raw.name,
            status: raw.status === 'running' ? 'running' : 'installed',
            endpoint: raw.endpoint,
            modelsCount: raw.modelsCount || 0,
            bestMethod: raw.bestMethod as BestConnectionMethod,
            canAutoConfigure: Boolean(raw.canAutoConfigure),
            configPath: raw.configPath,
            bridgeRunning: true,
            mcpScriptPath,
            apiKey,
            origin,
          });
          byId.set(built.id, built);
        }
      }
    }
  } catch {
    // Bridge not running — run direct browser probes below
  }

  // 2. Direct Browser Port Probes (works even before Bridge is started!)
  const browserProbes: Array<() => Promise<void>> = [
    async () => {
      if (byId.has('ollama')) return;
      const d = await probeJson('http://127.0.0.1:11434/api/tags');
      if (d && Array.isArray(d.models)) {
        byId.set(
          'ollama',
          buildInstructionsForApp({
            id: 'ollama',
            name: 'Ollama',
            status: 'running',
            endpoint: 'http://127.0.0.1:11434',
            modelsCount: d.models.length,
            bestMethod: 'in_app_and_bridge',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('lmstudio')) return;
      const d = await probeJson('http://127.0.0.1:1234/v1/models');
      if (d && Array.isArray(d.data)) {
        byId.set(
          'lmstudio',
          buildInstructionsForApp({
            id: 'lmstudio',
            name: 'LM Studio',
            status: 'running',
            endpoint: 'http://127.0.0.1:1234',
            modelsCount: d.data.length,
            bestMethod: 'mcp',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('openwebui')) return;
      for (const port of [3000, 8080, 8088]) {
        // Avoid probing Cloudy's own origin port if same host
        if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) {
          continue;
        }
        const cfg = await probeJson(`http://127.0.0.1:${port}/api/config`);
        if (
          cfg &&
          (String(cfg.name || '').toLowerCase().includes('webui') ||
            'default_models' in cfg)
        ) {
          byId.set(
            'openwebui',
            buildInstructionsForApp({
              id: 'openwebui',
              name: 'OpenWebUI',
              status: 'running',
              endpoint: `http://127.0.0.1:${port}`,
              bestMethod: 'openwebui_tool',
              bridgeRunning,
              mcpScriptPath,
              apiKey,
              origin,
            })
          );
          break;
        }
      }
    },
    async () => {
      if (byId.has('anythingllm')) return;
      const d = await probeJson('http://127.0.0.1:3001/api/ping');
      if (d && d.online) {
        byId.set(
          'anythingllm',
          buildInstructionsForApp({
            id: 'anythingllm',
            name: 'AnythingLLM',
            status: 'running',
            endpoint: 'http://127.0.0.1:3001',
            bestMethod: 'mcp',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('jan')) return;
      const d = await probeJson('http://127.0.0.1:1337/v1/models');
      if (d && Array.isArray(d.data)) {
        byId.set(
          'jan',
          buildInstructionsForApp({
            id: 'jan',
            name: 'Jan AI',
            status: 'running',
            endpoint: 'http://127.0.0.1:1337',
            modelsCount: d.data.length,
            bestMethod: 'openai_proxy',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('gpt4all')) return;
      const d = await probeJson('http://127.0.0.1:4891/v1/models');
      if (d && Array.isArray(d.data)) {
        byId.set(
          'gpt4all',
          buildInstructionsForApp({
            id: 'gpt4all',
            name: 'GPT4All',
            status: 'running',
            endpoint: 'http://127.0.0.1:4891',
            modelsCount: d.data.length,
            bestMethod: 'rest_skill_api',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('koboldcpp')) return;
      const d = await probeJson('http://127.0.0.1:5001/api/v1/model');
      if (d && d.result) {
        byId.set(
          'koboldcpp',
          buildInstructionsForApp({
            id: 'koboldcpp',
            name: 'KoboldCpp',
            status: 'running',
            endpoint: 'http://127.0.0.1:5001',
            modelsCount: 1,
            bestMethod: 'openai_proxy',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('textgen_webui')) return;
      const d = await probeJson('http://127.0.0.1:5000/v1/models');
      if (d && Array.isArray(d.data)) {
        byId.set(
          'textgen_webui',
          buildInstructionsForApp({
            id: 'textgen_webui',
            name: 'Text Generation WebUI',
            status: 'running',
            endpoint: 'http://127.0.0.1:5000',
            modelsCount: d.data.length,
            bestMethod: 'openai_proxy',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
    async () => {
      if (byId.has('llamacpp') || byId.has('openwebui')) return;
      const d = await probeJson('http://127.0.0.1:8080/v1/models');
      if (d && Array.isArray(d.data)) {
        byId.set(
          'llamacpp',
          buildInstructionsForApp({
            id: 'llamacpp',
            name: 'llama.cpp / LocalAI',
            status: 'running',
            endpoint: 'http://127.0.0.1:8080',
            modelsCount: d.data.length,
            bestMethod: 'in_app_and_bridge',
            bridgeRunning,
            mcpScriptPath,
            apiKey,
            origin,
          })
        );
      }
    },
  ];

  await Promise.all(browserProbes.map((fn) => fn()));

  // 3. Handle Custom / User-Named App (e.g. "Local" or custom URL)
  if (customAppName.trim() || normalizedCustomUrl) {
    const inferred = inferBestMethodFromAppName(customAppName, capabilityHint);
    let chosenMethod = inferred.method;
    let liveStatus: 'running' | 'matched' = 'matched';
    let liveCount = 0;

    if (normalizedCustomUrl && !byId.has('custom_probed')) {
      const cleanBase = normalizedCustomUrl.replace(/\/v1$/, '');
      const v1 = await probeJson(`${cleanBase}/v1/models`);
      const ol = !v1 ? await probeJson(`${cleanBase}/api/tags`) : null;
      if (v1 && Array.isArray(v1.data)) {
        liveStatus = 'running';
        liveCount = v1.data.length;
        if (capabilityHint === 'auto') chosenMethod = 'openai_proxy';
      } else if (ol && Array.isArray(ol.models)) {
        liveStatus = 'running';
        liveCount = ol.models.length;
        if (capabilityHint === 'auto') chosenMethod = 'in_app_and_bridge';
      }
    }

    if (!byId.has('custom_probed') && !byId.has(inferred.id)) {
      const customBuilt = buildInstructionsForApp({
        id: inferred.id,
        name: inferred.cleanName,
        status: liveStatus,
        endpoint: normalizedCustomUrl || null,
        modelsCount: liveCount,
        bestMethod: chosenMethod,
        bridgeRunning,
        mcpScriptPath,
        apiKey,
        origin,
      });
      return {
        bridgeRunning,
        mcpScriptPath,
        apps: [customBuilt, ...Array.from(byId.values())],
      };
    }
  }

  return {
    bridgeRunning,
    mcpScriptPath,
    apps: Array.from(byId.values()),
  };
}

export async function autoConnectMcpAppViaBridge(
  appId: string,
  apiKey: string
): Promise<{ ok: boolean; configPath?: string; message: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch('http://127.0.0.1:8765/api/v1/ai/auto-connect-app', {
    method: 'POST',
    headers,
    body: JSON.stringify({ appId }),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Auto-connect failed');
  }
  return {
    ok: true,
    configPath: data.configPath,
    message: data.message || 'Connected!',
  };
}
