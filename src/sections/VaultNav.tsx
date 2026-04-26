import { useState, type PointerEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import BrandLogo from "@/components/BrandLogo";
import { getPathForPanel, type VaultPanel } from "@/lib/routes";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  SquaresFour,
  Vault,
  Password,
  ArrowsDownUp,
  ShieldCheck,
  ShieldWarning,
  UserCircle,
  Database,
  GearSix,
  CaretLeft,
  CaretRight,
  Lock,
  LockOpen,
  Timer,
} from "@phosphor-icons/react";

const navItems = [
  {
    id: "vault-dashboard",
    labelKey: "nav.dashboard",
    icon: SquaresFour,
  },
  {
    id: "item-library",
    labelKey: "nav.itemLibrary",
    icon: Vault,
  },
  {
    id: "generator-tools",
    labelKey: "nav.generator",
    icon: Password,
  },
  {
    id: "security-audit",
    labelKey: "nav.securityAudit",
    icon: ShieldWarning,
  },
  {
    id: "sync-settings",
    labelKey: "nav.sync",
    icon: ArrowsDownUp,
  },
  {
    id: "account-settings",
    labelKey: "nav.account",
    icon: UserCircle,
  },
  {
    id: "security-center",
    labelKey: "nav.security",
    icon: ShieldCheck,
  },
  {
    id: "data-settings",
    labelKey: "nav.data",
    icon: Database,
  },
  {
    id: "preferences-settings",
    labelKey: "nav.preferences",
    icon: GearSix,
  },
  {
    id: "security-settings",
    labelKey: "nav.settingsHub",
    icon: GearSix,
  },
] satisfies Array<{ id: VaultPanel; labelKey: TranslationKey; icon: typeof SquaresFour }>;

