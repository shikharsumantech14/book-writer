"use client"

import { CircleCheck } from "lucide-react"

import { AgentChip } from "@/components/agent-chip"
import { StatusBadge } from "@/components/status-badge"
import { agent } from "@/lib/agents"
import { usd } from "@/lib/format"
import { CHAPTER_STAGES, type ChapterLane, type RunView } from "@/lib/run-state"
import { cn } from "@/lib/utils"

function Counter({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="rounded-lg border border-[var(--console-line)] bg-background/40 px-2.5 py-1.5">
      <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="font-mono text-base font-semibold tabular-nums">
        {value}
        {of != null && <span className="font-normal text-muted-foreground"> / {of}</span>}
      </div>
    </div>
  )
}

function Stages({ lane }: { lane: ChapterLane }) {
  const current = lane.stage ? CHAPTER_STAGES.indexOf(lane.stage as (typeof CHAPTER_STAGES)[number]) : -1
  return (
    <ol className="flex items-center gap-1" aria-label="Stages">
      {CHAPTER_STAGES.map((stage, i) => {
        const a = agent(stage)
        const done = lane.done || current > i
        const here = !lane.done && current === i
        return (
          <li key={stage} className="flex flex-1 flex-col items-center gap-1" title={a.label}>
            <span
              className={cn("h-1.5 w-full rounded-full bg-muted transition-colors", here && "animate-pulse")}
              style={{ background: here || done ? a.color : undefined, opacity: done && !here ? 0.55 : 1 }}
            />
            <span className={cn("text-[10px] text-muted-foreground", here && "font-semibold text-foreground")}>
              {a.label.replace("Fact-checker", "Facts").replace("Safety net", "Safety")}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ChapterLanes({ view, maxPasses }: { view: RunView; maxPasses: number }) {
  const lanes = Object.values(view.chapters).sort((a, b) => a.number - b.number)
  if (!lanes.length) return null
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {lanes.map((lane) => (
        <div key={lane.number} className="console-panel flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="hud-label">Chapter {lane.number}</div>
              <div className="line-clamp-2 leading-snug font-semibold">{lane.title ?? "Waiting for the outline…"}</div>
            </div>
            {lane.done ? (
              <StatusBadge status={lane.status ?? "ok"} />
            ) : lane.stage ? (
              <AgentChip name={lane.stage} className="shrink-0 text-xs" />
            ) : null}
          </div>
          <Stages lane={lane} />
          <div className="grid grid-cols-4 gap-2">
            <Counter label="Writer passes" value={lane.writerPasses} of={maxPasses} />
            <Counter label="Editor reviews" value={lane.editorReviews} />
            <Counter label="Fact-checks" value={lane.factChecks} />
            <Counter label="Evidence" value={lane.evidence} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {lane.editorApproved && (
              <span className="inline-flex items-center gap-1">
                <CircleCheck className="size-3.5 text-good" /> Editor approved
              </span>
            )}
            {lane.factPassed && (
              <span className="inline-flex items-center gap-1">
                <CircleCheck className="size-3.5 text-good" /> Facts verified
              </span>
            )}
            {lane.gapRounds > 0 && <span>{lane.gapRounds} gap research round(s)</span>}
            {lane.removed > 0 && <span>{lane.removed} sentence(s) removed by the safety net</span>}
            <span className="ml-auto tabular">{usd(lane.cost, 3)}</span>
          </div>
          {lane.last && (
            <p className="line-clamp-2 border-t border-[var(--console-line)] pt-2 text-xs text-muted-foreground">
              {lane.last.replace(/\s+/g, " ")}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
