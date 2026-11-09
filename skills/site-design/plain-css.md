# Plain CSS and Tailwind tokens

**Use this if** the output is hand-written HTML and CSS, a static site, a component library, or a project styled with Tailwind CSS (v3 config file or v4 CSS-first `@theme`). There is no builder to protect and no framework dashboard, so the token layer is yours to define and yours to keep honest. This is also where the generic AI look is most recognisable: Tailwind's defaults make purple gradients, `rounded-2xl` cards, `shadow-xl` and `hover:scale-105` one keystroke away. This adapter maps the core passes to CSS custom properties and Tailwind theme values and lists the class patterns that give generated pages away. References: MDN for CSS (<https://developer.mozilla.org/en-US/docs/Web/CSS>), Tailwind docs (<https://tailwindcss.com/docs>).

Brand values (colors, fonts, scale, radius, voice) come from the project's brand profile (the brand profile (template in the `site-brand` skill)). Translate them once into tokens (custom properties or the Tailwind theme). This adapter never supplies them; if no profile exists, work with a neutral token set and say so.

## Token layer

- **All values come from one token file.** Plain CSS: custom properties on `:root` in one file (`tokens.css`). Tailwind v4: `@theme { … }` in the main CSS file. Tailwind v3: `theme.extend` in `tailwind.config.js`. Components reference tokens, never literals.
- **Name tokens by role, not by appearance:** `--color-surface`, `--color-text`, `--color-text-muted`, `--color-action`, `--space-m`, `--radius`. Not `--purple`, `--big-gap`.
- **Restrict the Tailwind palette to the brand.** Replace or trim the default colors (v4: reset with `--color-*: initial;` inside `@theme`, then define your own; v3: set `theme.colors` rather than only extending it). If `bg-purple-500` still compiles in a project whose brand has no purple, the default palette is leaking.
- **One spacing scale, one type scale, one radius, at most two shadows.** If the brand profile does not ask for more, do not add more.
- **Fluid sizes with `clamp()` in the token,** not breakpoint overrides on every component.
- **Dark mode is a token swap,** not a second set of classes on every element: redefine the role tokens under `prefers-color-scheme` or a `data-theme` attribute, or use `light-dark()`.

## Subtract

- **No decorative layers without a job.** Remove background blobs, blurred gradient orbs, grid-dot patterns, glassmorphism panels and floating badges unless the brand profile names them.
- **No CSS that restates defaults** (`display: block` on a `div`, `font-weight: 400` on body text, `margin: 0` already handled by your reset).
- **No duplicate components.** One card component with variants, not three cards with slightly different padding.
- **No unused utilities or dead rules.** In Tailwind, a class list longer than about 12 utilities on one element is a component waiting to be extracted (`@apply` sparingly, or a framework component).

## Spacing

- **Spacing from the scale only.** No arbitrary values (`mt-[13px]`, `p-[22px]`, `gap-[18px]`). If the scale lacks a step the design needs repeatedly, add a token.
  - Fix: round to the nearest scale step or add a named step to the theme.
- **Gap over margin:** use `gap` on flex/grid parents (`gap-6`, `space-y-*` only for flow content) instead of margins on children.
- **Consistent section rhythm:** one or two section padding values, from tokens, not a different `py-*` on every section.
- **Uniform padding everywhere is a tell.** Inner spacing tighter than outer spacing; related items closer than unrelated ones.

## Color

