"use client"

import "@xyflow/react/dist/style.css"

import {
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useState } from "react"

import { AgentIcon } from "@/components/agent-chip"
import { agent } from "@/lib/agents"
import type { GraphData, Routing } from "@/lib/api"
import type { RunView } from "@/lib/run-state"
import { activeNodes } from "@/lib/run-state"
import { cn } from "@/lib/utils"

// Hand-placed layout for the graph exported by GET /graph. The chapter subgraph is a "U":
// research → write → lint across the top, editor → fact-check → safety net back along the bottom,
// so every send-back loop has room to be seen.
const W = 184
const H = 64
const POS: Record<string, { x: number; y: number }> = {
  planner: { x: 0, y: 0 },
  outline_review: { x: 260, y: 0 },
  "chapter:researcher": { x: 0, y: 170 },
  "chapter:writer": { x: 260, y: 170 },
  "chapter:lint": { x: 520, y: 170 },
  "chapter:safety_net": { x: 0, y: 330 },
  "chapter:fact_checker": { x: 260, y: 330 },
  "chapter:editor": { x: 520, y: 330 },
  chief_editor: { x: 0, y: 500 },
  assembler: { x: 260, y: 500 },
}
// [source side, target side] per edge: t/r/b/l
const SIDES: Record<string, [string, string]> = {
  "planner>outline_review": ["r", "l"],
  "outline_review>chapter:researcher": ["b", "t"],
  "chapter:researcher>chapter:writer": ["r", "l"],
  "chapter:writer>chapter:lint": ["r", "l"],
  "chapter:lint>chapter:writer": ["t", "t"],
  "chapter:lint>chapter:editor": ["b", "t"],
  "chapter:lint>chapter:fact_checker": ["b", "t"],
  "chapter:editor>chapter:fact_checker": ["l", "r"],
  "chapter:editor>chapter:writer": ["t", "b"],
  "chapter:fact_checker>chapter:writer": ["t", "b"],
  "chapter:fact_checker>chapter:researcher": ["t", "b"],
  "chapter:fact_checker>chapter:safety_net": ["l", "r"],
  "chapter:safety_net>chief_editor": ["b", "t"],
  "chief_editor>assembler": ["r", "l"],
}
const BACK_EDGES = new Set([
  "chapter:lint>chapter:writer",
  "chapter:editor>chapter:writer",
  "chapter:fact_checker>chapter:writer",
  "chapter:fact_checker>chapter:researcher",
])
const FLASH_MS = 2600

interface AgentNodeData extends Record<string, unknown> {
  name: string
  chapters: number[]
  active: boolean
  detail: string
}

