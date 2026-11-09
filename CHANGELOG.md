# Changelog

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
