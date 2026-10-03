"use client"

import { ArrowRight, BookOpenText, ClipboardCheck, PlayCircle, Radio, Rewind, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment } from "react"

import { AgentIcon } from "@/components/agent-chip"
import { NewRunSheet } from "@/components/runs/new-run-sheet"
import { EmptyState, ErrorState, LoadingBlock } from "@/components/states"
import { PassMark, StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApi } from "@/hooks/use-api"
import { agent } from "@/lib/agents"
import type { RunReport, RunSummary } from "@/lib/api"
import { duration, int, pct, runDate, usd } from "@/lib/format"

const LIVE = new Set(["running", "awaiting_review"])
const TEAM = ["planner", "researcher", "writer", "editor", "fact_checker", "chief_editor"]

/** The six agents in pipeline order: the product in one line. */
function TeamStrip() {
  return (
    <ol className="flex items-start" aria-label="The agent team, in order">
      {TEAM.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && <li aria-hidden className="mt-[18px] h-px w-6 shrink-0 bg-border sm:w-9" />}
          <li className="flex w-[68px] flex-col items-center gap-1.5 text-center">
            <AgentIcon name={name} size="lg" className="rounded-xl" />
            <span className="text-[11px] leading-tight text-muted-foreground">{agent(name).label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

function Hero({ live }: { live?: RunSummary }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-card px-6 py-8 shadow-xs sm:px-10 sm:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(700px 260px at 0% 0%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 70%), radial-gradient(500px 240px at 100% 100%, color-mix(in oklab, var(--agent-planner) 8%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-8">
        <div className="max-w-xl space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden /> Multi-agent book writer
          </div>
          <h1 className="font-serif text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.5rem]">
            Six AI agents research, write, edit and fact-check a short book, with every fact cited.
          </h1>
          <p className="text-muted-foreground">
            Open a run to watch the team work, read the book it wrote, or see how it graded itself and what it cost.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <NewRunSheet disabled={Boolean(live)} />
            <Button asChild variant="outline">
              <Link href="/explain">
                How it works <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
        <div className="hidden md:block">
          <TeamStrip />
        </div>
      </div>
    </section>
  )
}

/** The latest complete book, as a cover and its numbers. */
function FeaturedBook({ run }: { run: RunSummary }) {
  const report = useApi<RunReport>(`/runs/${run.run_id}/report`)
  const card = report.data?.scorecard
  const claims = card?.chapters.reduce(
    (acc, c) => ({ ok: acc.ok + c.metrics.claims_supported, all: acc.all + c.metrics.claims_checked }),
    { ok: 0, all: 0 },
  )
  const facts = [
    { label: "Words", value: int(card?.book.metrics.words) },
    { label: "References", value: card?.book.metrics.references ?? "—" },
    { label: "Official sources", value: pct(card?.book.metrics.official_share) },
    { label: "Claims supported", value: claims ? `${claims.ok}/${claims.all}` : "—" },
    { label: "Cost", value: usd(run.cost_usd) },
    { label: "Time", value: duration(run.duration_s) },
  ]
  return (
    <section className="grid gap-6 rounded-3xl border bg-card p-6 shadow-xs sm:p-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
      <Link href={`/runs/${run.run_id}/book`} className="group mx-auto block w-[180px] md:w-full" aria-label="Read the book">
        <div className="paper relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-r-xl rounded-l-sm border border-[var(--paper-rule)] p-5 shadow-[0_18px_40px_-18px_rgba(60,40,10,0.45)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-[-1deg]">
          <span aria-hidden className="absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/15 to-transparent" />
          <div className="small-caps text-[10px] tracking-[0.26em] text-[var(--paper-accent)]">
            A guide in {run.chapters} chapters
          </div>
          <div className="font-serif text-[17px] leading-snug font-semibold text-balance">{run.title}</div>
          <div className="space-y-2">
            <div className="h-px bg-[var(--paper-rule)]" />
            <div className="small-caps text-[10px] tracking-[0.2em] text-[var(--paper-muted)]">Book Writer</div>
          </div>
        </div>
      </Link>
      <div className="flex min-w-0 flex-col justify-center gap-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium tracking-wide text-primary uppercase">Latest book</span>
            <span>·</span>
            <span>{runDate(run.run_id, run.started_at)}</span>
            <Badge variant="outline">{run.profile} profile</Badge>
            {run.scorecard_passed != null && <PassMark passed={run.scorecard_passed} label={run.scorecard_passed ? "Follows the brief" : "Breaks the brief"} />}
          </div>
          <h2 className="font-serif text-2xl leading-snug font-semibold tracking-tight text-balance">{run.title}</h2>
        </div>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-4 sm:grid-cols-6">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
              <dd className="tabular text-lg font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/runs/${run.run_id}/book`}>
              <BookOpenText /> Read the book
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/runs/${run.run_id}`}>
              <Rewind /> Watch the replay
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/runs/${run.run_id}/report`}>
              <ClipboardCheck /> See the report
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

function CostBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      <span className="hidden h-2 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span className="block h-full rounded-full bg-primary" style={{ width: value > 0 ? `${Math.max(3, (value / (max || 1)) * 100)}%` : 0 }} />
      </span>
      <span className="tabular w-12 text-right font-medium">{usd(value)}</span>
    </div>
  )
}

export default function RunsPage() {
  const router = useRouter()
  const runs = useApi<RunSummary[]>("/runs", 4000)
  const list = runs.data ?? []
  const live = list.find((r) => LIVE.has(r.status))
  const books = list.filter((r) => r.status === "completed" && r.chapters === 3)
  const spend = list.filter((r) => !r.sample).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
  const maxCost = Math.max(0, ...list.map((r) => r.cost_usd ?? 0))
  const featured = books[0]

  return (
    <div className="space-y-6">
      <Hero live={live} />

      {live && (
        <Link
          href={`/runs/${live.run_id}`}
          className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-3.5 text-sm transition-colors hover:bg-primary/10"
        >
          <Radio className="size-4 animate-pulse text-primary" aria-hidden />
          <span className="font-medium">A run is in progress.</span>
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{live.run_id}</span>
          <span className="ml-auto font-medium text-primary">Watch it live →</span>
        </Link>
      )}

      {featured && <FeaturedBook run={featured} />}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Run history</h2>
            <p className="text-sm text-muted-foreground">Every run, newest first. Click one to replay it.</p>
          </div>
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-[11px] text-muted-foreground">Runs</dt>
              <dd className="tabular font-semibold">{list.length || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Complete books</dt>
              <dd className="tabular font-semibold">{books.length || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">API spend, all runs</dt>
              <dd className="tabular font-semibold">{usd(spend)}</dd>
            </div>
          </dl>
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
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Profile</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Chapters</TableHead>
                  <TableHead className="hidden md:table-cell">Scorecard</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Time</TableHead>
                  <TableHead className="hidden pr-5 text-right lg:table-cell">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.run_id} className="cursor-pointer" onClick={() => router.push(`/runs/${r.run_id}`)}>
                    <TableCell className="py-3 pl-5">
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
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">{r.profile ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{r.chapters ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <PassMark passed={r.scorecard_passed} />
                    </TableCell>
                    <TableCell>
                      <CostBar value={r.cost_usd ?? 0} max={maxCost} />
                    </TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{duration(r.duration_s)}</TableCell>
                    <TableCell className="hidden pr-5 text-right lg:table-cell" onClick={(e) => e.stopPropagation()}>
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
      </section>
    </div>
  )
}
