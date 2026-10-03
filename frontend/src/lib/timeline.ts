// Turn a run's events into a timeline: when each agent worked on each chapter, where
// reviewers sent work back, and how the spend grew. Pure, like run-state.ts.

import type { TimedEvent } from "./run-state"

export interface Segment {
  row: string // "book" or a chapter number
  agent: string
  start: number // seconds since the run started
  end: number
  waiting?: boolean // the run was paused for a person
}

export interface Marker {
  row: string
  at: number
  agent: string
  kind: "sent_back" | "passed" | "done"
  label: string
}

export interface Timeline {
  duration: number // seconds
  rows: string[]
  segments: Segment[]
  markers: Marker[]
  spend: { at: number; cost: number }[] // cumulative cost after each model call
}

const INSTANT = 0.6 // seconds shown for steps that are pure code and take no real time

export function buildTimeline(events: TimedEvent[]): Timeline {
  const t0 = events.find((e) => e.kind === "run_start")?.ts ?? events[0]?.ts ?? 0
  const end = events.length ? events[events.length - 1].ts - t0 : 0
  const open = new Map<string, Segment>()
  const segments: Segment[] = []
  const markers: Marker[] = []
  const spend: Timeline["spend"] = []
  const rows = new Set<string>(["book"])
  let cost = 0

  const last = new Map<string, Segment>() // the latest finished turn in each row
  const settle = (row: string, at: number) => {
    // A code step is drawn with a small width; trim it if the next turn starts sooner.
    const prev = last.get(row)
    if (prev && prev.end > at) prev.end = Math.max(at, prev.start)
  }
  const close = (row: string, at: number) => {
    const seg = open.get(row)
    if (seg) {
      seg.end = Math.max(at, seg.start)
      segments.push(seg)
      last.set(row, seg)
      open.delete(row)
    }
  }
  const begin = (row: string, agent: string, at: number, waiting = false) => {
    close(row, at)
    settle(row, at)
    open.set(row, { row, agent, start: at, end: at, waiting })
  }
  const instant = (row: string, agent: string, at: number) => {
    close(row, at)
    settle(row, at)
    const seg = { row, agent, start: at, end: at + INSTANT }
    segments.push(seg)
    last.set(row, seg)
  }

  for (const e of events) {
    const at = e.ts - t0
    const row = e.chapter ? String(e.chapter) : "book"
    const d = e.data ?? {}
    if (e.chapter) rows.add(row)
    switch (e.kind) {
      case "run_start":
        for (let n = 1; n <= (d.chapters ?? 0); n++) rows.add(String(n))
        break
      case "llm_call":
        cost += d.cost_usd ?? 0
        spend.push({ at, cost })
        break
      case "agent_start":
        if (e.agent) begin(row, e.agent === "claim_tagger" ? "fact_checker" : e.agent, at)
        break
      case "agent_done":
        if (!e.chapter && e.agent === "planner" && open.get("book")?.agent === "planner") close("book", at)
        break
      case "review_requested":
        begin("book", "outline_review", at, true)
        break
      case "review_done":
        close("book", at)
        break
      case "review":
        if (!e.agent) break
        if (!e.chapter) {
          close(row, at) // the Chief Editor's verdict ends its turn
          break
        }
        if (e.agent === "lint") instant(row, "lint", at)
        markers.push({
          row,
          at,
          agent: e.agent,
          kind: d.approved ? "passed" : "sent_back",
          label: e.message,
        })
        break
      case "chapter_done":
        instant(row, "safety_net", at)
        markers.push({ row, at, agent: "safety_net", kind: "done", label: e.message })
        break
      case "book_ready":
        instant("book", "assembler", at)
        break
    }
  }
  for (const row of [...open.keys()]) close(row, end)

  const ordered = ["book", ...[...rows].filter((r) => r !== "book").sort((a, b) => Number(a) - Number(b))]
  return {
    duration: Math.max(end, ...segments.map((s) => s.end)),
    rows: ordered,
    segments,
    markers,
    spend,
  }
}
