import { agent } from "@/lib/agents"
import { cn } from "@/lib/utils"

/** An agent's icon on a tint of its identity colour. */
export function AgentIcon({ name, size = "md", className }: { name: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const a = agent(name)
  const Icon = a.icon
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        size === "sm" && "size-5 [&_svg]:size-3",
        size === "md" && "size-7 [&_svg]:size-3.5",
        size === "lg" && "size-9 [&_svg]:size-4.5",
        className,
      )}
      style={{ background: `color-mix(in oklab, ${a.color} 16%, transparent)`, color: a.color }}
      aria-hidden
    >
      <Icon />
    </span>
  )
}

/** Icon + name. The name stays in ink; the colour lives on the icon. */
export function AgentChip({ name, className }: { name: string | null; className?: string }) {
  const a = agent(name)
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)}>
      <AgentIcon name={name} size="sm" />
      {a.label}
    </span>
  )
}

export function AgentDot({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: agent(name).color }}
      aria-hidden
    />
  )
}
