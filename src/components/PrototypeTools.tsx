import { useEffect, useRef, useState } from "react";
import { Check, FlaskConical, X } from "lucide-react";
import type { CardVariant } from "@/components/VenueCard";
import { cn } from "@/lib/utils";

const OPTIONS: { id: CardVariant; label: string; desc: string }[] = [
  { id: "v3", label: "Variant A", desc: "Постоянно видимые миниатюры" },
  { id: "v4", label: "Variant B", desc: "Hover-навигация по слайдам" },
  { id: "v5", label: "Variant C", desc: "Выделение только оформлением" },
  { id: "v6", label: "Variant D", desc: "Контентное отличие тарифа" },
];

/** Плавающая панель переключения вариантов карточек (для прототипа). */
export function PrototypeTools({
  variant,
  onChange,
}: {
  variant: CardVariant;
  onChange: (v: CardVariant) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Prototype tools</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="p-2">
            <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">
              Вариант карточки
            </div>
            {OPTIONS.map((o) => {
              const active = variant === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => onChange(o.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                    active ? "bg-accent" : "hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {active && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {o.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg ring-1 ring-black/10 transition-transform hover:scale-[1.03] active:scale-95"
      >
        <FlaskConical className="size-4" />
        Prototype tools
      </button>
    </div>
  );
}
