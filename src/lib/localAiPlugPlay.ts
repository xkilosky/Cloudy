import type { VaultState, AiApiKey, FileItem, FolderItem } from '../types';
import { getOfflineBlob } from './offlineDb';

export interface DetectedLocalModel {
  uid: string;
  id: string;
  name: string;
  provider: string;
  providerName: string;
  endpoint: string;
  kind: 'ollama' | 'openai';
  viaBridge: boolean;
}

export interface LocalDiscoverySummary {
  bridgeRunning: boolean;
  bridgeOnlineSync: boolean;
  detectedRuntimes: string[];
  models: DetectedLocalModel[];
}

export interface SkillTraceItem {
  skill: 'list_folders' | 'search_vault' | 'read_file' | 'write_note';
  detail: string;
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant';
  content: string;
  skills?: SkillTraceItem[];
}

const CUSTOM_URL_STORAGE_KEY = 'cloudy_custom_local_ai_url';

export function getSavedCustomLocalAiUrl(): string {
  try {
    return localStorage.getItem(CUSTOM_URL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveCustomLocalAiUrl(url: string): void {
  try {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed) {
      localStorage.setItem(CUSTOM_URL_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(CUSTOM_URL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 1800
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function detectLocalAiRuntimes(
  apiKey?: string,
  customEndpoint?: string
): Promise<LocalDiscoverySummary> {
  const modelsMap = new Map<string, DetectedLocalModel>();
  const runtimeSet = new Set<string>();
  let bridgeRunning = false;
  let bridgeOnlineSync = false;

  // 1. Probe Cloudy Local Plug & Play Bridge (127.0.0.1:8765) — CORS-free for all local runtimes
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchWithTimeout(
      'http://127.0.0.1:8765/api/v1/ai/local-models',
      { headers },
      1800
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.ok) {
        bridgeRunning = true;
        bridgeOnlineSync = Boolean(data.onlineSyncConnected);
        for (const rt of data.runtimes || []) {
          if (rt?.name) runtimeSet.add(String(rt.name));
        }
        for (const m of data.models || []) {
          const uid = `${m.provider}:${m.id}`;
          modelsMap.set(uid, {
            uid,
            id: m.id,
            name: m.name || m.id,
            provider: m.provider || 'ollama',
            providerName: m.providerName || 'Local AI',
            endpoint: m.endpoint || 'http://127.0.0.1:11434',
            kind: m.kind === 'ollama' ? 'ollama' : 'openai',
            viaBridge: true,
          });
        }
      }
    }
  } catch {
    // Bridge not running — direct runtime probes below still work
  }

  // 2. Direct Browser Probes (Ollama, LM Studio, llama.cpp, Jan + optional custom URL)
  const directTargets: Array<{
    id: string;
    name: string;
    base: string;
    kind: 'ollama' | 'openai';
  }> = [
    { id: 'ollama', name: 'Ollama', base: 'http://127.0.0.1:11434', kind: 'ollama' },
    { id: 'lmstudio', name: 'LM Studio', base: 'http://127.0.0.1:1234', kind: 'openai' },
    { id: 'llamacpp', name: 'llama.cpp', base: 'http://127.0.0.1:8080', kind: 'openai' },
    { id: 'jan', name: 'Jan AI', base: 'http://127.0.0.1:1337', kind: 'openai' },
  ];

  const cleanCustom = (customEndpoint || getSavedCustomLocalAiUrl()).trim().replace(/\/+$/, '');
  if (cleanCustom) {
    const cleanBase = cleanCustom.replace(/\/v1$/, '');
    directTargets.push({
      id: 'custom',
      name: 'Custom Local AI',
      base: cleanBase,
      kind: cleanBase.includes(':11434') ? 'ollama' : 'openai',
    });
  }

  await Promise.all(
    directTargets.map(async (rt) => {
      try {
        if (rt.kind === 'ollama') {
          const r = await fetchWithTimeout(`${rt.base}/api/tags`, {}, 1600);
          if (!r.ok) return;
          const body = await r.json();
          const list = Array.isArray(body?.models) ? body.models : [];
          runtimeSet.add(rt.name);
          for (const item of list) {
            const name = String(item?.name || '').trim();
            if (!name) continue;
            const uid = `${rt.id}:${name}`;
            if (!modelsMap.has(uid)) {
              modelsMap.set(uid, {
                uid,
                id: name,
                name,
                provider: rt.id,
                providerName: rt.name,
                endpoint: rt.base,
                kind: 'ollama',
                viaBridge: false,
              });
            }
          }
        } else {
          const r = await fetchWithTimeout(`${rt.base}/v1/models`, {}, 1600);
          if (!r.ok) return;
          const body = await r.json();
          const list = Array.isArray(body?.data) ? body.data : [];
          runtimeSet.add(rt.name);
          for (const item of list) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            const uid = `${rt.id}:${id}`;
            if (!modelsMap.has(uid)) {
              modelsMap.set(uid, {
                uid,
                id,
                name: id,
                provider: rt.id,
                providerName: rt.name,
                endpoint: rt.base,
                kind: 'openai',
                viaBridge: false,
              });
            }
          }
        }
      } catch {
        // Not running or CORS restricted without bridge
      }
    })
  );

  return {
    bridgeRunning,
    bridgeOnlineSync,
    detectedRuntimes: Array.from(runtimeSet),
    models: Array.from(modelsMap.values()),
  };
}

function getScopedVaultItems(
  vault: VaultState,
  keyObj: AiApiKey | null
): { folders: FolderItem[]; files: FileItem[] } {
  const activeFolders = vault.folders.filter((f) => !f.trashed);
  const activeFiles = vault.files.filter((f) => !f.trashed);

  if (!keyObj || !keyObj.allowedFolderIds || keyObj.allowedFolderIds.length === 0) {
    return { folders: activeFolders, files: activeFiles };
  }

  const allowed = new Set(keyObj.allowedFolderIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fld of activeFolders) {
      if (fld.parentId && allowed.has(fld.parentId) && !allowed.has(fld.id)) {
        allowed.add(fld.id);
        changed = true;
      }
    }
  }

  return {
    folders: activeFolders.filter((f) => allowed.has(f.id)),
    files: activeFiles.filter((f) => Boolean(f.folderId && allowed.has(f.folderId))),
  };
}

async function readLocalFileText(file: FileItem): Promise<string> {
  if (typeof file.textContent === 'string') return file.textContent;
  try {
    const cached = await getOfflineBlob(file.id);
    if (
      cached?.blob &&
      (file.mimeType.startsWith('text/') ||
        file.mimeType.includes('json') ||
        /\.(md|txt|json|csv|ts|tsx|js|py|yaml|yml|html|css|sql)$/i.test(file.name))
    ) {
      return await cached.blob.text();
    }
  } catch {
    // ignore
  }
  return '';
}

export async function askLocalAiWithVaultSkills(params: {
  selectedModel: DetectedLocalModel;
  messages: ChatTurnMessage[];
  vault: VaultState;
  activeKey: AiApiKey | null;
  onSaveGeneratedNote?: (name: string, content: string, folderId: string | null) => Promise<void>;
}): Promise<{ reply: string; usedSkills: SkillTraceItem[] }> {
  const { selectedModel, messages, vault, activeKey, onSaveGeneratedNote } = params;

  // Route 1: Via Cloudy Local Plug & Play Bridge (127.0.0.1:8765)
  if (selectedModel.viaBridge) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (activeKey?.key) headers.Authorization = `Bearer ${activeKey.key}`;

    const resp = await fetch('http://127.0.0.1:8765/api/v1/ai/local-chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: selectedModel.id,
        provider: selectedModel.provider,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || 'Local AI Bridge chat request failed');
    }
    return {
      reply: String(data.reply || ''),
      usedSkills: Array.isArray(data.usedSkills) ? data.usedSkills : [],
    };
  }

  // Route 2: Direct Browser -> Ollama / LM Studio / llama.cpp using IndexedDB Offline Vault Skills
  const { folders, files } = getScopedVaultItems(vault, activeKey);
  const usedSkills: SkillTraceItem[] = [
    { skill: 'list_folders', detail: `${folders.length} carpeta(s)` },
  ];

  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const terms = (lastUserMsg.toLowerCase().match(/[a-z0-9_.-]{3,}/g) || []).filter(
    (w) =>
      ![
        'the',
        'and',
        'for',
        'with',
        'what',
        'read',
        'file',
        'files',
        'from',
        'cloudy',
        'vault',
        'summarize',
        'please',
      ].includes(w)
  );

  const hydrated = await Promise.all(
    files.map(async (f) => {
      const txt = await readLocalFileText(f);
      let score = 1;
      const nameHay = f.name.toLowerCase();
      const bodyHay = txt.toLowerCase();
      for (const t of terms) {
        if (nameHay.includes(t)) score += 8;
        if (bodyHay.includes(t)) score += 3;
      }
      return { f, txt, score };
    })
  );

  hydrated.sort((a, b) => b.score - a.score);
  const topFiles = hydrated.slice(0, 4);

  const fileBlocks: string[] = [];
  for (const { f, txt } of topFiles) {
    usedSkills.push({ skill: 'read_file', detail: f.name });
    const snippet = txt
      ? txt.slice(0, 4000)
      : `[Binary file: ${f.mimeType}, ${f.size} bytes]`;
    fileBlocks.push(`--- FILE: ${f.name} (id: ${f.id}) ---\n${snippet}`);
  }

  const canWrite = activeKey?.scope === 'read_write';
  const writeInstruction = canWrite
    ? '\nIf the user asks to create or save a note into Cloudy, wrap its content in <cloudy_write name="note.md">...content...</cloudy_write>.'
    : '';

  const systemPrompt = [
    "You are connected directly to the user's Cloudy by X-Kilo Vault (Online + Offline).",
    `Accessible Carpetas: ${folders.map((fl) => fl.name).join(', ') || 'Root'}`,
    `Accessible Files: ${files.length}`,
    writeInstruction,
    '',
    'Vault File Contents:',
    fileBlocks.length > 0 ? fileBlocks.join('\n\n') : '(No files in vault yet.)',
  ].join('\n');

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = '';
  if (selectedModel.kind === 'ollama') {
    const resp = await fetch(`${selectedModel.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel.id,
        messages: fullMessages,
        stream: false,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama returned HTTP ${resp.status}`);
    }
    const out = await resp.json();
    reply = String(out?.message?.content || out?.response || '');
  } else {
    const resp = await fetch(`${selectedModel.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel.id,
        messages: fullMessages,
        stream: false,
      }),
    });
    if (!resp.ok) {
      throw new Error(`${selectedModel.providerName} returned HTTP ${resp.status}`);
    }
    const out = await resp.json();
    reply = String(out?.choices?.[0]?.message?.content || '');
  }

  if (canWrite && onSaveGeneratedNote) {
    const match = reply.match(/<cloudy_write\s+name="([^"]+)"\s*>([\s\S]*?)<\/cloudy_write>/);
    if (match) {
      const noteName = match[1].trim();
      const noteBody = match[2].trim();
      const targetFolder =
        activeKey?.allowedFolderIds?.length ? activeKey.allowedFolderIds[0] : null;
      await onSaveGeneratedNote(noteName, noteBody, targetFolder);
      usedSkills.push({ skill: 'write_note', detail: noteName });
    }
  }

  return { reply, usedSkills };
}
