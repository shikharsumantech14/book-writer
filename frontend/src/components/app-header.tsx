"use client"

import { BookOpenText, Moon, Sun } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApi } from "@/hooks/use-api"
import { API_URL } from "@/lib/api"
import { cn } from "@/lib/utils"

export function AppHeader() {
  const { resolvedTheme, setTheme } = useTheme()
  const health = useApi<{ ok: boolean; version: string }>("/health", 15000)
  const online = Boolean(health.data?.ok) && !health.error

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <BookOpenText className="size-4" />
          </span>
          <span className="leading-tight">
            Book Writer
            <span className="block text-[11px] font-normal text-muted-foreground">six agents, one cited book</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                <span
                  className={cn("size-2 rounded-full", online ? "bg-good" : "bg-critical")}
                  aria-hidden
                />
                {online ? `API v${health.data?.version}` : "API offline"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {online ? API_URL : "Start it with: uv run bookwriter serve (in backend/)"}
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle dark mode"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>
        </div>
      </div>
    </header>
  )
}
