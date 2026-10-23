import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import QRCode from 'qrcode';

const APK_PATH = path.resolve('public/downloads/Cloudy-X-Kilo.apk');

export async function getAndroidInfo(req, res) {
  try {
    const targetUrl = String(req.query.url || `${req.protocol}://${req.get('host')}/`);
    const qrSvg = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 1,
      width: 200,
      color: {
        dark: '#38B6FF',
        light: '#060A14',
      },
    });

    const apkExists = fs.existsSync(APK_PATH);
    const apkSize = apkExists ? fs.statSync(APK_PATH).size : null;
    const androidProjectReady = fs.existsSync(path.resolve('android/app/src/main/AndroidManifest.xml'));

    res.json({
      ok: true,
      appId: 'com.xkilo.cloudy',
      appName: 'Cloudy',
      company: 'X-Kilo',
      version: '1.0.0',
      pwaReady: true,
      apkAvailable: apkExists,
      apkSize,
      apkDownloadUrl: apkExists ? '/api/android/download.apk' : null,
      androidProjectReady,
      projectZipUrl: '/api/android/project.zip',
      qrSvg,
      installUrl: targetUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}

export function downloadApkIfBuilt(req, res) {
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({
      ok: false,
      error: 'Prebuilt .apk binary not found in public/downloads/Cloudy-X-Kilo.apk. Install instantly via 1-Tap Android PWA or build the Capacitor Android project.',
    });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="Cloudy-X-Kilo-v1.0.0.apk"');
  fs.createReadStream(APK_PATH).pipe(res);
}

export function streamAndroidProjectZip(req, res) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Cloudy-X-Kilo-Android-APK-Project.zip"');
  archive.pipe(res);

  const androidDir = path.resolve('android');
  if (fs.existsSync(androidDir)) {
    archive.directory(androidDir, 'android', (entry) => {
      if (entry.name.includes('.gradle/') || entry.name.includes('/build/')) return false;
      return entry;
    });
  }

  const capCfg = path.resolve('capacitor.config.json');
  if (fs.existsSync(capCfg)) {
    archive.file(capCfg, { name: 'capacitor.config.json' });
  }
  const ghWorkflow = path.resolve('docs/github-actions-android-apk.yml');
  if (fs.existsSync(ghWorkflow)) {
    archive.file(ghWorkflow, { name: '.github/workflows/build-android-apk.yml' });
  }

  const readme = `# Cloudy by X-Kilo — Native Android APK Build Guide

Package ID: \`com.xkilo.cloudy\`
App Name: \`Cloudy\`
Company: \`X-Kilo\`

## Option A — Automatic APK via GitHub Actions (No Local Android SDK Needed)
1. Push this repository (including \`.github/workflows/build-android-apk.yml\`) to GitHub.
2. Open the **Actions** tab → **Build Cloudy Android APK** → click **Run workflow**.
3. Download \`Cloudy-X-Kilo-debug.apk\` directly from the workflow artifacts!

## Option B — Build Locally with Android Studio / Gradle
1. Open the \`android/\` folder in **Android Studio** (or ensure JDK 17 + Android SDK 34 are installed).
2. Run:
   \`\`\`bash
   cd android
   ./gradlew assembleDebug
   \`\`\`
3. Your installable APK is output to:
   \`android/app/build/outputs/apk/debug/app-debug.apk\`
`;

  archive.append(readme, { name: 'BUILD-ANDROID-APK.md' });
  archive.finalize();
}
