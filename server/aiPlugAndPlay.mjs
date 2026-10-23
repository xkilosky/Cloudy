/**
 * Cloudy by X-Kilo — 1-Click Plug & Play Local AI Generators
 * Zero-configuration templates for:
 *  - Double-Click OS Launchers (Windows .bat, macOS .command, Linux/Termux .sh)
 *  - Local Auto-Sync + CORS-Free Ollama/LM Studio/llama.cpp Bridge + OpenAI /v1 RAG Proxy
 *  - Zero-Dependency Model Context Protocol (MCP) Server (Cursor, Claude, Cline, LM Studio)
 *  - 1-Click OpenWebUI Skill Tool (.py)
 *  - 1-Click Interactive Terminal Chat
 */

export function buildPlugAndPlayPythonServer(cloudOrigin) {
  return `#!/usr/bin/env python3
"""
Cloudy by X-Kilo — Plug & Play Local AI Bridge + OpenAI /v1 RAG Proxy + Live Auto-Sync
Zero external dependencies (Python 3 standard library only).

Features:
  1. 100% Offline Vault REST API (/api/v1/ai/*)
  2. Live Background Auto-Sync (every 15s when internet is available)
  3. Auto-Detects Local AI Models (Ollama :11434, LM Studio :1234, llama.cpp :8080, Jan :1337)
  4. CORS + Private Network Bridge so Cloudy Web/PWA connects to local models in 1 click
  5. OpenAI-Compatible Plug & Play Endpoint (http://127.0.0.1:8765/v1) with automatic Vault Skills!
"""
import base64
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VAULT_DIR = os.path.join(BASE_DIR, "vault")
BLOBS_DIR = os.path.join(VAULT_DIR, "blobs")
MANIFEST_PATH = os.path.join(VAULT_DIR, "manifest.json")
QUEUE_PATH = os.path.join(VAULT_DIR, "pending_queue.json")

os.makedirs(BLOBS_DIR, exist_ok=True)

LOCK = threading.RLock()
MAX_AUTO_BLOB_BYTES = 25 * 1024 * 1024

with open(MANIFEST_PATH, "r", encoding="utf-8") as _f:
    VAULT = json.load(_f)

if os.path.exists(QUEUE_PATH):
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as _qf:
            PENDING_QUEUE = json.load(_qf)
    except Exception:
        PENDING_QUEUE = []
else:
    PENDING_QUEUE = []

CLOUD_ORIGIN = os.environ.get(
    "CLOUDY_REMOTE_URL",
    VAULT.get("cloudOrigin") or "${cloudOrigin}"
).rstrip("/")
SYNC_INTERVAL = max(5, int(os.environ.get("CLOUDY_SYNC_INTERVAL", "15")))

SYNC_STATE = {
    "online": False,
    "syncing": False,
    "lastSyncedAt": VAULT.get("lastSyncedAt"),
    "lastAttemptAt": None,
    "lastError": None,
}

LOCAL_RUNTIMES = [
    {"id": "ollama", "name": "Ollama", "base": "http://127.0.0.1:11434", "kind": "ollama"},
    {"id": "lmstudio", "name": "LM Studio", "base": "http://127.0.0.1:1234", "kind": "openai"},
    {"id": "llamacpp", "name": "llama.cpp / LocalAI", "base": "http://127.0.0.1:8080", "kind": "openai"},
    {"id": "jan", "name": "Jan AI", "base": "http://127.0.0.1:1337", "kind": "openai"},
]


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_filename(name):
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name or "file")


def is_text_like(mime="", filename=""):
    m = (mime or "").lower()
    if (
        m.startswith("text/")
        or "json" in m
        or "xml" in m
        or "javascript" in m
        or "typescript" in m
        or "yaml" in m
        or "csv" in m
    ):
        return True
    return bool(
        re.search(
            r"\\.(md|txt|json|csv|ts|tsx|js|jsx|py|sh|yml|yaml|html|css|sql|xml|log|ini|env)$",
            filename or "",
            re.IGNORECASE,
        )
    )


def save_json_atomic(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def persist_local_state():
    with LOCK:
        save_json_atomic(MANIFEST_PATH, VAULT)
        save_json_atomic(QUEUE_PATH, PENDING_QUEUE)


def allowed_items(key_obj):
    with LOCK:
        allowed = set(key_obj.get("allowedFolderIds") or [])
        folders = list(VAULT.get("folders", []))
        files = list(VAULT.get("files", []))
    if not allowed:
        return folders, files, None
    changed = True
    while changed:
        changed = False
        for fld in folders:
            if fld.get("parentId") in allowed and fld["id"] not in allowed:
                allowed.add(fld["id"])
                changed = True
    return (
        [f for f in folders if f["id"] in allowed],
        [fl for fl in files if fl.get("folderId") in allowed],
        allowed,
    )


def read_file_text_local(target):
    content = target.get("textContent")
    if content is None and target.get("blobPath"):
        abs_b = os.path.join(BASE_DIR, target["blobPath"])
        if os.path.exists(abs_b) and is_text_like(target.get("mimeType"), target.get("name")):
            with open(abs_b, "rb") as bf:
                content = bf.read().decode("utf-8", errors="replace")
    return content


def remote_request(method, path, api_key, json_body=None, timeout=8):
    url = f"{CLOUD_ORIGIN}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "Cloudy-PlugAndPlay-AI/3.0",
    }
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        ctype = resp.headers.get("Content-Type", "")
        if "application/json" in ctype:
            return resp.status, json.loads(raw.decode("utf-8"))
        return resp.status, raw


def discover_local_ai_models():
    runtimes = []
    models = []
    for rt in LOCAL_RUNTIMES:
        try:
            if rt["kind"] == "ollama":
                req = urllib.request.Request(f"{rt['base']}/api/tags")
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                found = [m.get("name") for m in (payload.get("models") or []) if m.get("name")]
                runtimes.append({"id": rt["id"], "name": rt["name"], "endpoint": rt["base"], "online": True, "modelCount": len(found)})
                for m_name in found:
                    models.append({"id": m_name, "name": m_name, "provider": rt["id"], "providerName": rt["name"], "endpoint": rt["base"], "kind": "ollama"})
            else:
                req = urllib.request.Request(f"{rt['base']}/v1/models")
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                found = [m.get("id") for m in (payload.get("data") or []) if m.get("id")]
                runtimes.append({"id": rt["id"], "name": rt["name"], "endpoint": rt["base"], "online": True, "modelCount": len(found)})
                for m_name in found:
                    models.append({"id": m_name, "name": m_name, "provider": rt["id"], "providerName": rt["name"], "endpoint": rt["base"], "kind": "openai"})
        except Exception:
            continue
    return runtimes, models


def _normalize_local_url(raw_url):
    u = str(raw_url or "").strip()
    if not u:
        return ""
    if re.fullmatch(r":?\\d{2,5}", u):
        return f"http://127.0.0.1:{u.lstrip(':')}"
    if not re.match(r"^https?://", u, re.IGNORECASE):
        u = f"http://{u}"
    u = re.sub(r"/(v1/chat/completions|v1/models|v1|api/tags|api/chat)/*$", "", u, flags=re.IGNORECASE)
    return u.rstrip("/")


def _probe_json(url, timeout=1.2):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Cloudy-App-Scanner/3.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        pass
    return None


def _resolve_mcp_config_paths():
    home = os.path.expanduser("~")
    appdata = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
    localapp = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    mac_sup = os.path.join(home, "Library", "Application Support")
    xdg_cfg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")

    return {
        "cursor": {
            "detect": [
                os.path.join(home, ".cursor"),
                "/Applications/Cursor.app",
                os.path.join(localapp, "Programs", "cursor"),
            ],
            "config": os.path.join(home, ".cursor", "mcp.json"),
        },
        "claude_desktop": {
            "detect": [
                os.path.join(mac_sup, "Claude"),
                os.path.join(appdata, "Claude"),
                os.path.join(xdg_cfg, "Claude"),
                "/Applications/Claude.app",
            ],
            "config": (
                os.path.join(mac_sup, "Claude", "claude_desktop_config.json")
                if sys.platform == "darwin"
                else os.path.join(appdata, "Claude", "claude_desktop_config.json")
                if os.name == "nt"
                else os.path.join(xdg_cfg, "Claude", "claude_desktop_config.json")
            ),
        },
        "windsurf": {
            "detect": [
                os.path.join(home, ".codeium", "windsurf"),
                "/Applications/Windsurf.app",
            ],
            "config": os.path.join(home, ".codeium", "windsurf", "mcp_config.json"),
        },
        "lmstudio": {
            "detect": [
                os.path.join(home, ".lmstudio"),
                os.path.join(home, ".cache", "lm-studio"),
                "/Applications/LM Studio.app",
                os.path.join(localapp, "LM-Studio"),
            ],
            "config": os.path.join(home, ".lmstudio", "mcp.json"),
        },
        "anythingllm": {
            "detect": [
                os.path.join(mac_sup, "anythingllm-desktop"),
                os.path.join(appdata, "anythingllm-desktop"),
                os.path.join(xdg_cfg, "anythingllm-desktop"),
            ],
            "config": (
                os.path.join(mac_sup, "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json")
                if sys.platform == "darwin"
                else os.path.join(appdata, "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json")
                if os.name == "nt"
                else os.path.join(xdg_cfg, "anythingllm-desktop", "storage", "plugins", "anythingllm_mcp_servers.json")
            ),
        },
    }


def scan_ai_apps(custom_name="", custom_url=""):
    home = os.path.expanduser("~")
    appdata = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
    localapp = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    mac_sup = os.path.join(home, "Library", "Application Support")
    xdg_cfg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    mcp_paths = _resolve_mcp_config_paths()

    detected = []

    # 1. Ollama
    ollama_tags = _probe_json("http://127.0.0.1:11434/api/tags")
    ollama_installed = bool(shutil.which("ollama") or os.path.exists(os.path.join(home, ".ollama")))
    if isinstance(ollama_tags, dict) and isinstance(ollama_tags.get("models"), list):
        detected.append({
            "id": "ollama",
            "name": "Ollama",
            "status": "running",
            "endpoint": "http://127.0.0.1:11434",
            "modelsCount": len(ollama_tags["models"]),
            "bestMethod": "in_app_and_bridge",
            "canAutoConfigure": False,
        })
    elif ollama_installed:
        detected.append({
            "id": "ollama",
            "name": "Ollama",
            "status": "installed",
            "endpoint": "http://127.0.0.1:11434",
            "modelsCount": 0,
            "bestMethod": "in_app_and_bridge",
            "canAutoConfigure": False,
        })

    # 2. LM Studio
    lms_models = _probe_json("http://127.0.0.1:1234/v1/models")
    lms_installed = any(os.path.exists(p) for p in mcp_paths["lmstudio"]["detect"])
    if isinstance(lms_models, dict) and isinstance(lms_models.get("data"), list):
        detected.append({
            "id": "lmstudio",
            "name": "LM Studio",
            "status": "running",
            "endpoint": "http://127.0.0.1:1234",
            "modelsCount": len(lms_models["data"]),
            "bestMethod": "mcp",
            "canAutoConfigure": True,
            "configPath": mcp_paths["lmstudio"]["config"],
        })
    elif lms_installed:
        detected.append({
            "id": "lmstudio",
            "name": "LM Studio",
            "status": "installed",
            "endpoint": "http://127.0.0.1:1234",
            "modelsCount": 0,
            "bestMethod": "mcp",
            "canAutoConfigure": True,
            "configPath": mcp_paths["lmstudio"]["config"],
        })

    # 3. OpenWebUI (check ports 3000, 8080, 8088 strictly verifying 'webui' signature)
    owui_ep = None
    for port in (3000, 8080, 8088):
        cfg = _probe_json(f"http://127.0.0.1:{port}/api/config")
        if isinstance(cfg, dict) and ("webui" in str(cfg.get("name", "")).lower() or "default_models" in cfg):
            owui_ep = f"http://127.0.0.1:{port}"
            break
    if owui_ep or os.path.exists(os.path.join(home, ".open-webui")):
        detected.append({
            "id": "openwebui",
            "name": "OpenWebUI",
            "status": "running" if owui_ep else "installed",
            "endpoint": owui_ep or "http://127.0.0.1:8080",
            "modelsCount": 0,
            "bestMethod": "openwebui_tool",
            "canAutoConfigure": False,
        })

    # 4. Cursor, Claude Desktop, Windsurf
    for app_id, label in (("cursor", "Cursor"), ("claude_desktop", "Claude Desktop"), ("windsurf", "Windsurf")):
        info = mcp_paths[app_id]
        if any(os.path.exists(p) for p in info["detect"]):
            detected.append({
                "id": app_id,
                "name": label,
                "status": "installed",
                "endpoint": None,
                "modelsCount": 0,
                "bestMethod": "mcp",
                "canAutoConfigure": True,
                "configPath": info["config"],
            })

    # 5. AnythingLLM
    allm_ping = _probe_json("http://127.0.0.1:3001/api/ping")
    allm_installed = any(os.path.exists(p) for p in mcp_paths["anythingllm"]["detect"])
    if (isinstance(allm_ping, dict) and allm_ping.get("online")) or allm_installed:
        detected.append({
            "id": "anythingllm",
            "name": "AnythingLLM",
            "status": "running" if isinstance(allm_ping, dict) else "installed",
            "endpoint": "http://127.0.0.1:3001",
            "modelsCount": 0,
            "bestMethod": "mcp",
            "canAutoConfigure": True,
            "configPath": mcp_paths["anythingllm"]["config"],
        })

    # 6. Jan AI
    jan_models = _probe_json("http://127.0.0.1:1337/v1/models")
    jan_installed = any(
        os.path.exists(p)
        for p in (os.path.join(home, "jan"), os.path.join(appdata, "Jan"), "/Applications/Jan.app")
    )
    if (isinstance(jan_models, dict) and isinstance(jan_models.get("data"), list)) or jan_installed:
        detected.append({
            "id": "jan",
            "name": "Jan AI",
            "status": "running" if isinstance(jan_models, dict) else "installed",
            "endpoint": "http://127.0.0.1:1337",
            "modelsCount": len(jan_models.get("data", [])) if isinstance(jan_models, dict) else 0,
            "bestMethod": "openai_proxy",
            "canAutoConfigure": False,
        })

    # 7. ChatBox, Msty, GPT4All, Continue.dev, Cline
    extra_desktop = [
        ("chatbox", "ChatBox", [os.path.join(mac_sup, "xyz.chatboxapp.app"), os.path.join(appdata, "xyz.chatboxapp.app"), "/Applications/Chatbox.app"], "openai_proxy"),
        ("msty", "Msty", ["/Applications/Msty.app", os.path.join(localapp, "Programs", "Msty"), os.path.join(xdg_cfg, "Msty")], "mcp"),
        ("continue_dev", "Continue (VS Code / JetBrains)", [os.path.join(home, ".continue")], "openai_proxy"),
    ]
    for eid, elabel, epaths, emethod in extra_desktop:
        if any(os.path.exists(p) for p in epaths):
            detected.append({
                "id": eid,
                "name": elabel,
                "status": "installed",
                "endpoint": None,
                "modelsCount": 0,
                "bestMethod": emethod,
                "canAutoConfigure": False,
            })

    gpt4all_models = _probe_json("http://127.0.0.1:4891/v1/models")
    gpt4all_installed = any(
        os.path.exists(p)
        for p in (
            os.path.join(mac_sup, "nomic.ai", "GPT4All"),
            os.path.join(localapp, "nomic.ai", "GPT4All"),
            os.path.join(home, ".local", "share", "nomic.ai", "GPT4All"),
        )
    )
    if isinstance(gpt4all_models, dict) or gpt4all_installed:
        detected.append({
            "id": "gpt4all",
            "name": "GPT4All",
            "status": "running" if isinstance(gpt4all_models, dict) else "installed",
            "endpoint": "http://127.0.0.1:4891",
            "modelsCount": len(gpt4all_models.get("data", [])) if isinstance(gpt4all_models, dict) else 0,
            "bestMethod": "rest_skill_api",
            "canAutoConfigure": False,
        })

    # 8. KoboldCpp (:5001), TextGen WebUI (:5000), llama.cpp / LocalAI (:8080 when not OpenWebUI)
    kobold = _probe_json("http://127.0.0.1:5001/api/v1/model")
    if isinstance(kobold, dict) and kobold.get("result"):
        detected.append({
            "id": "koboldcpp",
            "name": "KoboldCpp",
            "status": "running",
            "endpoint": "http://127.0.0.1:5001",
            "modelsCount": 1,
            "bestMethod": "openai_proxy",
            "canAutoConfigure": False,
        })

    tgui = _probe_json("http://127.0.0.1:5000/v1/models")
    if isinstance(tgui, dict) and isinstance(tgui.get("data"), list):
        detected.append({
            "id": "textgen_webui",
            "name": "Text Generation WebUI",
            "status": "running",
            "endpoint": "http://127.0.0.1:5000",
            "modelsCount": len(tgui["data"]),
            "bestMethod": "openai_proxy",
            "canAutoConfigure": False,
        })

    if owui_ep != "http://127.0.0.1:8080":
        lcpp = _probe_json("http://127.0.0.1:8080/v1/models")
        if isinstance(lcpp, dict) and isinstance(lcpp.get("data"), list):
            detected.append({
                "id": "llamacpp",
                "name": "llama.cpp / LocalAI",
                "status": "running",
                "endpoint": "http://127.0.0.1:8080",
                "modelsCount": len(lcpp["data"]),
                "bestMethod": "in_app_and_bridge",
                "canAutoConfigure": False,
            })

    # 9. Custom user-specified app / URL probe (e.g. app named "Local")
    base_u = _normalize_local_url(custom_url)
    if base_u:
        v1_probe = _probe_json(f"{base_u}/v1/models")
        ol_probe = _probe_json(f"{base_u}/api/tags")
        label = (custom_name or "Custom Local AI App").strip()
        if isinstance(v1_probe, dict) and isinstance(v1_probe.get("data"), list):
            detected.insert(0, {
                "id": "custom_probed",
                "name": label,
                "status": "running",
                "endpoint": base_u,
                "modelsCount": len(v1_probe["data"]),
                "detectedProtocol": "openai",
                "bestMethod": "openai_proxy",
                "canAutoConfigure": False,
            })
        elif isinstance(ol_probe, dict) and isinstance(ol_probe.get("models"), list):
            detected.insert(0, {
                "id": "custom_probed",
                "name": label,
                "status": "running",
                "endpoint": base_u,
                "modelsCount": len(ol_probe["models"]),
                "detectedProtocol": "ollama",
                "bestMethod": "in_app_and_bridge",
                "canAutoConfigure": False,
            })

    return detected


def auto_configure_mcp_app(app_id, api_key):
    mcp_paths = _resolve_mcp_config_paths()
    if app_id not in mcp_paths:
        raise ValueError(f"Unsupported auto-config app: {app_id}")

    cfg_path = mcp_paths[app_id]["config"]
    os.makedirs(os.path.dirname(cfg_path), exist_ok=True)

    existing = {}
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            shutil.copyfile(cfg_path, f"{cfg_path}.cloudy.bak")
        except Exception:
            existing = {}

    if not isinstance(existing, dict):
        existing = {}
    if not isinstance(existing.get("mcpServers"), dict):
        existing["mcpServers"] = {}

    mcp_script = os.path.abspath(os.path.join(BASE_DIR, "cloudy_mcp_server.py"))
    py_cmd = sys.executable or "python3"

    existing["mcpServers"]["cloudy-vault"] = {
        "command": py_cmd,
        "args": [mcp_script],
        "env": {
            "CLOUDY_API_KEY": api_key,
            "CLOUDY_LOCAL_URL": "http://127.0.0.1:8765",
            "CLOUDY_REMOTE_URL": CLOUD_ORIGIN,
        },
    }

    save_json_atomic(cfg_path, existing)
    return cfg_path


def create_file_in_vault(key_obj, name, content_str, folder_id=None, mime="text/markdown", tags=None, b64=None, custom_id=None):
    folders, _, allowed = allowed_items(key_obj)
    if allowed is not None and not folder_id:
        folder_id = next(iter(allowed), None)
    if allowed is not None and (not folder_id or folder_id not in allowed):
        raise PermissionError("Target folderId is outside permitted folders")

    fid = custom_id if str(custom_id or "").startswith("fil_") else f"fil_{secrets.token_hex(6)}"
    tags_list = tags if isinstance(tags, list) else ["ai-generated"]
    raw_bytes = base64.b64decode(b64) if b64 else content_str.encode("utf-8")
    rel_blob = f"vault/blobs/{fid}_{safe_filename(name)}"
    with open(os.path.join(BASE_DIR, rel_blob), "wb") as bf:
        bf.write(raw_bytes)

    folder_path = next((fl.get("path", "/") for fl in folders if fl["id"] == folder_id), "/") if folder_id else "/"
    ts = now_iso()
    record = {
        "id": fid,
        "name": name,
        "folderId": folder_id,
        "folderPath": folder_path,
        "mimeType": mime,
        "kind": "note",
        "size": len(raw_bytes),
        "providerName": "Offline Vault (Pending Sync)",
        "tags": tags_list,
        "textContent": raw_bytes.decode("utf-8", errors="replace") if is_text_like(mime, name) else None,
        "blobPath": rel_blob,
        "updatedAt": ts,
    }

    sync_payload = {
        "id": fid,
        "name": name,
        "content": content_str,
        "base64Content": b64,
        "folderId": folder_id,
        "mimeType": mime,
        "tags": tags_list,
    }

    pushed_live = False
    try:
        st, remote_res = remote_request("POST", "/api/v1/ai/files", key_obj["key"], sync_payload, timeout=10)
        if 200 <= st < 300 and isinstance(remote_res, dict) and remote_res.get("file"):
            rf = remote_res["file"]
            record["providerName"] = rf.get("providerName", "Cloud")
            record["updatedAt"] = rf.get("updatedAt", ts)
            pushed_live = True
            with LOCK:
                SYNC_STATE["online"] = True
                SYNC_STATE["lastSyncedAt"] = now_iso()
    except Exception:
        pushed_live = False

    with LOCK:
        VAULT["files"] = [record] + [f for f in VAULT.get("files", []) if f["id"] != fid]
        if not pushed_live:
            PENDING_QUEUE.append(
                {
                    "id": f"q_{int(time.time()*1000)}_{fid}",
                    "type": "create_file",
                    "apiKey": key_obj["key"],
                    "payload": sync_payload,
                    "createdAt": ts,
                }
            )
        persist_local_state()

    return record, pushed_live


def build_vault_skill_context(key_obj, user_prompt):
    folders, files, _ = allowed_items(key_obj)
    used_skills = []
    terms = [
        w.lower()
        for w in re.findall(r"[a-zA-Z0-9_.-]{3,}", user_prompt or "")
        if w.lower() not in {"the", "and", "for", "with", "what", "read", "file", "files", "from", "cloudy", "vault", "summarize", "please", "can", "you", "my", "all", "notes"}
    ]

    scored = []
    for f in files:
        txt = read_file_text_local(f) or ""
        name_hay = f"{f.get('name','')} {f.get('folderPath','')}".lower()
        body_hay = txt.lower()
        sc = 1
        for t in terms:
            if t in name_hay:
                sc += 8
            if t in body_hay:
                sc += 3
        scored.append((sc, f, txt))

    scored.sort(key=lambda item: item[0], reverse=True)
    selected = scored[:4]

    folder_summary = ", ".join(fld.get("path") or f"/{fld.get('name')}" for fld in folders) or "/ (Root)"
    used_skills.append({"skill": "list_folders", "detail": f"{len(folders)} folder(s)"})

    file_blocks = []
    for _, f, txt in selected:
        used_skills.append({"skill": "read_file", "detail": f.get("name", f["id"])})
        snippet = txt[:4000] if txt else f"[Binary file: {f.get('mimeType')}, {f.get('size', 0)} bytes]"
        file_blocks.append(
            f"--- FILE: {f.get('folderPath', '/')}/{f.get('name')} (id: {f['id']}) ---\\n{snippet}"
        )

    write_hint = ""
    if key_obj.get("scope") == "read_write":
        write_hint = (
            "\\nIf the user asks you to create or save a new note/file into Cloudy, wrap the file content in "
            '<cloudy_write name="filename.md">...content...</cloudy_write> and Cloudy will save & auto-sync it.'
        )

    sys_context = (
        "You are connected to the user's Cloudy by X-Kilo Vault (Offline + Live Auto-Sync).\\n"
        f"Accessible Carpetas (Folders): {folder_summary}\\n"
        f"Total Accessible Files: {len(files)}\\n"
        + write_hint
        + "\\n\\nVault File Contents:\\n"
        + ("\\n\\n".join(file_blocks) if file_blocks else "(No files stored in vault yet.)")
    )
    return sys_context, used_skills


def call_local_llm(endpoint, kind, model, full_messages):
    if kind == "ollama":
        req = urllib.request.Request(
            f"{endpoint.rstrip('/')}/api/chat",
            data=json.dumps({"model": model, "messages": full_messages, "stream": False}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        return (out.get("message") or {}).get("content") or out.get("response") or ""
    else:
        req = urllib.request.Request(
            f"{endpoint.rstrip('/')}/v1/chat/completions",
            data=json.dumps({"model": model, "messages": full_messages, "stream": False}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        choices = out.get("choices") or []
        return ((choices[0].get("message") or {}).get("content") if choices else "") or ""


def sync_with_cloud_once():
    if not CLOUD_ORIGIN:
        return {"ok": False, "online": False, "reason": "No cloudOrigin configured"}

    with LOCK:
        if SYNC_STATE["syncing"]:
            return {"ok": True, "online": SYNC_STATE["online"], "skipped": "already_syncing"}
        SYNC_STATE["syncing"] = True
        SYNC_STATE["lastAttemptAt"] = now_iso()
        keys = list(VAULT.get("apiKeys") or [])
        queue_snapshot = list(PENDING_QUEUE)

    if not keys:
        with LOCK:
            SYNC_STATE["syncing"] = False
        return {"ok": False, "online": False, "reason": "No API keys in manifest"}

    pushed_count = 0
    downloaded_blobs = 0

    try:
        rw_key = next((k["key"] for k in keys if k.get("scope") == "read_write"), keys[0]["key"])
        synced_queue_ids = set()

        for item in queue_snapshot:
            q_key = item.get("apiKey") or rw_key
            q_type = item.get("type")
            payload = item.get("payload") or {}
            try:
                if q_type == "create_file":
                    status, _ = remote_request("POST", "/api/v1/ai/files", q_key, payload, timeout=15)
                    if 200 <= status < 300:
                        synced_queue_ids.add(item["id"])
                        pushed_count += 1
                elif q_type == "update_file":
                    fid = payload.get("fileId")
                    body = {k: v for k, v in payload.items() if k != "fileId"}
                    status, _ = remote_request("PATCH", f"/api/v1/ai/files/{fid}", q_key, body, timeout=15)
                    if 200 <= status < 300 or status == 404:
                        synced_queue_ids.add(item["id"])
                        pushed_count += 1
            except urllib.error.HTTPError as he:
                if he.code in (400, 403):
                    synced_queue_ids.add(item["id"])
                else:
                    raise

        if synced_queue_ids:
            with LOCK:
                PENDING_QUEUE[:] = [q for q in PENDING_QUEUE if q.get("id") not in synced_queue_ids]
                save_json_atomic(QUEUE_PATH, PENDING_QUEUE)

        merged_folders = {}
        merged_files = {}
        key_for_file = {}
        reachable = False

        for k_obj in keys:
            k_token = k_obj.get("key")
            if not k_token:
                continue
            try:
                status, data = remote_request("GET", "/api/v1/ai/sync-manifest", k_token, timeout=10)
                if status == 200 and isinstance(data, dict) and data.get("ok"):
                    reachable = True
                    if isinstance(data.get("key"), dict):
                        k_obj["scope"] = data["key"].get("scope", k_obj.get("scope", "read"))
                        k_obj["allowedFolderIds"] = data["key"].get("allowedFolderIds", k_obj.get("allowedFolderIds", []))
                    for fld in data.get("folders", []):
                        merged_folders[fld["id"]] = fld
                    for fl in data.get("files", []):
                        merged_files[fl["id"]] = fl
                        key_for_file[fl["id"]] = k_token
            except urllib.error.HTTPError as he:
                if he.code in (401, 403):
                    continue
                raise

        if not reachable:
            raise ConnectionError("Unable to reach Cloudy sync-manifest")

        with LOCK:
            existing_by_id = {f["id"]: f for f in VAULT.get("files", [])}
            unsynced_file_ids = {
                (q.get("payload") or {}).get("id") or (q.get("payload") or {}).get("fileId")
                for q in PENDING_QUEUE
            }

        final_files = []
        for fid, remote_f in merged_files.items():
            prev = existing_by_id.get(fid)
            rel_blob = f"vault/blobs/{fid}_{safe_filename(remote_f.get('name'))}"
            abs_blob = os.path.join(BASE_DIR, rel_blob)

            prev_blob_rel = prev.get("blobPath") if prev else None
            prev_blob_abs = os.path.join(BASE_DIR, prev_blob_rel) if prev_blob_rel else None
            same_version = bool(
                prev
                and prev.get("updatedAt") == remote_f.get("updatedAt")
                and prev_blob_abs
                and os.path.exists(prev_blob_abs)
            )

            blob_saved_rel = prev_blob_rel if same_version else None

            if not same_version and (remote_f.get("size") or 0) <= MAX_AUTO_BLOB_BYTES:
                if isinstance(remote_f.get("textContent"), str):
                    with open(abs_blob, "wb") as bf:
                        bf.write(remote_f["textContent"].encode("utf-8"))
                    blob_saved_rel = rel_blob
                    downloaded_blobs += 1
                else:
                    try:
                        st, raw_bytes = remote_request(
                            "GET",
                            f"/api/v1/ai/files/{fid}/raw",
                            key_for_file[fid],
                            timeout=25,
                        )
                        if st == 200 and isinstance(raw_bytes, (bytes, bytearray)):
                            with open(abs_blob, "wb") as bf:
                                bf.write(raw_bytes)
                            blob_saved_rel = rel_blob
                            downloaded_blobs += 1
                    except Exception:
                        if prev_blob_abs and os.path.exists(prev_blob_abs):
                            blob_saved_rel = prev_blob_rel

            entry = dict(remote_f)
            entry["blobPath"] = blob_saved_rel
            final_files.append(entry)

        for fid, local_f in existing_by_id.items():
            if fid not in merged_files and fid in unsynced_file_ids:
                final_files.insert(0, local_f)

        synced_ts = now_iso()
        with LOCK:
            VAULT["folders"] = list(merged_folders.values())
            VAULT["files"] = final_files
            VAULT["lastSyncedAt"] = synced_ts
            SYNC_STATE["online"] = True
            SYNC_STATE["lastSyncedAt"] = synced_ts
            SYNC_STATE["lastError"] = None
            persist_local_state()

        return {
            "ok": True,
            "online": True,
            "pushedCount": pushed_count,
            "pulledFilesCount": len(final_files),
            "downloadedBlobsCount": downloaded_blobs,
            "lastSyncedAt": synced_ts,
        }

    except Exception as exc:
        with LOCK:
            SYNC_STATE["online"] = False
            SYNC_STATE["lastError"] = str(exc)
        return {
            "ok": False,
            "online": False,
            "error": str(exc),
            "lastSyncedAt": SYNC_STATE["lastSyncedAt"],
        }
    finally:
        with LOCK:
            SYNC_STATE["syncing"] = False


def auto_sync_daemon():
    while True:
        sync_with_cloud_once()
        time.sleep(SYNC_INTERVAL)


class CloudyOfflineHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-API-Key, Content-Type, X-Cloudy-Offline-Test")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, code, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def authenticate(self, query, allow_default_local=False):
        auth = self.headers.get("Authorization", "")
        token = (
            auth[7:].strip()
            if auth.startswith("Bearer ")
            else (self.headers.get("X-API-Key") or query.get("api_key", [""])[0] or "").strip()
        )
        with LOCK:
            keys = VAULT.get("apiKeys", [])
            for k in keys:
                if k.get("key") == token:
                    return k
            if allow_default_local and keys and token in ("", "cloudy", "local"):
                return keys[0]
        return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        p = parsed.path

        # OpenAI-compatible Plug & Play model list (/v1/models and /models)
        if p in ("/v1/models", "/models"):
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"error": {"message": "Invalid Cloudy API Key"}})
            _, models = discover_local_ai_models()
            return self.send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": m["id"],
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": f"cloudy-{m['provider']}",
                        }
                        for m in models
                    ],
                },
            )

        # Public local ping / model discovery for 1-click browser detection
        if p == "/api/v1/ai/local-models":
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"ok": False, "error": "Invalid Cloudy AI API Key"})
            runtimes, models = discover_local_ai_models()
            with LOCK:
                st = dict(SYNC_STATE)
                q_len = len(PENDING_QUEUE)
            return self.send_json(
                200,
                {
                    "ok": True,
                    "bridge": "cloudy-plug-and-play-v3",
                    "onlineSyncConnected": st["online"],
                    "lastSyncedAt": st["lastSyncedAt"],
                    "pendingOfflineQueue": q_len,
                    "runtimes": runtimes,
                    "models": models,
                },
            )

        # Scan installed & running AI apps on this computer/device
        if p == "/api/v1/ai/scan-apps":
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"ok": False, "error": "Invalid Cloudy AI API Key"})
            c_name = query.get("customName", [""])[0]
            c_url = query.get("customUrl", [""])[0]
            apps = scan_ai_apps(c_name, c_url)
            return self.send_json(
                200,
                {
                    "ok": True,
                    "bridge": True,
                    "mcpScriptPath": os.path.abspath(os.path.join(BASE_DIR, "cloudy_mcp_server.py")),
                    "apps": apps,
                },
            )

        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        folders, files, _ = allowed_items(key_obj)

        if p == "/api/v1/ai/status":
            with LOCK:
                q_len = len(PENDING_QUEUE)
                st = dict(SYNC_STATE)
            runtimes, models = discover_local_ai_models()
            return self.send_json(
                200,
                {
                    "ok": True,
                    "mode": "local-ai-server-auto-sync",
                    "onlineSyncConnected": st["online"],
                    "cloudOrigin": CLOUD_ORIGIN,
                    "autoSyncIntervalSec": SYNC_INTERVAL,
                    "lastSyncedAt": st["lastSyncedAt"],
                    "pendingOfflineQueue": q_len,
                    "detectedLocalModels": len(models),
                    "detectedRuntimes": [r["name"] for r in runtimes],
                    "keyName": key_obj["name"],
                    "scope": key_obj.get("scope", "read"),
                    "accessibleFolders": len(folders),
                    "accessibleFiles": len(files),
                },
            )

        if p == "/api/v1/ai/folders":
            return self.send_json(200, {"ok": True, "count": len(folders), "folders": folders})

        if p == "/api/v1/ai/files":
            folder_id = query.get("folderId", [None])[0]
            filtered = [
                f
                for f in files
                if (
                    not folder_id
                    or (folder_id == "root" and not f.get("folderId"))
                    or f.get("folderId") == folder_id
                )
            ]
            clean = [{k: v for k, v in f.items() if k not in ("textContent", "blobPath")} for f in filtered]
            return self.send_json(200, {"ok": True, "count": len(clean), "files": clean})

        if p == "/api/v1/ai/search":
            q = (query.get("q", [""])[0] or "").lower().strip()
            terms = [t for t in q.split() if t]
            scored = []
            for f in files:
                name_hay = f"{f.get('name','')} {f.get('folderPath','')} {' '.join(f.get('tags') or [])}".lower()
                body_hay = (read_file_text_local(f) or "").lower()
                if not terms:
                    scored.append((1, f))
                    continue
                sc = sum((5 if t in name_hay else 0) + (2 if t in body_hay else 0) for t in terms)
                if sc > 0:
                    scored.append((sc, f))
            scored.sort(key=lambda pair: pair[0], reverse=True)
            results = [
                {
                    "id": f["id"],
                    "name": f["name"],
                    "folderId": f.get("folderId"),
                    "folderPath": f.get("folderPath", "/"),
                    "mimeType": f.get("mimeType"),
                    "size": f.get("size", 0),
                    "score": sc,
                    "snippet": (read_file_text_local(f) or "")[:600],
                    "readUrl": f"/api/v1/ai/files/{f['id']}/content",
                }
                for sc, f in scored[:25]
            ]
            return self.send_json(200, {"ok": True, "query": q, "count": len(results), "results": results})

        if p.startswith("/api/v1/ai/files/") and p.endswith("/content"):
            file_id = urllib.parse.unquote(p.split("/")[5])
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            content = read_file_text_local(target)
            return self.send_json(
                200,
                {
                    "ok": True,
                    "file": {
                        "id": target["id"],
                        "name": target["name"],
                        "folderId": target.get("folderId"),
                        "folderPath": target.get("folderPath", "/"),
                        "mimeType": target.get("mimeType"),
                        "size": target.get("size", 0),
                        "updatedAt": target.get("updatedAt"),
                    },
                    "content": content
                    if content is not None
                    else "[Binary file — fetch /api/v1/ai/files/:id/raw for raw bytes]",
                },
            )

        if p.startswith("/api/v1/ai/files/") and p.endswith("/raw"):
            file_id = urllib.parse.unquote(p.split("/")[5])
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            raw_bytes = None
            if target.get("blobPath"):
                abs_b = os.path.join(BASE_DIR, target["blobPath"])
                if os.path.exists(abs_b):
                    with open(abs_b, "rb") as bf:
                        raw_bytes = bf.read()
            if raw_bytes is None and isinstance(target.get("textContent"), str):
                raw_bytes = target["textContent"].encode("utf-8")
            if raw_bytes is None:
                return self.send_json(404, {"ok": False, "error": "Binary blob not cached locally yet"})

            self.send_response(200)
            self.send_header("Content-Type", target.get("mimeType") or "application/octet-stream")
            self.send_cors_headers()
            self.send_header("Content-Length", str(len(raw_bytes)))
            self.end_headers()
            self.wfile.write(raw_bytes)
            return

        return self.send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        p = parsed.path

        # OpenAI-compatible Plug & Play Chat Completions (/v1/chat/completions and /chat/completions)
        if p in ("/v1/chat/completions", "/chat/completions"):
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"error": {"message": "Invalid Cloudy API Key"}})
            try:
                body = self.read_json_body()
                req_model = body.get("model") or ""
                want_stream = bool(body.get("stream"))
                messages = list(body.get("messages") or [])
                _, discovered = discover_local_ai_models()
                chosen = next((m for m in discovered if m["id"] == req_model), discovered[0] if discovered else None)
                if not chosen:
                    return self.send_json(400, {"error": {"message": "No local AI runtime (Ollama / LM Studio / llama.cpp) running on 127.0.0.1"}})
                last_user = next(
                    (
                        m.get("content", "") if isinstance(m.get("content"), str) else json.dumps(m.get("content"))
                        for m in reversed(messages)
                        if m.get("role") == "user"
                    ),
                    "",
                )
                sys_ctx, _ = build_vault_skill_context(key_obj, last_user)
                augmented = [{"role": "system", "content": sys_ctx}] + messages
                reply = call_local_llm(chosen["endpoint"], chosen["kind"], chosen["id"], augmented)

                if key_obj.get("scope") == "read_write":
                    match = re.search(r'<cloudy_write\\s+name="([^"]+)"\\s*>([\\s\\S]*?)</cloudy_write>', reply)
                    if match:
                        create_file_in_vault(key_obj, match.group(1).strip(), match.group(2).strip(), body.get("folderId"))

                cmpl_id = f"chatcmpl_{secrets.token_hex(8)}"
                created_ts = int(time.time())

                if want_stream:
                    chunks = [
                        {
                            "id": cmpl_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": chosen["id"],
                            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
                        },
                        {
                            "id": cmpl_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": chosen["id"],
                            "choices": [{"index": 0, "delta": {"content": reply}, "finish_reason": None}],
                        },
                        {
                            "id": cmpl_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": chosen["id"],
                            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                        },
                    ]
                    sse_payload = "".join(f"data: {json.dumps(c)}\\n\\n" for c in chunks) + "data: [DONE]\\n\\n"
                    sse_bytes = sse_payload.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_cors_headers()
                    self.send_header("Content-Length", str(len(sse_bytes)))
                    self.end_headers()
                    self.wfile.write(sse_bytes)
                    return

                return self.send_json(
                    200,
                    {
                        "id": cmpl_id,
                        "object": "chat.completion",
                        "created": created_ts,
                        "model": chosen["id"],
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}],
                    },
                )
            except Exception as exc:
                return self.send_json(500, {"error": {"message": str(exc)}})

        # 1-Click Auto-Configure MCP Desktop Apps (Cursor, Claude Desktop, Windsurf, LM Studio, AnythingLLM)
        if p == "/api/v1/ai/auto-connect-app":
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"ok": False, "error": "Invalid Cloudy AI API Key"})
            try:
                body = self.read_json_body()
                app_id = str(body.get("appId") or "").strip()
                cfg_path = auto_configure_mcp_app(app_id, key_obj["key"])
                return self.send_json(
                    200,
                    {
                        "ok": True,
                        "appId": app_id,
                        "configPath": cfg_path,
                        "message": f"Connected Cloudy Vault MCP into {cfg_path}",
                    },
                )
            except Exception as exc:
                return self.send_json(400, {"ok": False, "error": str(exc)})

        # 1-Click In-App Cloudy AI Chat Bridge (/api/v1/ai/local-chat)
        if p == "/api/v1/ai/local-chat":
            key_obj = self.authenticate(query, allow_default_local=True)
            if not key_obj:
                return self.send_json(401, {"ok": False, "error": "Invalid Cloudy AI API Key"})
            try:
                body = self.read_json_body()
                req_model = body.get("model") or ""
                req_provider = body.get("provider") or ""
                messages = list(body.get("messages") or [])
                _, discovered = discover_local_ai_models()
                chosen = next(
                    (m for m in discovered if m["id"] == req_model and (not req_provider or m["provider"] == req_provider)),
                    discovered[0] if discovered else None,
                )
                if not chosen:
                    return self.send_json(400, {"ok": False, "error": "No running local AI model found on Ollama, LM Studio, llama.cpp, or Jan."})

                last_user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
                sys_ctx, used_skills = build_vault_skill_context(key_obj, last_user)
                augmented = [{"role": "system", "content": sys_ctx}] + messages
                reply = call_local_llm(chosen["endpoint"], chosen["kind"], chosen["id"], augmented)

                created_file = None
                if key_obj.get("scope") == "read_write":
                    match = re.search(r'<cloudy_write\\s+name="([^"]+)"\\s*>([\\s\\S]*?)</cloudy_write>', reply)
                    if match:
                        note_name = match.group(1).strip()
                        note_body = match.group(2).strip()
                        created_file, _ = create_file_in_vault(key_obj, note_name, note_body, body.get("folderId"))
                        used_skills.append({"skill": "write_note", "detail": note_name})

                return self.send_json(
                    200,
                    {
                        "ok": True,
                        "model": chosen["id"],
                        "providerName": chosen["providerName"],
                        "reply": reply,
                        "usedSkills": used_skills,
                        "createdFile": created_file,
                    },
                )
            except Exception as exc:
                return self.send_json(500, {"ok": False, "error": str(exc)})

        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        if p == "/api/v1/ai/sync":
            result = sync_with_cloud_once()
            return self.send_json(200, result)

        if p == "/api/v1/ai/files":
            if key_obj.get("scope") != "read_write":
                return self.send_json(403, {"ok": False, "error": "API key is read-only; read_write scope required"})

            body = self.read_json_body()
            name = (body.get("name") or "").strip()
            if not name:
                return self.send_json(400, {"ok": False, "error": 'Field "name" is required'})

            try:
                record, pushed_live = create_file_in_vault(
                    key_obj,
                    name=name,
                    content_str=str(body.get("content", "")),
                    folder_id=body.get("folderId"),
                    mime=body.get("mimeType") or "text/markdown",
                    tags=body.get("tags"),
                    b64=body.get("base64Content"),
                    custom_id=body.get("id"),
                )
                return self.send_json(201, {"ok": True, "syncedLive": pushed_live, "file": record})
            except PermissionError as pe:
                return self.send_json(403, {"ok": False, "error": str(pe)})

        return self.send_json(404, {"ok": False, "error": "Unknown POST endpoint"})

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        key_obj = self.authenticate(query)
        if not key_obj:
            return self.send_json(401, {"ok": False, "error": "Invalid or missing Cloudy AI API Key"})

        p = parsed.path
        if p.startswith("/api/v1/ai/files/"):
            if key_obj.get("scope") != "read_write":
                return self.send_json(403, {"ok": False, "error": "API key is read-only; read_write scope required"})

            file_id = urllib.parse.unquote(p.split("/")[5])
            _, files, allowed = allowed_items(key_obj)
            target = next((f for f in files if f["id"] == file_id), None)
            if not target:
                return self.send_json(404, {"ok": False, "error": "File not found or not permitted"})

            body = self.read_json_body()
            if "folderId" in body and allowed is not None and body["folderId"] not in allowed:
                return self.send_json(403, {"ok": False, "error": "Target folderId is outside permitted folders"})

            ts = now_iso()
            with LOCK:
                stored = next((f for f in VAULT.get("files", []) if f["id"] == file_id), None)
                if not stored:
                    return self.send_json(404, {"ok": False, "error": "File missing"})
                if isinstance(body.get("name"), str) and body["name"].strip():
                    stored["name"] = body["name"].strip()
                if "folderId" in body:
                    stored["folderId"] = body["folderId"]
                if isinstance(body.get("tags"), list):
                    stored["tags"] = body["tags"]

                next_text = body.get("content") if isinstance(body.get("content"), str) else body.get("textContent")
                if isinstance(next_text, str):
                    raw_bytes = next_text.encode("utf-8")
                    rel_blob = stored.get("blobPath") or f"vault/blobs/{file_id}_{safe_filename(stored['name'])}"
                    with open(os.path.join(BASE_DIR, rel_blob), "wb") as bf:
                        bf.write(raw_bytes)
                    stored["blobPath"] = rel_blob
                    stored["textContent"] = next_text
                    stored["size"] = len(raw_bytes)

                stored["updatedAt"] = ts
                snapshot_file = dict(stored)

            pushed_live = False
            try:
                st, _ = remote_request("PATCH", f"/api/v1/ai/files/{file_id}", key_obj["key"], body, timeout=10)
                if 200 <= st < 300:
                    pushed_live = True
                    with LOCK:
                        SYNC_STATE["online"] = True
                        SYNC_STATE["lastSyncedAt"] = now_iso()
            except Exception:
                pushed_live = False

            with LOCK:
                if not pushed_live:
                    PENDING_QUEUE.append(
                        {
                            "id": f"q_{int(time.time()*1000)}_{file_id}",
                            "type": "update_file",
                            "apiKey": key_obj["key"],
                            "payload": {"fileId": file_id, **body},
                            "createdAt": ts,
                        }
                    )
                persist_local_state()

            return self.send_json(200, {"ok": True, "syncedLive": pushed_live, "file": snapshot_file})

        return self.send_json(404, {"ok": False, "error": "Unknown PATCH endpoint"})


if __name__ == "__main__":
    port = int(os.environ.get("CLOUDY_OFFLINE_PORT", "8765"))
    sync_thread = threading.Thread(target=auto_sync_daemon, daemon=True)
    sync_thread.start()
    runtimes, models = discover_local_ai_models()
    rt_label = ", ".join(f"{r['name']} ({r['modelCount']} models)" for r in runtimes) or "waiting for Ollama / LM Studio..."
    print("================================================================")
    print(f"☁️  Cloudy Plug & Play Local AI Bridge: http://127.0.0.1:{port}")
    print(f"🤖 OpenAI-Compatible Endpoint:          http://127.0.0.1:{port}/v1")
    print(f"🧠 Detected Local Runtimes:             {rt_label}")
    print(f"🔄 Live Cloud Auto-Sync:                Every {SYNC_INTERVAL}s ({CLOUD_ORIGIN})")
    print("================================================================")
    ThreadingHTTPServer(("127.0.0.1", port), CloudyOfflineHandler).serve_forever()
`;
}

