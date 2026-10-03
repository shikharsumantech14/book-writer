// Agent identity: one colour and one icon per agent, used the same way in the graph,
// the activity feed, badges and charts. Colours are CSS tokens (globals.css) from a
// colour-blind-validated palette, assigned in pipeline order. Code steps share a neutral
// grey. Text never wears the agent colour: it sits beside a coloured dot or icon.

import {
  BookCopy,
  Compass,
  Crown,
  Highlighter,
  LifeBuoy,
  type LucideIcon,
  PenLine,
  Ruler,
  Search,
  ShieldCheck,
  Tags,
  UserCheck,
} from "lucide-react"

export type AgentKind = "model" | "code" | "human"

export interface AgentIdentity {
  label: string
  icon: LucideIcon
  color: string // a CSS colour value, usually a token
  kind: AgentKind
  role: string
}

export const AGENTS: Record<string, AgentIdentity> = {
  planner: {
    label: "Planner",
    icon: Compass,
    color: "var(--agent-planner)",
    kind: "model",
    role: "Outline, fact questions and style guide",
  },
  outline_review: {
    label: "Outline review",
    icon: UserCheck,
    color: "var(--agent-human)",
    kind: "human",
    role: "Optional: a person approves or edits the outline",
  },
  researcher: {
    label: "Researcher",
    icon: Search,
    color: "var(--agent-researcher)",
    kind: "model",
    role: "Searches, reads pages, records verified quotes",
  },
  writer: {
    label: "Writer",
    icon: PenLine,
    color: "var(--agent-writer)",
    kind: "model",
    role: "Writes the chapter from the evidence pack",
  },
  lint: {
    label: "Lint",
    icon: Ruler,
    color: "var(--agent-code)",
    kind: "code",
    role: "Word count, prose only, citations, takeaway",
  },
  editor: {
    label: "Editor",
    icon: Highlighter,
    color: "var(--agent-editor)",
    kind: "model",
    role: "Tone, clarity, jargon and grammar",
  },
  claim_tagger: {
    label: "Claim tagger",
    icon: Tags,
    color: "var(--agent-claim-tagger)",
    kind: "model",
    role: "Flags factual sentences without a citation",
  },
  fact_checker: {
    label: "Fact-checker",
    icon: ShieldCheck,
    color: "var(--agent-fact-checker)",
    kind: "model",
    role: "Links, then claim support against the quote",
  },
  safety_net: {
    label: "Safety net",
    icon: LifeBuoy,
    color: "var(--agent-code)",
    kind: "code",
    role: "Removes anything still unverified",
  },
  chief_editor: {
    label: "Chief Editor",
    icon: Crown,
    color: "var(--agent-chief-editor)",
    kind: "model",
    role: "One voice across chapters, guarded edits",
  },
  assembler: {
    label: "Assembler",
    icon: BookCopy,
    color: "var(--agent-code)",
    kind: "code",
    role: "Numbers citations, builds reference lists",
  },
}

/** Agents that call a model, in pipeline order (the order of the colour palette). */
export const MODEL_AGENTS = ["planner", "researcher", "writer", "editor", "claim_tagger", "fact_checker", "chief_editor"]

export function agent(name: string | null | undefined): AgentIdentity {
  return (
    (name && AGENTS[name]) || {
      label: name ?? "Run",
      icon: BookCopy,
      color: "var(--agent-code)",
      kind: "code",
      role: "",
    }
  )
}

/** The graph node an agent's activity belongs to (the claim tagger is part of the fact-check). */
export function nodeOf(agentName: string, chapter: number | null): string {
  const name = agentName === "claim_tagger" ? "fact_checker" : agentName
  return chapter ? `chapter:${name}` : name
}
