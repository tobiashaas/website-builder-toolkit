# Changelog

## Unreleased

- `render-check --direction <file>`: new check `style-position`. It measures all five axes of the style position on the render from computed values (corner radius, largest font size against body size, section padding, hue families, images in the first viewport), so it also works where a framework sets them through variables.

- Order of SEO fixed: `site-seo` step 1 (search data) now runs with `site-structure`, before direction and copy; steps 2 to 6 and the check stay before `site-verify`. `site-wizard`, `site-seo`, `site-structure` and `site-copy` say so.

- `render-check --css-effect`, after a test on live sites and a review: compares every matched element (up to 300, then an even spread) instead of the first twelve, keeps several `<style>` blocks apart, judges nested rules, names the twin of a duplicated declaration, leaves rules untouched that the browser cannot restore exactly, runs after the screenshot, and recognises Automatic.css and reset files by name.
- `render-check`: a document answering HTTP 400 or above is an error (a block page was measured, not the site); a JavaScript dialog no longer hangs the run.
- `slop-lint`: `failOn` from the config file is honored; `perf/lazy-high-priority` reads parsed attributes (no match on `data-loading`); font-size rules read the `font` shorthand and skip tokens such as `--text-width`; a direction file without a style position is a usage error; tab-indented front matter is read.
- `seo-check`, `inventory`: `max-image-preview:none` is no longer read as noindex.
- Skills: `--direction` in the lint commands of `site-verify` and `site-audit`, a style-position block and a corrected review order in `site-verify`, the web platform rules also in `site-design` so builder projects see them, and two dead references fixed.

- `render-check`: `--css-effect` with the check `css-no-effect`. It removes each declaration of the page's own stylesheets in the browser (framework and core are left out, `--css-only` narrows it) and reports the ones whose removal changes no computed style. `site-verify` runs it first in the review before handing over.

- `site-direction`: style position on five measurable axes (density, type contrast, shape, color budget, imagery), a direction template with front matter, and four starting points for variants. The brand profile can set a site-wide position under `style`.
- `slop-lint`: `--direction <file>` and two rules, `direction/shape` and `direction/type-contrast` (52 rules).

- Web platform rules in `site-design/plain-css.md` and `site-polish`: image priority for the largest image of the first viewport, fluid type range, `font-size-adjust`, limits of `text-wrap: balance`, forced colors. Sources in `docs/EVIDENCE.md`.
- `slop-lint`: two new rules, `css/fluid-type-range` and `perf/lazy-high-priority` (50 rules).
- `render-check`: new check `image-priority` (largest `img` of the first viewport lazy-loaded or without `fetchpriority="high"`; more than two high-priority images).
- `render-check` tests: the report-folder test compared against an unresolved temp path and failed on macOS.

## 0.4.0 (2026-11-13)

- New skill `site-styleguide`: styleguide for Automatic.css projects as a worksheet for the dashboard. Slop check before decisions are frozen, every value bound to a real token, contrast computed per surface, values without a slot listed, design file and dashboard kept in step.
- `acss-dashboard.md` in that skill: change dashboard values without clicking (Automatic.css 4.0.3 moved import and export out of WP admin) and change a font family, both run on a live site.

## 0.3.0 (2026-11-09)

- New skill `site-seo`: search data before copy, page basics, structured data that must match visible content, local SEO with consistent name/address/phone, indexing, visibility in AI search; ships `seo-check.mjs`.
- Wizard: new mode "SEO"; "Full website" runs `site-seo` before `site-verify`.

## 0.2.0 (2026-11-09)

- New skill `site-structure`: inventory crawler (`inventory.mjs`), page types by search intent, pillars and clusters with leading pages, navigation and click depth, content model, relaunch and redirect plan, template for `website-builder/structure.md`.
- Wizard: new mode "Structure or relaunch"; "Full website" now runs `site-structure` before `site-direction`.

## 0.1.1 (2026-11-09)

- Flat skill layout `skills/<name>/SKILL.md` for broader compatibility (Gemini/Antigravity, skills.sh, Grok Build).
- Install instructions for Grok Build and Antigravity CLI (native manifest `.antigravity-plugin/plugin.json`); Claude Code, Codex, Grok Build and Antigravity CLI tested.
- Plugin icon moved to `assets/icon.png`.

## 0.1.0 (2026-11-09)

First version, published as Website Builder Toolkit.

- Skills: `site-wizard` (start, six modes), `site-brand`, `site-direction`, `site-audit`, `site-design`, `site-copy`, `site-polish`, `site-handoff`, `site-verify`, `site-accessibility` (WCAG 2.2 AA, contrast checker), and the stack skills `site-acss`, `site-etch`, `site-bricks`.
- `slop-lint` in `site-audit`: zero-dependency checker with 48 rules across design, CSS, copy, brand, accessibility, Automatic.css and Tailwind patterns.
- Brand profile can mirror an external source of truth and is checked against it before use.
- Data folder `website-builder/` for setup, profile, directions, audits, handoffs, reports.
- Stack skills map content to native Etch and Bricks elements.
- `render-check` in `site-verify`: renders a URL in Chrome and checks reflow per width, text contrast (DevTools method), gradient text, endless animations, alt text, accessible names, target size, zoom lock and console errors.
- Plugin manifests for Claude Code and Codex, installable via skills.sh.
- German and English copy files in `site-copy`.
- `docs/EVIDENCE.md`: research behind the rules with strength labels.
