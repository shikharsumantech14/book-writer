"use client"

import { CircleAlert, CircleCheck, CircleX } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { AgentDot, AgentIcon } from "@/components/agent-chip"
import { RULES } from "@/components/report/scorecard-view"
import { StatusBadge } from "@/components/status-badge"
import { agent } from "@/lib/agents"
import type { RunReport, Scorecard, ScoreCheck, SourceType, Usage, Verdict } from "@/lib/api"
import { compact, duration, int, pct, titleCase, usd } from "@/lib/format"
import type { Timeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------------ building blocks

function Panel({
  title,
  note,
  className,
  children,
}: {
  title: string
  note?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs", className)}>
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </header>
      {children}
    </section>
  )
}

function Section({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{note}</p>
    </div>
  )
}

function Kpi({ label, value, hint, visual }: { label: string; value: ReactNode; hint?: ReactNode; visual?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-4 shadow-xs">
      <div className="min-w-0">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="tabular mt-1.5 text-[26px] leading-none font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
      {visual}
    </div>
  )
}

/** A share as a ring: one hue on a muted track. */
function Ring({ value, size = 46 }: { value: number; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} style={{ stroke: "var(--muted)" }} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, value)} ${c}`}
        style={{ stroke: "var(--primary)" }}
      />
    </svg>
  )
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex h-10 shrink-0 items-end gap-1" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="w-2.5 rounded-t-[3px] bg-primary/80" style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}

interface Part {
  label: string
  value: number
  color: string
}

function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** One bar split into parts; 2px gaps keep neighbouring segments apart. */
function StackedBar({ parts, height = 20 }: { parts: Part[]; height?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div className="flex gap-0.5 overflow-hidden rounded-[4px]" style={{ height }}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span
            key={p.label}
            className="min-w-[3px] first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ flex: p.value / total, background: p.color }}
            title={`${p.label}: ${p.value.toLocaleString()} (${pct(p.value / total)})`}
          />
        ))}
    </div>
  )
}

const modelName = (m: string) =>
  m.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase())

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`

// ------------------------------------------------------------------ the verdict

