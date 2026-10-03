"use client"

import { ArrowLeft, BookOpenText, ClipboardCheck, Radio } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/hooks/use-api"
import type { RunDetail } from "@/lib/api"
import { duration, runDate, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

const LIVE = new Set(["running", "awaiting_review"])

export function useRunId(): string {
  return useParams<{ id: string }>().id
}

export function RunShell({ children }: { children: ReactNode }) {
  const id = useRunId()
  const pathname = usePathname()
  const detail = useApi<RunDetail>(`/runs/${id}`, 3000)
  const run = detail.data
  const live = run ? LIVE.has(run.status) : false
  const finished = Boolean(run?.scorecard)

  const tabs = [
    { href: `/runs/${id}`, label: live ? "Live" : "Run", icon: Radio, enabled: true },
    { href: `/runs/${id}/book`, label: "Book", icon: BookOpenText, enabled: finished },
    { href: `/runs/${id}/report`, label: "Report", icon: ClipboardCheck, enabled: finished },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {run?.title ?? "Pay Me on UPI: How Digital Payments Changed Small Business in India"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {run && <StatusBadge status={run.status} />}
              {run?.profile && <Badge variant="outline">{run.profile} profile</Badge>}
              {run?.sample && <Badge variant="secondary">committed sample</Badge>}
              <span className="font-mono text-xs">{id}</span>
              {run && <span>· {runDate(id, run.started_at)}</span>}
              {run?.chapters && <span>· {run.chapters} chapter{run.chapters > 1 ? "s" : ""}</span>}
              {run?.duration_s != null && <span>· {duration(run.duration_s)}</span>}
              {run && <span>· {usd(run.cost_usd)}</span>}
            </div>
          </div>
        </div>
        <nav className="flex gap-1 border-b" aria-label="Run views">
          {tabs.map((t) => {
            const active = pathname === t.href
            const Icon = t.icon
            return t.enabled ? (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" /> {t.label}
              </Link>
            ) : (
              <span
                key={t.href}
                className="-mb-px inline-flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground/50"
                title="Available when the run finishes"
              >
                <Icon className="size-4" /> {t.label}
              </span>
            )
          })}
        </nav>
      </div>
      {children}
    </div>
  )
}
