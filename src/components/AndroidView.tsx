import React, { useEffect, useState } from 'react';
import { Smartphone, Download, CheckCircle2 } from 'lucide-react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface AndroidViewProps {
  deferredPrompt: BeforeInstallPromptEvent | null;
  onTriggerPwaInstall: () => Promise<void>;
  swReady: boolean;
}

export const AndroidView: React.FC<AndroidViewProps> = ({
  deferredPrompt,
  onTriggerPwaInstall,
  swReady,
}) => {
  const [qrSvg, setQrSvg] = useState<string>('');
  const [apkUrl, setApkUrl] = useState<string | null>(null);

  useEffect(() => {
    const currentUrl = window.location.origin + '/';
    fetch(`/api/android/info?url=${encodeURIComponent(currentUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setQrSvg(data.qrSvg || '');
          setApkUrl(data.apkDownloadUrl || null);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex-1 px-5 sm:px-8 py-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-bold text-white">Cloudy for Android</h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            com.xkilo.cloudy · Offline Vault Ready
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Instant 1-Tap Android Install */}
          <div className="rounded-2xl bg-[#07090C] border border-[#00F0FF]/30 p-6 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#00F0FF]">
                  Instant WebAPK
                </span>
                <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00F0FF]" />
                  {swReady ? 'Offline Ready' : 'Active'}
                </span>
              </div>

              <h2 className="text-base font-bold text-white">
                Install Directly on Android
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Scan the QR code with your Android camera or open this URL in Chrome for Android to install Cloudy natively with full offline storage.
              </p>

              {qrSvg && (
                <div className="p-3 rounded-2xl bg-black border border-white/[0.08] w-40 h-40 mx-auto flex items-center justify-center">
                  <div
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                </div>
              )}
            </div>

            {deferredPrompt ? (
              <button
                onClick={onTriggerPwaInstall}
                className="w-full py-3 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
              >
                <Smartphone className="w-4 h-4" />
                Install Cloudy App Now
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-black border border-white/[0.07] text-xs text-zinc-400 text-center">
                On Android Chrome: tap <span className="text-white font-mono">⋮</span> →{' '}
                <span className="text-[#00F0FF] font-semibold">Install app</span>
              </div>
            )}
          </div>

          {/* Card 2: Native Android APK / Capacitor Project */}
          <div className="rounded-2xl bg-[#07090C] border border-white/[0.08] p-6 flex flex-col justify-between gap-6">
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Native Build
              </span>
              <h2 className="text-base font-bold text-white">
                Android Studio / APK Package
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Download the complete native Android Gradle project (<code className="text-zinc-200 font-mono">com.xkilo.cloudy</code>) with X-Kilo launcher icons and automated GitHub Actions <code className="text-zinc-200 font-mono">.apk</code> builder.
              </p>
            </div>

            <div className="space-y-2.5">
              {apkUrl && (
                <a
                  href={apkUrl}
                  className="w-full py-3 rounded-xl bg-[#00F0FF] text-black text-xs font-bold inline-flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  Download Cloudy-X-Kilo.apk
                </a>
              )}
              <a
                href="/api/android/project.zip"
                className="w-full py-3 rounded-xl bg-black hover:bg-white/[0.05] border border-white/15 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4 text-[#00F0FF]" />
                Download Android APK Project (.zip)
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
