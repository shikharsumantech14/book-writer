import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  WalletCards,
} from "lucide-react"

import { cn } from "@/lib/utils"

type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "active"

const STATUS: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  connecting: { label: "Connecting", icon: LoaderCircle, tone: "active" },
  running: { label: "Running", icon: LoaderCircle, tone: "active" },
  awaiting_review: { label: "Waiting for review", icon: Hourglass, tone: "warning" },
  completed: { label: "Completed", icon: CircleCheck, tone: "good" },
  stopped_budget: { label: "Cost cap reached", icon: WalletCards, tone: "serious" },
  cancelled: { label: "Cancelled", icon: CircleSlash, tone: "neutral" },
  failed: { label: "Failed", icon: CircleX, tone: "critical" },
  interrupted: { label: "Interrupted", icon: CircleDashed, tone: "serious" },
  ok: { label: "Passed", icon: CircleCheck, tone: "good" },
  shipped_with_warnings: { label: "With warnings", icon: CircleAlert, tone: "warning" },
}

const TONE: Record<Tone, string> = {
  good: "text-good",
  warning: "text-warning",
  serious: "text-serious",
  critical: "text-critical",
  neutral: "text-muted-foreground",
  active: "text-primary",
}

/** Status is never colour alone: an icon in the status colour, and a label in ink. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, icon: CircleDashed, tone: "neutral" as Tone }
  const Icon = s.icon
  const spinning = status === "running" || status === "connecting"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon className={cn("size-3.5", TONE[s.tone], spinning && "animate-spin")} aria-hidden />
      {s.label}
    </span>
  )
}

export function PassMark({ passed, label }: { passed: boolean | null | undefined; label?: string }) {
  if (passed == null) return <span className="text-muted-foreground">—</span>
  const Icon = passed ? CircleCheck : CircleX
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className={cn("size-4", passed ? "text-good" : "text-critical")} aria-hidden />
      {label ?? (passed ? "Passed" : "Failed")}
    </span>
  )
}
