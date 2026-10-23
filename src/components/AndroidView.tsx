import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
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
    <div className="flex-1 px-4 sm:px-8 py-7">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">
            Cloudy for Android
          </h1>
          <p className="text-xs text-ink-muted mt-1 font-mono">
            com.xkilo.cloudy · Offline Vault Enabled
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Instant WebAPK Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            className="rounded-3xl bg-surface border border-line-strong p-6 flex flex-col justify-between gap-6 shadow-card"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-accent-soft text-accent">
                  Instant WebAPK
                </span>
                <span className="text-[11px] text-[#10A37F] inline-flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {swReady ? 'Offline Ready' : 'Active'}
                </span>
              </div>

              <h2 className="text-base font-semibold text-ink">
                Install Directly on Android
              </h2>
              <p className="text-xs text-ink-secondary leading-relaxed">
                Scan the QR code with your Android camera or open this URL in Chrome for Android to install Cloudy natively with full offline storage.
              </p>

              {qrSvg && (
                <div className="p-3.5 rounded-2xl bg-canvas border border-line w-40 h-40 mx-auto flex items-center justify-center shadow-card">
                  <div
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                </div>
              )}
            </div>

            {deferredPrompt ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onTriggerPwaInstall}
                className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
              >
                <Smartphone className="w-4 h-4" />
                Install Cloudy App Now
              </motion.button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-canvas border border-line text-xs text-ink-secondary text-center">
                On Android Chrome: tap <span className="text-ink font-mono">⋮</span> →{' '}
                <span className="text-accent font-semibold">Install app</span>
              </div>
            )}
          </motion.div>

          {/* Native Android Project / APK Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            whileHover={{ y: -2 }}
            className="rounded-3xl bg-surface border border-line p-6 flex flex-col justify-between gap-6 shadow-card"
          >
            <div className="space-y-3">
              <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-elevated text-ink-secondary">
                Native Build
              </span>
              <h2 className="text-base font-semibold text-ink">
                Android Studio / APK Package
              </h2>
              <p className="text-xs text-ink-secondary leading-relaxed">
                Download the complete native Android Gradle project (
                <code className="text-ink font-mono">com.xkilo.cloudy</code>) with X-Kilo launcher icons and automated GitHub Actions{' '}
                <code className="text-ink font-mono">.apk</code> builder.
              </p>
            </div>

            <div className="space-y-2.5">
              {apkUrl && (
                <a
                  href={apkUrl}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  <Download className="w-4 h-4" />
                  Download Cloudy-X-Kilo.apk
                </a>
              )}
              <motion.a
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                href="/api/android/project.zip"
                className="w-full py-3 rounded-full bg-elevated hover:bg-canvas border border-line-strong text-ink text-xs font-semibold inline-flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4 text-accent" />
                Download Android APK Project (.zip)
              </motion.a>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
