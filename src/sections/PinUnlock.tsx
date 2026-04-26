import { useCallback, useEffect, useMemo, useState } from "react";
import { LockKey, ArrowLeft, CheckCircle, Warning, Fingerprint, Lock } from "@phosphor-icons/react";
import { APP_NAME, APP_NAME_UPPER, APP_VERSION } from "../lib/app-config";
import { useI18n } from "@/lib/i18n";

const MAX_ATTEMPTS = 5;
const PIN_LENGTH = 6;

type PinMode = "enter" | "setup" | "confirm";
type PinStatus = "idle" | "success" | "error" | "loading";

interface PinUnlockResult {
  ok: boolean;
  message?: string;
}

interface PinUnlockProps {
  mode?: "enter" | "setup";
  onUnlockPin?: (pin: string) => Promise<PinUnlockResult>;
  onSetupPin?: (pin: string) => Promise<PinUnlockResult>;
  onUseMasterPassword: () => void;
  onResetPin?: () => void;
}

export default function PinUnlock({
  mode: forcedMode = "enter",
  onUnlockPin,
  onSetupPin,
  onUseMasterPassword,
  onResetPin,
}: PinUnlockProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PinMode>(forcedMode);
  const [pin, setPin] = useState<string[]>([]);
  const [confirmPin, setConfirmPin] = useState<string[]>([]);
  const [status, setStatus] = useState<PinStatus>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [shake, setShake] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  useEffect(() => {
    setMode(forcedMode);
    setPin([]);
    setConfirmPin([]);
    setStatus("idle");
    setStatusMsg("");
    setAttempts(0);
  }, [forcedMode]);

  const currentPin = mode === "confirm" ? confirmPin : pin;

  const setCurrentPin = useCallback((updater: (previous: string[]) => string[]) => {
    if (mode === "confirm") {
      setConfirmPin(updater);
      return;
    }
    setPin(updater);
  }, [mode]);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  const clearStatus = useCallback(() => {
    if (status !== "loading") {
      setStatus("idle");
      setStatusMsg("");
    }
  }, [status]);

  const handleDigit = useCallback((digit: string) => {
    if (currentPin.length >= PIN_LENGTH || status === "success" || status === "loading") return;
    setPressedKey(digit);
    setTimeout(() => setPressedKey(null), 120);
    setCurrentPin((previous) => [...previous, digit]);
    clearStatus();
  }, [clearStatus, currentPin.length, setCurrentPin, status]);

  const handleDelete = useCallback(() => {
    if (status === "loading") return;
    setCurrentPin((previous) => previous.slice(0, -1));
    clearStatus();
  }, [clearStatus, setCurrentPin, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key >= "0" && event.key <= "9") handleDigit(event.key);
      if (event.key === "Backspace") handleDelete();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDelete, handleDigit]);

  const titleMap: Record<PinMode, string> = {
    enter: t("pin.title.enter"),
    setup: t("pin.title.setup"),
    confirm: t("pin.title.confirm"),
  };

  const subMap: Record<PinMode, string> = {
    enter: t("pin.sub.enter"),
    setup: t("pin.sub.setup"),
    confirm: t("pin.sub.confirm"),
  };

  const footerLabel = useMemo(() => {
    if (forcedMode === "setup") {
      return t("pin.backSettings");
    }
    return t("pin.useMaster");
  }, [forcedMode, t]);

  const submitPin = useCallback(async () => {
    const pinValue = currentPin.join("");
    if (pinValue.length < PIN_LENGTH) return;

    if (mode === "setup") {
      setMode("confirm");
      setStatus("idle");
      setStatusMsg("");
      return;
    }

    if (mode === "confirm") {
      if (pinValue !== pin.join("")) {
        setStatus("error");
        setStatusMsg(t("pin.error.mismatch"));
        triggerShake();
        setConfirmPin([]);
        return;
      }

      if (!onSetupPin) {
        setStatus("error");
        setStatusMsg(t("pin.error.setupUnavailable"));
        triggerShake();
        return;
      }

      setStatus("loading");
      setStatusMsg(t("pin.status.saving"));
      const result = await onSetupPin(pinValue);
      if (result.ok) {
        setStatus("success");
        setStatusMsg(result.message ?? t("pin.status.saved"));
        return;
      }

      setStatus("error");
      setStatusMsg(result.message ?? t("pin.status.saveFail"));
      triggerShake();
      setConfirmPin([]);
      return;
    }

    if (!onUnlockPin) {
      setStatus("error");
      setStatusMsg(t("pin.error.unavailable"));
      triggerShake();
      return;
    }

    setStatus("loading");
    setStatusMsg(t("pin.status.verifying"));
    const result = await onUnlockPin(pinValue);
    if (result.ok) {
      setStatus("success");
      setStatusMsg(result.message ?? t("pin.status.unlocked"));
      return;
    }

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setStatus("error");
    setStatusMsg(
      nextAttempts >= MAX_ATTEMPTS
        ? t("pin.error.tooMany")
        : (result.message ?? t("pin.error.incorrect", { remaining: MAX_ATTEMPTS - nextAttempts })),
    );
    triggerShake();
    setPin([]);

    if (nextAttempts >= MAX_ATTEMPTS) {
      setTimeout(() => onUseMasterPassword(), 1500);
    }
  }, [attempts, currentPin, mode, onSetupPin, onUnlockPin, onUseMasterPassword, pin, t, triggerShake]);

  useEffect(() => {
    if (currentPin.length < PIN_LENGTH) return;
    const timer = window.setTimeout(() => {
      void submitPin();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [currentPin, submitPin]);

  const keypad = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "del"],
  ];

  return (
    <section className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025] z-0"
        style={{
          backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 w-full max-w-xs">
        <div className="h-0.5 w-full bg-amber-500 rounded-t-sm" />

        <div className="bg-card border border-border border-t-0 rounded-b-sm overflow-hidden animate-fade-in-scale">
          <div className="text-center px-8 pt-8 pb-6">
            <div className={`relative w-16 h-16 mx-auto mb-4 animate-bounce-in ${shake ? "animate-shake" : ""}`}>
              <div className="absolute inset-0 rounded-full bg-amber-500/10 border border-amber-500/25 animate-pulse-glow" />
              <div className="relative w-full h-full flex items-center justify-center">
                {status === "success" ? (
                  <CheckCircle weight="duotone" size={32} className="text-emerald-400 animate-bounce-in" />
                ) : status === "error" ? (
                  <Warning weight="duotone" size={32} className="text-red-400" />
                ) : mode === "enter" ? (
                  <Fingerprint weight="duotone" size={32} className="text-amber-400" />
                ) : (
                  <Lock weight="duotone" size={32} className="text-amber-400" />
                )}
              </div>
            </div>

            <p className="text-[10px] font-mono text-amber-500 tracking-widest uppercase mb-1">{APP_NAME}</p>
            <h2 className="font-heading text-xl font-bold text-foreground mb-1">{titleMap[mode]}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">{subMap[mode]}</p>
          </div>

          <div className={`flex items-center justify-center gap-3 px-8 pb-6 ${shake ? "animate-shake" : ""}`}>
            {Array.from({ length: PIN_LENGTH }).map((_, index) => (
              <div
                key={index}
                className={`pin-dot w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
                  index < currentPin.length
                    ? "filled border-amber-500 bg-amber-500"
                    : "border-border bg-transparent"
                } ${status === "success" ? "border-emerald-500 bg-emerald-500" : ""}
                ${status === "error" ? "border-red-500 bg-red-500/60" : ""}`}
              />
            ))}
          </div>

          {statusMsg && (
            <div
              className={`mx-6 mb-4 px-3 py-2 rounded-sm flex items-center gap-2 text-xs font-mono animate-fade-in ${
                status === "success"
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                  : status === "loading"
                    ? "bg-amber-500/10 border border-amber-500/30 text-amber-400"
                    : "bg-red-500/10 border border-red-500/30 text-red-400"
              }`}
            >
              {status === "success" ? (
                <CheckCircle size={12} weight="duotone" />
              ) : status === "loading" ? (
                <Fingerprint size={12} weight="duotone" />
              ) : (
                <Warning size={12} weight="duotone" />
              )}
              {statusMsg}
            </div>
          )}

          <div className="px-6 pb-6">
            {keypad.map((row, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-3 gap-2 mb-2">
                {row.map((key, keyIndex) => {
                  if (!key) return <div key={keyIndex} />;
                  const isPressed = pressedKey === key;
                  const isDeleteKey = key === "del";

                  return (
                    <button
                      key={keyIndex}
                      onClick={() => (isDeleteKey ? handleDelete() : handleDigit(key))}
                      disabled={status === "success" || status === "loading"}
                      className={`
                        h-14 rounded-sm border font-mono font-semibold text-lg
                        transition-all duration-100 select-none
                        ${isDeleteKey
                          ? "border-border text-muted-foreground hover:text-foreground hover:bg-muted text-sm"
                          : "border-border text-foreground hover:border-amber-500/60 hover:bg-amber-500/5 hover:text-amber-400"
                        }
                        ${isPressed ? "animate-pin-press bg-amber-500/10 border-amber-500/50 scale-95" : "bg-card"}
                        disabled:opacity-40
                      `}
                      aria-label={isDeleteKey ? t("pin.delete") : t("pin.digit", { digit: key })}
                    >
                      {isDeleteKey ? <ArrowLeft size={16} weight="duotone" className="mx-auto" /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="border-t border-border px-6 py-4 flex items-center justify-between">
            <button
              onClick={onUseMasterPassword}
              className="text-xs font-mono text-muted-foreground hover:text-amber-400 transition-colors duration-150 flex items-center gap-1.5"
            >
              <LockKey size={12} weight="duotone" />
              {footerLabel}
            </button>

            {(mode === "enter" || forcedMode === "setup") && onResetPin && (
              <button
                onClick={onResetPin}
                className="text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors duration-150"
              >
                {t("pin.remove")}
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[10px] font-mono text-muted-foreground tracking-widest">
          {APP_NAME_UPPER} {APP_VERSION} - {t("pin.footer")}
        </p>
      </div>
    </section>
  );
}
