"use client"

import { useMemo } from "react"

import { UsageTables } from "@/components/report/cost-view"
import { ReportDashboard } from "@/components/report/dashboard"
import { PlanView } from "@/components/report/plan-view"
import { ChapterCards } from "@/components/report/scorecard-view"
import { useRunId } from "@/components/run/run-shell"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/states"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApi } from "@/hooks/use-api"
import { useRunEvents } from "@/hooks/use-run-events"
import type { RunReport } from "@/lib/api"
import { buildTimeline } from "@/lib/timeline"

export default function ReportPage() {
  const id = useRunId()
  const report = useApi<RunReport>(`/runs/${id}/report`)
  // The recorded event log, streamed at once: it gives the spend-over-time curve.
  const stream = useRunEvents(id, { session: 0 })
  const timeline = useMemo(() => buildTimeline(stream.events), [stream.events])
  if (report.error) return <ErrorState message={report.error} />
  if (!report.data) return <LoadingBlock rows={5} />
  const r = report.data

  return (
    <Tabs defaultValue="dashboard" className="gap-5">
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="plan">Plan</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard">
        <ReportDashboard report={r} timeline={timeline} />
      </TabsContent>
      <TabsContent value="details" className="space-y-8">
        {r.scorecard ? <ChapterCards card={r.scorecard} /> : <EmptyState title="No scorecard: the run wrote no chapters" />}
        <UsageTables usage={r.usage} />
      </TabsContent>
      <TabsContent value="plan">
        {r.outline ? <PlanView outline={r.outline} /> : <EmptyState title="The run stopped before the Planner finished" />}
      </TabsContent>
    </Tabs>
  )
}
