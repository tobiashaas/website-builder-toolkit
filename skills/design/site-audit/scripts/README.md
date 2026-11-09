# slop-lint

A mechanical checker for the tells that make a page look and read as generated: gradient text, purple-to-pink gradients, neon glows, `transition: all`, hype words, placeholder names, unsourced social proof, missing focus styles. It also checks a page against a brand profile (banned words, palette, fonts, address form, motion stance).

Written rules get skipped; a lint check does not. Every rule here is concrete, has an id, a severity and a fix, and can be silenced on a single line when you have a reason.

- Node 18 or newer, no dependencies, one file: `scripts/slop-lint.mjs`
- License: MIT (see `LICENSE` in the repository root)

## Project data folder

Without `--brand`, `--lang` or `--adapter`, the script looks for a `website-builder/` folder in the current directory or its parents. It reads `website-builder/setup.md` (`language`, `framework`, `builder`, `brand`) and uses `website-builder/brand.md` automatically, unless `brand: none`. Flags and `.slop-lint.json` always win.

## Usage

```sh
node scripts/slop-lint.mjs [paths...] [options]

node scripts/slop-lint.mjs src                          # core rules, language detected per file
node scripts/slop-lint.mjs src --brand website-builder/brand.md         # plus brand/* rules
node scripts/slop-lint.mjs src --adapter acss --lang de # plus acss/* and German rules
node scripts/slop-lint.mjs src --format json            # machine-readable, for agents
```

Paths can be files or folders. Folders are walked recursively; `node_modules`, `.git`, `dist`, `build`, `vendor` (and a few cache folders) are skipped. Checked file types: `.html .htm .css .scss .js .jsx .ts .tsx .vue .svelte .php .md .mdx .json .txt`. With no path, the current folder is checked.

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `--brand <file>` | path to a brand profile | none | enables `brand/*` rules (see below) |
| `--adapter <list>` | `acss`, `tailwind`, `etch`, `bricks` (comma-separated) | none | enables `acss/*` or `tailwind/*` rules; `etch` and `bricks` are accepted but add no rules yet, combine them with `acss` if the project uses Automatic.css |
| `--lang <code>` | `de`, `en`, `auto` | `auto` | copy language; `auto` decides per file (`<html lang>`, else word frequency) |
| `--format <fmt>` | `text`, `json` | `text` | output format |
| `--fail-on <level>` | `error`, `warn`, `info`, `none` | `error` | exit code 1 if any finding is at or above this level |
| `--config <file>` | path | `./.slop-lint.json` if present | config file |
| `--md-code` | flag | off | also lint fenced `css`/`html`/`jsx` blocks inside Markdown (off by default: code in docs is usually an example) |
| `--list-rules` | flag | | print the rule table (`--format json` or `--format md` for other shapes) |

### Output

One line per finding, then a summary:

```
src/hero.html:12:7  error  design/gradient-text  Gradient text (background-clip: text over a gradient).  → Use a solid text color from the palette; carry emphasis with size, weight or position.

slop-lint: 1 error(s), 0 warning(s), 0 info in 1 of 14 file(s)
```

`--format json` prints `{ tool, version, filesScanned, summary: { error, warn, info, files }, options, findings: [{ file, line, column, severity, rule, message, fix }] }`.

Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above it, `2` usage error (bad option, unreadable config or brand file).

## Severities

- **error**: almost always wrong, or an accessibility barrier. Fix before shipping.
- **warn**: a strong tell. Fix unless the brand profile or the design direction says otherwise.
- **info**: worth a look; often fine in context.

## Silencing findings

Inline directives work in any comment style (`<!-- -->`, `/* */`, `//`, `{/* */}`):

```css
/* slop-lint-disable-next-line css/transition-all */
.drawer { transition: all 200ms; }

.badge { font-weight: 900; } /* slop-lint-disable-line design/heavy-weight */

/* slop-lint-disable design/* */
…
/* slop-lint-enable */
```

