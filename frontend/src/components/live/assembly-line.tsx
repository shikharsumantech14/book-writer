"use client"

// The agent flow as an assembly line: one lane per chapter, the chapter agents as stations
// along it, the book-level agents at both ends. Which stations exist and which loops are
// possible come from GET /graph (the LangGraph graph); everything that lights up comes from
// the run's events.

import { Check, TriangleAlert } from "lucide-react"
import { Fragment } from "react"

import { agent } from "@/lib/agents"
import type { GraphData } from "@/lib/api"
import { CHAPTER_STAGES, type ChapterLane, type RunView } from "@/lib/run-state"

const W = 1330
const R = 24 // station radius
const TOP = 128
const LANE_H = 164
const STATION_X = (j: number) => 372 + j * 132
const PILL = { x: 216, w: 92, h: 30 }
const LEFT_X = 150
const CHIEF_X = 1160
const BOOK_X = 1270
const FLASH_MS = 2600

const SHORT: Record<string, string> = {
  researcher: "Research",
  writer: "Write",
  lint: "Lint",
  editor: "Edit",
  fact_checker: "Fact-check",
  safety_net: "Safety net",
  planner: "Planner",
  outline_review: "Outline review",
  chief_editor: "Chief Editor",
  assembler: "Book",
}

type StationState = "idle" | "done" | "active" | "off"

function Station({
  x,
  y,
  name,
  state,
  count,
  title,
  labelLeft = false,
}: {
  x: number
  y: number
  name: string
  state: StationState
  count?: number
  title: string
  labelLeft?: boolean
}) {
  const a = agent(name)
  const Icon = a.icon
  const lit = state === "done" || state === "active"
  return (
    <g>
      <title>{title}</title>
      {state === "active" && (
        <>
          <circle
            cx={x}
            cy={y}
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={2}
            className="animate-station-ping"
            style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" }}
          />
          <circle
            cx={x}
            cy={y}
            r={R + 7}
            fill="none"
            stroke={a.color}
            strokeWidth={1.2}
            strokeDasharray="3 5"
            className="animate-spin-slow"
            style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box", opacity: 0.7 }}
          />
        </>
      )}
      <circle
        cx={x}
        cy={y}
        r={R}
        style={{
          fill: lit ? `color-mix(in oklab, ${a.color} 22%, var(--card))` : "var(--card)",
          stroke: lit ? a.color : "var(--console-line)",
          filter: state === "active" ? `drop-shadow(0 0 10px ${a.color})` : undefined,
          transition: "fill 400ms, stroke 400ms",
        }}
        strokeWidth={state === "active" ? 2 : 1.4}
        strokeDasharray={state === "off" ? "4 4" : undefined}
      />
      <Icon
        x={x - 10}
        y={y - 10}
        width={20}
        height={20}
        style={{ color: lit ? a.color : "var(--muted-foreground)", opacity: state === "idle" || state === "off" ? 0.55 : 1 }}
      />
      {count ? (
        <g>
          <circle cx={x + R - 2} cy={y - R + 2} r={10} style={{ fill: "var(--background)", stroke: a.color }} strokeWidth={1.2} />
          <text
            x={x + R - 2}
            y={y - R + 6}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fontFamily="var(--font-mono)"
            style={{ fill: "var(--foreground)" }}
          >
            {count}
          </text>
        </g>
      ) : null}
      <text
        x={labelLeft ? x - R - 12 : x}
        y={labelLeft ? y + (state === "off" ? -1 : 4) : y + R + 18}
        textAnchor={labelLeft ? "end" : "middle"}
        fontSize={12.5}
        fontWeight={state === "active" ? 600 : 500}
        style={{ fill: state === "active" ? "var(--foreground)" : "var(--muted-foreground)" }}
      >
        {SHORT[name] ?? a.label}
      </text>
      {state === "off" && (
        <text
          x={labelLeft ? x - R - 12 : x}
          y={labelLeft ? y + 14 : y + R + 32}
          textAnchor={labelLeft ? "end" : "middle"}
          fontSize={10.5}
          fontFamily="var(--font-mono)"
          style={{ fill: "var(--muted-foreground)", opacity: 0.75 }}
        >
          OFF THIS RUN
        </text>
      )}
    </g>
  )
}

function reached(lane: ChapterLane): number {
  if (lane.done) return CHAPTER_STAGES.length - 1
  const counts = [
    lane.evidence > 0 || lane.writerPasses > 0,
    lane.writerPasses > 0,
    lane.lintFails > 0 || lane.editorReviews > 0 || lane.factChecks > 0,
    lane.editorReviews > 0,
    lane.factChecks > 0,
    false,
  ]
  const current = lane.stage ? CHAPTER_STAGES.indexOf(lane.stage as (typeof CHAPTER_STAGES)[number]) : -1
  return Math.max(current, counts.lastIndexOf(true))
}

