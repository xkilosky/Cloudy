import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Database,
  ShieldCheck,
  Wifi,
  Sparkles,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { AuthUser } from '../types';
import { apiFetch, setAuthSession } from '../lib/vaultClient';
import { ensureOfflineVaultMatchesId } from '../lib/offlineDb';
import { STUDIO_THEMES, type StudioTheme } from '../lib/theme';

interface AuthViewProps {
  theme: StudioTheme;
  onChangeTheme: (theme: StudioTheme) => void;
  onAuthenticated: (user: AuthUser, token: string, mode: 'login' | 'signup') => void;
  onContinueAsGuest: () => void;
  hasExistingBrowserVault?: boolean;
}

export const AuthView: React.FC<AuthViewProps> = ({
  theme,
  onChangeTheme,
  onAuthenticated,
  onContinueAsGuest,
  hasExistingBrowserVault = false,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '' };
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password) || /[^a-zA-Z0-9]/.test(password)) score += 1;
    const labels = ['', 'Basic', 'Fair', 'Good', 'Strong'];
    return { score, label: labels[score] || 'Strong' };
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const payload =
        mode === 'signup'
          ? {
              email: cleanEmail,
              password,
              displayName: displayName.trim() || undefined,
              theme,
            }
          : {
              email: cleanEmail,
              password,
            };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.user || !data?.token) {
        throw new Error(data?.error || 'Authentication failed. Please try again.');
      }

      const authUser = data.user as AuthUser;
      await ensureOfflineVaultMatchesId(authUser.vaultId);
      setAuthSession(String(data.token), authUser);
      onAuthenticated(authUser, String(data.token), mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-between relative overflow-hidden px-4 py-6 sm:py-10">
      {/* Subtle Studio Ambient Glow */}
      <div
        className="pointer-events-none absolute -top-36 left-1/2 -translate-x-1/2 w-[640px] h-[360px] rounded-full blur-3xl opacity-20 transition-colors duration-500"
        style={{ background: 'var(--bg-accent)' }}
      />

      {/* Top Bar: Brand + Studio Palette Dots */}
      <div className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface border border-line-strong flex items-center justify-center shadow-card">
            <img
              src="/cloudy-logo.png"
              alt="Cloudy"
              className="w-6 h-6 object-contain"
            />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-ink leading-tight">
              Cloudy
            </div>
            <div className="text-[11px] text-ink-muted">X-Kilo · Storage OS</div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-surface/90 border border-line rounded-full px-3 py-1.5 shadow-card">
          <span className="text-[11px] text-ink-muted hidden sm:inline mr-1">
            Studio Theme
          </span>
          {STUDIO_THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChangeTheme(t.id)}
                title={`${t.label} palette`}
                className={`relative w-5 h-5 rounded-full flex items-center justify-center transition-transform ${
                  active ? 'scale-110' : 'opacity-65 hover:opacity-100'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: t.swatch }}
                />
                {active && (
                  <motion.span
                    layoutId="authThemeRing"
                    transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                    className="absolute inset-0 rounded-full border-2"
                    style={{ borderColor: t.swatch }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Centered Studio Auth Card */}
      <div className="relative z-10 w-full max-w-[440px] mx-auto my-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-3xl bg-surface/95 backdrop-blur-xl border border-line-strong shadow-float p-6 sm:p-8"
        >
          {/* Logo & Headline */}
          <div className="text-center mb-6">
            <motion.div
              whileHover={{ scale: 1.05, rotate: -2 }}
              className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-elevated border border-line-strong flex items-center justify-center shadow-card"
            >
              <img
                src="/cloudy-logo.png"
                alt="Cloudy by X-Kilo"
                className="w-9 h-9 object-contain"
              />
            </motion.div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {mode === 'login' ? 'Welcome back to Cloudy' : 'Create your Cloudy account'}
            </h1>
            <p className="text-[13px] text-ink-secondary mt-1.5">
              Free Storage. One System. Your Rules.
            </p>
          </div>

          {/* Segmented Mode Switcher */}
          <div className="grid grid-cols-2 p-1 rounded-2xl bg-canvas border border-line mb-6">
            {(['login', 'signup'] as const).map((tab) => {
              const active = mode === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setMode(tab);
                    setError(null);
                  }}
                  className={`relative py-2 text-[13px] font-medium rounded-xl transition-colors ${
                    active ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="authModePill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-surface border border-line-strong shadow-card"
                    />
                  )}
                  <span className="relative z-10">
                    {tab === 'login' ? 'Sign In' : 'Create Account'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Existing Workspace Claim Banner */}
          <AnimatePresence>
            {mode === 'signup' && hasExistingBrowserVault && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mb-4"
              >
                <div className="p-3 rounded-2xl bg-[#10A37F]/10 border border-[#10A37F]/30 text-[12px] text-[#6EE7B7] flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-[#10A37F]" />
                  <span>
                    Existing workspace detected on this browser — your connected cloud
                    accounts, carpetas, and files will automatically link to your account.
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-4 p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-[12.5px] text-red-300 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence initial={false}>
              {mode === 'signup' && (
                <motion.div
                  key="displayNameField"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                    Display Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex · X-Kilo"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-canvas border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-[13.5px] text-ink placeholder:text-ink-muted transition-all"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-[12px] font-medium text-ink-secondary mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-canvas border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-[13.5px] text-ink placeholder:text-ink-muted transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[12px] font-medium text-ink-secondary">
                  Password
                </label>
                {mode === 'signup' && password.length > 0 && (
                  <span className="text-[11px] font-mono text-ink-muted">
                    {passwordStrength.label}
                  </span>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-canvas border border-line focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none text-[13.5px] text-ink placeholder:text-ink-muted transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {mode === 'signup' && password.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`h-1 rounded-full transition-colors ${
                        passwordStrength.score >= step
                          ? passwordStrength.score >= 3
                            ? 'bg-[#10A37F]'
                            : 'bg-accent'
                          : 'bg-line'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-medium text-[13.5px] flex items-center justify-center gap-2 shadow-card transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {mode === 'signup' ? 'Creating Account...' : 'Signing In...'}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    {mode === 'signup'
                      ? 'Create Cloudy Account'
                      : 'Sign In to Cloudy'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Guest / Offline Option */}
          <div className="mt-5 pt-4 border-t border-line text-center">
            <button
              type="button"
              onClick={onContinueAsGuest}
              className="text-[12px] text-ink-muted hover:text-ink transition-colors"
            >
              Continue with local device-only guest vault →
            </button>
          </div>
        </motion.div>

        {/* Architecture Capability Pills */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface/70 border border-line">
            <Database className="w-3.5 h-3.5 text-accent" />
            PostgreSQL Cloud DB
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface/70 border border-line">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10A37F]" />
            AES-256 Sealed Storage
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface/70 border border-line">
            <Wifi className="w-3.5 h-3.5 text-accent" />
            Offline + Live Auto-Sync
          </span>
        </div>
      </div>

      <div className="relative z-10 text-center text-[11px] text-ink-muted">
        Cloudy by X-Kilo · Zero Fake Accounts · Verified Cloud Storage Pool
      </div>
    </div>
  );
};
