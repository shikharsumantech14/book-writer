import { AgentChip } from "@/components/agent-chip"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Usage, UsageBucket } from "@/lib/api"
import { int, usd } from "@/lib/format"

function UsageTable({ rows, first, render }: { rows: [string, UsageBucket][]; first: string; render?: (k: string) => React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">{first}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Cache read</TableHead>
            <TableHead className="text-right">Cache write</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="pr-4 text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([k, b]) => (
            <TableRow key={k}>
              <TableCell className="pl-4">{render ? render(k) : k}</TableCell>
              <TableCell className="tabular text-right">{b.calls}</TableCell>
              <TableCell className="tabular text-right">{int(b.input_tokens)}</TableCell>
              <TableCell className="tabular text-right">{int(b.cache_read_tokens)}</TableCell>
              <TableCell className="tabular text-right">{int(b.cache_write_tokens)}</TableCell>
              <TableCell className="tabular text-right">{int(b.output_tokens)}</TableCell>
              <TableCell className="tabular pr-4 text-right font-medium">{usd(b.cost_usd, 3)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function UsageTables({ usage }: { usage: Usage }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Tokens and cost by agent</h3>
        <UsageTable rows={Object.entries(usage.by_agent)} first="Agent" render={(k) => <AgentChip name={k} />} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">By model</h3>
          <UsageTable rows={Object.entries(usage.by_model)} first="Model" />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">By chapter</h3>
          <UsageTable rows={Object.entries(usage.by_chapter)} first="Part" render={(k) => k.replace(/^\w/, (c) => c.toUpperCase())} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Tavily: {usage.tavily.searches} searches and {usage.tavily.extract_reads} extract reads, about {usage.tavily.credits_estimate} credits.
      </p>
    </div>
  )
}
