// Fold a run's event stream into what the live view shows. Pure: the same events
// always give the same view, whether they arrive live, all at once, or as a replay.

import { type Outline, type RunEvent, type RunStatus } from "./api"
import { nodeOf } from "./agents"

export const CHAPTER_STAGES = ["researcher", "writer", "lint", "editor", "fact_checker", "safety_net"] as const

export interface ChapterLane {
  number: number
  title: string | null
  node: string | null // current graph node, e.g. "chapter:editor"
  stage: string | null // current agent, e.g. "editor"
  done: boolean
  status: string | null // "ok" | "shipped_with_warnings" once done
  writerPasses: number
  lintFails: number
  editorReviews: number
  editorApproved: boolean
  factChecks: number
  factPassed: boolean
  evidence: number
  gapRounds: number
  missing: string[]
  removed: number
  warnings: string[]
  cost: number
  last: string | null
}

export interface SendBack {
  seq: number
  receivedAt: number
  chapter: number
  from: string // graph node ids
  to: string
}

export interface RunView {
  status: RunStatus | "connecting"
  profile: string | null
  chapterCount: number
  startedTs: number | null
  lastTs: number | null
  maxCost: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routing: Record<string, any> | null
  bookNode: string | null // active book-level node
  outline: Outline | null
  awaitingReview: Outline | null
  chapters: Record<number, ChapterLane>
  cost: number
  calls: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  costByAgent: Record<string, number>
  searches: number
  sendBacks: SendBack[]
  words: number | null
  error: string | null
  finished: boolean
}

export interface TimedEvent extends RunEvent {
  receivedAt: number // wall clock, ms, when the browser got it
}

function lane(view: RunView, n: number): ChapterLane {
  view.chapters[n] ??= {
    number: n,
    title: view.outline?.chapters.find((c) => c.number === n)?.title ?? null,
    node: null,
    stage: null,
    done: false,
    status: null,
    writerPasses: 0,
    lintFails: 0,
    editorReviews: 0,
    editorApproved: false,
    factChecks: 0,
    factPassed: false,
    evidence: 0,
    gapRounds: 0,
    missing: [],
    removed: 0,
    warnings: [],
    cost: 0,
    last: null,
  }
  return view.chapters[n]
}

export function emptyView(): RunView {
  return {
    status: "connecting",
    profile: null,
    chapterCount: 0,
    startedTs: null,
    lastTs: null,
    maxCost: null,
    routing: null,
    bookNode: null,
    outline: null,
    awaitingReview: null,
    chapters: {},
    cost: 0,
    calls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costByAgent: {},
    searches: 0,
    sendBacks: [],
    words: null,
    error: null,
    finished: false,
  }
}

export function reduceRun(events: TimedEvent[]): RunView {
  const view = emptyView()
  for (const e of events) apply(view, e)
  return view
}

