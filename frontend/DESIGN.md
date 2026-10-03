# Design system

The dashboard's job is to make a multi-agent run legible: who is working, on which chapter, what it
cost, and whether the book follows the brief. The design is quiet so the agents and the data can be loud.

All tokens live in [`src/app/globals.css`](src/app/globals.css) as CSS variables, with separate values for
light and dark mode. Components use the tokens (through Tailwind classes such as `bg-card` or
`text-good`), never raw hex.

## Principles

1. **Identity is consistent.** Each agent has one colour and one icon, used the same way on the assembly
   line, the timeline, the activity feed, chapter lanes, badges, charts and the How it works pictures.
2. **Colour never works alone.** Every agent colour sits next to the agent's name; every status colour
   comes with an icon and a label. Text is always in ink tokens, never in a data colour.
3. **Numbers are honest.** Costs come from the run's recorded events, priced from `config.yaml`. Charts
   start at zero, use one axis, and label values directly.
4. **Two typefaces, two jobs.** Inter for the interface; Source Serif 4 for the book and for display
   titles, because the product makes books.
5. **Each page has the character of its job.** The tokens and identity are shared, but the Run page is a
   mission-control console, the Book page a printed page, the Report a data dashboard, and Runs and How it
   works a clean product style. See *Page characters* below.

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

## Page characters

| Page | Character | How |
|---|---|---|
| Run | Mission control: dark, glowing stations, live numbers | `.console` re-scopes the tokens to a fixed dark palette (near-black plane, cool ink, a faint 28px grid, teal accent `--console-accent`, red `--console-live`) whatever the app theme; `.console-panel` surfaces; `.hud-label` mono caps for labels |
| Book | A printed page | `.paper` re-scopes the tokens to warm paper and ink (`--paper`, `--paper-ink`, `--paper-muted`, `--paper-rule`, `--paper-accent`, `--paper-mark`), a night sepia in dark mode; serif body with indented paragraphs, `.drop-cap`, `.small-caps` |
| Report | A data dashboard | Cards on the page plane: KPI tiles, matrices, heatmaps and charts, following *Charts* below |
| Runs, How it works | Clean product | The base tokens, serif display titles, soft radial tints behind hero cards |

## Typography

| Role | Face | Size and weight |
|---|---|---|
| Interface | Inter (`--font-sans`) | 14px body; 24px semibold page titles; 11-12px meta |
| Book and display | Source Serif 4 (`--font-serif`) | 18px / 1.8 line height body; 32-38px chapter titles; display titles on Runs and How it works |
| Code and ids | Geist Mono (`--font-mono`) | 11-12px run ids and timestamps |

Numbers in tables and counters use tabular figures (`.tabular`); headline numbers use proportional ones.

## Shape, depth and motion

- Radius: `--radius` 10px; cards use `rounded-2xl`, chips `rounded-full`.
- Depth: hairline borders and `shadow-xs`; nothing floats except popovers and dialogs. The console and the
  paper page add one soft, large shadow.
- Motion explains: the station at work pings and spins in its agent's colour (`animate-station-ping`,
  `animate-spin-slow`); a fresh send-back draws its loop dashed and moving (`animate-dash-flow`) for about
  2.5 s; the live badge blinks; feed rows fade in. All motion is switched off under `prefers-reduced-motion`.

## Components

shadcn/ui (Radix primitives, Nova preset) themed from the tokens above, plus a few of our own:

| Component | Where |
|---|---|
| `AgentIcon`, `AgentChip`, `AgentDot` | Every place an agent appears |
| `StatusBadge`, `PassMark` | Run and chapter status, scorecard checks |
| `AssemblyLine` | Run page: one lane per chapter, stations and loops taken from `GET /graph`, send-backs counted |
| `RunTimeline` | Run page: a Gantt of who worked when, built from the event log (`lib/timeline.ts`) |
| `Hud`, `ActivityFeed`, `ChapterLanes` | Run page: live numbers, the filterable feed, per-chapter counters |
| `Citation`, `SourceNote` | Book page: `[n]` markers; the source opens in the margin (under the paragraph on phones), never over the text |
| `ReportDashboard` | Report page: verdict, KPI tiles, scorecard matrix, score heatmap, stacked bars, cost and spend charts |
| `HowABookIsMade`, `SystemDiagram` | `/explain`: fixed-size pictures, also captured as the README's PNGs |

## Charts

Following the dataviz method: bars at most 24px thick with 4px rounded ends, a single hue for magnitude,
values at the bar tips, hairline gridlines, a tooltip on every mark, and the raw numbers in the Details tab.
Agent identity in a magnitude chart is a coloured dot beside the agent's name, not the bar colour; where the
series are agents (effort by chapter, the timeline), the bars wear the agent colours with a legend. Status
colours appear only for status (fact-check verdicts), and the editor-score heatmap uses one sequential hue.
