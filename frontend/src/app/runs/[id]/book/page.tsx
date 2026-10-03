"use client"

import { Download, ExternalLink } from "lucide-react"
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react"

import { Citation, CiteContext, type Focus, SourceNote } from "@/components/book/citation"
import { useRunId } from "@/components/run/run-shell"
import { ErrorState, LoadingBlock } from "@/components/states"
import { StatusBadge } from "@/components/status-badge"
import { useApi } from "@/hooks/use-api"
import { fileUrl, type FinalChapter, type RunReport } from "@/lib/api"
import { pct } from "@/lib/format"
import { cn } from "@/lib/utils"

const NUMBER_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]

function Ornament() {
  return (
    <div className="py-2 text-center font-serif text-3xl text-[var(--paper-accent)]" aria-hidden>
      ⁂
    </div>
  )
}

function Paragraph({ text, chapter, index }: { text: string; chapter: FinalChapter; index: number }) {
  const { focus, setFocus } = useContext(CiteContext)
  const parts = text.split(/(\[\d+\])/g)
  // On narrow screens there is no margin: a pinned source opens under its paragraph instead.
  const inline =
    focus?.pinned && focus.chapter === chapter.number && focus.para === index
      ? chapter.references.find((r) => r.number === focus.n)
      : undefined
  return (
    <>
      <p className={cn(index === 0 && "drop-cap")}>
        {parts.map((part, i) => {
          const m = /^\[(\d+)\]$/.exec(part)
          return m ? <Citation key={i} n={Number(m[1])} chapter={chapter} para={index} /> : <Fragment key={i}>{part}</Fragment>
        })}
      </p>
      {inline && (
        <div className="my-4 font-sans xl:hidden">
          <SourceNote chapter={chapter} reference={inline} open onSelect={() => setFocus(null)} />
        </div>
      )}
    </>
  )
}

function Chapter({ chapter }: { chapter: FinalChapter }) {
  const { setFocus } = useContext(CiteContext)
  const official = chapter.references.filter((r) => r.source_type === "official").length
  return (
    <article id={`chapter-${chapter.number}`} data-chapter={chapter.number} className="scroll-mt-20">
      <header className="mb-10 space-y-4 text-center">
        <div className="small-caps text-sm tracking-[0.3em] text-[var(--paper-accent)]">
          Chapter {NUMBER_WORDS[chapter.number - 1] ?? chapter.number}
        </div>
        <h2 className="mx-auto max-w-[32rem] font-serif text-[2rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-[2.35rem]">
          {chapter.title}
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--paper-muted)]">
          <StatusBadge status={chapter.stats.status} />
          <span>{chapter.word_count} words</span>
          <span aria-hidden>·</span>
          <span>
            {chapter.references.length} sources, {official} official
          </span>
        </div>
      </header>

      <div className="prose-book">
        {chapter.paragraphs.map((p, i) => (
          <Paragraph key={i} text={p} chapter={chapter} index={i} />
        ))}
      </div>

      <figure className="my-12 border-y border-[var(--paper-rule)] py-8 text-center">
        <figcaption className="small-caps mb-3 text-xs tracking-[0.3em] text-[var(--paper-accent)]">The takeaway</figcaption>
        <blockquote className="mx-auto max-w-[34rem] font-serif text-[1.35rem] leading-snug text-balance italic">
          {chapter.takeaway}
        </blockquote>
      </figure>

      <section aria-label={`References for chapter ${chapter.number}`}>
        <h3 className="small-caps mb-4 text-sm tracking-[0.24em] text-[var(--paper-muted)]">References</h3>
        <ol className="space-y-2.5 text-[13.5px] leading-relaxed">
          {chapter.references.map((r) => (
            <li
              key={r.number}
              id={`ref-${chapter.number}-${r.number}`}
              className="flex scroll-mt-24 gap-3"
              onMouseEnter={() => setFocus({ chapter: chapter.number, n: r.number, para: -1, pinned: false })}
            >
              <span className="tabular w-5 shrink-0 text-right font-serif text-[var(--paper-accent)]">{r.number}</span>
              <span className="min-w-0">
                <span className="small-caps">{r.source_name}</span>. <cite className="font-serif">{r.title}</cite>.{" "}
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[var(--paper-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--paper-accent)]"
                >
                  {r.url}
                </a>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  )
}

/** The margin: the current chapter's sources, with the one being read opened up. */
function Margin({ chapter }: { chapter: FinalChapter }) {
  const { focus, setFocus } = useContext(CiteContext)
  const box = useRef<HTMLDivElement>(null)
  const openN = focus?.chapter === chapter.number ? focus.n : null

  // Keep the open note in view inside the sticky margin, without moving the page.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-ref="${openN}"]`)
    const b = box.current
    if (!el || !b) return
    if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight) {
      b.scrollTo({ top: Math.max(0, el.offsetTop - 72), behavior: "smooth" })
    }
  }, [openN])

  return (
    <div ref={box} className="sticky top-14 max-h-[calc(100vh-3.5rem)] space-y-1 overflow-y-auto px-5 py-10">
      <div className="mb-3 px-3">
        <div className="small-caps text-sm tracking-[0.24em] text-[var(--paper-accent)]">Sources · Chapter {chapter.number}</div>
        <p className="mt-1 text-xs text-[var(--paper-muted)]">
          Point at any [n] in the text to read the quote it rests on; click to keep it open.
        </p>
      </div>
      {chapter.references.map((r) => (
        <SourceNote
          key={r.number}
          chapter={chapter}
          reference={r}
          open={openN === r.number}
          onSelect={() =>
            setFocus(openN === r.number ? null : { chapter: chapter.number, n: r.number, para: -1, pinned: true })
          }
        />
      ))}
    </div>
  )
}

