"use client"

import { Coins, Cpu, DatabaseZap, Globe, History, Rewind, Square, Timer } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { ActivityFeed } from "@/components/live/activity-feed"
import { AgentGraph } from "@/components/live/agent-graph"
import { ChapterLanes } from "@/components/live/chapter-lanes"
import { OutlineReviewDialog } from "@/components/live/outline-review-dialog"
import { useRunId } from "@/components/run/run-shell"
import { StatTile } from "@/components/stat-tile"
import { ErrorState, LoadingBlock } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApi } from "@/hooks/use-api"
import { useRunEvents } from "@/hooks/use-run-events"
import { cancelRun, type GraphData, type RunDetail } from "@/lib/api"
import { compact, duration, pct, usd } from "@/lib/format"
import { reduceRun } from "@/lib/run-state"

const LIVE = new Set(["running", "awaiting_review"])

export default function LivePage() {
  const id = useRunId()
  const detail = useApi<RunDetail>(`/runs/${id}`)
  const graph = useApi<GraphData>("/graph")
  const started = detail.data ? LIVE.has(detail.data.status) : false
  const [speed, setSpeed] = useState<number | undefined>(undefined)
  const [session, setSession] = useState(0)
  const stream = useRunEvents(id, { speed: started ? undefined : speed, session })
  const view = useMemo(() => reduceRun(stream.events), [stream.events])
  const live = started && !view.finished

  if (detail.error) return <ErrorState message={detail.error} />
  if (!detail.data || !graph.data) return <LoadingBlock rows={4} />

  const replaying = !live && speed !== undefined && !stream.ended
  const prompt = view.tokens.input + view.tokens.cacheRead + view.tokens.cacheWrite
  const elapsed = view.startedTs && view.lastTs ? view.lastTs - view.startedTs : null

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {live
            ? "Live: agents light up as they work, and a send-back animates the loop it takes."
            : replaying
              ? `Replaying the recording at ${speed}× speed: no model is called.`
              : "The finished run. Replay it to watch the agents work, from its recorded events."}
        </p>
        <div className="flex items-center gap-2">
          {live ? (
            <Button variant="outline" onClick={stop}>
              <Square /> Stop run
            </Button>
          ) : (
            <>
              <Select value={String(speed ?? 20)} onValueChange={(v) => replay(Number(v))}>
                <SelectTrigger className="w-[150px]" aria-label="Replay speed">
                  <History className="size-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 20, 60, 200].map((x) => (
                    <SelectItem key={x} value={String(x)}>
                      {x}× speed
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => replay(speed ?? 20)}>
                <Rewind /> {replaying ? "Restart replay" : "Replay"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          icon={<Coins className="size-3.5" />}
          label="Cost"
          value={usd(view.cost, 3)}
          hint={view.maxCost ? `cap ${usd(view.maxCost)}` : undefined}
        />
        <StatTile icon={<Cpu className="size-3.5" />} label="Model calls" value={view.calls} />
        <StatTile
          icon={<DatabaseZap className="size-3.5" />}
          label="Prompt tokens"
          value={compact(prompt)}
          hint={`${compact(view.tokens.output)} written`}
        />
        <StatTile
          icon={<DatabaseZap className="size-3.5" />}
          label="From cache"
          value={pct(prompt ? view.tokens.cacheRead / prompt : null)}
          hint="of prompt tokens"
        />
        <StatTile icon={<Globe className="size-3.5" />} label="Web searches" value={view.searches} />
        <StatTile icon={<Timer className="size-3.5" />} label="Elapsed" value={duration(elapsed)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl border bg-card shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Agent graph</h2>
            <p className="text-xs text-muted-foreground">
              solid: always · dashed: router decision · moving: a send-back
            </p>
          </div>
          <AgentGraph graph={graph.data} view={view} />
        </div>
        <div className="h-[620px]">
          <ActivityFeed events={stream.events} />
        </div>
      </div>

      <ChapterLanes view={view} maxPasses={7} />

      {stream.error && !stream.ended && <p className="text-sm text-muted-foreground">{stream.error}</p>}
      {live && view.awaitingReview && (
        <OutlineReviewDialog runId={id} outline={view.awaitingReview} />
      )}
    </div>
  )
}
