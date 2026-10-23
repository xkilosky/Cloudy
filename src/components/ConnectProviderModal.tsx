import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Zap,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { ProviderCatalogItem, StorageAccount, VaultState } from '../types';
import { apiFetch, getOrCreateVaultId } from '../lib/vaultClient';

interface ConnectProviderModalProps {
  provider: ProviderCatalogItem | null;
  existingAccounts?: StorageAccount[];
  onSyncExistingAccount?: (accountId: string) => Promise<void>;
  onClose: () => void;
  onConnectCredentials: (
    providerId: string,
    credentials: Record<string, string>
  ) => Promise<void>;
  onConnectedRefresh: (label?: string) => Promise<void>;
}

const NEXTCLOUD_PRESETS = [
  { label: 'Tab.Digital (8 GB)', url: 'https://cloud.tab.digital' },
  { label: 'Disroot Cloud', url: 'https://cloud.disroot.org' },
];

export const ConnectProviderModal: React.FC<ConnectProviderModalProps> = ({
  provider,
  existingAccounts = [],
  onSyncExistingAccount,
  onClose,
  onConnectCredentials,
  onConnectedRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [syncingExistingId, setSyncingExistingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  const [deviceFlow, setDeviceFlow] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);

  const [ncServerUrl, setNcServerUrl] = useState('https://cloud.tab.digital');
  const [ncCustom, setNcCustom] = useState(false);
  const [ncFlow, setNcFlow] = useState<{
    loginUrl: string;
    pollEndpoint: string;
    pollToken: string;
  } | null>(null);

  const [oauthWaiting, setOauthWaiting] = useState<string | null>(null);

  const [smartPayload, setSmartPayload] = useState('');

  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');

  const pollTimeoutRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const completedRef = useRef(false);
  const flowStartedAtRef = useRef<number>(0);
  const baselineAccountIdsRef = useRef<Set<string>>(new Set());
  const immediateCheckFnRef = useRef<(() => Promise<void>) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    immediateCheckFnRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const finishSuccess = useCallback(
    async (label?: string) => {
      if (completedRef.current) return;
      completedRef.current = true;
      stopPolling();
      setDeviceFlow(null);
      setNcFlow(null);
      setOauthWaiting(null);
      setCheckingNow(false);
      await onConnectedRefresh(label || provider?.name || 'Cloud Storage');
      onClose();
    },
    [onClose, onConnectedRefresh, provider?.name, stopPolling]
  );

  // Reset modal state cleanly when switching providers or closing
  useEffect(() => {
    stopPolling();
    pollInFlightRef.current = false;
    completedRef.current = false;
    flowStartedAtRef.current = 0;
    setErrorMsg(null);
    setLoading(false);
    setCheckingNow(false);
    setDeviceFlow(null);
    setNcFlow(null);
    setOauthWaiting(null);
    setNcCustom(false);
    setNcServerUrl(provider?.defaultWebdavUrl || 'https://cloud.tab.digital');
    setShowMfa(false);
    setEmail('');
    setPassword('');
    setMfaCode('');
    setSmartPayload('');
    setS3Endpoint(provider?.defaultEndpoint || '');
    setS3Bucket('');
    setS3AccessKey('');
    setS3SecretKey('');
    setSbUrl('');
    setSbKey('');
  }, [provider, stopPolling]);

  // If App.tsx background/tab-return refresh detects the new/re-synced account in vault.accounts,
  // complete & close the modal automatically!
  useEffect(() => {
    if (!provider || completedRef.current || !flowStartedAtRef.current) return;
    if (!deviceFlow && !ncFlow && !oauthWaiting) return;

    const matchedNewOrUpdated = existingAccounts.find((acc) => {
      if (!baselineAccountIdsRef.current.has(acc.id)) return true;
      const syncedMs = acc.lastSyncedAt ? new Date(acc.lastSyncedAt).getTime() : 0;
      return syncedMs >= flowStartedAtRef.current - 1500;
    });

    if (matchedNewOrUpdated) {
      finishSuccess(matchedNewOrUpdated.accountLabel);
    }
  }, [existingAccounts, provider, deviceFlow, ncFlow, oauthWaiting, finishSuccess]);

  // Helper: check /api/vault/state?fresh=1 directly in case a background mobile tab poll already saved the account
  const checkFreshVaultForConnection = useCallback(
    async (targetProviderId: string): Promise<StorageAccount | null> => {
      try {
        const vRes = await apiFetch('/api/vault/state?fresh=1');
        if (!vRes.ok) return null;
        const vData = (await vRes.json()) as VaultState;
        const candidates = (vData.accounts || []).filter(
          (a) => a.providerId === targetProviderId
        );
        return (
          candidates.find((acc) => {
            if (!baselineAccountIdsRef.current.has(acc.id)) return true;
            const syncedMs = acc.lastSyncedAt ? new Date(acc.lastSyncedAt).getTime() : 0;
            return syncedMs >= flowStartedAtRef.current - 1500;
          }) || null
        );
      } catch {
        return null;
      }
    },
    []
  );

  // Instant check when returning from mobile browser tab / popup window (`visibilitychange` & `focus`)
  useEffect(() => {
    const isFlowActive = Boolean(deviceFlow || ncFlow || oauthWaiting);
    if (!isFlowActive || !provider) return;

    const onReturnToApp = () => {
      if (document.visibilityState === 'visible' && immediateCheckFnRef.current) {
        immediateCheckFnRef.current();
      }
    };

    window.addEventListener('focus', onReturnToApp);
    document.addEventListener('visibilitychange', onReturnToApp);
    return () => {
      window.removeEventListener('focus', onReturnToApp);
      document.removeEventListener('visibilitychange', onReturnToApp);
    };
  }, [deviceFlow, ncFlow, oauthWaiting, provider]);

  // Direct OAuth callback listener for popup/new-tab OAuth 2.0 flows (success + error)
  useEffect(() => {
    if (!oauthWaiting || !provider) return;

    const handlePayload = (payload: {
      type?: string;
      account?: { accountLabel?: string; providerId?: string };
      error?: string;
    }) => {
      if (!payload) return;
      if (payload.type === 'CLOUDY_OAUTH_SUCCESS' || payload.account) {
        finishSuccess(payload.account?.accountLabel);
      } else if (payload.type === 'CLOUDY_OAUTH_ERROR' || payload.error) {
        stopPolling();
        setOauthWaiting(null);
        setErrorMsg(payload.error || 'OAuth authorization was cancelled or declined.');
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'object') {
        handlePayload(event.data);
      }
    };
    const onStorageEvent = (event: StorageEvent) => {
      if (event.key === 'cloudy_oauth_event' && event.newValue) {
        try {
          handlePayload(JSON.parse(event.newValue));
        } catch {
          // ignore malformed storage payload
        }
      }
    };

    window.addEventListener('message', onWindowMessage);
    window.addEventListener('storage', onStorageEvent);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('cloudy_oauth_channel');
        bc.onmessage = (ev) => {
          if (ev.data && typeof ev.data === 'object') {
            handlePayload(ev.data);
          }
        };
      }
    } catch {
      // BroadcastChannel unavailable
    }

    return () => {
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('storage', onStorageEvent);
      try {
        bc?.close();
      } catch {
        // ignore
      }
    };
  }, [oauthWaiting, provider, finishSuccess, stopPolling]);

  const handleClose = () => {
    stopPolling();
    onClose();
  };

  const isDeviceFlowProvider =
    provider?.id === 'github_vault' || provider?.id === 'onedrive';

  // --- 1. Device Code Flow (GitHub & Microsoft OneDrive) ---
  const handleStartDeviceSignIn = async () => {
    if (!provider) return;
    stopPolling();
    completedRef.current = false;
    flowStartedAtRef.current = Date.now();
    baselineAccountIdsRef.current = new Set(existingAccounts.map((a) => a.id));
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await apiFetch(`/api/device-auth/${provider.id}/start`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start sign-in');

      const baseIntervalSec = Math.max(5, Number(data.interval || 5));
      setDeviceFlow({
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        interval: baseIntervalSec,
      });

      try {
        await navigator.clipboard.writeText(data.userCode);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 3000);
      } catch {
        // ignore clipboard block
      }

      const width = 520;
      const height = 660;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(
        data.verificationUri,
        `cloudy_device_${provider.id}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      setLoading(false);

      const providerId = provider.id;
      const providerName = provider.name;
      const deviceCode = String(data.deviceCode);

      const executeDevicePoll = async (isManualOrFocus = false) => {
        if (completedRef.current || pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        if (isManualOrFocus) setCheckingNow(true);
        if (pollTimeoutRef.current !== null) {
          window.clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }

        let nextDelayMs = (baseIntervalSec + 1) * 1000;
        try {
          const pRes = await apiFetch(`/api/device-auth/${providerId}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode }),
          });
          const pData = await pRes.json().catch(() => ({}));

          if (pRes.ok && pData.ok && !pData.pending) {
            await finishSuccess(pData.account?.accountLabel || providerName);
            return;
          }

          if (!pRes.ok || pData.ok === false) {
            // Double-check fresh vault first in case a background mobile tab request already succeeded!
            const recovered = await checkFreshVaultForConnection(providerId);
            if (recovered) {
              await finishSuccess(recovered.accountLabel);
              return;
            }
            stopPolling();
            setDeviceFlow(null);
            setErrorMsg(
              pData.error || 'Authorization session expired or was declined. Please try again.'
            );
            return;
          }

          // Still pending — also check fresh vault on focus/manual tap
          if (isManualOrFocus) {
            const recovered = await checkFreshVaultForConnection(providerId);
            if (recovered) {
              await finishSuccess(recovered.accountLabel);
              return;
            }
          }

          if (typeof pData.retryAfterMs === 'number' && pData.retryAfterMs > 0) {
            nextDelayMs = Math.max(1500, pData.retryAfterMs);
          } else if (typeof pData.interval === 'number' && pData.interval > 0) {
            nextDelayMs = (pData.interval + 1) * 1000;
          }
        } catch {
          // Network hiccup while mobile tab was backgrounded — check fresh vault on resume
          const recovered = await checkFreshVaultForConnection(providerId);
          if (recovered) {
            await finishSuccess(recovered.accountLabel);
            return;
          }
          nextDelayMs = 4000;
        } finally {
          pollInFlightRef.current = false;
          setCheckingNow(false);
        }

        if (!completedRef.current) {
          pollTimeoutRef.current = window.setTimeout(
            () => executeDevicePoll(false),
            nextDelayMs
          );
        }
      };

      immediateCheckFnRef.current = () => executeDevicePoll(true);
      pollTimeoutRef.current = window.setTimeout(
        () => executeDevicePoll(false),
        (baseIntervalSec + 1) * 1000
      );
    } catch (err: unknown) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // --- 2. Nextcloud 1-Click Login Flow v2 ---
  const handleStartNextcloudFlow = async () => {
    if (!provider) return;
    stopPolling();
    completedRef.current = false;
    flowStartedAtRef.current = Date.now();
    baselineAccountIdsRef.current = new Set(existingAccounts.map((a) => a.id));
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/nextcloud/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: ncServerUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Nextcloud sign-in');

      const width = 520;
      const height = 660;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(
        data.loginUrl,
        'cloudy_nextcloud_login',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      setNcFlow({
        loginUrl: data.loginUrl,
        pollEndpoint: data.pollEndpoint,
        pollToken: data.pollToken,
      });
      setLoading(false);

      const pollEndpoint = String(data.pollEndpoint);
      const pollToken = String(data.pollToken);

      const executeNcPoll = async (isManualOrFocus = false) => {
        if (completedRef.current || pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        if (isManualOrFocus) setCheckingNow(true);
        if (pollTimeoutRef.current !== null) {
          window.clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }

        try {
          const pRes = await apiFetch('/api/nextcloud/login-poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pollEndpoint, pollToken }),
          });
          const pData = await pRes.json().catch(() => ({}));

          if (pRes.ok && pData.ok && !pData.pending) {
            await finishSuccess(pData.account?.accountLabel || 'Nextcloud');
            return;
          }

          if (!pRes.ok || pData.ok === false) {
            const recovered = await checkFreshVaultForConnection('nextcloud');
            if (recovered) {
              await finishSuccess(recovered.accountLabel);
              return;
            }
            stopPolling();
            setNcFlow(null);
            setErrorMsg(pData.error || 'Nextcloud authorization failed. Please try again.');
            return;
          }

          if (isManualOrFocus) {
            const recovered = await checkFreshVaultForConnection('nextcloud');
            if (recovered) {
              await finishSuccess(recovered.accountLabel);
              return;
            }
          }
        } catch {
          const recovered = await checkFreshVaultForConnection('nextcloud');
          if (recovered) {
            await finishSuccess(recovered.accountLabel);
            return;
          }
        } finally {
          pollInFlightRef.current = false;
          setCheckingNow(false);
        }

        if (!completedRef.current) {
          pollTimeoutRef.current = window.setTimeout(() => executeNcPoll(false), 2600);
        }
      };

      immediateCheckFnRef.current = () => executeNcPoll(true);
      pollTimeoutRef.current = window.setTimeout(() => executeNcPoll(false), 2600);
    } catch (err: unknown) {
      setLoading(false);
      setNcFlow(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // --- 3. Saved OAuth 2.0 Redirect Popup (Google Drive, Dropbox, Box, etc.) ---
  const launchSavedOAuthPopup = () => {
    if (!provider) return;
    stopPolling();
    completedRef.current = false;
    flowStartedAtRef.current = Date.now();
    baselineAccountIdsRef.current = new Set(existingAccounts.map((a) => a.id));
    setErrorMsg(null);

    const qs = new URLSearchParams({ vaultId: getOrCreateVaultId() });
    const authorizeHref = `/api/oauth/${provider.id}/authorize?${qs.toString()}`;
    const width = 520;
    const height = 660;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      authorizeHref,
      `cloudy_oauth_${provider.id}`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    setOauthWaiting(authorizeHref);
    const providerId = provider.id;

    const executeOAuthCheck = async (isManualOrFocus = false) => {
      if (completedRef.current || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (isManualOrFocus) setCheckingNow(true);
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      try {
        const connected = await checkFreshVaultForConnection(providerId);
        if (connected) {
          await finishSuccess(connected.accountLabel);
          return;
        }
      } finally {
        pollInFlightRef.current = false;
        setCheckingNow(false);
      }
      if (!completedRef.current) {
        pollTimeoutRef.current = window.setTimeout(() => executeOAuthCheck(false), 2500);
      }
    };

    immediateCheckFnRef.current = () => executeOAuthCheck(true);
    pollTimeoutRef.current = window.setTimeout(() => executeOAuthCheck(false), 2500);
  };

  const handleManualCheckNow = async () => {
    if (immediateCheckFnRef.current) {
      await immediateCheckFnRef.current();
    } else if (provider) {
      setCheckingNow(true);
      const found = await checkFreshVaultForConnection(provider.id);
      setCheckingNow(false);
      if (found) {
        await finishSuccess(found.accountLabel);
      }
    }
  };

  const handleSyncExistingAndClose = async (acc: StorageAccount) => {
    if (!onSyncExistingAccount) {
      onClose();
      return;
    }
    setSyncingExistingId(acc.id);
    try {
      await onSyncExistingAccount(acc.id);
      onClose();
    } finally {
      setSyncingExistingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      let creds: Record<string, string> = {};
      if (provider.authMode === 'mega' || provider.authMode === 'pcloud') {
        creds = { email: email.trim(), password, mfaCode: mfaCode.trim() };
      } else if (provider.authMode === 'webdav') {
        creds = {
          webdavUrl: (provider.defaultWebdavUrl || '').trim(),
          username: email.trim(),
          password,
        };
      } else if (provider.authMode === 's3') {
        creds = {
          endpoint: (s3Endpoint || provider.defaultEndpoint || '').trim(),
          bucket: s3Bucket.trim(),
          accessKeyId: s3AccessKey.trim(),
          secretAccessKey: s3SecretKey.trim(),
        };
      } else if (provider.authMode === 'supabase') {
        creds = {
          projectUrl: sbUrl.trim(),
          apiKey: sbKey.trim(),
          bucket: 'cloudy-vault',
        };
      } else {
        creds = { smartPayload: smartPayload.trim() };
      }

      await onConnectCredentials(provider.id, creds);
      onClose();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      if (m.toLowerCase().includes('2fa') || m.toLowerCase().includes('mfa')) {
        setShowMfa(true);
      }
      setErrorMsg(m);
    } finally {
      setLoading(false);
    }
  };

  const openGooglePlaygroundPopup = () => {
    const u =
      'https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET';
    const width = 620;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(u, 'cloudy_gplayground', `width=${width},height=${height},left=${left},top=${top}`);
  };

  const inputCls =
    'w-full px-4 py-2.5 rounded-2xl bg-canvas border border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-xs text-ink placeholder:text-ink-muted transition-all';

  return (
    <AnimatePresence>
      {provider && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-surface border border-line-strong p-6 space-y-5 shadow-float max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium text-accent inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-soft">
                  <Zap className="w-3 h-3" /> {provider.freeLabel}
                </div>
                <h3 className="text-base font-semibold text-ink mt-2">
                  {existingAccounts.length > 0
                    ? `${provider.name} Connected`
                    : `Connect ${provider.name}`}
                </h3>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-full text-ink-muted hover:text-ink hover:bg-elevated transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Already Connected Banner */}
            {existingAccounts.length > 0 && !deviceFlow && !ncFlow && !oauthWaiting && (
              <div className="p-3.5 rounded-2xl bg-[#10A37F]/10 border border-[#10A37F]/35 space-y-2.5">
                <div className="text-xs font-semibold text-[#6EE7B7] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#10A37F] shrink-0" />
                  <span>Already active in your Cloud Pool</span>
                </div>
                <div className="space-y-1.5">
                  {existingAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl bg-canvas/80 border border-line text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-ink truncate">
                          {acc.accountLabel}
                        </div>
                        <div className="text-ink-muted truncate">{acc.email}</div>
                      </div>
                      <button
                        type="button"
                        disabled={syncingExistingId === acc.id}
                        onClick={() => handleSyncExistingAndClose(acc)}
                        className="shrink-0 px-2.5 py-1 rounded-lg bg-[#10A37F] hover:bg-[#0E906F] text-white font-semibold inline-flex items-center gap-1 transition"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${
                            syncingExistingId === acc.id ? 'animate-spin' : ''
                          }`}
                        />
                        <span>Sync</span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-ink-secondary">
                  Or sign in below to stack an additional {provider.name} account:
                </div>
              </div>
            )}

            {errorMsg && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="break-words">{errorMsg}</span>
              </motion.div>
            )}

            {/* 1. One-Click Device Flow (GitHub & Microsoft OneDrive) */}
            {isDeviceFlowProvider && (
              <div className="space-y-4">
                {!deviceFlow ? (
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={loading}
                    onClick={handleStartDeviceSignIn}
                    className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Sign in with {provider.name}
                  </motion.button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-2xl bg-canvas border border-line-strong text-center space-y-3"
                  >
                    <div className="text-[11px] text-ink-secondary">
                      Enter code in sign-in tab (already copied):
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-2xl font-mono font-bold tracking-widest text-accent">
                        {deviceFlow.userCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(deviceFlow.userCode);
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }}
                        className="p-1.5 rounded-xl bg-surface text-ink-secondary hover:text-ink"
                      >
                        {copiedCode ? (
                          <Check className="w-4 h-4 text-[#10A37F]" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-ink-secondary pt-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      <span>
                        {checkingNow
                          ? 'Verifying authorization...'
                          : 'Auto-detecting approval...'}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={checkingNow}
                      onClick={handleManualCheckNow}
                      className="w-full py-2.5 px-4 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-card transition"
                    >
                      {checkingNow ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>I&apos;ve Authorized It — Connect Now</span>
                    </button>

                    <a
                      href={deviceFlow.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                    >
                      Re-open login window <ExternalLink className="w-3 h-3" />
                    </a>
                  </motion.div>
                )}
              </div>
            )}

            {/* 2. Two-Field Email + Password (MEGA, pCloud, Koofr, Yandex) */}
            {(provider.authMode === 'mega' ||
              provider.authMode === 'pcloud' ||
              provider.authMode === 'webdav') && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    provider.authMode === 'webdav' ? 'App Password' : 'Password'
                  }
                  className={inputCls}
                />

                {showMfa && (
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="2FA Code"
                    className={`${inputCls} font-mono`}
                  />
                )}

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Signing in...' : `Sign In · ${provider.freeLabel}`}
                </motion.button>

                {provider.authMode === 'webdav' && provider.consoleUrl && (
                  <a
                    href={provider.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center text-[11px] text-ink-muted hover:text-accent transition"
                  >
                    Get {provider.name} App Password →
                  </a>
                )}
              </form>
            )}

            {/* 3. Nextcloud 1-Click Browser Login */}
            {provider.authMode === 'nextcloud' && (
              <div className="space-y-3.5">
                {!ncFlow ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {NEXTCLOUD_PRESETS.map((p) => {
                        const active = !ncCustom && ncServerUrl === p.url;
                        return (
                          <button
                            key={p.url}
                            type="button"
                            onClick={() => {
                              setNcCustom(false);
                              setNcServerUrl(p.url);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              active
                                ? 'bg-accent-soft border-accent/50 text-accent'
                                : 'bg-canvas border-line text-ink-secondary hover:text-ink'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setNcCustom(true)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          ncCustom
                            ? 'bg-accent-soft border-accent/50 text-accent'
                            : 'bg-canvas border-line text-ink-secondary hover:text-ink'
                        }`}
                      >
                        Custom
                      </button>
                    </div>

                    {ncCustom && (
                      <input
                        type="text"
                        value={ncServerUrl}
                        onChange={(e) => setNcServerUrl(e.target.value)}
                        placeholder="https://your-nextcloud-server.com"
                        className={`${inputCls} font-mono`}
                      />
                    )}

                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      disabled={loading}
                      onClick={handleStartNextcloudFlow}
                      className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                    >
                      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                      1-Click Sign In
                    </motion.button>
                  </>
                ) : (
                  <div className="p-4 rounded-2xl bg-canvas border border-line-strong text-center space-y-3">
                    <div className="flex items-center justify-center gap-2 text-xs text-ink-secondary">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      <span>Click &quot;Grant Access&quot; in the Nextcloud tab...</span>
                    </div>
                    <button
                      type="button"
                      disabled={checkingNow}
                      onClick={handleManualCheckNow}
                      className="w-full py-2.5 px-4 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-card transition"
                    >
                      {checkingNow ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>I&apos;ve Granted Access — Connect Now</span>
                    </button>
                    <a
                      href={ncFlow.loginUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                    >
                      Re-open Nextcloud window <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* 4. Google Drive / Dropbox / Box */}
            {provider.authMode === 'oauth2' && !isDeviceFlowProvider && (
              <div className="space-y-3">
                {oauthWaiting ? (
                  <div className="p-4 rounded-2xl bg-canvas border border-line-strong text-center space-y-3">
                    <div className="flex items-center justify-center gap-2 text-xs text-ink-secondary">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      <span>Waiting for {provider.name} authorization...</span>
                    </div>
                    <button
                      type="button"
                      disabled={checkingNow}
                      onClick={handleManualCheckNow}
                      className="w-full py-2.5 px-4 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-card transition"
                    >
                      {checkingNow ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>I&apos;ve Authorized It — Connect Now</span>
                    </button>
                    <a
                      href={oauthWaiting}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                    >
                      Re-open authorization window <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    {provider.oauthConfigured && (
                      <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={launchSavedOAuthPopup}
                        className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold shadow-glow transition"
                      >
                        1-Click Sign in with {provider.name}
                      </motion.button>
                    )}

                    {provider.id === 'google_drive' ? (
                      <button
                        type="button"
                        onClick={openGooglePlaygroundPopup}
                        className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-between transition"
                      >
                        <span>1. Authorize Google Account</span>
                        <ExternalLink className="w-3.5 h-3.5 text-accent" />
                      </button>
                    ) : (
                      provider.consoleUrl && (
                        <a
                          href={provider.consoleUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-elevated border border-line-strong text-ink text-xs font-medium inline-flex items-center justify-between transition"
                        >
                          <span>1. Generate {provider.name} Token</span>
                          <ExternalLink className="w-3.5 h-3.5 text-accent" />
                        </a>
                      )
                    )}

                    <input
                      type="password"
                      required
                      value={smartPayload}
                      onChange={(e) => setSmartPayload(e.target.value)}
                      placeholder="2. Paste Token Here"
                      className={`${inputCls} font-mono`}
                    />

                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                    >
                      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {loading ? 'Connecting...' : 'Connect'}
                    </motion.button>
                  </form>
                )}
              </div>
            )}

            {/* 5. S3 Buckets */}
            {provider.authMode === 's3' && (
              <form onSubmit={handleSubmit} className="space-y-2.5">
                {!provider.defaultEndpoint && (
                  <input
                    type="url"
                    required
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder="S3 Endpoint URL"
                    className={`${inputCls} font-mono`}
                  />
                )}
                <input
                  type="text"
                  required
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  placeholder="Bucket Name"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="text"
                  required
                  value={s3AccessKey}
                  onChange={(e) => setS3AccessKey(e.target.value)}
                  placeholder="Access Key ID"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="password"
                  required
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                  placeholder="Secret Key"
                  className={`${inputCls} font-mono`}
                />
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Connecting...' : 'Connect Bucket'}
                </motion.button>
              </form>
            )}

            {/* 6. Supabase */}
            {provider.authMode === 'supabase' && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="url"
                  required
                  value={sbUrl}
                  onChange={(e) => setSbUrl(e.target.value)}
                  placeholder="https://project.supabase.co"
                  className={`${inputCls} font-mono`}
                />
                <input
                  type="password"
                  required
                  value={sbKey}
                  onChange={(e) => setSbKey(e.target.value)}
                  placeholder="Service Role Key"
                  className={`${inputCls} font-mono`}
                />
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-accent-fg text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-glow transition"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Connect
                </motion.button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
