# Changelog

## 0.5.0 (2026-11-18)

Skills

- `site-direction`: style position on five measurable axes (density, type contrast, shape, color budget, imagery), a direction template with front matter, and five starting points for variants, each chosen by the material the brand has. The brand profile can set a site-wide position under `style`.
- `site-design`, `site-polish`: web platform rules: image priority for the largest image of the first viewport, fluid type range, `font-size-adjust`, limits of `text-wrap: balance`, forced colors. Sources in `docs/EVIDENCE.md`.
- `site-verify`: render widths set in one place (short set 390 and 1440 px, full set from 320 to 1920 px), a CSS block, a style-position block and a corrected review order (final audit before the measurements).
- Order of SEO fixed: `site-seo` step 1 (search data) runs with `site-structure`, before direction and copy; steps 2 to 6 and the check stay before `site-verify`.
- `SCOPE.md`: legal and consent topics are out.
- Motion durations in `plain-css.md` follow `motion.md`; two dead references fixed.

`slop-lint` (53 rules)

- New rules: `css/fluid-type-range`, `perf/lazy-high-priority`, `perf/google-fonts`, `direction/shape`, `direction/type-contrast`.
- New option `--direction <file>`: reads the style position from a direction file; a file without one is a usage error.
- `design/hover-scale`: the fix no longer suggests a lift, which the skills forbid.
- Fixed: `failOn` from the config file was ignored; tab-indented front matter was not read.

`render-check`

- New check `image-priority`: largest `img` of the first viewport lazy-loaded or without `fetchpriority="high"`; more than two high-priority images.
- New option `--css-effect` with the check `css-no-effect`: removes each declaration of the page's own stylesheets in the browser and reports the ones whose removal changes no computed style. Framework and core stylesheets are left out; `--css-only` narrows the choice.
- New option `--direction <file>` with the check `style-position`: measures the style position on the render from computed values, so it also works where a framework sets radius and type through variables.
- A document answering HTTP 400 or above is an error (a block page was measured, not the site). A JavaScript dialog no longer hangs the run.
- Changed: the default widths start at 320 px instead of 360 px, the reflow minimum of WCAG 1.4.10.
- Fixed in the tests: the report-folder test failed on macOS.

Other scripts

- `seo-check`, `inventory`: `max-image-preview:none` is no longer read as noindex.
- `contrast.mjs` no longer exits silently when started through a symlinked skills folder.

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
