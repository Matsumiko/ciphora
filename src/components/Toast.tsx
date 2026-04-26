import { useState, useCallback, createContext, useContext, useEffect } from "react";
import { CheckCircle, Warning, Info, X, Copy } from "@phosphor-icons/react";

export type ToastVariant = "success" | "error" | "warning" | "info" | "copy";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastCtx {
  toast: (msg: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

let _uid = 0;

const iconMap: Record<ToastVariant, React.ElementType> = {
  success: CheckCircle,
  error: Warning,
  warning: Warning,
  info: Info,
  copy: Copy,
};

const colorMap: Record<ToastVariant, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  error:   "border-red-500/40     bg-red-500/10     text-red-400",
  warning: "border-amber-500/40   bg-amber-500/10   text-amber-400",
  info:    "border-border         bg-card           text-foreground",
  copy:    "border-amber-500/40   bg-amber-500/10   text-amber-400",
};

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const Icon = iconMap[item.variant];

  useEffect(() => {
    const dur = item.duration ?? 3000;
    const leave = setTimeout(() => setLeaving(true), dur - 300);
    const remove = setTimeout(() => onRemove(item.id), dur);
    return () => { clearTimeout(leave); clearTimeout(remove); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-sm border shadow-lg text-sm font-mono max-w-xs w-full
        ${colorMap[item.variant]}
        ${leaving ? "animate-toast-out" : "animate-toast-in"}
      `}
    >
      <Icon size={15} weight="duotone" className="shrink-0" />
      <span className="flex-1 text-xs leading-snug">{item.message}</span>
      <button
        onClick={() => { setLeaving(true); setTimeout(() => onRemove(item.id), 300); }}
        className="shrink-0 ml-1 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((msg: string, variant: ToastVariant = "info", duration = 3000) => {
    const id = ++_uid;
    setItems(prev => [...prev.slice(-4), { id, message: msg, variant, duration }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 lg:bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
        {items.map(item => (
          <div key={item.id} className="pointer-events-auto">
            <ToastCard item={item} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
