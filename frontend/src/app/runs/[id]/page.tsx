"use client"

import { Rewind, Square } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { ActivityFeed } from "@/components/live/activity-feed"
import { AssemblyLine } from "@/components/live/assembly-line"
import { ChapterLanes } from "@/components/live/chapter-lanes"
import { Hud, type Mode } from "@/components/live/hud"
import { OutlineReviewDialog } from "@/components/live/outline-review-dialog"
import { RunTimeline } from "@/components/live/run-timeline"
import { useRunId } from "@/components/run/run-shell"
import { ErrorState, LoadingBlock } from "@/components/states"
import { Button } from "@/components/ui/button"
import { useApi } from "@/hooks/use-api"
import { useRunEvents } from "@/hooks/use-run-events"
import { cancelRun, type GraphData, type RunDetail } from "@/lib/api"
import { reduceRun } from "@/lib/run-state"
import { buildTimeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"

const LIVE = new Set(["running", "awaiting_review"])
const SPEEDS = [5, 20, 60, 200]

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="console-panel space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="hud-label !text-[11px] !text-foreground">{title}</h2>
        {note && <p className="font-mono text-[10.5px] text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export default function MissionControlPage() {
  const id = useRunId()
  const detail = useApi<RunDetail>(`/runs/${id}`)
  const graph = useApi<GraphData>("/graph")
  const started = detail.data ? LIVE.has(detail.data.status) : false
  const [speed, setSpeed] = useState<number | undefined>(undefined)
  const [session, setSession] = useState(0)
  const stream = useRunEvents(id, { speed: started ? undefined : speed, session })
  const view = useMemo(() => reduceRun(stream.events), [stream.events])
  const timeline = useMemo(() => buildTimeline(stream.events), [stream.events])
  const live = started && !view.finished
  const unfolding = live || (speed !== undefined && !stream.ended)

  // A clock for animations (send-back arcs fade after a couple of seconds).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!unfolding) return
    const t = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(t)
  }, [unfolding])

  if (detail.error) return <ErrorState message={detail.error} />
  if (!detail.data || !graph.data) return <LoadingBlock rows={4} />

  const mode: Mode = live ? { kind: "live" } : unfolding ? { kind: "replay", speed: speed! } : { kind: "recorded" }

  function replay(x: number) {
    setSpeed(x)
    setSession((s) => s + 1)
  }

  async function stop() {
    try {
      await cancelRun(id)
      toast.success("Run stopped; its report was written")
      detail.reload()
    } catch (e) {
      toast.error("Couldn't stop the run", { description: (e as Error).message })
    }
  }

  const controls = live ? (
    <Button variant="outline" size="sm" onClick={stop} className="border-[var(--console-live)]/50 font-mono text-xs tracking-wide">
      <Square /> STOP RUN
    </Button>
  ) : (
    <>
      <div className="flex rounded-lg border border-[var(--console-line)] p-0.5" role="radiogroup" aria-label="Replay speed">
        {SPEEDS.map((x) => (
          <button
            key={x}
            role="radio"
            aria-checked={(speed ?? 20) === x}
            onClick={() => (unfolding ? replay(x) : setSpeed(x))}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[11px] transition-colors",
              (speed ?? 20) === x ? "bg-[var(--console-accent)]/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {x}×
          </button>
        ))}
      </div>
      <Button size="sm" onClick={() => replay(speed ?? 20)} className="bg-[var(--console-accent)] font-mono text-xs tracking-wide text-[#04201c] hover:bg-[var(--console-accent)]/90">
        <Rewind /> {unfolding ? "RESTART" : "REPLAY"}
      </Button>
    </>
  )

  return (
    <div className="dark">
      <div className="console -mx-2 space-y-4 rounded-3xl border border-[var(--console-line)] p-3 shadow-2xl sm:mx-0 sm:p-5">
        <Hud view={view} timeline={timeline} mode={mode} controls={controls} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <Panel title="Assembly line" note="◉ working  ● done  ↩ sent back, with how many times">
              <div className="-mx-1 overflow-x-auto px-1">
                <div className="min-w-[760px]">
                  <AssemblyLine graph={graph.data} view={view} now={now} animate={unfolding} />
                </div>
              </div>
            </Panel>
            <Panel title="Timeline" note="who worked on what, and when">
              <div className="-mx-1 overflow-x-auto px-1">
                <div className="min-w-[640px]">
                  <RunTimeline timeline={timeline} live={unfolding} />
                </div>
              </div>
            </Panel>
          </div>
          {/* On wide screens the feed takes the height of the left column and scrolls inside it. */}
          <div className="h-[560px] xl:relative xl:h-auto">
            <div className="h-full xl:absolute xl:inset-0">
              <ActivityFeed events={stream.events} chapters={view.chapterCount || 3} />
            </div>
          </div>
        </div>

        <ChapterLanes view={view} maxPasses={7} />

        {stream.error && !stream.ended && <p className="font-mono text-xs text-muted-foreground">{stream.error}</p>}
      </div>
      {live && view.awaitingReview && <OutlineReviewDialog runId={id} outline={view.awaitingReview} />}
    </div>
  )
}