`slop-lint-disable-file` silences the whole file. Rule lists take exact ids, group wildcards (`copy/*`), bare group names (`copy`) or nothing (all rules). Write the reason next to the directive.

## Config file: `.slop-lint.json`

Looked up in the current folder, or passed with `--config`. All keys are optional; command-line options win.

```json
{
  "rules": { "copy/soft-hype-word": "off", "css/transition-all": "error" },
  "ignore": ["legacy/**", "**/*.generated.css"],
  "brand": "brand.md",
  "adapter": "acss",
  "lang": "de",
  "failOn": "warn",
  "markdownCode": false,
  "thresholds": { "pxDistinct": 12, "important": 3, "rounded": 5, "glowBlurPx": 20, "scaleMax": 1.02, "trackingEm": 0.05 }
}
```

- `rules`: per-rule severity override: `off`, `info`, `warn`, `error`.
- `ignore`: globs relative to the current folder (`*`, `**`, `?`).
- `brand`: resolved relative to the config file.
- `thresholds`: `pxDistinct` (distinct px values before `css/px-sprawl`), `important` (`!important` count before `css/important-overuse`), `rounded` (`rounded-2xl/3xl` uses before `tailwind/rounded-overuse`), `glowBlurPx` (minimum blur for `design/glow-shadow`), `scaleMax` (largest accepted hover scale), `trackingEm` (letter-spacing that counts as wide for uppercase).

## Brand profile front matter

`--brand` reads the YAML front matter (between the first two `---` lines) of a brand profile such as `the brand profile template (`site-brand` skill, `template.md`)`. The parser understands a small YAML subset: `key: value`, nested maps by indentation, `- item` lists, inline `[a, b]` lists and inline `{ key: value }` maps, quoted strings and `#` comments (an unquoted `#1E4D3A` is read as a value, not a comment). Empty values switch the matching rule off.

| Key | Type | Used by |
| --- | --- | --- |
| `name` | string | output only |
| `address`, `address_overrides` (list of `{ path: glob, address }`, applied per file path), `register` | `Sie` \| `du` \| `you` | `Sie` → `brand/address-du`; `du` → `brand/address-sie` (both only for German text) |
| `gendering` | `none` \| `colon` \| `star` \| `pair` \| `neutral` | `none` → `brand/gendering` flags `:innen`, `*innen`, `_innen`, `/innen`, `Innen` |
| `motion` | `none` \| `subtle` \| `expressive` | `none` → `brand/motion-none` flags `@keyframes`, `animation`, `animate-*` |
| `colors` | list of `{ name, hex, role }` | every hex found anywhere under `colors` forms the palette for `brand/off-palette-color`; near-neutral colors are always allowed; a purple palette color also switches off `design/ai-gradient` |
| `fonts` | list of family names (strings, or maps with `family`/`name`) | `brand/off-brand-font`; text after `(` or `,` is ignored, so `Inter (UI)` means `Inter`; generic families and `var(...)` are always allowed |
| `banned_words` | list of strings | `brand/banned-word` (whole words, case-insensitive) |
| `banned_phrases` | list of strings | `brand/banned-phrase` (any whitespace between words) |
| `claims_never` | list of strings | `brand/claim-never` |

`address` and `gendering` may also sit under `voice:`; `motion` may be a map with `stance:`.

```yaml
---
name: "Harbor Joinery"
address: Sie
gendering: none
motion: subtle
colors:
  - { name: "Harbor", hex: "#1E4D3A", role: "accent" }
  - { name: "Sand", hex: "#E8DCC4", role: "surface" }
fonts: ["Source Serif 4", "Inter"]
banned_words: [Synergie]
banned_phrases: ["rundum sorglos"]
claims_never: ["100 % Verfügbarkeit"]
---
```

## What gets checked where

The linter builds three views of each file and runs each rule only on the view it is meant for:

