import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { APP_NAME, APP_NAME_UPPER, APP_VERSION } from "../lib/app-config";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  LockKey,
  Eye,
  EyeSlash,
  Warning,
  CheckCircle,
  Timer,
  ShieldCheck,
  ArrowRight,
  Info,
  UploadSimple,
} from "@phosphor-icons/react";

const sessionOptions = [
  {
    id: "remember-session",
    labelKey: "unlock.session.remember.label",
    descriptionKey: "unlock.session.remember.desc",
  },
  {
    id: "auto-lock",
    labelKey: "unlock.session.autoLock.label",
    descriptionKey: "unlock.session.autoLock.desc",
    recommended: true,
  },
] satisfies Array<{
  id: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  recommended?: boolean;
}>;

type UnlockStatus = "idle" | "loading" | "success" | "error";
type UnlockMode = "setup" | "unlock";

interface UnlockVaultProps {
  mode: UnlockMode;
  onSubmit: (password: string) => Promise<{ ok: boolean; message?: string }>;
  onRestoreBackup?: (file: File) => Promise<{ ok: boolean; message?: string }>;
  onRequestAccountRecoveryEmail?: (email: string) => Promise<{ ok: boolean; message?: string }>;
  onResetAccountWithRecoveryKey?: (input: {
    email: string;
    emailResetToken: string;
    recoveryKey: string;
    newPassword: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onRestoreFromAccount?: (input: {
    email: string;
    accountPassword: string;
    localPassword: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onSwitchToPin?: () => void;
}

function getSecurityNotes(mode: UnlockMode, t: (key: TranslationKey) => string) {
  return [
    {
      icon: ShieldCheck,
      text: mode === "setup"
        ? t("unlock.security.note.setupKey")
        : t("unlock.security.note.unlockKey"),
    },
    {
      icon: Timer,
      text: t("unlock.security.note.autoLock"),
    },
    {
      icon: Info,
      text: t("unlock.security.note.backup"),
    },
  ];
}

export default function UnlockVault({
  mode,
  onSubmit,
  onRestoreBackup,
  onRequestAccountRecoveryEmail,
  onResetAccountWithRecoveryKey,
  onRestoreFromAccount,
  onSwitchToPin,
}: UnlockVaultProps) {
  const { t } = useI18n();
  const isSetup = mode === "setup";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<UnlockStatus>("idle");
  const [attemptCount, setAttemptCount] = useState(0);
  const [selectedSession, setSelectedSession] = useState("auto-lock");
  const [statusMessage, setStatusMessage] = useState("");
  const [restoreStatus, setRestoreStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [recoveryResetEmail, setRecoveryResetEmail] = useState("");
  const [recoveryResetEmailToken, setRecoveryResetEmailToken] = useState("");
  const [recoveryResetKey, setRecoveryResetKey] = useState("");
  const [recoveryResetPassword, setRecoveryResetPassword] = useState("");
  const [recoveryResetConfirmPassword, setRecoveryResetConfirmPassword] = useState("");
  const [recoveryResetStatus, setRecoveryResetStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [recoveryResetMessage, setRecoveryResetMessage] = useState("");
  const [accountRestoreEmail, setAccountRestoreEmail] = useState("");
  const [accountRestorePassword, setAccountRestorePassword] = useState("");
  const [accountRestoreLocalPassword, setAccountRestoreLocalPassword] = useState("");
  const [accountRestoreConfirmPassword, setAccountRestoreConfirmPassword] = useState("");
  const [accountRestoreStatus, setAccountRestoreStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [accountRestoreMessage, setAccountRestoreMessage] = useState("");
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
    setStatus("idle");
    setStatusMessage("");
    setRestoreStatus("idle");
    setRestoreMessage("");
    setRecoveryResetEmail("");
    setRecoveryResetEmailToken("");
    setRecoveryResetKey("");
    setRecoveryResetPassword("");
    setRecoveryResetConfirmPassword("");
    setRecoveryResetStatus("idle");
    setRecoveryResetMessage("");
    setAccountRestoreEmail("");
    setAccountRestorePassword("");
    setAccountRestoreLocalPassword("");
    setAccountRestoreConfirmPassword("");
    setAccountRestoreStatus("idle");
    setAccountRestoreMessage("");
    setAttemptCount(0);
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("recovery_reset_token") ?? params.get("recoveryResetToken");
    if (token && /^[A-Za-z0-9._-]{24,256}$/.test(token)) {
      setRecoveryResetEmailToken(token);
      setRecoveryResetStatus("idle");
      setRecoveryResetMessage(t("unlock.status.recoveryLinkDetected"));
    }
  }, [t]);

  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  }, []);

  const clearErrorState = () => {
    if (status === "error") {
      setStatus("idle");
      setStatusMessage("");
    }
  };

  const clearAccountRestoreState = () => {
    if (accountRestoreStatus === "error" || accountRestoreStatus === "success") {
      setAccountRestoreStatus("idle");
      setAccountRestoreMessage("");
    }
  };

  const clearRecoveryResetState = () => {
    if (recoveryResetStatus === "error" || recoveryResetStatus === "success") {
      setRecoveryResetStatus("idle");
      setRecoveryResetMessage("");
    }
  };

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!password.trim()) {
      setStatus("error");
      setStatusMessage(isSetup ? t("unlock.status.empty.setup") : t("unlock.status.empty.unlock"));
      triggerShake();
      return;
    }

    if (isSetup && password !== confirmPassword) {
      setStatus("error");
      setStatusMessage(t("unlock.status.mismatch"));
      triggerShake();
      return;
    }

    setStatus("loading");
    setStatusMessage(isSetup ? t("unlock.status.loading.setup") : t("unlock.status.loading.unlock"));

    try {
      const result = await onSubmit(password.trim());
      if (result.ok) {
        setStatus("success");
        setStatusMessage(isSetup ? t("unlock.status.success.setup") : t("unlock.status.success.unlock"));
        return;
      }

      const nextAttemptCount = attemptCount + 1;
      setAttemptCount(nextAttemptCount);
      setStatus("error");
      setStatusMessage(result.message ?? t("unlock.status.genericUnlock"));
      triggerShake();
      if (!isSetup) {
        setPassword("");
      } else {
        setConfirmPassword("");
      }
    } catch {
      setStatus("error");
      setStatusMessage(isSetup ? t("unlock.status.initFail") : t("unlock.status.decryptFail"));
      triggerShake();
    }
  };

  const handleRestoreBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onRestoreBackup) return;

