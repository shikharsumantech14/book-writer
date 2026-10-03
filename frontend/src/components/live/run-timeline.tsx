"use client"

// When each agent worked on each chapter: one row per chapter (plus the book), a bar per
// turn in the agent's colour, a mark wherever a reviewer sent the work back.

import { useState } from "react"

import { AgentDot } from "@/components/agent-chip"
import { agent } from "@/lib/agents"
import type { Timeline } from "@/lib/timeline"

const W = 1280
const LABEL = 76
const RIGHT = 16
const ROW = 38
const BAR = 18
const AXIS = 26

function tickStep(duration: number): number {
  return [10, 15, 30, 60, 120, 300, 600].find((s) => duration / s <= 10) ?? 900
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

interface Hover {
  x: number
  y: number
  title: string
  detail: string
}

export function RunTimeline({ timeline, live }: { timeline: Timeline; live: boolean }) {
  const [hover, setHover] = useState<Hover | null>(null)
  const duration = Math.max(timeline.duration, 1)
  const height = AXIS + timeline.rows.length * ROW + 8
  const sx = (t: number) => LABEL + (t / duration) * (W - LABEL - RIGHT)
  const rowY = (row: string) => AXIS + timeline.rows.indexOf(row) * ROW + (ROW - BAR) / 2
  const step = tickStep(duration)
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step)
  const agents = [...new Set(timeline.segments.map((s) => s.agent))]

  return (
    <div className="space-y-3">
      {/* only the chart scrolls sideways on narrow screens; the legend wraps below it */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="relative min-w-[640px]">
          <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
            <defs>
              <pattern id="waiting" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" style={{ fill: "color-mix(in oklab, var(--agent-human) 25%, transparent)" }} />
                <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2.5" style={{ stroke: "var(--agent-human)" }} />
              </pattern>
            </defs>
  
            {ticks.map((t) => (
              <g key={t}>
                <line x1={sx(t)} y1={AXIS - 6} x2={sx(t)} y2={height - 6} style={{ stroke: "var(--console-grid, var(--grid))" }} />
                <text x={sx(t)} y={AXIS - 10} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" style={{ fill: "var(--muted-foreground)" }}>
                  {mmss(t)}
                </text>
              </g>
            ))}
  
            {timeline.rows.map((row) => (
              <g key={row}>
                <text x={8} y={rowY(row) + BAR / 2 + 4} fontSize={12} fontWeight={600} fontFamily="var(--font-mono)" style={{ fill: "var(--muted-foreground)" }}>
                  {row === "book" ? "BOOK" : `CH ${row}`}
                </text>
                <line x1={LABEL} y1={rowY(row) + BAR / 2} x2={W - RIGHT} y2={rowY(row) + BAR / 2} style={{ stroke: "var(--console-line, var(--border))" }} strokeDasharray="2 4" />
              </g>
            ))}
  
            {timeline.segments.map((seg, i) => {
              const x = sx(seg.start)
              const w = Math.max(3, sx(seg.end) - x - 1.5) // 1.5: a hairline gap between neighbouring turns
              const y = rowY(seg.row)
              const a = agent(seg.agent)
              const secs = seg.end - seg.start
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={w}
                  height={BAR}
                  rx={4}
                  style={{ fill: seg.waiting ? "url(#waiting)" : a.color, opacity: hover && hover.title !== `${a.label}` ? 0.85 : 1 }}
                  onMouseEnter={() =>
                    setHover({
                      x: x + w / 2,
                      y,
                      title: seg.waiting ? "Waiting for a person" : a.label,
                      detail: `${seg.row === "book" ? "Book" : `Chapter ${seg.row}`} · ${mmss(seg.start)} to ${mmss(seg.end)} · ${secs < 1 ? "<1" : Math.round(secs)}s`,
                    })
                  }
                />
              )
            })}
  
            {timeline.markers
              .filter((m) => m.kind === "sent_back")
              .map((m, i) => {
                const x = sx(m.at)
                const y = rowY(m.row) - 3
                return (
                  <path
                    key={i}
                    d={`M ${x - 5} ${y - 7} L ${x + 5} ${y - 7} L ${x} ${y} Z`}
                    style={{ fill: "var(--status-warning)", stroke: "var(--background)" }}
                    strokeWidth={1}
                    onMouseEnter={() => setHover({ x, y: y - 8, title: `Sent back by the ${agent(m.agent).label}`, detail: m.label.slice(0, 120) })}
                  />
                )
              })}
  
            {live && (
              <line x1={sx(duration)} y1={AXIS - 4} x2={sx(duration)} y2={height - 4} strokeWidth={1.5} style={{ stroke: "var(--console-accent, var(--primary))" }} />
            )}
          </svg>
  
          {hover && (
            <div
              className="pointer-events-none absolute z-10 w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{ left: `${(hover.x / W) * 100}%`, top: `calc(${(hover.y / height) * 100}% - 6px)` }}
            >
              <div className="font-medium">{hover.title}</div>
              <div className="text-muted-foreground">{hover.detail}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {agents.map((name) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            {name === "outline_review" ? (
              <span className="inline-block size-2.5 rounded-full border border-dashed" style={{ borderColor: "var(--agent-human)" }} />
            ) : (
              <AgentDot name={name} />
            )}
            {name === "outline_review" ? "Waiting for you" : agent(name).label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-0 border-x-[5px] border-t-[7px] border-x-transparent" style={{ borderTopColor: "var(--status-warning)" }} />
          Sent back
        </span>
      </div>
    </div>
  )
}
