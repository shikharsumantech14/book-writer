"use client"

import { CircleAlert, CircleCheck, CornerUpLeft } from "lucide-react"
import { useMemo, useState } from "react"

import { AgentIcon } from "@/components/agent-chip"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { agent } from "@/lib/agents"
import { clock, usd } from "@/lib/format"
import { STORY_KINDS, type TimedEvent } from "@/lib/run-state"
import { cn } from "@/lib/utils"

const MAX_ROWS = 300

function Outcome({ e }: { e: TimedEvent }) {
  if (e.kind === "review") {
    return e.data?.approved ? (
      <CircleCheck className="size-3.5 shrink-0 text-good" aria-label="passed" />
    ) : (
      <CornerUpLeft className="size-3.5 shrink-0 text-warning" aria-label="sent back" />
    )
  }
  if (["evidence_rejected", "link_broken", "tool_error", "warning", "safety_net"].includes(e.kind)) {
    return <CircleAlert className="size-3.5 shrink-0 text-serious" aria-label="attention" />
  }
  return null
}

export function ActivityFeed({ events }: { events: TimedEvent[] }) {
  const [all, setAll] = useState(false)
  const rows = useMemo(() => {
    const shown = all ? events : events.filter((e) => STORY_KINDS.has(e.kind))
    return shown.slice(-MAX_ROWS).reverse()
  }, [events, all])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="all-events" className="text-xs font-normal text-muted-foreground">
            Model and tool calls
          </Label>
          <Switch id="all-events" checked={all} onCheckedChange={setAll} />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="divide-y">
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Waiting…</li>}
          {rows.map((e) => {
            const call = e.kind === "llm_call" || e.kind === "tool_call"
            return (
              <li key={e.seq} className={cn("flex gap-2.5 px-4 py-2 animate-fade-in", call && "bg-muted/30")}>
                <AgentIcon name={e.agent} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="tabular font-mono">{clock(e.ts)}</span>
                    <span>·</span>
                    <span className="font-medium text-foreground/80">{agent(e.agent).label}</span>
                    {e.chapter && <span className="rounded bg-muted px-1 font-medium">Ch {e.chapter}</span>}
                    {e.kind === "llm_call" && <span className="ml-auto tabular">{usd(e.data?.cost_usd, 4)}</span>}
                  </div>
                  <div className={cn("flex items-start gap-1.5 text-sm leading-snug", call && "text-xs text-muted-foreground")}>
                    <Outcome e={e} />
                    <span className="line-clamp-3 break-words">{e.message}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </ScrollArea>
    </div>
  )
}
