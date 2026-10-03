// The two illustrations on /explain, also captured as the README's pictures. They are drawn at
// a fixed size (like a figure in a book) and scroll sideways on narrow screens; phones get the
// same content as a plain list instead (see StepList).

import {
  BookCheck,
  FileText,
  Globe,
  HardDrive,
  type LucideIcon,
  MessagesSquare,
  MonitorSmartphone,
  Server,
  Sparkles,
  SquareTerminal,
  Workflow,
  Wrench,
} from "lucide-react"
import type { ReactNode } from "react"

import { AgentIcon } from "@/components/agent-chip"
import { agent } from "@/lib/agents"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------------ shared pieces

type Kind = "ai" | "code" | "you" | "input" | "result"

const KIND: Record<Kind, { label: string; cls: string }> = {
  ai: { label: "AI agent", cls: "border-primary/30 bg-primary/8 text-primary" },
  code: { label: "Code check", cls: "border-border bg-muted text-muted-foreground" },
  you: { label: "You, optional", cls: "border-border bg-muted text-muted-foreground" },
  input: { label: "Input", cls: "border-border bg-muted text-muted-foreground" },
  result: { label: "Result", cls: "border-good/40 bg-good/10 text-good-ink" },
}

function Tag({ kind }: { kind: Kind }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-px text-[10.5px] font-medium whitespace-nowrap", KIND[kind].cls)}>
      {KIND[kind].label}
    </span>
  )
}

function IconTile({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4.5"
      style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
      aria-hidden
    >
      <Icon />
    </span>
  )
}

interface Step {
  id: string
  title: string
  kind: Kind
  text: string
  icon?: LucideIcon
  color?: string
}

function StepCard({ step, className, dashed = false }: { step: Step; className?: string; dashed?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border bg-card p-4 shadow-xs",
        dashed && "border-dashed bg-card/60 shadow-none",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {step.icon ? (
          <IconTile icon={step.icon} color={step.color ?? "var(--muted-foreground)"} />
        ) : (
          <AgentIcon name={step.id} size="lg" className="rounded-xl" />
        )}
        <Tag kind={step.kind} />
      </div>
      <div className="text-[15px] leading-tight font-semibold">{step.title}</div>
      <p className="text-[13px] leading-snug text-muted-foreground">{step.text}</p>
    </div>
  )
}

function Arrow({ className }: { className?: string }) {
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" className={cn("shrink-0", className)} aria-hidden>
      <path d="M2 7 H34" strokeWidth="1.6" style={{ stroke: "var(--baseline)" }} />
      <path d="M30 2.5 L36 7 L30 11.5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--baseline)" }} />
    </svg>
  )
}

function DownConnector({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-2" aria-hidden>
      <span className="h-5 w-px bg-baseline" />
      <span className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">{label}</span>
      <svg width="14" height="18" viewBox="0 0 14 18">
        <path d="M7 0 V15" strokeWidth="1.6" style={{ stroke: "var(--baseline)" }} />
        <path d="M2.5 11 L7 16 L11.5 11" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--baseline)" }} />
      </svg>
    </div>
  )
}

function FigureFrame({ id, title, caption, children }: { id: string; title: string; caption: string; children: ReactNode }) {
  return (
    <figure id={id} className="mx-auto w-[1180px] space-y-6 rounded-3xl border bg-background p-8">
      <figcaption className="space-y-1">
        <div className="font-serif text-[28px] leading-tight font-semibold tracking-tight">{title}</div>
        <p className="text-[15px] text-muted-foreground">{caption}</p>
      </figcaption>
      {children}
    </figure>
  )
}

// ------------------------------------------------------------------ how a book gets made

export const BOOK_START: Step[] = [
  {
    id: "brief",
    title: "The brief",
    kind: "input",
    icon: FileText,
    text: "A three-chapter book on UPI for first-time shop owners: 600–900 words a chapter, every fact cited.",
  },
  {
    id: "planner",
    title: "Planner",
    kind: "ai",
    text: "Designs the book: an outline per chapter, the facts each one needs, and a style guide.",
  },
  {
    id: "outline_review",
    title: "Outline review",
    kind: "you",
    text: "The run can pause here so a person approves or edits the outline first.",
  },
]

