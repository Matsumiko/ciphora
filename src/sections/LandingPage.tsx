import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LockKey,
  ShieldCheck,
  Key,
  Timer,
  Note,
  CreditCard,
  ArrowRight,
  Check,
  Lightning,
  Database,
  Eye,
  Globe,
  Fingerprint,
} from "@phosphor-icons/react";
import BrandLogo from "@/components/BrandLogo";
import { APP_HOSTNAME, APP_NAME, APP_VERSION } from "../lib/app-config";
import { ROUTE_PATHS } from "../lib/routes";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const features = [
  {
    icon: ShieldCheck,
    titleKey: "landing.feature.local.title",
    descKey: "landing.feature.local.desc",
    accent: "emerald",
  },
  {
    icon: Key,
    titleKey: "landing.feature.password.title",
    descKey: "landing.feature.password.desc",
    accent: "amber",
  },
  {
    icon: Timer,
    titleKey: "landing.feature.totp.title",
    descKey: "landing.feature.totp.desc",
    accent: "amber",
  },
  {
    icon: Note,
    titleKey: "landing.feature.notes.title",
    descKey: "landing.feature.notes.desc",
    accent: "neutral",
  },
  {
    icon: CreditCard,
    titleKey: "landing.feature.cards.title",
    descKey: "landing.feature.cards.desc",
    accent: "neutral",
  },
  {
    icon: Database,
    titleKey: "landing.feature.localOnly.title",
    descKey: "landing.feature.localOnly.desc",
    accent: "neutral",
  },
] satisfies Array<{
  icon: typeof ShieldCheck;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  accent: "emerald" | "amber" | "neutral";
}>;

const stats = [
  { valueKey: "landing.stat.storage.value", labelKey: "landing.stat.storage.label", icon: ShieldCheck },
  { valueKey: "landing.stat.server.value", labelKey: "landing.stat.server.label", icon: Globe },
  { valueKey: "landing.stat.browser.value", labelKey: "landing.stat.browser.label", icon: Fingerprint },
  { valueKey: "landing.stat.items.value", labelKey: "landing.stat.items.label", icon: Database },
] satisfies Array<{ valueKey: TranslationKey; labelKey: TranslationKey; icon: typeof ShieldCheck }>;

const faqs = [
  { qKey: "landing.faq.q1", aKey: "landing.faq.a1" },
  { qKey: "landing.faq.q2", aKey: "landing.faq.a2" },
  { qKey: "landing.faq.q3", aKey: "landing.faq.a3" },
  { qKey: "landing.faq.q4", aKey: "landing.faq.a4" },
] satisfies Array<{ qKey: TranslationKey; aKey: TranslationKey }>;

const securityRows = [
  {
    labelKey: "landing.security.row.keyDerivation.label",
    valueKey: "landing.security.row.keyDerivation.value",
    color: "text-amber-400",
  },
  {
    labelKey: "landing.security.row.deployment.label",
    valueKey: "landing.security.row.deployment.value",
    color: "text-emerald-400",
  },
  {
    labelKey: "landing.security.row.storage.label",
    valueKey: "landing.security.row.storage.value",
    color: "text-foreground",
  },
  {
    labelKey: "landing.security.row.master.label",
    valueKey: "landing.security.row.master.value",
    color: "text-red-400",
  },
] satisfies Array<{ labelKey: TranslationKey; valueKey: TranslationKey; color: string }>;

const runtimeSteps = [
  {
    step: "01",
    labelKey: "landing.security.step1.label",
    subKey: "landing.security.step1.sub",
    color: "border-l-amber-500",
  },
  {
    step: "02",
    labelKey: "landing.security.step2.label",
    subKey: "landing.security.step2.sub",
    color: "border-l-amber-400",
  },
  {
    step: "03",
    labelKey: "landing.security.step3.label",
    subKey: "landing.security.step3.sub",
    color: "border-l-emerald-500",
  },
  {
    step: "04",
    labelKey: "landing.security.step4.label",
    subKey: "landing.security.step4.sub",
    color: "border-l-emerald-400",
  },
  {
    step: "05",
    labelKey: "landing.security.step5.label",
    subKey: "landing.security.step5.sub",
    color: "border-l-neutral-600",
  },
] satisfies Array<{ step: string; labelKey: TranslationKey; subKey: TranslationKey; color: string }>;

