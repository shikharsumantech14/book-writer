import { CircleAlert, CircleCheck, CircleX } from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import type { ChapterGrade, Scorecard, ScoreCheck } from "@/lib/api"
import { titleCase } from "@/lib/format"
import { cn } from "@/lib/utils"

export const RULES: Record<string, string> = {
  chapter_count: "Chapter count",
  word_count: "Length within the brief",
  flowing_prose: "Prose only: no lists or headings",
  no_urls_in_text: "No URLs in the text",
  takeaway_line: "Takeaway line before the references",
  citations_resolve: "Every citation resolves to a reference",
  reference_format: "References give source, title and link",
  figures_cited: "Every figure carries a citation",
  claims_supported: "Claims supported by their sources",
  links_working: "Links working",
}

// Details are written to explain a failure; when a check passes, show only the ones that carry numbers.
const INFORMATIVE = new Set(["chapter_count", "word_count", "citations_resolve", "claims_supported", "links_working"])

function Check({ check }: { check: ScoreCheck }) {
  const Icon = check.passed ? CircleCheck : CircleX
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", check.passed ? "text-good" : "text-critical")} aria-hidden />
      <div className="min-w-0 text-sm">
        <div className="font-medium">{RULES[check.rule] ?? titleCase(check.rule)}</div>
        {check.detail && (!check.passed || INFORMATIVE.has(check.rule)) && (
          <div className="text-xs text-muted-foreground">{check.detail}</div>
        )}
      </div>
    </li>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tabular text-sm font-semibold">{value}</div>
    </div>
  )
}

function ScoreBars({ scores }: { scores: Record<string, number> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(scores).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">{titleCase(k)}</span>
          <div className="flex flex-1 gap-0.5" aria-label={`${v} out of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={cn("h-2 flex-1 rounded-sm", i <= v ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
          <span className="tabular w-6 text-right font-medium">{v}/5</span>
        </div>
      ))}
    </div>
  )
}

function ChapterCard({ grade }: { grade: ChapterGrade }) {
  const m = grade.metrics
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Chapter {grade.number}</div>
          <h3 className="leading-snug font-semibold">{grade.title}</h3>
        </div>
        <StatusBadge status={grade.passed ? (m.status ?? "ok") : "failed"} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Words" value={m.word_count} />
        <Metric label="References" value={`${m.references} (${m.official_sources} official)`} />
        <Metric label="Claims supported" value={`${m.claims_supported}/${m.claims_checked}`} />
        <Metric label="Removed by safety net" value={m.removed_sentences} />
        <Metric label="Writer passes" value={m.rounds?.writer_passes ?? "—"} />
        <Metric label="Editor reviews" value={m.rounds?.editor_rounds ?? "—"} />
        <Metric label="Fact-checks" value={m.rounds?.fact_check_rounds ?? "—"} />
        <Metric label="Editor approved" value={m.editor_approved ? "Yes" : "No"} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <ul className="divide-y">
          {grade.checks.map((c) => (
            <Check key={c.rule} check={c} />
          ))}
        </ul>
        <div className="space-y-3">
          {m.editor_scores && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Editor scores</div>
              <ScoreBars scores={m.editor_scores} />
            </div>
          )}
          {grade.warnings.length > 0 && (
            <ul className="space-y-1.5">
              {grade.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-xs text-muted-foreground">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** One card per chapter: its checks with the measured values, the editor's scores and any warnings. */
export function ChapterCards({ card }: { card: Scorecard }) {
  return (
    <div className="space-y-4">
      {card.chapters.map((g) => (
        <ChapterCard key={g.number} grade={g} />
      ))}
    </div>
  )
}
