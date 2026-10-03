import { RunShell } from "@/components/run/run-shell"

export default function RunLayout({ children }: LayoutProps<"/runs/[id]">) {
  return <RunShell>{children}</RunShell>
}