    setRestoreStatus("loading");
    setRestoreMessage(t("unlock.restore.loading"));

    try {
      const result = await onRestoreBackup(file);
      if (result.ok) {
        setRestoreStatus("success");
        setRestoreMessage(result.message ?? t("unlock.restore.success"));
        setPassword("");
        setConfirmPassword("");
        return;
      }

      setRestoreStatus("error");
      setRestoreMessage(result.message ?? t("unlock.restore.invalid"));
      triggerShake();
    } catch {
      setRestoreStatus("error");
      setRestoreMessage(t("unlock.restore.fail"));
      triggerShake();
    }
  };

  const handleRestoreFromAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!onRestoreFromAccount) return;

    if (!accountRestoreEmail.trim()) {
      setAccountRestoreStatus("error");
      setAccountRestoreMessage(t("unlock.error.accountEmail"));
      triggerShake();
      return;
    }

    if (!accountRestorePassword) {
      setAccountRestoreStatus("error");
      setAccountRestoreMessage(t("unlock.error.accountPassword"));
      triggerShake();
      return;
    }

    if (!accountRestoreLocalPassword) {
      setAccountRestoreStatus("error");
      setAccountRestoreMessage(t("unlock.error.localPassword"));
      triggerShake();
      return;
    }

    if (accountRestoreLocalPassword !== accountRestoreConfirmPassword) {
      setAccountRestoreStatus("error");
      setAccountRestoreMessage(t("unlock.error.localConfirm"));
      triggerShake();
      return;
    }

    setAccountRestoreStatus("loading");
    setAccountRestoreMessage(t("unlock.status.accountRestoring"));

    try {
      const result = await onRestoreFromAccount({
        email: accountRestoreEmail.trim(),
        accountPassword: accountRestorePassword,
        localPassword: accountRestoreLocalPassword,
      });

      if (result.ok) {
        setAccountRestoreStatus("success");
        setAccountRestoreMessage(result.message ?? t("unlock.status.accountRestored"));
        setAccountRestorePassword("");
        setAccountRestoreLocalPassword("");
        setAccountRestoreConfirmPassword("");
        return;
      }

      setAccountRestoreStatus("error");
      setAccountRestoreMessage(result.message ?? t("unlock.status.accountRestoreFail"));
      setAccountRestorePassword("");
      setAccountRestoreLocalPassword("");
      setAccountRestoreConfirmPassword("");
      triggerShake();
    } catch {
      setAccountRestoreStatus("error");
      setAccountRestoreMessage(t("unlock.status.accountRestoreFail"));
      triggerShake();
    }
  };

  const handleRequestRecoveryEmail = async () => {
    if (!onRequestAccountRecoveryEmail) return;

    if (!recoveryResetEmail.trim()) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryEmailBeforeRequest"));
      triggerShake();
      return;
    }

    setRecoveryResetStatus("loading");
    setRecoveryResetMessage(t("unlock.status.recoveryEmailSending"));

    try {
      const result = await onRequestAccountRecoveryEmail(recoveryResetEmail.trim());
      if (result.ok) {
        setRecoveryResetStatus("success");
        setRecoveryResetMessage(result.message ?? t("unlock.status.recoveryEmailSent"));
        return;
      }

      setRecoveryResetStatus("error");
      setRecoveryResetMessage(result.message ?? t("unlock.status.recoveryEmailFail"));
      triggerShake();
    } catch {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.status.recoveryEmailFail"));
      triggerShake();
    }
  };

  const handleRecoveryReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!onResetAccountWithRecoveryKey) return;

    if (!recoveryResetEmail.trim()) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryEmail"));
      triggerShake();
      return;
    }

    if (!recoveryResetEmailToken.trim()) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryToken"));
      triggerShake();
      return;
    }

    if (!recoveryResetKey.trim()) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryKey"));
      triggerShake();
      return;
    }

    if (recoveryResetPassword.length < 10) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryPasswordLength"));
      triggerShake();
      return;
    }

    if (recoveryResetPassword !== recoveryResetConfirmPassword) {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.error.recoveryPasswordConfirm"));
      triggerShake();
      return;
    }

    setRecoveryResetStatus("loading");
    setRecoveryResetMessage(t("unlock.status.recoveryResetting"));

    try {
      const result = await onResetAccountWithRecoveryKey({
        email: recoveryResetEmail.trim(),
        emailResetToken: recoveryResetEmailToken.trim(),
        recoveryKey: recoveryResetKey.trim(),
        newPassword: recoveryResetPassword,
      });

      if (result.ok) {
        setRecoveryResetStatus("success");
        setRecoveryResetMessage(result.message ?? t("unlock.status.recoveryResetSuccess"));
        setAccountRestoreEmail(recoveryResetEmail.trim());
        setAccountRestorePassword(recoveryResetPassword);
        setRecoveryResetEmailToken("");
        setRecoveryResetKey("");
        setRecoveryResetPassword("");
        setRecoveryResetConfirmPassword("");
        clearAccountRestoreState();
        return;
      }

      setRecoveryResetStatus("error");
      setRecoveryResetMessage(result.message ?? t("unlock.status.recoveryResetFail"));
      setRecoveryResetKey("");
      setRecoveryResetPassword("");
      setRecoveryResetConfirmPassword("");
      triggerShake();
    } catch {
      setRecoveryResetStatus("error");
      setRecoveryResetMessage(t("unlock.status.recoveryResetFail"));
      triggerShake();
    }
  };

  const statusConfig = {
    idle: null,
    loading: {
      color: "border-l-amber-500 bg-amber-500/5",
      badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      badgeLabel: isSetup ? t("unlock.badge.settingUp") : t("unlock.badge.decrypting"),
      icon: Timer,
      iconClass: "text-amber-400",
    },
    success: {
      color: "border-l-emerald-500 bg-emerald-500/5",
      badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      badgeLabel: isSetup ? t("unlock.badge.vaultReady") : t("unlock.badge.unlocked"),
      icon: CheckCircle,
      iconClass: "text-emerald-400",
    },
    error: {
      color: "border-l-red-500 bg-red-500/5",
      badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
      badgeLabel: t("unlock.badge.denied"),
      icon: Warning,
      iconClass: "text-red-400",
    },
  };

  const currentStatus = statusConfig[status];
  const securityNotes = getSecurityNotes(mode, t);

  return (
    <section
      id="unlock-vault"
      className="min-h-screen bg-background flex items-center justify-center px-4 py-12"
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(var(--grid-line)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--grid-line)) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="h-0.5 w-full bg-amber-500 mb-0 rounded-t-sm" />

        <div
          className={`bg-neutral-900 border border-neutral-800 border-t-0 rounded-b-sm transition-transform duration-300 ${
            isShaking ? "animate-pulse" : ""
          }`}
        >
          <div className="px-8 pt-8 pb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-9 h-9 bg-amber-500/10 border border-amber-500/25 rounded-sm">
                <LockKey weight="duotone" className="text-amber-400" size={20} />
              </div>
              <div>
                <p className="text-xs font-mono text-amber-500 tracking-widest uppercase">
                  {APP_NAME}
                </p>
              </div>
            </div>

            <h1 className="font-heading text-2xl font-semibold text-foreground tracking-tight mb-1">
              {isSetup ? t("unlock.title.setup") : t("unlock.title.unlock")}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isSetup
                ? t("unlock.description.setup")
                : t("unlock.description.unlock")}
            </p>
          </div>

          <Separator className="bg-neutral-800" />

          <form onSubmit={handleUnlock} className="px-8 py-6 space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="master-password"
                className="text-xs font-mono tracking-widest uppercase text-muted-foreground"
              >
                {isSetup ? t("unlock.master.create") : t("unlock.master.existing")}
              </Label>
              <div className="relative">
                <Input
                  id="master-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearErrorState();
                  }}
                  placeholder={isSetup ? t("unlock.master.placeholder.create") : t("unlock.master.placeholder.existing")}
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  autoFocus
                  disabled={status === "loading" || status === "success"}
                  className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm pr-11 font-mono text-sm h-11 transition-all duration-150"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((currentValue) => !currentValue)}
                  disabled={status === "loading" || status === "success"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-amber-400 transition-colors duration-150 focus:outline-none disabled:opacity-40"
                  aria-label={showPassword ? t("unlock.hidePassword") : t("unlock.showPassword")}
                >
                  {showPassword ? <EyeSlash weight="duotone" size={18} /> : <Eye weight="duotone" size={18} />}
                </button>
              </div>
            </div>

            {isSetup && (
              <div className="space-y-2">
                <Label
                  htmlFor="confirm-master-password"
                  className="text-xs font-mono tracking-widest uppercase text-muted-foreground"
                >
                  {t("unlock.confirmMaster")}
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-master-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      clearErrorState();
                    }}
                    placeholder={t("unlock.confirmMaster.placeholder")}
                    autoComplete="new-password"
                    disabled={status === "loading" || status === "success"}
                    className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm pr-11 font-mono text-sm h-11 transition-all duration-150"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((currentValue) => !currentValue)}
                    disabled={status === "loading" || status === "success"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-amber-400 transition-colors duration-150 focus:outline-none disabled:opacity-40"
                    aria-label={showConfirmPassword ? t("unlock.hideConfirmation") : t("unlock.showConfirmation")}
                  >
                    {showConfirmPassword ? <EyeSlash weight="duotone" size={18} /> : <Eye weight="duotone" size={18} />}
                  </button>
                </div>
              </div>
            )}

            {currentStatus && (
              <div
                className={`border-l-2 pl-4 pr-3 py-3 rounded-r-sm flex items-start gap-3 transition-all duration-200 ${currentStatus.color}`}
              >
                <currentStatus.icon
                  weight="duotone"
                  size={16}
                  className={`mt-0.5 shrink-0 ${currentStatus.iconClass}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge
                      className={`text-[10px] font-mono tracking-wider border px-1.5 py-0 rounded-sm ${currentStatus.badgeClass}`}
                    >
                      {currentStatus.badgeLabel}
                    </Badge>
                    {attemptCount > 0 && status === "error" && !isSetup && (
                      <span className="text-[10px] font-mono text-neutral-500">
                        {attemptCount} attempt{attemptCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {statusMessage}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-mono tracking-widest uppercase text-muted-foreground mb-3">
                {t("unlock.sessionPreference")}
              </p>
              <div className="space-y-2">
                {sessionOptions.map((option) => {
                  const isSelected = selectedSession === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedSession(option.id)}
                      className={`w-full text-left px-4 py-3 border rounded-sm transition-all duration-150 group ${
                        isSelected
                          ? "border-amber-500/50 bg-amber-500/5"
                          : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${
                              isSelected
                                ? "border-amber-500"
                                : "border-neutral-600 group-hover:border-neutral-500"
                            }`}
                          >
                            {isSelected && (
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {t(option.labelKey)}
                              </span>
                              {option.recommended && (
                                <Badge className="text-[9px] font-mono tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/25 px-1.5 py-0 rounded-sm">
                                  {t("common.recommended")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t(option.descriptionKey)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-3 px-4 py-3 bg-neutral-950 border border-neutral-800 border-l-2 border-l-amber-500/40 rounded-r-sm">
              <Timer
                weight="duotone"
                size={15}
                className="text-amber-500/70 mt-0.5 shrink-0"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("unlock.autoLockNote", { minutes: 5 })}
              </p>
            </div>

            <Button
              type="submit"
              disabled={status === "loading" || status === "success"}
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm font-mono text-sm tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 group disabled:opacity-60"
            >
              {status === "loading" ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {isSetup ? t("unlock.loading.setup") : t("unlock.loading.unlock")}
                </>
              ) : status === "success" ? (
                <>
                  <CheckCircle weight="duotone" size={16} />
                  {isSetup ? t("unlock.success.setup") : t("unlock.success.unlock")}
                </>
              ) : (
                <>
                  {isSetup ? t("unlock.submit.setup") : t("unlock.submit.unlock")}
                  <ArrowRight
                    weight="duotone"
                    size={16}
                    className="transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </>
              )}
            </Button>
          </form>

          <Separator className="bg-neutral-800" />

          {isSetup && onRestoreBackup && (
            <>
              <div className="px-8 py-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-amber-500/10 border border-amber-500/25 rounded-sm shrink-0">
                    <UploadSimple weight="duotone" className="text-amber-400" size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("unlock.restore.title")}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {t("unlock.restore.desc")}
                    </p>
                  </div>
                </div>

                {restoreMessage && (
                  <div
                    className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      restoreStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : restoreStatus === "success"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-500 bg-amber-500/5 text-amber-400"
                    }`}
                  >
                    {restoreMessage}
                  </div>
                )}

                <label
                  className={`inline-flex w-full items-center justify-center gap-2 border text-xs font-mono tracking-wide px-4 py-3 rounded-sm transition-all duration-150 ${
                    restoreStatus === "loading"
                      ? "cursor-not-allowed border-amber-500/40 text-amber-400 bg-amber-500/5"
                      : "cursor-pointer border-neutral-800 text-muted-foreground hover:border-amber-500/50 hover:text-amber-400 hover:bg-amber-500/5"
                  }`}
                >
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    disabled={restoreStatus === "loading"}
                    onChange={handleRestoreBackup}
                  />
                  {restoreStatus === "loading" ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                      {t("unlock.restore.button.loading")}
                    </>
                  ) : (
                    <>
                      <UploadSimple weight="duotone" size={14} />
                      {t("unlock.restore.button")}
                    </>
                  )}
                </label>
              </div>

              <Separator className="bg-neutral-800" />
            </>
          )}

          {isSetup && onResetAccountWithRecoveryKey && (
            <>
              <div className="px-8 py-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-amber-500/10 border border-amber-500/25 rounded-sm shrink-0">
                    <LockKey weight="duotone" className="text-amber-400" size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("unlock.recovery.title")}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {t("unlock.recovery.desc")}
                    </p>
                  </div>
                </div>

                {recoveryResetMessage && (
                  <div
                    className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      recoveryResetStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : recoveryResetStatus === "success"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-500 bg-amber-500/5 text-amber-400"
                    }`}
                  >
                    {recoveryResetMessage}
                  </div>
                )}

                <form onSubmit={handleRecoveryReset} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.email")}
                      </span>
                      <Input
                        type="email"
                        value={recoveryResetEmail}
                        onChange={(event) => {
                          setRecoveryResetEmail(event.target.value);
                          clearRecoveryResetState();
                        }}
                        autoComplete="email"
                        disabled={recoveryResetStatus === "loading"}
                        placeholder="you@example.com"
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    {onRequestAccountRecoveryEmail && (
                      <div className="md:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border border-neutral-800 bg-neutral-950/50 rounded-sm px-3 py-3">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {t("unlock.recovery.step1")}
                        </p>
                        <Button
                          type="button"
                          onClick={handleRequestRecoveryEmail}
                          disabled={recoveryResetStatus === "loading"}
                          className="shrink-0 border border-amber-500/40 bg-amber-500/10 text-amber-400 rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-500/15 transition-all duration-150"
                        >
                          {t("unlock.recovery.sendEmail")}
                        </Button>
                      </div>
                    )}

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.emailToken")}
                      </span>
                      <Input
                        type="text"
                        value={recoveryResetEmailToken}
                        onChange={(event) => {
                          setRecoveryResetEmailToken(event.target.value);
                          clearRecoveryResetState();
                        }}
                        autoComplete="off"
                        disabled={recoveryResetStatus === "loading"}
                        placeholder={t("unlock.recovery.emailToken.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.key")}
                      </span>
                      <Input
                        type="text"
                        value={recoveryResetKey}
                        onChange={(event) => {
                          setRecoveryResetKey(event.target.value);
                          clearRecoveryResetState();
                        }}
                        autoComplete="off"
                        disabled={recoveryResetStatus === "loading"}
                        placeholder="ciphora-rk-xxxxxx-xxxxxx-xxxxxx..."
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.newPassword")}
                      </span>
                      <Input
                        type="password"
                        value={recoveryResetPassword}
                        onChange={(event) => {
                          setRecoveryResetPassword(event.target.value);
                          clearRecoveryResetState();
                        }}
                        autoComplete="new-password"
                        disabled={recoveryResetStatus === "loading"}
                        placeholder={t("unlock.recovery.newPassword.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.confirmPassword")}
                      </span>
                      <Input
                        type="password"
                        value={recoveryResetConfirmPassword}
                        onChange={(event) => {
                          setRecoveryResetConfirmPassword(event.target.value);
                          clearRecoveryResetState();
                        }}
                        autoComplete="new-password"
                        disabled={recoveryResetStatus === "loading"}
                        placeholder={t("unlock.recovery.confirmPassword.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("unlock.recovery.step2")}
                    </p>
                    <Button
                      type="submit"
                      disabled={recoveryResetStatus === "loading"}
                      className="shrink-0 bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-primary/90 transition-all duration-150"
                    >
                      {recoveryResetStatus === "loading" ? (
                        t("unlock.recovery.resetting")
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <LockKey weight="duotone" size={14} />
                          {t("unlock.recovery.resetButton")}
                        </span>
                      )}
                    </Button>
                  </div>
                </form>
              </div>

              <Separator className="bg-neutral-800" />
            </>
          )}

          {isSetup && onRestoreFromAccount && (
            <>
              <div className="px-8 py-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-amber-500/10 border border-amber-500/25 rounded-sm shrink-0">
                    <ShieldCheck weight="duotone" className="text-amber-400" size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("unlock.accountRestore.title")}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {t("unlock.accountRestore.desc")}
                    </p>
                  </div>
                </div>

                {accountRestoreMessage && (
                  <div
                    className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      accountRestoreStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : accountRestoreStatus === "success"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-500 bg-amber-500/5 text-amber-400"
                    }`}
                  >
                    {accountRestoreMessage}
                  </div>
                )}

                <form onSubmit={handleRestoreFromAccount} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.recovery.email")}
                      </span>
                      <Input
                        type="email"
                        value={accountRestoreEmail}
                        onChange={(event) => {
                          setAccountRestoreEmail(event.target.value);
                          clearAccountRestoreState();
                        }}
                        autoComplete="email"
                        disabled={accountRestoreStatus === "loading"}
                        placeholder="you@example.com"
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.accountRestore.accountPassword")}
                      </span>
                      <Input
                        type="password"
                        value={accountRestorePassword}
                        onChange={(event) => {
                          setAccountRestorePassword(event.target.value);
                          clearAccountRestoreState();
                        }}
                        autoComplete="current-password"
                        disabled={accountRestoreStatus === "loading"}
                        placeholder={t("unlock.accountRestore.accountPassword.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.accountRestore.localPassword")}
                      </span>
                      <Input
                        type="password"
                        value={accountRestoreLocalPassword}
                        onChange={(event) => {
                          setAccountRestoreLocalPassword(event.target.value);
                          clearAccountRestoreState();
                        }}
                        autoComplete="new-password"
                        disabled={accountRestoreStatus === "loading"}
                        placeholder={t("unlock.accountRestore.localPassword.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {t("unlock.accountRestore.confirmLocal")}
                      </span>
                      <Input
                        type="password"
                        value={accountRestoreConfirmPassword}
                        onChange={(event) => {
                          setAccountRestoreConfirmPassword(event.target.value);
                          clearAccountRestoreState();
                        }}
                        autoComplete="new-password"
                        disabled={accountRestoreStatus === "loading"}
                        placeholder={t("unlock.accountRestore.confirmLocal.placeholder")}
                        className="bg-neutral-950 border-neutral-700 text-foreground placeholder:text-neutral-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-sm font-mono text-sm h-11 transition-all duration-150"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("unlock.accountRestore.note")}
                    </p>
                    <Button
                      type="submit"
                      disabled={accountRestoreStatus === "loading"}
                      className="shrink-0 bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-primary/90 transition-all duration-150"
                    >
                      {accountRestoreStatus === "loading" ? (
                        t("unlock.accountRestore.restoring")
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck weight="duotone" size={14} />
                          {t("unlock.accountRestore.button")}
                        </span>
                      )}
                    </Button>
                  </div>
                </form>
              </div>

              <Separator className="bg-neutral-800" />
            </>
          )}

          <div className="px-8 py-5 space-y-3">
            <p className="text-[10px] font-mono tracking-widest uppercase text-neutral-600 mb-3">
              {t("unlock.securityNotes")}
            </p>
            {securityNotes.map((note, index) => (
              <div key={index} className="flex items-start gap-3">
                <note.icon
                  weight="duotone"
                  size={13}
                  className="text-neutral-600 mt-0.5 shrink-0"
                />
                <p className="text-[11px] text-neutral-600 leading-relaxed">
                  {note.text}
                </p>
              </div>
            ))}
          </div>

          {status === "success" && (
            <div className="h-0.5 w-full bg-emerald-500 rounded-b-sm" />
          )}
          {status === "error" && attemptCount >= 3 && (
            <div className="h-0.5 w-full bg-red-500 rounded-b-sm" />
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          {onSwitchToPin && !isSetup && (
            <button
              onClick={onSwitchToPin}
              className="flex items-center gap-2 text-xs font-mono text-neutral-600 hover:text-amber-400 transition-colors duration-150 group"
            >
              <span className="w-5 h-5 rounded-sm border border-neutral-700 group-hover:border-amber-500/50 flex items-center justify-center text-[11px] font-bold group-hover:text-amber-400 transition-colors">
                #
              </span>
              {t("unlock.usePin")}
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="text-[10px] font-mono text-neutral-700 tracking-widest">
            {APP_NAME_UPPER} {APP_VERSION}
          </span>
          <span className="text-neutral-800">.</span>
          <span className="text-[10px] font-mono text-neutral-700 tracking-widest">
            {t("unlock.footer")}
          </span>
        </div>
      </div>
    </section>
  );
}
