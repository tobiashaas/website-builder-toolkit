---
name: site-polish
description: "Take a working page or screen from fine to finished: design every state, fix the details people feel (forms, hit areas, contrast, layout shift, numbers, focus), decide what may move and how, and climb in small justified steps scored by a fresh reviewer. Use when something works but feels off or unfinished, when adding or reviewing animation, or when asked to polish, refine or level up."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Polish

Composes with: `site-design` (structure comes first), `site-verify` (frame-by-frame checks). Motion rules: [motion.md](motion.md).

For a piece that works but doesn't feel finished. Structure before details: polishing the wrong structure is wasted work.

## Score

A score is only useful if someone other than the author gives it. Ask a fresh reviewer (a person, or an agent with no context and only the render and this table) and report its score, not your own.

| Score | Meaning |
| --- | --- |
| 3 | Works, and looks like every other site in the category |
| 5 | Designed at rest; empty, error and loading states or motion are still defaults |
| 7 | Every state designed, motion correct, nothing memorable yet |
| 8 | One thing people would screenshot; no defect visible at viewing size |
| 9 | That thing holds in every state and input path; a competitor would copy it |
| 10 | Not awarded to your own work |

## Loop

1. Name the weakest thing on screen in one sentence.
2. Fix it with one change you can justify in a sentence. "Looks better" is not a reason.
3. Re-render, re-lint, re-score.
4. Stop when two rounds in a row don't change the score.

When stuck: remove something; look at one element at three times the size; compare side by side with the best example in the category at the same size and name the gap; make three genuinely different versions of the weak part and keep one.

## States

Map every state and design the unhappy ones: empty, loading, error, success, offline, very long content, very short content, no image. The end of a flow is what people remember; success should be more than a label swap.

## Details people feel (check these first)

| Check | Rule |
| --- | --- |
| Forms | 16 px inputs, real labels, `autocomplete`, Enter submits, errors keep the input |
| Hit area | ≥ 44 × 44 px on touch, ≥ 40 × 40 px on desktop, no overlaps |
| Contrast | text ≥ 4.5:1, large text and icons ≥ 3:1, on the real background |
| Layout shift | fixed dimensions or `aspect-ratio` for images and late content |
| Numbers | `font-variant-numeric: tabular-nums` where they change or align |
| Weight on hover | never change `font-weight` on hover or selection; use color |
| Typography | real quotes and ellipsis for the language, `text-wrap: balance` on headings, `pretty` on body, 45–75 characters per line |
| Alignment | two or three dominant vertical lines per screen; optical over mathematical where they differ |
| Focus | visible, neutral color, never removed |
| Press | slight scale-down (about 0.96), never below 0.95 |
| Stacking | a fixed z-index scale; no `9999` |
| Decoration | `pointer-events: none` so it can't steal clicks |
| First paint | resolve state before render; no default-then-correct flash |

## Report

Score from the fresh reviewer, what changed per round with its reason, the thing people would screenshot (or that there isn't one yet), and what still stands between the piece and the next score.
