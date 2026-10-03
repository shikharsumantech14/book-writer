// The dashboard folds the event stream itself; these tests hold it to the backend's own report
// for the committed sample run, so the live view and the report can never disagree.

import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { RunReport } from "./api"
import { activeNodes, reduceRun, type TimedEvent } from "./run-state"

const SAMPLE = path.resolve(process.cwd(), "../docs/sample-output")
const events: TimedEvent[] = readFileSync(path.join(SAMPLE, "events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => ({ ...JSON.parse(line), receivedAt: 0 }))
const report: RunReport & { chapters: Record<string, { status: string; rounds: Record<string, number> }> } = JSON.parse(
  readFileSync(path.join(SAMPLE, "run_report.json"), "utf8"),
)

describe("reduceRun on the committed sample run", () => {
  const view = reduceRun(events)

  it("matches the report's totals", () => {
    expect(view.finished).toBe(true)
    expect(view.status).toBe(report.status)
    expect(view.calls).toBe(report.usage.total.calls)
    expect(view.cost).toBeCloseTo(report.usage.total.cost_usd, 3)
    expect(view.tokens.cacheRead).toBe(report.usage.total.cache_read_tokens)
    expect(view.words).toBe(report.scorecard?.book.metrics.words)
  })

  it("matches every chapter's outcome and round counts", () => {
    for (const [n, chapter] of Object.entries(report.chapters)) {
      const lane = view.chapters[Number(n)]
      expect(lane.done).toBe(true)
      expect(lane.status).toBe(chapter.status)
      expect(lane.writerPasses).toBe(chapter.rounds.writer_passes)
      expect(lane.editorReviews).toBe(chapter.rounds.editor_rounds)
      expect(lane.factChecks).toBe(chapter.rounds.fact_check_rounds)
    }
  })

  it("names every chapter from the Planner's outline", () => {
    for (const plan of report.outline!.chapters) expect(view.chapters[plan.number].title).toBe(plan.title)
  })

  it("has nothing in progress once the run is over", () => {
    expect(activeNodes(view).size).toBe(0)
  })
})

describe("reduceRun part-way through", () => {
  it("shows which steps are busy, and for which chapters", () => {
    const firstWriter = events.findIndex((e) => e.kind === "agent_start" && e.agent === "writer")
    const view = reduceRun(events.slice(0, firstWriter + 1))
    const busy = activeNodes(view)
    const writing = events[firstWriter].chapter!
    expect(busy.get("chapter:writer")).toContain(writing)
    expect(view.finished).toBe(false)
  })

  it("records each send-back as a loop from the reviewer to the Writer", () => {
    const view = reduceRun(events)
    const sentBack = events.filter((e) => e.kind === "review" && e.chapter && !e.data.approved)
    expect(view.sendBacks.filter((s) => s.to === "chapter:writer")).toHaveLength(sentBack.length)
    expect(new Set(view.sendBacks.map((s) => s.from))).toContain("chapter:editor")
  })
})