export const CHAPTER_STEPS: Step[] = [
  {
    id: "researcher",
    title: "Researcher",
    kind: "ai",
    text: "Searches the web, official sites first, and saves exact quotes it found on the page.",
  },
  { id: "writer", title: "Writer", kind: "ai", text: "Writes the chapter in plain words, using only the saved quotes." },
  { id: "lint", title: "Lint", kind: "code", text: "Checks the rules: length, no lists, every number cited." },
  { id: "editor", title: "Editor", kind: "ai", text: "Reads like a mentor: tone, clarity, no jargon." },
  {
    id: "fact_checker",
    title: "Fact-checker",
    kind: "ai",
    text: "Checks every cited sentence against its quote, and every link.",
  },
  { id: "safety_net", title: "Safety net", kind: "code", text: "Removes anything still unproven before the chapter ships." },
]

export const BOOK_END: Step[] = [
  {
    id: "chief_editor",
    title: "Chief Editor",
    kind: "ai",
    text: "Reads the three chapters together and evens out the voice.",
  },
  { id: "assembler", title: "Assembler", kind: "code", text: "Numbers the citations and adds a reference list to each chapter." },
  {
    id: "book",
    title: "The book",
    kind: "result",
    icon: BookCheck,
    color: "var(--status-good)",
    text: "Three chapters, every fact linked to a real page that was checked.",
  },
]

export const LOOPS = [
  { n: 1, from: "lint", to: "writer", text: "A rule is broken, so the Writer fixes it." },
  { n: 2, from: "editor", to: "writer", text: "The Editor asks for changes, so the Writer rewrites." },
  { n: 3, from: "fact_checker", to: "writer", text: "A sentence says more than its source, so the Writer corrects it." },
  { n: 4, from: "fact_checker", to: "researcher", text: "A fact is missing, so the Researcher looks again." },
]

// Workshop canvas: six stations in one row, loops drawn above (to the Writer) and below (to the Researcher).
const ST_W = 150
const ST_STEP = 182
const ST_TOP = 124
const ST_H = 192
const center = (i: number) => i * ST_STEP + ST_W / 2
const indexOf = (id: string) => CHAPTER_STEPS.findIndex((s) => s.id === id)

function LoopBadge({ n, color, x, y }: { n: number; color: string; x: number; y: number }) {
  return (
    <span
      className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-background text-xs font-bold"
      style={{ left: x, top: y, borderColor: color }}
    >
      {n}
    </span>
  )
}

