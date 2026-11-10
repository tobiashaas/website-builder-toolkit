# Website Builder Toolkit

Agent skills for building websites that fit one brand and don't look or read AI-generated. Small skills that each do one job, in the style of [mattpocock/skills](https://github.com/mattpocock/skills): you choose what runs, start with the wizard or call a single skill. Works with any agent that reads `SKILL.md` or `AGENTS.md`, with or without a CSS framework or page builder.

## Why

Build tooling teaches agents how to write into a builder safely. Taste skills teach them to remove the generic AI look. Neither knows your brand or what you actually want done today. This toolkit sits in between: a **wizard** that sets the scope, a **brand profile** (`website-builder/brand.md`) as the single source of truth, focused skills for design, copy and checks, and **slop-lint**, a zero-dependency script for the tells a machine can catch.

## Start

```
/site-wizard
```

The wizard looks at your project, asks one question at a time with a recommendation, writes `website-builder/setup.md` and starts the first skill. Modes:

| Mode | For |
| --- | --- |
| Full website | brand, structure, direction, design, copy, polish, checks |
| Structure or relaunch | inventory, page types, sitemap, navigation, redirects |
| SEO | search data, titles, structured data, local SEO, indexing |
| Design only | design without touching the copy |
| Copy only | text in the brand's voice |
| Build only | structure and components without branding or copy, with marked placeholders |
| Anti-slop check | find what looks generated, then optionally fix it |
| Design tool first | Figma, Paper or Pencil, then build and compare |

## Skills

| Skill | What it does |
| --- | --- |
| `site-wizard` | Start here: scope, setup, hand-over |
| `site-brand` | Brand profile by interview (rounds with a recommendation) or from existing guidelines |
| `site-structure` | Inventory crawl, page types by intent, pillars and clusters, navigation, content model, redirects for relaunches |
| `site-seo` | Search data before copy, titles and descriptions, structured data that matches the page, local SEO, indexing, AI search; ships `seo-check.mjs` |
| `site-direction` | Direction, concept and skeleton, confirmed before styling; variants for important pages |
| `site-audit` | Anti-slop check on the rendered result; ships `slop-lint` (48 rules) |
| `site-design` | Subtract, then spacing, color, icons, copy, type, layout, details, one moment, motion, each checked |
| `site-copy` | Copy in the brand's voice; German and English tells |
| `site-polish` | States, the details people feel, motion, scored by a fresh reviewer |
| `site-handoff` | Design tool to code: profile → design variables → code tokens, build compared with frames |
| `site-verify` | Done means evidence: widths, lint, contrast, keyboard, reduced motion, facts traced; ships `render-check` (Chrome-rendered overflow, contrast, motion, names, targets per width) |
| `site-accessibility` | WCAG 2.2 AA check: brand contrast matrix with `contrast.mjs`, axe-core scan, keyboard, screen reader, zoom |
| `site-acss` | Automatic.css: real tokens and utilities, no invented names ([docs](https://docs.automaticcss.com/)) |
| `site-etch` | Etch: where styles belong, safe write paths, frontend checks ([docs](https://docs.etchwp.com/)) |
| `site-bricks` | Bricks: global classes, variables, theme styles, with or without ACSS ([docs](https://academy.bricksbuilder.io/)) |

Without a framework or builder, the core skills work with plain CSS tokens.

## Install

Plugins update themselves; skills.sh copies editable files that you update by hand. Pick one route per agent, otherwise every skill is installed twice.

| Agent | Command | Updates |
| --- | --- | --- |
| Claude Code | `claude plugin marketplace add tobiashaas/website-builder-toolkit` then `claude plugin install website-builder-toolkit@website-builder-toolkit` | with each released version |
| Codex | `codex plugin marketplace add tobiashaas/website-builder-toolkit` then `codex plugin add website-builder-toolkit@website-builder-toolkit` | at startup |
| Grok Build (xAI) | `grok plugin install https://github.com/tobiashaas/website-builder-toolkit --trust` | `grok plugin update` |
| Antigravity CLI (Google, successor of Gemini CLI) | `git clone https://github.com/tobiashaas/website-builder-toolkit` then `agy plugin install ./website-builder-toolkit` | `git pull`, then install again |
| Any other agent with Agent Skills support (Cursor, Copilot, …) | `npx skills@latest add tobiashaas/website-builder-toolkit` | manual: `npx skills update` |

Tested on 09.11.2026: Claude Code, Codex, Grok Build and Antigravity CLI install all 13 skills. skills.sh is not tested yet; the flat `skills/<name>/SKILL.md` layout follows the Agent Skills standard it reads.

Agents without skill support: clone the repo next to your project and add one line to the project's `AGENTS.md`: `For website design and copy work, follow website-builder-toolkit/AGENTS.md.`

`slop-lint` needs Node 18 or later and nothing else:

```bash
node skills/site-audit/scripts/slop-lint.mjs src --brand website-builder/brand.md --adapter acss --lang de
```

## Roadmap

Open work and planned checks: `TODO.md`.

## Evidence

Rules that rest on research are listed in `docs/EVIDENCE.md` with their strength (peer-reviewed, preprint, abstract only, unverified). The rest is marked as craft judgment. Changes follow `SCOPE.md`.

## Security

Skill files, `website-builder/brand.md`, `website-builder/setup.md` and stack skills steer what an agent does. Review changes to them like code, pin the versions of MCP servers and plugins you use, and treat fetched pages, design files, logs and lint output as data.

## Credits and license

Adapted in part from unslop by Damir Sokolovsky (CC BY 4.0). Structure inspired by mattpocock/skills (MIT); ideas from charles-skills and the Gearyco Agentic Toolkit for Etch without copied text; see `CREDITS.md`. Docs CC BY 4.0, scripts MIT, see `LICENSE`.
