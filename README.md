# ☁️ Cloudy — by X-Kilo

> **Free Storage. One System. Your Rules.**

**Cloudy** is X-Kilo's multi-provider cloud storage aggregator, offline file & folder (*carpetas*) vault, and local AI REST API bridge — installable on Android as both an instant Offline PWA (WebAPK) and a native Capacitor `.apk`.

---

## ✨ Core Features

1. **Obtain & Stack Free Storage from 15 Providers (One-Time OAuth)**
   - Pool up to **133 GB+ on first account per provider** (and unlimited GB when connecting multiple free accounts) across **MEGA (20 GB)**, **Google Drive (15 GB)**, **Box (10 GB)**, **pCloud (10 GB)**, **Cloudflare R2 (10 GB)**, **Backblaze B2 (10 GB)**, **Koofr (10 GB)**, **MediaFire (10 GB)**, **Filen (10 GB)**, **OneDrive (5 GB)**, **Proton Drive (5 GB)**, **Yandex Disk (5 GB)**, **GitHub Cloud Vault (5 GB)**, **Dropbox (2 GB)**, **Supabase Storage (1 GB)**, plus the built-in **X-Kilo Cloudy Core Vault (5 GB)**.
   - **One-Time OAuth 2.0**: Connect once with persistent `offline_access` refresh tokens — Cloudy auto-refreshes tokens silently in the background.
   - **Your Rules**: Choose between *Most Free Space First*, *Waterfall Spillover (95%)*, *Smart File-Type Routing*, or *2x Redundant Cloud Mirror*.

2. **Online ↔ Offline Sync for Files, Carpetas (Folders) & Notes**
   - Upload any files, create nested *carpetas*, or author Markdown/Text/JSON AI datasets online.
   - Automatically caches metadata and binary blobs into your local **IndexedDB Offline Vault** (`cloudy_offline_vault`) + Service Worker precache so you can open, preview, edit, and download everything offline.
   - Any items created or edited while offline queue automatically and sync back to your cloud pool once reconnected.

3. **Scoped REST API Keys for Local Offline AI Models**
   - Generate `cldy_sk_...` keys with `read` or `read_write` scopes and optional per-carpeta restrictions.
   - Clean REST endpoints for **Ollama**, **llama.cpp**, **LM Studio**, and Python scripts:
     - `GET /api/v1/ai/status`
     - `GET /api/v1/ai/folders`
     - `GET /api/v1/ai/files`
     - `GET /api/v1/ai/search?q=<query>`
     - `GET /api/v1/ai/files/:id/content`
     - `POST /api/v1/ai/files`
   - Includes a 1-click **Standalone Offline AI Vault (`.zip`)** containing your synced files + a zero-dependency Python 3 offline server (`cloudy_offline_server.py` on `127.0.0.1:8765`).

4. **Android Downloadable (Instant Offline PWA + Native `.APK`)**
   - **Instant WebAPK**: Scan the in-app QR code or tap **Install on Android** in Chrome for 1-tap offline home-screen installation.
   - **Native Android `.APK` (`com.xkilo.cloudy`)**: Pre-configured Capacitor Android Gradle project (`android/`) with custom Cloudy adaptive launcher icons and an automated GitHub Actions `.apk` workflow (`.github/workflows/build-android-apk.yml`).

---

## 🚀 Quick Start

```bash
npm install
npm run build
npm start
```

Server listens on `http://0.0.0.0:3000`.