export function buildMcpServerPython(cloudOrigin, sampleKey) {
  return `#!/usr/bin/env python3
"""
Cloudy by X-Kilo — Zero-Dependency MCP Server (Model Context Protocol 2024-11-05)
Works out-of-the-box with Claude Desktop, Cursor, Cline, Windsurf, Qwen-Agent & LM Studio MCP!
Automatically reads from Local Auto-Sync Bridge -> Online Cloud -> Local Offline Disk Vault!
"""
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VAULT_DIR = os.path.join(BASE_DIR, "vault")
BLOBS_DIR = os.path.join(VAULT_DIR, "blobs")
MANIFEST_PATH = os.path.join(VAULT_DIR, "manifest.json")
QUEUE_PATH = os.path.join(VAULT_DIR, "pending_queue.json")

API_KEY = os.environ.get("CLOUDY_API_KEY", "${sampleKey}")
LOCAL_URL = os.environ.get("CLOUDY_LOCAL_URL", "http://127.0.0.1:8765")
ONLINE_URL = os.environ.get("CLOUDY_REMOTE_URL", "${cloudOrigin}")
USE_CONTENT_LENGTH_FRAMING = False


def call_cloudy(method, path, body=None):
    for base in (LOCAL_URL, ONLINE_URL):
        if not base:
            continue
        try:
            headers = {"Authorization": f"Bearer {API_KEY}"}
            data = None
            if body is not None:
                data = json.dumps(body).encode("utf-8")
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(f"{base.rstrip('/')}{path}", data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue

    # Direct offline disk fallback if neither local bridge nor internet is active
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            vault = json.load(f)
        if path == "/api/v1/ai/folders":
            return {"ok": True, "folders": vault.get("folders", [])}
        if path.startswith("/api/v1/ai/search"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(path).query).get("q", [""])[0].lower()
            hits = [
                {"id": fl["id"], "name": fl["name"], "folderPath": fl.get("folderPath", "/"), "snippet": (fl.get("textContent") or "")[:400]}
                for fl in vault.get("files", [])
                if not q or q in f"{fl.get('name','')} {fl.get('textContent','')}".lower()
            ]
            return {"ok": True, "results": hits}
        if path.startswith("/api/v1/ai/files/") and path.endswith("/content"):
            fid = path.split("/")[5]
            target = next((fl for fl in vault.get("files", []) if fl["id"] == fid), None)
            if target:
                txt = target.get("textContent")
                if txt is None and target.get("blobPath"):
                    bp = os.path.join(BASE_DIR, target["blobPath"])
                    if os.path.exists(bp):
                        with open(bp, "rb") as bf:
                            txt = bf.read().decode("utf-8", errors="replace")
                return {"ok": True, "file": target, "content": txt or ""}
        if method == "POST" and path == "/api/v1/ai/files" and isinstance(body, dict):
            os.makedirs(BLOBS_DIR, exist_ok=True)
            fid = f"fil_{secrets.token_hex(6)}"
            name = str(body.get("name") or "note.md").strip()
            content = str(body.get("content") or "")
            safe = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
            rel_blob = f"vault/blobs/{fid}_{safe}"
            raw_b = content.encode("utf-8")
            with open(os.path.join(BASE_DIR, rel_blob), "wb") as bf:
                bf.write(raw_b)
            ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            rec = {
                "id": fid,
                "name": name,
                "folderId": body.get("folderId"),
                "folderPath": "/",
                "mimeType": "text/markdown",
                "kind": "note",
                "size": len(raw_b),
                "providerName": "Offline Vault (Queued)",
                "tags": ["ai-generated"],
                "textContent": content,
                "blobPath": rel_blob,
                "updatedAt": ts,
            }
            vault["files"] = [rec] + list(vault.get("files", []))
            with open(MANIFEST_PATH, "w", encoding="utf-8") as mf:
                json.dump(vault, mf, indent=2)
            queue = []
            if os.path.exists(QUEUE_PATH):
                try:
                    with open(QUEUE_PATH, "r", encoding="utf-8") as qf:
                        queue = json.load(qf)
                except Exception:
                    queue = []
            queue.append({
                "id": f"q_{int(time.time()*1000)}_{fid}",
                "type": "create_file",
                "apiKey": API_KEY,
                "payload": {"id": fid, "name": name, "content": content, "folderId": body.get("folderId")},
                "createdAt": ts,
            })
            with open(QUEUE_PATH, "w", encoding="utf-8") as qf:
                json.dump(queue, qf, indent=2)
            return {"ok": True, "syncedLive": False, "file": rec}
    raise RuntimeError("Cloudy vault unreachable")


TOOLS = [
    {
        "name": "list_cloudy_folders",
        "description": "List all accessible folders (carpetas) in the user's Cloudy storage vault.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_cloudy_files",
        "description": "Search files and notes in the Cloudy vault (works online and offline).",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search keywords (empty string lists all files)"}},
        },
    },
    {
        "name": "read_cloudy_file",
        "description": "Read the full content of a file or note from Cloudy by its file ID.",
        "inputSchema": {
            "type": "object",
            "properties": {"file_id": {"type": "string", "description": "File ID such as fil_welcome"}},
            "required": ["file_id"],
        },
    },
    {
        "name": "write_cloudy_note",
        "description": "Create and save a Markdown/text note into Cloudy (auto-syncs to cloud when online).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Filename e.g. summary.md"},
                "content": {"type": "string", "description": "Full text content"},
                "folder_id": {"type": "string", "description": "Optional folder ID"},
            },
            "required": ["name", "content"],
        },
    },
]


def read_rpc_message():
    global USE_CONTENT_LENGTH_FRAMING
    line = sys.stdin.buffer.readline()
    if not line:
        return None
    stripped = line.strip()
    if stripped.lower().startswith(b"content-length:"):
        USE_CONTENT_LENGTH_FRAMING = True
        length = int(stripped.split(b":", 1)[1].strip())
        while True:
            hdr = sys.stdin.buffer.readline()
            if not hdr or hdr in (b"\\r\\n", b"\\n"):
                break
        body = sys.stdin.buffer.read(length)
        return json.loads(body.decode("utf-8"))
    if not stripped:
        return read_rpc_message()
    return json.loads(stripped.decode("utf-8"))


def write_rpc_message(payload):
    encoded = json.dumps(payload).encode("utf-8")
    if USE_CONTENT_LENGTH_FRAMING:
        sys.stdout.buffer.write(f"Content-Length: {len(encoded)}\\r\\n\\r\\n".encode("ascii") + encoded)
        sys.stdout.buffer.flush()
    else:
        sys.stdout.buffer.write(encoded + b"\\n")
        sys.stdout.buffer.flush()


def handle_tool_call(name, args):
    args = args or {}
    if name == "list_cloudy_folders":
        res = call_cloudy("GET", "/api/v1/ai/folders")
        return json.dumps(res.get("folders", []), indent=2)
    if name == "search_cloudy_files":
        q = urllib.parse.quote(str(args.get("query", "")))
        res = call_cloudy("GET", f"/api/v1/ai/search?q={q}")
        return json.dumps(res.get("results", []), indent=2)
    if name == "read_cloudy_file":
        fid = urllib.parse.quote(str(args.get("file_id", "")))
        res = call_cloudy("GET", f"/api/v1/ai/files/{fid}/content")
        return str(res.get("content", ""))
    if name == "write_cloudy_note":
        body = {"name": args.get("name"), "content": args.get("content", ""), "folderId": args.get("folder_id") or None}
        res = call_cloudy("POST", "/api/v1/ai/files", body)
        return json.dumps(res, indent=2)
    raise ValueError(f"Unknown tool: {name}")


def main():
    while True:
        msg = read_rpc_message()
        if msg is None:
            break
        method = msg.get("method")
        msg_id = msg.get("id")
        if msg_id is None:
            continue
        try:
            if method == "initialize":
                write_rpc_message({
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "cloudy-xkilo-vault", "version": "3.0.0"},
                    },
                })
            elif method == "ping":
                write_rpc_message({"jsonrpc": "2.0", "id": msg_id, "result": {}})
            elif method == "tools/list":
                write_rpc_message({"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}})
            elif method == "resources/list":
                write_rpc_message({"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}})
            elif method == "prompts/list":
                write_rpc_message({"jsonrpc": "2.0", "id": msg_id, "result": {"prompts": []}})
            elif method == "tools/call":
                params = msg.get("params") or {}
                text = handle_tool_call(params.get("name"), params.get("arguments"))
                write_rpc_message({
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {"content": [{"type": "text", "text": text}]},
                })
            else:
                write_rpc_message({"jsonrpc": "2.0", "id": msg_id, "result": {}})
        except Exception as exc:
            write_rpc_message({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"content": [{"type": "text", "text": f"Error: {exc}"}], "isError": True},
            })


if __name__ == "__main__":
    main()
`;
}

