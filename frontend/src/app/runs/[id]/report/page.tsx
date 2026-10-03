"use client"

import { CostView } from "@/components/report/cost-view"
import { PlanView } from "@/components/report/plan-view"
import { ScorecardView } from "@/components/report/scorecard-view"
import { useRunId } from "@/components/run/run-shell"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/states"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApi } from "@/hooks/use-api"
import type { RunReport } from "@/lib/api"

export default function ReportPage() {
  const id = useRunId()
  const report = useApi<RunReport>(`/runs/${id}/report`)
  if (report.error) return <ErrorState message={report.error} />
  if (!report.data) return <LoadingBlock rows={5} />
  const r = report.data

  return (
    <Tabs defaultValue="scorecard" className="gap-6">
      <TabsList>
        <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
        <TabsTrigger value="cost">Cost</TabsTrigger>
        <TabsTrigger value="plan">Plan</TabsTrigger>
      </TabsList>
      <TabsContent value="scorecard">
        {r.scorecard ? <ScorecardView card={r.scorecard} /> : <EmptyState title="No scorecard: the run wrote no chapters" />}
      </TabsContent>
      <TabsContent value="cost">
        <CostView usage={r.usage} />
      </TabsContent>
      <TabsContent value="plan">
        {r.outline ? <PlanView outline={r.outline} /> : <EmptyState title="The run stopped before the Planner finished" />}
      </TabsContent>
    </Tabs>
  )
}
