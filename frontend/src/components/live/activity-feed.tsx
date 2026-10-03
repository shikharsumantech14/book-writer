"use client"

import { CircleAlert, CircleCheck, CornerUpLeft, Flag } from "lucide-react"
import { useMemo, useState } from "react"

import { AgentIcon } from "@/components/agent-chip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { agent } from "@/lib/agents"
import { clock, usd } from "@/lib/format"
import { STORY_KINDS, type TimedEvent } from "@/lib/run-state"
import { cn } from "@/lib/utils"

const MAX_ROWS = 300

type Tone = "pass" | "back" | "alert" | "done" | null

function toneOf(e: TimedEvent): Tone {
  // Only chapter reviewers can send work back; the Chief Editor's verdict closes the book.
  if (e.kind === "review") return !e.chapter ? "done" : e.data?.approved ? "pass" : "back"
  if (e.kind === "chapter_done" || e.kind === "book_ready" || e.kind === "run_done") return "done"
  if (["evidence_rejected", "link_broken", "tool_error", "warning", "safety_net"].includes(e.kind)) return "alert"
  return null
}

const TONE: Record<Exclude<Tone, null>, { icon: typeof CircleCheck; cls: string; label: string }> = {
  pass: { icon: CircleCheck, cls: "border-good/40 bg-good/10", label: "passed" },
  back: { icon: CornerUpLeft, cls: "border-warning/40 bg-warning/10", label: "sent back" },
  alert: { icon: CircleAlert, cls: "border-serious/40 bg-serious/10", label: "attention" },
  done: { icon: Flag, cls: "border-[var(--console-accent)]/40 bg-[var(--console-accent)]/10", label: "done" },
}
const ICON_TONE: Record<Exclude<Tone, null>, string> = {
  pass: "text-good",
  back: "text-warning",
  alert: "text-serious",
  done: "text-[var(--console-accent)]",
}

export function ActivityFeed({ events, chapters }: { events: TimedEvent[]; chapters: number }) {
  const [all, setAll] = useState(false)
  const [scope, setScope] = useState<string>("all")
  const rows = useMemo(() => {
    const shown = events.filter(
      (e) =>
        (all || STORY_KINDS.has(e.kind)) &&
        (scope === "all" || (scope === "book" ? !e.chapter : String(e.chapter) === scope)),
    )
    return shown.slice(-MAX_ROWS).reverse()
  }, [events, all, scope])
  const scopes = ["all", "book", ...Array.from({ length: chapters }, (_, i) => String(i + 1))]

  return (
    <div className="console-panel flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-[var(--console-line)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="hud-label !text-[11px] !text-foreground">Activity</h2>
          <label className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            model & tool calls
            <Switch checked={all} onCheckedChange={setAll} aria-label="Show model and tool calls" />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by chapter">
          {scopes.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wide transition-colors",
                scope === s
                  ? "border-[var(--console-accent)] bg-[var(--console-accent)]/15 text-foreground"
                  : "border-[var(--console-line)] text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "ALL" : s === "book" ? "BOOK" : `CH ${s}`}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="space-y-1.5 p-3">
          {rows.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">Waiting for events…</li>}
          {rows.map((e) => {
            const tone = toneOf(e)
            const call = e.kind === "llm_call" || e.kind === "tool_call"
            const T = tone ? TONE[tone] : null
            return (
              <li
                key={e.seq}
                className={cn(
                  "flex animate-fade-in gap-2.5 rounded-lg border border-transparent px-2.5 py-2",
                  T?.cls,
                  call && "opacity-70",
                )}
              >
                <AgentIcon name={e.agent} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                    <span className="tabular-nums">{clock(e.ts)}</span>
                    <span className="text-foreground/80">{agent(e.agent).label}</span>
                    {e.chapter && <span className="rounded bg-[var(--console-line)] px-1">CH {e.chapter}</span>}
                    {T && <span className="ml-auto uppercase">{T.label}</span>}
                    {e.kind === "llm_call" && <span className="ml-auto tabular-nums">{usd(e.data?.cost_usd, 4)}</span>}
                  </div>
                  <div className={cn("flex items-start gap-1.5 text-[13px] leading-snug", call && "text-xs text-muted-foreground")}>
                    {tone && (() => {
                      const Icon = TONE[tone].icon
                      return <Icon className={cn("mt-0.5 size-3.5 shrink-0", ICON_TONE[tone])} aria-hidden />
                    })()}
                    <span className="line-clamp-3 break-words">{e.message.replace(/\s+/g, " ")}</span>
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
