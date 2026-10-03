"use client"

import { Check, PencilLine, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type Outline, resumeRun, type ReviewDecision } from "@/lib/api"

/** Human in the loop: the run is paused after the Planner until this is answered. */
export function OutlineReviewDialog({ runId, outline }: { runId: string; outline: Outline }) {
  const [draft, setDraft] = useState<Outline>(outline)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  const edited = JSON.stringify(draft) !== JSON.stringify(outline)

  const setChapter = (i: number, patch: Partial<Outline["chapters"][number]>) =>
    setDraft({ ...draft, chapters: draft.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  async function decide(decision: ReviewDecision) {
    setBusy(true)
    try {
      await resumeRun(runId, decision)
      toast.success(decision.action === "cancel" ? "Run cancelled" : "Outline sent; the run continues")
      setOpen(false)
    } catch (e) {
      toast.error("Couldn't send the decision", { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review the outline</DialogTitle>
          <DialogDescription>
            The Planner has finished. Research and writing start when you approve. Edit chapter titles and goals if
            you like.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {draft.chapters.map((c, i) => (
            <div key={c.number} className="space-y-2 rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">Chapter {c.number}</div>
              <Input value={c.title} onChange={(e) => setChapter(i, { title: e.target.value })} />
              <Textarea rows={2} value={c.goal} onChange={(e) => setChapter(i, { goal: e.target.value })} />
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {c.fact_needs.map((f) => (
                  <li key={f.id}>{f.question}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => decide({ action: "cancel" })}>
            <X /> Reject and cancel
          </Button>
          {edited ? (
            <Button disabled={busy} onClick={() => decide({ action: "edit", outline: draft })}>
              <PencilLine /> Continue with my edits
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => decide({ action: "approve" })}>
              <Check /> Approve
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