export default function LandingPage({
  onGetStarted,
}: {
  onGetStarted: () => void;
}) {
  const { t } = useI18n();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const landingNavItems = [
    { label: t("landing.nav.features"), target: "features", type: "anchor" as const },
    { label: t("landing.nav.security"), target: "security", type: "anchor" as const },
    { label: t("landing.nav.faq"), target: "faq", type: "anchor" as const },
    { label: t("landing.nav.about"), target: ROUTE_PATHS.about, type: "route" as const },
    { label: t("landing.nav.contact"), target: ROUTE_PATHS.contact, type: "route" as const },
  ];
  const footerLinks = [
    { label: t("landing.footer.about"), path: ROUTE_PATHS.about },
    { label: t("landing.footer.contact"), path: ROUTE_PATHS.contact },
    { label: t("landing.footer.terms"), path: ROUTE_PATHS.terms },
    { label: t("landing.footer.privacy"), path: ROUTE_PATHS.privacy },
  ];

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-foreground overflow-x-hidden">
      {/* Grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025] z-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Sticky nav */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-card/95 backdrop-blur-sm border-b border-border shadow-sm shadow-black/5"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
          <div className="min-w-0 justify-self-start flex items-center gap-2.5">
            <BrandLogo variant="wordmark" className="h-8 w-auto shrink-0" />
            <span className="hidden sm:inline text-[10px] font-mono bg-amber-500/10 text-amber-500 border border-amber-500/25 px-1.5 py-0.5 rounded-sm tracking-wider">
              {APP_VERSION}
            </span>
          </div>
          <nav className="hidden md:flex justify-self-center items-center gap-1">
            {landingNavItems.map((item) => (
              item.type === "anchor" ? (
                <a
                  key={item.target}
                  href={`#${item.target}`}
                  className="px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors duration-150 rounded-sm hover:bg-muted"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.target}
                  to={item.target}
                  className="px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors duration-150 rounded-sm hover:bg-muted"
                >
                  {item.label}
                </Link>
              )
            ))}
          </nav>
          <button
            onClick={onGetStarted}
            className="justify-self-end flex items-center gap-2 px-4 py-2 bg-amber-500 text-neutral-950 text-xs font-mono font-bold rounded-sm hover:bg-amber-400 transition-all duration-150 group"
          >
            <span>{t("landing.openVault")}</span>
            <ArrowRight
              weight="duotone"
              size={14}
              className="transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 text-center overflow-hidden">
        {/* Radial glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[300px] h-[200px] bg-amber-500/8 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 bg-amber-500/10 border border-amber-500/25 rounded-sm">
            <Lightning weight="duotone" size={12} className="text-amber-500" />
            <span className="text-xs font-mono text-amber-400 tracking-wider">
              {t("landing.badge")}
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-[1.05] tracking-tight mb-6">
            {t("landing.headline.line1")}
            <br />
            <span className="text-amber-500">{t("landing.headline.line2")}</span>
            <br />
            {t("landing.headline.line3")}
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            {t("landing.description")}{" "}
            <span className="text-foreground font-medium">
              {t("landing.descriptionStrong")}
            </span>
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2.5 px-8 py-3.5 bg-amber-500 text-neutral-950 font-heading font-bold text-sm rounded-sm hover:bg-amber-400 transition-all duration-200 group shadow-lg shadow-amber-500/20"
            >
              <LockKey weight="duotone" size={18} />
              <span>{t("landing.cta.primary")}</span>
              <ArrowRight
                weight="duotone"
                size={16}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </button>
            <a
              href="#features"
              className="flex items-center gap-2 px-6 py-3.5 border border-border text-muted-foreground text-sm font-mono rounded-sm hover:border-foreground hover:text-foreground transition-all duration-200"
            >
              <Eye weight="duotone" size={16} />
              <span>{t("landing.cta.secondary")}</span>
            </a>
          </div>

          {/* Social proof mini */}
          <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
            {[
              t("landing.tag.noCloud"),
              t("landing.tag.encryption"),
              t("landing.tag.openArchitecture"),
            ].map((tag) => (
              <div key={tag} className="flex items-center gap-1.5">
                <Check
                  weight="bold"
                  size={11}
                  className="text-emerald-500 shrink-0"
                />
                <span className="text-xs font-mono text-muted-foreground">
                  {tag}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Hero UI mockup */}
        <div className="relative z-10 mt-16 max-w-4xl mx-auto">
          <div className="relative">
            {/* Glow under mockup */}
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />

            <div className="bg-neutral-900 border border-neutral-800 rounded-sm overflow-hidden shadow-2xl shadow-black/60">
              {/* Mockup topbar */}
              <div className="h-10 bg-neutral-900 border-b border-neutral-800 flex items-center px-4 gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <div className="flex-1 mx-4 h-5 bg-neutral-800 rounded-sm flex items-center px-2">
                  <span className="text-[10px] font-mono text-neutral-600">
                    {APP_HOSTNAME}
                  </span>
                </div>
              </div>

              {/* Mockup content */}
              <div className="flex h-48 sm:h-64">
                {/* Sidebar */}
                <div className="w-44 bg-neutral-950 border-r border-neutral-800 p-3 hidden sm:flex flex-col gap-1">
                  <div className="h-1 w-8 bg-amber-500 rounded-full mb-3" />
                  {[t("nav.dashboard"), t("nav.itemLibrary"), t("nav.generator"), t("nav.settings")].map(
                    (item, i) => (
                      <div
                        key={item}
                        className={`h-7 rounded-sm flex items-center px-2.5 gap-2 ${
                          i === 0
                            ? "bg-zinc-800 border-l-2 border-l-amber-500"
                            : ""
                        }`}
                      >
                        <div
                          className={`w-3 h-3 rounded-sm ${i === 0 ? "bg-amber-500/50" : "bg-neutral-700"}`}
                        />
                        <div
                          className={`h-1.5 rounded-full ${i === 0 ? "w-16 bg-neutral-400" : "w-12 bg-neutral-700"}`}
                        />
                      </div>
                    ),
                  )}
                </div>
                {/* Main content */}
                <div className="flex-1 p-4 grid grid-cols-3 gap-2 content-start">
                  {[
                    { c: "bg-amber-500/20", w: "w-12" },
                    { c: "bg-emerald-500/20", w: "w-16" },
                    { c: "bg-neutral-700", w: "w-10" },
                    { c: "bg-amber-500/10", w: "w-14" },
                    { c: "bg-neutral-700", w: "w-12" },
                    { c: "bg-neutral-800", w: "w-10" },
                  ].map((card, i) => (
                    <div
                      key={i}
                      className="bg-neutral-800 border border-neutral-700 rounded-sm p-2.5 space-y-1.5"
                    >
                      <div className={`h-2 rounded-full ${card.c} ${card.w}`} />
                      <div className="h-1.5 bg-neutral-700 rounded-full w-full" />
                      <div className="h-1.5 bg-neutral-700 rounded-full w-3/4" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="relative z-10 border-y border-border py-10 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.labelKey} className="text-center">
                <Icon
                  weight="duotone"
                  size={20}
                  className="text-amber-500 mx-auto mb-2"
                />
                <div className="font-heading text-2xl font-bold text-foreground mb-1">
                  {t(stat.valueKey)}
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {t(stat.labelKey)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-mono text-amber-500 tracking-widest uppercase mb-3">
              {t("landing.features.eyebrow")}
            </p>
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {t("landing.features.title1")}
              <br />
              <span className="text-muted-foreground">{t("landing.features.title2")}</span>
            </h2>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">
              {t("landing.features.description", { appName: APP_NAME })}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.titleKey}
                  className="group bg-neutral-900 border border-neutral-800 rounded-sm p-6 hover:border-amber-500/40 transition-all duration-200 hover:bg-neutral-800/50 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div
                    className={`w-9 h-9 rounded-sm flex items-center justify-center mb-4 ${
                      f.accent === "emerald"
                        ? "bg-emerald-500/10 border border-emerald-500/25"
                        : f.accent === "amber"
                          ? "bg-amber-500/10 border border-amber-500/25"
                          : "bg-muted border border-border"
                    }`}
                  >
                    <Icon
                      weight="duotone"
                      size={18}
                      className={
                        f.accent === "emerald"
                          ? "text-emerald-400"
                          : f.accent === "amber"
                            ? "text-amber-400"
                            : "text-muted-foreground"
                      }
                    />
                  </div>
                  <h3 className="font-heading text-base font-semibold text-foreground mb-2 group-hover:text-amber-400 transition-colors duration-200">
                    {t(f.titleKey)}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(f.descKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Security deep dive */}
      <section
        id="security"
        className="relative z-10 py-20 px-4 border-y border-border"
      >
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-mono text-amber-500 tracking-widest uppercase mb-3">
                {t("landing.security.eyebrow")}
              </p>
              <h2 className="font-heading text-3xl font-bold text-foreground mb-5 leading-tight">
                {t("landing.security.title1")}
                <br />
                {t("landing.security.title2")}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-8">
                {t("landing.security.description", { appName: APP_NAME })}
              </p>
              <div className="space-y-4">
                {securityRows.map((row) => (
                  <div
                    key={row.labelKey}
                    className="flex items-center justify-between py-2.5 border-b border-border"
                  >
                    <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                      {t(row.labelKey)}
                    </span>
                    <span className={`text-xs font-mono font-semibold ${row.color}`}>
                      {t(row.valueKey)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual diagram */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-sm p-6 space-y-3">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">
                {t("landing.security.runtime")}
              </p>
              {runtimeSteps.map((item) => (
                <div
                  key={item.step}
                  className={`border-l-2 ${item.color} pl-4 py-2 bg-neutral-950 rounded-r-sm`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {item.step}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {t(item.labelKey)}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {t(item.subKey)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-20 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-mono text-amber-500 tracking-widest uppercase mb-3">
              {t("landing.faq.eyebrow")}
            </p>
            <h2 className="font-heading text-3xl font-bold text-foreground">
              {t("landing.faq.title")}
            </h2>
          </div>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="border border-border rounded-sm bg-neutral-900 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-neutral-800/60 transition-colors duration-150"
                >
                  <span className="text-sm font-medium text-foreground pr-4">
                    {t(faq.qKey)}
                  </span>
                  <div
                    className={`shrink-0 w-5 h-5 rounded-sm border border-border flex items-center justify-center transition-transform duration-200 ${
                      openFaq === i ? "rotate-45 border-amber-500 text-amber-500" : "text-muted-foreground"
                    }`}
                  >
                    <span className="text-xs font-bold leading-none">+</span>
                  </div>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 border-t border-border">
                    <p className="text-sm text-muted-foreground leading-relaxed pt-3">
                      {t(faq.aKey)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-amber-500/5 rounded-sm blur-2xl" />
            <div className="relative bg-neutral-900 border border-amber-500/30 rounded-sm px-8 py-14">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-sm flex items-center justify-center mx-auto mb-6">
                <LockKey
                  weight="duotone"
                  size={24}
                  className="text-amber-400"
                />
              </div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
                {t("landing.final.title1")}
                <br />
                <span className="text-amber-500">{t("landing.final.title2")}</span>
              </h2>
              <p className="text-muted-foreground text-sm mb-8 max-w-lg mx-auto">
                {t("landing.final.description")}
              </p>
              <button
                onClick={onGetStarted}
                className="inline-flex items-center gap-2.5 px-10 py-4 bg-amber-500 text-neutral-950 font-heading font-bold text-sm rounded-sm hover:bg-amber-400 transition-all duration-200 group shadow-xl shadow-amber-500/25"
              >
                <LockKey weight="duotone" size={18} />
                {t("landing.cta.primary")}
                <ArrowRight
                  weight="duotone"
                  size={16}
                  className="transition-transform duration-150 group-hover:translate-x-1"
                />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border px-4 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm flex items-center justify-center overflow-hidden">
              <BrandLogo variant="mark" className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {APP_NAME} {APP_VERSION} - {t("landing.footer.vault")}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-end">
            {footerLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                {link.label}
              </Link>
            ))}
            <span className="text-xs font-mono text-muted-foreground">
              {t("landing.footer.claims")}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-mono text-emerald-500">
                {t("landing.footer.status")}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}




