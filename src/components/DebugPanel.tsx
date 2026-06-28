import { useState } from "react";
import { Bug, ChevronDown, EyeOff } from "lucide-react";
import type { Venue } from "@/data/venues";
import { EXCLUSION_LABELS, exclusionReasons } from "@/lib/storefront";
import { Badge } from "@/components/ui/badge";
import { VenueLogo } from "@/components/VenueCard";
import { cn } from "@/lib/utils";

export function DebugPanel({ excluded }: { excluded: Venue[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border">
          <Bug className="size-4" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium">
            Демо: почему витрина не показывается
          </span>
          <span className="block text-xs text-muted-foreground">
            {excluded.length} витрин скрыто бизнес-правилами · только для проверки логики
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul className="space-y-2 px-5 pb-5">
          {excluded.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-secondary text-lg">
                <VenueLogo logo={v.logo} name={v.name} />
              </span>
              <span className="mr-auto min-w-0">
                <span className="block truncate text-sm font-medium">
                  {v.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {v.city} · {v.url}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {exclusionReasons(v).map((r) => (
                  <Badge key={r} variant="muted" className="gap-1">
                    <EyeOff className="size-3" />
                    {EXCLUSION_LABELS[r]}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
