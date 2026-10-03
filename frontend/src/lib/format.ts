export const usd = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

export const compact = (n: number | null | undefined) =>
  n == null ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)

export const int = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))

export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`)

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—"
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false })
}

export function runDate(runId: string, startedAt?: string | null): string {
  const iso = startedAt ?? runId.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2}).*/, "$1-$2-$3T$4:$5:$6")
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? runId
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
