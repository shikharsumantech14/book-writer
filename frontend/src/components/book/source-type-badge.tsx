import { Building2, Globe, Newspaper } from "lucide-react"

import type { SourceType } from "@/lib/api"
import { cn } from "@/lib/utils"

const TYPES = {
  official: { label: "Official", icon: Building2 },
  news: { label: "News", icon: Newspaper },
  other: { label: "Other", icon: Globe },
}

export function SourceTypeBadge({ type, className }: { type: SourceType; className?: string }) {
  const t = TYPES[type] ?? TYPES.other
  const Icon = t.icon
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        type === "official" && "border-primary/30 bg-primary/5 text-foreground",
        className,
      )}
    >
      <Icon className={cn("size-3", type === "official" && "text-primary")} aria-hidden />
      {t.label}
    </span>
  )
}
