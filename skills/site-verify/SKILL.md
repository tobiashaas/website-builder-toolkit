---
name: site-verify
description: "Check design and copy work before calling it done, with evidence instead of the agent's own judgment: render at every width, run slop-lint, measure contrast, keyboard, reduced motion and touch targets, trace every fact to the brand profile, review motion frame by frame, and get a score from a fresh reviewer. Use after every pass and before handing over any page, screen, carousel or text."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Verify

Nothing is done because the agent thinks it looks right. Agents tend to report "done" as soon as their own checks pass, and errors compound across steps. A render, a lint run, a measurement or a person decides. Run the short check after every pass and the full check before handing over.

## After every pass

1. Re-render the changed area at real size.
2. Run `node <site-audit>/scripts/slop-lint.mjs <changed paths> --brand <brand.md> [--adapter …] [--lang …]`.
3. Fix errors before starting the next pass.

## Before handing over

Re-read the prohibitions in `site-design` first, then run this as a separate review, not as part of building.

**Render**
- [ ] Screenshots of every page and state at 360, 390, 768, 1024, 1280, 1440 and 1920 px wide, plus the social preview size if it will be shared.
- [ ] Verified on the rendered frontend, not in the editor or builder canvas.
- [ ] No console errors, failed requests, layout shift or flash of unstyled content.

`render-check` renders the live URL in the local Chrome (Node 22+) at every width above and measures overflow (1.4.10), text contrast over the real background, gradient text, endless animations, alt text, accessible names, 24 px targets, zoom lock and console errors; screenshots and `report.md` go to `website-builder/reports/<date>-<slug>-render/`. Exit 1 means an error-level finding. Fix those and check every `manual` finding by hand. Details: `scripts/README.md`.

```
node scripts/render-check.mjs <url> [--reduced-motion] [--level aaa]
```

**Lint**
- [ ] `slop-lint` passes at `--fail-on error` with brand, adapter and language set.
- [ ] Remaining warnings are listed in the report with a reason.

**Measure**
- [ ] Contrast: body text and labels ≥ 4.5:1, large text and UI ≥ 3:1, measured over the real background (images, overlays).
- [ ] Links in running text are recognisable as links.
- [ ] Keyboard: every action reachable, focus visible, order logical.
- [ ] Reduced motion: same information, no movement.
- [ ] Touch targets ≥ 44 × 44 px on phones.
- [ ] Fonts load from one source; each weight used is actually loaded.

**Content**
- [ ] Every number, name and claim traced to the profile's facts table.
- [ ] No placeholder text, no typos, consistent capitalization.
- [ ] Metadata, page titles, social preview image correct.

**Motion** (if anything moves)
- [ ] Watched frame by frame or as a contact sheet: first frame responds at once, last frame settles without a jump, no frame shows a wrong state, interrupting halfway returns smoothly.

**Accessibility:** run `site-accessibility` (WCAG 2.2 AA, contrast matrix, axe scan, manual checks) before handing over.

**Final audit** from `site-design`, then a score from a fresh reviewer (`site-polish`).

## Optional

- Dashboards: review against the cooperative dashboard heuristics by Setlur et al. (IEEE TVCG 2023, arXiv 2308.04514).
- Important pages: a five-second test or think-aloud with real readers. The toolkit can't run it; recommend it in the report.

## Report

Save it as `website-builder/reports/<YYYY-MM-DD>-<page>.md`, screenshots in `website-builder/screenshots/<YYYY-MM-DD>-<page>/` (create the folder if it is missing).


Direction, what changed per pass, lint summary, measurements, screenshots or their paths, score and reviewer, open issues.