export default function VaultNav({
  autoLockSeconds = 300,
}: {
  autoLockSeconds?: number | null;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const countdown = autoLockSeconds ?? 0;
  const isUnlocked = true;
  const autoLockDisabled = autoLockSeconds === null;

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isWarning = !autoLockDisabled && countdown < 60;

  const handleRoutePointerDown = (
    event: PointerEvent<HTMLAnchorElement>,
    routePath: string,
  ) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    navigate(routePath);
  };

  const ExpandedHeader = () => (
    <div className="flex items-center px-3 h-14 shrink-0 relative z-10 pointer-events-auto">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 shrink-0 rounded-sm flex items-center justify-center overflow-hidden">
          <BrandLogo variant="mark" className="h-7 w-7" />
        </div>
        <span className="font-heading text-sm font-semibold text-foreground truncate">
          Ciphora
        </span>
      </div>
    </div>
  );

  const CollapsedHeader = () => (
    <div className="flex items-center justify-center h-14 shrink-0 relative z-10 pointer-events-auto">
      <span className="w-7 h-7 rounded-sm flex items-center justify-center overflow-hidden">
        <BrandLogo variant="mark" className="h-7 w-7" />
      </span>
    </div>
  );

  const NavContent = () => (
    <div className="flex flex-col h-full">
      {/* Nav Items */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const routePath = getPathForPanel(item.id);
          const label = t(item.labelKey);
          return (
            <NavLink
              key={item.id}
              to={routePath}
              data-route={routePath}
              onPointerDownCapture={(event) => handleRoutePointerDown(event, routePath)}
              className={({ isActive }) => `
                relative z-10 pointer-events-auto w-full flex items-center gap-3 rounded-sm transition-all duration-200
                ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"}
                ${
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }
              `}
              title={collapsed ? label : undefined}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-amber-500 rounded-full pointer-events-none" />
                  )}
                  <Icon
                    weight="duotone"
                    size={18}
                    className={`shrink-0 pointer-events-none ${isActive ? "text-amber-500" : ""}`}
                  />
                  {!collapsed && (
                    <span className="text-sm font-medium truncate pointer-events-none">
                      {label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <Separator className="mx-2 bg-border" />

      {/* Session Status Module */}
      <div
        className={`px-2 py-3 ${collapsed ? "flex justify-center" : ""}`}
      >
        {collapsed ? (
          <div
            className={`w-8 h-8 rounded-sm flex items-center justify-center ${
              isUnlocked ? "bg-emerald-500/10" : "bg-muted"
            }`}
            title={`Vault ${isUnlocked ? t("sidebar.unlocked") : t("sidebar.locked")} - ${autoLockDisabled ? t("sidebar.autoLockOff") : formatCountdown(countdown)}`}
          >
            {isUnlocked ? (
              <LockOpen
                weight="duotone"
                size={16}
                className={isWarning ? "text-amber-500" : "text-emerald-400"}
              />
            ) : (
              <Lock
                weight="duotone"
                size={16}
                className="text-muted-foreground"
              />
            )}
          </div>
        ) : (
          <div className="relative rounded-sm border border-border bg-muted/40 px-3 py-2.5 overflow-hidden">
            {/* Amber strip for session */}
            <span
              className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                isWarning
                  ? "bg-amber-500"
                  : isUnlocked
                    ? "bg-emerald-500"
                    : "bg-muted-foreground"
              }`}
            />
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                {isUnlocked ? (
                  <LockOpen
                    weight="duotone"
                    size={13}
                    className={
                      isWarning ? "text-amber-500" : "text-emerald-400"
                    }
                  />
                ) : (
                  <Lock
                    weight="duotone"
                    size={13}
                    className="text-muted-foreground"
                  />
                )}
                <span
                  className={`text-xs font-semibold ${
                    isUnlocked
                      ? isWarning
                        ? "text-amber-500"
                        : "text-emerald-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {isUnlocked ? t("sidebar.unlocked") : t("sidebar.locked")}
                </span>
              </div>
              <Badge
                className={`text-[10px] px-1.5 py-0 h-4 rounded-sm font-mono border-0 ${
                  isWarning
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {t("sidebar.local")}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Timer
                weight="duotone"
                size={11}
                className={
                  isWarning ? "text-amber-500" : "text-muted-foreground"
                }
              />
              <span
                className={`text-[11px] font-mono ${
                  isWarning ? "text-amber-400" : "text-muted-foreground"
                }`}
              >
                {autoLockDisabled ? t("sidebar.autoLockOff") : `${t("sidebar.autoLockIn")} `}
                <span className="font-semibold">
                  {autoLockDisabled ? "" : formatCountdown(countdown)}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      <Separator className="mx-2 bg-border" />

      {/* User Avatar */}
      <div
        className={`px-2 py-3 flex items-center ${
          collapsed ? "justify-center" : "gap-3"
        }`}
      >
        <Avatar className="w-8 h-8 shrink-0 rounded-sm">
          <AvatarFallback className="rounded-sm bg-muted text-foreground text-xs font-semibold">
            CP
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {t("sidebar.vaultOwner")}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {t("sidebar.localVault")}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        id="vault-nav"
        className={`
          hidden lg:flex flex-col h-screen bg-card border-r border-border relative z-40 pointer-events-auto
          transition-all duration-300 ease-out shrink-0
          ${collapsed ? "w-16" : "w-60"}
        `}
      >
        {/* Hairline grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Header */}
        <div className="border-b border-border relative z-10">
          {collapsed ? <CollapsedHeader /> : <ExpandedHeader />}
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="absolute right-[-13px] top-4 z-50 hidden lg:flex h-8 w-6 items-center justify-center rounded-r-sm border border-l-0 border-border bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? (
            <CaretRight weight="duotone" size={14} />
          ) : (
            <CaretLeft weight="duotone" size={14} />
          )}
        </button>

        {/* Nav content */}
        <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden relative z-10 pointer-events-auto">
          <NavContent />
        </div>
      </aside>
    </>
  );
}
