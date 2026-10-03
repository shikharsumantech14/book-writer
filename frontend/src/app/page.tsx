"use client"

import { BookOpenText, ChartColumn, Coins, Library, PlayCircle, Radio } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { NewRunSheet } from "@/components/runs/new-run-sheet"
import { StatTile } from "@/components/stat-tile"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/states"
import { PassMark, StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApi } from "@/hooks/use-api"
import type { RunSummary } from "@/lib/api"
import { duration, runDate, usd } from "@/lib/format"

const LIVE = new Set(["running", "awaiting_review"])

export default function RunsPage() {
  const router = useRouter()
  const runs = useApi<RunSummary[]>("/runs", 4000)
  const list = runs.data ?? []
  const live = list.find((r) => LIVE.has(r.status))
  const books = list.filter((r) => r.status === "completed" && r.chapters === 3)
  const spend = list.filter((r) => !r.sample).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every run of the agent team: open one to watch it live or replay its recording, read the book, or see how
            it graded itself and what it cost.
          </p>
        </div>
        <NewRunSheet disabled={Boolean(live)} />
      </div>

      {live && (
        <Link
          href={`/runs/${live.run_id}`}
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <Radio className="size-4 animate-pulse text-primary" aria-hidden />
          <span className="font-medium">A run is in progress.</span>
          <span className="text-muted-foreground">{live.run_id}</span>
          <span className="ml-auto font-medium text-primary">Watch it live →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Library className="size-3.5" />} label="Runs" value={list.length || "—"} />
        <StatTile
          icon={<BookOpenText className="size-3.5" />}
          label="Complete books"
          value={books.length || "—"}
          hint="three chapters, run finished"
        />
        <StatTile
          icon={<Coins className="size-3.5" />}
          label="API spend"
          value={usd(spend)}
          hint="all runs in data/runs"
        />
        <StatTile
          icon={<ChartColumn className="size-3.5" />}
          label="Latest book"
          value={books[0] ? usd(books[0].cost_usd) : "—"}
          hint={books[0] ? `${books[0].profile} profile, ${duration(books[0].duration_s)}` : undefined}
        />
      </div>

      {runs.loading && !runs.data ? (
        <LoadingBlock />
      ) : runs.error && !runs.data ? (
        <ErrorState message={runs.error} />
      ) : list.length === 0 ? (
        <EmptyState icon={PlayCircle} title="No runs yet">
          Start one with New run, or from the terminal: <code>uv run bookwriter run --profile dev --chapters 1</code>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead className="text-right">Chapters</TableHead>
                <TableHead>Scorecard</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="pr-4 text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.run_id} className="cursor-pointer" onClick={() => router.push(`/runs/${r.run_id}`)}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2 font-medium">
                      {runDate(r.run_id, r.started_at)}
                      {r.sample && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary">sample</Badge>
                          </TooltipTrigger>
                          <TooltipContent>The committed sample run in docs/sample-output</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{r.run_id}</div>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <StatusBadge status={r.status} />
                        </span>
                      </TooltipTrigger>
                      {r.error && <TooltipContent className="max-w-sm">{r.error}</TooltipContent>}
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.profile ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-right">{r.chapters ?? "—"}</TableCell>
                  <TableCell>
                    <PassMark passed={r.scorecard_passed} />
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">{usd(r.cost_usd)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{duration(r.duration_s)}</TableCell>
                  <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/runs/${r.run_id}`}>{LIVE.has(r.status) ? "Live" : "Replay"}</Link>
                      </Button>
                      {r.scorecard_passed != null && (
                        <>
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/runs/${r.run_id}/book`}>Book</Link>
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/runs/${r.run_id}/report`}>Report</Link>
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
