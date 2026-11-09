---
name: site-acss
description: "Apply the toolkit rules in projects that use Automatic.css (ACSS): map spacing, color, type, layout and motion to real ACSS tokens and utilities, never invent token names, use bg-- utilities for contextual color, grid-first mobile-first layout. Use whenever a project loads Automatic.css, in any builder."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Automatic.css (ACSS)

**Use this if** the project loads Automatic.css (ACSS), in any builder (Etch, Bricks, Oxygen, Gutenberg) or as a plain stylesheet. ACSS is a token system first and a utility library second: its value is that every spacing, type, color and layout decision resolves to a variable the site owner controls in the ACSS dashboard. This adapter maps the core passes onto those variables and lists the mistakes agents make most often in ACSS projects, above all inventing token names that do not exist. Combine it with a builder adapter (the `site-etch` skill, the `site-bricks` skill) when one applies. Official docs: <https://docs.automaticcss.com/>. For an agent-oriented ACSS reference on the build side, see Kevin Geary's toolkit: <https://github.com/kevingeary/gearyco-agentic-toolkit-for-etch>.

Brand values (colors, fonts, scale ratios, radius, voice) come from the project's brand profile (the brand profile (template in the `site-brand` skill)), entered once in the ACSS dashboard. This adapter never supplies them. Component CSS only references ACSS names; the dashboard supplies the values.

## Ground rules

- **Never invent a token name.** Every `var(--…)` must resolve to a variable that ACSS actually emits. Before using a name you are not certain of, check the project's ACSS export, the compiled `automatic.css` in `wp-content/uploads/automatic-css/`, or the dashboard. If you cannot check, use a raw value with a short comment, not a guessed variable.
  - Fix: grep the compiled stylesheet for the exact name; if it is missing, write the literal value.
- **Names are fixed per ACSS version; values are per site.** Do not read a value from one site and assume it on another. You do not need to verify values to use a token; you do need to verify names.
- **Known non-existent names that agents produce from memory:** `--text-muted` (the real names are `--text-dark-muted` / `--text-light-muted`), `--text-letter-spacing`, `--container-width` / `--container-*` (use `--content-width`), `--radius-sm` / `--radius-lg` / `--radius-pill`, `--font-mono`, and any Tailwind-style ladder (`--red-500`, `--gray-100`, `--sp-16`, `--fs-h2`, `--fw-*`, `--lh-*`, `--tracking-*`, `--surface`, `--hairline`).
  - Fix: map to the ACSS role (`--bg-*`, `--text-*`, `--border-color-*`, `--space-*`, `--h*`, `--radius`) or use a raw value.
- **Do not redefine ACSS tokens in component CSS.** No `:root { --primary: … }` in a stylesheet, no locally scoped `--primary` overrides. Brand values live in the dashboard.
- **Do not ship ACSS's `:root` or reset yourself.** ACSS and the builder already provide both.
- **When no slot exists, write the value, not a new token.** Font weights, `em` letter-spacing, gradients, micro sizes below the text scale: literal values on the class. The one reasonable exception is a third font family (`--mono-font-family`), because a family is a loaded asset with a fallback stack.

## Subtract

- **No CSS that changes nothing.** ACSS already sets heading sizes, font families, weights, line-heights, link styles, button styles, section padding, container width and most margins. Do not restate them (`h1 { font-size: var(--h1) }`, `margin: 0` on elements that already have it, `color: var(--text-light)` inside a `bg--dark` section).
  - Fix: measure the computed default in the browser first; write only declarations that differ from it.
- **No duplicated components.** Before creating a class, search for an existing one with the same role (eyebrow, lede, card, button row). One role, one class; variants as modifiers.
- **Only enable the palette colors and button styles the design uses.** Unused secondary/tertiary/accent families and their button variants add CSS and confuse later agents.

## Spacing

- **Gaps come from the three contextual tokens by default:** `--content-gap` for stacks of content, `--container-gap` for rhythm between containers in a section, `--grid-gap` for grids. They are tuned centrally in the dashboard and match what ACSS applies to sections and containers on its own.
  - Fix: replace hand-picked `gap: var(--space-m)` on a normal stack with `gap: var(--content-gap)`.
- **`--space-*` (`xs`…`xxl`, plus `--space-l-to-s`-style jumps) is for deliberate one-off distances and for padding.** Padding never uses the contextual gap tokens.
- **No margins between siblings.** Spacing between elements is the parent's `gap`. Margin is acceptable only as an additive exception on top of an existing gap.
- **No manual padding on sections.** ACSS applies section padding and `--gutter`. If a section needs a different rhythm, use `--section-space-*` on that section's class, never `padding-inline: var(--gutter)` and never a raw value.
- **No breakpoint overrides for spacing.** The space tokens are fluid (`clamp()`); changing them per breakpoint is a sign of a wrong token choice.
- **No pixel-matching a comp.** `88px` in a mockup becomes the nearest `--space-*` or `--section-space-*`, not `to-rem(88px)`.

