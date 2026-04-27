import { useEffect, useState } from "react";
import { ArrowSquareOut, DownloadSimple, ShieldCheck, X } from "@phosphor-icons/react";
import { APP_RELEASE_VERSION, APP_VERSION } from "../lib/app-config";
import {
  fetchLatestAppRelease,
  getAvailableAndroidUpdate,
  isAndroidNativeRuntime,
  markAppUpdateChecked,
  shouldSkipAppUpdateCheck,
  snoozeAppUpdatePrompt,
  type AppUpdateAvailable,
} from "../lib/app-update";

function formatSha(value?: string | null) {
  if (!value) return "Available in SHA256SUMS.txt";
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export default function AppUpdatePrompt() {
  const [update, setUpdate] = useState<AppUpdateAvailable | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !isAndroidNativeRuntime()) return undefined;
    if (shouldSkipAppUpdateCheck(window.localStorage)) return undefined;

    const controller = new AbortController();
    markAppUpdateChecked(window.localStorage);

    window.setTimeout(() => {
      fetchLatestAppRelease(controller.signal)
        .then((manifest) => {
          const available = getAvailableAndroidUpdate(manifest);
          if (available) setUpdate(available);
        })
        .catch(() => undefined);
    }, 1800);

    return () => controller.abort();
  }, []);

  if (!update || dismissed) return null;

  const { manifest, android } = update;
  const notes = manifest.notes?.slice(0, 3) ?? [];

  const handleLater = () => {
    if (typeof window !== "undefined") {
      snoozeAppUpdatePrompt(window.localStorage);
    }
    setDismissed(true);
  };

  const handleDownload = () => {
    if (typeof window === "undefined") return;
    window.open(android.apkUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={handleLater} />
      <section className="relative w-full max-w-md overflow-hidden rounded-sm border border-amber-500/30 bg-card shadow-2xl">
        <div className="h-0.5 bg-amber-400" />
        <div className="p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <DownloadSimple size={20} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-amber-500">APK Update</p>
                <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {APP_VERSION}
                </span>
              </div>
              <h2 className="font-heading text-lg font-bold text-foreground">
                Ciphora v{manifest.version} tersedia
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Build Android yang kamu install bisa diperbarui lewat APK release resmi. Android tetap akan meminta konfirmasi install.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLater}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Tutup update prompt"
            >
              <X size={16} weight="bold" />
            </button>
          </div>

          <div className="mb-5 space-y-3 border-y border-border py-4">
            <div className="flex items-center justify-between gap-3 text-xs font-mono">
              <span className="text-muted-foreground">Installed</span>
              <span className="text-foreground">{APP_RELEASE_VERSION}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs font-mono">
              <span className="text-muted-foreground">Latest</span>
              <span className="text-amber-500">{manifest.version}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs font-mono">
              <span className="text-muted-foreground">APK SHA-256</span>
              <span className="max-w-[190px] truncate text-right text-foreground">{formatSha(android.sha256Apk)}</span>
            </div>
          </div>

          {notes.length > 0 && (
            <ul className="mb-5 space-y-2">
              {notes.map((note) => (
                <li key={note} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck size={14} weight="duotone" className="mt-0.5 shrink-0 text-emerald-400" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleLater}
              className="rounded-sm border border-border px-4 py-2 text-xs font-mono text-muted-foreground transition-all duration-150 hover:border-foreground/20 hover:text-foreground"
            >
              Nanti
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center justify-center gap-2 rounded-sm bg-amber-500 px-4 py-2 text-xs font-mono font-bold text-black shadow-lg shadow-amber-500/20 transition-all duration-150 hover:bg-amber-400"
            >
              Download APK
              <ArrowSquareOut size={14} weight="duotone" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
