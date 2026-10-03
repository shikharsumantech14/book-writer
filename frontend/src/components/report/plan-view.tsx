import { AgentChip } from "@/components/agent-chip"
import { Badge } from "@/components/ui/badge"
import type { Outline } from "@/lib/api"

export function PlanView({ outline }: { outline: Outline }) {
  const sg = outline.style_guide
  return (
    <div className="space-y-6">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <AgentChip name="planner" /> designed the book before anything was researched: questions only, no facts.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {outline.chapters.map((c) => (
          <div key={c.number} className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Chapter {c.number}</div>
              <h3 className="leading-snug font-semibold">{c.title}</h3>
            </div>
            <p className="text-sm">{c.goal}</p>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Fact questions</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {c.fact_needs.map((f) => (
                  <li key={f.id}>{f.question}</li>
                ))}
              </ul>
            </div>
            <p className="rounded-lg bg-muted/60 p-3 text-sm">
              <span className="font-medium">Takeaway idea:</span> {c.takeaway_idea}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
          <h3 className="font-semibold">Style guide</h3>
          <p className="text-sm">
            <span className="font-medium">Reader:</span> {sg.reader_persona}
          </p>
          <p className="text-sm">
            <span className="font-medium">Voice:</span> {sg.voice}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {sg.do.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {sg.dont.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <blockquote className="border-l-2 border-primary/40 pl-3 font-serif text-sm italic">
            {sg.sample_paragraph}
          </blockquote>
        </div>
        <div className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
          <h3 className="font-semibold">Glossary</h3>
          <p className="text-xs text-muted-foreground">Each term is explained once, in the chapter that introduces it.</p>
          <dl className="divide-y">
            {sg.glossary.map((g) => (
              <div key={g.term} className="flex items-start gap-3 py-2 text-sm">
                <dt className="w-28 shrink-0 font-medium">{g.term}</dt>
                <dd className="flex-1 text-muted-foreground">{g.plain_explanation}</dd>
                <Badge variant="outline">Ch {g.introduced_in_chapter}</Badge>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
