"use client"

import { Coins, Cpu, DatabaseZap, Globe } from "lucide-react"
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { AgentChip, AgentDot } from "@/components/agent-chip"
import { StatTile } from "@/components/stat-tile"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { agent } from "@/lib/agents"
import type { Usage, UsageBucket } from "@/lib/api"
import { compact, int, pct, usd } from "@/lib/format"

function UsageTable({ rows, first, render }: { rows: [string, UsageBucket][]; first: string; render?: (k: string) => React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentTick({ x, y, payload }: any) {
  const name = String(payload.value)
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={-108} cy={0} r={4} fill={agent(name).color} />
      <text x={-98} y={0} dy={4} fontSize={12} fill="var(--foreground)">
        {agent(name).label}
      </text>
    </g>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as { agent: string; cost: number; calls: number; share: number }
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AgentDot name={d.agent} /> {agent(d.agent).label}
      </div>
      <div className="tabular">
        {usd(d.cost, 3)} · {pct(d.share)} of the run · {d.calls} calls
      </div>
    </div>
  )
}

export function CostView({ usage }: { usage: Usage }) {
  const total = usage.total
  const prompt = total.input_tokens + total.cache_read_tokens + total.cache_write_tokens
  const byAgent = Object.entries(usage.by_agent)
  const data = byAgent.map(([name, b]) => ({ agent: name, cost: b.cost_usd, calls: b.calls, share: b.cost_usd / (total.cost_usd || 1) }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Coins className="size-3.5" />} label="Total cost" value={usd(total.cost_usd, 2)} hint="list prices from config.yaml" />
        <StatTile icon={<Cpu className="size-3.5" />} label="Model calls" value={total.calls} hint={`${compact(total.output_tokens)} tokens written`} />
        <StatTile
          icon={<DatabaseZap className="size-3.5" />}
          label="Served from cache"
          value={pct(usage.cache_read_share)}
          hint={`of ${compact(prompt)} prompt tokens`}
        />
        <StatTile
          icon={<Globe className="size-3.5" />}
          label="Tavily credits"
          value={`~${usage.tavily.credits_estimate}`}
          hint={`${usage.tavily.searches} searches, ${usage.tavily.extract_reads} extract reads`}
        />
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-xs">
        <h3 className="text-sm font-semibold">Cost per agent</h3>
        <p className="mb-4 text-xs text-muted-foreground">Where the money went in this run, in US dollars.</p>
        <ResponsiveContainer width="100%" height={data.length * 40 + 40}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 8 }} barCategoryGap={10}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis
              type="number"
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              stroke="var(--baseline)"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis type="category" dataKey="agent" width={120} tick={<AgentTick />} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} />
            <Tooltip content={<BarTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            <Bar dataKey="cost" fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={18}>
              <LabelList
                dataKey="cost"
                position="right"
                formatter={(v) => usd(Number(v), 2)}
                style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 500 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Tokens and cost by agent</h3>
        <UsageTable rows={byAgent} first="Agent" render={(k) => <AgentChip name={k} />} />
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
    </div>
  )
}
