import React, { useEffect, useState } from 'react';
import {
  Smartphone,
  Download,
  CheckCircle2,
  X,
  QrCode,
  Package,
  WifiOff,
  Sparkles,
} from 'lucide-react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface AndroidDownloadModalProps {
  open: boolean;
  onClose: () => void;
  deferredPrompt: BeforeInstallPromptEvent | null;
  onTriggerPwaInstall: () => Promise<void>;
  swReady: boolean;
}

interface AndroidServerInfo {
  appId: string;
  version: string;
  apkAvailable: boolean;
  apkDownloadUrl: string | null;
  projectZipUrl: string;
  qrSvg: string;
  installUrl: string;
}

export const AndroidDownloadModal: React.FC<AndroidDownloadModalProps> = ({
  open,
  onClose,
  deferredPrompt,
  onTriggerPwaInstall,
  swReady,
}) => {
  const [info, setInfo] = useState<AndroidServerInfo | null>(null);
  const [installedMsg, setInstalledMsg] = useState(false);

  useEffect(() => {
    if (!open) return;
    const currentUrl = window.location.origin + '/';
    fetch(`/api/android/info?url=${encodeURIComponent(currentUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setInfo(data);
      })
      .catch(() => {
        // Offline fallback
      });
  }, [open]);

  if (!open) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await onTriggerPwaInstall();
      setInstalledMsg(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#0B1220] border border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-[#0E1A32] to-[#09101F]">
          <div className="flex items-center gap-3.5">
            <img
              src="/cloudy-logo.png"
              alt="Cloudy Android"
              className="w-11 h-11 object-contain"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white">
                  Cloudy for Android
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-bold">
                  v1.0.0 · X-Kilo
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Package ID: <code className="font-mono text-sky-300">com.xkilo.cloudy</code> · Full Offline Vault Support
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Option 1: Instant 1-Tap Offline Android App (PWA / WebAPK) */}
          <div className="rounded-2xl bg-[#060A14] border border-sky-500/30 p-5 flex flex-col sm:flex-row items-center gap-5">
            {info?.qrSvg ? (
              <div className="shrink-0 p-2.5 rounded-2xl bg-[#060A14] border border-slate-800 flex flex-col items-center">
                <div
                  className="w-36 h-36 [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: info.qrSvg }}
                />
                <span className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                  <QrCode className="w-3 h-3 text-sky-400" /> Scan on Android
                </span>
              </div>
            ) : (
              <div className="w-36 h-36 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                <Smartphone className="w-10 h-10 text-sky-400" />
              </div>
            )}

            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 text-[11px] font-bold">
                <Sparkles className="w-3 h-3" /> Instant Install (Recommended)
              </div>
              <h3 className="text-base font-bold text-white">
                1-Tap Install Offline Android App (WebAPK)
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Scan the QR code with your Android camera or tap below in Chrome for Android. Installs Cloudy natively to your Android app drawer with the X-Kilo icon and <strong>100% offline launch + IndexedDB storage</strong>.
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[11px] text-emerald-400">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {swReady ? 'Offline Service Worker Active' : 'App Shell Ready'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="inline-flex items-center gap-1">
                  <WifiOff className="w-3.5 h-3.5" />
                  Works in Airplane Mode
                </span>
              </div>

              {deferredPrompt ? (
                <button
                  onClick={handleInstallClick}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 transition"
                >
                  <Smartphone className="w-4 h-4" />
                  {installedMsg ? 'Installing Cloudy...' : 'Install Cloudy on Android Now'}
                </button>
              ) : (
                <div className="p-3 rounded-xl bg-[#0B1220] border border-slate-800 text-xs text-slate-300">
                  <strong>On Android Chrome:</strong> Tap browser menu{' '}
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono">⋮</span> →{' '}
                  <strong className="text-sky-300">Install app</strong> (or scan QR above from your phone).
                </div>
              )}
            </div>
          </div>

          {/* Option 2: Native Capacitor Android .APK & Source Package */}
          <div className="rounded-2xl bg-[#060A14] border border-slate-800 p-5 space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Native Android .APK Package (Capacitor Gradle Project)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Complete native Android wrapper (<code className="font-mono">android/</code>) pre-configured with Cloudy adaptive launcher icons, offline WebView vault, and automated GitHub Actions APK builder.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {info?.apkAvailable && info.apkDownloadUrl && (
                <a
                  href={info.apkDownloadUrl}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  Download Cloudy-X-Kilo.apk
                </a>
              )}

              <a
                href="/api/android/project.zip"
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs inline-flex items-center gap-2 transition"
              >
                <Download className="w-4 h-4 text-sky-400" />
                Download Native Android APK Project (.zip)
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