function Workshop() {
  const width = 5 * ST_STEP + ST_W
  const height = ST_TOP + ST_H + 84
  return (
    <div className="relative">
      {/* two sheets behind: three chapters go through the workshop at once */}
      <div aria-hidden className="absolute inset-0 translate-x-4 translate-y-4 rounded-3xl border bg-card/50" />
      <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 rounded-3xl border bg-card/70" />
      <div className="relative space-y-4 rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[17px] font-semibold">The chapter workshop</div>
            <p className="text-[13px] text-muted-foreground">Every chapter goes through the same six stations. Reviewers can send work back.</p>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/8 px-3 py-1 text-[13px] font-medium text-primary">
            × 3 chapters, all at the same time
          </span>
        </div>

        <div className="relative mx-auto" style={{ width, height }}>
          <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              {LOOPS.map((l) => (
                <marker key={l.n} id={`loop-head-${l.n}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" style={{ fill: agent(l.from).color }} />
                </marker>
              ))}
            </defs>
            {/* forward flow between stations */}
            {CHAPTER_STEPS.slice(1).map((_, i) => {
              const x1 = i * ST_STEP + ST_W + 4
              const x2 = (i + 1) * ST_STEP - 6
              return (
                <g key={i}>
                  <path d={`M ${x1} ${ST_TOP + 36} H ${x2}`} strokeWidth={1.6} style={{ stroke: "var(--baseline)" }} />
                  <path
                    d={`M ${x2 - 5} ${ST_TOP + 31.5} L ${x2 + 1} ${ST_TOP + 36} L ${x2 - 5} ${ST_TOP + 40.5}`}
                    fill="none"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    style={{ stroke: "var(--baseline)" }}
                  />
                </g>
              )
            })}
            {LOOPS.map((l) => {
              const xf = center(indexOf(l.from))
              const xt = center(indexOf(l.to))
              const color = agent(l.from).color
              if (l.to === "researcher") {
                const y = ST_TOP + ST_H
                return (
                  <path
                    key={l.n}
                    d={`M ${xf} ${y + 2} C ${xf} ${y + 92}, ${xt} ${y + 92}, ${xt} ${y + 6}`}
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="6 5"
                    markerEnd={`url(#loop-head-${l.n})`}
                    style={{ stroke: color }}
                  />
                )
              }
              const lift = 40 + (l.n - 1) * 42
              const land = xt - 18 + (l.n - 1) * 18
              return (
                <path
                  key={l.n}
                  d={`M ${xf} ${ST_TOP - 2} C ${xf} ${ST_TOP - lift}, ${land} ${ST_TOP - lift}, ${land} ${ST_TOP - 6}`}
                  fill="none"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  markerEnd={`url(#loop-head-${l.n})`}
                  style={{ stroke: color }}
                />
              )
            })}
          </svg>

          {LOOPS.map((l) => {
            const xf = center(indexOf(l.from))
            const xt = center(indexOf(l.to))
            const below = l.to === "researcher"
            const lift = 40 + (l.n - 1) * 42
            const land = xt - 18 + (l.n - 1) * 18
            return (
              <LoopBadge
                key={l.n}
                n={l.n}
                color={agent(l.from).color}
                x={below ? (xf + xt) / 2 : (xf + land) / 2}
                y={below ? ST_TOP + ST_H + 68 : ST_TOP - 2 - lift * 0.75}
              />
            )
          })}

          {CHAPTER_STEPS.map((s, i) => (
            <div key={s.id} className="absolute" style={{ left: i * ST_STEP, top: ST_TOP, width: ST_W, height: ST_H }}>
              <StepCard step={s} className="h-full p-3.5" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t pt-4">
          {LOOPS.map((l) => (
            <div key={l.n} className="flex items-center gap-3 text-[13.5px]">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-bold" style={{ borderColor: agent(l.from).color }}>
                {l.n}
              </span>
              <span>
                <span className="font-medium">
                  {agent(l.from).label} → {agent(l.to).label}:
                </span>{" "}
                <span className="text-muted-foreground">{l.text}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function HowABookIsMade() {
  return (
    <FigureFrame
      id="how-it-works"
      title="How a book gets made"
      caption="Six AI agents and three code checks, working like a small publishing house. Every loop has a limit, so a run always finishes."
    >
      <div className="flex items-stretch justify-center">
        <StepCard step={BOOK_START[0]} className="w-[270px]" />
        <Arrow className="self-center" />
        <StepCard step={BOOK_START[1]} className="w-[270px]" />
        <Arrow className="self-center" />
        <StepCard step={BOOK_START[2]} className="w-[270px]" dashed />
      </div>
      <DownConnector label="Each chapter gets its own outline and list of facts to find" />
      <Workshop />
      <div className="pt-3">
        <DownConnector label="Three finished chapters" />
      </div>
      <div className="flex items-stretch justify-center">
        <StepCard step={BOOK_END[0]} className="w-[270px]" />
        <Arrow className="self-center" />
        <StepCard step={BOOK_END[1]} className="w-[270px]" />
        <Arrow className="self-center" />
        <StepCard step={BOOK_END[2]} className="w-[270px] border-good/40" />
      </div>
    </FigureFrame>
  )
}

// ------------------------------------------------------------------ the system

interface Box {
  id: string
  title: string
  tag: string
  text: string
  icon: LucideIcon
  color: string
  x: number
  y: number
  w: number
  h: number
}

const SYS_W = 1116
const BOXES: Box[] = [
  { id: "dashboard", title: "Dashboard", tag: "Next.js", text: "Watch runs live, read the book, see the report.", icon: MonitorSmartphone, color: "var(--chart-2)", x: 0, y: 0, w: 330, h: 108 },
  { id: "cli", title: "Command line", tag: "bookwriter", text: "Run, replay and report from a terminal.", icon: SquareTerminal, color: "var(--muted-foreground)", x: 393, y: 0, w: 300, h: 108 },
  { id: "host", title: "Claude Desktop or Code", tag: "any MCP host", text: "Can use the same research tools directly.", icon: MessagesSquare, color: "var(--muted-foreground)", x: 786, y: 0, w: 330, h: 108 },
  { id: "api", title: "HTTP API", tag: "FastAPI · live events", text: "Starts runs and streams every step as it happens.", icon: Server, color: "var(--chart-2)", x: 0, y: 196, w: 330, h: 100 },
  { id: "engine", title: "Agent engine", tag: "LangGraph", text: "Runs the agents, decides who works next and enforces every budget. Can pause for a review and resume where it stopped.", icon: Workflow, color: "var(--primary)", x: 0, y: 380, w: 693, h: 150 },
  { id: "mcp", title: "Research tools", tag: "MCP server", text: "Web search, read a page, verify a quote, check links.", icon: Wrench, color: "var(--chart-5)", x: 786, y: 396, w: 330, h: 118 },
  { id: "claude", title: "Claude", tag: "Opus · Sonnet · Haiku", text: "Plans, writes, reviews and judges each claim.", icon: Sparkles, color: "var(--chart-3)", x: 0, y: 620, w: 330, h: 104 },
  { id: "storage", title: "Run folders", tag: "files + SQLite", text: "The book, the event log, the report and checkpoints.", icon: HardDrive, color: "var(--muted-foreground)", x: 393, y: 620, w: 300, h: 104 },
  { id: "web", title: "The web", tag: "Tavily + live pages", text: "Official sources first: NPCI, RBI, the government.", icon: Globe, color: "var(--chart-5)", x: 786, y: 620, w: 330, h: 104 },
]
const SYS_H = 724

const LINKS: { d: string; label: string; lx: number; ly: number; dashed?: boolean }[] = [
  { d: "M 165 108 V 190", label: "clicks and live updates", lx: 165, ly: 150 },
  { d: "M 165 296 V 374", label: "starts, pauses, resumes runs", lx: 165, ly: 336 },
  { d: "M 543 108 V 374", label: "bookwriter run", lx: 543, ly: 244 },
  { d: "M 951 108 V 390", label: "the same tools, from Claude", lx: 951, ly: 250, dashed: true },
  { d: "M 693 455 H 780", label: "tool calls", lx: 738, ly: 436 },
  { d: "M 165 530 V 614", label: "prompts and answers", lx: 165, ly: 572 },
  { d: "M 543 530 V 614", label: "every step saved", lx: 543, ly: 572 },
  { d: "M 951 514 V 614", label: "search and read pages", lx: 951, ly: 564 },
]

function SystemBox({ box }: { box: Box }) {
  const engine = box.id === "engine"
  return (
    <div
      className={cn(
        "absolute flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-xs",
        engine && "border-primary/40 shadow-sm ring-4 ring-primary/8",
      )}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div className="flex items-center gap-3">
        <IconTile icon={box.icon} color={box.color} />
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold">{box.title}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{box.tag}</div>
        </div>
      </div>
      <p className="text-[13px] leading-snug text-muted-foreground">{box.text}</p>
      {engine && (
        <div className="mt-auto flex items-center gap-1.5">
          {["planner", "researcher", "writer", "editor", "fact_checker", "chief_editor"].map((a) => (
            <AgentIcon key={a} name={a} size="md" className="rounded-lg" />
          ))}
          <span className="ml-2 text-xs text-muted-foreground">six agents, three code checks</span>
        </div>
      )}
    </div>
  )
}

export function SystemDiagram() {
  return (
    <FigureFrame
      id="system"
      title="How the system fits together"
      caption="Three ways in, one engine in the middle, and the services it relies on."
    >
      <div className="relative mx-auto" style={{ width: SYS_W, height: SYS_H }}>
        <svg width={SYS_W} height={SYS_H} className="absolute inset-0" aria-hidden>
          <defs>
            <marker id="sys-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: "var(--baseline)" }} />
            </marker>
          </defs>
          {LINKS.map((l) => (
            <path
              key={l.label}
              d={l.d}
              fill="none"
              strokeWidth={1.8}
              strokeDasharray={l.dashed ? "6 5" : undefined}
              markerEnd="url(#sys-head)"
              style={{ stroke: "var(--baseline)" }}
            />
          ))}
        </svg>
        {BOXES.map((b) => (
          <SystemBox key={b.id} box={b} />
        ))}
        {LINKS.map((l) => (
          <span
            key={l.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground"
            style={{ left: l.lx, top: l.ly }}
          >
            {l.label}
          </span>
        ))}
      </div>
    </FigureFrame>
  )
}

// ------------------------------------------------------------------ phones

/** The same story as a list, for screens too narrow for the figures. */
export function StepList() {
  const group = (title: string, steps: Step[]) => (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {steps.map((s) => (
        <StepCard key={s.id} step={s} dashed={s.kind === "you"} />
      ))}
    </section>
  )
  return (
    <div className="space-y-6">
      {group("1 · Planning", BOOK_START)}
      {group("2 · The chapter workshop, three chapters at once", CHAPTER_STEPS)}
      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Work can be sent back</h3>
        {LOOPS.map((l) => (
          <p key={l.n} className="text-sm">
            <span className="font-medium">
              {agent(l.from).label} → {agent(l.to).label}:
            </span>{" "}
            <span className="text-muted-foreground">{l.text}</span>
          </p>
        ))}
        <p className="text-xs text-muted-foreground">Every loop has a limit, so a run always finishes.</p>
      </section>
      {group("3 · Finishing the book", BOOK_END)}
    </div>
  )
}
