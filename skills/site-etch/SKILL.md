---
name: site-etch
description: "Apply the toolkit rules on sites built with Etch for WordPress: where styles belong, safe write paths through the etch API, not clobbering builder edits, verifying on the rendered frontend. Use whenever an agent reads or writes an Etch site; build mechanics come from the Etch docs and Kevin Geary's toolkit."
license: CC-BY-4.0
---

<!-- last-reviewed: 2026-11-08 -->
# Etch

**Use this if** the site is built with Etch, the visual development environment for WordPress, and an agent reads or writes the site through Etch's own API (the Etch Connector and the `etch.*` bridge) or through the Etch REST API. This adapter does not teach the build mechanics; for those, use Kevin Geary's Agentic Toolkit for Etch (<https://github.com/kevingeary/gearyco-agentic-toolkit-for-etch>) and the Etch documentation (<https://docs.etchwp.com/>). What follows is where the design passes land in Etch, which write paths are safe, and how to avoid destroying work the user did in the builder. Most Etch sites run Automatic.css; read the `site-acss` skill alongside this file when they do.

Brand values (colors, fonts, scale, radius, voice) come from the project's brand profile (the brand profile (template in the `site-brand` skill)). In an Etch plus ACSS project they live in the ACSS dashboard; in a plain Etch project they live in one global variables stylesheet. Never in component classes.

## Safe write paths

- **Change Etch objects only through Etch.** Pages, templates, components, styles and stylesheets are written through the `etch.*` API or Etch's REST namespace (`/wp-json/etch-api/…`). Never through WordPress core routes such as `wp/v2/pages` or `wp/v2/templates`, and never through direct post-meta or database writes.
  - Why: a template created through the core route is treated by Etch as a foreign document; builder edits to it do not reach the frontend.
- **Never write into the canvas DOM.** No `document.querySelector(...)` edits in the builder iframe. Inspection through CDP (screenshots, rendered HTML, computed styles) is fine; writing is not.
- **Template slugs follow the WordPress template hierarchy.** `home` is the blog index, not the start page; the static start page is `front-page`; `page-{slug}` beats `page`.
- **Smallest change that satisfies the request.** Do not remove content you were not asked to remove. Do not wrap a page in an extra wrapper; sections are the top level.

## Not clobbering the user's edits

- **A save persists the whole in-memory state, not your diff.** `etch.saveAsync()` writes the complete block tree the bridge holds for every document opened in that tab session, plus the global style and stylesheet maps as the tab loaded them. There is no merge and no version check: last writer wins.
  - Rule: open, read, mutate and save in one script run, with no gap in which the user can edit.
  - Rule: if the user has worked in the builder since your tab loaded, reload the tab before your next write. Re-opening a document that is already open in the same tab can return the cached copy, not a fresh read.
  - Rule: never run two agents or two scripts against the same tab at once.
- **The reverse is also true:** the user's next save from an older builder tab can delete a stylesheet or style your script created. After the user works in the builder, re-verify your changes on the frontend.
- **Block ids are not stable.** They are reassigned on load and save. Find targets by a `data-*` attribute, class or structure inside the same script run; never store ids across runs.
- **A script that timed out may still be running in the browser** and can write into whatever document is open next. After a timeout, check the tab state before starting another write.
- **Back-to-back saves can be dropped.** Some Etch versions ignore a second save that follows the first within about a second. Space consecutive saves in one run, and do one document per run when saving several templates.
- **Keep scripts idempotent:** find or create, then update. A re-run must not duplicate blocks, styles or stylesheets.
- **Reorder with the move API** (`etch.blocks.move`), not by delete and recreate, so the user's settings on the block survive.

## Native elements

Etch elements are real HTML plus Etch-managed behavior. Ignoring them produces div soup: anonymous `div`s, raw `<img>` tags, hand-copied cards. Pick the element that carries the job.

- **Use the Etch element for its job.** Headings are Heading, paragraphs are Text, links are Anchor, media-library images are Dynamic Image, icons and logos are SVG. A plain Div has no defaults and no meaning; use it only to group children when nothing below fits, and give it a class with a reason.
- **Structure is section > container > content.** A new Section arrives with a Container inside. Etch already makes sections a centered flex column and containers `inline-size: 100%`, `max-inline-size: var(--content-width)`, centered, flex column, all at zero specificity. Do not re-declare any of it.
  - With ACSS: top-level sections get block padding and the gutter from the dashboard; Automatic Spacing (when enabled) puts `--container-gap` between a section's child divs and `--content-gap` inside them. Deviations go through `--section-space-*` or the gap tokens on the section's class.
  - Without ACSS: sections have no padding and no gutter. Set both once globally (see the how-to below), never per section.
  - Sections are the top level of a document: no `main` or wrapper div around them. Several containers in one section are fine for separate content groups.
- **Set the semantic tag on the element instead of adding wrappers.** Any element can change its tag: `header`, `footer`, `nav`, `article`, `aside`, `ul`/`ol`/`li`, `figure`/`figcaption`. Do not use the deprecated Flex Div (`data-etch-element="flex-div"`).
- **Anchor navigates, button acts.** Etch has no Button element by design. An on-page action (open a dialog, advance a slide) is a Text or Div with its tag set to `button`; a CTA to a URL is an Anchor with ACSS `btn--*`. Never `a href="#"` with a click handler.
- **Headings follow the outline, not the size.** One `h1` per page, in the first section; each section opens with a heading one level down. Visual size comes from a class. Inside a component, the level is a select prop on a Dynamic Element.
- **Repeat with loops, reuse with components.** Three similar cards are one card component inside a Loop, not three copies. Collections are a `ul` with the loop around the `li`. Free-form inner content goes into a slot, not into a growing list of props.
- **Check Etch's native components and patterns before hand-building a widget** (accordion, carousel, nav, dialog, off-canvas). They ship with their CSS, JS and keyboard behavior and paste in through the clipboard API. Some are listed but marked planned; read the page before promising one.

| Content need | Etch element (block type) | Notes |
|---|---|---|
| Page section | Section: `etch/element`, tag `section`, `data-etch-element="section"` | Comes with a Container. ACSS supplies padding and gutter. |
| Content width wrapper | Container: `etch/element`, tag `div`, `data-etch-element="container"` | Width and centering are built in; no `max-width` in its class. Has no gutter, so keep it inside a section. |
| Grid of cards | `etch/element` tag `ul` (or `div` for unrelated panels) with a grid class | Its own block (`.feature-list`), not `__grid`. Grid on this parent; the Loop sits inside it. |
| Card | Component instance (`etch/component`), root tag `li` or `article` | Root via Dynamic Element (`etch/dynamic-element`, `<etch:element tag={props.tag}>`) when used inside and outside lists. |
| Heading | Heading: `etch/element` tag `h1`–`h6` (default `h2`) | Text in an `etch/text` child. Level by outline. |
| Paragraph | Text: `etch/element` tag `p` with an `etch/text` child | One paragraph per element. Never several paragraphs in one Text. |
| Rich text | HTML element: `etch/raw-html` (`<etch:html />`) bound to the field | Only for HTML from the database or a prop. Post content in templates: `{@post-content}` (`etch/post-content`). Static copy is built from Heading and Text. |
| List | `etch/element` tag `ul`/`ol` with List Item (`li`) children | Add `role="list"` when list styles are removed. |
| Image | Dynamic Image: `etch/dynamic-image` (`<etch:img mediaId=… />`) | Alt, `srcset`, `sizes` from the media library. Plain Image (`etch/element` tag `img`) only for non-library sources. |
| Figure with caption | `etch/element` tag `figure` > Dynamic Image + Text with tag `figcaption` | No dedicated element; never a caption in a bare `div`. |
| Video | iFrame (`etch/element` tag `iframe`) for embeds; tag `video` for self-hosted | iFrame defaults to full width, 16:9. Set `title`. The docs page is thin; check it for updates. |
| Icon | SVG: `etch/svg` (`<etch:svg />`) | `stripColors` for monochrome icons so they take `currentColor`; never on multi-color logos. No icon fonts. |
| Button / CTA | Anchor (tag `a`) to navigate; Text or Div with tag `button` to act | ACSS `btn--*`, not own button classes. |
| Text link | Anchor inside a Text element | Real `href`. |
| Navigation | Basic Nav / Advanced Nav native component; else tag `nav` > `ul` > `li` > Anchor | Native nav reads its items from a loop in the Loop Manager; edit the loop, not the markup. |
| Accordion / FAQ | Accordion native component (pattern) | Answers go in a slot. Prefer it over a hand-rolled `details` stack. |
| Tabs | None yet (marked planned in the docs) | Check docs and patterns first; otherwise a component with real `button` tabs and ARIA roles. |
| Slider | Carousel, Logo Carousel or Scroll Snap native component | Slides from a Loop when the content repeats. |
| Form | The form plugin's block (passed through untouched) or its shortcode in an `etch/text` node | No native form element. A hand-written `form` needs labels, a backend and spam protection. |
| Posts / CPT items | Loop: `etch/loop` (`{#loop name as item}`) | Ghost element, no DOM. Query in the Loop Manager (WP Query, terms, users, JSON); templates use the main query. |
| Conditional content | Condition: `etch/condition` (`{#if …}`) | Ghost element. No else branch and no inline fallbacks: write the negated condition as a second block. Not for defensive checks. |
| Reusable pattern | Component: `etch/component`; slots `{@slot name}` (`etch/slot-placeholder`, filled by `etch/slot-content`) | Content as props; variants as a select prop on a `data-*` attribute, not class names built from props. |

**Before writing, look it up.** When an element, attribute or block type is not in this table, read the Etch docs page, or check Kevin Geary's markup reference (<https://github.com/kevingeary/gearyco-agentic-toolkit-for-etch>), instead of guessing:

- Elements, all under `https://docs.etchwp.com/elements/`: `overview`, `section`, `container`, `div`, `text`, `heading`, `anchor`, `image`, `dynamic-image`, `svg`, `iframe`, `html`, `element` (Dynamic Element)
- Loops and conditions: <https://docs.etchwp.com/elements/loop>, <https://docs.etchwp.com/loops/basic-loops>, <https://docs.etchwp.com/elements/condition>, <https://docs.etchwp.com/conditional-logic/intro-to-conditional-logic>
- Components: <https://docs.etchwp.com/components/intro-components>, <https://docs.etchwp.com/components/slots>, native components <https://docs.etchwp.com/components-native/overview>, patterns <https://patterns.etchwp.com/>
- Third-party blocks (forms): <https://docs.etchwp.com/gutenberg/passthrough>; section defaults without ACSS: <https://docs.etchwp.com/how-to/basics/how-to-set-global-section-styles>
- ACSS on sections and containers: <https://docs.automaticcss.com/spacing/section-spacing>, <https://docs.automaticcss.com/spacing/automatic-spacing>, <https://docs.automaticcss.com/dimension/content-width>

## Where styles belong

- **Component styles are managed class styles** (`etch.styles.*`, applied to blocks as classes). Nest states, variants and media queries inside the owning class. One managed style per real component, not one per rule.
- **Managed styles are tree-shaken by block usage.** A class style is emitted only when the class sits on an actual Etch block. CSS for DOM that JavaScript builds at runtime will not ship from a managed style.
  - Fix: build structure as real blocks wherever possible and let JS select them; ship CSS for genuinely runtime-built DOM inside the widget's own script or in a global stylesheet.
- **Global stylesheets (`etch.stylesheets.*`) hold only what is global by nature:** `@font-face`, `@keyframes`, and the rare rule that must target DOM not represented by blocks. They are not tree-shaken and apply to every document. They persist immediately, unlike styles and blocks, which need a save.
- **`@keyframes` never nest inside a component rule.** They go in one global animations stylesheet; components only reference them.
- **Do not push a `:root` token sheet, a reset, or the structural `:where([data-etch-element=…])` defaults.** Etch and ACSS already provide them.
- **Etch emits a page's CSS when that document is saved.** After changing a managed style that several documents use, open and save each affected document, then check the served CSS.
- **Etch CSS conventions:** flat BEM (every class its own top-level rule), states and queries nested inside the class they change, no media queries at root level, px only via `to-rem()`.
- **Elements under about 20px** need `--empty-element-size: 0` on their class; Etch gives canvas elements a minimum size to stay clickable.

## Naming

- **BEM blocks for components; cards and lists are their own blocks.** A card inside a section is `.feature-card`, not `.features__card`; its children are `.feature-card__title`. A collection is `.feature-list` on a `ul`, not `.features__grid`.
- **Semantic tags:** `ul`/`li` for collections, `article` for self-contained items, `section` > container > content as the default structure. Do not default every wrapper to `div`.
- **Sections get a purpose-named class** (`.pricing-section`), not a generic helper (`.section-pad`).
- **Reuse before creating.** Search the existing managed styles for a class with the same role before adding one. Global classes are shared across documents, so a near-duplicate created on one page is visible everywhere.

## Pass mapping

The pass rules themselves live in `site-design`. Etch-specific landing points:

| Pass | In Etch |
|------|---------|
| Subtract | Remove declarations that restate Etch or ACSS defaults (container width, `display:flex; flex-direction:column` on containers and sections, list resets, link colors inside `bg--*` sections). Measure computed defaults first. Delete unused managed styles and dead plugin styles only after confirming zero block usage. |
| Spacing | Containers are already flex columns with a gap; a `margin-block` on a container's direct child doubles the spacing. Override the container's `gap` on its class instead. See the `site-acss` skill for gap tokens. |
| Color | Dark and light surfaces through the ACSS `bg--*` utility on the block. On a component definition, the utility is attached as a style reference (an empty managed style for that selector), because class attributes on definitions may be stripped. |
| Icons | Monochrome SVG icons inherit `currentColor`; strip fills only on monochrome marks, never on multi-color logos. Prefer inline SVG blocks over icon fonts. |
| Copy | Text lives in real blocks so the user can edit it in the builder. Never hardcode copy inside a script's `innerHTML`. Apply `site-copy` and the brand voice before writing any label, heading, form text or meta description. |
| Type | No `font-size` on headings or text unless deviating. Fonts: `@font-face` with weight ranges in one global stylesheet only; ACSS keeps the family variables. Remove duplicate face sources (WordPress Font Library, `theme.json`). |
| Layout | Grid on the parent when it owns the columns; mobile-first range queries nested inside the class. Etch's flex-column container default is not a reason to use flex; a class overrides the zero-specificity default. |
| Details | Buttons through ACSS `btn--*`. Header and footer usually live in templates; if several templates carry identical copies, a component instance per template avoids repeating every fix. |
| Motion | Keyframes in the global animations stylesheet; reduced-motion variants required. |
| Verify | On the rendered frontend, never in the builder (below). |

## Components and templates

- **Repeated chrome belongs in a component.** Header and footer are usually built in templates, and each template that renders its own header carries its own copy. If those copies are meant to be identical, convert them to one component with an instance per template, so a fix is made once. If templates differ on purpose, keep them separate.
- **Confirm copies are identical before merging them** (same structure, same classes, same content); otherwise you silently delete a deliberate variant.
- **Component instances are not plain blocks.** Some block operations (adding a class to an instance) do not apply; style the definition, or expose the variable part as a property.
- **New templates are created and filled through Etch** (template API plus builder bridge), then verified on a page that actually uses the template.
- **A builder left in component edit mode** can make saves succeed while the frontend never updates. If the frontend ignores a confirmed save, check the builder's mode and the console before retrying.

## Scripts and widgets

- **One script block per widget, inside the widget's own section,** carried by an element with a stable `data-*` attribute. Not one page-wide script blob.
- **Scripts on blocks can be write-once.** If an update does not change the code, create a new carrier block with the new script and delete the old one.
- **Runtime-built pages look empty in the builder by design.** Version the loader (`data-loader="3"`) so a reload proves which version ran, and self-host the assets; no third-party CDNs on production sites where privacy rules apply.

## Verify

- **Check the rendered frontend, not the builder canvas.** The canvas has builder-only styles, minimum element sizes and unsaved state.
- **Cache-bust before trusting a result:** add a query string, check the cache response header, and confirm the served CSS contains your change.
- **Console clean:** no uncaught exceptions, no failed requests, no font 404s. Use headless Chrome with CDP (`Runtime.exceptionThrown`, `Log.entryAdded`).
- **Re-verify after the user touches the builder,** because an older tab's save can revert your stylesheet or style changes.
- **Verify fonts by weight** (`document.fonts.check`) and by identity: a wrong cut of the right family also "loads".
- **Screenshot at real viewport sizes,** including a true 390px mobile width, not only a resized desktop window.
- Detail: `site-verify`.

## Lint hints

Patterns `slop-lint` (in the `site-audit` skill) could flag in Etch projects (scripts and exported CSS):

- `wp/v2/(pages|posts|templates|template-parts)` with POST/PUT in agent scripts (wrong write path for Etch objects)
- `etch.styles.(create|update|delete)` or `etch.blocks.` calls in a script with no `saveAsync` after them
- `etch.styles.update(<id>, '<string>')` with a string second argument (the API expects an object such as `{ css }`)
- More than one `saveAsync` in a script without a delay between them
- Stored block ids reused across runs (numeric/random id literals passed to `etch.blocks.*`)
- `@keyframes` nested inside a class rule
- `@media` at the root of a component style instead of nested
- Raw `rem`/`px` outside `to-rem()` in managed styles
- Nested BEM via `&--` / `&__` (Etch convention is flat BEM)
- `.section__card`, `__grid`, `__list` element names for cards and collections
- `innerHTML\s*=` with visible copy in widget scripts
- `document.querySelector` writes in scripts targeting the builder canvas
- `@font-face` in more than one source; `@font-face` without a weight range for a variable font
- External CDN URLs (`cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`) in production assets
- `etch/element` with tag `div` and no class nested more than three levels deep (div soup)
- `etch/element` with tag `img` whose `src` points into `/wp-content/uploads/` (should be `etch/dynamic-image`)
- `etch/raw-html` or a single `etch/text` holding static `<h1-6>`, `<p>`, `<ul>`, `<img>` or `<a>` markup that native elements could express
- `etch/element` tag `a` with `href="#"` or no `href` (an action needs `button`); a top-level block whose tag is not `section`, `header` or `footer`; `data-etch-element="flex-div"`
- Three or more sibling subtrees with the same tag and class signature (should be a loop or a component); heading levels that skip (`h2` then `h4`)