export function buildOpenWebUiToolPython(cloudOrigin, sampleKey) {
  return `"""
title: Cloudy Vault Skills (Plug & Play)
author: X-Kilo
version: 3.0.0
description: Pre-configured Online + Offline Read/Search/Save Vault Skills for local Ollama, DeepSeek, Qwen & Llama models in OpenWebUI.
"""
import json
import urllib.parse
import urllib.request

try:
    from pydantic import BaseModel, Field
except ImportError:
    BaseModel = object
    def Field(default=None, **kwargs):
        return default


class Tools:
    class Valves(BaseModel):
        cloudy_local_url: str = Field(
            default="http://127.0.0.1:8765",
            description="Local Cloudy Auto-Sync AI Bridge URL (works 100% offline)",
        )
        cloudy_online_url: str = Field(
            default="${cloudOrigin}",
            description="Online Cloudy Vault URL",
        )
        cloudy_api_key: str = Field(
            default="${sampleKey}",
            description="Pre-configured Cloudy Scoped AI API Key",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _req(self, method: str, path: str, body=None):
        urls = [
            getattr(self.valves, "cloudy_local_url", "http://127.0.0.1:8765"),
            getattr(self.valves, "cloudy_online_url", "${cloudOrigin}"),
        ]
        api_key = getattr(self.valves, "cloudy_api_key", "${sampleKey}")
        for base in urls:
            if not base:
                continue
            try:
                headers = {"Authorization": f"Bearer {api_key}"}
                data = json.dumps(body).encode("utf-8") if body is not None else None
                if data is not None:
                    headers["Content-Type"] = "application/json"
                req = urllib.request.Request(f"{base.rstrip('/')}{path}", data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception:
                continue
        return {"ok": False, "error": "Cloudy offline server and cloud both unreachable."}

    def list_cloudy_folders(self) -> str:
        """List accessible carpetas (folders) in the user's Cloudy storage vault."""
        return json.dumps(self._req("GET", "/api/v1/ai/folders"), indent=2)

    def search_cloudy_files(self, query: str = "") -> str:
        """Search files and notes in Cloudy by keyword (works online and offline)."""
        return json.dumps(self._req("GET", f"/api/v1/ai/search?q={urllib.parse.quote(query)}"), indent=2)

    def read_cloudy_file(self, file_id: str) -> str:
        """Read the full text content of a Cloudy file or note using its file_id (e.g. fil_welcome)."""
        res = self._req("GET", f"/api/v1/ai/files/{urllib.parse.quote(file_id)}/content")
        return res.get("content") or json.dumps(res)

    def save_cloudy_note(self, name: str, content: str, folder_id: str = "") -> str:
        """Save a new Markdown/text note to Cloudy (queues locally offline and auto-syncs when online)."""
        payload = {"name": name, "content": content, "folderId": folder_id or None}
        return json.dumps(self._req("POST", "/api/v1/ai/files", payload), indent=2)
`;
}

