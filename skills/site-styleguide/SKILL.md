---
name: site-styleguide
description: "Build, check or update the styleguide of an Automatic.css (ACSS) project: a worksheet whose values someone types into the ACSS dashboard, optionally mirrored in the design tool. Use when the user asks for a styleguide, design tokens or dashboard values, or asks whether the styleguide still matches after a design change (new font, new surface colour, new component)."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-13 -->
# Styleguide for Automatic.css projects

**Use this if** the project loads Automatic.css and needs its design decisions written down so that they can be entered in the ACSS dashboard. A styleguide here has one job: someone types its values into the dashboard. It therefore uses the dashboard's names and inputs, never the names of the design file or of an earlier project. Token rules are in `site-acss`; this skill is the order of work.

Output: `website-builder/styleguide.md`. A copy as an artboard in the design tool is optional and must say the same thing.

## 1. Find out what the design really uses

- Read the brand profile (`website-builder/brand.md`). Brand values come from there. Missing values are marked "not defined", never filled with a plausible guess.
- Count real usage per role in the design (export the frames, list colours, sizes, families). Token lists in design files are often unbound or stale.
- Check every ACSS name against the project's compiled `automatic.css` (`wp-content/uploads/automatic-css/`). Names are the same on every site; values and wiring are per site. On one site `--text-dark` is pure black and `--border-color-dark` is the line on light ground; do not assume either.
- If a styleguide already exists, update it. Do not start a second one.

## 2. Run the slop check before you freeze anything

A styleguide freezes decisions, so settle these with the user first (rules: `site-audit`):

- **Label type.** Small tracked uppercase labels in the body font read as monospace and as machine-made.
  - Fix: a real label face (a condensed cut, heavier, slightly larger) or no uppercase.
- **Decorative marks.** No dash in front of eyebrows, no coloured side stripe on rows, cards or quotes, no box inside a box.
- **Theme rhythm.** A page that is dark from top to bottom feels heavy and crowded.
  - Fix: decide which sections are light and document both surfaces, each with its own foreground colours.
- **Cards.** Remove them where one surface with rules is enough. Keep them where blocks differ in structure and need a frame to read as a set; then one card style without borders.
- **Fonts.** Confirm that the font is available to the design tool and can be self-hosted before proposing it. Do not carry the font over from the previous project.

Record each decision in the findings with a tag: `FIXED`, `DECIDED` or `OPEN`. A change that exists in the design but not yet on the site is `OPEN` and says so.

## 3. Bind every value to ACSS before it spreads

A design pass leaves literals behind (`#121212`, `rgb(18 18 18 / 72%)`, `17px`). Replace each before documenting it or copying it to other pages:

1. Find the ACSS variable that already carries the role and use it at its value. If the design wanted a slightly different value (72 % where ACSS has 80 %), take the ACSS value unless the difference is the point.
2. Sizes come from the scale (`--text-xs` to `--h1`), not from a pixel value between two steps.
3. Create the token in the design file under the real ACSS name and bind the nodes to it. A literal on 300 nodes cannot be retuned.
4. What has no slot stays literal and is listed in "Values without an ACSS slot" with where and how often it occurs. The one accepted own variable is a third font family (for example `--label-font-family`), with its reason.
5. A contextual background utility does not switch everything. Read which relationships the dashboard defines for it (heading, text, link, link hover, button) and fill the empty ones there, instead of overriding variables in a section class.

## 4. Compute, never estimate

- **Colour.** Base colour as hex, each shade as lightness and chroma (OKLCH), hue only at the base. Check each shade against the sRGB gamut; the browser clips what is outside, and the rendered colour then differs from the documented one.
- **Contrast.** One row per pair the design really uses, ratio to two decimals, with a verdict. Use `node ../site-accessibility/scripts/contrast.mjs`. Compose text with alpha over its background before measuring.
  - Every surface gets its own rows. A colour that passes on dark can fail on light.
  - Include hover colours and link against body text (WCAG 1.4.1). When that pair fails, the fix is almost always an underline, not another colour.
  - No cross product. Pairs the design does not use produce false alarms.
- **Type and spacing.** Base size and ratio, mobile and desktop. The generated ladder is a check, never the input.

## 5. Write the guide in this order

1. **Head.** Project, source (which design file and frames), date, the rules of the document.
2. **Findings.** What changed or stood out, each tagged `FIXED`, `DECIDED` or `OPEN`.
3. **Colours.** Main families, then status colours. Roles the design does not have: "not defined".
4. **Contrast.** The computed table, grouped by surface, and one sentence per failure saying what to use instead.
5. **Typography.** Families, then base size and ratio for text and headings, then overrides.
6. **Spacing and section spacing.**
7. **Layout.** Content width, gutter.
8. **Borders and radius.**
9. **Links.** Colour, hover, decoration, offset, weight; global and "only in prose" noted separately.
10. **Contextual relationships.** Per background utility in use: heading, text, link, link hover, button.
11. **Values without an ACSS slot.** What, where, how many elements; own variables with their reason.
12. **Open items.** Numbered, each one decidable.

Sections 4 and 11 are the ones that get skipped. A guide without them ships contrast failures as recommendations and invites invented tokens.

## 6. Keep the copies in step

The worksheet, the design-tool artboard, the design tokens and the dashboard must agree. After any change:

- Change design tokens by value, and tell the user first when a change reaches every page of the file.
- Search the styleguide artboard for copy that names the old value, not only for styles.
- Look for text that fell back to a system font. Design tools can drop a font they cannot load without a warning; such text is bound to no token and ignores every later change.
- Bring the values into the dashboard: `acss-dashboard.md` in this skill.

## 7. Check before you say it matches

- Every `var(--…)` in the guide exists in the compiled `automatic.css`.
- Every contrast row is computed and names its surface.
- Every font in the guide is the font in the design and on the site, or the difference is listed as `OPEN`.
- The guide names no token from the design source (`--red-500`, `--fs-h2`, `--color-*`).
- After a dashboard change: the changed variables appear with the new values in the compiled stylesheet.

Report what matches, what you changed and what is still open. Do not call a guide current while the site runs the old values.