function VerdictBanner({ card }: { card: Scorecard }) {
  const checks = [...card.book.checks, ...card.chapters.flatMap((c) => c.checks)]
  const passed = checks.filter((c) => c.passed).length
  const tone = card.passed ? "var(--status-good)" : "var(--status-critical)"
  return (
    <section className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(640px 220px at 0% 0%, color-mix(in oklab, ${tone} 13%, transparent), transparent 70%)` }}
      />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-4">
          <span
            className={cn("grid size-14 shrink-0 place-items-center rounded-2xl", card.passed ? "text-good" : "text-critical")}
            style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
          >
            {card.passed ? <CircleCheck className="size-8" aria-hidden /> : <CircleX className="size-8" aria-hidden />}
          </span>
          <div>
            <div className="text-2xl font-semibold tracking-tight">{card.passed ? "Follows the brief" : "Breaks the brief"}</div>
            <div className="text-sm text-muted-foreground">
              {passed} of {checks.length} checks passed · graded by code, not by a model
              {card.partial_run ? " · partial run" : ""}
            </div>
          </div>
        </div>
        <ul className="flex flex-wrap gap-2 lg:ml-auto">
          {card.chapters.map((g) => (
            <li key={g.number} className="flex items-center gap-2 rounded-xl border bg-background/50 py-1.5 pr-1.5 pl-3">
              <span className="text-xs font-medium text-muted-foreground">Chapter {g.number}</span>
              <StatusBadge status={g.passed ? (g.metrics.status ?? "ok") : "failed"} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ quality

function CheckCell({ check, wide = false }: { check: ScoreCheck | undefined; wide?: boolean }) {
  if (!check) return <span className="text-muted-foreground">—</span>
  const Icon = check.passed ? CircleCheck : CircleX
  return (
    <span
      title={check.detail || undefined}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium",
        wide ? "w-full" : "w-full max-w-14",
        check.passed ? "bg-good/12 text-good-ink" : "bg-critical/12 text-critical",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {wide ? (check.passed ? check.detail || "Passed" : "Failed") : <span className="sr-only">{check.passed ? "passed" : "failed"}</span>}
    </span>
  )
}

function ScoreMatrix({ card }: { card: Scorecard }) {
  const rules = card.chapters[0]?.checks.map((c) => c.rule) ?? []
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Rule from the brief</th>
            {card.chapters.map((g) => (
              <th key={g.number} className="w-[72px] pb-2 text-center font-medium">
                Ch {g.number}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rules.map((rule) => (
            <tr key={rule}>
              <td className="py-1 pr-3">{RULES[rule] ?? titleCase(rule)}</td>
              {card.chapters.map((g) => (
                <td key={g.number} className="px-1 py-1 text-center">
                  <CheckCell check={g.checks.find((c) => c.rule === rule)} />
                </td>
              ))}
            </tr>
          ))}
          {card.book.checks.map((c) => (
            <tr key={c.rule}>
              <td className="py-1 pr-3">
                {RULES[c.rule] ?? titleCase(c.rule)} <span className="text-xs text-muted-foreground">· whole book</span>
              </td>
              <td colSpan={card.chapters.length} className="px-1 py-1">
                <CheckCell check={c} wide />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SCORE_LABEL: Record<string, string> = { jargon_free: "Free of jargon", style_guide: "Style guide" }

/** Single-hue sequential scale: darker means a higher score. */
function heat(v: number) {
  const share = 12 + ((v - 1) / 4) * 78
  return {
    background: `color-mix(in oklab, var(--primary) ${share}%, var(--card))`,
    color: share > 55 ? "var(--primary-foreground)" : "var(--foreground)",
  }
}

function ScoreHeatmap({ card }: { card: Scorecard }) {
  const chapters = card.chapters.filter((g) => g.metrics.editor_scores)
  if (!chapters.length) return <p className="text-sm text-muted-foreground">No editor scores were recorded.</p>
  const dims = Object.keys(chapters[0].metrics.editor_scores!)
  return (
    <div className="space-y-3">
      <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(96px, 1fr) repeat(${chapters.length}, minmax(44px, 72px))` }}>
        <span />
        {chapters.map((g) => (
          <span key={g.number} className="pb-1 text-center text-xs font-medium text-muted-foreground">
            Ch {g.number}
          </span>
        ))}
        {dims.map((d) => (
          <Fragment key={d}>
            <span className="self-center pr-2 text-sm">{SCORE_LABEL[d] ?? titleCase(d)}</span>
            {chapters.map((g) => {
              const v = g.metrics.editor_scores![d]
              return (
                <span key={g.number} className="tabular grid h-8 place-items-center rounded-md text-sm font-semibold" style={heat(v)}>
                  {v}
                </span>
              )
            })}
          </Fragment>
        ))}
        <span className="self-center pt-1 pr-2 text-xs text-muted-foreground">Editor approved</span>
        {chapters.map((g) => (
          <span key={g.number} className="grid place-items-center pt-1">
            {g.metrics.editor_approved ? (
              <CircleCheck className="size-4 text-good" aria-label="approved" />
            ) : (
              <CircleAlert className="size-4 text-warning" aria-label="not approved" />
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>1</span>
        <span className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((v) => (
            <span key={v} className="h-2.5 w-6 rounded-[3px]" style={{ background: heat(v).background }} />
          ))}
        </span>
        <span>5 out of 5</span>
      </div>
    </div>
  )
}

const VERDICTS: { key: Verdict; label: string; color: string }[] = [
  { key: "SUPPORTED", label: "Supported", color: "var(--status-good)" },
  { key: "PARTIAL", label: "Partly supported", color: "var(--status-warning)" },
  { key: "UNSUPPORTED", label: "Unsupported", color: "var(--status-critical)" },
  { key: "UNCITED", label: "Uncited", color: "var(--status-serious)" },
]

function ClaimBars({ report }: { report: RunReport }) {
  return (
    <div className="space-y-4">
      {report.final_chapters.map((ch) => {
        const count = (v: Verdict) => ch.claim_checks.filter((c) => c.verdict === v).length
        const removed = ch.stats.removed_sentences.length
        return (
          <div key={ch.number} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium">Chapter {ch.number}</span>
              <span className="tabular text-muted-foreground">
                {count("SUPPORTED")}/{ch.claim_checks.length} supported
                {removed ? ` · ${removed} removed by the safety net` : ""}
              </span>
            </div>
            <StackedBar parts={VERDICTS.map((v) => ({ label: v.label, value: count(v.key), color: v.color }))} />
          </div>
        )
      })}
      <Legend items={VERDICTS} />
    </div>
  )
}

const SOURCES: { key: SourceType; label: string; color: string }[] = [
  { key: "official", label: "Official (government, regulator, NPCI)", color: "var(--chart-1)" },
  { key: "news", label: "News", color: "var(--chart-2)" },
  { key: "other", label: "Other", color: "var(--agent-code)" },
]

function SourceBars({ report }: { report: RunReport }) {
  return (
    <div className="space-y-4">
      {report.final_chapters.map((ch) => {
        const count = (t: SourceType) => ch.references.filter((r) => r.source_type === t).length
        return (
          <div key={ch.number} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium">Chapter {ch.number}</span>
              <span className="tabular text-muted-foreground">
                {ch.references.length} references · {count("official")} official
              </span>
            </div>
            <StackedBar parts={SOURCES.map((s) => ({ label: s.label, value: count(s.key), color: s.color }))} />
          </div>
        )
      })}
      <Legend items={SOURCES} />
    </div>
  )
}

// ------------------------------------------------------------------ cost and effort

function CostByAgent({ usage, routing }: { usage: Usage; routing: RunReport["routing"] }) {
  const rows = Object.entries(usage.by_agent).sort((a, b) => b[1].cost_usd - a[1].cost_usd)
  const max = rows[0]?.[1].cost_usd || 1
  const total = usage.total.cost_usd || 1
  return (
    <ul className="space-y-3">
      {rows.map(([name, b]) => {
        const r = routing?.[name]
        return (
          <li key={name} className="grid grid-cols-[minmax(0,176px)_1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <AgentDot name={name} /> {agent(name).label}
              </div>
              {r && (
                <div className="truncate pl-4 text-[11px] text-muted-foreground">
                  {modelName(r.model)}
                  {r.effort ? ` · ${r.effort}` : ""} · {b.calls} {b.calls === 1 ? "call" : "calls"}
                </div>
              )}
            </div>
            <div className="h-5 rounded-[4px] bg-muted/70">
              <div className="h-full rounded-[4px] bg-primary" style={{ width: `${(b.cost_usd / max) * 100}%` }} />
            </div>
            <div className="w-[92px] text-right">
              <span className="tabular text-sm font-semibold">{usd(b.cost_usd, 2)}</span>{" "}
              <span className="tabular text-xs text-muted-foreground">{pct(b.cost_usd / total)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SpendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { at: number; cost: number }
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="tabular font-medium">{usd(p.cost, 3)} spent</div>
      <div className="tabular text-muted-foreground">after {mmss(p.at)}</div>
    </div>
  )
}

function SpendOverTime({ timeline }: { timeline: Timeline }) {
  const data = [{ at: 0, cost: 0 }, ...timeline.spend]
  const end = data[data.length - 1].at
  const step = [30, 60, 120, 300, 600, 900, 1800].find((s) => end / s <= 6) ?? 3600
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step)
  if (data.length < 3) return <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">Loading the event log…</div>
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="at"
          type="number"
          domain={[0, "dataMax"]}
          ticks={ticks}
          tickFormatter={mmss}
          stroke="var(--baseline)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
          width={48}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <Tooltip content={<SpendTooltip />} cursor={{ stroke: "var(--baseline)" }} />
        <Area type="stepAfter" dataKey="cost" stroke="var(--primary)" strokeWidth={2} fill="url(#spend-fill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

const EFFORT = [
  { key: "writer_passes", agent: "writer", label: "Writer passes" },
  { key: "editor_rounds", agent: "editor", label: "Editor reviews" },
  { key: "fact_check_rounds", agent: "fact_checker", label: "Fact-checks" },
] as const

function EffortByChapter({ card, usage }: { card: Scorecard; usage: Usage }) {
  const max = Math.max(1, ...card.chapters.flatMap((g) => EFFORT.map((e) => g.metrics.rounds?.[e.key] ?? 0)))
  return (
    <div className="space-y-4">
      <div className="flex h-[180px] items-end justify-around gap-4 border-b border-baseline px-2">
        {card.chapters.map((g) => (
          <div key={g.number} className="flex h-full items-end gap-1.5">
            {EFFORT.map((e) => {
              const v = g.metrics.rounds?.[e.key] ?? 0
              return (
                <div key={e.key} className="flex h-full w-6 flex-col items-center justify-end gap-1" title={`${e.label}: ${v}`}>
                  <span className="tabular text-xs font-medium">{v}</span>
                  <span
                    className="w-full rounded-t-[4px]"
                    style={{ height: `${(v / max) * 82}%`, background: agent(e.agent).color }}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex justify-around gap-4 px-2 text-center text-xs">
        {card.chapters.map((g) => (
          <div key={g.number}>
            <div className="font-medium">Chapter {g.number}</div>
            <div className="tabular text-muted-foreground">{usd(usage.by_chapter[`chapter ${g.number}`]?.cost_usd, 2)}</div>
          </div>
        ))}
      </div>
      <Legend items={EFFORT.map((e) => ({ label: e.label, color: agent(e.agent).color }))} />
    </div>
  )
}

function TokenMix({ usage }: { usage: Usage }) {
  const t = usage.total
  const tokens: Part[] = [
    { label: "Read from cache", value: t.cache_read_tokens, color: "var(--primary)" },
    { label: "Written to cache", value: t.cache_write_tokens, color: "color-mix(in oklab, var(--primary) 55%, var(--card))" },
    { label: "Fresh input", value: t.input_tokens, color: "color-mix(in oklab, var(--primary) 25%, var(--card))" },
    { label: "Output (written by models)", value: t.output_tokens, color: "var(--chart-5)" },
  ]
  const shades = ["var(--chart-2)", "var(--chart-1)", "var(--chart-5)", "var(--agent-code)"]
  const models: Part[] = Object.entries(usage.by_model)
    .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
    .map(([m, b], i) => ({ label: modelName(m), value: b.cost_usd, color: shades[i % shades.length] }))
  const totalTokens = tokens.reduce((s, p) => s + p.value, 0)
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Tokens</span>
          <span className="tabular text-muted-foreground">{compact(totalTokens)} in all</span>
        </div>
        <StackedBar parts={tokens} height={24} />
        <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {tokens.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="tabular ml-auto font-medium">{compact(p.value)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Cost by model</span>
          <span className="tabular text-muted-foreground">{usd(usage.total.cost_usd, 2)}</span>
        </div>
        <StackedBar parts={models} height={24} />
        <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {models.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="tabular ml-auto font-medium">{usd(p.value, 2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const NOTES_SHOWN = 4

function Notes({ notes }: { notes: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? notes : notes.slice(0, NOTES_SHOWN)
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {shown.map((n) => (
          <li key={n} className="flex gap-3 text-sm leading-relaxed">
            <AgentIcon name="chief_editor" size="sm" className="mt-0.5" />
            <span>{n}</span>
          </li>
        ))}
      </ul>
      {notes.length > NOTES_SHOWN && (
        <button onClick={() => setAll(!all)} className="text-sm font-medium text-primary hover:underline">
          {all ? "Show fewer" : `Show all ${notes.length} notes`}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the page body

export function ReportDashboard({ report, timeline }: { report: RunReport; timeline: Timeline }) {
  const card = report.scorecard
  const usage = report.usage
  const prompt = usage.total.input_tokens + usage.total.cache_read_tokens + usage.total.cache_write_tokens
  const chapters = card?.chapters ?? []
  const supported = chapters.reduce((s, c) => s + c.metrics.claims_supported, 0)
  const checked = chapters.reduce((s, c) => s + c.metrics.claims_checked, 0)
  const passes = chapters.map((c) => c.metrics.rounds?.writer_passes ?? 0)
  const words = chapters.map((c) => c.metrics.word_count)
  const notes = report.chief_editor?.notes ?? []
  const warnings = chapters.flatMap((g) => g.warnings.map((w) => ({ chapter: g.number, text: w })))

  return (
    <div className="space-y-4">
      {card && <VerdictBanner card={card} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Cost" value={usd(usage.total.cost_usd)} hint={`${usage.total.calls} model calls`} />
        <Kpi
          label="Time"
          value={duration(report.duration_s)}
          hint={chapters.length > 1 ? `${chapters.length} chapters in parallel` : "one chapter"}
        />
        <Kpi
          label="Words"
          value={int(card?.book.metrics.words)}
          hint={words.length ? `${Math.min(...words)}–${Math.max(...words)} per chapter` : undefined}
          visual={words.length > 1 ? <MiniBars values={words} /> : undefined}
        />
        <Kpi
          label="Claims supported"
          value={`${supported}/${checked}`}
          hint="fact-checked"
          visual={<Ring value={checked ? supported / checked : 0} />}
        />
        <Kpi
          label="Official sources"
          value={pct(card?.book.metrics.official_share)}
          hint={`${card?.book.metrics.references ?? 0} references`}
          visual={<Ring value={card?.book.metrics.official_share ?? 0} />}
        />
        <Kpi
          label="Writer passes"
          value={passes.reduce((a, b) => a + b, 0)}
          hint={`${passes.reduce((a, b) => a + Math.max(0, b - 1), 0)} rewrites`}
          visual={passes.length > 1 ? <MiniBars values={passes} /> : undefined}
        />
      </div>

      {card && (
        <>
          <Section title="Quality" note="Every rule in the brief, checked by code; then how the reviewers scored it." />
          <div className="grid gap-4 xl:grid-cols-12">
            <Panel title="Scorecard" note="Hover a cell for the measured value." className="xl:col-span-7">
              <ScoreMatrix card={card} />
            </Panel>
            <Panel title="Editor scores" note="The Editor's last review of each chapter, out of 5." className="xl:col-span-5">
              <ScoreHeatmap card={card} />
            </Panel>
            <Panel
              title="Fact-check verdicts"
              note="Each factual sentence checked against the quote it cites."
              className="xl:col-span-6"
            >
              <ClaimBars report={report} />
            </Panel>
            <Panel title="Where the facts come from" note="References per chapter, by kind of source." className="xl:col-span-6">
              <SourceBars report={report} />
            </Panel>
          </div>
        </>
      )}

      <Section title="Cost and effort" note="Where the money and the work went, at list prices from config.yaml." />
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel title="Cost by agent" note="Each agent with its model and effort level from the routing profile." className="xl:col-span-7">
          <CostByAgent usage={usage} routing={report.routing} />
        </Panel>
        <Panel title="Spend over time" note="Cumulative cost as the run went on." className="xl:col-span-5">
          <SpendOverTime timeline={timeline} />
        </Panel>
        {card && (
          <Panel title="Effort by chapter" note="How many rounds each chapter needed, and what it cost." className="xl:col-span-5">
            <EffortByChapter card={card} usage={usage} />
          </Panel>
        )}
        <Panel
          title="Tokens and models"
          note={`${pct(usage.cache_read_share)} of ${compact(prompt)} prompt tokens came from the cache, billed at a tenth of the price.`}
          className={card ? "xl:col-span-7" : "xl:col-span-12"}
        >
          <TokenMix usage={usage} />
        </Panel>
      </div>

      {(notes.length > 0 || warnings.length > 0) && (
        <>
          <Section title="Notes" note="What the Chief Editor changed, and what the run flagged." />
          <div className="grid gap-4 xl:grid-cols-12">
            {notes.length > 0 && (
              <Panel title="Chief Editor" note="A read of the whole book for one consistent voice." className="xl:col-span-7">
                <Notes notes={notes} />
              </Panel>
            )}
            {warnings.length > 0 && (
              <Panel title="Warnings" note="Shipped anyway, and said so." className={notes.length ? "xl:col-span-5" : "xl:col-span-12"}>
                <ul className="space-y-3">
                  {warnings.map((w) => (
                    <li key={`${w.chapter}-${w.text}`} className="flex gap-3 text-sm leading-relaxed">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      <span>
                        <span className="font-medium">Chapter {w.chapter}:</span> {w.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  )
}
