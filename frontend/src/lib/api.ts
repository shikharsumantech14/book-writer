// Types and calls for the bookwriter HTTP API (backend/src/bookwriter/api/app.py).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "")

export type RunStatus =
  | "running"
  | "awaiting_review"
  | "completed"
  | "stopped_budget"
  | "cancelled"
  | "failed"
  | "interrupted"

export interface RunSummary {
  run_id: string
  sample: boolean
  status: RunStatus
  profile: string | null
  chapters: number | null
  started_at: string | null
  duration_s: number | null
  cost_usd: number
  scorecard_passed: boolean | null
  title: string | null
  error: string | null
}

export interface UsageBucket {
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
}

export interface Usage {
  total: UsageBucket
  cache_read_share: number
  by_agent: Record<string, UsageBucket>
  by_model: Record<string, UsageBucket>
  by_chapter: Record<string, UsageBucket>
  tavily: { searches: number; extract_reads: number; credits_estimate: number }
}

export interface RoleRouting {
  model: string
  tier: string
  effort: string | null
  revision_effort?: string
}
export type Routing = Record<string, RoleRouting>

export interface RunDetail extends RunSummary {
  pending_outline: Outline | null
  usage: Usage
  scorecard?: Scorecard | null
  chapter_status?: Record<string, { status: string; warnings: string[]; rounds: Record<string, number> }>
  routing?: Routing
}

export interface RunEvent {
  seq: number
  run_id: string
  ts: number
  kind: string
  agent: string | null
  chapter: number | null
  message: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
}

// ----------------------------------------------------------------- the book

export interface FactNeed {
  id: string
  question: string
  why: string
}
export interface ChapterPlan {
  number: number
  title: string
  goal: string
  narrative_arc: string
  key_points: string[]
  fact_needs: FactNeed[]
  takeaway_idea: string
}
export interface Outline {
  book_title: string
  chapters: ChapterPlan[]
  style_guide: {
    reader_persona: string
    voice: string
    do: string[]
    dont: string[]
    glossary: { term: string; plain_explanation: string; introduced_in_chapter: number }[]
    sample_paragraph: string
  }
}

export type SourceType = "official" | "news" | "other"
export interface Evidence {
  id: string
  fact_need_id: string | null
  claim: string
  quote: string
  url: string
  source_name: string
  title: string
  source_type: SourceType
  published: string | null
}
export interface Reference {
  number: number
  source_name: string
  title: string
  url: string
  source_type: SourceType
  evidence_ids: string[]
}
export type Verdict = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "UNCITED"
export interface ClaimCheck {
  sentence_id: number
  sentence: string
  cited: string[]
  verdict: Verdict
  reason: string
}
export interface LinkStatus {
  url: string
  ok: boolean
  status: number | null
  via: string | null
}
export interface FinalChapter {
  number: number
  title: string
  paragraphs: string[]
  takeaway: string
  references: Reference[]
  word_count: number
  evidence: Evidence[]
  claim_checks: ClaimCheck[]
  stats: {
    status: string
    warnings: string[]
    rounds: Record<string, number>
    editor_approved: boolean
    editor_scores: Record<string, number> | null
    fact_check: string | null
    links: LinkStatus[]
    removed_sentences: string[]
    missing_fact_needs: string[]
  }
}

export interface ScoreCheck {
  rule: string
  passed: boolean
  detail: string
}
export interface ChapterGrade {
  number: number
  title: string
  passed: boolean
  checks: ScoreCheck[]
  metrics: {
    word_count: number
    references: number
    official_sources: number
    official_share: number
    claims_checked: number
    claims_supported: number
    editor_approved: boolean | null
    editor_scores: Record<string, number> | null
    rounds: Record<string, number> | null
    removed_sentences: number
    status: string | null
  }
  warnings: string[]
}
export interface Scorecard {
  passed: boolean
  partial_run: boolean
  book: { checks: ScoreCheck[]; metrics: { words: number; references: number; official_share: number } }
  chapters: ChapterGrade[]
}

export interface RunReport {
  run_id: string
  status: RunStatus
  error: string | null
  profile: string
  routing: Routing
  chapters_requested: number
  human_review?: boolean
  started_at: string
  duration_s: number
  usage: Usage
  scorecard: Scorecard | null
  final_chapters: FinalChapter[]
  outline: Outline | null
  chief_editor: { notes: string[]; applied: unknown[]; rejected: unknown[] } | null
}

// ---------------------------------------------------------------- reference data

export interface GraphData {
  nodes: { id: string; name: string; group: "book" | "chapter" }[]
  edges: { source: string; target: string; conditional: boolean }[]
  mermaid: string
}

export interface AppConfig {
  brief: {
    title: string
    audience: string
    chapters: number
    words_min: number
    words_max: number
    tone: string
    citation_rules: string
  }
  default_profile: string
  profiles: Record<string, Routing>
  limits: Record<string, number>
  run: { parallel_chapters: number; max_cost_usd: number | null }
  human_in_the_loop: boolean
}

export interface Estimate {
  profile: string
  chapters: number
  estimate_usd: number
  low_usd: number
  high_usd: number
  basis: string
}

export interface StartRun {
  profile?: string
  chapters?: number
  human_review?: boolean
  max_cost_usd?: number
  parallel_chapters?: number
  brief?: Partial<AppConfig["brief"]>
}

export type ReviewDecision = { action: "approve" } | { action: "cancel" } | { action: "edit"; outline: Outline }

// ---------------------------------------------------------------- calls

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      // Only requests with a body declare JSON: a plain GET then needs no CORS preflight.
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
      cache: "no-store",
    })
  } catch {
    throw new ApiError(0, `Can't reach the API at ${API_URL}. Start it with: uv run bookwriter serve`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.detail ? String(body.detail) : `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const startRun = (body: StartRun) =>
  api<{ run_id: string; status: RunStatus }>("/runs", { method: "POST", body: JSON.stringify(body) })

export const resumeRun = (runId: string, decision: ReviewDecision) =>
  api(`/runs/${runId}/resume`, { method: "POST", body: JSON.stringify(decision) })

export const cancelRun = (runId: string) => api(`/runs/${runId}/cancel`, { method: "POST" })

export const fileUrl = (runId: string, name: "book.md" | "book.html" | "report") => `${API_URL}/runs/${runId}/${name}`