export function buildTerminalChatPython(sampleKey) {
  return `#!/usr/bin/env python3
"""
Cloudy by X-Kilo — 1-Click Zero-Config Terminal AI Chat
Automatically detects your installed Ollama / LM Studio / llama.cpp model and chats with your Cloudy files!
"""
import json
import urllib.request

BRIDGE_URL = "http://127.0.0.1:8765"
API_KEY = "${sampleKey}"


def bridge_req(method, path, body=None):
    headers = {"Authorization": f"Bearer {API_KEY}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BRIDGE_URL}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


if __name__ == "__main__":
    info = bridge_req("GET", "/api/v1/ai/local-models")
    models = info.get("models") or []
    if not models:
        print("No local AI model detected yet. Start Ollama (ollama serve) or LM Studio and try again!")
        raise SystemExit(1)

    chosen = models[0]
    print(f"☁️  Connected to {chosen['providerName']} -> {chosen['name']} (Vault Skills Active!)")
    print("Type a question about your Cloudy files (or 'exit' to quit):\\n")
    history = []
    while True:
        try:
            q = input("You > ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q or q.lower() in ("exit", "quit"):
            break
        history.append({"role": "user", "content": q})
        res = bridge_req("POST", "/api/v1/ai/local-chat", {"model": chosen["id"], "provider": chosen["provider"], "messages": history})
        ans = res.get("reply") or res.get("error") or ""
        skills = ", ".join(f"{s['skill']}({s['detail']})" for s in (res.get("usedSkills") or []))
        if skills:
            print(f"  [Skills: {skills}]")
        print(f"AI  > {ans}\\n")
        history.append({"role": "assistant", "content": ans})
`;
}

