# Changelog

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
