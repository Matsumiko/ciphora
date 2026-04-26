export type Screen =
  | "landing"
  | "unlock-vault"
  | "pin-unlock"
  | "vault-dashboard"
  | "item-library"
  | "generator-tools"
  | "security-audit"
  | "sync-settings"
  | "account-settings"
  | "security-center"
  | "data-settings"
  | "preferences-settings"
  | "security-settings";

export type VaultPanel =
  | "vault-dashboard"
  | "item-library"
  | "generator-tools"
  | "security-audit"
  | "sync-settings"
  | "account-settings"
  | "security-center"
  | "data-settings"
  | "preferences-settings"
  | "security-settings";

export const ROUTE_PATHS = {
  landing: "/",
  about: "/about",
  contact: "/contact",
  terms: "/terms",
  privacy: "/privacy",
  vaultRoot: "/vault",
  unlockVault: "/vault/unlock",
  pinUnlock: "/vault/pin",
  vaultDashboard: "/vault/dashboard",
  itemLibrary: "/vault/items",
  generatorTools: "/vault/generator",
  securityAudit: "/vault/security/audit",
  syncSettings: "/vault/sync",
  accountSettings: "/vault/account",
  securityCenter: "/vault/security",
  dataSettings: "/vault/data",
  preferencesSettings: "/vault/preferences",
  securitySettings: "/vault/settings",
} as const;

const SCREEN_TO_PATH: Record<Exclude<Screen, "landing">, string> = {
  "unlock-vault": ROUTE_PATHS.unlockVault,
  "pin-unlock": ROUTE_PATHS.pinUnlock,
  "vault-dashboard": ROUTE_PATHS.vaultDashboard,
  "item-library": ROUTE_PATHS.itemLibrary,
  "generator-tools": ROUTE_PATHS.generatorTools,
  "security-audit": ROUTE_PATHS.securityAudit,
  "sync-settings": ROUTE_PATHS.syncSettings,
  "account-settings": ROUTE_PATHS.accountSettings,
  "security-center": ROUTE_PATHS.securityCenter,
  "data-settings": ROUTE_PATHS.dataSettings,
  "preferences-settings": ROUTE_PATHS.preferencesSettings,
  "security-settings": ROUTE_PATHS.securitySettings,
};

const PANEL_TO_PATH: Record<VaultPanel, string> = {
  "vault-dashboard": ROUTE_PATHS.vaultDashboard,
  "item-library": ROUTE_PATHS.itemLibrary,
  "generator-tools": ROUTE_PATHS.generatorTools,
  "security-audit": ROUTE_PATHS.securityAudit,
  "sync-settings": ROUTE_PATHS.syncSettings,
  "account-settings": ROUTE_PATHS.accountSettings,
  "security-center": ROUTE_PATHS.securityCenter,
  "data-settings": ROUTE_PATHS.dataSettings,
  "preferences-settings": ROUTE_PATHS.preferencesSettings,
  "security-settings": ROUTE_PATHS.securitySettings,
};

export function getScreenFromPath(pathname: string): Screen {
  if (pathname === ROUTE_PATHS.landing) return "landing";
  if (pathname === ROUTE_PATHS.unlockVault) return "unlock-vault";
  if (pathname === ROUTE_PATHS.pinUnlock) return "pin-unlock";
  if (pathname === ROUTE_PATHS.vaultDashboard) return "vault-dashboard";
  if (pathname === ROUTE_PATHS.itemLibrary) return "item-library";
  if (pathname === ROUTE_PATHS.generatorTools) return "generator-tools";
  if (pathname === ROUTE_PATHS.securityAudit) return "security-audit";
  if (pathname === ROUTE_PATHS.syncSettings) return "sync-settings";
  if (pathname === ROUTE_PATHS.accountSettings) return "account-settings";
  if (pathname === ROUTE_PATHS.securityCenter) return "security-center";
  if (pathname === ROUTE_PATHS.dataSettings) return "data-settings";
  if (pathname === ROUTE_PATHS.preferencesSettings) return "preferences-settings";
  if (pathname === ROUTE_PATHS.securitySettings) return "security-settings";
  return "landing";
}

export function getPathForScreen(screen: Exclude<Screen, "landing">) {
  return SCREEN_TO_PATH[screen];
}

export function getPathForPanel(panel: VaultPanel) {
  return PANEL_TO_PATH[panel];
}

export function isVaultPanel(screen: Screen): screen is VaultPanel {
  return screen === "vault-dashboard"
    || screen === "item-library"
    || screen === "generator-tools"
    || screen === "security-audit"
    || screen === "sync-settings"
    || screen === "account-settings"
    || screen === "security-center"
    || screen === "data-settings"
    || screen === "preferences-settings"
    || screen === "security-settings";
}

export function getDefaultVaultPath(isUnlocked: boolean, hasPinStored: boolean) {
  if (isUnlocked) return ROUTE_PATHS.vaultDashboard;
  return hasPinStored ? ROUTE_PATHS.pinUnlock : ROUTE_PATHS.unlockVault;
}
