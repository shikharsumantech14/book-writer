"use client"

import { CircleAlert, CircleCheck, ExternalLink, Link2, Link2Off } from "lucide-react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import type { FinalChapter, Reference, Verdict } from "@/lib/api"

import { SourceTypeBadge } from "./source-type-badge"

const VERDICT_LABEL: Record<Verdict, string> = {
  SUPPORTED: "supported",
  PARTIAL: "partly supported",
  UNSUPPORTED: "unsupported",
  UNCITED: "uncited",
}

export function referenceFacts(chapter: FinalChapter, ref: Reference) {
  const evidence = chapter.evidence.filter((e) => ref.evidence_ids.includes(e.id))
  const checks = chapter.claim_checks.filter((c) => c.cited.some((id) => ref.evidence_ids.includes(id)))
  const link = chapter.stats.links.find((l) => l.url === ref.url)
  const verdicts = checks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] ?? 0) + 1 }), {})
  return { evidence, checks, link, verdicts }
}

export function LinkState({ ok, via }: { ok: boolean | undefined; via?: string | null }) {
  if (ok === undefined) return <span className="text-muted-foreground">link not checked</span>
  return ok ? (
    <span className="inline-flex items-center gap-1">
      <Link2 className="size-3.5 text-good" aria-hidden /> Link working{via === "extract" ? " (read via extract)" : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Link2Off className="size-3.5 text-critical" aria-hidden /> Link broken
    </span>
  )
}

/** A [n] citation marker: hover to see the source, the verified quote, and the fact-check result. */
export function Citation({ n, chapter }: { n: number; chapter: FinalChapter }) {
  const ref = chapter.references.find((r) => r.number === n)
  if (!ref) return <sup>[{n}]</sup>
  const { evidence, link, verdicts } = referenceFacts(chapter, ref)
  const allSupported = Object.keys(verdicts).every((v) => v === "SUPPORTED")

  return (
    <HoverCard openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>
        <a
          href={`#ref-${chapter.number}-${n}`}
          className="mx-px rounded px-0.5 align-super font-sans text-[0.68em] font-semibold text-primary no-underline hover:bg-primary/10"
        >
          [{n}]
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-96 space-y-3 font-sans" side="top">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{ref.source_name}</div>
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="line-clamp-2 text-sm leading-snug font-semibold hover:underline"
            >
              {ref.title} <ExternalLink className="inline size-3" aria-hidden />
            </a>
          </div>
          <SourceTypeBadge type={ref.source_type} />
        </div>
        {evidence.map((e) => (
          <blockquote key={e.id} className="border-l-2 border-primary/40 pl-3 font-serif text-sm leading-relaxed italic">
            “{e.quote}”
          </blockquote>
        ))}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          <LinkState ok={link?.ok} via={link?.via} />
          {Object.keys(verdicts).length > 0 && (
            <span className="inline-flex items-center gap-1">
              {allSupported ? (
                <CircleCheck className="size-3.5 text-good" aria-hidden />
              ) : (
                <CircleAlert className="size-3.5 text-warning" aria-hidden />
              )}
              {Object.entries(verdicts)
                .map(([v, count]) => `${count} sentence${count > 1 ? "s" : ""} ${VERDICT_LABEL[v as Verdict]}`)
                .join(", ")}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Quote verified verbatim against the page text before use.</p>
      </HoverCardContent>
    </HoverCard>
  )
}
