"use client"

import { Download, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

import { Citation, LinkState, referenceFacts } from "@/components/book/citation"
import { SourceTypeBadge } from "@/components/book/source-type-badge"
import { useRunId } from "@/components/run/run-shell"
import { ErrorState, LoadingBlock } from "@/components/states"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { useApi } from "@/hooks/use-api"
import { fileUrl, type FinalChapter, type RunReport } from "@/lib/api"
import { pct } from "@/lib/format"
import { cn } from "@/lib/utils"

function Paragraph({ text, chapter }: { text: string; chapter: FinalChapter }) {
  const parts = text.split(/(\[\d+\])/g)
  return (
    <p>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part)
        return m ? <Citation key={i} n={Number(m[1])} chapter={chapter} /> : <span key={i}>{part}</span>
      })}
    </p>
  )
}

function Chapter({ chapter }: { chapter: FinalChapter }) {
  const official = chapter.references.filter((r) => r.source_type === "official").length
  return (
    <article id={`chapter-${chapter.number}`} data-chapter={chapter.number} className="scroll-mt-24">
      <header className="mb-8 space-y-3">
        <div className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Chapter {chapter.number}</div>
        <h2 className="font-serif text-3xl leading-tight font-semibold tracking-tight text-balance">{chapter.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={chapter.stats.status} />
          <span>{chapter.word_count} words</span>
          <span>·</span>
          <span>
            {chapter.references.length} sources, {official} official
          </span>
        </div>
      </header>
      <div className="prose-book">
        {chapter.paragraphs.map((p, i) => (
          <Paragraph key={i} text={p} chapter={chapter} />
        ))}
      </div>
      <p className="my-8 rounded-r-lg border-l-4 border-primary bg-primary/5 py-3 pr-4 pl-5 font-serif text-lg leading-relaxed font-semibold">
        {chapter.takeaway}
      </p>
      <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">References</h3>
      <ol className="space-y-2 text-sm">
        {chapter.references.map((r) => (
          <li key={r.number} id={`ref-${chapter.number}-${r.number}`} className="flex gap-2 scroll-mt-24">
            <span className="tabular w-5 shrink-0 text-right text-muted-foreground">{r.number}.</span>
            <span className="min-w-0">
              {r.source_name}. “{r.title}”.{" "}
              <a href={r.url} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {r.url}
              </a>
            </span>
          </li>
        ))}
      </ol>
    </article>
  )
}

function SourcesPanel({ chapter }: { chapter: FinalChapter }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Sources · chapter {chapter.number}
      </h3>
      {chapter.references.map((r) => {
        const { checks, link } = referenceFacts(chapter, r)
        return (
          <a
            key={r.number}
            href={`#ref-${chapter.number}-${r.number}`}
            className="block space-y-1.5 rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                [{r.number}] {r.source_name}
              </span>
              <SourceTypeBadge type={r.source_type} />
            </div>
            <div className="line-clamp-2 leading-snug font-medium">{r.title}</div>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <LinkState ok={link?.ok} via={link?.via} />
              <span>
                cited by {checks.length} sentence{checks.length === 1 ? "" : "s"}
              </span>
            </div>
          </a>
        )
      })}
    </div>
  )
}

export default function BookPage() {
  const id = useRunId()
  const report = useApi<RunReport>(`/runs/${id}/report`)
  const [current, setCurrent] = useState(1)
  const chapters = report.data?.final_chapters ?? []

  // Track the chapter being read, for the sources panel.
  useEffect(() => {
    if (!chapters.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setCurrent(Number((visible[0].target as HTMLElement).dataset.chapter))
      },
      { rootMargin: "-20% 0px -60% 0px" },
    )
    document.querySelectorAll("article[data-chapter]").forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [chapters.length])

  if (report.error) return <ErrorState message={report.error} />
  if (!report.data) return <LoadingBlock rows={6} />

  const card = report.data.scorecard
  const active = chapters.find((c) => c.number === current) ?? chapters[0]

  return (
    <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm">
          <div className="mb-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Contents</div>
          {chapters.map((c) => (
            <a
              key={c.number}
              href={`#chapter-${c.number}`}
              className={cn(
                "block rounded-md px-2 py-1.5 leading-snug transition-colors hover:bg-muted",
                current === c.number ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="text-xs">Chapter {c.number}</span>
              <span className="line-clamp-2">{c.title}</span>
            </a>
          ))}
          <div className="space-y-2 pt-4">
            <Button asChild variant="outline" size="sm" className="w-full justify-start">
              <a href={fileUrl(id, "book.md")} download={`${id}-book.md`}>
                <Download /> Markdown
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full justify-start">
              <a href={fileUrl(id, "book.html")} target="_blank" rel="noreferrer">
                <ExternalLink /> HTML
              </a>
            </Button>
          </div>
        </nav>
      </aside>

      <div className="mx-auto w-full max-w-[44rem] space-y-16 rounded-2xl border bg-card px-6 py-10 shadow-xs sm:px-12">
        <header className="space-y-3 border-b pb-8 text-center">
          <h1 className="font-serif text-4xl leading-tight font-semibold tracking-tight text-balance">
            {report.data.outline?.book_title}
          </h1>
          {card && (
            <p className="text-sm text-muted-foreground">
              {card.book.metrics.words.toLocaleString()} words · {card.book.metrics.references} references ·{" "}
              {pct(card.book.metrics.official_share)} official sources · hover any [n] to see its source
            </p>
          )}
        </header>
        {chapters.map((c) => (
          <Chapter key={c.number} chapter={c} />
        ))}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
          {active && <SourcesPanel chapter={active} />}
        </div>
      </aside>
    </div>
  )
}
