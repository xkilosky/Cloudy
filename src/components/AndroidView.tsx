import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone,
  Download,
  CheckCircle2,
  QrCode,
  WifiOff,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

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
  const [showMobileQr, setShowMobileQr] = useState(false);

  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches;

  const isOnAndroidPhone =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

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
    <div className="flex-1 px-3.5 sm:px-8 py-5 sm:py-7 min-w-0">
      <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">
              Cloudy for Android
            </h1>
            <p className="text-xs text-ink-muted mt-1 font-mono">
              com.xkilo.cloudy · Offline Vault &amp; Live Auto-Sync
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-line text-ink-secondary">
              <WifiOff className="w-3.5 h-3.5 text-accent" />
              Offline IndexedDB
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-line text-ink-secondary">
              <RefreshCw className="w-3.5 h-3.5 text-[#10A37F]" />
              Live Auto-Sync
            </span>
          </div>
        </div>

        {isStandalone && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-2xl bg-[#10A37F]/12 border border-[#10A37F]/35 flex items-center gap-3 text-xs text-[#6EE7B7]"
          >
            <CheckCircle2 className="w-5 h-5 text-[#10A37F] shrink-0" />
            <div>
              <div className="font-semibold text-ink">
                Cloudy App Installed &amp; Running Natively
              </div>
              <div className="text-ink-secondary mt-0.5">
                Your Offline Vault cache and background auto-sync are active on this device.
              </div>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* Instant WebAPK Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            className="rounded-3xl bg-surface border border-line-strong p-5 sm:p-6 flex flex-col justify-between gap-5 shadow-card"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-accent-soft text-accent">
                  Instant WebAPK
                </span>
                <span className="text-[11px] text-[#10A37F] inline-flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {swReady ? 'Offline Ready' : 'Active'}
                </span>
              </div>

              <div>
                <h2 className="text-base font-semibold text-ink">
                  {isOnAndroidPhone
                    ? 'Install Cloudy on This Phone'
                    : 'Install Directly on Android'}
                </h2>
                <p className="text-xs text-ink-secondary leading-relaxed mt-1">
                  {isOnAndroidPhone
                    ? 'Install Cloudy directly to your Android home screen with full offline carpeta & file access — zero Play Store wait.'
                    : 'Scan the QR code with your Android camera or open Cloudy in Chrome for Android to install natively with full offline storage.'}
                </p>
              </div>

              {/* Desktop QR (always visible on md+, collapsible on mobile so it doesn't clutter a phone screen) */}
              {qrSvg && (
                <>
                  <div className="hidden md:flex p-3.5 rounded-2xl bg-canvas border border-line w-40 h-40 mx-auto items-center justify-center shadow-card">
                    <div
                      className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                  </div>

                  <div className="md:hidden space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowMobileQr((v) => !v)}
                      className="w-full py-2 px-3 rounded-2xl bg-canvas hover:bg-elevated border border-line text-xs font-medium text-ink-secondary hover:text-ink inline-flex items-center justify-center gap-2 transition"
                    >
                      <QrCode className="w-3.5 h-3.5 text-accent" />
                      <span>
                        {showMobileQr
                          ? 'Hide QR Code'
                          : 'Share QR Code to Another Phone'}
                      </span>
                    </button>
                    <AnimatePresence>
                      {showMobileQr && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-3.5 rounded-2xl bg-canvas border border-line w-36 h-36 mx-auto flex items-center justify-center shadow-card">
                            <div
                              className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                              dangerouslySetInnerHTML={{ __html: qrSvg }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>

            {deferredPrompt ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onTriggerPwaInstall}
                className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
              >
                <Smartphone className="w-4 h-4" />
                <span>Install Cloudy App Now</span>
              </motion.button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-canvas border border-line text-xs text-ink-secondary text-center leading-relaxed">
                In Android Chrome: tap <span className="text-ink font-mono font-bold">⋮</span>{' '}
                (top-right) →{' '}
                <span className="text-accent font-semibold">
                  Install app / Add to Home screen
                </span>
              </div>
            )}
          </motion.div>

          {/* Native Android Project / APK Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            whileHover={{ y: -2 }}
            className="rounded-3xl bg-surface border border-line p-5 sm:p-6 flex flex-col justify-between gap-5 shadow-card"
          >
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-elevated text-ink-secondary">
                  Capacitor Native Build
                </span>
                <span className="text-[11px] text-ink-muted inline-flex items-center gap-1 font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#10A37F]" />
                  APK Ready
                </span>
              </div>
              <h2 className="text-base font-semibold text-ink">
                Android Studio / APK Package
              </h2>
              <p className="text-xs text-ink-secondary leading-relaxed">
                Download the complete native Android Gradle project (
                <code className="text-ink font-mono">com.xkilo.cloudy</code>) with X-Kilo adaptive launcher icons and automated GitHub Actions{' '}
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
                  <span>Download Cloudy-X-Kilo.apk</span>
                </a>
              )}
              <motion.a
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                href="/api/android/project.zip"
                className="w-full py-3 rounded-full bg-elevated hover:bg-canvas border border-line-strong text-ink text-xs font-semibold inline-flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4 text-accent" />
                <span>Download Android APK Project (.zip)</span>
              </motion.a>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
