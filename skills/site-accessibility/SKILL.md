---
name: site-accessibility
description: "Check a page, screen or component against WCAG 2.2 level AA, with AAA targets where the brand profile asks for them: contrast of the whole brand palette with the bundled script, an axe-core or Lighthouse scan, then a keyboard walk, a screen reader smoke test, zoom, reflow and reduced motion by hand. Use before handing over any page, when building forms, navigation, dialogs or motion, or when asked about accessibility, a11y, barrier-free, barrierefrei, WCAG, BFSG, European Accessibility Act, EAA, EN 301 549, contrast ratio, focus, screen reader, alt text, keyboard."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Accessibility

Baseline: **WCAG 2.2 level AA**. AAA where it costs little or the brand profile sets `contrast: aaa` (7:1 body text). This skill checks and reports; fixes go through `site-design`, `site-copy` or the stack skill.

## Status (checked 2026-11-08)

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the current W3C Recommendation (5 October 2023, updated 12 December 2024). It adds nine criteria to 2.1 and removes 4.1.1 Parsing as obsolete. [What's new](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/).
- [WCAG 3.0](https://www.w3.org/TR/wcag-3.0/) is a Working Draft (latest 10 September 2026). Do not claim conformance to it.
- The [European Accessibility Act](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en) ([Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj)) applies since 28 June 2025, among others to e-commerce, banking and booking services for consumers. Germany implements it as the [BFSG](https://www.gesetze-im-internet.de/bfsg/) with the BFSGV; micro-enterprises offering services are exempt.
- The technical benchmark is EN 301 549. V3.2.1 (the version cited for public-sector sites) maps to WCAG 2.1 AA; [V4.1.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf) (September 2026) adopts WCAG 2.2 and is meant to become the harmonised standard for the EAA, but was not yet cited in the Official Journal at review time. WCAG 2.2 AA covers both, since 2.2 only adds to 2.1.

This is orientation, not legal advice. Whether a site falls under the BFSG, and which exemptions apply, is for the owner and their counsel. Do not write "BFSG-compliant" or "barrierefrei" into a page or report; write what was tested and with which result.

## When to use

- Before handing over any page (`site-verify` points here).
- While building forms, navigation, menus, dialogs, carousels, tabs, media or anything that moves.
- When the brand palette is set or changed: run the contrast matrix before any styling builds on it.

## Prohibitions

- Do not report "accessible" or "WCAG compliant" from an automated scan. Tools find a part of the issues; the rest needs a person or a keyboard. Write "no automated violations; manual checks: …".
- Do not add ARIA when a native element does the job. Use `<button>`, `<a href>`, `<nav>`, `<dialog>`, `<details>`, `<label>`; ARIA only for patterns HTML lacks, and then the full pattern (roles, states, keys).
- Do not use `<div>` or `<span>` with a click handler as a control. Links go somewhere (`<a href>`); buttons do something (`<button type="button">`).
- Do not set a positive `tabindex`. Use `0` to make a custom widget focusable, `-1` for programmatic focus, otherwise fix the DOM order.
- Do not remove the focus outline without a replacement. Use `:focus-visible { outline: 2px solid <token>; outline-offset: 2px }` with ≥ 3:1 against the adjacent colors.
- Do not disable zoom (`user-scalable=no`, `maximum-scale=1`). Use `width=device-width, initial-scale=1`.
- Do not carry meaning by color alone (red field, green dot). Add text, an icon with a label, or a pattern.
- Do not put text in images. Use live text over the image and check contrast at the worst spot.
- Do not autoplay motion longer than 5 s, or sound, without a pause control. Use a visible pause button or no autoplay.
- Do not ignore `prefers-reduced-motion`. Remove parallax, zoom and scroll-linked movement under `reduce`; keep the information.
- Do not invent alt text for images whose content you can't see. Ask, or mark `[ALT: …]` as a placeholder.
- Do not block paste or require transcribing a code in a login. Allow password managers and paste (3.3.8).
- Do not judge from the builder canvas. Test the rendered frontend.

## Checklist (POUR, WCAG 2.2)

Level in brackets. **New in 2.2** marked. Full text: [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/).

### Perceivable

- [ ] 1.1.1 Non-text content (A): informative images have alt that says what the image shows in context; decorative `alt=""`; icon-only buttons have an accessible name; SVG icons `aria-hidden="true"` next to a label.
- [ ] 1.2.x Media (A/AA): captions for video with speech, transcript for audio, audio description or a text alternative for video-only information.
- [ ] 1.3.1 Info and relationships (A): landmarks (`header`, `nav`, `main` once, `footer`, `aside`), one `h1`, no skipped heading levels, lists as lists, data tables with `<th scope>` and `<caption>`, no layout tables, form fields grouped with `fieldset`/`legend`.
- [ ] 1.3.2 Meaningful sequence (A): DOM order matches visual order; no `order`/grid placement that reorders reading.
- [ ] 1.3.5 Identify input purpose (AA): `autocomplete` on personal data fields (`name`, `email`, `tel`, `street-address`, `postal-code`, `current-password`, `one-time-code`).
- [ ] 1.4.1 Use of color (A): links in running text underlined, or ≥ 3:1 against surrounding text plus a non-color cue on hover and focus.
- [ ] 1.4.3 Contrast minimum (AA): text 4.5:1, large text (≥ 24 px, or ≥ 18.66 px bold) 3:1. **AAA option** 1.4.6: 7:1 and 4.5:1.
- [ ] 1.4.4 Resize text (AA): 200 % zoom without loss; type in `rem`, no fixed heights on text containers.
- [ ] 1.4.10 Reflow (AA): no horizontal scroll at 320 CSS px wide (1280 px at 400 %), except data tables, maps and code.
- [ ] 1.4.11 Non-text contrast (AA): input borders, focus indicators, icons and chart marks ≥ 3:1 against adjacent colors.
- [ ] 1.4.12 Text spacing (AA): nothing clips or overlaps with line-height 1.5, paragraph spacing 2em, letter-spacing 0.12em, word-spacing 0.16em.
- [ ] 1.4.13 Content on hover or focus (AA): tooltips dismissible (Esc), hoverable, persistent.

### Operable

- [ ] 2.1.1 Keyboard (A), 2.1.2 no keyboard trap (A): every action works with Tab, Shift+Tab, Enter, Space, Esc and arrow keys where the pattern needs them.
- [ ] 2.2.2 Pause, stop, hide (A): carousels, tickers and autoplay video have a pause control.
- [ ] 2.3.1 Three flashes (A). **AAA option** 2.3.3 Animation from interactions: motion triggered by interaction can be turned off; honor `prefers-reduced-motion`.
- [ ] 2.4.1 Bypass blocks (A): a skip link to `<main>` as the first focusable element, visible on focus.
- [ ] 2.4.2 Page titled (A): unique `<title>`, page name first.
- [ ] 2.4.3 Focus order (A): logical; dialogs move focus in, trap it while open, return it to the trigger on close.
- [ ] 2.4.4 Link purpose (A): link text names the destination; no "click here", "mehr", "read more" without context. Same text, same destination.
- [ ] 2.4.6 Headings and labels (AA): describe topic or purpose.
- [ ] 2.4.7 Focus visible (AA): on every focusable element, on every surface.
- [ ] 2.4.11 **New** Focus not obscured, minimum (AA): sticky headers, cookie banners and chat widgets never fully cover the focused element; use `scroll-padding-top` for sticky headers. **AAA options** 2.4.12 (not obscured at all) and 2.4.13 Focus appearance (≥ 2 px perimeter, 3:1 between focused and unfocused states).
- [ ] 2.5.3 Label in name (A): the accessible name contains the visible label text.
- [ ] 2.5.7 **New** Dragging movements (AA): every drag (sliders, sortable lists, maps) has a single-pointer alternative such as buttons or a click.
- [ ] 2.5.8 **New** Target size, minimum (AA): pointer targets ≥ 24 × 24 CSS px, or spaced so a 24 px circle around each doesn't overlap another; inline links in text are exempt. The toolkit aims for 44 × 44 px on touch (2.5.5, AAA).

### Understandable

- [ ] 3.1.1 Language of page (A): `<html lang="de">` (or the page language); 3.1.2 (AA) `lang` on passages in another language.
- [ ] 3.2.1/3.2.2 On focus, on input (A): no context change, submit or new window just from focusing or selecting.
- [ ] 3.2.3/3.2.4 Consistent navigation and identification (AA).
- [ ] 3.2.6 **New** Consistent help (A): contact details, help links or chat sit in the same relative place on every page that has them.
- [ ] 3.3.1 Error identification (A), 3.3.3 error suggestion (AA): errors in text next to the field, linked with `aria-describedby`, field marked `aria-invalid="true"`, focus moved to the first error or an error summary; say how to fix it.
- [ ] 3.3.2 Labels or instructions (A): a visible `<label for>` on every field; placeholder is not a label; required fields marked in text, format hints before the field.
- [ ] 3.3.4 Error prevention (AA): review, confirm or undo for legal, financial and data submissions.
- [ ] 3.3.7 **New** Redundant entry (A): information already entered in the same process is filled in or selectable, not asked again.
- [ ] 3.3.8 **New** Accessible authentication, minimum (AA): no cognitive test to log in unless an alternative exists; paste and password managers work; prefer passkeys, magic links or OAuth. **AAA option** 3.3.9 (no object or image recognition either).

<!-- slop-lint-disable-next-line copy/soft-hype-word: WCAG principle name -->
### Robust

- [ ] 4.1.2 Name, role, value (A): custom widgets expose role, name and state (`aria-expanded`, `aria-pressed`, `aria-current="page"`); state changes update.
- [ ] 4.1.3 Status messages (AA): "added to cart", "3 results", form success announced with `role="status"` or `aria-live="polite"` without moving focus.
- [ ] 4.1.1 Parsing is obsolete in 2.2. Do not report it; invalid markup matters only where it breaks 1.3.1 or 4.1.2.

## How to test

From this skill's folder:

1. **Contrast matrix of the brand.** `node scripts/contrast.mjs --brand <brand.md> --suggest` (or no flags inside a project with `website-builder/brand.md`). Every text role on every surface role, accents at 3:1. Single pairs, translucent overlays and AAA: `scripts/README.md`. Then measure real combinations on the page (text over images at the worst spot, hover and disabled states, focus rings).
2. **Automated scan** of the rendered URL, pinned versions:
   ```
   npx @axe-core/cli@4.14.0 <url> --tags wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice --exit --save <date>-<page>-axe.json --dir website-builder/reports
   ```
   It drives Chrome through ChromeDriver; if the versions don't match, install a matching driver (`npx browser-driver-manager install chrome`) or pass `--chromedriver-path`. Alternative: `npx lighthouse@13.6.0 <url> --only-categories=accessibility --output=json --output-path=website-builder/reports/<date>-<page>-lighthouse.json`. Scan every template and important state (menu open, form with errors, dialog open), at 390 and 1440 px.
3. **Render check.** `node <site-verify>/scripts/render-check.mjs <url> --reduced-motion` measures reflow (default widths start at 360 px; add `--widths 320,390,1440` for the 1.4.10 minimum), rendered text contrast (background from the browser, text over images reported as manual), gradient text, motion that ignores reduced motion, missing alt and names, targets below 24 px and zoom lock, with screenshots. Run it once without `--reduced-motion` too. It complements the axe scan; it does not replace the manual checks.
4. **Manual checks.** Automated tools catch only part of WCAG failures; most of the checklist needs these:
   - Keyboard walk: unplug the mouse; Tab through the page; skip link first; every control reachable and operable; focus visible and never hidden under sticky elements; Esc closes overlays; no trap.
   - Screen reader smoke test: NVDA with Firefox or Chrome on Windows, VoiceOver with Safari on macOS or iOS. Landmarks and headings list make sense, every control announces name, role and state, images and icons read correctly, errors and status messages are announced.
   - Zoom 200 % and 400 % (or a 320 px wide window): no lost content, no horizontal scroll, sticky headers don't eat the screen.
   - Text spacing: apply the 1.4.12 values with a bookmarklet or user stylesheet; nothing clips.
   - Reduced motion: turn on the OS setting; movement stops, information stays.
   - Forms: submit empty and wrong; errors in text, linked, announced; autofill works.
   - Target size: measure small icons, close buttons, pagination and inline controls at 390 px.

## Where it goes

Save the report as `website-builder/reports/<YYYY-MM-DD>-<page>-a11y.md` in the data folder (create `website-builder/reports/` if missing). Contents: URL and widths tested, tool versions, contrast matrix output, scan summary with each violation (rule, element, criterion, fix), manual checks with pass/fail and notes, open issues with owner. Raw scan JSON next to it.
