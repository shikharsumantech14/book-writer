import { ArrowLeft, Gauge, ShieldCheck, Telescope } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { HowABookIsMade, StepList, SystemDiagram } from "@/components/explain/figures"

export const metadata: Metadata = {
  title: "How it works · Book Writer",
  description: "How six AI agents research, write, edit and fact-check a cited book.",
}

const PROMISES = [
  {
    icon: ShieldCheck,
    title: "Every fact is checked",
    text: "Quotes are matched word for word on the page they came from, and a Fact-checker tests every cited sentence against its quote. Anything still unproven is removed.",
  },
  {
    icon: Gauge,
    title: "A run always finishes",
    text: "Each review loop has a limit and every run has a cost cap, so the team cannot argue forever or overspend.",
  },
  {
    icon: Telescope,
    title: "You can watch and steer",
    text: "The dashboard shows each agent at work, live or replayed, and a run can pause for you to approve or edit the outline.",
  },
]

/** A wide figure: full size on desktop, scrolls sideways on tablets, replaced by a list on phones. */
function Wide({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">{children}</div>
}

export default function ExplainPage() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="max-w-3xl space-y-3">
          <h1 className="font-serif text-4xl leading-tight font-semibold tracking-tight">How it works</h1>
          <p className="text-lg text-muted-foreground">
            You give it a brief. A team of AI agents plans a short book, researches each fact on the web, writes the
            chapters, and reviews them the way an editor and a fact-checker would, sending work back until it is right.
            The result is a book where every fact links to the page it came from.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PROMISES.map((p) => (
          <div key={p.title} className="space-y-2 rounded-2xl border bg-card p-5 shadow-xs">
            <p.icon className="size-5 text-primary" aria-hidden />
            <h2 className="font-semibold">{p.title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{p.text}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <div className="hidden md:block">
          <Wide>
            <HowABookIsMade />
          </Wide>
        </div>
        <div className="space-y-3 md:hidden">
          <h2 className="font-serif text-2xl font-semibold">How a book gets made</h2>
          <StepList />
        </div>
      </section>

      <section className="hidden md:block">
        <Wide>
          <SystemDiagram />
        </Wide>
      </section>
    </div>
  )
}
