# Roadmap and open work

State after 0.3.0 (2026-11-10). Items move to `CHANGELOG.md` when done. Changes follow `SCOPE.md`.

## Next

- [ ] **Privacy checks in `render-check`:** requests to third-party hosts before consent (fonts, scripts, video, maps), cookies set on first load, self-hosted fonts.
- [ ] **Performance checks in `render-check`:** page weight, largest images vs. displayed size, missing `loading="lazy"` below the fold, Largest Contentful Paint and layout shift from the performance timeline.
- [ ] **Second field test:** full wizard run on an Etch site (mode "Full website"), to test `site-etch` with native elements and the flow from structure to verify.
- [ ] **Test the skills.sh install** (`npx skills add tobiashaas/website-builder-toolkit`) and record the result in the README.

## Distribution

- [ ] Decide on the final plugin icon (it can be set only once in the developer portal).
- [ ] Submit to the official Claude Code marketplace (`claude-plugins-official`).
- [ ] Check whether Antigravity offers a public marketplace and submit there.
- [ ] GitHub Actions: run all script test suites on push (Node 18, 20, 22; Chrome for `render-check`).

## Scripts

- [ ] `slop-lint`: implement the lint hints listed in `site-etch` and `site-bricks` (deep div nesting, divs where containers belong, HTML inside code elements, `href="#"`).
- [ ] `slop-lint`: resolve `var(--…)` tokens when a token file is given; read JSX `style={{…}}` objects; check focus styles across files.
- [ ] `slop-lint`: better language detection for short German files.
- [ ] `render-check`: interactive states (open menus and dialogs, hover, focus), JavaScript-driven animations (GSAP, sliders), opacity of parent elements in contrast.
- [ ] `inventory` and `seo-check`: optional rendering through Chrome for JavaScript-built links and content; a real HTML parser instead of patterns.
- [ ] `contrast.mjs`: parse `oklch()`, `display-p3` and named colors.
- [ ] `seo-check`: confirm the recommended-property lists word for word against Google Search Central; merchant-listing requirements.

## Skills and docs

- [ ] `site-seo`: local landing pages for service areas without a location (what is allowed, what is a doorway page).
- [ ] Neutral example project in `examples/`: a fictional brand profile, structure and audit, so people see the outputs before using the skills.
- [ ] `docs/EVIDENCE.md`: add the WCAG 2.2, structured-data and SEO sources used since 0.1.0; review dates on every skill.
- [ ] Review every skill after the second field test and delete rules that didn't hold.