- **CSS view**: `.css/.scss/.less` files, `<style>` blocks, `style="…"` attributes, CSS-in-JS template literals (`styled.x\`…\``, `css\`…\``). Comments are removed first.
- **Class view**: `class`, `className`, `:class` attribute values and `@apply` lines. Tailwind-style tells are matched here.
- **Text view**: only human-readable text: HTML/JSX/Vue/Svelte text nodes (not `script`, `style`, `pre`, `code`), the attributes `alt`, `title`, `aria-label`, `placeholder`, meta descriptions, Markdown prose (without front matter, code fences, inline code, URLs and link targets), and JSON string values whose key ends in `title`, `heading`, `label`, `text`, `button`, `cta`, `description`, `caption` and similar. Each text piece knows its context (heading, button, link, label), so "emoji in a button" is a real check.

Files with a line longer than 2000 characters, or named `*.min.*`, are skipped with an info finding.

Copy rules switch their word lists with the language: German files get the German hype words and stock phrases, English files the English ones.

In Markdown and plain text, words in quotes or emphasis and lines that list several tells (`supercharge, seamless, unlock`) count as mentions, not use, so docs about tells stay quiet.

## Rules

<!-- RULES:START -->
| Rule | Severity | Needs | Flags | Fix |
| --- | --- | --- | --- | --- |
| `design/gradient-text` | error | core | Gradient text (background-clip: text over a gradient). | Use a solid text color from the palette; carry emphasis with size, weight or position. |
| `design/ai-gradient` | warn | core | Purple/violet to blue/pink gradient, the default generated-UI look. | Use a flat surface or a gradient within one palette family; derive color from the brand profile. |
| `design/glow-shadow` | warn | core | Colored glow shadow (saturated color with a large blur). | Use a neutral, low-alpha shadow for depth, or a border; never a neon glow. |
| `design/hover-scale` | warn | core | Hover scale above 1.02 (cards and buttons that grow on hover). | Signal hover with color, border or a 1-2 px lift; keep scale at 1.02 or below. |
| `design/infinite-animation` | warn | core | Infinite or attention-seeking animation on a non-loading element. | Animate once on a state change, or only on loading indicators; respect prefers-reduced-motion. |
| `design/heavy-weight` | warn | core | Font weight 800/900 (extrabold/black). | Use the weights defined in the brand profile; hierarchy usually needs size and spacing, not 900. |
| `design/uppercase-tracking` | warn | core | Uppercase text with wide letter-spacing (the generated "eyebrow" label). | Use sentence case; if a label must be uppercase, keep tracking small and use it once per view. |
| `design/negative-tracking-small` | warn | core | Negative letter-spacing on small or body text (heuristic). | Tighten tracking only on large display sizes; keep body and UI text at normal tracking. |
| `design/decorative-dashed-border` | info | core | Dotted or dashed border used as decoration. | Reserve dashed borders for real states (drop zones, placeholders); use solid hairlines or spacing. |
| `css/transition-all` | warn | core | transition: all (or a transition without a property, which means all). | Name the properties: transition: opacity 150ms ease-out, transform 150ms ease-out. |
| `css/animate-layout` | warn | core | Animating layout properties (width, height, top, left, ...). | Animate transform and opacity; for size changes use transform: scale or grid-template-rows. |
| `css/important-overuse` | info | core | Many !important declarations in one file. | Fix specificity at the source (layers, lower-specificity selectors) instead of stacking !important. |
| `css/px-sprawl` | info | core | Many distinct one-off pixel values in one file. | Map sizes to a spacing/type scale (tokens or rem steps) instead of hand-picked pixels. |
| `css/arbitrary-px` | info | core | Arbitrary pixel value in a utility class (e.g. p-[13px]). | Use the spacing/type scale; add a token if the value is a real, repeated need. |
| `copy/hype-word` | error | core | Hype word. | Say what the product does, concretely: the task, the number, the result. |
| `copy/soft-hype-word` | warn | core | Inflated word that usually hides a missing specific. | Replace with the concrete claim (what changes, for whom, by how much) or delete. |
| `copy/ai-phrase` | warn | core | Stock phrase typical of generated copy. | Start with the reader's situation or the concrete offer; cut the throat-clearing. |
| `copy/greeting-headline` | warn | core | Greeting as a headline ("Welcome back"). | Lead with the most useful information or the next action, not a greeting. |
| `copy/placeholder-content` | error | core | Placeholder content left in. | Replace with real content from the brand profile or the user; never ship filler names or numbers. |
| `copy/unsourced-social-proof` | warn | core | Social proof claim without a visible source. | Use only numbers listed in the brand profile facts, with source; otherwise remove the claim. |
| `copy/emoji-in-ui` | warn | core | Emoji in a heading, button, link or label. | Remove the emoji; use an icon from the project icon set if the element needs one. |
| `copy/sparkle-emoji` | warn | core | Sparkle emoji (✨), the signature of generated copy. | Delete it. |
| `copy/exclamation` | warn | core | Exclamation mark in a heading or button. | End with a period or nothing; let the content carry the energy. |
| `copy/button-period` | warn | core | Button text ends with a period. | Write button labels as verbs without end punctuation ("Send request"). |
| `copy/change-without-reference` | info | core | Percentage change without a reference ("+12%" compared to what?). | Add the baseline and period ("+12% vs. Q1 2025") or drop the number. |
| `copy/de-straight-quotes` | info | lang de | Straight quotes in German prose. | Use German quotation marks: „…“ (or »…« if the brand uses them). |
| `brand/banned-word` | error | brand | Word banned by the brand profile. | Rephrase without it (see banned_words in the brand profile). |
| `brand/banned-phrase` | error | brand | Phrase banned by the brand profile. | Rephrase (see banned_phrases in the brand profile). |
| `brand/claim-never` | error | brand | Claim the brand never makes. | Remove it; only state facts listed in the brand profile. |
| `brand/address-du` | error | brand + lang de | du-address, but the brand profile says address: Sie. | Address the reader with Sie/Ihnen/Ihr. |
| `brand/address-sie` | warn | brand + lang de | Sie-address, but the brand profile says address: du. | Address the reader with du/dich/dein. |
| `brand/gendering` | error | brand | Gender form (:innen, *innen, _innen, Innen), but the brand profile says gendering: none. | Use the forms the brand profile specifies. |
| `brand/off-palette-color` | warn | brand | Color not in the brand palette. | Use a palette color or its token (see colors in the brand profile). |
| `brand/off-brand-font` | warn | brand | Font family not listed in the brand profile. | Use a family from fonts in the brand profile. |
| `brand/motion-none` | warn | brand | Animation, but the brand profile says motion: none. | Remove the animation; show state changes instantly. |
| `a11y/outline-none` | error | core | Focus outline removed without a replacement focus style. | Keep the outline or add :focus-visible { outline: 2px solid <token>; outline-offset: 2px }. |
| `a11y/zoom-disabled` | error | core | Pinch zoom disabled (user-scalable=no / maximum-scale=1). | Use <meta name="viewport" content="width=device-width, initial-scale=1">. |
| `a11y/img-alt` | error | core | Image without alt text. | Add alt describing the content, or alt="" if purely decorative. |
| `a11y/vague-link-text` | warn | core | Vague link text ("Click here", "Hier klicken"). | Make the link text name the destination ("Download the price list"). |
| `acss/raw-px` | warn | --adapter acss | Raw px value in an ACSS project. | Use an ACSS token (spacing/text/radius variable) or wrap one-offs in to-rem(). |
| `acss/hardcoded-hex` | warn | --adapter acss | Hardcoded hex color in component CSS. | Use the ACSS color tokens of the project palette instead of hex values. |
| `acss/bg-var-in-class` | warn | --adapter acss | background: var(--bg-…) inside an own class. | Put the bg--* utility class on the element so ACSS color relationships (text, links, buttons) follow. |
| `acss/max-width-media` | info | --adapter acss | max-width media query (desktop-first). | Write mobile-first: base styles stacked, then @media (width >= to-rem(…)). |
| `tailwind/purple-gradient` | warn | --adapter tailwind | Gradient utility with purple/violet/fuchsia/indigo stops. | Use a flat brand color or a gradient within one brand family defined in the theme. |
| `tailwind/rounded-overuse` | info | --adapter tailwind | rounded-2xl/rounded-3xl used everywhere. | Define one radius scale in the theme and vary it by element size. |
| `tailwind/shadow-2xl` | info | --adapter tailwind | shadow-2xl (heavy floating-card shadow). | Use a small neutral shadow or a border; reserve large shadows for overlays. |
| `tailwind/arbitrary-value` | warn | --adapter tailwind | Arbitrary px value in a utility (e.g. p-[13px]). | Use the theme scale; extend the theme if the value is a real, repeated need. |
| `tailwind/uppercase-tracking` | warn | --adapter tailwind | uppercase combined with tracking-wide*. | Use sentence case; if uppercase is required, drop the wide tracking. |
<!-- RULES:END -->