- **No purple-to-pink or blue-to-purple gradients** (`bg-gradient-to-r from-purple-500 to-pink-500`, `from-indigo-500 via-purple-500`), and no gradient text (`bg-clip-text text-transparent`) unless the brand profile defines that gradient.
- **One brand family first.** Build from the brand color and its shades plus neutrals before adding an accent. The accent has a budget (the profile's accent budget); use it on the one thing that should be noticed.
- **Neutrals carry the page.** Tint neutrals slightly toward the brand hue instead of default `gray-*` / `slate-*`.
- **Contrast is computed.** Body text at least 4.5:1, large text and meaningful graphics at least 3:1. Light tints are backgrounds, not text colors on white.
- **No pure `#000` text on pure `#fff`** for long reading; use the darkest neutral token.
- **Opacity for color is a smell.** `text-white/60` on a photo or gradient has unpredictable contrast; use a defined muted token on a defined surface.

## Icons

- **One icon set, one stroke width, one size scale.** Do not mix outline and solid sets or icon libraries.
- **Icons are sized relative to text** (`1em`, or `size-4`/`size-5` matched to the text size), aligned to the first line, colored with `currentColor`.
- **No icon in a colored rounded square above every feature card.** That pattern (`rounded-xl bg-purple-100 p-3` around an icon) is one of the strongest generated-page tells. Use an icon only where it helps scanning.
- **Decorative icons get `aria-hidden="true"`;** icon-only buttons get an accessible name.

## Copy

No framework rules here; apply `site-copy`, the language file in `languages/`, and the brand voice. Markup-level rules:

- **Real headings in order** (`h1` once, no skipped levels), real `button` for actions and `a` for navigation.
- **No placeholder copy shipped** (`Lorem ipsum`, `Feature one`, `Your headline here`), and no invented numbers, logos or testimonials.

## Type

- **No `font-extrabold` / `font-black` headlines by default.** Heavy weights read as generated unless the brand type calls for them. Use the weights in the brand profile.
- **No `tracking-widest uppercase` eyebrows over every section.** One small label style at most, with modest tracking, used where it carries information.
- **Type scale from tokens** (`text-*` mapped to your scale). No arbitrary `text-[17px]`.
- **Line length 45 to 75 characters for body text** (`max-w-prose` or `max-inline-size: 65ch`).
- **Variable fonts self-hosted,** one `@font-face` per family with a weight range, `font-display: swap`, preloaded only for the above-the-fold face. No Google Fonts CDN where privacy rules apply.
- **`text-wrap: balance` on headings, `pretty` on paragraphs** where supported.

## Layout

- **Grid when the parent owns the columns,** flex for content-sized rows that wrap. Children of a grid carry no width hacks.
- **Mobile-first:** base styles are the stacked layout; columns arrive at a breakpoint (`md:grid-cols-2`, or `@media (width >= 48rem)` in CSS). No `max-width` queries that undo a desktop layout.
- **Not every section is centered.** A page of centered hero, centered three-card row, centered CTA is the template look. Use alignment and asymmetry from the direction.
- **No three equal cards as the default answer** to every content group. Choose the layout from the content (list, table, split, single statement).
- **Logical properties in plain CSS** (`margin-inline`, `padding-block`, `max-inline-size`).
- **Container queries** for components that live in different widths.

## Details

- **No `rounded-2xl` (or larger) on everything.** One radius token for the brand; inner radius smaller than outer radius on nested elements.
- **No `shadow-xl` / `shadow-2xl` on resting cards.** Elevation means something: a border or a subtle shadow at rest, more only for overlays.
- **States for every interactive element:** hover, `focus-visible` (visible ring with sufficient contrast), active, disabled, loading. `outline-none` without a replacement focus style is a defect.
- **Hit targets at least 44 by 44 px** for touch.
- **Images have `width`/`height` or `aspect-ratio`,** `alt`, `loading="lazy"` below the fold, and `srcset`/`sizes`.

## Motion

- **No `transition-all`.** Name the properties (`transition-colors`, `transition-[transform,opacity]`).
- **No `hover:scale-105` on cards and buttons** as the default hover. Prefer a color, border or shadow change that matches the brand's motion stance.
- **No `animate-pulse` / `animate-bounce` / `animate-ping` as decoration.** `animate-pulse` is for loading skeletons only; bounce and ping almost never belong on a marketing page.
- **Durations 150 to 300 ms for UI feedback,** ease-out for entering, never linear for UI.
- **`motion-safe:` / `motion-reduce:`** variants or a `prefers-reduced-motion` query on every animation.
- Detail: `site-polish` (motion.md).

## Verify

- **Render at real sizes:** 390, 768, 1280 and 1440 px widths, plus 200 percent zoom.
- **Contrast checked by computation** for every text and surface pair used.
- **Console clean, no 404s,** fonts loaded for every weight used (`document.fonts.check`).
- **Purge check (Tailwind):** the production build contains only classes you use; no dynamically concatenated class names that the scanner cannot see.
- **Run `slop-lint` (in the `site-audit` skill)** on the HTML and CSS before calling the work done.
- Detail: `site-verify`.

## Lint hints

Patterns `slop-lint` (in the `site-audit` skill) could flag in HTML, CSS and Tailwind class lists:

- `bg-gradient-to-[a-z]+` combined with `from-(purple|violet|indigo|fuchsia|pink)-\d+`; `bg-clip-text text-transparent`
- `rounded-(2xl|3xl)` on more than a few elements; `rounded-full` on cards
- `shadow-(xl|2xl)` on non-overlay elements
- `animate-(pulse|bounce|ping)` outside skeleton/loading components
- `transition-all` and `transition:\s*all`
- `hover:scale-1(05|10)`, `hover:-translate-y-`
- Arbitrary values: `-\[\d+px\]` (for example `mt-[13px]`, `text-[17px]`), arbitrary hex `\[#[0-9a-f]{3,8}\]`
- `font-(extrabold|black)` on headings
- `tracking-(wider|widest)` together with `uppercase`
- `backdrop-blur` plus `bg-white/\d+` (glassmorphism)
- Icon wrapper pattern: `rounded-(lg|xl|2xl)` + `bg-[a-z]+-(50|100)` + `p-[23]` around an `svg`
- `outline-none` / `focus:outline-none` without `focus-visible:ring` or equivalent
- More than about 12 utilities on one element
- `text-white/\d+` and `text-gray-400` on light backgrounds (likely contrast failures)
- Hex literals in component CSS outside the token file; `@media (max-width`
- `fonts.googleapis.com` / CDN font and script URLs
- `<img` without `alt`, `width`/`height`; `<div onclick` instead of `<button>`
- `Lorem ipsum`, `Feature one`, `John Doe`, `Acme` placeholder content