## Color

- **Contextual surfaces use the `bg--*` utility class, never `background: var(--bg-*)` in your own class.** The utility (`bg--ultra-light`, `bg--light`, `bg--dark`, `bg--ultra-dark`) also flips heading, text, link and button colors inside it through Automatic Color Relationships. The variable alone paints the background and flips nothing.
  - Fix: put `bg--dark` on the section, delete the `background` line and every manual `color` rule for headings and body text inside it.
- **Prefer contextual color tokens over palette tokens** for text and surfaces: `--text-dark`, `--text-dark-muted`, `--text-light`, `--text-light-muted`, `--bg-light`, `--bg-dark` and their ultra variants. Use `--white` / `--black` when you mean pure white or black.
- **Start with one brand family.** Try to build the whole design from `--primary` and its shades (`-ultra-light`, `-light`, `-semi-light`, `-semi-dark`, `-dark`, `-ultra-dark`, `-hover`) plus the neutral family. A lighter or darker take on the brand hue is a shade, not a second family.
  - Fix: before enabling `--secondary` or `--accent`, show which role the primary shades cannot fill.
- **Shade usage on light surfaces:** text and meaningful graphics at `-semi-dark` or darker; light shades are washes and decoration only. The vivid base belongs on dark surfaces or large fills.
- **No grey from the palette of a brand color.** Greys come from `--neutral-*`. Retune the neutral shades to the brand in the dashboard so `bg--light` / `bg--dark` render the intended surfaces.
- **Transparency via `color-mix()`**, e.g. `color-mix(in srgb, var(--text-light) 12%, transparent)`, not invented `--*-trans-*` names unless the export shows them.
- **Borders:** `var(--border)` for a default border, or the granular `--border-size`, `--border-style`, `--border-color-light` (on light surfaces) / `--border-color-dark` (on dark surfaces).
- **Status colors** (`--success`, `--warning`, `--danger`, `--info`) only for status meaning, and only if enabled in the dashboard.

## Icons

- **Check whether the ACSS icon features are enabled before using their attributes or classes.** If they are, size and color icons through the documented icon variables rather than per-icon `width`/`fill` rules; if not, size icons with `1em`-relative values or the text scale and color them with `currentColor`.
- **No icon inside an ACSS button unless the design needs it.** The button base is `inline-flex` without a gap; an icon needs its own spacing.
- **Icons inherit color from the surrounding context.** Do not hardcode a fill that breaks inside a `bg--dark` section.

## Copy

ACSS has no copy features. Apply `site-copy` and the brand profile's voice. One ACSS-specific rule:

- **Button labels live on `btn--*` elements, not on styled links.** A link that looks like a button but lacks the class drifts from the button system.

## Type

- **Do not set `font-size`, `font-family`, `font-weight`, `line-height` or `letter-spacing` on headings or body text unless deliberately deviating.** ACSS sets them globally from the dashboard.
- **Sizes come from the scale:** `--h1`…`--h6`, `--text-xs`…`--text-xxl`. A heading that should look smaller than its level uses the smaller token (`h2.card__title { font-size: var(--h4) }`). Derived sizes use `calc()` on a token, not a raw `rem`.
- **Jump sizing (`--h1-to-h4`, `--text-xxl-to-text-m`) sparingly**, only when the default fluid range is visibly wrong.
- **Custom typography that should stay tied to globals** uses the `--heading-*` / `--text-*` property tokens (for example `--heading-font-weight`, `--text-line-height`) where the export shows them.
- **Scales are set as base size plus ratio (mobile and desktop) in the dashboard.** Never hand-author a step ladder in CSS.
- **Fonts:** prefer variable fonts with a `font-weight: <min> <max>` range in exactly one `@font-face` source. ACSS holds the family variables (`--heading-font-family`, `--text-font-family`). Check for duplicate face registrations from WordPress's Font Library, `theme.json` or the builder; duplicates rot into 404s.

## Layout

