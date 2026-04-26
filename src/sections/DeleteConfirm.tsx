import { Warning, Trash } from "@phosphor-icons/react";

interface DeleteConfirmProps {
  open: boolean;
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirm({ open, itemName, onConfirm, onCancel }: DeleteConfirmProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-card border border-red-900/40 rounded-sm shadow-2xl overflow-hidden">
        <div className="h-0.5 bg-red-500 shrink-0" />
        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-sm bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
              <Warning weight="duotone" size={18} className="text-red-400" />
            </div>
            <div>
              <h3 className="font-heading text-base font-bold text-foreground mb-1">Delete Item</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Are you sure you want to permanently delete{" "}
                <span className="text-foreground font-semibold">&#34;{itemName}&#34;</span>?
                This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="px-4 py-2 text-xs font-mono text-muted-foreground border border-border rounded-sm hover:text-foreground hover:border-foreground/20 transition-all duration-150">
              Cancel
            </button>
            <button onClick={onConfirm} className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold bg-red-600 text-white rounded-sm hover:bg-red-500 transition-all duration-150">
              <Trash size={13} weight="duotone" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
