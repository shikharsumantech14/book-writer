"use client"

import type { ReactNode } from "react"

import { compact, duration, pct, usd } from "@/lib/format"
import type { RunView } from "@/lib/run-state"
import type { Timeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"

/** Cumulative spend over the run, as a small area line (single series, no axes). */
export function Sparkline({ points, total }: { points: Timeline["spend"]; total: number }) {
  const w = 132
  const h = 34
  if (points.length < 2) return <svg width={w} height={h} aria-hidden />
  const maxT = points[points.length - 1].at || 1
  const maxC = Math.max(total, points[points.length - 1].cost) || 1
  const xy = points.map((p) => [(p.at / maxT) * (w - 2) + 1, h - 2 - (p.cost / maxC) * (h - 6)])
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const [lx, ly] = xy[xy.length - 1]
  return (
    <svg width={w} height={h} aria-label="Spend over time">
      <path d={`${line} L ${lx} ${h} L 1 ${h} Z`} style={{ fill: "color-mix(in oklab, var(--console-accent) 14%, transparent)" }} />
      <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: "var(--console-accent)" }} />
      <circle cx={lx} cy={ly} r={3.5} strokeWidth={2} style={{ fill: "var(--console-accent)", stroke: "var(--card)" }} />
    </svg>
  )
}

function Metric({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="hud-label">{label}</div>
      <div className="flex items-end gap-3">
        <div className="font-mono text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</div>
        {children}
      </div>
      {hint && <div className="truncate font-mono text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function progressOf(view: RunView): number {
  const lanes = Object.values(view.chapters)
  const chapters = lanes.length
    ? lanes.reduce((sum, l) => {
        if (l.done) return sum + 1
        const steps = [l.evidence > 0, l.writerPasses > 0, l.editorReviews > 0, l.factChecks > 0].filter(Boolean).length
        return sum + steps / 5
      }, 0) / lanes.length
    : 0
  return Math.min(1, (view.outline ? 0.1 : 0) + chapters * 0.8 + (view.words != null ? 0.1 : 0))
}

export type Mode = { kind: "live" } | { kind: "replay"; speed: number } | { kind: "recorded" }

export function Hud({
  view,
  timeline,
  mode,
  controls,
}: {
  view: RunView
  timeline: Timeline
  mode: Mode
  controls: ReactNode
}) {
  const prompt = view.tokens.input + view.tokens.cacheRead + view.tokens.cacheWrite
  const lanes = Object.values(view.chapters)
  const done = lanes.filter((l) => l.done).length
  const progress = progressOf(view)
  const elapsed = view.startedTs && view.lastTs ? view.lastTs - view.startedTs : null
  const capShare = view.maxCost ? Math.min(1, view.cost / view.maxCost) : 0

  const badge =
    mode.kind === "live" && !view.finished ? (
      <span className="inline-flex items-center gap-2 text-[var(--console-live)]">
        <span className="size-2.5 animate-blink rounded-full bg-[var(--console-live)]" /> LIVE
      </span>
    ) : mode.kind === "replay" && !view.finished ? (
      <span className="inline-flex items-center gap-2 text-[var(--console-accent)]">
        <span className="size-2.5 animate-blink rounded-full bg-[var(--console-accent)]" /> REPLAY · {mode.speed}×
      </span>
    ) : (
      <span className={cn("inline-flex items-center gap-2", view.status === "completed" ? "text-good" : "text-warning")}>
        <span className={cn("size-2.5 rounded-full", view.status === "completed" ? "bg-good" : "bg-warning")} />
        {view.status === "connecting" ? "LOADING" : view.status.replace("_", " ").toUpperCase()}
      </span>
    )

  return (
    <div className="console-panel space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 font-mono text-sm font-semibold tracking-[0.12em]">
          {badge}
          {view.profile && <span className="hud-label rounded border border-[var(--console-line)] px-1.5 py-0.5">{view.profile} profile</span>}
          {view.awaitingReview && <span className="hud-label animate-blink text-warning">waiting for your review</span>}
        </div>
        <div className="flex items-center gap-2">{controls}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Elapsed" value={duration(elapsed)} hint={`${done}/${lanes.length || "–"} chapters done`} />
        <Metric
          label="Spend"
          value={usd(view.cost, 3)}
          hint={
            view.maxCost ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-[var(--console-line)]">
                  <span className="block h-full rounded-full bg-[var(--console-accent)]" style={{ width: `${capShare * 100}%` }} />
                </span>
                cap {usd(view.maxCost)}
              </span>
            ) : undefined
          }
        >
          <Sparkline points={timeline.spend} total={view.cost} />
        </Metric>
        <Metric label="Model calls" value={view.calls} hint={`${compact(view.tokens.output)} tokens written`} />
        <Metric label="Prompt tokens" value={compact(prompt)} hint={`${pct(prompt ? view.tokens.cacheRead / prompt : null)} from cache`} />
        <Metric label="Web searches" value={view.searches} hint="Tavily, official sites first" />
        <Metric label="Book" value={view.words != null ? `${view.words.toLocaleString()} w` : "—"} hint={view.words != null ? "assembled" : "not assembled yet"} />
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          <span>Progress</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--console-line)]">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{
              width: `${progress * 100}%`,
              background: "linear-gradient(90deg, var(--agent-planner), var(--agent-writer), var(--console-accent))",
              boxShadow: "0 0 12px color-mix(in oklab, var(--console-accent) 60%, transparent)",
            }}
          />
        </div>
      </div>
    </div>
  )
}