export function buildOsLaunchers(cloudOrigin, sampleKey) {
  const windowsBat = `@echo off
title Cloudy Plug ^& Play Local AI Bridge
cd /d "%~dp0"
echo Starting Cloudy Plug ^& Play Local AI Bridge + Auto-Sync...
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python cloudy_offline_server.py
) else (
  py -3 cloudy_offline_server.py
)
pause
`;

  const macCommand = `#!/bin/bash
cd "$(dirname "$0")"
echo "☁️  Starting Cloudy Plug & Play Local AI Bridge..."
python3 cloudy_offline_server.py
`;

  const linuxSh = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 cloudy_offline_server.py
`;

  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        "cloudy-vault": {
          command: "python3",
          args: ["./cloudy_mcp_server.py"],
          env: {
            CLOUDY_API_KEY: sampleKey,
            CLOUDY_REMOTE_URL: cloudOrigin,
          },
        },
      },
    },
    null,
    2
  );

  const readmeMd = `# Cloudy Plug & Play Local AI Pack (Zero Code Needed)

Everything in this folder is **pre-configured** with your Cloudy vault and API key!

## Option 1 — Double-Click Plug & Play Bridge (Recommended)
- **Windows:** Double-click \`Start-Cloudy-AI.bat\`
- **macOS:** Double-click \`Start-Cloudy-AI.command\`
- **Linux / Android Termux:** Run \`./start-cloudy-ai.sh\`

Once running:
1. Open Cloudy Web / PWA -> **AI API** tab -> your local **Ollama / LM Studio / llama.cpp / Jan** models appear automatically for 1-click offline & online Vault Chat!
2. Or paste **OpenAI Base URL** \`http://127.0.0.1:8765/v1\` + API Key \`${sampleKey}\` into **Cursor, OpenWebUI, ChatBox, AnythingLLM, or Continue** — every local model automatically gets your Cloudy files & live auto-sync!

## Option 2 — 1-Click OpenWebUI Tool
Import \`cloudy_vault_skill.py\` in **OpenWebUI → Workspace → Tools → Import** (your API key and URLs are already pre-filled).

## Option 3 — MCP (Claude Desktop, Cursor, Cline, Windsurf, LM Studio)
Copy \`mcp_config.json\` (update the path to \`cloudy_mcp_server.py\`) — works online & offline with zero dependencies!
`;

  return { windowsBat, macCommand, linuxSh, mcpJson, readmeMd };
}