- **Grid-first whenever the parent owns the column geometry** (two-column splits, card rasters, label/value rows). Use `display: grid` on the parent; children carry no width, `flex-shrink` or `min-inline-size` guards.
- **Column tokens:** `--grid-1`…`--grid-12` for equal columns, ratio tokens (`--grid-1-2`, `--grid-2-1`, `--grid-1-3`, `--grid-3-1`, `--grid-2-3`, `--grid-3-2`) for splits. Never `repeat(3, 1fr)` or `1fr 2fr` when a token exists.
- **Mobile-first, range syntax:** the base rule is the stacked layout (a grid with no `grid-template-columns`), columns arrive with `@media (width >= to-rem(768px)) { grid-template-columns: var(--grid-2-3); }`. No `max-width` queries that unwind a desktop layout. This applies to every property, not only grid.
- **Flex only for content-sized rows that wrap** (buttons, badges, nav items, icon plus label) and simple vertical stacks with `gap`.
- **Intrinsic grids** where column count should follow item width: `repeat(auto-fit, minmax(min(var(--_min), 100%), 1fr))` with a locally scoped `--_min`. Check the docs before using any packaged auto-grid utility; some builders drop it.
- **Widths:** containers are `--content-width` by default; do not add random `max-width` to them. Narrower elements use `inline-size: 100%` plus `max-inline-size: var(--width-60)` (`--width-10`…`--width-90`).
- **Logical properties:** `max-inline-size`, `padding-block`, `margin-inline`, not `max-width` / `padding-top`.
- **px only through `to-rem()`** where the ACSS SCSS functions are available (Etch, ACSS-aware stylesheets). Raw `rem` values are allowed only where `to-rem()` is not compiled.

## Details

- **Buttons are the ACSS button system:** `btn--primary`, `btn--secondary` (plus `-light` / `-dark` and the other enabled families), outline by combining with `btn--outline`, sizes `btn--xs`…`btn--xl`. Never a custom button class that restyles background, padding and radius. Custom variants read `--btn-*` tokens.
- **Radius:** `var(--radius)` everywhere (plus `--radius-circle` for circles). One radius is the point; a second radius value is a brand decision recorded in the profile, written literally where used.
- **Shadows:** use the shadow tokens your export shows (commonly `--box-shadow-1` to `--box-shadow-3`), and only where elevation means something.
- **Links:** global link styling covers most cases. Custom link styles read the `--link-*` tokens. To change link behavior inside a container (for example underline in prose), set the `--link-*` variable on the container instead of writing new `a` rules.
- **States:** focus styles must stay visible on every surface; check `:focus-visible` inside `bg--dark` sections.
- **BEM for component classes,** utilities only for buttons, contextual backgrounds and accessibility helpers. Layout and spacing utilities in markup are a smell in token-driven projects; put the token on a class.

## Motion

- **Use the transition tokens your export shows** (for example `--transition`, `--transition-duration`) instead of raw durations, so timing stays consistent site-wide.
- **No `transition: all`.** Name the properties.
- **Every animation respects `prefers-reduced-motion`.** Provide a calm variant (opacity only), not a dead page.
- Detail: `site-polish` (motion.md).

## Verify

- **Zero unresolved variables:** every `var(--x)` in your CSS exists in the compiled `automatic.css`. A missing variable fails silently (transparent, inherited, or initial).
- **Computed, not assumed:** read resolved values on the rendered page (`getComputedStyle`, or a probe element with `color: var(--x)`) before claiming a contrast ratio.
- **Contrast for the pairs the design actually uses,** resolved through the role wiring (`--text-dark-muted` may point at a base shade; `--bg-light` at a neutral shade).
- **Fonts:** zero font 404s in the console; `document.fonts.check('700 16px "Family"')` true for every weight used.
- **Shades in gamut:** if you specify shades as OKLCH lightness and chroma, check them against the sRGB gamut; the browser clips out-of-gamut values and the rendered color differs from the documented one.
- Detail: `site-verify`.

## Lint hints

Patterns `slop-lint` (in the `site-audit` skill) could flag in ACSS projects:

- `var(--text-muted)`, `var(--text-letter-spacing)`, `var(--container-…)`, `var(--radius-sm|lg|pill)`, `var(--font-mono)`
- Tailwind-style ladder names: `var(--[a-z]+-(50|100|200|…|900))`, `--sp-\d+`, `--fs-`, `--fw-`, `--lh-`, `--tracking-`, `--surface`, `--hairline`
- Any `var(--…)` not present in a supplied `automatic.css` (optional: pass the file path)
- `background(-color)?:\s*var\(--bg-(ultra-)?(light|dark)\)` inside a class (should be the `bg--*` utility)
- `grid-template-columns:\s*repeat\(\d+,\s*1fr\)` and `1fr 2fr`-style ratios
- `@media (max-width` and `@media (min-width` (prefer range syntax `width >=`)
- Raw `px` values outside `to-rem()`; raw `rem` in files that compile `to-rem()`
- `max-width` / `padding-top` / `margin-left` where a logical property applies
- Hex or `rgb()` literals outside `:root` and gradients
- `margin-(top|bottom|block-start|block-end)` on children of a flex/grid parent with `gap`
- `font-size:\s*var\(--h1\)` on `h1` (and the same for `h2`…`h6`): restates the default
- `padding-inline:\s*var\(--gutter\)` on sections
- Custom classes containing `button` or `btn` that set `background` and `padding` (should use `btn--*`)
- `transition:\s*all`
