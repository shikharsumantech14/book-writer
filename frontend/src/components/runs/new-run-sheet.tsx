"use client"

import { Play, Plus, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AgentChip } from "@/components/agent-chip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useApi } from "@/hooks/use-api"
import { MODEL_AGENTS } from "@/lib/agents"
import { type AppConfig, type Estimate, startRun } from "@/lib/api"
import { usd } from "@/lib/format"

export function NewRunSheet({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const config = useApi<AppConfig>(open ? "/config" : null)
  const [profile, setProfile] = useState("dev")
  const [chapters, setChapters] = useState(1)
  const [review, setReview] = useState(false)
  const [maxCost, setMaxCost] = useState("")
  const [brief, setBrief] = useState<AppConfig["brief"] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const estimate = useApi<Estimate>(open ? `/estimate?profile=${profile}&chapters=${chapters}` : null)

  // Pre-fill the brief and defaults once the config arrives.
  const cfg = config.data
  useEffect(() => {
    if (!cfg || brief) return
    const id = requestAnimationFrame(() => {
      setBrief(cfg.brief)
      setReview(cfg.human_in_the_loop)
      setMaxCost(String(cfg.run.max_cost_usd ?? ""))
    })
    return () => cancelAnimationFrame(id)
  }, [cfg, brief])

  const routing = cfg?.profiles[profile]

  async function submit() {
    setSubmitting(true)
    try {
      const run = await startRun({
        profile,
        chapters,
        human_review: review,
        max_cost_usd: maxCost ? Number(maxCost) : undefined,
        brief: brief ?? undefined,
      })
      toast.success("Run started", { description: run.run_id })
      setOpen(false)
      router.push(`/runs/${run.run_id}`)
    } catch (e) {
      toast.error("Couldn't start the run", { description: (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button disabled={disabled}>
          <Plus /> New run
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>New run</SheetTitle>
          <SheetDescription>Research and write the book. The brief is pre-filled from config.yaml.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Routing profile</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">dev · Sonnet for judgement</SelectItem>
                  <SelectItem value="showcase">showcase · Opus for judgement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Chapters to write</Label>
              <Select value={String(chapters)} onValueChange={(v) => setChapters(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (debug run)</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3 (the whole book)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cap">Cost cap (USD)</Label>
              <Input id="cap" inputMode="decimal" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
            </div>
            <div className="flex items-end justify-between gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor="review" className="leading-snug">
                Review the outline
                <span className="block text-xs font-normal text-muted-foreground">pause after the Planner</span>
              </Label>
              <Switch id="review" checked={review} onCheckedChange={setReview} />
            </div>
          </div>

          <div className="rounded-xl border bg-muted/40 p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase">Estimated cost</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {estimate.data ? usd(estimate.data.estimate_usd) : "…"}
            </div>
            {estimate.data && (
              <p className="text-xs text-muted-foreground">
                {usd(estimate.data.low_usd)}–{usd(estimate.data.high_usd)} · {estimate.data.basis}
              </p>
            )}
          </div>

          {routing && (
            <div className="space-y-2">
              <Label>Model routing on {profile}</Label>
              <div className="divide-y rounded-lg border">
                {MODEL_AGENTS.map((role) => (
                  <div key={role} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <AgentChip name={role} />
                    <span className="text-right text-muted-foreground">
                      {routing[role]?.model.replace("claude-", "")}
                      {routing[role]?.effort && ` · ${routing[role].effort}`}
                      {routing[role]?.revision_effort && `, ${routing[role].revision_effort} on rewrites`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brief && (
            <div className="space-y-3">
              <Label>Brief</Label>
              <Input value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} />
              <Input value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} />
              <Textarea rows={4} value={brief.tone} onChange={(e) => setBrief({ ...brief, tone: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                {brief.words_min}–{brief.words_max} words per chapter · every fact cited · official sources first
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="border-t">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            This starts a real run: it calls Claude and Tavily and spends API credit, up to the cost cap.
          </p>
          <Button onClick={submit} disabled={submitting || !cfg}>
            <Play /> {submitting ? "Starting…" : "Start run"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