function stationCount(lane: ChapterLane, name: string): number | undefined {
  const value = {
    researcher: lane.evidence,
    writer: lane.writerPasses,
    editor: lane.editorReviews,
    fact_checker: lane.factChecks,
  }[name]
  return value || undefined
}

export function AssemblyLine({
  graph,
  view,
  now,
  animate,
}: {
  graph: GraphData
  view: RunView
  now: number
  animate: boolean
}) {
  // Stations and possible loops, from the LangGraph graph.
  const present = new Set(graph.nodes.map((n) => n.id))
  const stages = CHAPTER_STAGES.filter((s) => present.has(`chapter:${s}`))
  const index = (id: string) => stages.indexOf(id.replace("chapter:", "") as (typeof stages)[number])
  const loops = graph.edges.filter(
    (e) => e.conditional && e.source.startsWith("chapter:") && e.target.startsWith("chapter:") && index(e.target) < index(e.source),
  )

  const lanes = Math.max(1, view.chapterCount || view.outline?.chapters.length || 3)
  const laneY = (i: number) => TOP + i * LANE_H
  const midY = TOP + ((lanes - 1) * LANE_H) / 2
  const plannerY = Math.max(64, midY - 66)
  const reviewY = plannerY + 132
  const height = Math.max(TOP + (lanes - 1) * LANE_H + 80, reviewY + 64)
  const routing = view.routing ?? {}
  const modelOf = (role: string) => {
    const r = routing[role]
    return r ? ` · ${r.model.replace("claude-", "")}${r.effort ? ` (${r.effort})` : ""}` : ""
  }

  const chaptersStarted = Object.values(view.chapters).some((l) => l.writerPasses > 0 || l.evidence > 0 || l.stage)
  const bookDone = view.words != null
  const plannerState: StationState = view.bookNode === "planner" ? "active" : view.outline ? "done" : "idle"
  const reviewState: StationState = !view.humanReview
    ? "off"
    : view.awaitingReview
      ? "active"
      : chaptersStarted
        ? "done"
        : "idle"
  const chiefState: StationState = view.bookNode === "chief_editor" ? "active" : bookDone ? "done" : "idle"
  const lineDim = "var(--console-line)"
  const lineLit = "color-mix(in oklab, var(--console-accent) 70%, transparent)"

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label="Agents at work, one lane per chapter">
      <defs>
        {["lint", "editor", "fact_checker"].map((r) => (
          <marker key={r} id={`arrow-${r}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: agent(r).color }} />
          </marker>
        ))}
      </defs>

      {/* book level: planner and outline review */}
      <line x1={LEFT_X} y1={plannerY + R} x2={LEFT_X} y2={reviewY - R} stroke={view.outline ? lineLit : lineDim} strokeWidth={2} />
      {Array.from({ length: lanes }, (_, i) => {
        const y = laneY(i)
        const lit = chaptersStarted
        return (
          <path
            key={`fan-out-${i}`}
            d={`M ${LEFT_X + R} ${reviewY} C ${LEFT_X + 70} ${reviewY}, ${PILL.x - 50} ${y}, ${PILL.x} ${y}`}
            fill="none"
            stroke={lit ? lineLit : lineDim}
            strokeWidth={2}
          />
        )
      })}

      {/* chapter lanes */}
      {Array.from({ length: lanes }, (_, i) => {
        const n = i + 1
        const y = laneY(i)
        const lane = view.chapters[n]
        const far = lane ? reached(lane) : -1
        const lastX = STATION_X(stages.length - 1)
        const litTo = far >= 0 ? STATION_X(far) : PILL.x + PILL.w
        const status = lane?.done ? (lane.status === "ok" ? "ok" : "warn") : lane?.stage ? "live" : "idle"
        const sendBacks = view.sendBacks.filter((s) => s.chapter === n)
        return (
          <g key={`lane-${n}`}>
            {/* rail, then the part already travelled */}
            <line x1={PILL.x + PILL.w} y1={y} x2={lastX} y2={y} stroke={lineDim} strokeWidth={2} />
            <line
              x1={PILL.x + PILL.w}
              y1={y}
              x2={litTo}
              y2={y}
              stroke={lineLit}
              strokeWidth={2.5}
              style={{ transition: "x2 700ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
            />
            <path
              d={`M ${lastX + R} ${y} C ${lastX + 70} ${y}, ${CHIEF_X - 70} ${midY}, ${CHIEF_X - R} ${midY}`}
              fill="none"
              stroke={lane?.done ? lineLit : lineDim}
              strokeWidth={2}
            />

            {/* lane label */}
            <rect
              x={PILL.x}
              y={y - PILL.h / 2}
              width={PILL.w}
              height={PILL.h}
              rx={PILL.h / 2}
              style={{
                fill: "var(--card)",
                stroke: status === "live" ? "var(--console-accent)" : "var(--console-line)",
              }}
            />
            <text
              x={PILL.x + 16}
              y={y + 5}
              fontSize={13}
              fontWeight={600}
              fontFamily="var(--font-mono)"
              style={{ fill: "var(--foreground)" }}
            >
              CH {n}
            </text>
            {status === "live" && (
              <circle cx={PILL.x + PILL.w - 18} cy={y} r={4.5} className="animate-blink" style={{ fill: "var(--console-accent)" }} />
            )}
            {status === "ok" && <Check x={PILL.x + PILL.w - 26} y={y - 8} width={16} height={16} style={{ color: "var(--status-good)" }} />}
            {status === "warn" && (
              <TriangleAlert x={PILL.x + PILL.w - 26} y={y - 8} width={16} height={16} style={{ color: "var(--status-warning)" }} />
            )}

            {/* send-back loops that actually happened */}
            {loops.map((loop) => {
              const fired = sendBacks.filter((s) => s.from === loop.source && s.to === loop.target)
              if (!fired.length) return null
              const from = loop.source.replace("chapter:", "")
              const xf = STATION_X(index(loop.source))
              const xt = STATION_X(index(loop.target))
              const span = index(loop.source) - index(loop.target)
              const lift = 18 + span * 26
              // Arrows from different reviewers land side by side on the station rim, clear of the count badge.
              const dx = -13 + (span - 1) * 11
              const land = xt + dx
              const landY = y - Math.sqrt(R * R - dx * dx) - 2
              const recent = animate && fired.some((s) => now - s.receivedAt < FLASH_MS)
              const color = agent(from).color
              const apexX = (xf + land) / 2
              const apexY = y - R - lift * 0.75
              return (
                <g key={`${n}-${loop.source}-${loop.target}`}>
                  <path
                    d={`M ${xf - 6} ${y - R} C ${xf - 10} ${y - R - lift}, ${land} ${y - R - lift}, ${land} ${landY}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={recent ? 2.6 : 1.6}
                    strokeOpacity={recent ? 1 : 0.6}
                    strokeDasharray={recent ? "6 3" : undefined}
                    className={recent ? "animate-dash-flow" : undefined}
                    markerEnd={`url(#arrow-${from})`}
                    style={{ filter: recent ? `drop-shadow(0 0 6px ${color})` : undefined }}
                  />
                  <g>
                    <rect x={apexX - 20} y={apexY - 10} width={40} height={19} rx={9.5} style={{ fill: "var(--background)", stroke: color }} />
                    <text
                      x={apexX}
                      y={apexY + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="var(--font-mono)"
                      style={{ fill: "var(--foreground)" }}
                    >
                      ↩ {fired.length}
                    </text>
                  </g>
                </g>
              )
            })}

            {stages.map((stage, j) => {
              const x = STATION_X(j)
              const state: StationState = !lane
                ? "idle"
                : !lane.done && lane.stage === stage
                  ? "active"
                  : far >= j
                    ? "done"
                    : "idle"
              return (
                <Fragment key={stage}>
                  <Station
                    x={x}
                    y={y}
                    name={stage}
                    state={state}
                    count={lane ? stationCount(lane, stage) : undefined}
                    title={`Chapter ${n} · ${agent(stage).label}${modelOf(stage)}`}
                  />
                </Fragment>
              )
            })}
          </g>
        )
      })}

      {/* book level: chief editor and the finished book */}
      <line x1={CHIEF_X + R} y1={midY} x2={BOOK_X - R} y2={midY} stroke={bookDone ? lineLit : lineDim} strokeWidth={2} />
      <Station x={LEFT_X} y={plannerY} name="planner" state={plannerState} title={`Planner${modelOf("planner")}`} labelLeft />
      <Station
        x={LEFT_X}
        y={reviewY}
        name="outline_review"
        state={reviewState}
        labelLeft
        title={view.humanReview ? "Outline review: a person approves or edits the outline" : "Outline review was off for this run"}
      />
      <Station x={CHIEF_X} y={midY} name="chief_editor" state={chiefState} title={`Chief Editor${modelOf("chief_editor")}`} />
      <Station x={BOOK_X} y={midY} name="assembler" state={bookDone ? "done" : "idle"} title="Assembler: numbers the citations and builds the book" />
    </svg>
  )
}
