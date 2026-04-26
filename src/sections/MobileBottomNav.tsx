import {
  SquaresFour,
  Vault,
  Password,
  ArrowsDownUp,
  ShieldWarning,
  GearSix,
} from "@phosphor-icons/react";
import { NavLink } from "react-router-dom";
import { getPathForPanel, type VaultPanel } from "@/lib/routes";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const navItems = [
  { id: "vault-dashboard", labelKey: "nav.home", icon: SquaresFour },
  { id: "item-library", labelKey: "nav.vault", icon: Vault },
  { id: "generator-tools", labelKey: "nav.generator", icon: Password },
  { id: "sync-settings", labelKey: "nav.sync", icon: ArrowsDownUp },
  { id: "security-audit", labelKey: "nav.audit", icon: ShieldWarning },
  { id: "security-settings", labelKey: "nav.settings", icon: GearSix },
] satisfies Array<{ id: VaultPanel; labelKey: TranslationKey; icon: typeof SquaresFour }>;

export default function MobileBottomNav() {
  const { t } = useI18n();
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-t border-border safe-area-pb">
      <div className="flex items-stretch h-16">
        {navItems.map(({ id, labelKey, icon: Icon }, idx) => {
          const routePath = getPathForPanel(id);
          const label = t(labelKey);
          return (
            <NavLink
              key={id}
              to={routePath}
              style={{ animationDelay: `${idx * 0.05}s` }}
              className={({ isActive }) => `flex-1 flex flex-col items-center justify-center gap-1 transition-all duration-200 relative animate-fade-in
                ${isActive ? "text-amber-400 scale-105" : "text-muted-foreground hover:text-foreground hover:scale-105"}`}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-500 rounded-full animate-fade-in" />
                  )}
                  <Icon weight={isActive ? "fill" : "regular"} size={20} className={isActive ? "animate-bounce-in" : ""} />
                  <span className="text-[10px] font-mono leading-none tracking-wide">{label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
