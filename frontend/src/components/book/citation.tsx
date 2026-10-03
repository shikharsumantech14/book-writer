"use client"

import { CircleAlert, CircleCheck, ExternalLink, Link2, Link2Off } from "lucide-react"
import { createContext, useContext } from "react"

import type { FinalChapter, Reference, Verdict } from "@/lib/api"
import { cn } from "@/lib/utils"

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
  if (ok === undefined) return <span>Link not checked</span>
  return ok ? (
    <span className="inline-flex items-center gap-1.5">
      <Link2 className="size-3.5 text-good" aria-hidden /> Link working{via === "extract" ? " (read via extract)" : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <Link2Off className="size-3.5 text-critical" aria-hidden /> Link broken
    </span>
  )
}

/**
 * Which source the reader is looking at. Hovering a [n] previews it; clicking pins it.
 * The source opens in the margin (or under the paragraph on narrow screens), never over the text.
 */
export interface Focus {
  chapter: number
  n: number
  para: number
  pinned: boolean
}
export const CiteContext = createContext<{ focus: Focus | null; setFocus: (f: Focus | null) => void }>({
  focus: null,
  setFocus: () => {},
})

/** A [n] citation marker in the running text. */
export function Citation({ n, chapter, para }: { n: number; chapter: FinalChapter; para: number }) {
  const { focus, setFocus } = useContext(CiteContext)
  const ref = chapter.references.find((r) => r.number === n)
  if (!ref) return <sup>[{n}]</sup>
  const active = focus?.chapter === chapter.number && focus.n === n
  const preview = () => {
    if (!focus?.pinned) setFocus({ chapter: chapter.number, n, para, pinned: false })
  }
  return (
    <button
      type="button"
      data-cite={`${chapter.number}-${n}`}
      onMouseEnter={preview}
      onFocus={preview}
      onClick={() =>
        setFocus(active && focus?.pinned && focus.para === para ? null : { chapter: chapter.number, n, para, pinned: true })
      }
      aria-pressed={active}
      aria-label={`Source ${n}: ${ref.source_name}`}
      className={cn(
        "mx-px rounded-[3px] px-[3px] align-super font-sans text-[0.64em] font-semibold text-[var(--paper-accent)] transition-colors hover:bg-[var(--paper-mark)]",
        active && "bg-[var(--paper-mark)] ring-1 ring-[var(--paper-accent)]/40",
      )}
    >
      [{n}]
    </button>
  )
}

/** One source as a margin note: collapsed to its title, or open with the verified quote. */
export function SourceNote({
  chapter,
  reference,
  open,
  onSelect,
}: {
  chapter: FinalChapter
  reference: Reference
  open: boolean
  onSelect?: () => void
}) {
  const { evidence, link, verdicts } = referenceFacts(chapter, reference)
  const allSupported = Object.keys(verdicts).every((v) => v === "SUPPORTED")
  return (
    <div
      data-ref={reference.number}
      className={cn(
        "rounded-xl border p-3 transition-colors duration-300",
        open ? "border-[var(--paper-rule)] bg-[var(--paper-mark)]/55" : "border-transparent hover:bg-[var(--paper-mark)]/30",
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 text-left" aria-expanded={open}>
        <span className="tabular w-5 shrink-0 text-right font-serif text-xl leading-none text-[var(--paper-accent)]">
          {reference.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="small-caps mb-0.5 block text-[13px] leading-tight text-[var(--paper-muted)]">{reference.source_name}</span>
          <span className={cn("block font-serif text-[15px] leading-snug", !open && "line-clamp-2")}>{reference.title}</span>
        </span>
        <SourceTypeBadge type={reference.source_type} />
      </button>
      {open && (
        <div className="mt-3 animate-fade-in space-y-3 pl-8">
          {evidence.map((e) => (
            <blockquote
              key={e.id}
              className="border-l-2 border-[var(--paper-accent)]/50 pl-3 font-serif text-[15px] leading-relaxed italic"
            >
              “{e.quote}”
            </blockquote>
          ))}
          <div className="space-y-1 text-xs text-[var(--paper-muted)]">
            <LinkState ok={link?.ok} via={link?.via} />
            {Object.keys(verdicts).length > 0 && (
              <div className="flex items-center gap-1.5">
                {allSupported ? (
                  <CircleCheck className="size-3.5 text-good" aria-hidden />
                ) : (
                  <CircleAlert className="size-3.5 text-warning" aria-hidden />
                )}
                {Object.entries(verdicts)
                  .map(([v, count]) => `${count} sentence${count > 1 ? "s" : ""} ${VERDICT_LABEL[v as Verdict]}`)
                  .join(", ")}
              </div>
            )}
            <div>Quote matched word for word against the page before use.</div>
          </div>
          <a
            href={reference.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--paper-accent)] hover:underline"
          >
            Open the source <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
    </div>
  )
}