export default function BookPage() {
  const id = useRunId()
  const report = useApi<RunReport>(`/runs/${id}/report`)
  const [current, setCurrent] = useState(1)
  const [focus, setFocus] = useState<Focus | null>(null)
  const chapters = useMemo(() => report.data?.final_chapters ?? [], [report.data])

  // Track the chapter being read: the margin follows it, and a source left open in another chapter closes.
  useEffect(() => {
    if (!chapters.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (!visible[0]) return
        const n = Number((visible[0].target as HTMLElement).dataset.chapter)
        setCurrent(n)
        setFocus((f) => (f && f.chapter !== n ? null : f))
      },
      { rootMargin: "-20% 0px -60% 0px" },
    )
    document.querySelectorAll("article[data-chapter]").forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [chapters.length])

  if (report.error) return <ErrorState message={report.error} />
  if (!report.data) return <LoadingBlock rows={6} />

  const card = report.data.scorecard
  const shown = chapters.find((c) => c.number === (focus?.chapter ?? current)) ?? chapters[0]

  return (
    <CiteContext.Provider value={{ focus, setFocus }}>
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="Contents">
            <div className="small-caps mb-3 px-2 text-sm tracking-[0.24em] text-muted-foreground">Contents</div>
            {chapters.map((c) => (
              <a
                key={c.number}
                href={`#chapter-${c.number}`}
                className={cn(
                  "flex gap-3 rounded-lg border-l-2 px-2 py-2 leading-snug transition-colors",
                  current === c.number
                    ? "border-primary bg-muted/60 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="font-serif text-lg leading-none">{c.number}</span>
                <span className="line-clamp-3 font-serif text-[14px]">{c.title}</span>
              </a>
            ))}
            <div className="space-y-1 border-t pt-4 text-sm">
              <a href={fileUrl(id, "book.md")} download={`${id}-book.md`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Download className="size-4" /> Markdown
              </a>
              <a href={fileUrl(id, "book.html")} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <ExternalLink className="size-4" /> HTML
              </a>
            </div>
          </nav>
        </aside>

        <div className="paper overflow-clip rounded-[28px] border border-[var(--paper-rule)] shadow-[0_1px_0_rgba(0,0,0,0.03),0_24px_60px_-30px_rgba(60,40,10,0.35)]">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="px-6 py-14 sm:px-12 lg:px-16">
              <div className="mx-auto max-w-[40rem] space-y-20">
                <header className="space-y-6 text-center">
                  <div className="small-caps text-sm tracking-[0.3em] text-[var(--paper-muted)]">
                    A short guide in {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
                  </div>
                  <h1 className="font-serif text-[2.6rem] leading-[1.08] font-semibold tracking-tight text-balance sm:text-[3.2rem]">
                    {report.data.outline?.book_title}
                  </h1>
                  <p className="mx-auto max-w-md font-serif text-lg text-[var(--paper-muted)] italic">
                    Researched, written, edited and fact-checked by a team of AI agents, with every fact traced to its source.
                  </p>
                  {card && (
                    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-[var(--paper-muted)]">
                      <span>{card.book.metrics.words.toLocaleString()} words</span>
                      <span>{card.book.metrics.references} references</span>
                      <span>{pct(card.book.metrics.official_share)} from official sources</span>
                    </div>
                  )}
                  <Ornament />
                </header>
                {chapters.map((c, i) => (
                  <Fragment key={c.number}>
                    {i > 0 && <Ornament />}
                    <Chapter chapter={c} />
                  </Fragment>
                ))}
              </div>
            </div>
            <aside className="hidden border-l border-[var(--paper-rule)] bg-[color-mix(in_oklab,var(--paper-mark)_22%,transparent)] xl:block">
              {shown && <Margin chapter={shown} />}
            </aside>
          </div>
        </div>
      </div>
    </CiteContext.Provider>
  )
}
