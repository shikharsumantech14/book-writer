"use client"

import { useEffect, useRef, useState } from "react"

import { API_URL, type RunEvent } from "@/lib/api"
import type { TimedEvent } from "@/lib/run-state"

export interface EventStream {
  events: TimedEvent[]
  connected: boolean
  ended: boolean
  error: string | null
}

const EMPTY: EventStream = { events: [], connected: false, ended: false, error: null }

/**
 * Follow a run's Server-Sent Events. Live runs stream as they happen; finished runs stream
 * their recording, paced by `speed` when replaying. Events are buffered and flushed once per
 * animation frame, so a 300-event catch-up renders once, not 300 times. The browser's
 * EventSource reconnects on its own and sends Last-Event-ID, so nothing is missed or repeated.
 *
 * State is keyed by (run, speed, session): bumping `session` (the Replay button) starts a
 * fresh stream without a reset step that could race with arriving events.
 */
export function useRunEvents(runId: string, { speed, session }: { speed?: number; session: number }): EventStream {
  const key = `${runId}|${speed ?? ""}|${session}`
  const [state, setState] = useState<EventStream & { key: string }>({ key, ...EMPTY })
  const buffer = useRef<TimedEvent[]>([])

  useEffect(() => {
    buffer.current = []
    let frame = 0
    let ended = false
    const update = (fn: (s: EventStream) => EventStream) =>
      setState((prev) => ({ key, ...fn(prev.key === key ? prev : EMPTY) }))

    const params = new URLSearchParams()
    if (speed) params.set("speed", String(speed))
    const source = new EventSource(`${API_URL}/runs/${runId}/events${params.size ? `?${params}` : ""}`)

    const flush = () => {
      frame = 0
      const batch = buffer.current
      buffer.current = []
      if (batch.length) update((s) => ({ ...s, events: [...s.events, ...batch] }))
    }

    source.onopen = () => update((s) => ({ ...s, connected: true, error: null }))
    source.onmessage = (msg) => {
      buffer.current.push({ ...(JSON.parse(msg.data) as RunEvent), receivedAt: Date.now() })
      if (!frame) frame = requestAnimationFrame(flush)
    }
    source.addEventListener("end", () => {
      ended = true
      source.close()
      flush()
      update((s) => ({ ...s, ended: true, connected: false }))
    })
    source.onerror = () => {
      if (!ended) update((s) => ({ ...s, connected: false, error: "Connection lost; reconnecting…" }))
    }
    return () => {
      ended = true
      source.close()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, runId, speed])

  return state.key === key ? state : EMPTY
}