function apply(view: RunView, e: TimedEvent): void {
  const d = e.data ?? {}
  view.lastTs = e.ts
  const ch = e.chapter ? lane(view, e.chapter) : null

  switch (e.kind) {
    case "run_start":
      view.status = "running"
      view.profile = d.profile ?? null
      view.chapterCount = d.chapters ?? 0
      view.startedTs = e.ts
      view.maxCost = d.max_cost_usd ?? null
      view.routing = d.routing ?? null
      for (let n = 1; n <= view.chapterCount; n++) lane(view, n)
      return
    case "llm_call":
      view.cost += d.cost_usd ?? 0
      view.calls += 1
      view.tokens.input += d.input_tokens ?? 0
      view.tokens.output += d.output_tokens ?? 0
      view.tokens.cacheRead += d.cache_read_tokens ?? 0
      view.tokens.cacheWrite += d.cache_write_tokens ?? 0
      if (e.agent) view.costByAgent[e.agent] = (view.costByAgent[e.agent] ?? 0) + (d.cost_usd ?? 0)
      if (ch) ch.cost += d.cost_usd ?? 0
      return
    case "tool_call":
      if (d.tool === "web_search") view.searches += 1
      return
    case "agent_start":
      if (ch && e.agent) {
        ch.stage = e.agent === "claim_tagger" ? "fact_checker" : e.agent
        ch.node = nodeOf(e.agent, e.chapter)
        ch.last = e.message
        if (e.agent === "writer") ch.writerPasses += 1
        if (e.agent === "researcher" && e.message.startsWith("Gap")) {
          ch.gapRounds += 1
          view.sendBacks.push({
            seq: e.seq,
            receivedAt: e.receivedAt,
            chapter: ch.number,
            from: nodeOf("fact_checker", ch.number),
            to: nodeOf("researcher", ch.number),
          })
        }
      } else if (e.agent) {
        view.bookNode = e.agent
      }
      return
    case "agent_done":
      if (!ch && view.bookNode === e.agent) view.bookNode = null
      if (e.agent === "planner" && d.outline) {
        view.outline = d.outline
        for (const c of view.outline!.chapters) if (view.chapters[c.number]) view.chapters[c.number].title = c.title
      }
      if (ch) ch.last = e.message
      return
    case "evidence_added":
      if (ch) ch.evidence += 1
      return
    case "coverage":
      if (ch) ch.missing = d.missing ?? []
      return
    case "review": {
      if (!ch && e.agent === view.bookNode) view.bookNode = null // the Chief Editor finished
      if (!ch || !e.agent) return
      ch.last = e.message
      const approved = Boolean(d.approved)
      if (e.agent === "lint" && !approved) ch.lintFails += 1
      if (e.agent === "editor") {
        ch.editorReviews += 1
        ch.editorApproved = approved
      }
      if (e.agent === "fact_checker") {
        ch.factChecks += 1
        ch.factPassed = approved
      }
      if (!approved) {
        view.sendBacks.push({
          seq: e.seq,
          receivedAt: e.receivedAt,
          chapter: ch.number,
          from: nodeOf(e.agent, ch.number),
          to: nodeOf("writer", ch.number),
        })
      }
      return
    }
    case "safety_net":
      if (ch) ch.removed += (d.removed ?? []).length
      return
    case "chapter_done":
      if (ch) {
        ch.done = true
        ch.status = d.status ?? null
        ch.warnings = d.warnings ?? []
        ch.stage = null
        ch.node = null
        ch.last = e.message
      }
      return
    case "review_requested":
      view.status = "awaiting_review"
      view.bookNode = "outline_review"
      view.awaitingReview = d.outline ?? null
      return
    case "review_done":
      view.status = "running"
      view.awaitingReview = null
      view.bookNode = null
      return
    case "book_ready": {
      const words = /(\d[\d,]*) words/.exec(e.message)
      view.words = words ? Number(words[1].replace(/,/g, "")) : null
      return
    }
    case "run_done":
      view.status = d.status ?? "completed"
      view.error = d.error ?? null
      view.finished = true
      view.bookNode = null
      view.awaitingReview = null
      return
  }
}

/** Which graph nodes are busy right now, and for which chapters. */
export function activeNodes(view: RunView): Map<string, number[]> {
  const active = new Map<string, number[]>()
  if (view.finished) return active
  if (view.bookNode) active.set(view.bookNode, [])
  for (const lane of Object.values(view.chapters)) {
    if (lane.node && !lane.done) active.set(lane.node, [...(active.get(lane.node) ?? []), lane.number])
  }
  return active
}

/** Kinds that read as a story in the activity feed; the rest are shown only on request. */
export const STORY_KINDS = new Set([
  "run_start",
  "agent_start",
  "agent_done",
  "evidence_rejected",
  "coverage",
  "review",
  "link_broken",
  "safety_net",
  "chapter_done",
  "review_requested",
  "review_done",
  "warning",
  "tool_error",
  "book_ready",
  "run_done",
])