Regenerate this table with `node scripts/slop-lint.mjs --list-rules --format md`.

## Adding a rule

Rules live in the `RULES` array at the top of `slop-lint.mjs`. A rule is a plain object:

```js
{ id: 'copy/hype-word', severity: 'error',
  message: 'Hype word.',
  fix: 'Say what the product does, concretely.',
  when: (env) => env.lang === 'en',        // optional gate: env.lang, env.brand, env.adapters
  adapter: 'tailwind',                      // optional: only with --adapter tailwind
  detect: [
    { scope: 'text', ctx: ['heading', 'button'], re: /…/i },   // regex per text piece
    { scope: 'decl', check: (decl, block, file, env) => … },     // per CSS declaration
  ] }
```

Scopes: `text` (per text piece, with `ctx` / `notCtx` filters), `class` (per class attribute value), `decl` (per CSS declaration: `prop`, `value`, `index`, `valueIndex`), `block` (per CSS rule: `chain` selector, `decls`), `css` (whole CSS view), `raw` (raw markup/script source), `markup` (facts collected while parsing, such as images without `alt`), `file` (per-file aggregates). A detector either has `re` (a RegExp or `env => RegExp`) with an optional `unless(match, text, index)`, or a `check` that returns an index, a list of indexes, or `{ index, message }` objects. Group ids by prefix: `design/`, `css/`, `copy/`, `brand/`, `a11y/`, and one prefix per adapter.

Every new rule needs a fixture that triggers it in `test/fixtures/tells/` and must stay silent on `test/fixtures/clean/`.

## Tests

```sh
node scripts/test/run.mjs
```

The runner calls the CLI with `--format json` on the fixtures and checks expected rule ids, counts, exit codes, config handling and inline directives. Clean fixtures must produce zero findings.

## Known limitations

- Heuristics, not a parser. HTML and JSX are tokenized with regular expressions; deeply nested JSX expressions in attributes or TypeScript generics can confuse the text view (code-looking text is dropped rather than flagged).
- Rules see one file at a time. A gradient set in one class and `background-clip: text` in another, or a focus style defined in a different file, is not connected.
- `design/negative-tracking-small` and `design/uppercase-tracking` only see values written in the same rule block; token values (`var(--…)`) are not resolved.
- Language detection needs a few common words; very short files may need `--lang de`.
- `brand/address-du` cannot tell a quoted du-sentence (a testimonial) from the brand's own voice; silence it on that line.
- Unsourced social proof is matched by pattern. The linter cannot know whether a number is listed in the brand profile's facts; the agent or reviewer must check.
- JSX inline style objects (`style={{ … }}`) are not read as CSS.
