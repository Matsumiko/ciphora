import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPathForPanel, ROUTE_PATHS, type VaultPanel } from "@/lib/routes";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  MagnifyingGlass,
  Plus,
  LockKey,
  CloudArrowUp,
  ArrowsDownUp,
  CaretRight,
  User,
  SignOut,
  Gear,
  CheckCircle,
  Moon,
  Sun,
} from "@phosphor-icons/react";

const navLinks = [
  { id: "vault-dashboard", labelKey: "nav.dashboard" },
  { id: "item-library", labelKey: "nav.itemLibrary" },
  { id: "generator-tools", labelKey: "nav.generator" },
  { id: "security-audit", labelKey: "nav.securityAudit" },
  { id: "sync-settings", labelKey: "nav.sync" },
  { id: "account-settings", labelKey: "nav.account" },
  { id: "security-center", labelKey: "nav.security" },
  { id: "data-settings", labelKey: "nav.data" },
  { id: "preferences-settings", labelKey: "nav.preferences" },
  { id: "security-settings", labelKey: "nav.settingsHub" },
] satisfies Array<{ id: VaultPanel; labelKey: TranslationKey }>;

export default function VaultTopbar({
  activePanel,
  onLock,
  onAddItem,
  onSearch,
  searchValue = "",
  theme = "dark",
  onToggleTheme,
  onExportVault,
}: {
  activePanel?: string;
  onLock?: () => void;
  onAddItem?: () => void;
  onSearch?: (q: string) => void;
  searchValue?: string;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onExportVault?: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const userMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const userMenuPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (userMenuButtonRef.current?.contains(target)) return;
      if (userMenuPanelRef.current?.contains(target)) return;
      setUserMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [userMenuOpen]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearch?.(e.target.value);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") onSearch?.("");
  };

  const handleLock = () => {
    onLock?.();
  };

  const handleAddItem = () => {
    onAddItem?.();
  };

  const handleBackup = () => {
    onExportVault?.();
    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 2500);
  };

  const activeLink = navLinks.find((link) => link.id === activePanel);
  const activeLabel = activeLink ? t(activeLink.labelKey) : t("nav.vault");

  return (
    <header
      id="vault-topbar"
      className="sticky top-0 z-30 w-full h-14 bg-card/95 backdrop-blur-sm border-b border-border flex items-center px-4 gap-3 relative"
    >
      {/* Left: Breadcrumb */}
      <nav className="flex items-center gap-1 shrink-0 min-w-0">
        <span className="text-xs font-mono text-muted-foreground tracking-widest uppercase select-none hidden sm:block">
          Ciphora
        </span>
        <CaretRight
          weight="duotone"
          className="text-muted-foreground w-3 h-3 shrink-0 hidden sm:block"
        />
        <Link
          to={ROUTE_PATHS.vaultDashboard}
          className="text-xs font-mono text-foreground hover:text-amber-400 transition-colors duration-150 tracking-wide truncate max-w-[120px] sm:max-w-none"
        >
          {t("nav.dashboard")}
        </Link>
        <CaretRight
          weight="duotone"
          className="text-muted-foreground w-3 h-3 shrink-0"
        />
        <span className="text-xs font-mono text-amber-400 tracking-wide font-medium">
          {activeLabel}
        </span>
      </nav>

      {/* Center: Global Search */}
      <div className="flex-1 max-w-xs sm:max-w-sm md:max-w-md mx-auto relative">
        <MagnifyingGlass
          weight="duotone"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground w-3.5 h-3.5 pointer-events-none"
        />
        <Input
          type="text"
          placeholder={t("topbar.searchPlaceholder")}
          value={searchValue}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          className="h-8 pl-8 pr-3 bg-background border-border text-foreground placeholder:text-muted-foreground text-xs font-mono rounded-sm focus-visible:ring-1 focus-visible:ring-amber-500 focus-visible:border-amber-500 transition-all duration-150"
        />
      </div>

      {/* Right: Action Cluster */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Backup Reminder */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackup}
          className="h-8 px-2 gap-1.5 text-xs font-mono rounded-sm transition-all duration-150 hidden sm:flex items-center text-muted-foreground hover:text-foreground hover:bg-muted border border-border hover:border-foreground/20"
        >
          {exportSuccess ? (
            <CheckCircle
              weight="duotone"
              className="w-3.5 h-3.5 text-green-400"
            />
          ) : (
            <CloudArrowUp weight="duotone" className="w-3.5 h-3.5" />
          )}
          <span className="hidden md:inline">
            {exportSuccess ? t("topbar.exported") : t("topbar.exportBackup")}
          </span>
        </Button>

        {/* Add New Item */}
        <Button
          size="sm"
          onClick={handleAddItem}
          className="h-8 px-2.5 gap-1.5 bg-primary text-primary-foreground text-xs font-mono rounded-sm hover:bg-primary/90 transition-all duration-150 font-medium"
        >
          <Plus weight="duotone" className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t("topbar.addItem")}</span>
        </Button>

        {/* Lock Vault */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleLock}
          className="h-8 px-2.5 gap-1.5 bg-transparent border-border text-muted-foreground text-xs font-mono rounded-sm hover:bg-muted hover:text-foreground hover:border-border transition-all duration-150"
        >
          <LockKey weight="duotone" className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t("topbar.lock")}</span>
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocale(locale === "id" ? "en" : "id")}
          className="h-8 px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm transition-all duration-150 text-[10px] font-mono font-semibold tracking-widest"
          title={t("topbar.switchLanguage", { language: locale === "id" ? "English" : "Bahasa Indonesia" })}
          aria-label={t("topbar.switchLanguage", { language: locale === "id" ? "English" : "Bahasa Indonesia" })}
        >
          {locale === "id" ? "ID" : "EN"}
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleTheme}
          className="h-8 w-8 px-0 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm transition-all duration-150"
          title={theme === "dark" ? t("topbar.switchLight") : t("topbar.switchDark")}
        >
          {theme === "dark"
            ? <Sun weight="duotone" className="w-3.5 h-3.5" />
            : <Moon weight="duotone" className="w-3.5 h-3.5" />
          }
        </Button>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-0.5 hidden sm:block" />

        {/* User Menu */}
        <div className="relative">
          <button
            ref={userMenuButtonRef}
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 h-8 px-2 rounded-sm hover:bg-muted transition-all duration-150 group"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            {/* Avatar */}
            <div className="w-6 h-6 rounded-sm bg-muted border border-border group-hover:border-foreground/20 flex items-center justify-center transition-all duration-150 shrink-0">
              <span className="text-[10px] font-mono font-bold text-foreground leading-none">
                LS
              </span>
            </div>
            {/* Session status badge */}
            <div className="hidden sm:flex flex-col items-start gap-0.5">
              <span className="text-[10px] font-mono text-muted-foreground group-hover:text-foreground leading-none transition-colors duration-150 truncate max-w-[80px]">
                {t("topbar.localSession")}
              </span>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-[9px] font-mono text-green-500 leading-none uppercase tracking-wider">
                  {t("topbar.unlocked")}
                </span>
              </div>
            </div>
          </button>

          {/* Dropdown Menu */}
          {userMenuOpen && (
              <div
                ref={userMenuPanelRef}
                className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-sm shadow-xl z-50 overflow-hidden"
              >
                {/* Session info header */}
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-xs font-mono text-foreground font-medium">
                    {t("topbar.localSession")}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-[10px] font-mono text-green-500 uppercase tracking-wider">
                      {t("topbar.sessionActive")}
                    </span>
                  </div>
                </div>

                {/* Nav links */}
                <div className="py-1">
                  {navLinks.map((link) => {
                    const linkLabel = t(link.labelKey);
                    return (
                    <NavLink
                      key={link.id}
                      to={getPathForPanel(link.id)}
                      onClick={() => setUserMenuOpen(false)}
                      className={({ isActive }) => `flex items-center gap-2.5 w-full px-3 py-2 text-xs font-mono transition-all duration-100 ${
                        isActive
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {link.id === "security-settings" || link.id === "preferences-settings" ? (
                        <Gear
                          weight="duotone"
                          className="w-3.5 h-3.5 shrink-0"
                        />
                      ) : link.id === "sync-settings" ? (
                        <ArrowsDownUp
                          weight="duotone"
                          className="w-3.5 h-3.5 shrink-0"
                        />
                      ) : (
                        <User
                          weight="duotone"
                          className="w-3.5 h-3.5 shrink-0"
                        />
                      )}
                      {linkLabel}
                    </NavLink>
                    );
                  })}
                </div>

                {/* Divider + Lock */}
                <div className="border-t border-border py-1">
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      handleLock();
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-mono text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-100"
                  >
                    <SignOut
                      weight="duotone"
                      className="w-3.5 h-3.5 shrink-0"
                    />
                    {t("topbar.lockVault")}
                  </button>
                </div>
              </div>
          )}
        </div>
      </div>
    </header>
  );
}