const SIDE_POS = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left }

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const a = agent(data.name)
  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 rounded-xl border bg-card px-3 shadow-xs transition-[box-shadow,border-color] duration-300",
        a.kind !== "model" && "border-dashed",
        data.active && "animate-node-pulse",
      )}
      style={{
        width: W,
        height: H,
        borderColor: data.active ? a.color : undefined,
        ["--pulse-color" as string]: a.color,
      }}
    >
      {(["t", "r", "b", "l"] as const).flatMap((side) => [
        <Handle key={`${side}-s`} id={`${side}-s`} type="source" position={SIDE_POS[side]} className="!opacity-0" />,
        <Handle key={`${side}-t`} id={`${side}-t`} type="target" position={SIDE_POS[side]} className="!opacity-0" />,
      ])}
      <AgentIcon name={data.name} size="lg" />
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight font-semibold">{a.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{data.detail}</div>
      </div>
      {data.chapters.length > 0 && (
        <div className="absolute -top-2.5 right-2 flex gap-1">
          {data.chapters.map((n) => (
            <span
              key={n}
              className="rounded-full border bg-card px-1.5 text-[10px] leading-4 font-semibold shadow-xs"
              style={{ borderColor: a.color }}
            >
              Ch {n}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ChapterGroup() {
  return (
    <div className="pointer-events-none h-full w-full rounded-2xl border border-dashed border-baseline bg-muted/30">
      <span className="absolute -top-3 left-4 rounded-md bg-card px-2 text-[11px] font-medium text-muted-foreground">
        Chapter subgraph · one per chapter, in parallel
      </span>
    </div>
  )
}

const nodeTypes = { agent: AgentNode, group: ChapterGroup }

function nodeDetail(name: string, routing: Routing | null): string {
  const a = agent(name)
  if (a.kind === "code") return "code, no model"
  if (a.kind === "human") return "you, if enabled"
  const r = routing?.[name === "fact_checker" ? "fact_checker" : name]
  if (!r) return a.role
  const model = r.model.replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2")
  return `${model}${r.effort ? ` · ${r.effort}` : ""}`
}

export function AgentGraph({ graph, view }: { graph: GraphData; view: RunView }) {
  const { resolvedTheme } = useTheme()
  const [now, setNow] = useState(() => Date.now())
  const replaying = !view.finished
  useEffect(() => {
    if (!replaying) return
    const id = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(id)
  }, [replaying])

  const active = activeNodes(view)
  const flashing = new Map<string, string>() // edge key -> reviewer node
  // Only while the run is unfolding: a finished recording loaded in one go has nothing "just sent back".
  for (const s of replaying ? view.sendBacks : []) {
    if (now - s.receivedAt < FLASH_MS) flashing.set(`${s.from}>${s.to}`, s.from)
  }

  // React Flow measures each node once and keeps the size on the node object, so nodes live in
  // React Flow state and only their `data` is updated; rebuilding them would drop the measurements.
  const initial: Node[] = useMemo(() => {
    const list: Node[] = [
      {
        id: "chapter-group",
        type: "group",
        position: { x: -28, y: 132 },
        style: { width: 520 + W + 56, height: 330 + H - 132 + 46 },
        data: {},
        selectable: false,
        draggable: false,
        zIndex: -1,
      },
    ]
    for (const n of graph.nodes) {
      const pos = POS[n.id]
      if (!pos) continue // __start__ / __end__ markers
      list.push({
        id: n.id,
        type: "agent",
        position: pos,
        draggable: false,
        selectable: false,
        data: { name: n.name, chapters: [], active: false, detail: nodeDetail(n.name, null) },
      })
    }
    return list
  }, [graph])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial)

  const activeKey = JSON.stringify([...active])
  useEffect(() => {
    const busy = new Map<string, number[]>(JSON.parse(activeKey))
    setNodes((current) =>
      current.map((n) =>
        n.type === "agent"
          ? {
              ...n,
              data: {
                ...n.data,
                chapters: busy.get(n.id) ?? [],
                active: busy.has(n.id),
                detail: nodeDetail(String(n.data.name), view.routing),
              },
            }
          : n,
      ),
    )
  }, [activeKey, view.routing, setNodes])

  const edges: Edge[] = graph.edges
    .map((e) => ({ ...e, target: e.target === "chapter:__start__" ? "chapter:researcher" : e.target }))
    .filter((e) => POS[e.source] && POS[e.target])
    .map((e) => {
      const key = `${e.source}>${e.target}`
      const [s, t] = SIDES[key] ?? ["r", "l"]
      const reviewer = flashing.get(key)
      const color = reviewer
        ? agent(reviewer.replace("chapter:", "")).color
        : "color-mix(in oklab, var(--muted-foreground) 60%, transparent)"
      return {
        id: key,
        source: e.source,
        target: e.target,
        sourceHandle: `${s}-s`,
        targetHandle: `${t}-t`,
        type: BACK_EDGES.has(key) ? "default" : "smoothstep",
        animated: Boolean(reviewer),
        style: {
          stroke: color,
          strokeWidth: reviewer ? 2.5 : 1.5,
          strokeDasharray: e.conditional && !reviewer ? "5 4" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        zIndex: reviewer ? 10 : 0,
      }
    })

  return (
    <div className="h-[560px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        minZoom={0.4}
        maxZoom={1.4}
        style={{ background: "transparent" }}
      >
        <Background gap={20} size={1} color="var(--grid)" />
      </ReactFlow>
    </div>
  )
}
