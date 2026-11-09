---
name: site-bricks
description: "Apply the toolkit rules on sites built with Bricks Builder: global classes, variables, palettes and theme styles instead of element literals, safe write paths, naming, verifying on the frontend, Bricks with or without Automatic.css. Use whenever an agent reads or writes a Bricks site."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Bricks

**Use this if** the site is built with Bricks Builder for WordPress and an agent reads or writes it, through the builder's AI abilities (Bricks 2.4+), an MCP adapter, WP-CLI, or by preparing elements and CSS for a human to paste. Bricks can be used on its own, with its native global classes, variables, color palettes and theme styles, or together with Automatic.css through ACSS's Bricks integration. If the project loads ACSS, read the `site-acss` skill too: ACSS tokens and utilities then take precedence over hand-built Bricks variables. This adapter covers where the design passes land in Bricks and how to write without breaking the site; build mechanics live in the Bricks Academy (<https://academy.bricksbuilder.io/>).

Brand values (colors, fonts, scale, radius, voice) come from the project's brand profile (the brand profile (template in the `site-brand` skill)). In Bricks they are entered once as palette colors, global variables and theme style settings (or in the ACSS dashboard), never repeated as literals on elements.

## Safe write paths

- **Write Bricks content through Bricks.** Use the Bricks abilities or the builder. Bricks protects its content post meta; a raw `update_post_meta` on the content keys fails or corrupts the tree. Never hand-edit the serialized element array in the database.
- **Every element write re-validates and saves the whole page tree.** One invalid element anywhere blocks the save, and two writes to the same document in parallel overwrite each other.
  - Rule: never run parallel element writes on one document; batch related changes into one save.
  - Rule: read the current tree immediately before writing; do not write from a tree you fetched before the user edited in the builder.
- **Global design resources carry ownership or version data.** Read the resource right before an update and pass the returned ownership unchanged. On a stale-precondition error, re-read and rebase; never fabricate the version.
- **Updates merge settings recursively, but some arrays are replaced whole** (for example a class's `selectors`). Send the complete array, with ids, when changing one entry.
- **Sibling order follows the flat elements array**, not only the `children` lists. When moving a subtree, also reorder it in the flat array.
- **Element ids have a fixed format** (six characters). Generate valid ids; do not reuse ids from another page.
- **Preview a change before committing it** where the API offers a dry run (`save: false`, render previews), and show generated scales or shades to the user before saving.
- **Destructive changes need the user's approval:** deleting classes, variables, components or theme styles that may still be referenced.

## Native elements

Bricks ships a native element for most content jobs, each with its own controls, accessibility behavior and dynamic-data support. Building everything from Div and Code elements produces div soup the user cannot edit. Pick the element that carries the job; the element `name` in the JSON is what the table lists.

- **Use the native element for its job.** Text is `heading`, `text-basic` or `text`, never a Div with text in custom code. Images are `image`, not backgrounds. Widgets (accordion, tabs, slider, nav) are the nestable elements, not hand-built divs with custom JS. Keep an existing specialized element when editing; do not flatten it to divs.
- **Structure is section > container > content.** A new `section` (100% wide, tag `section`) arrives with a `container` inside (centered, theme-style width, default 1100px). Inside a container, `block` is the full-width flex wrapper for columns and cards; `div` has no presets and is for grouping or class-based layout. Do not put a raw `div` where a container or block belongs, and do not re-add widths or centering they already have.
  - With ACSS: the dashboard sets section block padding and the gutter on top-level sections, and the content width; point the theme style's container width at `var(--content-width)` once. No padding or `max-width` on individual sections and containers unless deviating, then through `--section-space-*` and the gap tokens.
  - Without ACSS: section padding and container width live in the theme style, set once for the site.
- **Set semantic tags through the HTML tag setting** (or Custom tag) instead of adding wrappers: `header`, `footer`, `nav`, `article`, `aside`, `ul`/`li` on layout elements; `figure`/`figcaption` on Image and Basic Text.
- **Links navigate, buttons act.** The `button` element renders a `span` by default and an `a` once a link is set. For an on-page action (open an offcanvas, submit), set its HTML tag to `button`; a span is not focusable. Navigation CTAs keep the link and use the button class or ACSS `btn--*`.
- **Headings follow the outline.** One `h1` per page; each section opens with a heading one level down; size via class, not via a different tag. Never use Basic Text with a heading tag or a Heading for non-heading text.
- **Repeat with query loops, reuse with components.** Repeated cards are one element with "Use Query Loop" (or one component instance inside a looped element), not copies. Variable inner content goes into a `slot`, not a long property list. Check existing components before creating one.

| Content need | Bricks element (`name`) | Notes |
|---|---|---|
| Page section | Section (`section`) | Root level only. ACSS or the theme style supplies padding. |
| Content width wrapper | Container (`container`) | Theme-style width (ACSS: `--content-width`). At root or inside a section; nest Blocks, not Containers, inside it. |
| Grid of cards | Block (`block`) or Div (`div`) with tag `ul`, grid on its class | The grid parent never loops; the looped card sits inside it. |
| Card | Block (`block`), tag `li` or `article`; usually a component instance | Block is a flex column with `align-items: flex-start`; stretch children on the class if needed. |
| Heading | Heading (`heading`), tag `h1`–`h6` | Level by outline. |
| Paragraph | Basic Text (`text-basic`), tag `p` | Default tag is `div`; set `p`. |
| Rich text | Rich Text (`text`) | WYSIWYG for mixed headings, lists, inline links, and editor fields from dynamic data. |
| List | Rich Text list, or Div/Block tag `ul` with Div children tag `li` | The List element (`list`) is a styled repeater (title, meta, description), not a general `ul`. |
| Image | Image (`image`) | Alt text, `srcset`, lazy loading. Never a `_background` image for content. |
| Figure with caption | Image (`image`), tag `figure`, caption type set | Default tag is already `figure`; Bricks keeps it when a caption exists. |
| Video | Video (`video`) | YouTube, Vimeo, media library or file. Set the iframe title; privacy-enhanced mode where required. |
| Icon | Icon (`icon`) or SVG (`svg`) | Prefer SVG sources over icon fonts; color via `currentColor`. |
| Button / CTA | Button (`button`) | Tag `a` with a link, `button` for actions. |
| Text link | Text link (`text-link`); inline links inside Basic or Rich Text | Not a Button styled as text. |
| Navigation | Nav (Nestable) (`nav-nested`); Nav Menu (`nav-menu`) for a WordPress menu | Mobile toggle is configured on the parent; Dropdown (`dropdown`) for submenus. |
| Accordion / FAQ | Accordion (Nestable) (`accordion-nested`) | Bricks handles `aria-expanded` and keys; do not add duplicate JS. |
| Tabs | Tabs (Nestable) (`tabs-nested`) | Tab buttons and panels match by order. |
| Slider | Slider (Nestable) (`slider-nested`) | Loop the slider itself to make one slide per item. |
| Form | Form (`form`) | Fields, actions and anti-spam per the Academy page; test the email action on the live site. |
| Posts / CPT items | "Use Query Loop" on `container`, `section`, `block` or `div` (also accordion, slider, tabs) | The looped element is the repeating cell; grid or flex goes on its non-looping parent. |
| Conditional content | Element conditions (`_conditions`) on any element | Hidden elements are not rendered. OR groups, AND items; verify on the frontend. |
| Reusable pattern | Component (instance `{ "cid": … }`) with properties; Slot (`slot`) for free content | Properties must be connected to controls; variants as a global-class property. |

**Before writing, look it up.** When an element or setting is not in this table, fetch the Academy page or the element schema instead of guessing:

- Overview and layout: <https://academy.bricksbuilder.io/builder/elements/>, <https://academy.bricksbuilder.io/builder/styling/layout/>; layout elements under `https://academy.bricksbuilder.io/builder/elements/layout/`: `section/`, `container/`, `block/`, `div/`
- Basic elements under `https://academy.bricksbuilder.io/builder/elements/basic/`: `heading/`, `text-basic/`, `text/`, `text-link/`, `button/`, `image/`, `video/`, `icon/`; SVG: <https://academy.bricksbuilder.io/builder/elements/media/svg/>
- Nestable widgets under `https://academy.bricksbuilder.io/builder/elements/general/`: `nav-nested/`, `accordion-nested/`, `tabs-nested/`, `offcanvas/`; slider: <https://academy.bricksbuilder.io/builder/elements/media/slider-nested/>
- Forms and code: <https://academy.bricksbuilder.io/builder/elements/general/form/>, <https://academy.bricksbuilder.io/builder/elements/general/code/>
- Loops, conditions, components: <https://academy.bricksbuilder.io/builder/dynamic-content/query-loop/>, <https://academy.bricksbuilder.io/builder/features/element-conditions/>, <https://academy.bricksbuilder.io/builder/features/components/>, <https://academy.bricksbuilder.io/builder/elements/general/slot/>
- ACSS on sections and containers: <https://docs.automaticcss.com/spacing/section-spacing>, <https://docs.automaticcss.com/dimension/content-width>

## Where styles belong

Bricks emits CSS in a fixed order: global variables, theme styles, utility classes, global classes, palette color variables, page custom CSS, then header, content and footer element CSS. Later wins at equal specificity, so element-level CSS beats a global class.

- **Reusable styling is a global class**, not element-level settings repeated on every instance. If you style the same thing twice, it should be a class.
- **Values are global variables or palette colors**, referenced as `var(--name)`. No literal hex or px that duplicates an existing variable.
- **Site-wide typography, link and button defaults are a theme style.** A theme style with no conditions is ignored; the site-wide base style needs a condition that matches every page (`any`).
- **Page custom CSS** only for rules that truly belong to one page and cannot be a class.
- **Element CSS (`_cssCustom` with `%root%`)** for one-off adjustments the user should still find in the builder. It is the path that needs no extra permissions.
- **Code elements and custom code settings** for scripts. Put pre-paint scripts (for example initial animation states) in the template's header scripts, not as the first element in `<main>`, where they can shift layout rules that target the first child.
- **Keep code where the user can see and edit it.** Prefer Bricks classes, element CSS and code elements over CSS hidden in a must-use plugin or child theme, unless the code is security or hosting related.
- **Know the silent conversions:** `display: none` written into element CSS can be stored as the layout setting `_display`; clearing the CSS then changes nothing. Clear both.

## Naming

- **Detect the site's convention and match it.** Read the existing classes, variables and components first: case, prefixes, modifier separator, scale naming (t-shirt or numeric). Never start a parallel convention.
- **Global class names are unique and kebab-case** on most sites. Variants are modifier classes that change one thing (color, size), combined with the base class, not copies of the base.
- **Same role, same class.** Before creating `.hero-eyebrow`, search for an existing eyebrow class. Per-page copies of the same component (eight eyebrow classes from eight landing pages) are the main way Bricks design systems rot.
- **Variables are created by bare name** (`space-m`); Bricks adds the `--` prefix in CSS.
- **Component labels are human-facing:** readable title case such as `Hero: Dark`, not `hero_dark_v2`.
- **Mixed conventions are a finding, not a license.** Report them and ask which convention wins; do not rename existing resources unilaterally.

## Pass mapping

The pass rules live in `site-design`. Bricks-specific landing points:

| Pass | In Bricks |
|------|-----------|
| Subtract | Delete element settings that restate the class or theme style. Run the design-system audit for unused classes, orphan references and condition-less theme styles; delete only with approval. With ACSS, utility classes are registered as global classes with empty settings: empty is not unused. |
| Spacing | Gaps on the parent (`row-gap`/`column-gap` or a gap variable), not margins on children. Spacing values from the spacing scale variables, generated by the scale generator, never hand-authored steps. With ACSS, use its contextual gap tokens. |
| Color | One palette, with each color's `raw` value pointing at a CSS variable. Shades generated from the base, not hand-picked. Check for duplicate colors across palettes before adding one. Dark sections with ACSS: the `bg--*` utility, so link and text colors flip with it. |
| Icons | Prefer inline SVG or the Bricks SVG element over icon fonts. Icons take `currentColor`. Lazy-load plugins can hide SVG images without dimensions; exclude them from lazy loading and verify they render. |
| Copy | Visible text in text and heading elements or component properties the user can edit, not baked into code elements. Apply `site-copy` and the brand voice. |
| Type | Sizes from the typography scale variables (or ACSS `--h*` / `--text-*`). The scale generator derives from the root font size; check that root value before trusting generated px. Real heading levels for structure; visual size via class, not by choosing a different heading tag. |
| Layout | Grid on the parent when it owns the columns, mobile-first if the site's breakpoints are configured mobile-first; otherwise follow the site's breakpoint direction consistently. Watch Bricks defaults: `.brxe-div` has `max-width: 100%`, `.brxe-block` is a flex column with `align-items: flex-start`. |
| Details | Images are image elements with alt text and `srcset`, never a div with a background image (invisible to assistive tech, no responsive sources). Buttons use one button class or the ACSS `btn--*` system. Forms, popups and interactions follow their Academy pages. |
| Motion | Interactions and animation classes respect `prefers-reduced-motion`; provide a calm variant. Avoid interactions that run on scroll for every element. |
| Verify | On the rendered frontend URL, not the builder or the template preview URL (below). |

## Bricks with ACSS

When ACSS is installed, its integration registers ACSS utilities and variables inside Bricks. Then:

- **ACSS tokens replace hand-built Bricks variables.** Do not create a parallel `--space-*` or color variable set in Bricks that duplicates ACSS; reference the ACSS names (see the `site-acss` skill for the list and the warning against inventing names).
- **Colors come from the ACSS dashboard,** not from a separate Bricks palette with the same hex values. If a Bricks palette exists for builder convenience, its entries should reference ACSS variables in `raw`.
- **Do not delete ACSS-registered global classes because their settings are empty.** Their CSS comes from the ACSS stylesheet; check the compiled ACSS file and dashboard flags before treating one as unused.
- **Buttons, contextual backgrounds and gaps follow ACSS** (`btn--*`, `bg--*`, `--content-gap` / `--container-gap` / `--grid-gap`). Bricks' own button styles in the theme style should not compete with them.
- **ACSS layout features interact with Bricks templates.** For example, an automatic header offset can still apply when a header is hidden on one page; turn it off per page through the documented body class, not with a higher-specificity override.

## Components

- **Extract a component when the same element tree repeats with different content,** using component properties for the content and keeping classes and variables inside the component.
- **Instance-level classes and colors may not survive rendering;** expose what should vary as a property instead of styling the instance.
- **Deleting a component that is still used leaves orphan placeholders.** Replace usages first or get explicit approval.
- **Empty is not hidden:** an empty text property can still render, and a non-empty component default can win over an empty instance value. Test the "hide when empty" case on the frontend.

## Templates and conditions

- **One template wins per context;** more specific conditions beat broader ones. When a page renders the wrong header or no content, check template conditions before editing elements.
- **Every public custom post type needs a single template (and usually an archive template).** Without one, singles can render empty between header and footer.
- **Template preview URLs are not the page.** Page-specific hooks and styles may not run on a template preview; verify on the real URL.

## Imports

- **HTML/CSS import is a draft, not a result.** Importers can lose multi-value shorthands, drop `display` or `flex` values, double-quote font families, turn `dt`/`dd` into divs and replace images with background divs. Diff the rendered DOM against the source after every import and rebuild lost pieces as native elements and classes.
- **After import, move styling back to the system:** imported typography and colors often land on classes, sub-selectors, breakpoint keys and the first section's custom CSS. Replace literals with variables or ACSS tokens.

## Verify

- **Check the rendered frontend at real viewport widths,** with a cache-busting query string and the cache header checked, after every save.
- **Console clean:** no errors, no failed requests, no font 404s.
- **Verify content-specifically:** element wrapper ids such as `brxe-{id}` are not always printed (for example when the element carries a global class), so grep for the actual content, image filename or attribute you changed.
- **Run accessibility checks on the frontend** (heading order, link contrast inside dark cards, `dl` structure, alt text).
- Detail: `site-verify`.

## Lint hints

Patterns `slop-lint` (in the `site-audit` skill) could flag in Bricks exports (page JSON, global classes JSON, CSS):

- Hex/`rgb()` literals in element or class settings where palette colors exist
- Palette entries whose `raw` value contains no `var(`
- Duplicate hex values across palette entries
- Theme styles with an empty `conditions` array
- Global class names that break the site's dominant case convention (mixed kebab, camel, snake)
- Near-duplicate class names sharing a role word with different prefixes (`*-eyebrow`, `*-lede`, `*-card`)
- `var(--…)` references to variables not defined in the exported variables list (orphans)
- Elements with a `_background` image and no image element sibling where content images are expected (div-as-image)
- Image elements without `altText` (and not marked decorative)
- `_cssCustom` without a selector (`%root%` or a real selector) or written as a single line
- `display:\s*none` in `_cssCustom` (gets converted to a layout setting)
- `margin-(top|bottom)` on children inside flex/grid parents with gap
- `transition:\s*all`, `animation` without a `prefers-reduced-motion` guard in custom CSS
- `wp_update_post` / `update_post_meta` on `_bricks_page_content` keys in agent scripts
- A `div` as the direct child of a `section` where a `container` is expected, or a `container` nested inside a `container`
- `div` elements without global classes or settings nested more than three levels deep (wrapper soup)
- `code` or `html` elements whose markup contains `<h[1-6]`, `<p`, `<img`, `<ul`, `<a ` or `<button` that native elements could express
- `button` elements with no link and no `tag: "button"` (renders a non-focusable `span`); `text-basic` with a heading tag
- A query loop (`hasLoop`) on the element that also carries the grid or flex layout; three or more sibling subtrees with the same element-name signature (should be a loop or a component)
