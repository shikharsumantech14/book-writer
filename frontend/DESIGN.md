# Design system

The dashboard's job is to make a multi-agent run legible: who is working, on which chapter, what it
cost, and whether the book follows the brief. The design is quiet so the agents and the data can be loud.

All tokens live in [`src/app/globals.css`](src/app/globals.css) as CSS variables, with separate values for
light and dark mode. Components use the tokens (through Tailwind classes such as `bg-card` or
`text-good`), never raw hex.

## Principles

1. **Identity is consistent.** Each agent has one colour and one icon, used the same way in the agent
   graph, the activity feed, chapter lanes, badges and charts.
2. **Colour never works alone.** Every agent colour sits next to the agent's name; every status colour
   comes with an icon and a label. Text is always in ink tokens, never in a data colour.
3. **Numbers are honest.** Costs come from the run's recorded events, priced from `config.yaml`. Charts
   start at zero, use one axis, and label values directly.
4. **Two typefaces, two jobs.** Inter for the interface; Source Serif 4 for the book, because the
   reader screen should feel like reading, not like a dashboard.

## Colour

### Surfaces and ink (warm neutrals)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` (page plane) | `#f4f3ef` | `#0d0d0d` | Page |
| `--card` (surface) | `#fcfcfb` | `#1a1a19` | Cards, charts, the book page |
| `--foreground` | `#161614` | `#f5f5f3` | Primary ink |
| `--muted-foreground` | `#63625d` | `#a9a89f` | Secondary text, axis labels |
| `--grid` / `--baseline` | `#e1e0d9` / `#c3c2b7` | `#2c2c2a` / `#383835` | Chart gridlines and axes |

### Brand

`--primary` is a deep teal, `#0f6b62` in light mode and `#3fc0ae` in dark mode: the colour of a paid ledger line. It is used for
primary actions, links, citation markers, the takeaway rule and magnitude bars. It is not an agent colour.

### Agent identity

A categorical palette validated for colour-vision deficiency with the dataviz validator
(adjacent-pair ΔE ≥ 8 under protanopia, deuteranopia and tritanopia, normal-vision ΔE ≥ 15, in both
modes). The slots are assigned in pipeline order, the order agents appear in the graph and the legend.
That order is part of the validation, so it is not rearranged for meaning.

| Agent | Token | Light | Dark | Icon |
|---|---|---|---|---|
| Planner | `--agent-planner` | `#2a78d6` | `#3987e5` | Compass |
| Researcher | `--agent-researcher` | `#eb6834` | `#d95926` | Search |
| Writer | `--agent-writer` | `#1baf7a` | `#199e70` | Pen |
| Editor | `--agent-editor` | `#eda100` | `#c98500` | Highlighter |
| Claim tagger | `--agent-claim-tagger` | `#e87ba4` | `#d55181` | Tags |
| Fact-checker | `--agent-fact-checker` | `#008300` | `#008300` | Shield check |
| Chief Editor | `--agent-chief-editor` | `#4a3aa7` | `#9085e9` | Crown |
| Code steps (lint, safety net, assembler) | `--agent-code` | `#898781` | `#898781` | Ruler, life buoy, books |
| Outline review (a person) | `--agent-human` | `#52514e` | `#c3c2b7` | User check |

Three light-mode agent colours (writer, editor, claim tagger) are below 3:1 contrast on the surface,
which is why an agent colour is never used for text and always appears beside the agent's name.

### Status

Fixed in both themes and never reused as a series colour: `--status-good` `#0ca30c`,
`--status-warning` `#fab219`, `--status-serious` `#ec835a`, `--status-critical` `#d03b3b`. Shown only as
an icon colour next to a label (`StatusBadge`, `PassMark`).

## Typography

| Role | Face | Size and weight |
|---|---|---|
| Interface | Inter (`--font-sans`) | 14px body; 24px semibold page titles; 11-12px meta |
| Book | Source Serif 4 (`--font-serif`) | 18px / 1.8 line height body; 30px chapter titles |
| Code and ids | Geist Mono (`--font-mono`) | 11-12px run ids and timestamps |

Numbers in tables and counters use tabular figures (`.tabular`); headline numbers use proportional ones.

## Shape, depth and motion

- Radius: `--radius` 10px; cards use `rounded-xl`, chips `rounded-full`.
- Depth: hairline borders and `shadow-xs`; nothing floats except popovers and dialogs.
- Motion: agents working pulse in their own colour (`animate-node-pulse`); a send-back animates the
  loop edge in the reviewer's colour for about 2.5 s; feed rows fade in. All motion is switched off
  under `prefers-reduced-motion`.

## Components

shadcn/ui (Radix primitives, Nova preset) themed from the tokens above, plus a few of our own:

| Component | Where |
|---|---|
| `AgentIcon`, `AgentChip`, `AgentDot` | Every place an agent appears |
| `StatusBadge`, `PassMark` | Run and chapter status, scorecard checks |
| `StatTile` | Headline numbers: cost, calls, cache share |
| `AgentGraph` (React Flow) | The graph from `GET /graph`, laid out by hand |
| `Citation` (hover card) | `[n]` markers in the book: source, verified quote, link and fact-check status |

## Charts

Recharts, following the dataviz method: bars at most 24px thick with 4px rounded ends at the data end,
a single hue for magnitude, values at the bar tips, hairline gridlines, a hover tooltip on every mark, and
a table view under every chart. Agent identity in a chart is a coloured dot beside the agent's name on
the axis.
